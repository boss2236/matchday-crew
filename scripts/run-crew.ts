// Replay a synthetic match through the agent crew and print what airs.
//
//   node scripts/run-crew.ts [seed] [home] [away]
//
// Put FOUNDRY_ENDPOINT, FOUNDRY_DEPLOYMENT and FOUNDRY_API_KEY in a .env file
// (see .env.example) to use your Microsoft Foundry model, or LLM_MODEL for any
// OpenAI-compatible server such as a local Ollama. Without either the crew
// runs on deterministic templates.
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { simulateMatch } from '../src/engine/simulate.ts';
import { Crew } from '../src/agents/crew.ts';
import { ChatClient, llmConfigFromEnv } from '../src/ai/llm.ts';
import type { Audience } from '../src/types.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const seed = Number(process.argv[2] ?? 7);
const home = process.argv[3] ?? 'harbour';
const away = process.argv[4] ?? 'ironvale';
const languages = (process.env.CREW_LANGUAGES ?? 'English').split(',').map((s) => s.trim());

const config = llmConfigFromEnv();
const llm = config ? new ChatClient(config) : null;
console.log(config ? `Using ${config.label}` : 'No model configured, using templates');

const first = languages[0] || 'English';
const audiences: Audience[] = [
  { id: 'analyst', persona: 'analyst', language: first },
  { id: 'casual', persona: 'casual', language: languages[1] || first, ...(process.env.CREW_FAV_CLUB && { favouriteClub: process.env.CREW_FAV_CLUB }) },
];

const match = simulateMatch({ seed, home, away });
const crew = new Crew({ meta: match.meta, llm, audiences });
console.log(`${match.meta.home.name} vs ${match.meta.away.name} (seed ${seed})\n`);

for (const ev of match.events) {
  const items = await crew.onEvent(ev);
  for (const it of items) {
    console.log(`[${it.clock}] ${it.audience.padEnd(8)} ${it.overlay.type.padEnd(16)} ${it.headline}`);
    console.log(`           ${it.text}  (${it.source}, cites ${it.cites.join(',')})\n`);
  }
}

const statuses: Record<string, number> = {};
for (const r of crew.trace) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
console.log('Agent trace summary:', statuses);
if (llm) console.log('Model usage:', llm.usage);
mkdirSync('out', { recursive: true });
writeFileSync(`out/crew-${match.meta.matchId}.json`, JSON.stringify({ meta: match.meta, feed: crew.feed, trace: crew.trace }, null, 1));
console.log(`Saved feed and trace to out/crew-${match.meta.matchId}.json`);
