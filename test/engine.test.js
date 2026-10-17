import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch, expectedGoals, passDifficulty } from '../src/engine/simulate.js';

test('same seed gives the same match', () => {
  const a = simulateMatch({ seed: 42 });
  const b = simulateMatch({ seed: 42 });
  assert.deepEqual(a, b);
});

test('different seeds give different matches', () => {
  const a = simulateMatch({ seed: 1 });
  const b = simulateMatch({ seed: 2 });
  assert.notDeepEqual(a.events, b.events);
});

test('events are ordered in time and stay on the pitch', () => {
  const { events } = simulateMatch({ seed: 3 });
  for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t, `event ${events[i].id} goes back in time`);
  for (const e of events) {
    if (e.x === undefined) continue;
    assert.ok(e.x >= 0 && e.x <= 105 && e.y >= 0 && e.y <= 68, `event ${e.id} off the pitch`);
  }
});

test('match has both halves and a final score matching the goals', () => {
  const m = simulateMatch({ seed: 5 });
  const types = m.events.map((e) => e.type);
  assert.equal(types.filter((t) => t === 'kickoff').length >= 2, true);
  assert.ok(types.includes('half_time'));
  assert.equal(types[types.length - 1], 'full_time');
  const goals = m.events.filter((e) => e.type === 'goal');
  assert.equal(goals.length, m.score.home + m.score.away);
});

test('aggregate stats over many matches look like real football', () => {
  let goals = 0, shots = 0, passes = 0, complete = 0;
  const n = 60;
  for (let s = 1; s <= n; s++) {
    const m = simulateMatch({ seed: s });
    for (const e of m.events) {
      if (e.type === 'goal') goals++;
      if (e.type === 'shot') shots++;
      if (e.type === 'pass') { passes++; if (e.outcome === 'complete') complete++; }
    }
  }
  const gpm = goals / n;
  const spm = shots / n;
  const acc = complete / passes;
  assert.ok(gpm > 1.8 && gpm < 4.5, `goals per match ${gpm}`);
  assert.ok(spm > 15 && spm < 35, `shots per match ${spm}`);
  assert.ok(acc > 0.72 && acc < 0.9, `pass accuracy ${acc}`);
});

test('xG rises as shots get closer and more central', () => {
  assert.ok(expectedGoals(100, 34) > expectedGoals(94, 34));
  assert.ok(expectedGoals(94, 34) > expectedGoals(80, 34));
  assert.ok(expectedGoals(94, 34) > expectedGoals(94, 10));
  assert.ok(expectedGoals(94, 34, { pressured: true }) < expectedGoals(94, 34));
});

test('pass difficulty grows with length, progress and pressure', () => {
  const base = { distance: 10, progress: 0, pressured: false, endFx: 50 };
  assert.ok(passDifficulty({ ...base, distance: 40 }) > passDifficulty(base));
  assert.ok(passDifficulty({ ...base, progress: 25 }) > passDifficulty(base));
  assert.ok(passDifficulty({ ...base, pressured: true }) > passDifficulty(base));
  assert.ok(passDifficulty({ ...base, distance: 500 }) <= 100);
});
