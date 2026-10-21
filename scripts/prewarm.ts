// Pre-generate model lines for the published fixtures, so the demo and the
// judges' link serve tailored AI output instantly and with no key. Also writes
// each run's agent trace to out/prewarm/ for the quality report.
//
//   node scripts/prewarm.ts                       all fixtures, English Arabic Spanish
//   node scripts/prewarm.ts 7,8 English,French    pick seeds and languages
//
// Uses the model from .env through the response cache: answers already cached
// cost nothing, so it is safe to rerun after an interruption.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { ChatClient, llmConfigFromEnv } from '../src/ai/llm.ts';
import { CachedChat } from '../src/ai/cache.ts';
import { CopilotChat, copilotConfigFromEnv } from '../src/ai/copilot.ts';
import { Translator, translatorConfigFromEnv } from '../src/ai/translator.ts';
import { FIXTURES } from '../src/live/fixtures.ts';
import { LiveSession, audiencesFor } from '../src/live/session.ts';
import type { FeedItem, TraceEntry } from '../src/types.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
// LLM_PROVIDER=copilot pre-generates with GitHub Copilot; otherwise Foundry or an
// OpenAI-compatible server.
const copilot = copilotConfigFromEnv();
const config = copilot ? null : llmConfigFromEnv();
const label = copilot ? `GitHub Copilot (${copilot.model})` : config?.label;
const model = copilot ? new CopilotChat(copilot) : config ? new ChatClient(config) : null;
if (!model) {
  console.error('No model configured in .env: nothing to pre-generate.');
  process.exit(1);
}
const seeds = process.argv[2] ? process.argv[2].split(',').map(Number) : FIXTURES.map((f) => f.seed);
const languages = process.argv[3] ? process.argv[3].split(',') : ['English', 'Arabic', 'Spanish'];
const translatorConfig = translatorConfigFromEnv();
const translator = translatorConfig ? new Translator(translatorConfig) : null;
mkdirSync('out/prewarm', { recursive: true });

for (const seed of seeds) {
  const fixture = FIXTURES.find((f) => f.seed === seed);
  if (!fixture) throw new Error(`seed ${seed} is not a published fixture`);
  for (const language of languages) {
    const llm = new CachedChat(model);
    const items: FeedItem[] = [];
    const trace: TraceEntry[] = [];
    const started = Date.now();
    await new LiveSession({
      ...fixture,
      speed: 0,
      audiences: audiencesFor({ language }),
      llm,
      translator,
      emit: (type, data) => {
        if (type === 'item') items.push(data as FeedItem);
        if (type === 'trace') trace.push(data as TraceEntry);
      },
    }).run();
    const sources: Record<string, number> = {};
    for (const i of items) sources[i.source] = (sources[i.source] ?? 0) + 1;
    const run = { ...fixture, language, model: label, seconds: Math.round((Date.now() - started) / 1000), cache: llm.stats, usage: llm.usage, sources, trace };
    writeFileSync(`out/prewarm/${seed}-${language}.json`, JSON.stringify(run, null, 1));
    console.log(`seed ${seed} ${language}: ${items.length} items ${JSON.stringify(sources)} cache ${JSON.stringify(llm.stats)} in ${run.seconds}s`);
  }
}

// The Copilot runtime is a child process: stop it so the script can exit.
if (model instanceof CopilotChat) await model.stop();
