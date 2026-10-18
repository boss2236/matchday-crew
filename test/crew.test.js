import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../src/engine/simulate.js';
import { Crew } from '../src/agents/crew.js';
import { ChatClient, chatUrl, llmConfigFromEnv, retryDelayMs } from '../src/ai/llm.js';

async function run(llm, seed = 7) {
  const match = simulateMatch({ seed });
  const crew = new Crew({ meta: match.meta, llm });
  for (const ev of match.events) await crew.onEvent(ev);
  return { match, crew };
}

test('without a model the crew airs every goal and a recap, all from templates', async () => {
  const { match, crew } = await run(null);
  const goals = crew.feed.filter((f) => f.type === 'goal');
  assert.equal(goals.length, (match.score.home + match.score.away) * 2); // two audiences
  assert.equal(crew.feed.filter((f) => f.type === 'recap').length, 2);
  assert.ok(crew.feed.every((f) => f.source === 'template'));
});

test('every aired item cites events that really happened', async () => {
  const { match, crew } = await run(null);
  const ids = new Set(match.events.map((e) => e.id));
  for (const item of crew.feed) for (const id of item.cites) assert.ok(ids.has(id), `${item.id} cites ${id}`);
});

test('a model that invents numbers is rejected, retried, then replaced by a template', async () => {
  let calls = 0;
  const liar = { json: async () => { calls++; return { headline: 'Wow', text: 'He ran 97 km/h and scored 42 goals.', cites: ['e9999'] }; } };
  const { crew } = await run(liar);
  assert.ok(calls > 0);
  assert.ok(crew.feed.every((f) => f.source === 'template'));
  assert.ok(crew.trace.some((r) => r.status === 'rejected' && /97|e9999/.test(r.detail)));
});

test('a grounded model answer is accepted', async () => {
  // Echo back a sentence built only from the evidence pack.
  const honest = {
    json: async ({ user }) => {
      const pack = user.evidence;
      const last = pack.events[pack.events.length - 1];
      return { headline: 'Key moment', text: `${pack.match.home} against ${pack.match.away}, it is ${pack.match.score}.`, tags: ['momentum'], cites: [last.id] };
    },
  };
  const { crew } = await run(honest);
  assert.ok(crew.feed.some((f) => f.source === 'model'));
});

test('a failing model never breaks the broadcast', async () => {
  const broken = { json: async () => { throw new Error('429 rate limited'); } };
  const { crew } = await run(broken);
  assert.ok(crew.feed.length > 0);
  assert.ok(crew.trace.some((r) => r.status === 'error'));
});

test('chat URL works for resource, OpenAI and project endpoints', () => {
  const expected = 'https://x-resource.services.ai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21';
  assert.equal(chatUrl({ endpoint: 'https://x-resource.services.ai.azure.com', deployment: 'gpt-4o-mini' }), expected);
  assert.equal(chatUrl({ endpoint: 'https://x-resource.services.ai.azure.com/api/projects/p1', deployment: 'gpt-4o-mini' }), expected);
  assert.equal(
    chatUrl({ endpoint: 'https://x-resource.openai.azure.com/openai/v1', deployment: 'gpt-4o-mini' }),
    'https://x-resource.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21',
  );
});

test('provider config picks Foundry first, then any OpenAI-compatible server', () => {
  const foundry = { FOUNDRY_ENDPOINT: 'https://x-resource.services.ai.azure.com', FOUNDRY_DEPLOYMENT: 'gpt-4o-mini', FOUNDRY_API_KEY: 'k' };
  assert.equal(llmConfigFromEnv({}), null);
  assert.equal(llmConfigFromEnv({ ...foundry, LLM_MODEL: 'phi4-mini' }).provider, 'foundry');
  assert.deepEqual(llmConfigFromEnv(foundry).headers, { 'api-key': 'k' });

  const local = llmConfigFromEnv({ LLM_MODEL: 'phi4-mini' });
  assert.equal(local.url, 'http://localhost:11434/v1/chat/completions');
  assert.deepEqual(local.body, { model: 'phi4-mini' });
  assert.deepEqual(local.headers, {});

  const hosted = llmConfigFromEnv({ ...foundry, LLM_PROVIDER: 'openai', LLM_MODEL: 'm', LLM_BASE_URL: 'https://api.example.com/v1/', LLM_API_KEY: 's' });
  assert.equal(hosted.url, 'https://api.example.com/v1/chat/completions');
  assert.deepEqual(hosted.headers, { authorization: 'Bearer s' });
});

test('rate limits are retried after the delay the server asks for', async () => {
  const replies = [
    { ok: false, status: 429, headers: new Headers(), text: async () => 'Please try again in 877.5ms.' },
    { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) },
  ];
  const waits = [];
  const config = llmConfigFromEnv({ LLM_MODEL: 'm', LLM_REASONING_EFFORT: 'low', LLM_MAX_TOKENS: '1500' });
  let sent;
  const client = new ChatClient(config, {
    fetchImpl: async (_url, init) => ((sent = JSON.parse(init.body)), replies.shift()),
    sleep: async (ms) => waits.push(ms),
  });
  assert.deepEqual(await client.json({ system: 's', user: 'u' }), { ok: true });
  assert.deepEqual(waits, [1128]);
  assert.equal(sent.reasoning_effort, 'low');
  assert.equal(sent.max_tokens, 1500);
  assert.equal(retryDelayMs({ headers: new Headers({ 'retry-after': '3' }) }), 3250);
});
