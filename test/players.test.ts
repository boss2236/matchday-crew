import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../src/engine/simulate.ts';
import { describeLiveEvent } from '../src/live/session.ts';
import { MatchState } from '../src/stats/matchState.ts';
import type { LiveEvent } from '../src/types.ts';
import { World } from '../web/src/players2d/world.ts';

// Plays a whole simulated match through the players view's World the way the
// page does: each event as the live feed sends it, small steps of match time in between.
function play(seed: number, check: (world: World, ev: LiveEvent) => void = () => {}) {
  const { meta, events: raw } = simulateMatch({ seed });
  const names = new MatchState(meta);
  const events = raw.map((ev) => describeLiveEvent(ev, names));
  const world = new World(meta);
  let t = 0;
  for (const ev of events) {
    while (t + 0.25 < ev.t) {
      world.step(0.25);
      t += 0.25;
    }
    world.apply(ev);
    check(world, ev);
  }
  return { world, meta, events };
}

test('players view: 22 players, and everyone stays on or by the pitch for a whole match', () => {
  play(7, (world) => {
    assert.equal(world.players.length, 22);
    for (const p of world.players) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${p.id} has a position`);
      assert.ok(p.x >= -2 && p.x <= 107 && p.y >= -2 && p.y <= 70, `${p.id} at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    assert.ok(Number.isFinite(world.ball.x) && Number.isFinite(world.ball.y));
  });
});

test('players view: at kick-off each team lines up in its own half, and swaps ends at half-time', () => {
  const halves: Record<number, { home: number; away: number }> = {};
  play(8, (world, ev) => {
    if (ev.type !== 'kickoff' || halves[world.period]) return;
    const keeper = (side: 'home' | 'away') => world.players.find((p) => p.side === side && p.gk)!.x;
    halves[world.period] = { home: keeper('home'), away: keeper('away') };
  });
  assert.ok(halves[1]!.home < 52.5 && halves[1]!.away > 52.5, 'home defends the left end first');
  assert.ok(halves[2]!.home > 52.5 && halves[2]!.away < 52.5, 'ends swap for the second half');
});

test('players view: a completed pass flies to the receiver, who then has the ball', () => {
  const { meta } = simulateMatch({ seed: 9 });
  const world = new World(meta);
  const [a, b] = meta.home.players.slice(5, 7);
  world.apply({ id: 'k', t: 0, clock: '00:00', minute: 0, period: 1, type: 'kickoff', team: meta.home.id, player: { id: a!.id, name: a!.name } } as LiveEvent);
  world.apply({ id: 'p', t: 1, clock: '00:01', minute: 1, period: 1, type: 'pass', team: meta.home.id, player: { id: a!.id, name: a!.name }, recipient: { id: b!.id, name: b!.name }, x: 52, y: 34, endX: 70, endY: 20, outcome: 'complete' } as LiveEvent);
  assert.ok(world.ball.flight, 'the ball is in the air');
  assert.equal(world.byId.get(a!.id)!.kick, 1, 'the passer kicks it');
  for (let i = 0; i < 40; i++) world.step(0.1);
  assert.equal(world.ball.carrier, b!.id);
  assert.ok(Math.hypot(world.ball.x - 70, world.ball.y - 20) < 4, 'the ball arrived where the pass went');
});

test('players view: a goal bulges the net at the end attacked, and the scorer is mobbed', () => {
  let checked = false;
  play(7, (world, ev) => {
    if (ev.type !== 'goal' || checked) return;
    checked = true;
    const side = world.sideOf(ev.team)!;
    assert.equal(world.celebrate?.scorer, ev.player?.id);
    assert.equal(world.netHit?.x, world.attacksRight(side) ? 105 : 0);
    for (let i = 0; i < 60; i++) world.step(0.1);
    const scorer = world.byId.get(ev.player!.id)!;
    const near = world.players.filter((p) => p.side === side && !p.gk && p !== scorer && Math.hypot(p.x - scorer.x, p.y - scorer.y) < 6);
    assert.ok(near.length >= 3, `${near.length} teammates reached the scorer`);
  });
  assert.ok(checked, 'the match has a goal');
});

test('players view: a save makes the keeper dive', () => {
  let dived = false;
  play(7, (world, ev) => {
    if (ev.type === 'save' && ev.player) dived ||= Boolean(world.byId.get(ev.player.id)?.dive);
  });
  assert.ok(dived);
});
