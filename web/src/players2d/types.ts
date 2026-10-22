// The parts of the live feed the 2D view uses, from the shared server types.
// Pitch coordinates are metres: x 0..105 along the pitch, y 0..68 across it.
import type { MatchMeta } from '../../../src/types.ts';

export type { LiveEvent, PlayerInfo } from '../../../src/types.ts';
export type Meta = Pick<MatchMeta, 'home' | 'away'>;
