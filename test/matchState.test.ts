import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../src/engine/simulate.ts';
import { MatchState, replay } from '../src/stats/matchState.ts';

test('replayed score matches the simulator', () => {
  for (const seed of [1, 7, 19]) {
    const m = simulateMatch({ seed });
    assert.deepEqual(replay(m).snapshot().score, m.score);
  }
});

test('possession adds up to 100%', () => {
  const snap = replay(simulateMatch({ seed: 11 })).snapshot();
  const total = snap.home.possessionPct + snap.away.possessionPct;
  assert.ok(total >= 99 && total <= 101, `possession total ${total}`);
});

test('every goal becomes a moment with evidence that exists', () => {
  const m = simulateMatch({ seed: 7 });
  const ids = new Set(m.events.map((e) => e.id));
  const state = replay(m);
  const goals = state.moments.filter((x) => x.type === 'goal');
  assert.equal(goals.length, m.score.home + m.score.away);
  for (const mo of state.moments) {
    assert.ok(mo.evidence.length > 0, `${mo.id} has no evidence`);
    for (const id of mo.evidence) assert.ok(ids.has(id), `${mo.id} cites missing event ${id}`);
  }
});

test('momentum and chaos stay in range during a live replay', () => {
  const m = simulateMatch({ seed: 4 });
  const state = new MatchState(m.meta);
  for (const ev of m.events) {
    state.apply(ev);
    const s = state.snapshot();
    assert.ok(s.momentum >= -100 && s.momentum <= 100);
    assert.ok(s.chaos >= 0 && s.chaos <= 100);
  }
});

test('apply returns only the moments that event triggered', () => {
  const m = simulateMatch({ seed: 9 });
  const state = new MatchState(m.meta);
  let total = 0;
  for (const ev of m.events) total += state.apply(ev).length;
  assert.equal(total, state.moments.length);
});
