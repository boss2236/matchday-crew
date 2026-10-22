// Quality report: how often the crew airs model-written lines, how the live
// model behaved, and whether the fact checker catches tampered lines.
//
//   node scripts/quality.ts            writes docs/QUALITY.md and out/quality.json
//
// Needs no key: (1) and (3) replay the response cache; (2) reads the traces that
// scripts/prewarm.ts saved in out/prewarm/.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CachedChat } from '../src/ai/cache.ts';
import { verify } from '../src/agents/evidence.ts';
import type { EvidencePack } from '../src/agents/evidence.ts';
import { FIXTURES } from '../src/live/fixtures.ts';
import { LiveSession, audiencesFor } from '../src/live/session.ts';
import { CLUBS } from '../src/engine/teams.ts';
import { LANGUAGES as APP_LANGUAGES } from '../src/ai/translator.ts';
import type { ChatRequest, FeedItem, JsonModel, TraceEntry } from '../src/types.ts';
import type { MatchState } from '../src/stats/matchState.ts';

// Every language the app offers: the shipped cache covers all of them.
const LANGUAGES = Object.keys(APP_LANGUAGES);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '–');

// 1. What a visitor with no key sees, per published fixture and language.
interface Sample {
  output: unknown;
  pack: EvidencePack;
  state: MatchState;
}
const replay: { match: string; language: string; items: number; model: number; insight: number; sources: Record<string, number> }[] = [];
const samples: Sample[] = [];

for (const f of FIXTURES) {
  for (const language of LANGUAGES) {
    const cache = new CachedChat(null);
    let session: LiveSession | null = null;
    // Record accepted cached answers with their evidence for the tamper test.
    const recorder: JsonModel = {
      name: 'cache',
      json: async (request: ChatRequest) => {
        const output = await cache.json(request);
        const pack = (request.user as { evidence: EvidencePack }).evidence;
        if (session && verify(output, pack, session.crew.state).ok) samples.push({ output, pack, state: session.crew.state });
        return output;
      },
    };
    const items: FeedItem[] = [];
    session = new LiveSession({ ...f, speed: 0, audiences: audiencesFor({ language }), llm: recorder, emit: (t, d) => t === 'item' && items.push(d as FeedItem) });
    await session.run();
    const sources: Record<string, number> = {};
    for (const i of items) sources[i.source] = (sources[i.source] ?? 0) + 1;
    const model = sources.model ?? 0;
    const insight = (sources.insight ?? 0) + (sources['insight+translator'] ?? 0);
    replay.push({ match: `${CLUBS[f.home].short} v ${CLUBS[f.away].short} (seed ${f.seed})`, language, items: items.length, model, insight, sources });
  }
}

// 2. Live model behaviour, from the traces scripts/prewarm.ts saved.
interface Run {
  seed: number;
  language: string;
  model: string;
  trace: TraceEntry[];
}
const runs: Run[] = existsSync('out/prewarm')
  ? readdirSync('out/prewarm')
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(`out/prewarm/${f}`, 'utf8')) as Run)
  : [];
// Entries slower than 50 ms went to the model; faster ones were cache hits.
const live = runs.flatMap((r) => r.trace.filter((t) => ['ok', 'rejected', 'error'].includes(t.status) && t.ms >= 50 && t.agent !== 'Translator'));
const firstTry = live.filter((t) => t.status === 'ok' && t.detail === 'attempt 1').length;
const secondTry = live.filter((t) => t.status === 'ok' && t.detail === 'attempt 2').length;
const rejected = live.filter((t) => t.status === 'rejected');
const errors = live.filter((t) => t.status === 'error');
const reasonOf = (d: string) =>
  /km should be metres/.test(d) ? 'wrong unit (km for metres)' : /yards should be metres/.test(d) ? 'wrong unit (yards for metres)' : /^number/.test(d) ? 'number not in the evidence' : /^cited event/.test(d) ? 'cited an event not in the evidence' : /^player/.test(d) ? 'player not in the evidence' : /missing|no cited/.test(d) ? 'missing text or citations' : 'other';
const reasons: Record<string, number> = {};
for (const r of rejected) for (const p of r.detail.split('; ')) reasons[reasonOf(p)] = (reasons[reasonOf(p)] ?? 0) + 1;
const errorKinds: Record<string, number> = {};
for (const e of errors) {
  const k = /429/.test(e.detail) ? 'rate limited (429)' : /413/.test(e.detail) ? 'request too large (413)' : /fetch failed|timeout|abort/i.test(e.detail) ? 'network or timeout' : 'other';
  errorKinds[k] = (errorKinds[k] ?? 0) + 1;
}
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.min(s.length - 1, Math.floor(q * s.length))] as number) : 0;
};
const latency: Record<string, { calls: number; p50: number; p95: number }> = {};
for (const agent of ['Tactician', 'Narrator', 'Recap']) {
  const ms = live.filter((t) => t.agent.startsWith(agent) && t.status === 'ok').map((t) => t.ms);
  latency[agent] = { calls: ms.length, p50: quantile(ms, 0.5), p95: quantile(ms, 0.95) };
}

// 3. Tamper test: corrupt accepted model lines and check the verifier rejects them.
const allNames = Object.values(CLUBS).flatMap((c) => c.players.map((p) => p.name));
const tamper: Record<string, (o: Record<string, unknown>, pack: EvidencePack) => Record<string, unknown> | null> = {
  'shifted number': (o) => {
    const text = String(o.text);
    const m = text.match(/\d+(?:\.\d+)?/);
    return m ? { ...o, text: text.replace(m[0], String(Number(m[0]) + 7.3)) } : null;
  },
  'shifted whole number': (o) => {
    const text = String(o.text);
    const m = text.match(/\b\d{2,}\b(?![.,]\d)/);
    return m ? { ...o, text: text.replace(m[0], String(Number(m[0]) + 3)) } : null;
  },
  'invented number': (o) => ({ ...o, text: `${o.text} A record 487 km/h.` }),
  'metres written as km': (o) => {
    const text = String(o.text);
    return / m\b|\dm\b/.test(text) ? { ...o, text: text.replace(/(\d+(?:\.\d+)?)\s?m\b/, '$1 km') } : null;
  },
  'player not in the evidence': (o, pack) => {
    const outsider = allNames.find((n) => !JSON.stringify(pack).includes(n));
    return outsider ? { ...o, text: `${o.text} ${outsider} was involved too.` } : null;
  },
  'fake cited event': (o) => ({ ...o, cites: [...((o.cites as string[]) ?? []), 'e9999'] }),
  'no citations': (o) => ({ ...o, cites: [] }),
};
const tamperResults: Record<string, { tried: number; caught: number }> = {};
for (const [name, fn] of Object.entries(tamper)) {
  let tried = 0;
  let caught = 0;
  for (const s of samples) {
    const bad = fn(s.output as Record<string, unknown>, s.pack);
    if (!bad) continue;
    tried += 1;
    if (!verify(bad, s.pack, s.state).ok) caught += 1;
  }
  tamperResults[name] = { tried, caught };
}

// Report.
const totalItems = replay.reduce((n, r) => n + r.items, 0);
const totalModel = replay.reduce((n, r) => n + r.model, 0);
const lines: string[] = [];
lines.push('# Quality report', '', `Generated by \`npm run quality\` on ${new Date().toISOString().slice(0, 10)}. All matches are synthetic.`, '');
lines.push(
  '## 1. What a visitor sees with no API key',
  '',
  'Each published match replayed from the response cache, for analyst and casual fan. **Narrator, in language**: written by the model for that audience in that language and passed by the fact checker. **Tactician line**: the Tactician\'s model-written line reused when no tailored line is cached; it is in English, and Azure AI Translator localises it when configured (as on the hosted app). **Template**: deterministic fallback built only from match data.',
  '',
);
lines.push('| Match | Language | Lines aired | Narrator, in language | Tactician line | Template |', '|---|---|---|---|---|---|');
for (const r of replay) lines.push(`| ${r.match} | ${r.language} | ${r.items} | ${r.model} (${pct(r.model, r.items)}) | ${r.insight} | ${r.items - r.model - r.insight} |`);
const totalInsight = replay.reduce((n, r) => n + r.insight, 0);
lines.push(`| **All** | | **${totalItems}** | **${totalModel} (${pct(totalModel, totalItems)})** | **${totalInsight}** | **${totalItems - totalModel - totalInsight}** |`, '');
lines.push('Matches and languages not yet pre-generated are filled live when a model key is configured (`npm run prewarm`).', '');
lines.push('## 2. Live model behaviour', '');
if (live.length) {
  const models = [...new Set(runs.map((r) => r.model))].join(', ');
  lines.push(`From ${runs.length} pre-generation run(s) on ${models}, ${live.length} live model calls.`, '');
  lines.push('| Measure | Value |', '|---|---|');
  lines.push(`| Accepted on the first attempt | ${firstTry} |`);
  lines.push(`| Accepted after one retry with the checker's feedback | ${secondTry} |`);
  lines.push(`| Rejected by the fact checker | ${rejected.length} |`);
  lines.push(`| Transport errors (retried or fell back) | ${errors.length} |`, '');
  if (rejected.length) {
    lines.push('Why lines were rejected:', '', '| Reason | Count |', '|---|---|');
    for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${v} |`);
    lines.push('');
  }
  if (errors.length) {
    lines.push('| Error | Count |', '|---|---|');
    for (const [k, v] of Object.entries(errorKinds)) lines.push(`| ${k} | ${v} |`);
    lines.push('');
  }
  lines.push('Latency of accepted model calls:', '', '| Agent | Calls | p50 | p95 |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(latency)) lines.push(`| ${k} | ${v.calls} | ${(v.p50 / 1000).toFixed(1)} s | ${(v.p95 / 1000).toFixed(1)} s |`);
  lines.push('');
} else {
  lines.push('No live runs recorded yet. Run `npm run prewarm` with a model configured.', '');
}
lines.push('## 3. Fact checker tamper test', '', `Every accepted model line (${samples.length}) was corrupted in each way below and run back through the verifier. A caught line would never air.`, '');
lines.push('| Corruption | Lines tried | Caught |', '|---|---|---|');
for (const [k, v] of Object.entries(tamperResults)) lines.push(`| ${k} | ${v.tried} | ${v.caught} (${pct(v.caught, v.tried)}) |`);
lines.push('', 'Known limit: the checker verifies numbers, units of distance, player names and cited events. It does not judge tone or whether a claim about cause is fair.', '');

mkdirSync('out', { recursive: true });
writeFileSync('out/quality.json', JSON.stringify({ replay, live: { calls: live.length, firstTry, secondTry, rejected: rejected.length, errors: errors.length, reasons, errorKinds, latency }, tamper: tamperResults, samples: samples.length }, null, 1));
writeFileSync('docs/QUALITY.md', lines.join('\n'));
console.log(lines.join('\n'));
