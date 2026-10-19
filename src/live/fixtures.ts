// The fixtures offered in the app: the published dataset in data/ (seeds 7-10,
// same pairing as scripts/generate.ts) plus any seed the viewer asks for.

import { CLUBS } from '../engine/teams.ts';
import type { ClubId } from '../engine/teams.ts';
import type { AppConfig } from '../types.ts';

export interface Fixture {
  seed: number;
  home: ClubId;
  away: ClubId;
}

const clubIds = Object.keys(CLUBS) as ClubId[];

export function fixture(seed: number, i = 0): Fixture {
  return { seed, home: clubIds[i % clubIds.length] as ClubId, away: clubIds[(i + 1) % clubIds.length] as ClubId };
}

export const FIXTURES = [7, 8, 9, 10].map((seed, i) => fixture(seed, i));

export function clubSummary(): AppConfig['clubs'] {
  return Object.entries(CLUBS).map(([id, c]) => ({
    id,
    name: c.name,
    short: c.short,
    colors: c.colors,
    styleLabel: c.styleLabel,
    players: c.players.map((p) => ({ id: p.id, name: p.name, pos: p.pos, shirt: p.shirt })),
  }));
}
