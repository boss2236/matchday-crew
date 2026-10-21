// GitHub Copilot as the crew's model, through the GitHub Copilot SDK.
//
//   LLM_PROVIDER=copilot
//   COPILOT_MODEL          optional, a model your Copilot plan offers (default below;
//                          `node scripts/copilot-check.ts --models` lists them)
//   COPILOT_GITHUB_TOKEN   optional; without it the SDK uses the GitHub account
//                          you are logged in with (Copilot CLI / gh)
//
//   COPILOT_CLI_PATH       optional, read by the SDK: a Copilot CLI to run instead of
//                          the bundled runtime (which crashed with SIGBUS on one
//                          Linux machine; `which copilot` works there)
//
// One-time setup: npm install @github/copilot-sdk (not a listed dependency).
//
// Every prompt counts against your Copilot plan's allowance, so this is meant for
// pre-generating lines into the response cache (npm run prewarm), not for serving
// the public: the deployed app replays the cache.
//
// The SDK runs Copilot's agent runtime, which can use tools (files, shell). The
// crew only needs text, so every tool permission request is rejected.
//
// The SDK is an optional dependency, loaded only when this provider is chosen,
// so the default server stays dependency-free.

import type { ChatRequest, JsonModel } from '../types.ts';

type Env = Record<string, string | undefined>;

export const DEFAULT_COPILOT_MODEL = 'gpt-5-mini';

export interface CopilotConfig {
  model: string;
  token?: string;
  timeoutMs: number;
}

export function copilotConfigFromEnv(env: Env = process.env): CopilotConfig | null {
  if (env.LLM_PROVIDER !== 'copilot') return null;
  return {
    model: env.COPILOT_MODEL || DEFAULT_COPILOT_MODEL,
    ...(env.COPILOT_GITHUB_TOKEN && { token: env.COPILOT_GITHUB_TOKEN }),
    timeoutMs: Number(env.LLM_TIMEOUT_MS) || 60000,
  };
}

// The slice of the SDK this provider uses (kept local so typecheck works without it installed).
interface SdkSession {
  sendAndWait(input: { prompt: string }, timeout?: number): Promise<{ data: { content: string } } | undefined>;
  disconnect(): Promise<void>;
}
interface SdkClient {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  createSession(config: { model: string; onPermissionRequest: () => { kind: 'reject' } }): Promise<SdkSession>;
  listModels?(): Promise<unknown>;
}
type SdkModule = { CopilotClient: new (options?: { gitHubToken?: string }) => SdkClient };

// The crew asks for JSON; Copilot has no JSON mode, so the instruction is in the prompt
// and the answer is parsed from the first {...} block.
export function copilotPrompt({ system, user }: ChatRequest): string {
  return [
    system,
    'Reply with exactly one JSON object and nothing else: no markdown fence, no commentary. Do not use any tools.',
    '',
    'Input:',
    typeof user === 'string' ? user : JSON.stringify(user),
  ].join('\n');
}

export function parseJsonReply(text: string): unknown {
  const s = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error(`copilot: no JSON object in reply: ${text.slice(0, 200)}`);
  return JSON.parse(s.slice(a, b + 1));
}

export class CopilotChat implements JsonModel {
  config: CopilotConfig;
  name: string;
  usage: { calls: number; promptTokens: number; completionTokens: number };
  #client: Promise<SdkClient> | null = null;
  #load: () => Promise<SdkModule>;

  constructor(config: CopilotConfig, { load = () => import('@github/copilot-sdk' as string) as Promise<SdkModule> }: { load?: () => Promise<SdkModule> } = {}) {
    this.config = config;
    this.name = `copilot:${config.model}`;
    this.usage = { calls: 0, promptTokens: 0, completionTokens: 0 };
    this.#load = load;
  }

  client(): Promise<SdkClient> {
    this.#client ??= this.#load().then(async ({ CopilotClient }) => {
      const c = new CopilotClient(this.config.token ? { gitHubToken: this.config.token } : {});
      await c.start();
      return c;
    });
    return this.#client;
  }

  async json(request: ChatRequest): Promise<unknown> {
    const client = await this.client();
    const session = await client.createSession({ model: this.config.model, onPermissionRequest: () => ({ kind: 'reject' }) });
    try {
      const reply = await session.sendAndWait({ prompt: copilotPrompt(request) }, this.config.timeoutMs);
      this.usage.calls += 1;
      return parseJsonReply(reply?.data.content ?? '');
    } finally {
      await session.disconnect();
    }
  }

  async listModels(): Promise<unknown> {
    const client = await this.client();
    return client.listModels ? client.listModels() : null;
  }

  async stop() {
    if (this.#client) await (await this.#client).stop();
  }
}
