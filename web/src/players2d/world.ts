// The moving picture: 22 players and a ball, driven by the live event feed.
// The feed only says where the players involved in each action are, so everyone
// else moves the way a team does: holding a 4-3-3 shape that slides with the
// ball, pushing up in possession, dropping and pressing out of it.
import type { LiveEvent, Meta, PlayerInfo } from './types.ts';

const LENGTH = 105, WIDTH = 68;

// Formation slots in the team's attacking frame (x towards the opponent's goal),
// in squad order (shirt 1..11), as in the simulator.
const SLOTS: { x: number; y: number }[] = [
  { x: 5, y: 34 }, { x: 30, y: 60 }, { x: 22, y: 44 }, { x: 22, y: 24 }, { x: 30, y: 8 },
  { x: 40, y: 34 }, { x: 52, y: 46 }, { x: 52, y: 22 }, { x: 75, y: 60 }, { x: 82, y: 34 }, { x: 75, y: 8 },
];

export interface Player {
  id: string;
  name: string;
  shirt: number;
  side: 'home' | 'away';
  gk: boolean;
  slot: { x: number; y: number };
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  // Until this match time the player heads for where the feed put them.
  hold: number;
  phase: number;
  facing: 1 | -1;
  // Match time of the last pass or shot, for the kicking leg.
  kick: number;
  // A goalkeeper's dive for a save: when, and which way across the pitch.
  dive: { t: number; dir: 1 | -1 } | null;
}

export interface Ball {
  x: number;
  y: number;
  z: number;
  carrier: string | null;
  // Who receives the ball when the pass in flight lands.
  pendingCarrier?: string;
  flight: { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number; h: number } | null;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class World {
  players: Player[] = [];
  byId = new Map<string, Player>();
  ball: Ball = { x: 52.5, y: 34, z: 0, carrier: null, flight: null };
  clock = 0;
  period = 1;
  possession: 'home' | 'away' | null = null;
  homeId = '';
  celebrate: { until: number; scorer: string | null; side: 'home' | 'away' } | null = null;
  // The last goal: which end's net the ball hit, and when (the net bulges).
  netHit: { x: number; t: number } | null = null;

  constructor(meta: Meta) {
    this.homeId = meta.home.id;
    for (const side of ['home', 'away'] as const) {
      meta[side].players.forEach((p: PlayerInfo, i: number) => {
        const slot = SLOTS[i] ?? { x: 50, y: 34 };
        const pl: Player = { id: p.id, name: p.name, shirt: p.shirt, side, gk: p.pos === 'GK', slot, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, hold: -1, phase: Math.random() * 6, facing: 1, kick: -9, dive: null };
        const kick = this.toPitch(side, { x: Math.min(slot.x * 0.48, 49), y: slot.y });
        pl.x = pl.tx = kick.x;
        pl.y = pl.ty = kick.y;
        this.players.push(pl);
        this.byId.set(p.id, pl);
      });
    }
  }

  attacksRight(side: 'home' | 'away') {
    return (side === 'home') === (this.period === 1);
  }

  // Attacking frame -> pitch: a team attacking left is mirrored in both axes.
  toPitch(side: 'home' | 'away', p: { x: number; y: number }) {
    return this.attacksRight(side) ? { x: p.x, y: p.y } : { x: LENGTH - p.x, y: WIDTH - p.y };
  }
  // The mirror is its own inverse.
  fromPitch(side: 'home' | 'away', p: { x: number; y: number }) {
    return this.toPitch(side, p);
  }

  sideOf(team: string | null): 'home' | 'away' | null {
    return team ? (team === this.homeId ? 'home' : 'away') : null;
  }

  // An event from the feed: put the people involved where it says, move the ball.
  apply(ev: LiveEvent) {
    this.clock = Math.max(this.clock, ev.t);
    if (ev.period && ev.period !== this.period) this.period = ev.period;
    const side = this.sideOf(ev.team);
    const at = ev.x !== undefined && ev.y !== undefined ? { x: ev.x, y: ev.y } : null;
    const end = ev.endX !== undefined && ev.endY !== undefined ? { x: ev.endX, y: ev.endY } : null;
    const actor = ev.player ? this.byId.get(ev.player.id) : undefined;
    const send = (p: Player | undefined, to: { x: number; y: number } | null, secs: number) => {
      if (!p || !to) return;
      // Far behind the action: the picture would lag, so close most of the gap at once.
      const d = Math.hypot(p.x - to.x, p.y - to.y);
      if (d > 22) { p.x = to.x + (p.x - to.x) * (12 / d); p.y = to.y + (p.y - to.y) * (12 / d); }
      p.tx = to.x; p.ty = to.y; p.hold = this.clock + secs;
    };
    // Strike the ball: swing the leg, face where it goes.
    const kick = (p: Player | undefined, to: { x: number; y: number } | null) => {
      if (!p) return;
      p.kick = this.clock;
      if (to) p.facing = to.x >= p.x ? 1 : -1;
    };

    switch (ev.type) {
      case 'kickoff':
        this.ball = { x: 52.5, y: 34, z: 0, carrier: actor?.id ?? null, flight: null };
        this.celebrate = null;
        for (const p of this.players) {
          const k = this.toPitch(p.side, { x: Math.min(p.slot.x * 0.48, 49), y: p.slot.y });
          p.x = p.tx = k.x; p.y = p.ty = k.y; p.hold = -1;
        }
        if (actor) { actor.x = actor.tx = 52.5; actor.y = actor.ty = 34.5; }
        this.possession = side;
        break;
      case 'pass': {
        if (side) this.possession = side;
        send(actor, at, 1.5);
        const to = end ?? at;
        kick(actor, to);
        if (to && at) {
          const dist = Math.hypot(to.x - at.x, to.y - at.y);
          this.ball.carrier = null;
          this.ball.flight = { fx: at.x, fy: at.y, tx: to.x, ty: to.y, t0: this.clock, dur: clamp(dist / 17, 0.5, 3.2), h: dist > 25 ? dist * 0.11 : 0 };
        }
        if (ev.outcome === 'complete' && ev.recipient) {
          const r = this.byId.get(ev.recipient.id);
          send(r, to, 2.5);
          if (r) this.ball.pendingCarrier = r.id;
        }
        break;
      }
      case 'carry':
        if (side) this.possession = side;
        send(actor, end ?? at, 2.5);
        if (actor) { this.ball.flight = null; this.ball.carrier = actor.id; }
        break;
      case 'shot': {
        if (side) this.possession = side;
        send(actor, at, 1.5);
        if (at && side) {
          const right = at.x > 52.5;
          const goalX = right ? LENGTH + 1 : -1;
          const onTarget = ev.outcome === 'goal' || ev.outcome === 'saved';
          const gy = onTarget ? clamp(at.y + (Math.random() - 0.5) * 6, 30.6, 37.4) : 34 + (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 6);
          kick(actor, { x: goalX, y: gy });
          this.ball.carrier = null;
          this.ball.flight = { fx: at.x, fy: at.y, tx: ev.outcome === 'saved' ? goalX - (right ? 2 : -2) : ev.outcome === 'goal' ? goalX + (right ? 1 : -1) : goalX, ty: gy, t0: this.clock, dur: clamp(Math.hypot(goalX - at.x, gy - at.y) / 30, 0.35, 1.2), h: 1.2 + Math.random() * 1.5 };
        }
        break;
      }
      case 'goal':
        if (side) {
          this.celebrate = { until: this.clock + 25, scorer: actor?.id ?? null, side };
          this.netHit = { x: this.attacksRight(side) ? LENGTH : 0, t: this.clock };
        }
        break;
      case 'save':
      case 'interception':
      case 'tackle':
      case 'possession_change':
        // A keeper dives towards where the shot was going.
        if (ev.type === 'save' && actor) actor.dive = { t: this.clock, dir: this.ball.flight && this.ball.flight.ty > actor.y ? 1 : -1 };
        if (side && ev.type !== 'tackle') this.possession = side;
        send(actor, at, 1.8);
        if (actor && ev.type !== 'tackle') { this.ball.flight = null; this.ball.carrier = actor.id; }
        if (at && ev.type === 'tackle') { this.ball.flight = null; this.ball.carrier = null; this.ball.x = at.x; this.ball.y = at.y; }
        break;
      case 'pressure':
        send(actor, at, 1.2);
        break;
      case 'half_time':
        this.period = 2;
        break;
      default:
        send(actor, at, 1.2);
    }
  }

  // Advance the picture by dt match seconds.
  step(dt: number) {
    this.clock += dt;
    const b = this.ball;
    if (b.flight) {
      const u = clamp((this.clock - b.flight.t0) / b.flight.dur, 0, 1);
      b.x = b.flight.fx + (b.flight.tx - b.flight.fx) * u;
      b.y = b.flight.fy + (b.flight.ty - b.flight.fy) * u;
      b.z = 4 * b.flight.h * u * (1 - u);
      if (u >= 1) {
        b.flight = null; b.z = 0;
        if (b.pendingCarrier) { b.carrier = b.pendingCarrier; b.pendingCarrier = undefined; }
      }
    } else if (b.carrier) {
      const c = this.byId.get(b.carrier);
      if (c) {
        // At the carrier's feet, a step ahead in the direction they run.
        const sp = Math.hypot(c.vx, c.vy) || 1;
        b.x += (c.x + (c.vx / sp) * 0.9 - b.x) * Math.min(1, dt * 12);
        b.y += (c.y + (c.vy / sp) * 0.5 + 0.3 - b.y) * Math.min(1, dt * 12);
      }
      b.z = 0;
    }

    const ball = { x: b.x, y: b.y };
    for (const side of ['home', 'away'] as const) {
      const team = this.players.filter((p) => p.side === side);
      const attacking = this.possession === side;
      const bf = this.fromPitch(side, ball);
      // Pressing: the two nearest outfield players of the team without the ball close it down.
      const pressers = attacking || this.possession === null ? [] : team.filter((p) => !p.gk).sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y)).slice(0, 2);
      const scorer = this.celebrate?.side === side && this.celebrate.scorer ? this.byId.get(this.celebrate.scorer) : undefined;
      for (const p of team) {
        if (p.hold > this.clock || p.id === b.carrier) continue;
        // After a goal the scorer's teammates run over to mob them.
        if (scorer && p !== scorer && !p.gk) {
          const a = p.phase * 2.1;
          p.tx = scorer.x + Math.cos(a) * 1.6;
          p.ty = scorer.y + Math.sin(a) * 1.2;
          continue;
        }
        let target: { x: number; y: number };
        if (p.gk) {
          target = { x: clamp(4 + (bf.x - 20) * 0.08, 2, 16), y: clamp(34 + (bf.y - 34) * 0.25, 28, 40) };
        } else {
          const push = attacking ? 7 : -5;
          const shift = (bf.x - 52.5) * 0.5 + push;
          const line = p.slot.x < 35 ? 0.8 : 1; // defenders shift a little less
          target = {
            x: clamp(p.slot.x + shift * line, 8, attacking ? 100 : 92),
            y: clamp(p.slot.y + (bf.y - 34) * 0.32, 3, 65),
          };
          if (p === pressers[0]) target = { x: bf.x - 1.2, y: bf.y };
          else if (p === pressers[1]) target = { x: (target.x + bf.x) / 2, y: (target.y + bf.y) / 2 };
          // A little life: players never stand perfectly still.
          target.x += Math.sin(this.clock * 0.35 + p.phase) * 1.1;
          target.y += Math.cos(this.clock * 0.28 + p.phase * 1.7) * 0.9;
        }
        const t = this.toPitch(side, target);
        p.tx = t.x; p.ty = t.y;
      }
    }

    for (const p of this.players) {
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const busy = p.hold > this.clock || p.id === b.carrier;
      const top = busy ? 8.5 : 6.2; // m/s
      // Accelerate towards the target, ease off as it gets close.
      const want = Math.min(top, d * 1.6);
      const ux = d > 0.01 ? dx / d : 0, uy = d > 0.01 ? dy / d : 0;
      const k = Math.min(1, dt * 4);
      p.vx += (ux * want - p.vx) * k;
      p.vy += (uy * want - p.vy) * k;
      p.x = clamp(p.x + p.vx * dt, -2, LENGTH + 2);
      p.y = clamp(p.y + p.vy * dt, -2, WIDTH + 2);
      const speed = Math.hypot(p.vx, p.vy);
      p.phase += speed * dt * 1.9;
      if (Math.abs(p.vx) > 0.3) p.facing = p.vx > 0 ? 1 : -1;
      else if (b.carrier !== p.id) p.facing = b.x > p.x ? 1 : -1;
    }

    if (this.celebrate && this.clock > this.celebrate.until) this.celebrate = null;
  }
}
