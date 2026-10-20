// Live match state: consumes events one at a time (as they "happen") and keeps
// running statistics plus a list of detected key moments. This is the
// deterministic "Interpret" stage. AI agents only ever explain what this
// layer has computed, and every moment carries the event IDs behind it.

import type { MatchEvent, MatchMeta, MatchStatus, Moment, MomentData, MomentType, PlayerInfo, PlayerStats, PlayerView, Score, Snapshot, TeamSnapshot, Match } from '../types.ts';

const WINDOW = 5 * 60; // rolling window for momentum and chaos, in seconds
const FINAL_THIRD = 70; // attacking-frame x where the final third starts

export const THRESHOLDS = {
  bigChanceXg: 0.2,
  greatPassDifficulty: 70,
  greatPassProgress: 20,
  sprintKmh: 30,
  rocketShotKmh: 100,
  momentumSwing: 25,
  pressingRegains: 3,
  pressingWindow: 120,
};

interface TeamTotals {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  xg: number;
  passes: number;
  passesComplete: number;
  difficultySum: number;
  progressivePasses: number;
  finalThirdEntries: number;
  pressures: number;
  tackles: number;
  tacklesWon: number;
  interceptions: number;
  fouls: number;
  possessionSeconds: number;
  maxShotSpeed: number;
}

// The detail fields each event type always carries, for use inside apply().
type DetailedEvent = MatchEvent &
  Required<Pick<MatchEvent, 'x' | 'y' | 'endX' | 'endY' | 'distance' | 'progress' | 'difficulty' | 'speedKmh' | 'xg' | 'score' | 'outcome' | 'recipient' | 'cause'>>;

const emptyTeam = (): TeamTotals => ({
  goals: 0,
  shots: 0,
  shotsOnTarget: 0,
  xg: 0,
  passes: 0,
  passesComplete: 0,
  difficultySum: 0,
  progressivePasses: 0,
  finalThirdEntries: 0,
  pressures: 0,
  tackles: 0,
  tacklesWon: 0,
  interceptions: 0,
  fouls: 0,
  possessionSeconds: 0,
  maxShotSpeed: 0,
});

const emptyPlayer = (id: string): PlayerStats => ({
  id,
  passes: 0,
  passesComplete: 0,
  shots: 0,
  goals: 0,
  xg: 0,
  carries: 0,
  carryDistance: 0,
  topSpeedKmh: 0,
  pressures: 0,
  tacklesWon: 0,
  interceptions: 0,
  involvement: 0,
});

export class MatchState {
  meta: MatchMeta;
  homeId: string;
  awayId: string;
  players: Map<string, PlayerInfo & { team: string | null }>;
  teams: Record<string, TeamTotals>;
  playerStats: Map<string, PlayerStats>;
  score: Score;
  period: number;
  t: number;
  minute?: number;
  possession: string | null;
  possessionSince: number;
  status: MatchStatus;
  moments: Moment[];
  recent: MatchEvent[];
  lastMomentumLeader: string | null;
  regains: Record<string, MatchEvent[]>;
  momentumHistory: { t: number; momentum: number; chaos: number }[];

  constructor(meta: MatchMeta) {
    this.meta = meta;
    this.homeId = meta.home.id;
    this.awayId = meta.away.id;
    this.players = new Map();
    for (const p of meta.home.players) this.players.set(p.id, { ...p, team: this.homeId });
    for (const p of meta.away.players) this.players.set(p.id, { ...p, team: this.awayId });

    this.teams = { [this.homeId]: emptyTeam(), [this.awayId]: emptyTeam() };
    this.playerStats = new Map();
    this.score = { home: 0, away: 0 };
    this.period = 1;
    this.t = 0;
    this.possession = null;
    this.possessionSince = 0;
    this.status = 'pre_match';
    this.moments = [];
    this.recent = []; // events inside the rolling window
    this.lastMomentumLeader = null;
    this.regains = { [this.homeId]: [], [this.awayId]: [] };
    this.momentumHistory = [];
  }

  sideOf(teamId: string) {
    return teamId === this.homeId ? 'home' : 'away';
  }

  opponent(teamId: string): string {
    return teamId === this.homeId ? this.awayId : this.homeId;
  }

  // Convert an absolute x into the attacking frame of a team.
  attackingX(teamId: string, x: number, period: number): number {
    const homeRight = period === 1;
    const right = (teamId === this.homeId) === homeRight;
    return right ? x : 105 - x;
  }

  player(id: string): PlayerStats {
    let stats = this.playerStats.get(id);
    if (!stats) this.playerStats.set(id, (stats = emptyPlayer(id)));
    return stats;
  }

  playerName(id: string): string {
    return this.players.get(id)?.name ?? id;
  }

  // Feed one event. Returns the key moments it triggered (possibly none).
  apply(event: MatchEvent): Moment[] {
    const ev = event as DetailedEvent;
    const before = this.moments.length;
    this.t = ev.t;
    this.minute = ev.minute;
    this.period = ev.period;
    this.recent.push(ev);
    while (this.recent.length && this.recent[0].t < ev.t - WINDOW) this.recent.shift();

    // Present for every event type that touches them below.
    const team = (ev.team ? this.teams[ev.team] : null) as TeamTotals;
    const p = (ev.player ? this.player(ev.player) : null) as PlayerStats;
    if (p) p.involvement += 1;
    const teamId = ev.team as string;

    switch (ev.type) {
      case 'kickoff':
        this.status = 'live';
        this.setPossession(teamId, ev.t);
        break;
      case 'possession_change':
        this.setPossession(teamId, ev.t);
        if (['tackle', 'interception'].includes(ev.cause)) this.trackRegain(ev);
        break;
      case 'pass': {
        team.passes += 1;
        team.difficultySum += ev.difficulty;
        p.passes += 1;
        if (ev.outcome === 'complete') {
          team.passesComplete += 1;
          p.passesComplete += 1;
          if (ev.progress >= 10) team.progressivePasses += 1;
          const sx = this.attackingX(teamId, ev.x, ev.period);
          const ex = this.attackingX(teamId, ev.endX, ev.period);
          if (sx < FINAL_THIRD && ex >= FINAL_THIRD) team.finalThirdEntries += 1;
          if (ev.difficulty >= THRESHOLDS.greatPassDifficulty && ev.progress >= THRESHOLDS.greatPassProgress && ex >= FINAL_THIRD) {
            this.addMoment('great_pass', ev, 2, {
              difficulty: ev.difficulty,
              distance: ev.distance,
              recipient: ev.recipient,
            });
          }
        }
        break;
      }
      case 'carry':
        p.carries += 1;
        p.carryDistance += ev.distance;
        p.topSpeedKmh = Math.max(p.topSpeedKmh, ev.speedKmh);
        if (ev.speedKmh >= THRESHOLDS.sprintKmh) {
          this.addMoment('sprint', ev, 1, { speedKmh: ev.speedKmh, distance: ev.distance });
        }
        break;
      case 'pressure':
        team.pressures += 1;
        p.pressures += 1;
        break;
      case 'tackle':
        team.tackles += 1;
        if (ev.outcome === 'won') {
          team.tacklesWon += 1;
          p.tacklesWon += 1;
        } else {
          team.fouls += 1;
        }
        break;
      case 'interception':
        team.interceptions += 1;
        p.interceptions += 1;
        break;
      case 'shot':
        team.shots += 1;
        team.xg += ev.xg;
        team.maxShotSpeed = Math.max(team.maxShotSpeed, ev.speedKmh);
        p.shots += 1;
        p.xg += ev.xg;
        if (ev.outcome === 'goal' || ev.outcome === 'saved') team.shotsOnTarget += 1;
        if (ev.outcome !== 'goal' && ev.xg >= THRESHOLDS.bigChanceXg) {
          this.addMoment('big_chance', ev, 3, { xg: ev.xg, outcome: ev.outcome, distance: ev.distance });
        } else if (ev.outcome !== 'goal' && ev.speedKmh >= THRESHOLDS.rocketShotKmh) {
          this.addMoment('rocket_shot', ev, 1, { speedKmh: ev.speedKmh, outcome: ev.outcome });
        }
        break;
      case 'goal': {
        team.goals += 1;
        p.goals += 1;
        this.score = { ...ev.score };
        const shot = [...this.recent].reverse().find((e) => e.type === 'shot' && e.player === ev.player);
        const buildUp = this.buildUp(ev);
        this.addMoment('goal', ev, 5, {
          xg: ev.xg,
          score: ev.score,
          shotSpeedKmh: shot?.speedKmh,
          assist: buildUp.assist,
          buildUpPasses: buildUp.passes,
        }, buildUp.ids);
        break;
      }
      case 'half_time':
        this.closePossession(ev.t);
        this.status = 'half_time';
        this.addMoment('half_time', ev, 2, { score: ev.score });
        break;
      case 'full_time':
        this.closePossession(ev.t);
        this.status = 'full_time';
        this.addMoment('full_time', ev, 4, { score: ev.score });
        break;
      default:
        break;
    }

    this.checkMomentum(ev);
    return this.moments.slice(before);
  }

  setPossession(teamId: string, t: number) {
    this.closePossession(t);
    this.possession = teamId;
    this.possessionSince = t;
  }

  closePossession(t: number) {
    if (this.possession && this.status === 'live') {
      this.teams[this.possession].possessionSeconds += Math.max(0, t - this.possessionSince);
    }
    this.possessionSince = t;
  }

  // Passes in the same possession leading up to a goal.
  buildUp(goalEv: MatchEvent): { ids: string[]; passes: number; assist: string | null } {
    const ids: string[] = [];
    let passes = 0;
    let assist: string | null = null;
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const e = this.recent[i] as MatchEvent;
      if (e.type === 'possession_change' || e.type === 'kickoff') {
        if (e.id !== goalEv.id) {
          ids.unshift(e.id);
          break;
        }
      }
      if (e.team !== goalEv.team) continue;
      if (['pass', 'carry', 'shot'].includes(e.type)) ids.unshift(e.id);
      if (e.type === 'pass' && e.outcome === 'complete') {
        passes += 1;
        if (!assist && e.recipient === goalEv.player) assist = e.player ?? null;
      }
    }
    return { ids: [...ids, goalEv.id], passes, assist };
  }

  trackRegain(ev: DetailedEvent) {
    const teamId = ev.team as string;
    const list = this.regains[teamId] as MatchEvent[];
    const ax = this.attackingX(teamId, ev.x, ev.period);
    if (ax < 52.5) return; // only regains in the opponent's half count as pressing wins
    list.push(ev);
    while (list.length && (list[0] as MatchEvent).t < ev.t - THRESHOLDS.pressingWindow) list.shift();
    if (list.length >= THRESHOLDS.pressingRegains) {
      const ids = list.map((e) => e.id);
      this.addMoment('pressing_spell', ev, 3, { regains: list.length, windowSeconds: THRESHOLDS.pressingWindow }, ids);
      list.length = 0;
    }
  }

  // Momentum: a -100..100 score for the rolling window, positive = home on top.
  // Threat is built from xG, shots, final-third entries, progressive passes and
  // territory (where events happen in each team's attacking frame).
  momentum(): number {
    const threat: Record<string, number> = { [this.homeId]: 0, [this.awayId]: 0 };
    for (const e of this.recent as DetailedEvent[]) {
      if (!e.team) continue;
      if (e.type === 'shot') threat[e.team] += 4 + e.xg * 30;
      else if (e.type === 'pass' && e.outcome === 'complete') {
        const ex = this.attackingX(e.team, e.endX, e.period);
        if (ex >= FINAL_THIRD) threat[e.team] += 1;
        if (e.progress >= 10) threat[e.team] += 0.5;
      } else if (e.type === 'carry') {
        const ex = this.attackingX(e.team, e.endX, e.period);
        if (ex >= FINAL_THIRD) threat[e.team] += 0.8;
      } else if (e.type === 'possession_change' && ['tackle', 'interception'].includes(e.cause)) {
        threat[e.team] += 0.5;
      }
    }
    const h = threat[this.homeId] as number;
    const a = threat[this.awayId] as number;
    if (h + a === 0) return 0;
    return Math.round(((h - a) / (h + a)) * 100);
  }

  // Chaos: how often the ball changes hands per minute in the window, plus
  // the share of pressured actions. High = scrappy, end-to-end; low = control.
  chaos(): number {
    const span = Math.max(60, Math.min(WINDOW, this.t - (this.recent[0]?.t ?? this.t)));
    let changes = 0;
    let actions = 0;
    let pressured = 0;
    for (const e of this.recent) {
      if (e.type === 'possession_change') changes += 1;
      if (e.type === 'pass' || e.type === 'shot') {
        actions += 1;
        if (e.pressured) pressured += 1;
      }
    }
    const turnoverRate = changes / (span / 60); // per minute
    const pressureShare = actions ? pressured / actions : 0;
    return Math.round(Math.min(100, turnoverRate * 18 + pressureShare * 60));
  }

  checkMomentum(ev: MatchEvent) {
    if (!['shot', 'pass', 'carry', 'possession_change'].includes(ev.type)) return;
    if (this.t < 6 * 60) return;
    const m = this.momentum();
    const last = this.momentumHistory[this.momentumHistory.length - 1];
    if (!last || ev.t - last.t >= 30) this.momentumHistory.push({ t: ev.t, momentum: m, chaos: this.chaos() });
    const leader = m >= THRESHOLDS.momentumSwing ? this.homeId : m <= -THRESHOLDS.momentumSwing ? this.awayId : null;
    if (leader && leader !== this.lastMomentumLeader) {
      const recentMoment = this.moments[this.moments.length - 1];
      const tooSoon = recentMoment?.type === 'momentum_swing' && ev.t - recentMoment.t < 180;
      if (!tooSoon) {
        const ids = this.recent.filter((e) => e.team === leader && ['shot', 'pass', 'carry'].includes(e.type)).slice(-6).map((e) => e.id);
        this.addMoment('momentum_swing', { ...ev, team: leader, player: null }, 3, { momentum: m, chaos: this.chaos() }, ids);
      }
      this.lastMomentumLeader = leader;
    } else if (!leader && Math.abs(m) < 10) {
      this.lastMomentumLeader = null;
    }
  }

  addMoment(
    type: MomentType,
    ev: Pick<MatchEvent, 'id' | 't' | 'clock' | 'minute' | 'team' | 'player'>,
    importance: number,
    data: MomentData,
    evidence: string[] = [ev.id],
  ) {
    this.moments.push({
      id: `m${String(this.moments.length + 1).padStart(3, '0')}`,
      type,
      t: ev.t,
      clock: ev.clock,
      minute: ev.minute,
      team: ev.team ?? null,
      player: ev.player ?? null,
      importance,
      data,
      evidence,
    });
  }

  // A plain snapshot for rendering or for handing to an agent as a tool result.
  snapshot(): Snapshot {
    const live = this.status === 'live' && this.possession ? this.t - this.possessionSince : 0;
    const poss = (id: string) => this.teams[id].possessionSeconds + (this.possession === id ? live : 0);
    const totalPoss = poss(this.homeId) + poss(this.awayId) || 1;
    const teamView = (id: string): TeamSnapshot => {
      const s = this.teams[id] as TeamTotals;
      const oppId = this.opponent(id);
      const opp = this.teams[oppId] as TeamTotals;
      const defActions = s.tacklesWon + s.interceptions + s.fouls;
      return {
        id,
        goals: s.goals,
        possessionPct: Math.round((poss(id) / totalPoss) * 100),
        shots: s.shots,
        shotsOnTarget: s.shotsOnTarget,
        xg: Math.round(s.xg * 100) / 100,
        passes: s.passes,
        passAccuracyPct: s.passes ? Math.round((s.passesComplete / s.passes) * 100) : 0,
        avgPassDifficulty: s.passes ? Math.round(s.difficultySum / s.passes) : 0,
        progressivePasses: s.progressivePasses,
        finalThirdEntries: s.finalThirdEntries,
        pressures: s.pressures,
        tacklesWon: s.tacklesWon,
        interceptions: s.interceptions,
        fouls: s.fouls,
        // Passes allowed per defensive action: lower = more intense pressing.
        ppda: defActions ? Math.round((opp.passes / defActions) * 10) / 10 : null,
        maxShotSpeedKmh: s.maxShotSpeed,
      };
    };
    return {
      matchId: this.meta.matchId,
      status: this.status,
      t: this.t,
      minute: this.minute ?? 0,
      period: this.period,
      score: { ...this.score },
      possession: this.possession,
      momentum: this.momentum(),
      chaos: this.chaos(),
      home: teamView(this.homeId),
      away: teamView(this.awayId),
      momentCount: this.moments.length,
    };
  }

  playerView(id: string): PlayerView {
    const s = this.player(id);
    const info = this.players.get(id) as PlayerInfo & { team: string | null };
    return {
      ...info,
      ...s,
      passAccuracyPct: s.passes ? Math.round((s.passesComplete / s.passes) * 100) : null,
      carryDistance: Math.round(s.carryDistance),
      xg: Math.round(s.xg * 100) / 100,
    };
  }

  topPlayers(n = 5): PlayerView[] {
    const score = (s: PlayerStats) => s.goals * 10 + s.xg * 6 + s.passesComplete * 0.05 + s.tacklesWon + s.interceptions + s.carryDistance * 0.02;
    return [...this.playerStats.values()]
      .sort((a, b) => score(b) - score(a))
      .slice(0, n)
      .map((s) => this.playerView(s.id));
  }
}

// Replay a whole match through MatchState. Handy for tests, recaps and the dataset export.
export function replay(match: Match): MatchState {
  const state = new MatchState(match.meta);
  for (const ev of match.events) state.apply(ev);
  return state;
}
