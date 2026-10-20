import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../src/engine/simulate.ts';
import { Crew } from '../src/agents/crew.ts';
import { ChatClient, chatUrl, llmConfigFromEnv, retryDelayMs } from '../src/ai/llm.ts';
import type { FetchLike } from '../src/ai/llm.ts';
import type { EvidencePack } from '../src/agents/evidence.ts';
import type { JsonModel } from '../src/types.ts';
import { evidenceOf, fakeResponse, model, must, runCrew } from './helpers.ts';

const run = (llm: JsonModel | null, seed = 7) => runCrew(llm, { seed });

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
  const liar = model(() => {
    calls++;
    return { headline: 'Wow', text: 'He ran 97 km/h and scored 42 goals.', cites: ['e9999'] };
  });
  const { crew } = await run(liar);
  assert.ok(calls > 0);
  assert.ok(crew.feed.every((f) => f.source === 'template'));
  assert.ok(crew.trace.some((r) => r.status === 'rejected' && /97|e9999/.test(r.detail)));
});

test('a grounded model answer is accepted', async () => {
  // Echo back a sentence built only from the evidence pack.
  const honest = model((request) => {
      const pack = evidenceOf(request);
      const last = must(pack.events[pack.events.length - 1]);
      return { headline: 'Key moment', text: `${pack.match.home} against ${pack.match.away}, it is ${pack.match.score}.`, tags: ['momentum'], cites: [last.id] };
  });
  const { crew } = await run(honest);
  assert.ok(crew.feed.some((f) => f.source === 'model'));
});

test('a failing model never breaks the broadcast', async () => {
  const broken = model(() => {
    throw new Error('429 rate limited');
  });
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
  assert.equal(must(llmConfigFromEnv({ ...foundry, LLM_MODEL: 'phi4-mini' })).provider, 'foundry');
  assert.deepEqual(must(llmConfigFromEnv(foundry)).headers, { 'api-key': 'k' });

  const local = must(llmConfigFromEnv({ LLM_MODEL: 'phi4-mini' }));
  assert.equal(local.url, 'http://localhost:11434/v1/chat/completions');
  assert.deepEqual(local.body, { model: 'phi4-mini' });
  assert.deepEqual(local.headers, {});

  const hosted = must(llmConfigFromEnv({ ...foundry, LLM_PROVIDER: 'openai', LLM_MODEL: 'm', LLM_BASE_URL: 'https://api.example.com/v1/', LLM_API_KEY: 's' }));
  assert.equal(hosted.url, 'https://api.example.com/v1/chat/completions');
  assert.deepEqual(hosted.headers, { authorization: 'Bearer s' });
});

test('rate limits are retried after the delay the server asks for', async () => {
  const replies = [fakeResponse(429, 'Please try again in 877.5ms.'), fakeResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] })];
  const waits: number[] = [];
  const config = must(llmConfigFromEnv({ LLM_MODEL: 'm', LLM_REASONING_EFFORT: 'low', LLM_MAX_TOKENS: '1500' }));
  let sent: Record<string, unknown> = {};
  const client = new ChatClient(config, {
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init.body));
      return must(replies.shift());
    },
    sleep: async (ms) => waits.push(ms),
  });
  assert.deepEqual(await client.json({ system: 's', user: 'u' }), { ok: true });
  assert.deepEqual(waits, [1128]);
  assert.equal(sent.reasoning_effort, 'low');
  assert.equal(sent.max_tokens, 1500);
  assert.equal(retryDelayMs({ headers: new Headers({ 'retry-after': '3' }) }), 3250);
});

test('signed numbers are checked by size: away momentum -27 may be written as 27', async () => {
  const { verify } = await import('../src/agents/evidence.ts');
  const { MatchState } = await import('../src/stats/matchState.ts');
  const match = simulateMatch({ seed: 7 });
  const state = new MatchState(match.meta);
  const pack = { moment: { id: 'm1', type: 'momentum_swing', data: { momentum: -27 } }, events: [{ id: 'e0001' }], match: {} } as unknown as EvidencePack;
  assert.ok(verify({ text: 'Momentum meter at 27.', cites: ['e0001'] }, pack, state).ok);
  assert.ok(!verify({ text: 'Momentum meter at 28.', cites: ['e0001'] }, pack, state).ok);
});

test('event ids are kept in cites but tidied out of on-screen text', async () => {
  const { tidy } = await import('../src/agents/crew.ts');
  assert.equal(tidy('A run of risky passes (e0695, e0722, e0724) fail to break the deadlock.'), 'A run of risky passes fail to break the deadlock.');
  assert.equal(tidy('Mbeki scores (e0578) at 96.1 km/h.'), 'Mbeki scores at 96.1 km/h.');
  assert.equal(tidy('Pressure [e0101, e0102] pays off'), 'Pressure pays off');
  assert.equal(tidy('No ids here, 2-1.'), 'No ids here, 2-1.');
  assert.equal(tidy('the ensuing quick passes (e0575-e0577) produced a blocked shot.'), 'the ensuing quick passes produced a blocked shot.');
  assert.equal(tidy('A rapid passing sequence (e0348–e0352) raised the tempo.'), 'A rapid passing sequence raised the tempo.');
  assert.equal(tidy('Xhaka (the anchor) held firm.'), 'Xhaka (the anchor) held firm.');
  assert.equal(tidy('After e0991 interception, three passes followed.'), 'After interception, three passes followed.');
  assert.equal(tidy('بعد اعتراض e0991، قام'), 'بعد اعتراض، قام');
  assert.equal(tidy('تم اعتراض تمريرة (E0567)، ثم'), 'تم اعتراض تمريرة، ثم', 'translators may capitalise ids');
});

test('when the Narrator fails, a model-written Tactician line airs labelled as insight', async () => {
  const llm = model((request) => {
    if (!request.system.includes('You are the Tactician')) throw new Error('narrator down');
    const pack = evidenceOf(request);
    const ev = must(pack.events[pack.events.length - 1]);
    return { headline: 'Key moment', text: `${pack.match.home} v ${pack.match.away}.`, tags: [], cites: [ev.id] };
  }, 'half');
  const { crew } = await run(llm);
  assert.ok(crew.feed.filter((f) => f.type !== 'recap').every((f) => f.source === 'insight'));
});

test('cache-only mode falls back quietly without error noise', async () => {
  const { CachedChat } = await import('../src/ai/cache.ts');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { crew } = await run(new CachedChat(null, { dir: mkdtempSync(join(tmpdir(), 'mc-')) }));
  assert.ok(!crew.trace.some((r) => r.status === 'error'));
  assert.ok(crew.trace.some((r) => r.detail === 'no cached answer'));
});

test('dropped connections are retried with backoff; other errors are not', async () => {
  const replies: (() => ReturnType<typeof fakeResponse>)[] = [
    () => {
      throw new TypeError('fetch failed');
    },
    () => {
      throw Object.assign(new Error('timeout'), { name: 'AbortError' });
    },
    () => fakeResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] }),
  ];
  const waits: number[] = [];
  const config = must(llmConfigFromEnv({ LLM_MODEL: 'm' }));
  const next: FetchLike = async () => must(replies.shift())();
  const client = new ChatClient(config, { fetchImpl: next, sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(await client.json({ system: 's', user: 'u' }), { ok: true });
  assert.deepEqual(waits, [1000, 2000]);

  let calls = 0;
  const strict = new ChatClient(config, {
    fetchImpl: async () => {
      calls++;
      return fakeResponse(400, 'bad request');
    },
    sleep: async () => {},
  });
  await assert.rejects(strict.json({ system: 's', user: 'u' }), /400/);
  assert.equal(calls, 1);
});

test('numbers are read in other scripts and decimal styles', async () => {
  const { extractNumbers } = await import('../src/agents/evidence.ts');
  assert.deepEqual(extractNumbers('La oportunidad valía 0,829 xG.'), [0.829]);
  assert.deepEqual(extractNumbers('سدد بسرعة ٩٦٫١ كم/س'), [96.1]);
  assert.deepEqual(extractNumbers('٣ تمريرات و ۴ تسديدات'), [3, 4]);
  assert.deepEqual(extractNumbers('Score 2-1, xG 1.15'), [2, 1, 1.15]);
});

test('units: distances are metres, so a bare km is rejected but km/h is fine', async () => {
  const { unitProblems } = await import('../src/agents/evidence.ts');
  assert.deepEqual(unitProblems('After an 8.7 km carry'), ['distance 8.7 km should be metres']);
  assert.deepEqual(unitProblems('بعد اندفاع لمسافة 8.7 كم'), ['distance 8.7 km should be metres']);
  assert.deepEqual(unitProblems('a 96.1 km/h shot'), []);
  assert.deepEqual(unitProblems('بسرعة 96.1 كم/س'), []);
  assert.deepEqual(unitProblems('32 km per hour, 45.1 m pass'), []);
  assert.deepEqual(unitProblems('١٢ كم'), ['distance 12 km should be metres']);
});

test('decimals must match the evidence at the precision written', async () => {
  const { verify } = await import('../src/agents/evidence.ts');
  const { MatchState } = await import('../src/stats/matchState.ts');
  const state = new MatchState(simulateMatch({ seed: 7 }).meta);
  const pack = { moment: { id: 'm1', type: 'goal', data: { xg: 0.188, minute: 37 } }, events: [{ id: 'e0001' }], match: {} } as unknown as EvidencePack;
  const ok = (text: string) => verify({ text, cites: ['e0001'] }, pack, state).ok;
  assert.ok(ok('xG 0.188 in minute 37.'));
  assert.ok(ok('xG 0.19, about 19%, rounded 0.2.'), 'rounded forms of an evidence value pass');
  assert.ok(!ok('Minute 37.3.'), 'a decimal does not pass on the strength of a whole number');
  assert.ok(!ok('xG 0.45.'), 'an invented small decimal no longer rounds to 0 and passes');
  assert.ok(!ok('Minute 40.'));
});

test('numbers with units must match a value of that kind; any league player counts as a name', async () => {
  const { verify, unitNumberProblems } = await import('../src/agents/evidence.ts');
  const { MatchState } = await import('../src/stats/matchState.ts');
  const state = new MatchState(simulateMatch({ seed: 7 }).meta);
  const pack = {
    moment: { id: 'm1', type: 'goal', data: { xg: 0.188, shotSpeedKmh: 96.1 } },
    events: [{ id: 'e0001', distance: 12.3, speedKmh: 33.5 }],
    match: { momentum: 52, stats: { A: { possessionPct: 61, xg: 1.2 } } },
  } as unknown as EvidencePack;
  const ok = (text: string) => verify({ text, cites: ['e0001'] }, pack, state).ok;
  assert.ok(ok('A 96.1 km/h shot after a 12.3 m pass, xG 0.188 (19%), 61% possession.'));
  assert.ok(!ok('A 12.3 km/h shot.'), 'a distance written as a speed');
  assert.ok(!ok('A 33.5 m pass.'), 'a speed written as a distance');
  assert.ok(!ok('Momentum to 52%.'), 'momentum is an index, not a percentage');
  assert.ok(!ok('Worth 1.2 xG, then 0.188 xG.') === false, 'xG values from stats and the moment both count');
  assert.deepEqual(unitNumberProblems('passes covering 125 m', pack), ['distance 125 does not match any distance in the evidence']);
  assert.deepEqual(unitNumberProblems('a metric block', { followedMetric: { unit: 'km/h top', A: 32.9 } }), []);
  assert.deepEqual(unitNumberProblems('top speed 32.9 km/h', { followedMetric: { unit: 'km/h top', A: 32.9 } }), []);
  // A player from another club in the league is still a player not in the evidence.
  assert.ok(!ok('Kwame Mensah was everywhere.'), 'Kwame Mensah plays for Southmere, not in this match');
});
