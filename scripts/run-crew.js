// Replay a synthetic match through the agent crew and print what airs.
//
//   node scripts/run-crew.js [seed] [home] [away]
//
// Put FOUNDRY_ENDPOINT, FOUNDRY_DEPLOYMENT and FOUNDRY_API_KEY in a .env file
// (see .env.example) to use your Microsoft Foundry model. Without them the
// crew runs on deterministic templates.
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { simulateMatch } from '../src/engine/simulate.js';
import { Crew } from '../src/agents/crew.js';
import { FoundryChat, foundryConfigFromEnv } from '../src/ai/llm.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const seed = Number(process.argv[2] ?? 7);
const home = process.argv[3] ?? 'harbour';
const away = process.argv[4] ?? 'ironvale';
const languages = (process.env.CREW_LANGUAGES ?? 'English').split(',').map((s) => s.trim());

const config = foundryConfigFromEnv();
const llm = config ? new FoundryChat(config) : null;
console.log(llm ? `Using Microsoft Foundry deployment "${config.deployment}"` : 'No Foundry config found, using templates');

const audiences = [
  { id: 'analyst', persona: 'analyst', language: languages[0] },
  { id: 'casual', persona: 'casual', language: languages[1] ?? languages[0], favouriteClub: process.env.CREW_FAV_CLUB },
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

const statuses = crew.trace.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
console.log('Agent trace summary:', statuses);
if (llm) console.log('Model usage:', llm.usage);
mkdirSync('out', { recursive: true });
writeFileSync(`out/crew-${match.meta.matchId}.json`, JSON.stringify({ meta: match.meta, feed: crew.feed, trace: crew.trace }, null, 1));
console.log(`Saved feed and trace to out/crew-${match.meta.matchId}.json`);
