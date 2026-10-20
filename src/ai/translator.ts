// Azure AI Translator client (Translator Text API v3). No SDK: plain fetch.
//
// The Narrator writes each audience's language directly when a model is
// available. When a line falls back to a template (no model, a rejected
// answer, a rate limit), the template is English. The Translator agent then
// localises it, so a fan who picked Arabic never gets an English line.
//
//   AZURE_TRANSLATOR_KEY       key from the Translator resource ("Keys and Endpoint")
//   AZURE_TRANSLATOR_REGION    the resource's region, e.g. westeurope (needed for
//                              regional and multi-service resources)
//   AZURE_TRANSLATOR_ENDPOINT  optional, defaults to the global endpoint

import type { TextTranslator } from '../types.ts';
import type { FetchLike } from './llm.ts';

const DEFAULT_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';

export interface TranslatorConfig {
  key: string;
  region: string | null;
  endpoint: string;
}

// Languages offered in the app, with their Translator codes.
export const LANGUAGES: Record<string, string> = {
  English: 'en',
  Arabic: 'ar',
  Spanish: 'es',
  French: 'fr',
  Portuguese: 'pt',
  German: 'de',
  Italian: 'it',
  Turkish: 'tr',
  Hindi: 'hi',
  Bengali: 'bn',
  Urdu: 'ur',
  Indonesian: 'id',
  Swahili: 'sw',
  Japanese: 'ja',
  Korean: 'ko',
  'Chinese (Simplified)': 'zh-Hans',
};

export function languageCode(language: string | null | undefined): string | null {
  if (!language) return 'en';
  if (LANGUAGES[language]) return LANGUAGES[language];
  const hit = Object.entries(LANGUAGES).find(([name, code]) => name.toLowerCase() === String(language).toLowerCase() || code === language);
  return hit ? hit[1] : null;
}

export function translatorConfigFromEnv(env: Record<string, string | undefined> = process.env): TranslatorConfig | null {
  const key = env.AZURE_TRANSLATOR_KEY;
  if (!key) return null;
  return { key, region: env.AZURE_TRANSLATOR_REGION || null, endpoint: (env.AZURE_TRANSLATOR_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, '') };
}

export class Translator implements TextTranslator {
  config: TranslatorConfig;
  fetch: FetchLike;
  timeoutMs: number;
  usage: { calls: number; characters: number };
  memo: Map<string, string[]>;

  constructor(config: TranslatorConfig, { fetchImpl = globalThis.fetch, timeoutMs = 10000 }: { fetchImpl?: FetchLike; timeoutMs?: number } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.usage = { calls: 0, characters: 0 };
    this.memo = new Map();
  }

  // Translate several strings from English into one language. Returns strings in order.
  async translate(texts: string[], language: string): Promise<string[]> {
    const to = languageCode(language);
    if (!to) throw new Error(`unsupported language: ${language}`);
    if (to === 'en') return texts;
    const key = `${to}\u0000${texts.join('\u0001')}`;
    const memo = this.memo.get(key);
    if (memo) return memo;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json', 'Ocp-Apim-Subscription-Key': this.config.key };
      if (this.config.region) headers['Ocp-Apim-Subscription-Region'] = this.config.region;
      const res = await this.fetch(`${this.config.endpoint}/translate?api-version=3.0&from=en&to=${encodeURIComponent(to)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(texts.map((Text) => ({ Text }))),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`translator ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const body = (await res.json()) as { translations?: { text?: string }[] }[];
      const out = body.map((r) => r.translations?.[0]?.text ?? '');
      this.usage.calls += 1;
      this.usage.characters += texts.reduce((n, t) => n + t.length, 0);
      this.memo.set(key, out);
      return out;
    } finally {
      clearTimeout(timer);
    }
  }
}
