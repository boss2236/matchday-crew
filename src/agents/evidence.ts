// Evidence packs and the grounding check.
//
// Agents never see the raw event stream. For each moment they get an evidence
// pack: the moment, the events it cites (with player names resolved), and the
// current match snapshot. Whatever they write is then checked against that
// pack: every number and every player name must come from it, and every
// event they cite must be in it. Anything that fails is rejected.

import type { MatchEvent, MomentData, MomentType, Moment, Score, TeamSnapshot } from '../types.ts';
import type { MatchState } from '../stats/matchState.ts';

const NAME_FIELDS = ['player', 'recipient', 'target'] as const;
const DETAIL_FIELDS = ['outcome', 'xg', 'distance', 'progress', 'difficulty', 'speedKmh', 'pressured', 'cause', 'score'] as const;

// An event as an agent sees it: player and club names instead of ids.
export interface EvidenceEvent {
  id: string;
  clock: string;
  minute: number;
  type: MatchEvent['type'];
  team: string | null;
  player?: string;
  recipient?: string;
  target?: string;
  outcome?: string;
  xg?: number;
  distance?: number;
  progress?: number;
  difficulty?: number;
  speedKmh?: number;
  pressured?: boolean;
  cause?: string;
  score?: Score;
}

export type PackStats = Pick<TeamSnapshot, 'possessionPct' | 'shots' | 'shotsOnTarget' | 'xg' | 'passAccuracyPct' | 'finalThirdEntries' | 'ppda' | 'tacklesWon' | 'interceptions'>;

export interface MatchContext {
  home: string;
  away: string;
  homeStyle: string;
  awayStyle: string;
  score: string;
  minute: number;
  momentum: number;
  chaos: number;
  stats: Record<string, PackStats>;
}

export interface PackMoment {
  id: string;
  type: MomentType;
  clock?: string;
  minute?: number;
  team?: string | null;
  player?: string | null;
  data: MomentData;
}

// Everything an agent may use for one moment, and everything the verifier allows.
export interface EvidencePack {
  moment: PackMoment;
  events: EvidenceEvent[];
  match: MatchContext;
  keyMoments?: PackMoment[];
  topPlayers?: { name: string; team: string; goals: number; xg: number; passesComplete: number }[];
  followedMetric?: Record<string, unknown>;
}

export function describeEvent(ev: MatchEvent, state: MatchState): EvidenceEvent {
  const out: EvidenceEvent = { id: ev.id, clock: ev.clock, minute: ev.minute, type: ev.type, team: ev.team ? teamName(state, ev.team) : null };
  for (const f of NAME_FIELDS) {
    const id = ev[f];
    if (id) out[f] = state.playerName(id);
  }
  const rec = out as unknown as Record<string, unknown>;
  for (const k of DETAIL_FIELDS) {
    if (ev[k] !== undefined) rec[k] = ev[k];
  }
  return out;
}

export function teamName(state: MatchState, teamId: string): string {
  return teamId === state.meta.home.id ? state.meta.home.name : teamId === state.meta.away.id ? state.meta.away.name : teamId;
}

export function buildEvidence(moment: Moment, state: MatchState, eventsById: Map<string, MatchEvent>): EvidencePack {
  const events = moment.evidence
    .map((id) => eventsById.get(id))
    .filter((ev): ev is MatchEvent => Boolean(ev))
    .map((ev) => describeEvent(ev, state));
  const snap = state.snapshot();
  const home = state.meta.home;
  const away = state.meta.away;
  const data: MomentData = { ...moment.data };
  if (data.assist) data.assist = state.playerName(data.assist);
  if (data.recipient) data.recipient = state.playerName(data.recipient);
  return {
    moment: {
      id: moment.id,
      type: moment.type,
      clock: moment.clock,
      minute: moment.minute,
      team: moment.team ? teamName(state, moment.team) : null,
      player: moment.player ? state.playerName(moment.player) : null,
      data,
    },
    events,
    match: {
      home: home.name,
      away: away.name,
      homeStyle: home.styleLabel,
      awayStyle: away.styleLabel,
      score: `${snap.score.home}-${snap.score.away}`,
      minute: snap.minute,
      momentum: snap.momentum,
      chaos: snap.chaos,
      stats: { [home.name]: pickStats(snap.home), [away.name]: pickStats(snap.away) },
    },
  };
}

function pickStats(t: TeamSnapshot): PackStats {
  return {
    possessionPct: t.possessionPct,
    shots: t.shots,
    shotsOnTarget: t.shotsOnTarget,
    xg: t.xg,
    passAccuracyPct: t.passAccuracyPct,
    finalThirdEntries: t.finalThirdEntries,
    ppda: t.ppda,
    tacklesWon: t.tacklesWon,
    interceptions: t.interceptions,
  };
}

// Collect every number that appears anywhere in the evidence pack.
export function allowedNumbers(pack: unknown): Set<string> {
  const nums = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === 'number') addNumber(nums, v);
    else if (typeof v === 'string') for (const n of extractNumbers(v)) addNumber(nums, n);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(pack);
  return nums;
}

function addNumber(set: Set<string>, n: number): void {
  // Signed values (momentum -27 = away side on top) are written as "27".
  if (n < 0) addNumber(set, -n);
  set.add(String(n));
  set.add(String(Math.round(n)));
  set.add(String(Math.round(n * 10) / 10));
  // xG 0.31 is commonly written as 31%.
  if (n > 0 && n < 1) {
    set.add(String(Math.round(n * 100)));
    set.add(String(Math.round(n * 1000) / 10));
  }
}

// Read numbers the way other languages write them: Arabic-Indic and Persian
// digits, the Arabic decimal mark, and decimal commas ("0,829" in Spanish).
// Football numbers here never need thousands separators.
export function normalizeNumerals(text: unknown): string {
  return String(text)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/(\d)[\u066b,](\d)/g, '$1.$2');
}

export function extractNumbers(text: unknown): number[] {
  return (normalizeNumerals(text).match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

// Numbers that are always fine: small counts and the standard match length.
const ALWAYS_OK = new Set(['0', '1', '2', '3', '45', '90']);

export interface VerifyResult {
  ok: boolean;
  problems: string[];
}

export function verify(
  output: unknown,
  pack: EvidencePack,
  state: MatchState,
  { textFields = ['text'], citeField = 'cites' }: { textFields?: string[]; citeField?: string } = {},
): VerifyResult {
  const problems: string[] = [];
  const answer = (output && typeof output === 'object' ? output : {}) as Record<string, unknown>;
  const nums = allowedNumbers(pack);
  const evidenceIds = new Set(pack.events.map((e) => e.id));
  const knownNames = new Set<string>();
  for (const p of state.players.values()) knownNames.add(p.name);
  const packText = JSON.stringify(pack);

  for (const field of textFields) {
    const text = answer[field];
    if (typeof text !== 'string' || !text.trim()) {
      problems.push(`missing ${field}`);
      continue;
    }
    for (const n of extractNumbers(text)) {
      const s = String(n);
      if (!ALWAYS_OK.has(s) && !nums.has(s) && !nums.has(String(Math.round(n)))) problems.push(`number ${s} is not in the evidence`);
    }
    for (const name of knownNames) {
      if (text.includes(name) && !packText.includes(name)) problems.push(`player ${name} is not in the evidence`);
      // Surnames on their own are common in commentary.
      const surname = name.split(' ').slice(-1)[0];
      if (new RegExp(`\\b${surname}\\b`).test(text) && !packText.includes(surname)) problems.push(`player ${surname} is not in the evidence`);
    }
  }

  const cites = answer[citeField];
  if (!Array.isArray(cites) || cites.length === 0) problems.push('no cited events');
  else for (const id of cites) if (!evidenceIds.has(id)) problems.push(`cited event ${id} is not in the evidence`);

  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}
