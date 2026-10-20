// Speech, A2A, rate limits, security headers and the studio route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp, RateLimiter } from '../src/server/app.ts';
import type { App } from '../src/server/app.ts';
import { Speech, ssml, speechConfigFromEnv, VOICES } from '../src/ai/speech.ts';
import { agentCard, handleA2A } from '../src/a2a/agent.ts';
import { LANGUAGES } from '../src/ai/translator.ts';
import { model, must } from './helpers.ts';

async function listen(app: App) {
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  const { port } = app.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => app.close(r)) };
}

test('speech: SSML picks a neural voice per language and escapes text', () => {
  assert.match(ssml('Goal & glory <now>', 'Arabic'), /<voice name='ar-SA-HamedNeural'>Goal &amp; glory &lt;now&gt;<\/voice>/);
  assert.match(ssml('Hello', 'English'), /xml:lang='en-GB'/);
  assert.match(ssml('Hola', 'Klingon'), /en-GB-RyanNeural/, 'unknown languages fall back to English');
  for (const code of Object.values(LANGUAGES)) assert.ok(VOICES[code], `voice for ${code}`);
  assert.equal(speechConfigFromEnv({ AZURE_SPEECH_KEY: 'k' }), null, 'region is required');
});

test('speech: request shape for Azure AI Speech, and repeats come from memory', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const speech = new Speech(must(speechConfigFromEnv({ AZURE_SPEECH_KEY: 'sk', AZURE_SPEECH_REGION: 'qatarcentral' })), {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const audio = new Uint8Array([0x49, 0x44, 0x33]);
      return Object.assign(new Response(audio), {});
    },
  });
  const a = await speech.synthesize('Mbeki scores!', 'Spanish');
  await speech.synthesize('Mbeki scores!', 'Spanish');
  assert.equal(calls.length, 1);
  const call = must(calls[0]);
  assert.equal(call.url, 'https://qatarcentral.tts.speech.microsoft.com/cognitiveservices/v1');
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers['Ocp-Apim-Subscription-Key'], 'sk');
  assert.equal(headers['Content-Type'], 'application/ssml+xml');
  assert.match(String(call.init.body), /es-ES-AlvaroNeural/);
  assert.deepEqual([...a], [0x49, 0x44, 0x33]);
});

test('rate limiter: per client and route, resets after the window', () => {
  const rl = new RateLimiter({ '/api/live': 2 }, 1000);
  assert.equal(rl.check('/api/live', 'a', 0), 0);
  assert.equal(rl.check('/api/live', 'a', 10), 0);
  assert.ok(rl.check('/api/live', 'a', 20) > 0);
  assert.equal(rl.check('/api/live', 'b', 20), 0, 'another client is unaffected');
  assert.equal(rl.check('/healthz', 'a', 20), 0, 'unlisted routes are not limited');
  assert.equal(rl.check('/api/live', 'a', 1001), 0, 'a new window starts fresh');
});

test('A2A: agent card lists the crew skills; message/send runs them', async () => {
  const card = agentCard('https://crew.example');
  assert.equal(card.url, 'https://crew.example/a2a');
  assert.deepEqual(card.skills.map((s) => s.id), ['list_fixtures', 'match_summary', 'key_moments', 'player_stats', 'explain_moment']);

  const send = (parts: object[]) => handleA2A({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', parts: parts as never, messageId: 'm' } } });
  const byData = (await send([{ kind: 'data', data: { skill: 'match_summary', arguments: { seed: 7 } } }])) as { result: any };
  assert.equal(byData.result.status.state, 'completed');
  assert.equal(byData.result.artifacts[0].parts[0].data.result.match, 'Harbour City 4-1 Ironvale Athletic');

  const byText = (await send([{ kind: 'text', text: 'What were the key moments in seed 9?' }])) as { result: any };
  assert.equal(byText.result.artifacts[0].name, 'key_moments');

  const failed = (await send([{ kind: 'data', data: { skill: 'player_stats', arguments: { seed: 7 } } }])) as { result: any };
  assert.equal(failed.result.status.state, 'failed');
  assert.match(failed.result.status.message.parts[0].text, /player is required/);

  const got = (await handleA2A({ jsonrpc: '2.0', id: 2, method: 'tasks/get', params: { id: byData.result.id } })) as { result: any };
  assert.equal(got.result.id, byData.result.id);
  assert.equal(((await handleA2A({ jsonrpc: '2.0', id: 3, method: 'tasks/cancel' })) as { error: any }).error.code, -32601);
  assert.equal(((await send([])) as { error: any }).error.code, -32602);
});

test('server: security headers, studio route, A2A over HTTP, speech off, rate limit', async () => {
  const publicDir = mkdtempSync(join(tmpdir(), 'mc-web-'));
  writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>Nutmeg Desk</title>');
  const { base, close } = await listen(createApp({ publicDir, limits: { '/api/live': 1 } }));
  try {
    const home = await fetch(`${base}/`);
    assert.match(home.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await (await fetch(`${base}/studio`)).text(), /Nutmeg Desk/);

    const card = await (await fetch(`${base}/.well-known/agent-card.json`)).json();
    assert.equal(card.url, `${base}/a2a`);
    const rpc = await fetch(`${base}/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', parts: [{ kind: 'text', text: 'list fixtures' }] } } }),
    });
    assert.equal((await rpc.json()).result.status.state, 'completed');
    assert.equal((await fetch(`${base}/a2a`)).status, 405);
    assert.equal((await fetch(`${base}/a2a`, { method: 'POST', body: 'not json' })).status, 400);
    assert.equal((await fetch(`${base}/a2a`, { method: 'POST', body: 'x'.repeat(70_000) })).status, 413);

    assert.equal((await fetch(`${base}/api/speak?text=hi`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/config`)).json()).speech, false);

    const first = await fetch(`${base}/api/live?speed=0&seed=8`);
    await first.text();
    const second = await fetch(`${base}/api/live?speed=0&seed=8`);
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get('retry-after')) > 0);
  } finally {
    await close();
  }
});

test('content safety: request shape, severity threshold and memo', async () => {
  const { ContentSafety, safetyConfigFromEnv } = await import('../src/ai/safety.ts');
  const calls: { url: string; body: any; key: string }[] = [];
  const scores: Record<string, number> = { calm: 0, rough: 2, nasty: 4 };
  const cs = new ContentSafety(must(safetyConfigFromEnv({ AZURE_CONTENT_SAFETY_ENDPOINT: 'https://cs.example/', AZURE_CONTENT_SAFETY_KEY: 'ck' })), {
    fetchImpl: async (url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body, key: (init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key'] as string });
      const sev = scores[body.text as string] ?? 0;
      return new Response(JSON.stringify({ categoriesAnalysis: [{ category: 'Hate', severity: 0 }, { category: 'Violence', severity: sev }] }));
    },
  });
  assert.deepEqual(await cs.screen('calm'), { ok: true, flagged: [] });
  assert.deepEqual(await cs.screen('rough'), { ok: true, flagged: [] }, 'severity 2 (football "attacks") airs by default');
  assert.deepEqual(await cs.screen('nasty'), { ok: false, flagged: ['Violence 4'] });
  await cs.screen('nasty');
  assert.equal(calls.length, 3, 'repeats are screened once');
  const first = must(calls[0]);
  assert.equal(first.url, 'https://cs.example/contentsafety/text:analyze?api-version=2024-09-01');
  assert.equal(first.key, 'ck');
  assert.deepEqual(first.body.categories, ['Hate', 'SelfHarm', 'Sexual', 'Violence']);
  assert.equal(safetyConfigFromEnv({ AZURE_CONTENT_SAFETY_ENDPOINT: 'x', AZURE_CONTENT_SAFETY_KEY: 'k', CONTENT_SAFETY_MAX_SEVERITY: '0' })?.maxSeverity, 0);
  assert.equal(safetyConfigFromEnv({}), null);
});

test('Safety agent: flagged model lines become templates; outages let lines air; templates are not screened', async () => {
  const { runCrew, evidenceOf } = await import('./helpers.ts');
  const grounded = model((request) => {
    const pack = evidenceOf(request);
    const ev = must(pack.events[pack.events.length - 1]);
    return { headline: 'Key moment', text: `${pack.match.home} v ${pack.match.away}, ${pack.match.score}.`, tags: [], cites: [ev.id] };
  });
  const screened: string[] = [];
  const flagAll = { screen: async (t: string) => (screened.push(t), { ok: false, flagged: ['Violence 6'] }) };
  const { crew } = await runCrew(grounded, { safety: flagAll });
  assert.ok(screened.length > 0);
  assert.ok(crew.feed.every((f) => f.source === 'template'), 'every flagged line was replaced');
  assert.ok(crew.trace.some((r) => r.agent === 'Safety' && r.status === 'rejected' && /Violence 6/.test(r.detail)));

  const down = { screen: async () => { throw new Error('content safety 503'); } };
  const { crew: crew2 } = await runCrew(grounded, { safety: down });
  assert.ok(crew2.feed.some((f) => f.source === 'model'), 'lines still air when the service is down');
  assert.ok(crew2.trace.some((r) => r.agent === 'Safety' && r.status === 'error'));

  const seen: string[] = [];
  await runCrew(null, { safety: { screen: async (t: string) => (seen.push(t), { ok: true, flagged: [] }) } });
  assert.equal(seen.length, 0, 'templates are built from match data and skip the check');
});

test('telemetry: connection string, durations, envelopes and never throwing', async () => {
  const { AppInsights, parseConnectionString, formatDuration, track, noTelemetry } = await import('../src/telemetry.ts');
  assert.deepEqual(parseConnectionString('InstrumentationKey=abc;IngestionEndpoint=https://qatarcentral-0.in.applicationinsights.azure.com/;LiveEndpoint=x'), {
    iKey: 'abc',
    endpoint: 'https://qatarcentral-0.in.applicationinsights.azure.com/',
  });
  assert.equal(parseConnectionString('IngestionEndpoint=https://x/'), null);
  assert.equal(formatDuration(1234), '00:00:01.234');
  assert.equal(formatDuration(90_061_005), '1.01:01:01.005');

  const posts: { url: string; batch: any[] }[] = [];
  let fail = false;
  const ai = new AppInsights('InstrumentationKey=k1;IngestionEndpoint=https://ing.example/', {
    intervalMs: 60_000,
    fetchImpl: async (url, init) => {
      posts.push({ url, batch: JSON.parse(String(init.body)) });
      return new Response('{}', { status: fail ? 500 : 200 });
    },
  });
  ai.request('GET /api/config', '/api/config', 200, 12);
  await track(ai, 'Azure AI Translator', 'translate', 'api', async () => 'ok', { language: 'Arabic' });
  await assert.rejects(track(ai, 'AI model', 'chat completion', 'groq', async () => { throw new Error('429'); }));
  ai.event('MatchSession', { seed: 7 }, { items: 54 });
  ai.exception(new Error('boom'));
  await ai.flush();
  clearInterval(ai.timer);
  const post = must(posts[0]);
  assert.equal(post.url, 'https://ing.example/v2/track');
  assert.deepEqual(post.batch.map((e) => e.data.baseType), ['RequestData', 'RemoteDependencyData', 'RemoteDependencyData', 'EventData', 'ExceptionData']);
  assert.ok(post.batch.every((e) => e.iKey === 'k1' && e.tags['ai.cloud.role'] === 'nutmeg-desk'));
  assert.equal(post.batch[2].data.baseData.success, false);
  assert.equal(post.batch[3].data.baseData.measurements.items, 54);
  fail = true;
  ai.event('x');
  await ai.flush(); // a failing ingestion endpoint must not throw
  assert.equal(noTelemetry.enabled, false);
});

test('server: request telemetry and a session event per match', async () => {
  const seen: string[] = [];
  const telemetry = {
    enabled: true,
    request: (name: string) => seen.push(`request ${name}`),
    dependency: () => {},
    event: (name: string, _p?: unknown, m?: Record<string, number>) => seen.push(`event ${name} items=${m?.items}`),
    exception: () => {},
    flush: async () => {},
  };
  const { base, close } = await listen(createApp({ telemetry, publicDir: mkdtempSync(join(tmpdir(), 'mc-web-')) }));
  try {
    await (await fetch(`${base}/api/config`)).json();
    await (await fetch(`${base}/api/live?seed=8&speed=0`)).text();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(seen.includes('request GET /api/config'));
    assert.ok(seen.some((s) => /^event MatchSession items=\d+$/.test(s)));
  } finally {
    await close();
  }
});
