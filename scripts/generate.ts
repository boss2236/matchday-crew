// Generate synthetic matches as JSON files in data/.
// Usage: node scripts/generate.ts [count] [startSeed]
import { mkdirSync, writeFileSync } from 'node:fs';
import { simulateMatch } from '../src/engine/simulate.ts';
import { replay } from '../src/stats/matchState.ts';
import { CLUBS } from '../src/engine/teams.ts';

const count = Number(process.argv[2] ?? 1);
const start = Number(process.argv[3] ?? 7);
const clubIds = Object.keys(CLUBS);
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });

for (let i = 0; i < count; i++) {
  const seed = start + i;
  const home = clubIds[i % clubIds.length];
  const away = clubIds[(i + 1) % clubIds.length];
  const match = simulateMatch({ seed, home, away });
  const state = replay(match);
  const out = { ...match, summary: state.snapshot(), moments: state.moments };
  const file = new URL(`../data/${match.meta.matchId}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`${match.meta.matchId}: ${match.meta.home.name} ${match.score.home}-${match.score.away} ${match.meta.away.name}, ${match.events.length} events, ${state.moments.length} moments`);
}
