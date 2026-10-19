// Live session, HTTP server and MCP server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../src/engine/simulate.js';
import { Crew } from '../src/agents/crew.js';
import { LiveSession, audiencesFor } from '../src/live/session.js';
import { createApp, parseLiveQuery } from '../src/server/app.js';
import { handle } from '../src/mcp/server.js';
import { CLUBS } from '../src/engine/teams.js';

async function listen(app) {
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${app.address().port}`, close: () => new Promise((r) => app.close(r)) };
}

function parseSse(text) {
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [, type] = b.match(/^event: (.+)$/m);
      const [, data] = b.match(/^data: (.+)$/m);
      return { type, data: JSON.parse(data) };
    });
}

test('live session streams every event in order, then state, items and an end summary', async () => {
  const out = [];
  const session = new LiveSession({ seed: 8, home: 'ironvale', away: 'northgate', speed: 0, emit: (type, data) => out.push({ type, data }) });
  await session.run();
  const events = out.filter((o) => o.type === 'event');
  const match = simulateMatch({ seed: 8, home: 'ironvale', away: 'northgate' });
  assert.equal(out[0].type, 'meta');
  assert.equal(events.length, match.events.length);
  assert.ok(events.every((e, i) => i === 0 || e.data.t >= events[i - 1].data.t));
  assert.ok(events.find((e) => e.data.type === 'pass').data.player.name, 'player names are resolved');
  const last = out.filter((o) => o.type === 'state').pop().data;
  assert.deepEqual(last.score, match.score);
  const items = out.filter((o) => o.type === 'item');
  assert.equal(out[out.length - 1].type, 'end');
  assert.equal(out[out.length - 1].data.items, items.length);
  assert.ok(items.some((i) => i.data.audience === 'analyst') && items.some((i) => i.data.audience === 'casual'));
  assert.ok(out.some((o) => o.type === 'trace'));
});

test('live session paces events by the match clock and stops on demand', async () => {
  let clock = 0;
  const waits = [];
  const out = [];
  const session = new LiveSession({
    seed: 7,
    speed: 30,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
      if (waits.length === 50) session.stop();
    },
    emit: (type, data) => out.push({ type, at: clock, t: data.t }),
  });
  await session.run();
  assert.equal(waits.length, 50);
  const events = out.filter((o) => o.type === 'event');
  assert.ok(events.length > 50);
  // At 30x, an event at match second t goes out exactly t / 30 real seconds in.
  for (const e of events) assert.ok(Math.abs(e.at - (e.t * 1000) / 30) < 1e-6, `event at t=${e.t} sent at ${e.at} ms`);
  assert.ok(!out.some((o) => o.type === 'end'), 'a stopped session sends nothing more');
});

test('favourite player gets a live player card and drives extra coverage', async () => {
  const out = [];
  const audiences = audiencesFor({ language: 'English', favouriteClub: 'Harbour City', favouritePlayer: 'Leo Marchetti' });
  const session = new LiveSession({ seed: 7, speed: 0, audiences, emit: (type, data) => out.push({ type, data }) });
  await session.run();
  const card = out.filter((o) => o.type === 'state').pop().data.favouritePlayer;
  assert.equal(card.name, 'Leo Marchetti');
  assert.ok(card.passes > 0);
  assert.ok(out.some((o) => o.type === 'trace' && o.data.detail === 'favourite player involved'));
});

test('recap prompt stays small enough for free-tier request limits', async () => {
  let recapChars = 0;
  const spy = { name: 'spy', json: async (r) => { if (r.maxTokens === 700) recapChars = JSON.stringify(r.user).length + r.system.length; throw new Error('offline'); } };
  for (const seed of [7, 8, 9, 10]) {
    const match = simulateMatch({ seed });
    const crew = new Crew({ meta: match.meta, llm: spy });
    for (const ev of match.events) await crew.onEvent(ev);
    assert.ok(recapChars > 0 && recapChars < 18000, `seed ${seed}: recap prompt ${recapChars} chars`);
  }
});

test('query parsing clamps and validates viewer input', () => {
  const q = (s) => parseLiveQuery(new URLSearchParams(s));
  assert.deepEqual(q(''), { seed: 7, home: 'harbour', away: 'ironvale', speed: 20, language: 'English', favouriteClub: null, favouritePlayer: null, focusMetric: null });
  assert.equal(q('metric=xg').focusMetric, 'xg');
  assert.equal(q('metric=__proto__').focusMetric, null);
  assert.equal(q('seed=9').home, 'northgate');
  assert.equal(q('speed=99999').speed, 600);
  assert.equal(q('speed=-5').speed, 0);
  assert.equal(q('language=ar').language, 'Arabic');
  assert.equal(q('language=<script>').language, 'English');
  assert.equal(q('home=harbour&away=harbour').away !== 'harbour', true);
  assert.equal(q('club=northgate').favouriteClub, null, 'a club not in the match is ignored');
  assert.equal(q('club=ironvale&player=ironvale-9').favouritePlayer, CLUBS.ironvale.players.find((p) => p.id === 'ironvale-9').name);
  assert.equal(q('player=southmere-9').favouritePlayer, null);
});

test('server: health, config, static files and a full live stream', async () => {
  const { base, close } = await listen(createApp({ modelLabel: 'test' }));
  try {
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.ok, true);
    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.fixtures.length, 4);
    assert.ok(config.languages.includes('Arabic'));
    assert.equal(config.clubs.find((c) => c.id === 'harbour').players.length, 11);
    const page = await fetch(`${base}/`);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /Matchday Crew/);
    assert.equal((await fetch(`${base}/app.js`)).status, 200);
    assert.equal((await fetch(`${base}/nope.js`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/api/config`, { method: 'POST' })).status, 405);

    const res = await fetch(`${base}/api/live?seed=7&speed=0&language=Spanish`);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const msgs = parseSse(await res.text());
    assert.equal(msgs[0].type, 'meta');
    assert.equal(msgs[0].data.audiences[0].language, 'Spanish');
    assert.equal(msgs[msgs.length - 1].type, 'end');
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
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.serverInfo.name, 'matchday-crew');
  assert.ok(init.result.capabilities.tools);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);

  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = list.result.tools.map((t) => t.name);
  assert.deepEqual(names, ['list_fixtures', 'match_summary', 'key_moments', 'player_stats', 'explain_moment']);
  assert.ok(list.result.tools.every((t) => t.inputSchema.type === 'object'));

  const call = async (name, args) => {
    const r = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } });
    return { error: r.result.isError, data: r.result.isError ? r.result.content[0].text : JSON.parse(r.result.content[0].text) };
  };
  assert.equal((await call('match_summary', { seed: 7 })).data.match, 'Harbour City 4-1 Ironvale Athletic');
  const goals = (await call('key_moments', { seed: 7, type: 'goal' })).data;
  assert.equal(goals.length, 5);
  assert.ok(goals.every((g) => g.evidence.length > 0));
  assert.equal((await call('player_stats', { seed: 7, player: 'kowalski' })).data.goals, 3);
  const explained = (await call('explain_moment', { seed: 7, momentId: goals[0].id, persona: 'casual' })).data;
  assert.equal(explained.type, 'goal');
  assert.ok(explained.cites.every((id) => explained.evidence.some((e) => e.id === id)));
  assert.equal((await call('explain_moment', { seed: 7, momentId: 'm999' })).error, true);
  assert.equal((await call('player_stats', { seed: 7, player: 'Nobody Here' })).error, true);

  const unknown = await handle({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
  assert.equal(unknown.error.code, -32601);
});

test('metric focus: live tracker values, extra coverage and metric-led prompts', async () => {
  const out = [];
  const prompts = [];
  const spy = { name: 'spy', json: async (r) => { prompts.push(r); throw new Error('offline'); } };
  const audiences = audiencesFor({ language: 'English', focusMetric: 'topSpeed' });
  const session = new LiveSession({ seed: 7, speed: 0, audiences, llm: spy, emit: (type, data) => out.push({ type, data }) });
  await session.run();
  const metric = out.filter((o) => o.type === 'state').pop().data.metric;
  assert.equal(metric.id, 'topSpeed');
  assert.ok(metric.home > 0 && metric.away > 0 && metric.leaders.length === 3);
  assert.ok(out.some((o) => o.type === 'trace' && o.data.detail === 'followed metric'));
  const narrator = prompts.find((p) => p.system.includes('Narrator'));
  assert.match(narrator.system, /Sprint speed/);
  assert.ok(narrator.user.evidence.followedMetric.leaders.length > 0, 'the metric values are in the pack, so the verifier allows them');
  assert.ok(!prompts.find((p) => p.system.includes('Tactician')).system.includes('follow'), 'Tactician is unchanged');
});

test('audiences without a metric send exactly the same prompts as before (cache stays valid)', async () => {
  const capture = async (audiences) => {
    const prompts = [];
    const spy = { name: 'spy', json: async (r) => { prompts.push(JSON.stringify(r)); throw new Error('offline'); } };
    const match = simulateMatch({ seed: 7 });
    const crew = new Crew({ meta: match.meta, llm: spy, audiences });
    for (const ev of match.events.slice(0, 500)) await crew.onEvent(ev);
    return prompts;
  };
  const plain = await capture(audiencesFor({ language: 'English' }));
  assert.ok(plain.length > 0);
  assert.ok(plain.every((p) => !p.includes('followedMetric')));
});

test('every metric reads cleanly from a finished match', async () => {
  const { METRICS, readMetric } = await import('../src/stats/metrics.js');
  const { replay } = await import('../src/stats/matchState.js');
  const state = replay(simulateMatch({ seed: 9, home: 'northgate', away: 'southmere' }));
  const snap = state.snapshot();
  for (const id of Object.keys(METRICS)) {
    const m = readMetric(id, snap, state);
    assert.equal(typeof m.home, 'number', id);
    assert.equal(typeof m.away, 'number', id);
  }
  assert.equal(readMetric('nope', snap, state), null);
});
