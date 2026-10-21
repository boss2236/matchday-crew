// Check the GitHub Copilot provider with ONE prompt (it counts against your plan).
//
//   node scripts/copilot-check.ts            one test prompt, prints the JSON reply
//   node scripts/copilot-check.ts --models   list the models your plan offers (no prompt)
//
// Uses COPILOT_MODEL / COPILOT_GITHUB_TOKEN from .env if set, else your logged-in account.
import { existsSync } from 'node:fs';
import { CopilotChat, DEFAULT_COPILOT_MODEL } from '../src/ai/copilot.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const chat = new CopilotChat({
  model: process.env.COPILOT_MODEL || DEFAULT_COPILOT_MODEL,
  ...(process.env.COPILOT_GITHUB_TOKEN && { token: process.env.COPILOT_GITHUB_TOKEN }),
  timeoutMs: 90000,
});
try {
  if (process.argv.includes('--models')) {
    console.log(JSON.stringify(await chat.listModels(), null, 1));
  } else {
    const started = Date.now();
    const reply = await chat.json({
      system: 'You are the Narrator of an AI football broadcast crew. Write one line for a casual fan, using only numbers and names from the evidence. Answer as JSON: {"headline": string, "text": string, "cites": string[]}.',
      user: { moment: 'goal', clock: '29:03', team: 'Ironvale Athletic', scorer: 'Zeke Mbeki', assist: 'Luca Romero', xg: 0.188, shotSpeedKmh: 96.1, score: { home: 0, away: 1 }, events: ['e0612', 'e0613'] },
    });
    console.log(`model ${chat.config.model}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    console.log(JSON.stringify(reply, null, 1));
  }
} finally {
  await chat.stop();
}
