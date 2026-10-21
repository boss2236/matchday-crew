// Start the second-screen app.
//
//   npm start                      http://localhost:3000
//   PORT=8080 npm start
//
// Reads .env like the crew runner. Model calls go through the response cache
// in data/llm-cache/, so replays are instant and free. With no model
// configured the cache alone still serves lines a model wrote earlier, and
// anything else falls back to templates. Each Azure service and the
// Application Insights telemetry switch on when their settings are present.
import { existsSync } from 'node:fs';
import { createApp } from '../src/server/app.ts';
import { ChatClient, llmConfigFromEnv } from '../src/ai/llm.ts';
import { CachedChat } from '../src/ai/cache.ts';
import { CopilotChat, copilotConfigFromEnv } from '../src/ai/copilot.ts';
import { Translator, translatorConfigFromEnv } from '../src/ai/translator.ts';
import { Speech, speechConfigFromEnv } from '../src/ai/speech.ts';
import { ContentSafety, safetyConfigFromEnv } from '../src/ai/safety.ts';
import { AppInsights, noTelemetry, track } from '../src/telemetry.ts';
import type { Telemetry } from '../src/telemetry.ts';
import type { JsonModel } from '../src/types.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const telemetry: Telemetry = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ? new AppInsights(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) : noTelemetry;

// LLM_PROVIDER=copilot uses GitHub Copilot (src/ai/copilot.ts); otherwise Foundry or
// an OpenAI-compatible server (src/ai/llm.ts).
const copilot = copilotConfigFromEnv();
const config = copilot ? null : llmConfigFromEnv();
const label = copilot ? `GitHub Copilot (${copilot.model})` : (config?.label ?? null);
const useCache = process.env.LLM_CACHE !== 'off';
const inner: JsonModel | null = copilot ? new CopilotChat(copilot) : config ? new ChatClient(config) : null;
// Only real model calls are dependencies; cache hits never leave the process.
if (inner) {
  const json = inner.json.bind(inner);
  inner.json = (request) => track(telemetry, 'AI model', 'chat completion', label ?? 'model', () => json(request), { maxTokens: request.maxTokens });
}
const llm = useCache ? new CachedChat(inner, { write: process.env.LLM_CACHE !== 'read' }) : inner;

const translatorConfig = translatorConfigFromEnv();
const translator = translatorConfig ? new Translator(translatorConfig) : null;
if (translator) {
  const translate = translator.translate.bind(translator);
  translator.translate = (texts, language) => track(telemetry, 'Azure AI Translator', 'translate', 'api.cognitive.microsofttranslator.com', () => translate(texts, language), { language });
}

const speechConfig = speechConfigFromEnv();
const speech = speechConfig ? new Speech(speechConfig) : null;
if (speech) {
  const synthesize = speech.synthesize.bind(speech);
  speech.synthesize = (text, language) => track(telemetry, 'Azure AI Speech', 'text to speech', `${speechConfig?.region}.tts.speech.microsoft.com`, () => synthesize(text, language), { language });
}

const safetyConfig = safetyConfigFromEnv();
const safety = safetyConfig ? new ContentSafety(safetyConfig) : null;
if (safety) {
  const screen = safety.screen.bind(safety);
  safety.screen = (text) => track(telemetry, 'Azure AI Content Safety', 'text:analyze', safetyConfig?.endpoint ?? 'content safety', () => screen(text));
}

const modelLabel = label ?? (useCache ? 'response cache only' : null);
const port = Number(process.env.PORT) || 3000;
createApp({ llm, translator, speech, safety, telemetry, modelLabel }).listen(port, () => {
  console.log(`Nutmeg Desk on http://localhost:${port}`);
  console.log(
    `Model: ${modelLabel ?? 'none, templates only'}. Translator: ${translator ? 'Azure AI Translator' : 'off'}. Voice: ${speech ? 'Azure AI Speech' : 'browser'}. Safety: ${safety ? 'Azure AI Content Safety' : 'off'}. Telemetry: ${telemetry.enabled ? 'Application Insights' : 'off'}.`,
  );
});

// Container Apps stops replicas with SIGTERM: send what is buffered first.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void telemetry.flush().finally(() => process.exit(0));
  });
}
