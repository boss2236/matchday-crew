// Provider contract tests over real HTTP against local mock servers: Microsoft
// Foundry (Azure OpenAI deployments route), an OpenAI-compatible API, and Azure
// AI Translator. They prove the request shapes the real services expect and
// run the whole crew through each, without needing an account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simulateMatch } from '../src/engine/simulate.js';
import { Crew } from '../src/agents/crew.js';
import { ChatClient, llmConfigFromEnv } from '../src/ai/llm.js';
import { CachedChat, cacheKey } from '../src/ai/cache.js';
import { Translator, translatorConfigFromEnv, languageCode } from '../src/ai/translator.js';

// A model that only writes grounded lines: it quotes the evidence pack back.
function groundedAnswer(body) {
  const user = JSON.parse(body.messages[1].content);
  const pack = user.evidence;
  const ev = pack.events[pack.events.length - 1] ?? { id: 'none' };
  return { headline: 'Key moment', text: `${pack.match.home} v ${pack.match.away}, ${pack.match.score}.`, tags: ['momentum'], cites: [ev.id] };
}

async function mockServer(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null };
      requests.push(entry);
      const [status, payload] = handler(entry);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

const chatReply = (content) => [200, { choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }];

async function runCrew(llm, translator = null, audiences) {
  const match = simulateMatch({ seed: 7 });
  const crew = new Crew({ meta: match.meta, llm, translator, ...(audiences && { audiences }) });
  for (const ev of match.events) await crew.onEvent(ev);
  return crew;
}

test('Foundry: crew runs end to end against an Azure OpenAI style deployment', async () => {
  const mock = await mockServer((r) => {
    if (r.url !== '/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21') return [404, { error: { code: 'DeploymentNotFound' } }];
    if (r.headers['api-key'] !== 'test-key') return [401, { error: { code: '401' } }];
    return chatReply(groundedAnswer(r.body));
  });
  try {
    const config = llmConfigFromEnv({ FOUNDRY_ENDPOINT: mock.url, FOUNDRY_DEPLOYMENT: 'gpt-4o-mini', FOUNDRY_API_KEY: 'test-key' });
    assert.equal(config.provider, 'foundry');
    const crew = await runCrew(new ChatClient(config));
    assert.ok(mock.requests.length > 20);
    const req = mock.requests[0];
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
    const config = llmConfigFromEnv({ FOUNDRY_ENDPOINT: mock.url, FOUNDRY_DEPLOYMENT: 'gpt-4o-mini', FOUNDRY_API_KEY: 'wrong' });
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
    const config = llmConfigFromEnv({ LLM_BASE_URL: `${mock.url}/v1`, LLM_MODEL: 'openai/gpt-oss-120b', LLM_API_KEY: 'sk-test', LLM_REASONING_EFFORT: 'low', LLM_MAX_TOKENS: '1500' });
    const crew = await runCrew(new ChatClient(config));
    const body = mock.requests[0].body;
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
  const model = { name: 'counting', json: async (req) => { calls++; return groundedAnswer({ messages: [{}, { content: JSON.stringify(req.user) }] }); } };
  const first = await runCrew(new CachedChat(model, { dir }));
  const callsAfterFirst = calls;
  const replayOnly = new CachedChat(null, { dir });
  const second = await runCrew(replayOnly);
  assert.ok(callsAfterFirst > 0);
  assert.equal(calls, callsAfterFirst, 'replay made no model calls');
  assert.equal(replayOnly.stats.misses, 0);
  assert.deepEqual(second.feed.map((f) => f.text), first.feed.map((f) => f.text));
  assert.equal(readdirSync(dir).length, callsAfterFirst);
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
  const cached = new CachedChat({ name: 'm', json: async () => ({ ok: true }) }, { dir });
  assert.deepEqual(await cached.json({ system: 's', user: 'u' }), { ok: true });
  assert.ok(cached.stats.writeError);
  chmodSync(dir, 0o700);
});

test('Azure Translator: request shape, region header and language codes', async () => {
  const mock = await mockServer((r) => {
    if (!r.url.startsWith('/translate?api-version=3.0&from=en&to=ar')) return [400, {}];
    if (r.headers['ocp-apim-subscription-key'] !== 'tk' || r.headers['ocp-apim-subscription-region'] !== 'westeurope') return [401, {}];
    return [200, r.body.map(({ Text }) => ({ translations: [{ text: `AR:${Text}`, to: 'ar' }] }))];
  });
  try {
    const config = translatorConfigFromEnv({ AZURE_TRANSLATOR_KEY: 'tk', AZURE_TRANSLATOR_REGION: 'westeurope', AZURE_TRANSLATOR_ENDPOINT: mock.url });
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
  const fake = { translate: async (texts, lang) => texts.map((s) => `[${lang}] ${s}`) };
  const audiences = [
    { id: 'analyst', persona: 'analyst', language: 'English' },
    { id: 'casual', persona: 'casual', language: 'Arabic' },
  ];
  const crew = await runCrew(null, fake, audiences);
  const casual = crew.feed.filter((f) => f.audience === 'casual');
  const analyst = crew.feed.filter((f) => f.audience === 'analyst');
  assert.ok(casual.length > 0 && casual.every((f) => f.source === 'template+translator' && f.text.startsWith('[Arabic]')));
  assert.ok(analyst.every((f) => f.source === 'template'));

  // A translation that invents a number is rejected and the English line is kept.
  const liar = { translate: async (texts) => texts.map((s) => `${s} 777`) };
  const crew2 = await runCrew(null, liar, audiences);
  assert.ok(crew2.feed.filter((f) => f.audience === 'casual').every((f) => f.source === 'template'));
  assert.ok(crew2.trace.some((r) => r.agent === 'Translator' && r.status === 'rejected'));
});
