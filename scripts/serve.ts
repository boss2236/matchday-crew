// Start the second-screen app.
//
//   npm start                      http://localhost:3000
//   PORT=8080 npm start
//
// Reads .env like the crew runner. Model calls go through the response cache
// in data/llm-cache/, so replays are instant and free. With no model
// configured the cache alone still serves lines a model wrote earlier, and
// anything else falls back to templates.
import { existsSync } from 'node:fs';
import { createApp } from '../src/server/app.ts';
import { ChatClient, llmConfigFromEnv } from '../src/ai/llm.ts';
import { CachedChat } from '../src/ai/cache.ts';
import { Translator, translatorConfigFromEnv } from '../src/ai/translator.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = llmConfigFromEnv();
const useCache = process.env.LLM_CACHE !== 'off';
const inner = config ? new ChatClient(config) : null;
const llm = useCache ? new CachedChat(inner, { write: process.env.LLM_CACHE !== 'read' }) : inner;
const translatorConfig = translatorConfigFromEnv();
const translator = translatorConfig ? new Translator(translatorConfig) : null;
const modelLabel = config ? config.label : useCache ? 'response cache only' : null;

const port = Number(process.env.PORT) || 3000;
createApp({ llm, translator, modelLabel }).listen(port, () => {
  console.log(`Matchday Crew on http://localhost:${port}`);
  console.log(`Model: ${modelLabel ?? 'none, templates only'}. Translator: ${translator ? 'Azure AI Translator' : 'off'}.`);
});
