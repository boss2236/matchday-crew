// Shared domain types for the simulator, stats engine, agents, server and web
// app. Type-only module: it erases to nothing at runtime.

export type Side = 'home' | 'away';

export interface Score {
  home: number;
  away: number;
}

export type EventType =
  | 'kickoff'
  | 'pass'
  | 'carry'
  | 'pressure'
  | 'tackle'
  | 'interception'
  | 'possession_change'
  | 'shot'
  | 'save'
  | 'goal'
  | 'half_time'
  | 'full_time';

// One synthetic match event. Coordinates are absolute pitch metres (105 x 68).
export interface MatchEvent {
  id: string;
  t: number;
  clock: string;
  minute: number;
  period: number;
  type: EventType;
  team: string | null;
  player?: string | null;
  recipient?: string;
  target?: string;
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  distance?: number;
  progress?: number;
  difficulty?: number;
  speedKmh?: number;
  pressured?: boolean;
  outcome?: string;
  xg?: number;
  cause?: string;
  sprint?: boolean;
  score?: Score;
}

export type Position = 'GK' | 'RB' | 'LB' | 'CB' | 'DM' | 'CM' | 'RW' | 'LW' | 'ST';

export interface Attributes {
  passing: number;
  dribbling: number;
  finishing: number;
  pace: number;
  defending: number;
}

export interface PlayerInfo {
  id: string;
  shirt: number;
  name: string;
  pos: Position;
}

export interface PlayerProfile extends PlayerInfo, Attributes {
  home: { x: number; y: number };
}

export interface ClubStyle {
  press: number;
  directness: number;
  tempo: number;
  width: number;
  shootiness: number;
}

export interface ClubColors {
  // Light-theme club colour; `dark` is the same identity stepped for dark
  // surfaces. The four clubs are checked as a chart palette (any pairing stays
  // distinguishable with colour-blindness, in both themes).
  primary: string;
  dark: string;
  secondary: string;
}

export interface Club {
  id: string;
  name: string;
  short: string;
  colors: ClubColors;
  style: ClubStyle;
  styleLabel: string;
  players: PlayerProfile[];
}

export interface ClubSummary extends Omit<Club, 'players'> {
  players: PlayerInfo[];
}

export interface MatchMeta {
  matchId: string;
  seed: number;
  kickoff: string;
  competition: string;
  venue: string;
  synthetic: true;
  pitch: { length: number; width: number };
  home: ClubSummary;
  away: ClubSummary;
}

export interface Match {
  meta: MatchMeta;
  events: MatchEvent[];
  score: Score;
}

export type MomentType =
  | 'goal'
  | 'big_chance'
  | 'rocket_shot'
  | 'great_pass'
  | 'sprint'
  | 'pressing_spell'
  | 'momentum_swing'
  | 'half_time'
  | 'full_time'
  | 'recap';

export interface MomentData {
  xg?: number;
  score?: Score;
  shotSpeedKmh?: number;
  assist?: string | null;
  buildUpPasses?: number;
  outcome?: string;
  distance?: number;
  difficulty?: number;
  recipient?: string;
  speedKmh?: number;
  regains?: number;
  windowSeconds?: number;
  momentum?: number;
  chaos?: number;
}

// A key moment detected by the stats engine, with the events that prove it.
export interface Moment {
  id: string;
  type: MomentType;
  t: number;
  clock: string;
  minute: number;
  team: string | null;
  player: string | null;
  importance: number;
  data: MomentData;
  evidence: string[];
}

export interface TeamSnapshot {
  id: string;
  goals: number;
  possessionPct: number;
  shots: number;
  shotsOnTarget: number;
  xg: number;
  passes: number;
  passAccuracyPct: number;
  avgPassDifficulty: number;
  progressivePasses: number;
  finalThirdEntries: number;
  pressures: number;
  tacklesWon: number;
  interceptions: number;
  fouls: number;
  ppda: number | null;
  maxShotSpeedKmh: number;
}

export type MatchStatus = 'pre_match' | 'live' | 'half_time' | 'full_time';

export interface Snapshot {
  matchId: string;
  status: MatchStatus;
  t: number;
  minute: number;
  period: number;
  score: Score;
  possession: string | null;
  momentum: number;
  chaos: number;
  home: TeamSnapshot;
  away: TeamSnapshot;
  momentCount: number;
}

export interface PlayerStats {
  id: string;
  passes: number;
  passesComplete: number;
  shots: number;
  goals: number;
  xg: number;
  carries: number;
  carryDistance: number;
  topSpeedKmh: number;
  pressures: number;
  tacklesWon: number;
  interceptions: number;
  involvement: number;
}

export interface PlayerView extends PlayerInfo, PlayerStats {
  team: string | null;
  passAccuracyPct: number | null;
}

export type Persona = 'analyst' | 'casual';

// Who a line is written for.
export interface Audience {
  id: string;
  persona: Persona;
  language: string;
  favouriteClub?: string;
  favouritePlayer?: string;
  focusMetric?: MetricId;
}

export type MetricId = 'xg' | 'possession' | 'pressing' | 'passDifficulty' | 'shotSpeed' | 'topSpeed' | 'momentum';

export interface MetricReading {
  id: MetricId;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  t: number;
  home: number | null;
  away: number | null;
  leaders?: { name: string; team: string | null; value: number }[];
  chaos?: number;
}

// Where a line came from. "insight" is the Tactician's model-written line reused
// when the Narrator could not deliver; "+translator" means Azure Translator localised it.
export type LineSource = 'model' | 'insight' | 'template' | 'template+translator' | 'insight+translator';

export interface OverlaySpec {
  type: string;
  durationMs: number;
  position: 'lower_third' | 'top_bar' | 'side_panel' | 'pitch' | 'full_screen';
  showAt: number;
  data: Record<string, unknown>;
}

// One aired item: an explained, personalised, timed overlay for one audience.
export interface FeedItem {
  id: string;
  momentId: string;
  audience: string;
  t: number;
  clock: string;
  type: MomentType;
  team?: string | null;
  teamName?: string | null;
  player?: string | null;
  headline: string;
  text: string;
  tags?: string[];
  cites: string[];
  source: LineSource;
  overlay: OverlaySpec;
}

export type TraceStatus = 'selected' | 'skipped' | 'ok' | 'rejected' | 'error' | 'template' | 'overlay';

export interface TraceEntry {
  t: number;
  agent: string;
  momentId: string;
  status: TraceStatus;
  detail: string;
  ms: number;
}

// Live stream payloads (Server-Sent Events from /api/live).
export interface LiveEvent {
  id: string;
  t: number;
  clock: string;
  minute: number;
  period: number;
  type: EventType;
  team: string | null;
  player?: { id: string; name: string };
  recipient?: { id: string; name: string };
  target?: { id: string; name: string };
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  outcome?: string;
  xg?: number;
  distance?: number;
  difficulty?: number;
  speedKmh?: number;
  pressured?: boolean;
  score?: Score;
}

export interface LiveSnapshot extends Snapshot {
  topPlayers: { id: string; name: string; team: string | null; goals: number; xg: number; passesComplete: number; topSpeedKmh: number }[];
  favouritePlayer: PlayerView | null;
  metric: MetricReading | null;
}

export interface LiveMeta extends MatchMeta {
  audiences: Audience[];
  speed: number;
  eventCount: number;
}

export interface LiveEnd {
  items: number;
  statuses: Partial<Record<TraceStatus, number>>;
}

export interface AppConfig {
  fixtures: { seed: number; home: string; away: string }[];
  clubs: (Omit<Club, 'players' | 'style'> & { players: PlayerInfo[] })[];
  languages: string[];
  metrics: { id: MetricId; label: string }[];
  model: string | null;
  translator: boolean;
  speech: boolean;
  safety: boolean;
  build: string;
  synthetic: true;
}

// Anything that can answer a JSON prompt: a model client, the cache, a test double.
export interface ChatRequest {
  system: string;
  user: unknown;
  temperature?: number;
  maxTokens?: number;
}

export interface JsonModel {
  name?: string;
  usage?: { calls: number; promptTokens: number; completionTokens: number };
  json(request: ChatRequest): Promise<unknown>;
}

export interface TextTranslator {
  translate(texts: string[], language: string): Promise<string[]>;
}
