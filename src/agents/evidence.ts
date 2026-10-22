// Evidence packs and the grounding check.
//
// Agents never see the raw event stream. For each moment they get an evidence
// pack: the moment, the events it cites (with player names resolved), and the
// current match snapshot. Whatever they write is then checked against that
// pack: every number and every player name must come from it, and every
// event they cite must be in it. Anything that fails is rejected.

import type { MatchEvent, MomentData, MomentType, Moment, Score, TeamSnapshot } from '../types.ts';
import type { MatchState } from '../stats/matchState.ts';
import { CLUBS } from '../engine/teams.ts';

// Every player in the league: naming a player from another club is as wrong as
// naming one who was not involved.
const LEAGUE_NAMES = Object.values(CLUBS).flatMap((c) => c.players.map((p) => p.name));

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
  set.add(String(Math.round(n * 100) / 100));
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

// Distances in the data are metres and speeds are km/h. A bare "km" (or the
// Arabic "كم" without "/س") turns a 8.7 m carry into 8.7 km, so it is rejected.
// Reads the same numeral styles as extractNumbers, and hyphenated forms ("a 10.3-km run").
const KM_NOT_SPEED = /(\d+(?:\.\d+)?)[\s\-‐‑]*(?:km|kilomet(?:re|er)s?|كم|كيلومترات?|كيلومتر)(?!\s*(?:\/|per\b|an hour|ph\b|\/h|\/س|في الساعة))/gi;

// Yards are the same mistake the other way: a 1.2 m tap-in written as "1.2 yards"
// (found by the independent review, docs/REVIEW.md). Digits or a number word.
const YARDS = /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)[\s\-‐‑]*(?:yards?|yds?)\b/gi;

export function unitProblems(text: unknown): string[] {
  const problems: string[] = [];
  const normalized = normalizeNumerals(text);
  for (const m of normalized.matchAll(KM_NOT_SPEED)) problems.push(`distance ${m[1]} km should be metres`);
  for (const m of normalized.matchAll(YARDS)) problems.push(`distance ${m[1]} yards should be metres`);
  return problems;
}

// Numbers with a unit must match a value of that kind in the evidence: a speed in
// km/h a speed, a distance in metres a distance, xG an xG, a percentage a
// percentage (or an xG written as a percentage). This stops a wrong number from
// passing because the same digits happen to appear elsewhere in the pack.
type Kind = 'speed' | 'distance' | 'xg' | 'percent';

const KIND_OF_KEY: [RegExp, Kind][] = [
  [/speedkmh$/i, 'speed'],
  [/^(distance|progress|carrydistance)$/i, 'distance'],
  [/^xg$/i, 'xg'],
  [/pct$/i, 'percent'],
];

const kindOfUnit = (unit: string): Kind | null =>
  /km\/h/.test(unit) ? 'speed' : /xg/i.test(unit) ? 'xg' : /%/.test(unit) ? 'percent' : /^m\b|metre|meter/i.test(unit) ? 'distance' : null;

export function valuesByKind(pack: unknown): Record<Kind, Set<string>> {
  const out: Record<Kind, Set<string>> = { speed: new Set(), distance: new Set(), xg: new Set(), percent: new Set() };
  const visit = (v: unknown, forced: Kind | null) => {
    if (Array.isArray(v)) return v.forEach((x) => visit(x, forced));
    if (!v || typeof v !== 'object') return;
    const obj = v as Record<string, unknown>;
    // A followed-metric block says its unit once for all of its numbers.
    const unitKind = typeof obj.unit === 'string' ? kindOfUnit(obj.unit) : null;
    for (const [k, x] of Object.entries(obj)) {
      const kind = forced ?? unitKind ?? KIND_OF_KEY.find(([re]) => re.test(k))?.[1] ?? null;
      if (typeof x === 'number' && kind) {
        addNumber(out[kind], x);
        if (kind === 'xg') addNumber(out.percent, x * 100);
      } else if (x && typeof x === 'object') visit(x, forced ?? unitKind);
    }
  };
  visit(pack, null);
  return out;
}

const UNIT_PATTERNS: [Kind, RegExp][] = [
  ['speed', /(\d+(?:\.\d+)?)\s*(?:km\/h|kph|km per hour|كم\/س|كم\/ساعة|كم في الساعة)/gi],
  ['distance', /(\d+(?:\.\d+)?)\s*(?:m|metres|meters|metros|mètres|متر|أمتار)(?![a-z\/])/gi],
  ['percent', /(\d+(?:\.\d+)?)\s*%/g],
  ['xg', /(?:\bxG\s*(?:of\s*|de\s*|=\s*)?(\d+(?:\.\d+)?))|(?:(\d+(?:\.\d+)?)\s*xG\b)/gi],
];

export function unitNumberProblems(text: unknown, pack: unknown): string[] {
  const kinds = valuesByKind(pack);
  const normalized = normalizeNumerals(text);
  const problems: string[] = [];
  for (const [kind, re] of UNIT_PATTERNS) {
    // No value of this kind in the evidence: leave it to the general check.
    if (!kinds[kind].size) continue;
    for (const m of normalized.matchAll(re)) {
      const value = m[1] ?? m[2];
      if (value === undefined) continue;
      const s = String(Number(value));
      if (!kinds[kind].has(s) && !ALWAYS_OK.has(s)) problems.push(`${kind} ${s} does not match any ${kind} in the evidence`);
    }
  }
  return problems;
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
  const knownNames = new Set<string>(LEAGUE_NAMES);
  for (const p of state.players.values()) knownNames.add(p.name);
  const packText = JSON.stringify(pack);

  for (const field of textFields) {
    const text = answer[field];
    if (typeof text !== 'string' || !text.trim()) {
      problems.push(`missing ${field}`);
      continue;
    }
    problems.push(...unitProblems(text));
    problems.push(...unitNumberProblems(text, pack));
    for (const n of extractNumbers(text)) {
      // Whole numbers may be a rounded evidence value (pack values are added
      // rounded); a decimal must match an evidence value at the precision written,
      // so 37.3 cannot pass on the strength of a 37, nor 0.45 on a 0.
      const s = String(n);
      if (!ALWAYS_OK.has(s) && !nums.has(s)) problems.push(`number ${s} is not in the evidence`);
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
