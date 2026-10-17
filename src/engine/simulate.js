// Synthetic match simulator.
//
// Produces a football-realistic stream of timestamped events (passes, carries,
// pressure, tackles, interceptions, shots, possession changes) for two fictional
// clubs. Everything is driven by a seeded RNG, so the same seed always yields
// the same match.
//
// Coordinates: pitch is 105 x 68 metres. Event x/y are absolute pitch
// coordinates. The home team attacks towards x = 105 in the first half and
// the teams swap ends at half-time.

import { createRng } from './rng.js';
import { getClub } from './teams.js';

export const PITCH = { length: 105, width: 68 };
const GOAL = { x: 105, y: 34, width: 7.32 };
const HALF_SECONDS = 45 * 60;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// Expected goals from shot location (attacking frame), using distance and the
// angle the goal mouth subtends. Tuned so a central shot from the penalty spot
// is ~0.1, a close central shot ~0.4 and a 30m shot ~0.01.
export function expectedGoals(fx, fy, { pressured = false, header = false } = {}) {
  const d = dist(fx, fy, GOAL.x, GOAL.y);
  const a1 = Math.atan2(GOAL.y - GOAL.width / 2 - fy, GOAL.x - fx);
  const a2 = Math.atan2(GOAL.y + GOAL.width / 2 - fy, GOAL.x - fx);
  const angle = Math.abs(a2 - a1);
  let xg = 1 / (1 + Math.exp(-(-2.75 + 2.1 * angle - 0.08 * d)));
  if (pressured) xg *= 0.75;
  if (header) xg *= 0.6;
  return clamp(xg, 0.005, 0.95);
}

// Pass difficulty, 0 (trivial) .. 100 (very hard). Combines length, forward
// progress, pressure on the passer and how deep into the final third it goes.
export function passDifficulty({ distance, progress, pressured, endFx }) {
  let d = distance * 1.0;
  d += Math.max(0, progress) * 0.6;
  if (pressured) d += 18;
  if (endFx > 88) d += 12;
  else if (endFx > 70) d += 6;
  return clamp(Math.round(d), 0, 100);
}

export function simulateMatch({ seed = 1, home = 'harbour', away = 'ironvale', kickoff = '2026-10-24T15:00:00Z' } = {}) {
  const rng = createRng(seed);
  const clubs = { home: getClub(home), away: getClub(away) };
  const events = [];
  const score = { home: 0, away: 0 };
  let seq = 0;

  const other = (side) => (side === 'home' ? 'away' : 'home');
  const attacksRight = (side, period) => (side === 'home') === (period === 1);
  const toAbs = (side, period, fx, fy) =>
    attacksRight(side, period) ? { x: fx, y: fy } : { x: PITCH.length - fx, y: PITCH.width - fy };

  // Where a player is likely standing, in their own attacking frame, given
  // where the ball is. The whole block shifts up and down with the ball.
  const position = (player, ballFx) => {
    const shift = player.pos === 'GK' ? 0 : (ballFx - 52.5) * 0.45;
    return {
      x: clamp(player.home.x + shift + rng.normal(0, 4), 1, 104),
      y: clamp(player.home.y + rng.normal(0, 4), 1, 67),
    };
  };

  // Nearest opponent to the ball. Opponent frame is the mirror of ours.
  const nearestOpponent = (side, fx, fy) => {
    const opp = clubs[other(side)].players;
    let best = opp[0];
    let bestD = Infinity;
    for (const p of opp) {
      const pos = position(p, PITCH.length - fx);
      const d = dist(PITCH.length - pos.x, PITCH.width - pos.y, fx, fy) + rng.range(0, 6);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };

  let period = 1;
  let clock = 0; // seconds since the start of the current period
  let firstHalfLength = 0;
  // t is real elapsed playing time (always increasing, includes first-half
  // stoppage); minute is the match-clock minute as shown on a scoreboard.
  const elapsed = () => (period === 1 ? clock : firstHalfLength + clock);
  const matchMinute = () => (period === 1 ? Math.min(Math.floor(clock / 60) + 1, 45) : Math.min(Math.floor(clock / 60) + 46, 90));

  const emit = (type, side, fields) => {
    const ev = {
      id: `e${String(++seq).padStart(4, '0')}`,
      t: Math.round(elapsed()),
      clock: formatClock(period, clock),
      minute: matchMinute(),
      period,
      type,
      team: side ? clubs[side].id : null,
      ...fields,
    };
    events.push(ev);
    return ev;
  };

  // Possession state, in the attacking frame of the team in possession.
  let side = 'home';
  let fx = 52.5;
  let fy = 34;
  let carrier = null;
  let pressured = false;

  const changePossession = (newSide, cause, atFx, atFy, newCarrier) => {
    side = newSide;
    // Mirror into the new team's frame.
    fx = PITCH.length - atFx;
    fy = PITCH.width - atFy;
    carrier = newCarrier;
    pressured = false;
    const abs = toAbs(side, period, fx, fy);
    emit('possession_change', side, { player: carrier?.id ?? null, cause, x: round(abs.x), y: round(abs.y) });
  };

  const kickOff = (kickSide) => {
    side = kickSide;
    fx = 52.5;
    fy = 34;
    carrier = clubs[side].players.find((p) => p.pos === 'ST');
    pressured = false;
    const abs = toAbs(side, period, fx, fy);
    emit('kickoff', side, { player: carrier.id, x: round(abs.x), y: round(abs.y) });
  };

  const choosePassTarget = (team, style) => {
    const options = team.players.filter((p) => p.id !== carrier.id);
    return rng.weighted(options, (p) => {
      const pos = position(p, fx);
      const progress = pos.x - fx;
      const d = dist(fx, fy, pos.x, pos.y);
      if (p.pos === 'GK' && fx > 40) return 0.02;
      let w = 1;
      w *= progress > 0 ? 1 + (progress / 20) * (0.5 + style.directness) : 1 - Math.min(0.7, -progress / 60);
      w *= Math.exp(-d / (9 + 18 * style.directness));
      if (p.pos.endsWith('W') || p.pos.endsWith('B')) w *= 0.6 + style.width;
      return Math.max(w, 0.01);
    });
  };

  const doShot = (team, style) => {
    const xg = expectedGoals(fx, fy, { pressured });
    const abs = toAbs(side, period, fx, fy);
    const speed = round(rng.range(60, 95) + (carrier.finishing - 60) * 0.35);
    const finishingAdj = 0.75 + carrier.finishing / 320;
    const r = rng.next();
    let outcome;
    if (r < xg * finishingAdj) outcome = 'goal';
    else if (r < xg * finishingAdj + 0.22) outcome = 'blocked';
    else if (r < xg * finishingAdj + 0.22 + 0.33) outcome = 'saved';
    else outcome = 'off_target';

    const distance = dist(fx, fy, GOAL.x, GOAL.y);
    emit('shot', side, {
      player: carrier.id,
      x: round(abs.x),
      y: round(abs.y),
      outcome,
      xg: round(xg, 3),
      distance: round(distance),
      speedKmh: speed,
      pressured,
    });

    const opp = clubs[other(side)];
    const keeper = opp.players.find((p) => p.pos === 'GK');
    if (outcome === 'goal') {
      score[side] += 1;
      emit('goal', side, { player: carrier.id, x: round(abs.x), y: round(abs.y), xg: round(xg, 3), score: { ...score } });
      clock += rng.range(40, 70);
      kickOff(other(side));
    } else if (outcome === 'saved') {
      emit('save', other(side), { player: keeper.id, x: round(abs.x), y: round(abs.y) });
      changePossession(other(side), 'save', 102, 34, keeper);
    } else if (outcome === 'blocked') {
      const blocker = nearestOpponent(side, fx, fy);
      if (rng.chance(0.45)) {
        // Rebound stays with the attacking side.
        fx = clamp(fx - rng.range(5, 15), 60, 100);
        carrier = rng.pick(team.players.filter((p) => ['CM', 'RW', 'LW', 'ST'].includes(p.pos)));
      } else {
        changePossession(other(side), 'block', fx, fy, blocker);
      }
    } else {
      clock += rng.range(10, 25);
      changePossession(other(side), 'goal_kick', 100, 34, keeper);
    }
  };

  const step = () => {
    const team = clubs[side];
    const opp = clubs[other(side)];
    const style = team.style;
    clock += rng.range(1.8, 5) * (1.35 - style.tempo * 0.6);

    // Out-of-possession team decides whether to press.
    const inOppHalf = fx < 52.5;
    const pressChance = 0.08 + 0.3 * opp.style.press * (inOppHalf ? 1 : 0.55);
    pressured = rng.chance(pressChance);
    if (pressured) {
      const presser = nearestOpponent(side, fx, fy);
      const abs = toAbs(side, period, fx, fy);
      emit('pressure', other(side), { player: presser.id, target: carrier.id, x: round(abs.x), y: round(abs.y) });

      const tackleChance = 0.22 * (presser.defending / 75) * (1.1 - carrier.dribbling / 200);
      if (rng.chance(tackleChance)) {
        const foul = rng.chance(0.18);
        emit('tackle', other(side), {
          player: presser.id,
          target: carrier.id,
          x: round(abs.x),
          y: round(abs.y),
          outcome: foul ? 'foul' : 'won',
        });
        if (foul) {
          clock += rng.range(15, 35);
          pressured = false;
          return;
        }
        changePossession(other(side), 'tackle', fx, fy, presser);
        return;
      }
    }

    // Decide the action.
    const shootRange = fx > 78 && Math.abs(fy - 34) < 22;
    const longRange = fx > 68 && Math.abs(fy - 34) < 18;
    let shootP = 0;
    if (shootRange) shootP = 0.035 + 0.07 * style.shootiness + (fx > 90 ? 0.08 : 0);
    else if (longRange) shootP = 0.012 + 0.03 * style.shootiness;
    if (carrier.pos === 'GK') shootP = 0;

    if (rng.chance(shootP)) {
      doShot(team, style);
      return;
    }

    const carryP = 0.12 + (carrier.dribbling - 60) / 250;
    if (rng.chance(carryP) && carrier.pos !== 'GK') {
      const len = rng.range(4, 14);
      const nfx = clamp(fx + len, 1, 103);
      const nfy = clamp(fy + rng.normal(0, 5), 2, 66);
      const speed = round(16 + (carrier.pace / 100) * 16 + rng.normal(0, 2));
      const a = toAbs(side, period, fx, fy);
      const b = toAbs(side, period, nfx, nfy);
      emit('carry', side, {
        player: carrier.id,
        x: round(a.x), y: round(a.y), endX: round(b.x), endY: round(b.y),
        distance: round(dist(fx, fy, nfx, nfy)),
        speedKmh: speed,
        sprint: speed >= 27,
      });
      fx = nfx;
      fy = nfy;
      return;
    }

    // Pass.
    const target = choosePassTarget(team, style);
    const tpos = position(target, fx);
    const distance = dist(fx, fy, tpos.x, tpos.y);
    const progress = tpos.x - fx;
    const difficulty = passDifficulty({ distance, progress, pressured, endFx: tpos.x });
    const successP = clamp(0.99 - difficulty * 0.0042 + (carrier.passing - 70) * 0.004, 0.25, 0.98);
    const success = rng.chance(successP);
    const flight = 0.5 + distance / 22;
    const a = toAbs(side, period, fx, fy);
    const b = toAbs(side, period, tpos.x, tpos.y);
    const pass = {
      player: carrier.id,
      recipient: target.id,
      x: round(a.x), y: round(a.y), endX: round(b.x), endY: round(b.y),
      distance: round(distance),
      progress: round(progress),
      difficulty,
      speedKmh: round((distance / flight) * 3.6),
      pressured,
      outcome: success ? 'complete' : 'incomplete',
    };

    if (success) {
      emit('pass', side, pass);
      fx = tpos.x;
      fy = tpos.y;
      carrier = target;
      return;
    }

    // Failed pass: intercepted or out of play.
    if (rng.chance(0.5)) {
      const interceptor = nearestOpponent(side, tpos.x, tpos.y);
      const ix = clamp(fx + (tpos.x - fx) * rng.range(0.4, 0.9), 1, 104);
      const iy = clamp(fy + (tpos.y - fy) * rng.range(0.4, 0.9), 1, 67);
      const ia = toAbs(side, period, ix, iy);
      emit('pass', side, { ...pass, endX: round(ia.x), endY: round(ia.y), outcome: 'intercepted' });
      emit('interception', other(side), { player: interceptor.id, x: round(ia.x), y: round(ia.y) });
      changePossession(other(side), 'interception', ix, iy, interceptor);
    } else {
      emit('pass', side, { ...pass, outcome: 'out' });
      clock += rng.range(8, 20);
      const opp2 = clubs[other(side)];
      const taker = rng.pick(opp2.players.filter((p) => p.pos !== 'GK'));
      changePossession(other(side), 'throw_in', clamp(tpos.x, 2, 103), tpos.y < 34 ? 1 : 67, taker);
    }
  };

  const meta = {
    matchId: `syn-${home}-${away}-${seed}`,
    seed,
    kickoff,
    competition: 'Synthetic League',
    venue: `${clubs.home.name} Stadium`,
    synthetic: true,
    pitch: PITCH,
    home: summariseClub(clubs.home),
    away: summariseClub(clubs.away),
  };

  for (period = 1; period <= 2; period++) {
    clock = 0;
    const stoppage = rng.range(60, 300);
    kickOff(period === 1 ? 'home' : 'away');
    while (clock < HALF_SECONDS + stoppage) step();
    emit(period === 1 ? 'half_time' : 'full_time', null, { score: { ...score } });
    if (period === 1) firstHalfLength = clock;
  }

  return { meta, events, score: { ...score } };
}

function summariseClub(club) {
  return {
    id: club.id,
    name: club.name,
    short: club.short,
    colors: club.colors,
    style: club.style,
    styleLabel: club.styleLabel,
    players: club.players.map(({ id, shirt, name, pos }) => ({ id, shirt, name, pos })),
  };
}

function formatClock(period, clock) {
  const base = period === 1 ? 0 : 45;
  const mins = Math.floor(clock / 60);
  const secs = Math.floor(clock % 60);
  if (mins >= 45) return `${base + 45}+${mins - 45 + 1}'`;
  return `${String(base + mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
