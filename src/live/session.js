// A live match session: plays a synthetic match in (accelerated) real time and
// streams three things to whoever is watching:
//
//   event   every match event as it happens, with player names resolved
//   state   the live stats snapshot (score, possession, xG, momentum, chaos, ...)
//   item    crew output: explained, personalised, timed overlays
//   trace   what each agent is doing, for the "behind the broadcast" panel
//
// The clock never waits for the agents. Events go out on schedule from a
// display-side MatchState; the crew works through the same events in order on
// its own queue, so a slow or rate-limited model delays an overlay by a few
// seconds instead of freezing the match.

import { simulateMatch } from '../engine/simulate.js';
import { MatchState } from '../stats/matchState.js';
import { Crew } from '../agents/crew.js';
import { readMetric } from '../stats/metrics.js';

const STATE_EVERY_MS = 1000;

export function describeLiveEvent(ev, state) {
  const out = { id: ev.id, t: ev.t, clock: ev.clock, minute: ev.minute, period: ev.period, type: ev.type, team: ev.team ?? null };
  for (const f of ['player', 'recipient', 'target']) if (ev[f]) out[f] = { id: ev[f], name: state.playerName(ev[f]) };
  for (const k of ['x', 'y', 'endX', 'endY', 'outcome', 'xg', 'distance', 'difficulty', 'speedKmh', 'pressured', 'score']) {
    if (ev[k] !== undefined) out[k] = ev[k];
  }
  return out;
}

export function audiencesFor({ language = 'English', favouriteClub = null, favouritePlayer = null, focusMetric = null } = {}) {
  const fav = { ...(favouriteClub && { favouriteClub }), ...(favouritePlayer && { favouritePlayer }), ...(focusMetric && { focusMetric }) };
  return [
    { id: 'analyst', persona: 'analyst', language, ...fav },
    { id: 'casual', persona: 'casual', language, ...fav },
  ];
}

export class LiveSession {
  // speed: match seconds per real second. 0 plays as fast as possible.
  constructor({ seed = 7, home = 'harbour', away = 'ironvale', speed = 20, audiences = audiencesFor(), llm = null, translator = null, emit = () => {}, now = () => Date.now(), sleep } = {}) {
    this.match = simulateMatch({ seed, home, away });
    this.speed = speed;
    this.emit = emit;
    this.now = now;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.display = new MatchState(this.match.meta);
    this.audiences = audiences;
    this.favouritePlayer = audiences.find((a) => a.favouritePlayer)?.favouritePlayer ?? null;
    this.focusMetric = audiences.find((a) => a.focusMetric)?.focusMetric ?? null;
    this.crew = new Crew({ meta: this.match.meta, llm, translator, audiences, onLog: (entry) => this.send('trace', entry) });
    this.stopped = false;
    this.queue = Promise.resolve();
    this.lastStateAt = -Infinity;
  }

  send(type, data) {
    if (!this.stopped) this.emit(type, data);
  }

  snapshot() {
    const snap = this.display.snapshot();
    const fav = this.favouritePlayer && this.resolvePlayer(this.favouritePlayer);
    return {
      ...snap,
      topPlayers: this.display.topPlayers(3).map((p) => ({ id: p.id, name: p.name, team: p.team, goals: p.goals, xg: p.xg, passesComplete: p.passesComplete, topSpeedKmh: p.topSpeedKmh })),
      favouritePlayer: fav ? this.display.playerView(fav) : null,
      metric: this.focusMetric ? readMetric(this.focusMetric, snap, this.display) : null,
    };
  }

  resolvePlayer(idOrName) {
    if (this.display.players.has(idOrName)) return idOrName;
    for (const [id, p] of this.display.players) if (p.name === idOrName) return id;
    return null;
  }

  async run() {
    const { meta, events } = this.match;
    this.send('meta', { ...meta, audiences: this.audiences, speed: this.speed, eventCount: events.length });
    const started = this.now();
    for (const ev of events) {
      if (this.stopped) return;
      if (this.speed > 0) {
        const due = started + (ev.t / this.speed) * 1000;
        const wait = due - this.now();
        if (wait > 0) await this.sleep(wait);
        if (this.stopped) return;
      }
      this.display.apply(ev);
      this.send('event', describeLiveEvent(ev, this.display));
      const important = ['goal', 'half_time', 'full_time', 'kickoff'].includes(ev.type);
      if (important || this.now() - this.lastStateAt >= STATE_EVERY_MS || this.speed === 0) {
        this.lastStateAt = this.now();
        this.send('state', this.snapshot());
      }
      this.queue = this.queue.then(async () => {
        if (this.stopped) return;
        for (const item of await this.crew.onEvent(ev)) this.send('item', item);
      });
    }
    await this.queue;
    const statuses = this.crew.trace.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
    this.send('state', this.snapshot());
    this.send('end', { items: this.crew.feed.length, statuses });
  }

  stop() {
    this.stopped = true;
  }
}
