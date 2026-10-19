// The fixtures offered in the app: the published dataset in data/ (seeds 7-10,
// same pairing as scripts/generate.js) plus any seed the viewer asks for.

import { CLUBS } from '../engine/teams.js';

const clubIds = Object.keys(CLUBS);

export function fixture(seed, i = 0) {
  return { seed, home: clubIds[i % clubIds.length], away: clubIds[(i + 1) % clubIds.length] };
}

export const FIXTURES = [7, 8, 9, 10].map((seed, i) => fixture(seed, i));

export function clubSummary() {
  return Object.entries(CLUBS).map(([id, c]) => ({
    id,
    name: c.name,
    short: c.short,
    colors: c.colors,
    styleLabel: c.styleLabel,
    players: c.players.map((p) => ({ id: p.id, name: p.name, pos: p.pos, shirt: p.shirt })),
  }));
}
