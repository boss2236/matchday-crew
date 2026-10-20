// Live session, HTTP server and MCP server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { simulateMatch } from '../src/engine/simulate.ts';
import { Crew } from '../src/agents/crew.ts';
import { LiveSession, audiencesFor } from '../src/live/session.ts';
import type { LiveMessages } from '../src/live/session.ts';
import { createApp, parseLiveQuery } from '../src/server/app.ts';
import type { App } from '../src/server/app.ts';
import { handle } from '../src/mcp/server.ts';
import { CLUBS } from '../src/engine/teams.ts';
import { METRICS, readMetric } from '../src/stats/metrics.ts';
import { replay } from '../src/stats/matchState.ts';
import type { Audience, ChatRequest } from '../src/types.ts';
import { evidenceOf, model, must, rpcError, rpcResult } from './helpers.ts';

type Message = { [K in keyof LiveMessages]: { type: K; data: LiveMessages[K] } }[keyof LiveMessages];

// Collects everything a session sends, with typed access by message kind.
function recorder() {
  const all: Message[] = [];
  return {
    all,
    emit: <K extends keyof LiveMessages>(type: K, data: LiveMessages[K]) => {
      all.push({ type, data } as Message);
    },
    of: <K extends keyof LiveMessages>(type: K) => all.filter((m) => m.type === type).map((m) => m.data as LiveMessages[K]),
  };
}

async function listen(app: App) {
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  const { port } = app.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => app.close(r)) };
}

function parseSse(text: string): { type: string; data: any }[] {
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => ({ type: must(b.match(/^event: (.+)$/m))[1] as string, data: JSON.parse(must(b.match(/^data: (.+)$/m))[1] as string) }));
}

const offline = (onRequest: (r: ChatRequest) => void = () => {}) =>
  model((r) => {
    onRequest(r);
    throw new Error('offline');
  }, 'spy');

test('live session streams every event in order, then state, items and an end summary', async () => {
  const rec = recorder();
  const session = new LiveSession({ seed: 8, home: 'ironvale', away: 'northgate', speed: 0, emit: rec.emit });
  await session.run();
  const events = rec.of('event');
  const match = simulateMatch({ seed: 8, home: 'ironvale', away: 'northgate' });
  assert.equal(must(rec.all[0]).type, 'meta');
  assert.equal(events.length, match.events.length);
  assert.ok(events.every((e, i) => i === 0 || e.t >= must(events[i - 1]).t));
  assert.ok(must(events.find((e) => e.type === 'pass')).player?.name, 'player names are resolved');
  assert.deepEqual(must(rec.of('state').pop()).score, match.score);
  const items = rec.of('item');
  const last = must(rec.all[rec.all.length - 1]);
  assert.equal(last.type, 'end');
  assert.equal(must(rec.of('end')[0]).items, items.length);
  assert.ok(items.some((i) => i.audience === 'analyst') && items.some((i) => i.audience === 'casual'));
  assert.ok(rec.of('trace').length > 0);
});

test('live session paces events by the match clock and stops on demand', async () => {
  let clock = 0;
  const waits: number[] = [];
  const sent: { type: string; at: number; t: number }[] = [];
  const session: LiveSession = new LiveSession({
    seed: 7,
    speed: 30,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
      if (waits.length === 50) session.stop();
    },
    emit: (type, data) => {
      sent.push({ type, at: clock, t: 't' in data ? Number(data.t) : NaN });
    },
  });
  await session.run();
  assert.equal(waits.length, 50);
  const events = sent.filter((o) => o.type === 'event');
  assert.ok(events.length > 50);
  // At 30x, an event at match second t goes out exactly t / 30 real seconds in.
  for (const e of events) assert.ok(Math.abs(e.at - (e.t * 1000) / 30) < 1e-6, `event at t=${e.t} sent at ${e.at} ms`);
  assert.ok(!sent.some((o) => o.type === 'end'), 'a stopped session sends nothing more');
});

test('favourite player gets a live player card and drives extra coverage', async () => {
  const rec = recorder();
  const audiences = audiencesFor({ language: 'English', favouriteClub: 'Harbour City', favouritePlayer: 'Leo Marchetti' });
  await new LiveSession({ seed: 7, speed: 0, audiences, emit: rec.emit }).run();
  const card = must(must(rec.of('state').pop()).favouritePlayer);
  assert.equal(card.name, 'Leo Marchetti');
  assert.ok(card.passes > 0);
  assert.ok(rec.of('trace').some((t) => t.detail === 'favourite player involved'));
});

test('recap prompt stays small enough for free-tier request limits', async () => {
  let recapChars = 0;
  const spy = offline((r) => {
    if (r.maxTokens === 700) recapChars = JSON.stringify(r.user).length + r.system.length;
  });
  for (const seed of [7, 8, 9, 10]) {
    const match = simulateMatch({ seed });
    const crew = new Crew({ meta: match.meta, llm: spy });
    for (const ev of match.events) await crew.onEvent(ev);
    assert.ok(recapChars > 0 && recapChars < 18000, `seed ${seed}: recap prompt ${recapChars} chars`);
  }
});

test('query parsing clamps and validates viewer input', () => {
  const q = (s: string) => parseLiveQuery(new URLSearchParams(s));
  assert.deepEqual(q(''), { seed: 7, home: 'harbour', away: 'ironvale', speed: 20, language: 'English', favouriteClub: null, favouritePlayer: null, focusMetric: null });
  assert.equal(q('metric=xg').focusMetric, 'xg');
  assert.equal(q('metric=__proto__').focusMetric, null);
  assert.equal(q('home=__proto__').home, 'harbour');
  assert.equal(q('seed=9').home, 'northgate');
  assert.equal(q('speed=99999').speed, 600);
  assert.equal(q('speed=-5').speed, 0);
  assert.equal(q('language=ar').language, 'Arabic');
  assert.equal(q('language=<script>').language, 'English');
  assert.notEqual(q('home=harbour&away=harbour').away, 'harbour');
  assert.equal(q('club=northgate').favouriteClub, null, 'a club not in the match is ignored');
  assert.equal(q('club=ironvale&player=ironvale-9').favouritePlayer, must(CLUBS.ironvale.players.find((p) => p.id === 'ironvale-9')).name);
  assert.equal(q('player=southmere-9').favouritePlayer, null);
});

test('server: health, config, static files and a full live stream', async () => {
  const publicDir = mkdtempSync(join(tmpdir(), 'mc-web-'));
  mkdirSync(join(publicDir, 'assets'));
  writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>Nutmeg Desk</title>');
  writeFileSync(join(publicDir, 'assets', 'app-abc123.js'), 'console.log(1)');
  const { base, close } = await listen(createApp({ modelLabel: 'test', publicDir }));
  try {
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.ok, true);
    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.fixtures.length, 4);
    assert.ok(config.languages.includes('Arabic'));
    assert.equal(config.metrics.length, Object.keys(METRICS).length);
    assert.equal(config.clubs.find((c: { id: string }) => c.id === 'harbour').players.length, 11);
    const page = await fetch(`${base}/`);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await page.text(), /Nutmeg Desk/);
    const asset = await fetch(`${base}/assets/app-abc123.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
    assert.equal((await fetch(`${base}/nope.js`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/api/config`, { method: 'POST' })).status, 405);

    const res = await fetch(`${base}/api/live?seed=7&speed=0&language=Spanish`);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const msgs = parseSse(await res.text());
    assert.equal(must(msgs[0]).type, 'meta');
    assert.equal(must(msgs[0]).data.audiences[0].language, 'Spanish');
    assert.equal(must(msgs[msgs.length - 1]).type, 'end');
    assert.ok(msgs.filter((m) => m.type === 'item').length >= 20);
  } finally {
    await close();
  }
});

test('server: refuses live sessions beyond the limit', async () => {
  const app = createApp({ maxSessions: 1 });
  const { base, close } = await listen(app);
  const controller = new AbortController();
  try {
    const first = await fetch(`${base}/api/live?speed=1`, { signal: controller.signal });
    assert.equal(first.status, 200);
    const second = await fetch(`${base}/api/live?speed=1`);
    assert.equal(second.status, 503);
    controller.abort();
    for (let i = 0; i < 50 && app.sessions.size; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(app.sessions.size, 0, 'a closed connection ends its session');
  } finally {
    controller.abort();
    await close();
  }
});

test('MCP: initialize, list tools and call them', async () => {
  const init = rpcResult(await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }));
  assert.equal(init.serverInfo.name, 'nutmeg-desk');
  assert.ok(init.capabilities.tools);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);

  const list = rpcResult(await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  const tools = list.tools as { name: string; inputSchema: { type: string } }[];
  assert.deepEqual(
    tools.map((t) => t.name),
    ['list_fixtures', 'match_summary', 'key_moments', 'player_stats', 'explain_moment'],
  );
  assert.ok(tools.every((t) => t.inputSchema.type === 'object'));

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = rpcResult(await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }));
    const text = r.content[0].text as string;
    return { error: Boolean(r.isError), text, data: r.isError ? null : JSON.parse(text) };
  };
  assert.equal((await call('match_summary', { seed: 7 })).data.match, 'Harbour City 4-1 Ironvale Athletic');
  const goals = (await call('key_moments', { seed: 7, type: 'goal' })).data as { id: string; evidence: string[] }[];
  assert.equal(goals.length, 5);
  assert.ok(goals.every((g) => g.evidence.length > 0));
  assert.equal((await call('player_stats', { seed: 7, player: 'kowalski' })).data.goals, 3);
  const explained = (await call('explain_moment', { seed: 7, momentId: must(goals[0]).id, persona: 'casual' })).data;
  assert.equal(explained.type, 'goal');
  assert.ok(explained.cites.every((id: string) => explained.evidence.some((e: { id: string }) => e.id === id)));
  assert.equal((await call('explain_moment', { seed: 7, momentId: 'm999' })).error, true);
  assert.equal((await call('player_stats', { seed: 7, player: 'Nobody Here' })).error, true);
  const bad = await call('match_summary', { seed: 'seven' });
  assert.equal(bad.error, true);
  assert.match(bad.text, /seed must be an integer/);
  assert.match((await call('match_summary', { seed: 7, home: 'realmadrid' })).text, /home must be one of/);

  assert.equal(rpcError(await handle({ jsonrpc: '2.0', id: 4, method: 'resources/list' })).code, -32601);
});

test('metric focus: live tracker values, extra coverage and metric-led prompts', async () => {
  const rec = recorder();
  const prompts: ChatRequest[] = [];
  const audiences = audiencesFor({ language: 'English', focusMetric: 'topSpeed' });
  await new LiveSession({ seed: 7, speed: 0, audiences, llm: offline((r) => prompts.push(r)), emit: rec.emit }).run();
  const metric = must(must(rec.of('state').pop()).metric);
  assert.equal(metric.id, 'topSpeed');
  assert.ok(Number(metric.home) > 0 && Number(metric.away) > 0 && metric.leaders?.length === 3);
  assert.ok(rec.of('trace').some((t) => t.detail === 'followed metric'));
  const narrator = must(prompts.find((p) => p.system.includes('Narrator')));
  assert.match(narrator.system, /Sprint speed/);
  const followed = must(evidenceOf(narrator).followedMetric) as { leaders: unknown[] };
  assert.ok(followed.leaders.length > 0, 'the metric values are in the pack, so the verifier allows them');
  assert.ok(!must(prompts.find((p) => p.system.includes('Tactician'))).system.includes('follow'), 'Tactician is unchanged');
});

test('audiences without a metric send exactly the same prompts as before (cache stays valid)', async () => {
  const capture = async (audiences: Audience[]) => {
    const prompts: string[] = [];
    const match = simulateMatch({ seed: 7 });
    const crew = new Crew({ meta: match.meta, llm: offline((r) => prompts.push(JSON.stringify(r))), audiences });
    for (const ev of match.events.slice(0, 500)) await crew.onEvent(ev);
    return prompts;
  };
  const plain = await capture(audiencesFor({ language: 'English' }));
  assert.ok(plain.length > 0);
  assert.ok(plain.every((p) => !p.includes('followedMetric')));
});

test('every metric reads cleanly from a finished match', () => {
  const state = replay(simulateMatch({ seed: 9, home: 'northgate', away: 'southmere' }));
  const snap = state.snapshot();
  for (const id of Object.keys(METRICS)) {
    const m = must(readMetric(id, snap, state));
    assert.equal(typeof m.home, 'number', id);
    assert.equal(typeof m.away, 'number', id);
  }
  assert.equal(readMetric('nope', snap, state), null);
});
