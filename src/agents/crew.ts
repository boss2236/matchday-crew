// The Nutmeg Desk crew: a small team of agents that cover a live match the way
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
//   Translator (Azure)  localises any line that fell back to an English template,
//                       so every audience gets its own language either way
//
// With no model configured, every model step falls back to templates, so the
// app still works offline and in tests.

import { MatchState } from '../stats/matchState.ts';
import { buildEvidence, verify, teamName } from './evidence.ts';
import type { EvidencePack, PackMoment } from './evidence.ts';
import { templateInsight, templateRecap } from './templates.ts';
import type { Line } from './templates.ts';
import type { Audience, ChatRequest, FeedItem, JsonModel, LineSource, MatchEvent, MatchMeta, Moment, MomentType, OverlaySpec, Persona, TextTranslator, TraceEntry, TraceStatus } from '../types.ts';
import { languageCode } from '../ai/translator.ts';
import { CacheMissError } from '../ai/cache.ts';
import { METRICS, readMetric } from '../stats/metrics.ts';

// A line plus where it came from.
export type SourcedLine = Line & { source: LineSource };

export const DEFAULT_AUDIENCES: Audience[] = [
  { id: 'analyst-en', persona: 'analyst', language: 'English' },
  { id: 'casual-en', persona: 'casual', language: 'English' },
];

const PERSONAS: Record<Persona, string> = {
  analyst:
    'a data-hungry analyst. Use precise football and tactical language and quote the key numbers (xG, distances, pass difficulty, PPDA, momentum).',
  casual:
    'a casual fan. Use plain, warm, exciting language, no jargon, at most one number, and explain things like you would to a friend on the sofa.',
};

const CITE_RULE = 'Cite only event ids from the evidence "events" list (they look like e0123). Moment ids (m012) are not events.';

const OVERLAY_BY_TYPE: Partial<Record<MomentType, Omit<OverlaySpec, 'showAt' | 'data'>>> = {
  goal: { type: 'goal_card', durationMs: 9000, position: 'lower_third' },
  big_chance: { type: 'chance_card', durationMs: 7000, position: 'lower_third' },
  pressing_spell: { type: 'pressing_heatmap', durationMs: 8000, position: 'side_panel' },
  momentum_swing: { type: 'momentum_bar', durationMs: 8000, position: 'top_bar' },
  great_pass: { type: 'pass_trail', durationMs: 6000, position: 'pitch' },
  sprint: { type: 'player_tag', durationMs: 5000, position: 'pitch' },
  half_time: { type: 'score_summary', durationMs: 12000, position: 'full_screen' },
  full_time: { type: 'score_summary', durationMs: 15000, position: 'full_screen' },
};

export interface CrewOptions {
  meta: MatchMeta;
  llm?: JsonModel | null;
  translator?: TextTranslator | null;
  audiences?: Audience[];
  minGapSeconds?: number;
  onLog?: ((entry: TraceEntry) => void) | null;
}

export class Crew {
  state: MatchState;
  llm: JsonModel | null;
  translator: TextTranslator | null;
  onLog: ((entry: TraceEntry) => void) | null;
  audiences: Audience[];
  minGapSeconds: number;
  eventsById: Map<string, MatchEvent>;
  feed: FeedItem[];
  trace: TraceEntry[];
  covered: EvidencePack[];
  lastFeatureT: number;

  constructor({ meta, llm = null, translator = null, audiences = DEFAULT_AUDIENCES, minGapSeconds = 90, onLog = null }: CrewOptions) {
    this.state = new MatchState(meta);
    this.llm = llm;
    this.translator = translator;
    this.onLog = onLog;
    this.audiences = audiences;
    this.minGapSeconds = minGapSeconds;
    this.eventsById = new Map();
    this.feed = [];
    this.trace = [];
    this.covered = [];
    this.lastFeatureT = -Infinity;
  }

  // Feed one live event. Resolves with the feed items it produced.
  async onEvent(ev: MatchEvent): Promise<FeedItem[]> {
    this.eventsById.set(ev.id, ev);
    const moments = this.state.apply(ev);
    const out: FeedItem[] = [];
    for (const moment of moments) {
      if (!this.analystSelects(moment)) continue;
      out.push(...(await this.cover(moment)));
    }
    if (ev.type === 'full_time') out.push(...(await this.recap()));
    this.feed.push(...out);
    return out;
  }

  // Analyst: decide whether a moment is worth airing now.
  analystSelects(moment: Moment): boolean {
    const always: MomentType[] = ['goal', 'half_time', 'full_time'];
    const playerFocus = this.audiences.some((a) => a.favouritePlayer && moment.player && this.playerMatches(a.favouritePlayer, moment.player));
    const metricFocus = this.audiences.some((a) => a.focusMetric && METRICS[a.focusMetric].momentTypes.includes(moment.type));
    let selected = false;
    let reason = 'below threshold';
    if (always.includes(moment.type)) {
      selected = true;
      reason = 'always cover';
    } else if (playerFocus && ['great_pass', 'sprint', 'big_chance'].includes(moment.type)) {
      selected = true;
      reason = 'favourite player involved';
    } else if (metricFocus && moment.t - this.lastFeatureT >= 30) {
      selected = true;
      reason = 'followed metric';
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

  playerMatches(fav: string, playerId: string): boolean {
    return fav === playerId || this.state.playerName(playerId) === fav;
  }

  async cover(moment: Moment): Promise<FeedItem[]> {
    const pack = buildEvidence(moment, this.state, this.eventsById);
    this.covered.push(pack);
    const insight = await this.tactician(pack);
    const items: FeedItem[] = [];
    for (const audience of this.audiences) {
      const line = await this.narrator(pack, insight, audience);
      items.push(this.producer(moment, pack, insight, line, audience));
    }
    return items;
  }

  // Tactician: why does this moment matter?
  async tactician(pack: EvidencePack): Promise<SourcedLine> {
    const system = [
      'You are the Tactician in a football broadcast crew covering a synthetic match between fictional clubs.',
      'Explain WHY the moment in the evidence pack matters: the tactical pattern, the momentum, control vs chaos, the pressure, the game state.',
      'Rules: use ONLY facts and numbers present in the evidence pack. Never invent players, numbers or events.',
      'Every number you write must appear in the evidence pack exactly. Name only players who appear in the pack.',
      CITE_RULE,
      'Reply as JSON: {"headline": string (max 8 words), "text": string (1-2 sentences, max 45 words), "tags": string[] (1-3 of: pressing, counter, possession, momentum, chaos, control, finishing, chance, pass, speed, set-back), "cites": string[] (event ids from the pack that support your claim)}.',
    ].join('\n');
    return this.callVerified('Tactician', pack, { system, user: { evidence: pack } }, () => templateInsight(pack));
  }

  // Narrator: the same insight, shaped for one audience.
  async narrator(pack: EvidencePack, insight: SourcedLine, audience: Audience): Promise<SourcedLine> {
    // Only metric-following audiences get a different prompt, so cached answers
    // for everyone else stay valid.
    const fav: string[] = [];
    if (audience.favouriteClub) fav.push(`Their favourite club is ${audience.favouriteClub}; speak from that fan's point of view.`);
    if (audience.favouritePlayer) fav.push(`Their favourite player is ${audience.favouritePlayer}; mention them if they are in the evidence pack.`);
    const followed = this.followedMetric(audience);
    if (followed) {
      fav.push(`They follow one metric above all: ${followed.label}. Lead with it, using the live values in "followedMetric" or the matching numbers in the pack.`);
      pack = { ...pack, followedMetric: followed };
    }
    const system = [
      'You are the Narrator in a football broadcast crew covering a synthetic match between fictional clubs.',
      `Write one on-screen commentary line for ${PERSONAS[audience.persona] ?? PERSONAS.casual}`,
      `Write in ${audience.language}. Keep player and club names exactly as given.`,
      ...fav,
      'Base it on the Tactician insight and the evidence pack. Use ONLY facts and numbers from them; write numbers with digits exactly as they appear.',
      CITE_RULE,
      'Reply as JSON: {"headline": string (max 8 words), "text": string (max 35 words), "cites": string[] (event ids from the pack)}.',
    ].join('\n');
    // Falling back to the Tactician's line: it already passed the same check.
    // If a model wrote it, it is labelled "insight" (model-written, not tailored).
    const fallback = (): SourcedLine => ({ headline: insight.headline, text: insight.text, cites: insight.cites, source: insight.source === 'model' ? 'insight' : 'template' });
    const line = await this.callVerified(`Narrator/${audience.id}`, pack, { system, user: { insight, evidence: pack } }, fallback);
    return this.localize(line, audience, pack);
  }

  // Producer: timed, machine-readable overlay for the rendering layer.
  producer(moment: Moment, pack: EvidencePack, insight: SourcedLine, line: SourcedLine, audience: Audience): FeedItem {
    const overlay = OVERLAY_BY_TYPE[moment.type] ?? { type: 'info_card', durationMs: 6000, position: 'lower_third' };
    const item: FeedItem = {
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
      text: tidy(line.text),
      tags: Array.isArray(insight.tags) ? insight.tags : [],
      cites: line.cites,
      source: line.source,
      overlay: { ...overlay, showAt: moment.t, data: overlayData(moment, pack) },
    };
    this.log('Producer', moment.id, 'overlay', `${overlay.type} for ${audience.id}`);
    return item;
  }

  async recap(): Promise<FeedItem[]> {
    const fullTime = this.covered.find((p) => p.moment.type === 'full_time');
    const placeholder: Moment = { id: 'ft', type: 'full_time', t: this.state.t, clock: 'FT', minute: 90, team: null, player: null, importance: 0, evidence: [], data: {} };
    const match = fullTime?.match ?? buildEvidence(placeholder, this.state, this.eventsById).match;
    const recapTypes: MomentType[] = ['goal', 'big_chance', 'pressing_spell', 'momentum_swing'];
    const packs = this.covered.filter((p) => recapTypes.includes(p.moment.type));
    // Keep the recap prompt small: free tiers cap request size. Goals keep their
    // last few events, other moments only the one that decided them.
    const recapPack: EvidencePack = {
      moment: { id: 'recap', type: 'recap', data: {} },
      events: [...packs.flatMap((p) => p.events.slice(p.moment.type === 'goal' ? -3 : -1)), ...(fullTime?.events ?? []).slice(-1)],
      match,
      keyMoments: packs.map(({ moment: { id, type, clock, minute, team, player, data } }): PackMoment => ({ id, type, clock, minute, team, player, data })),
      topPlayers: this.state.topPlayers(3).map((p) => ({ name: p.name, team: p.team ? teamName(this.state, p.team) : '', goals: p.goals, xg: p.xg, passesComplete: p.passesComplete })),
    };
    const items: FeedItem[] = [];
    for (const audience of this.audiences) {
      const followed = this.followedMetric(audience);
      const system = [
        'You are the Recap writer in a football broadcast crew covering a synthetic match between fictional clubs.',
        `Write the full-time recap for ${PERSONAS[audience.persona] ?? PERSONAS.casual}`,
        `Write in ${audience.language}. Keep player and club names exactly as given.`,
        audience.favouriteClub ? `Their favourite club is ${audience.favouriteClub}.` : '',
        audience.favouritePlayer ? `Their favourite player is ${audience.favouritePlayer}.` : '',
        followed ? `They follow one metric above all: ${followed.label}. Give it a sentence, using "followedMetric".` : '',
        'Tell the story of the match in order: how it started, the turning points, how it ended, and the standout player. Explain why the result happened.',
        'Use ONLY facts and numbers from the evidence; write numbers with digits exactly as they appear.',
        CITE_RULE,
        'Reply as JSON: {"headline": string (max 10 words), "text": string (80-130 words), "cites": string[] (event ids)}.',
      ].filter(Boolean).join('\n');
      const pack: EvidencePack = followed ? { ...recapPack, followedMetric: followed } : recapPack;
      const raw = await this.callVerified(`Recap/${audience.id}`, pack, { system, user: { evidence: pack }, maxTokens: 700 }, () => templateRecap(packs, match));
      const out = await this.localize(raw, audience, pack);
      items.push({
        id: `recap-${audience.id}`,
        momentId: 'recap',
        audience: audience.id,
        t: this.state.t,
        clock: 'FT',
        type: 'recap',
        headline: out.headline,
        text: tidy(out.text),
        cites: out.cites,
        source: out.source,
        overlay: { type: 'recap_panel', position: 'full_screen', durationMs: 20000, showAt: this.state.t, data: { score: match.score } },
      });
    }
    return items;
  }

  // Live values of the metric this audience follows, named by team, or null.
  followedMetric(audience: Audience): ({ label: string } & Record<string, unknown>) | null {
    const m = audience.focusMetric ? readMetric(audience.focusMetric, this.state.snapshot(), this.state) : null;
    if (!m) return null;
    const out: { label: string } & Record<string, unknown> = { label: m.label, unit: m.unit, [this.state.meta.home.name]: m.home, [this.state.meta.away.name]: m.away };
    if (m.leaders) out.leaders = m.leaders.map(({ name, value }) => ({ name, value }));
    if (m.chaos !== undefined) out.chaos = m.chaos;
    return out;
  }

  // Translator: a template line is English. Localise it for audiences that asked
  // for another language, and keep it only if the translation still verifies.
  async localize(line: SourcedLine, audience: Audience, pack: EvidencePack): Promise<SourcedLine> {
    const code = languageCode(audience.language);
    if ((line.source !== 'template' && line.source !== 'insight') || !this.translator || !code || code === 'en') return line;
    const started = Date.now();
    try {
      const [headline = line.headline, text = line.text] = await this.translator.translate([line.headline, line.text], audience.language);
      const translated: SourcedLine = { ...line, headline, text, source: `${line.source}+translator` };
      const check = verify(translated, pack, this.state);
      if (!check.ok) {
        this.log('Translator', pack.moment.id, 'rejected', check.problems.join('; '), Date.now() - started);
        return line;
      }
      this.log('Translator', pack.moment.id, 'ok', `to ${audience.language}`, Date.now() - started);
      return translated;
    } catch (err) {
      this.log('Translator', pack.moment.id, 'error', errorMessage(err), Date.now() - started);
      return line;
    }
  }

  // Call the model, verify, retry once with the problems, else fall back.
  async callVerified(agent: string, pack: EvidencePack, request: ChatRequest, fallback: () => Line & { source?: LineSource }): Promise<SourcedLine> {
    const fallen = (): SourcedLine => ({ source: 'template', ...fallback() });
    if (!this.llm) {
      const out = fallen();
      this.log(agent, pack.moment.id, 'template', 'no model configured');
      return out;
    }
    let feedback: string[] | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      try {
        const user = feedback ? { ...(request.user as object), previousAttemptRejected: feedback } : request.user;
        const out = await this.llm.json({ ...request, user });
        const check = verify(out, pack, this.state);
        if (check.ok) {
          this.log(agent, pack.moment.id, 'ok', `attempt ${attempt}`, Date.now() - started);
          return asLine(out, fallback);
        }
        feedback = check.problems;
        this.log(agent, pack.moment.id, 'rejected', check.problems.join('; '), Date.now() - started);
      } catch (err) {
        if (err instanceof CacheMissError) {
          this.log(agent, pack.moment.id, 'template', 'no cached answer');
          return fallen();
        }
        feedback = [`error: ${errorMessage(err)}`];
        this.log(agent, pack.moment.id, 'error', errorMessage(err), Date.now() - started);
      }
    }
    this.log(agent, pack.moment.id, 'template', 'fell back after 2 attempts');
    return fallen();
  }

  log(agent: string, momentId: string, status: TraceStatus, detail: string, ms = 0) {
    const entry: TraceEntry = { t: this.state.t, agent, momentId, status, detail, ms };
    this.trace.push(entry);
    this.onLog?.(entry);
  }
}

// Models sometimes put the event ids they cite into the prose. The ids stay in
// "cites"; the on-screen text should not show them.
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// A verified model answer as a line. The verifier already checked text and
// cites. Field order is kept as the model wrote it: this object goes into the
// Narrator's prompt, and the response cache keys on the exact prompt.
function asLine(out: unknown, fallback: () => Line): SourcedLine {
  const line = { ...(out as object), source: 'model' } as SourcedLine;
  if (typeof line.headline !== 'string' || !line.headline.trim()) line.headline = fallback().headline;
  return line;
}

export function tidy(text: unknown): string {
  return String(text)
    .replace(/\s*[([][^()[\]]*\be\d{4}\b[^()[\]]*[)\]]/gi, '')
    .replace(/\s*\be\d{4}\b(?:\s*(?:,|and|&|-|–)\s*\be\d{4}\b)*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?،؛])/g, '$1')
    .trim();
}

function overlayData(moment: Moment, pack: EvidencePack): Record<string, unknown> {
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
