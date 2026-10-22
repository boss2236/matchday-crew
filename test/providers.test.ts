// Provider contract tests over real HTTP against local mock servers: Microsoft
// Foundry (Azure OpenAI deployments route), an OpenAI-compatible API, and Azure
// AI Translator. They prove the request shapes the real services expect and
// run the whole crew through each, without needing an account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatClient, llmConfigFromEnv } from '../src/ai/llm.ts';
import { CachedChat, cacheKey } from '../src/ai/cache.ts';
import { Translator, translatorConfigFromEnv, languageCode } from '../src/ai/translator.ts';
import type { EvidencePack } from '../src/agents/evidence.ts';
import type { Audience } from '../src/types.ts';
import { evidenceOf, mockServer, model, must, runCrew as run, translator } from './helpers.ts';

// A model that only writes grounded lines: it quotes the evidence pack back.
function groundedFromPack(pack: EvidencePack) {
  const ev = pack.events[pack.events.length - 1] ?? { id: 'none' };
  return { headline: 'Key moment', text: `${pack.match.home} v ${pack.match.away}, ${pack.match.score}.`, tags: ['momentum'], cites: [ev.id] };
}

// Same, from an OpenAI-style request body as the mock server receives it.
function groundedAnswer(body: { messages: { content: string }[] }) {
  return groundedFromPack(JSON.parse(must(body.messages[1]).content).evidence);
}

const chatReply = (content: unknown): [number, unknown] => [200, { choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }];

async function runCrew(llm: Parameters<typeof run>[0], tr: Parameters<typeof translator>[0] | null = null, audiences?: Audience[]) {
  return (await run(llm, { translator: tr ? translator(tr) : null, ...(audiences && { audiences }) })).crew;
}

test('Foundry: crew runs end to end against an Azure OpenAI style deployment', async () => {
  const mock = await mockServer((r) => {
    if (r.url !== '/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21') return [404, { error: { code: 'DeploymentNotFound' } }];
    if (r.headers['api-key'] !== 'test-key') return [401, { error: { code: '401' } }];
    return chatReply(groundedAnswer(r.body));
  });
  try {
    const config = must(llmConfigFromEnv({ FOUNDRY_ENDPOINT: mock.url, FOUNDRY_DEPLOYMENT: 'gpt-4o-mini', FOUNDRY_API_KEY: 'test-key' }));
    assert.equal(config.provider, 'foundry');
    const crew = await runCrew(new ChatClient(config));
    assert.ok(mock.requests.length > 20);
    const req = must(mock.requests[0]);
    assert.equal(req.body.model, undefined, 'Foundry routes by deployment, not model field');
    assert.deepEqual(req.body.response_format, { type: 'json_object' });
    assert.equal(req.body.messages[0].role, 'system');
    assert.ok(crew.feed.filter((f) => f.source === 'model').length > 20);
  } finally {
    await mock.close();
  }
});

test('Foundry: a wrong key surfaces as an error and the broadcast falls back to templates', async () => {
  const mock = await mockServer(() => [401, { error: { code: '401', message: 'Access denied due to invalid subscription key' } }]);
  try {
    const config = must(llmConfigFromEnv({ FOUNDRY_ENDPOINT: mock.url, FOUNDRY_DEPLOYMENT: 'gpt-4o-mini', FOUNDRY_API_KEY: 'wrong' }));
    const crew = await runCrew(new ChatClient(config, { retries: 0 }));
    assert.ok(crew.feed.length > 0 && crew.feed.every((f) => f.source === 'template'));
    assert.ok(crew.trace.some((r) => r.status === 'error' && /foundry 401/.test(r.detail)));
  } finally {
    await mock.close();
  }
});

test('OpenAI-compatible: bearer auth, model field and reasoning effort are sent', async () => {
  const mock = await mockServer((r) => {
    if (r.url !== '/v1/chat/completions' || r.headers.authorization !== 'Bearer sk-test') return [401, {}];
    return chatReply(groundedAnswer(r.body));
  });
  try {
    const config = must(llmConfigFromEnv({ LLM_BASE_URL: `${mock.url}/v1`, LLM_MODEL: 'openai/gpt-oss-120b', LLM_API_KEY: 'sk-test', LLM_REASONING_EFFORT: 'low', LLM_MAX_TOKENS: '1500' }));
    const crew = await runCrew(new ChatClient(config));
    const body = must(mock.requests[0]).body;
    assert.equal(body.model, 'openai/gpt-oss-120b');
    assert.equal(body.reasoning_effort, 'low');
    assert.ok(body.max_tokens >= 1500);
    assert.ok(crew.feed.some((f) => f.source === 'model'));
  } finally {
    await mock.close();
  }
});

test('response cache: second run makes no model calls and airs the same lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-cache-'));
  let calls = 0;
  const counting = model((req) => {
    calls++;
    return groundedFromPack(evidenceOf(req));
  }, 'counting');
  const first = await runCrew(new CachedChat(counting, { dir }));
  const callsAfterFirst = calls;
  const replayOnly = new CachedChat(null, { dir });
  const second = await runCrew(replayOnly);
  assert.ok(callsAfterFirst > 0);
  assert.equal(calls, callsAfterFirst, 'replay made no model calls');
  assert.equal(replayOnly.stats.misses, 0);
  assert.deepEqual(second.feed.map((f) => f.text), first.feed.map((f) => f.text));
  assert.equal(readdirSync(dir).length, callsAfterFirst);
});

test('response cache: refresh rewrites another model\'s answers once, then reuses its own', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-cache-'));
  const answer = (req: Parameters<typeof evidenceOf>[0]) => groundedFromPack(evidenceOf(req));
  await runCrew(new CachedChat(model(answer, 'old'), { dir }));
  let calls = 0;
  const fresh = model((req) => {
    calls++;
    return answer(req);
  }, 'new');
  const refreshed = new CachedChat(fresh, { dir, refresh: true });
  await runCrew(refreshed);
  assert.ok(calls > 0 && refreshed.stats.hits === 0, 'every old answer was rewritten');
  const callsAfterFirst = calls;
  await runCrew(new CachedChat(fresh, { dir, refresh: true }));
  assert.equal(calls, callsAfterFirst, 'a rerun reuses what the new model wrote');
});

test('response cache: replay-only misses fall back to templates; key ignores provider', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-cache-'));
  const crew = await runCrew(new CachedChat(null, { dir }));
  assert.ok(crew.feed.every((f) => f.source === 'template'));
  assert.equal(cacheKey({ system: 's', user: { a: 1 } }), cacheKey({ system: 's', user: { a: 1 }, maxTokens: 500 }));
  assert.notEqual(cacheKey({ system: 's', user: { a: 1 } }), cacheKey({ system: 's', user: { a: 2 } }));
});

test('response cache: an unwritable cache folder never loses a model answer', { skip: process.getuid?.() === 0 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-cache-'));
  chmodSync(dir, 0o500);
  const cached = new CachedChat(model(() => ({ ok: true })), { dir });
  assert.deepEqual(await cached.json({ system: 's', user: 'u' }), { ok: true });
  assert.ok(cached.stats.writeError);
  chmodSync(dir, 0o700);
});

test('Azure Translator: request shape, region header and language codes', async () => {
  const mock = await mockServer((r) => {
    if (!r.url?.startsWith('/translate?api-version=3.0&from=en&to=ar')) return [400, {}];
    if (r.headers['ocp-apim-subscription-key'] !== 'tk' || r.headers['ocp-apim-subscription-region'] !== 'westeurope') return [401, {}];
    return [200, (r.body as { Text: string }[]).map(({ Text }) => ({ translations: [{ text: `AR:${Text}`, to: 'ar' }] }))];
  });
  try {
    const config = must(translatorConfigFromEnv({ AZURE_TRANSLATOR_KEY: 'tk', AZURE_TRANSLATOR_REGION: 'westeurope', AZURE_TRANSLATOR_ENDPOINT: mock.url }));
    const t = new Translator(config);
    assert.deepEqual(await t.translate(['Goal 1-0', 'xG 0.31'], 'Arabic'), ['AR:Goal 1-0', 'AR:xG 0.31']);
    await t.translate(['Goal 1-0', 'xG 0.31'], 'Arabic');
    assert.equal(mock.requests.length, 1, 'repeat translations are memoised');
    assert.deepEqual(await t.translate(['same'], 'English'), ['same']);
    assert.equal(languageCode('Chinese (Simplified)'), 'zh-Hans');
    assert.equal(languageCode('ar'), 'ar');
    assert.equal(languageCode('Klingon'), null);
    assert.equal(translatorConfigFromEnv({}), null);
  } finally {
    await mock.close();
  }
});

test('Translator agent localises template lines for non-English audiences and keeps them grounded', async () => {
  const fake = (texts: string[], lang: string) => texts.map((s) => `[${lang}] ${s}`);
  const audiences: Audience[] = [
    { id: 'analyst', persona: 'analyst', language: 'English' },
    { id: 'casual', persona: 'casual', language: 'Arabic' },
  ];
  const crew = await runCrew(null, fake, audiences);
  const casual = crew.feed.filter((f) => f.audience === 'casual');
  const analyst = crew.feed.filter((f) => f.audience === 'analyst');
  assert.ok(casual.length > 0 && casual.every((f) => f.source === 'template+translator' && f.text.startsWith('[Arabic]')));
  assert.ok(analyst.every((f) => f.source === 'template'));

  // A translation that invents a number is rejected and the English line is kept.
  const liar = (texts: string[]) => texts.map((s) => `${s} 777`);
  const crew2 = await runCrew(null, liar, audiences);
  assert.ok(crew2.feed.filter((f) => f.audience === 'casual').every((f) => f.source === 'template'));
  assert.ok(crew2.trace.some((r) => r.agent === 'Translator' && r.status === 'rejected'));
});

// GitHub Copilot provider, with a fake SDK: no network, no Copilot allowance used.
test('copilot: one session per call, every tool request rejected, JSON parsed', async () => {
  const { CopilotChat, copilotConfigFromEnv, parseJsonReply } = await import('../src/ai/copilot.ts');
  assert.equal(copilotConfigFromEnv({}), null);
  assert.deepEqual(copilotConfigFromEnv({ LLM_PROVIDER: 'copilot', COPILOT_MODEL: 'gpt-5' }), { model: 'gpt-5', timeoutMs: 60000 });

  const seen: { model: string; prompt: string; permission: unknown; closed: boolean }[] = [];
  let started = 0, stopped = 0;
  class FakeClient {
    async start() { started++; }
    async stop() { stopped++; }
    async createSession({ model, onPermissionRequest }: { model: string; onPermissionRequest: () => unknown }) {
      const rec = { model, prompt: '', permission: onPermissionRequest(), closed: false };
      seen.push(rec);
      return {
        sendAndWait: async ({ prompt }: { prompt: string }) => { rec.prompt = prompt; return { data: { content: '```json\n{"headline":"Goal","text":"Mbeki scores.","cites":["e1"]}\n```' } }; },
        disconnect: async () => { rec.closed = true; },
      };
    }
  }
  const chat = new CopilotChat({ model: 'gpt-5-mini', timeoutMs: 1000 }, { load: async () => ({ CopilotClient: FakeClient as never }) });
  const out = await chat.json({ system: 'Write JSON.', user: { a: 1 } });
  await chat.json({ system: 'Again.', user: 'x' });
  await chat.stop();

  assert.deepEqual(out, { headline: 'Goal', text: 'Mbeki scores.', cites: ['e1'] });
  assert.equal(started, 1, 'one client for the process');
  assert.equal(stopped, 1);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((s) => s.closed && s.model === 'gpt-5-mini'));
  assert.deepEqual(seen[0]?.permission, { kind: 'reject' });
  assert.match(seen[0]?.prompt ?? '', /Write JSON\.[\s\S]*Do not use any tools[\s\S]*\{"a":1\}/);
  assert.equal(chat.usage.calls, 2);
  assert.throws(() => parseJsonReply('no json here'), /no JSON object/);
  assert.deepEqual(parseJsonReply('Sure! {"x": 2} hope that helps'), { x: 2 });
});
