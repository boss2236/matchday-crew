// The Matchday Crew: a small team of agents that cover a live match the way
// a broadcast crew does. They share one match state (the blackboard) and hand
// work to each other:
//
//   Analyst    (code)   watches every event, decides which moments are worth airing
//                       and builds an evidence pack for each one
//   Tactician  (model)  explains WHY the moment matters, in neutral English
//   Narrator   (model)  rewrites that for each audience: persona, language,
//                       favourite club and favourite player
//   Producer   (code)   turns it into a timed, machine-readable overlay
//   Verifier   (code)   checks every number, name and cited event against the
//                       evidence; failures get one retry with feedback, then a
//                       deterministic template takes over
//   Recap      (model)  writes the full-time story for each audience
//
// With no model configured, every model step falls back to templates, so the
// app still works offline and in tests.

import { MatchState } from '../stats/matchState.js';
import { buildEvidence, verify, teamName } from './evidence.js';
import { templateInsight, templateRecap } from './templates.js';

export const DEFAULT_AUDIENCES = [
  { id: 'analyst-en', persona: 'analyst', language: 'English' },
  { id: 'casual-en', persona: 'casual', language: 'English' },
];

const PERSONAS = {
  analyst:
    'a data-hungry analyst. Use precise football and tactical language and quote the key numbers (xG, distances, pass difficulty, PPDA, momentum).',
  casual:
    'a casual fan. Use plain, warm, exciting language, no jargon, at most one number, and explain things like you would to a friend on the sofa.',
};

const OVERLAY_BY_TYPE = {
  goal: { type: 'goal_card', durationMs: 9000, position: 'lower_third' },
  big_chance: { type: 'chance_card', durationMs: 7000, position: 'lower_third' },
  pressing_spell: { type: 'pressing_heatmap', durationMs: 8000, position: 'side_panel' },
  momentum_swing: { type: 'momentum_bar', durationMs: 8000, position: 'top_bar' },
  great_pass: { type: 'pass_trail', durationMs: 6000, position: 'pitch' },
  sprint: { type: 'player_tag', durationMs: 5000, position: 'pitch' },
  half_time: { type: 'score_summary', durationMs: 12000, position: 'full_screen' },
  full_time: { type: 'score_summary', durationMs: 15000, position: 'full_screen' },
};

export class Crew {
  constructor({ meta, llm = null, audiences = DEFAULT_AUDIENCES, minGapSeconds = 90 } = {}) {
    this.state = new MatchState(meta);
    this.llm = llm;
    this.audiences = audiences;
    this.minGapSeconds = minGapSeconds;
    this.eventsById = new Map();
    this.feed = [];
    this.trace = [];
    this.covered = [];
    this.lastFeatureT = -Infinity;
  }

  // Feed one live event. Resolves with the feed items it produced.
  async onEvent(ev) {
    this.eventsById.set(ev.id, ev);
    const moments = this.state.apply(ev);
    const out = [];
    for (const moment of moments) {
      if (!this.analystSelects(moment)) continue;
      out.push(...(await this.cover(moment)));
    }
    if (ev.type === 'full_time') out.push(...(await this.recap()));
    this.feed.push(...out);
    return out;
  }

  // Analyst: decide whether a moment is worth airing now.
  analystSelects(moment) {
    const always = ['goal', 'half_time', 'full_time'];
    const playerFocus = this.audiences.some((a) => a.favouritePlayer && moment.player && this.playerMatches(a.favouritePlayer, moment.player));
    let selected = false;
    let reason = 'below threshold';
    if (always.includes(moment.type)) {
      selected = true;
      reason = 'always cover';
    } else if (playerFocus && ['great_pass', 'sprint', 'big_chance'].includes(moment.type)) {
      selected = true;
      reason = 'favourite player involved';
    } else if (moment.importance >= 3 && moment.t - this.lastFeatureT >= this.minGapSeconds) {
      selected = true;
      reason = `importance ${moment.importance}`;
    } else if (moment.importance >= 3) {
      reason = 'too soon after the last feature';
    }
    if (selected && !always.includes(moment.type)) this.lastFeatureT = moment.t;
    this.log('Analyst', moment.id, selected ? 'selected' : 'skipped', reason);
    return selected;
  }

  playerMatches(fav, playerId) {
    return fav === playerId || this.state.playerName(playerId) === fav;
  }

  async cover(moment) {
    const pack = buildEvidence(moment, this.state, this.eventsById);
    this.covered.push(pack);
    const insight = await this.tactician(pack);
    const items = [];
    for (const audience of this.audiences) {
      const line = await this.narrator(pack, insight, audience);
      items.push(this.producer(moment, pack, insight, line, audience));
    }
    return items;
  }

  // Tactician: why does this moment matter?
  async tactician(pack) {
    const system = [
      'You are the Tactician in a football broadcast crew covering a synthetic match between fictional clubs.',
      'Explain WHY the moment in the evidence pack matters: the tactical pattern, the momentum, control vs chaos, the pressure, the game state.',
      'Rules: use ONLY facts and numbers present in the evidence pack. Never invent players, numbers or events.',
      'Every number you write must appear in the evidence pack exactly. Name only players who appear in the pack.',
      'Reply as JSON: {"headline": string (max 8 words), "text": string (1-2 sentences, max 45 words), "tags": string[] (1-3 of: pressing, counter, possession, momentum, chaos, control, finishing, chance, pass, speed, set-back), "cites": string[] (event ids from the pack that support your claim)}.',
    ].join('\n');
    return this.callVerified('Tactician', pack, { system, user: { evidence: pack } }, () => templateInsight(pack));
  }

  // Narrator: the same insight, shaped for one audience.
  async narrator(pack, insight, audience) {
    const fav = [];
    if (audience.favouriteClub) fav.push(`Their favourite club is ${audience.favouriteClub}; speak from that fan's point of view.`);
    if (audience.favouritePlayer) fav.push(`Their favourite player is ${audience.favouritePlayer}; mention them if they are in the evidence pack.`);
    const system = [
      'You are the Narrator in a football broadcast crew covering a synthetic match between fictional clubs.',
      `Write one on-screen commentary line for ${PERSONAS[audience.persona] ?? PERSONAS.casual}`,
      `Write in ${audience.language}. Keep player and club names exactly as given.`,
      ...fav,
      'Base it on the Tactician insight and the evidence pack. Use ONLY facts and numbers from them; write numbers with digits exactly as they appear.',
      'Reply as JSON: {"headline": string (max 8 words), "text": string (max 35 words), "cites": string[] (event ids from the pack)}.',
    ].join('\n');
    const fallback = () => ({ headline: insight.headline, text: insight.text, cites: insight.cites, language: 'English' });
    return this.callVerified(`Narrator/${audience.id}`, pack, { system, user: { insight, evidence: pack } }, fallback);
  }

  // Producer: timed, machine-readable overlay for the rendering layer.
  producer(moment, pack, insight, line, audience) {
    const overlay = OVERLAY_BY_TYPE[moment.type] ?? { type: 'info_card', durationMs: 6000, position: 'lower_third' };
    const item = {
      id: `${moment.id}-${audience.id}`,
      momentId: moment.id,
      audience: audience.id,
      t: moment.t,
      clock: moment.clock,
      type: moment.type,
      team: moment.team,
      teamName: moment.team ? teamName(this.state, moment.team) : null,
      player: moment.player,
      headline: line.headline,
      text: line.text,
      tags: insight.tags ?? [],
      cites: line.cites,
      source: line.source,
      overlay: { ...overlay, showAt: moment.t, data: overlayData(moment, pack) },
    };
    this.log('Producer', moment.id, 'overlay', `${overlay.type} for ${audience.id}`);
    return item;
  }

  async recap() {
    const fullTime = this.covered.find((p) => p.moment.type === 'full_time');
    const match = fullTime?.match ?? buildEvidence({ id: 'ft', type: 'full_time', evidence: [], data: {} }, this.state, this.eventsById).match;
    const packs = this.covered.filter((p) => ['goal', 'big_chance', 'pressing_spell', 'momentum_swing'].includes(p.moment.type));
    const recapPack = {
      moment: { id: 'recap', type: 'recap', data: {} },
      events: [...packs.flatMap((p) => p.events), ...(fullTime?.events ?? [])],
      match,
      keyMoments: packs.map((p) => p.moment),
      topPlayers: this.state.topPlayers(3).map((p) => ({ name: p.name, team: teamName(this.state, p.team), goals: p.goals, xg: p.xg, passesComplete: p.passesComplete })),
    };
    const items = [];
    for (const audience of this.audiences) {
      const system = [
        'You are the Recap writer in a football broadcast crew covering a synthetic match between fictional clubs.',
        `Write the full-time recap for ${PERSONAS[audience.persona] ?? PERSONAS.casual}`,
        `Write in ${audience.language}. Keep player and club names exactly as given.`,
        audience.favouriteClub ? `Their favourite club is ${audience.favouriteClub}.` : '',
        audience.favouritePlayer ? `Their favourite player is ${audience.favouritePlayer}.` : '',
        'Tell the story of the match in order: how it started, the turning points, how it ended, and the standout player. Explain why the result happened.',
        'Use ONLY facts and numbers from the evidence; write numbers with digits exactly as they appear.',
        'Reply as JSON: {"headline": string (max 10 words), "text": string (80-130 words), "cites": string[] (event ids)}.',
      ].filter(Boolean).join('\n');
      const out = await this.callVerified(`Recap/${audience.id}`, recapPack, { system, user: { evidence: recapPack }, maxTokens: 700 }, () => templateRecap(packs, match));
      items.push({
        id: `recap-${audience.id}`,
        momentId: 'recap',
        audience: audience.id,
        t: this.state.t,
        clock: 'FT',
        type: 'recap',
        headline: out.headline,
        text: out.text,
        cites: out.cites,
        source: out.source,
        overlay: { type: 'recap_panel', position: 'full_screen', durationMs: 20000, showAt: this.state.t, data: { score: match.score } },
      });
    }
    return items;
  }

  // Call the model, verify, retry once with the problems, else fall back.
  async callVerified(agent, pack, request, fallback) {
    if (!this.llm) {
      const out = { ...fallback(), source: 'template' };
      this.log(agent, pack.moment.id, 'template', 'no model configured');
      return out;
    }
    let feedback = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      try {
        const user = feedback ? { ...request.user, previousAttemptRejected: feedback } : request.user;
        const out = await this.llm.json({ ...request, user });
        const check = verify(out, pack, this.state);
        if (check.ok) {
          this.log(agent, pack.moment.id, 'ok', `attempt ${attempt}`, Date.now() - started);
          return { ...out, source: 'model' };
        }
        feedback = check.problems;
        this.log(agent, pack.moment.id, 'rejected', check.problems.join('; '), Date.now() - started);
      } catch (err) {
        feedback = [`error: ${err.message}`];
        this.log(agent, pack.moment.id, 'error', err.message, Date.now() - started);
      }
    }
    this.log(agent, pack.moment.id, 'template', 'fell back after 2 attempts');
    return { ...fallback(), source: 'template' };
  }

  log(agent, momentId, status, detail, ms = 0) {
    this.trace.push({ t: this.state.t, agent, momentId, status, detail, ms });
  }
}

function overlayData(moment, pack) {
  const d = moment.data;
  switch (moment.type) {
    case 'goal':
      return { scorer: pack.moment.player, assist: pack.moment.data.assist ?? null, xg: d.xg, score: d.score };
    case 'big_chance':
      return { player: pack.moment.player, xg: d.xg, outcome: d.outcome };
    case 'momentum_swing':
      return { momentum: d.momentum, chaos: d.chaos };
    case 'pressing_spell':
      return { regains: d.regains, eventIds: moment.evidence };
    case 'great_pass':
      return { from: pack.moment.player, to: pack.moment.data.recipient, difficulty: d.difficulty, distance: d.distance };
    case 'sprint':
      return { player: pack.moment.player, speedKmh: d.speedKmh };
    default:
      return { score: pack.match.score };
  }
}
