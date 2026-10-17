// Minimal chat client for models deployed in Microsoft Foundry (Azure OpenAI
// compatible endpoint). No SDK dependency: plain fetch.
//
// Config comes from environment variables:
//   FOUNDRY_ENDPOINT    e.g. https://my-resource.services.ai.azure.com
//                       or   https://my-resource.openai.azure.com
//                       (a project URL ending in /api/projects/<name> also works)
//   FOUNDRY_DEPLOYMENT  model deployment name, e.g. gpt-4o-mini
//   FOUNDRY_API_KEY     key from the Foundry project overview page
//   FOUNDRY_API_VERSION optional, defaults below

const DEFAULT_API_VERSION = '2024-10-21';

export function foundryConfigFromEnv(env = process.env) {
  const endpoint = env.FOUNDRY_ENDPOINT;
  const deployment = env.FOUNDRY_DEPLOYMENT;
  const apiKey = env.FOUNDRY_API_KEY;
  if (!endpoint || !deployment || !apiKey) return null;
  return { endpoint, deployment, apiKey, apiVersion: env.FOUNDRY_API_VERSION || DEFAULT_API_VERSION };
}

export function chatUrl({ endpoint, deployment, apiVersion = DEFAULT_API_VERSION }) {
  const origin = new URL(endpoint).origin;
  return `${origin}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${apiVersion}`;
}

export class FoundryChat {
  constructor(config, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.name = `foundry:${config.deployment}`;
    this.usage = { calls: 0, promptTokens: 0, completionTokens: 0 };
  }

  // Ask for a JSON object back. Returns the parsed object.
  async json({ system, user, temperature = 0.6, maxTokens = 500 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(chatUrl(this.config), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': this.config.apiKey },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) },
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Foundry ${res.status}: ${text.slice(0, 300)}`);
      }
      const body = await res.json();
      this.usage.calls += 1;
      this.usage.promptTokens += body.usage?.prompt_tokens ?? 0;
      this.usage.completionTokens += body.usage?.completion_tokens ?? 0;
      const content = body.choices?.[0]?.message?.content ?? '';
      return JSON.parse(content);
    } finally {
      clearTimeout(timer);
    }
  }
}
