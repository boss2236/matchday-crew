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
import { must } from './helpers.ts';

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
  writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>Matchday Crew</title>');
  const { base, close } = await listen(createApp({ publicDir, limits: { '/api/live': 1 } }));
  try {
    const home = await fetch(`${base}/`);
    assert.match(home.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await (await fetch(`${base}/studio`)).text(), /Matchday Crew/);

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
