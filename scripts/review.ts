// Independent review: a model from a different family re-checks lines the crew
// aired against the exact evidence the writer was given, and the report goes
// to docs/REVIEW.md. A second opinion on the fact checker, which is code.
//
//   LLM_PROVIDER=copilot node scripts/review.ts [lines] [model]
//
// lines: how many aired lines to review (default 120), spread evenly over the
// published fixtures and the languages below; model: the reviewer (default
// gpt-6.1-sol). Uses GitHub Copilot through the SDK (see src/ai/copilot.ts); each
// review is one prompt. Answers are kept in out/review/, so a rerun resumes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CachedChat } from '../src/ai/cache.ts';
import { CopilotChat } from '../src/ai/copilot.ts';
import { verify } from '../src/agents/evidence.ts';
import type { EvidencePack } from '../src/agents/evidence.ts';
import { FIXTURES } from '../src/live/fixtures.ts';
import { LiveSession, audiencesFor } from '../src/live/session.ts';
import { CLUBS } from '../src/engine/teams.ts';
import type { ChatRequest, JsonModel } from '../src/types.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const LANGUAGES = ['English', 'Arabic', 'Spanish', 'French', 'Hindi', 'Japanese'];
const want = Number(process.argv[2]) || 120;
const reviewerModel = process.argv[3] || 'gpt-6.1-sol';
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '–');

interface Line {
  key: string;
  match: string;
  language: string;
  persona: string;
  writer: string;
  request: ChatRequest;
  output: { headline?: string; text?: string; cites?: string[] };
}

// 1. Lines the crew would air today: replay the cache, keep answers that pass the
// fact checker, with the request (evidence pack, audience) they answered.
const lines: Line[] = [];
const seen = new Set<string>();
for (const f of FIXTURES) {
  for (const language of LANGUAGES) {
    const cache = new CachedChat(null);
    let session: LiveSession | null = null;
    const recorder: JsonModel = {
      name: 'cache',
      json: async (request: ChatRequest) => {
        const output = await cache.json(request);
        const user = request.user as { evidence: EvidencePack };
        const key = createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 16);
        if (session && !seen.has(key) && verify(output, user.evidence, session.crew.state).ok) {
          seen.add(key);
          // The Tactician writes once in English for everyone; Narrators and the Recap write per audience and language.
          const writer = /^You are the (\w+)/.exec(request.system)?.[1] ?? 'agent';
          const persona = /data-hungry analyst/.test(request.system) ? 'analyst' : /a casual fan/.test(request.system) ? 'casual' : 'insight (all)';
          lines.push({ key, match: `${CLUBS[f.home].short} v ${CLUBS[f.away].short}`, language: writer === 'Tactician' ? 'English' : language, persona, writer, request, output: output as Line['output'] });
        }
        return output;
      },
    };
    session = new LiveSession({ ...f, speed: 0, audiences: audiencesFor({ language }), llm: recorder });
    await session.run();
  }
}
// An even spread: every k-th line, so each match and language is represented.
const step = Math.max(1, Math.floor(lines.length / want));
const sample = lines.filter((_, i) => i % step === 0).slice(0, want);
console.log(`${lines.length} aired lines; reviewing ${sample.length} with ${reviewerModel}`);

// 2. The review.
interface Verdict {
  supported: boolean;
  unsupported: string[];
  clarity: number;
  audienceFit: boolean;
  note: string;
}
const SYSTEM = [
  'You are an independent fact checker for a football broadcast. A writer was given an evidence pack (JSON, from match data) and wrote one line of commentary.',
  'List every factual claim in the line that the evidence pack does not support: numbers, names, teams, events, outcomes, minutes. Paraphrase and rounding to one decimal are fine; opinions and colour ("a lovely ball") are not claims.',
  'Also rate clarity for the stated audience from 1 (confusing) to 5 (crystal clear), and say whether the tone fits that audience (analyst: precise, tactical; casual: plain, warm).',
  'Answer as JSON: {"supported": boolean, "unsupported": string[], "clarity": number, "audienceFit": boolean, "note": string (one short sentence, English)}.',
].join('\n');
const reviewer = new CopilotChat({ model: reviewerModel, timeoutMs: 120000 });
mkdirSync('out/review', { recursive: true });
const verdicts = new Map<string, Verdict>();
let next = 0, failed = 0;
async function worker() {
  while (next < sample.length) {
    const line = sample[next++] as Line;
    const file = `out/review/${reviewerModel}-${line.key}.json`;
    if (existsSync(file)) {
      verdicts.set(line.key, JSON.parse(readFileSync(file, 'utf8')) as Verdict);
      continue;
    }
    const user = line.request.user as Record<string, unknown>;
    try {
      const v = (await reviewer.json({
        system: SYSTEM,
        user: { audience: line.persona, language: line.language, evidence: user.evidence, ...(user.insight ? { insightTheWriterWasGiven: user.insight } : {}), line: { headline: line.output.headline, text: line.output.text, cites: line.output.cites } },
      })) as Verdict;
      verdicts.set(line.key, v);
      writeFileSync(file, JSON.stringify(v, null, 1));
      process.stdout.write('.');
    } catch (err) {
      failed++;
      console.error(`\n${line.key}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
}
try {
  await Promise.all([worker(), worker(), worker(), worker()]);
} finally {
  await reviewer.stop();
}

// 3. The report.
const done = sample.filter((l) => verdicts.has(l.key));
const v = (l: Line) => verdicts.get(l.key) as Verdict;
const supported = done.filter((l) => v(l).supported);
const fit = done.filter((l) => v(l).audienceFit);
const clarity = done.reduce((s, l) => s + (Number(v(l).clarity) || 0), 0) / Math.max(1, done.length);
const by = (field: 'language' | 'persona' | 'match') => {
  const groups = new Map<string, Line[]>();
  for (const l of done) groups.set(l[field], [...(groups.get(l[field]) ?? []), l]);
  return [...groups].map(([k, ls]) => `| ${k} | ${ls.length} | ${pct(ls.filter((l) => v(l).supported).length, ls.length)} | ${(ls.reduce((s, l) => s + (Number(v(l).clarity) || 0), 0) / ls.length).toFixed(1)} | ${pct(ls.filter((l) => v(l).audienceFit).length, ls.length)} |`);
};
const flagged = done.filter((l) => !v(l).supported);
const md = `# Independent review

A second model, from a different family than the writer, re-checked lines the crew airs against the exact evidence pack each writer was given. The crew's own fact checker is code (\`src/agents/evidence.ts\`): it checks every number, name and cited event, and rejects lines before they air. This review asks a model whether anything a line *says* goes beyond the evidence, which code cannot judge (an outcome implied, a claim in words rather than digits), and how clear the line is for its audience.

Generated by \`scripts/review.ts\` on ${new Date().toISOString().slice(0, 10)}. Reviewer: **${reviewerModel}** (GitHub Copilot, through the Copilot SDK). Lines: ${done.length} of ${lines.length} aired lines, an even spread over the ${FIXTURES.length} published fixtures and ${LANGUAGES.length} languages (${LANGUAGES.join(', ')}), replayed from the response cache. Narrator lines are also checked against the Tactician insight they were given, which itself passed the same checks.

## Results

| | |
|---|---|
| Lines reviewed | ${done.length}${failed ? ` (${failed} reviews failed and are not counted)` : ''} |
| Every claim supported by the evidence | **${pct(supported.length, done.length)}** (${supported.length}) |
| Average clarity for the audience (1-5) | **${clarity.toFixed(2)}** |
| Tone fits the audience | **${pct(fit.length, done.length)}** |

### By language

| Language | Lines | Supported | Clarity | Tone fits |
|---|---|---|---|---|
${by('language').join('\n')}

### By audience (insight: the Tactician's line, in English, shared by all audiences)

| Audience | Lines | Supported | Clarity | Tone fits |
|---|---|---|---|---|
${by('persona').join('\n')}

### By match

| Match | Lines | Supported | Clarity | Tone fits |
|---|---|---|---|---|
${by('match').join('\n')}

## Lines the reviewer flagged

${flagged.length ? flagged.map((l) => `- **${l.match}, ${l.language}, ${l.persona}** (${l.writer}): "${(l.output.headline ?? '').replace(/\|/g, '/')}"\n  - ${v(l).unsupported.map((c) => c.replace(/\n/g, ' ')).join('\n  - ') || v(l).note}`).join('\n') : 'None.'}

Flags are the reviewer's opinion, not ground truth: read each against its evidence pack before acting on it. What they point to is what the next version of the fact checker could learn to catch.

## Reproduce

\`\`\`bash
npm install @github/copilot-sdk     # once; the SDK is optional
LLM_PROVIDER=copilot node scripts/review.ts 120 gpt-6.1-sol
\`\`\`
`;
writeFileSync('docs/REVIEW.md', md);
writeFileSync('out/review.json', JSON.stringify({ reviewer: reviewerModel, lines: done.map((l) => ({ ...l, request: undefined, verdict: v(l) })) }, null, 1));
console.log(`\n${done.length} reviewed: ${pct(supported.length, done.length)} supported, clarity ${clarity.toFixed(2)}, tone fits ${pct(fit.length, done.length)}. docs/REVIEW.md written.`);
