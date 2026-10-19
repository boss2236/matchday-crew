// Metric focus: a viewing mode built around the one number a viewer cares about.
// Each metric says how to read it live from the match state, which key moments
// it should pull into coverage, and how the Narrator should lean into it.

export const METRICS = {
  xg: {
    label: 'Expected goals (xG)',
    unit: 'xG',
    momentTypes: ['goal', 'big_chance'],
    read: (snap) => ({ home: snap.home.xg, away: snap.away.xg }),
  },
  possession: {
    label: 'Possession',
    unit: '%',
    momentTypes: ['momentum_swing'],
    read: (snap) => ({ home: snap.home.possessionPct, away: snap.away.possessionPct }),
  },
  pressing: {
    label: 'Pressing (PPDA)',
    unit: 'PPDA',
    lowerIsBetter: true,
    momentTypes: ['pressing_spell'],
    read: (snap) => ({ home: snap.home.ppda, away: snap.away.ppda }),
  },
  passDifficulty: {
    label: 'Pass difficulty',
    unit: '/100 avg',
    momentTypes: ['great_pass'],
    read: (snap) => ({ home: snap.home.avgPassDifficulty, away: snap.away.avgPassDifficulty }),
  },
  shotSpeed: {
    label: 'Shot speed',
    unit: 'km/h max',
    momentTypes: ['goal', 'big_chance'],
    read: (snap) => ({ home: snap.home.maxShotSpeedKmh, away: snap.away.maxShotSpeedKmh }),
  },
  topSpeed: {
    label: 'Sprint speed',
    unit: 'km/h top',
    momentTypes: ['sprint'],
    read: (snap, state) => {
      const players = [...state.playerStats.values()].filter((p) => p.topSpeedKmh > 0).sort((a, b) => b.topSpeedKmh - a.topSpeedKmh);
      const best = (team) => players.find((p) => state.players.get(p.id)?.team === team)?.topSpeedKmh ?? 0;
      return {
        home: best(state.homeId),
        away: best(state.awayId),
        leaders: players.slice(0, 3).map((p) => ({ name: state.playerName(p.id), team: state.players.get(p.id)?.team, value: p.topSpeedKmh })),
      };
    },
  },
  momentum: {
    label: 'Momentum and chaos',
    unit: 'momentum',
    momentTypes: ['momentum_swing', 'pressing_spell'],
    read: (snap) => ({ home: Math.max(0, snap.momentum), away: Math.max(0, -snap.momentum), chaos: snap.chaos }),
  },
};

export const metricIds = Object.keys(METRICS);

export function readMetric(id, snap, state) {
  const m = METRICS[id];
  if (!m) return null;
  return { id, label: m.label, unit: m.unit, lowerIsBetter: Boolean(m.lowerIsBetter), t: snap.t, ...m.read(snap, state) };
}
