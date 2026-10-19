// Minimal chat client for the crew's model steps. No SDK dependency: plain fetch.
// Two providers speak the same OpenAI chat-completions schema, so the crew does
// not care which one is behind it:
//
//   foundry  Models deployed in Microsoft Foundry (Azure OpenAI compatible).
//     FOUNDRY_ENDPOINT    e.g. https://my-resource.services.ai.azure.com
//                         or   https://my-resource.openai.azure.com
//                         (a project URL ending in /api/projects/<name> also works)
//     FOUNDRY_DEPLOYMENT  model deployment name, e.g. gpt-4o-mini
//     FOUNDRY_API_KEY     key from the Foundry project overview page
//     FOUNDRY_API_VERSION optional, defaults below
//
//   openai   Any OpenAI-compatible server: a local Ollama, Groq, Gemini, etc.
//     LLM_BASE_URL        e.g. http://localhost:11434/v1 (Ollama, the default)
//     LLM_MODEL           e.g. phi4-mini
//     LLM_API_KEY         optional, local servers need none
//     LLM_REASONING_EFFORT optional, e.g. low, for reasoning models like gpt-oss
//     LLM_MAX_TOKENS      optional floor for max_tokens; reasoning models spend
//                         tokens thinking before they write the JSON
//
// Either provider: LLM_TIMEOUT_MS per attempt, LLM_RETRIES for rate limits (429)
// and overloads (503), waiting as long as the server asks.
//
// LLM_PROVIDER picks one explicitly. Without it, Foundry wins when configured,
// then the OpenAI-compatible provider when LLM_MODEL is set.

const DEFAULT_API_VERSION = '2024-10-21';
const DEFAULT_BASE_URL = 'http://localhost:11434/v1';

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

// Resolve env into what a request needs: url, headers, extra body fields and a label.
export function llmConfigFromEnv(env = process.env) {
  const provider = env.LLM_PROVIDER || (foundryConfigFromEnv(env) ? 'foundry' : env.LLM_MODEL ? 'openai' : null);
  if (provider === 'foundry') {
    const foundry = foundryConfigFromEnv(env);
    if (!foundry) return null;
    return {
      provider,
      label: `Microsoft Foundry deployment "${foundry.deployment}"`,
      url: chatUrl(foundry),
      headers: { 'api-key': foundry.apiKey },
      body: {},
      minTokens: Number(env.LLM_MAX_TOKENS) || 0,
    };
  }
  if (provider === 'openai') {
    const model = env.LLM_MODEL;
    if (!model) return null;
    const baseUrl = (env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    return {
      provider,
      label: `model "${model}" at ${baseUrl}`,
      url: `${baseUrl}/chat/completions`,
      headers: env.LLM_API_KEY ? { authorization: `Bearer ${env.LLM_API_KEY}` } : {},
      body: { model, ...(env.LLM_REASONING_EFFORT && { reasoning_effort: env.LLM_REASONING_EFFORT }) },
      minTokens: Number(env.LLM_MAX_TOKENS) || 0,
    };
  }
  return null;
}

export class ChatClient {
  constructor(config, {
    fetchImpl = globalThis.fetch,
    timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 20000,
    retries = Number(process.env.LLM_RETRIES ?? 3),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.sleep = sleep;
    this.name = `${config.provider}:${config.body.model ?? config.label}`;
    this.usage = { calls: 0, promptTokens: 0, completionTokens: 0 };
  }

  // Ask for a JSON object back. Returns the parsed object.
  async json(request) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#once(request);
      } catch (err) {
        // Dropped connections and timeouts get a short backoff, like rate limits.
        const delay = err.retryAfterMs ?? (isNetworkError(err) ? Math.min(1000 * 2 ** attempt, 8000) : 0);
        if (!delay || attempt >= this.retries) throw err;
        await this.sleep(delay);
      }
    }
  }

  async #once({ system, user, temperature = 0.6, maxTokens = 500 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(this.config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.config.headers },
        body: JSON.stringify({
          ...this.config.body,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) },
          ],
          temperature,
          max_tokens: Math.max(maxTokens, this.config.minTokens ?? 0),
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`${this.config.provider} ${res.status}: ${text.slice(0, 300)}`);
        if (res.status === 429 || res.status === 503) err.retryAfterMs = retryDelayMs(res, text);
        throw err;
      }
      const body = await res.json();
      this.usage.calls += 1;
      this.usage.promptTokens += body.usage?.prompt_tokens ?? 0;
      this.usage.completionTokens += body.usage?.completion_tokens ?? 0;
      const content = body.choices?.[0]?.message?.content ?? '';
      // Some smaller models wrap JSON in a markdown fence despite json mode.
      return JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
    } finally {
      clearTimeout(timer);
    }
  }
}

// fetch rejects with a TypeError when the connection fails or drops, and with
// an AbortError when our own timeout fires.
export function isNetworkError(err) {
  return err?.name === 'AbortError' || (err?.name === 'TypeError' && /fetch failed|network|socket|terminated/i.test(err.message));
}

// How long the server asked us to wait, from the Retry-After header or a
// "try again in 3.5s" hint in the body. Capped so a demo never stalls for long.
export function retryDelayMs(res, text = '') {
  const header = Number(res.headers?.get?.('retry-after'));
  const hint = text.match(/try again in ([\d.]+)\s*(ms|s)/i);
  const ms = header > 0 ? header * 1000 : hint ? Number(hint[1]) * (hint[2].toLowerCase() === 'ms' ? 1 : 1000) : 2000;
  return Math.min(Math.ceil(ms) + 250, 30000);
}
