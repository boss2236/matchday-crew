// Azure AI Content Safety (text:analyze, REST, no SDK). The Safety agent screens
// every model-written line before it airs: hate, self-harm, sexual content and
// violence, each scored 0 (safe), 2, 4 or 6.
//
//   AZURE_CONTENT_SAFETY_ENDPOINT  e.g. https://my-safety.cognitiveservices.azure.com
//   AZURE_CONTENT_SAFETY_KEY       key from the resource ("Keys and Endpoint")
//   CONTENT_SAFETY_MAX_SEVERITY    highest severity allowed to air (default 2:
//                                  football talk of "attacks" and "shots" scores
//                                  low; anything at 4 or above is blocked)
import type { FetchLike } from './llm.ts';

export interface SafetyConfig {
  endpoint: string;
  key: string;
  maxSeverity: number;
}

export interface SafetyVerdict {
  ok: boolean;
  // Categories over the limit, e.g. ["Violence 4"].
  flagged: string[];
}

export function safetyConfigFromEnv(env: Record<string, string | undefined> = process.env): SafetyConfig | null {
  if (!env.AZURE_CONTENT_SAFETY_ENDPOINT || !env.AZURE_CONTENT_SAFETY_KEY) return null;
  const max = Number(env.CONTENT_SAFETY_MAX_SEVERITY);
  return {
    endpoint: env.AZURE_CONTENT_SAFETY_ENDPOINT.replace(/\/+$/, ''),
    key: env.AZURE_CONTENT_SAFETY_KEY,
    maxSeverity: Number.isFinite(max) && env.CONTENT_SAFETY_MAX_SEVERITY !== undefined ? max : 2,
  };
}

export interface ContentScreen {
  screen(text: string): Promise<SafetyVerdict>;
}

export class ContentSafety implements ContentScreen {
  config: SafetyConfig;
  fetch: FetchLike;
  memo: Map<string, SafetyVerdict>;
  usage: { calls: number; flagged: number };

  constructor(config: SafetyConfig, { fetchImpl = globalThis.fetch }: { fetchImpl?: FetchLike } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.memo = new Map();
    this.usage = { calls: 0, flagged: 0 };
  }

  // Replays of the same line are screened once per process (the free tier
  // allows 5,000 text records a month).
  async screen(text: string): Promise<SafetyVerdict> {
    const hit = this.memo.get(text);
    if (hit) return hit;
    const res = await this.fetch(`${this.config.endpoint}/contentsafety/text:analyze?api-version=2024-09-01`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Ocp-Apim-Subscription-Key': this.config.key },
      body: JSON.stringify({ text: text.slice(0, 1000), categories: ['Hate', 'SelfHarm', 'Sexual', 'Violence'], outputType: 'FourSeverityLevels' }),
    });
    if (!res.ok) throw new Error(`content safety ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { categoriesAnalysis?: { category: string; severity: number }[] };
    const flagged = (body.categoriesAnalysis ?? []).filter((c) => c.severity > this.config.maxSeverity).map((c) => `${c.category} ${c.severity}`);
    const verdict = { ok: flagged.length === 0, flagged };
    this.usage.calls += 1;
    if (!verdict.ok) this.usage.flagged += 1;
    this.memo.set(text, verdict);
    if (this.memo.size > 2000) this.memo.delete(this.memo.keys().next().value as string);
    return verdict;
  }
}
