// Fictional clubs and players. Nothing here refers to a real club or person.
// Each club has a style profile that drives how the simulator plays.
//
// Style fields (all 0..1):
//   press        how aggressively they press the ball when out of possession
//   directness   preference for long, forward passes over short recycling
//   tempo        how quickly they move the ball (shorter gaps between events)
//   width        how much they use the flanks
//   shootiness   willingness to shoot from distance

import type { Attributes, Club, PlayerProfile, Position } from '../types.ts';

// Formation slots in a 4-3-3, as a "home zone" in the team's attacking frame:
// x is 0 (own goal line) to 105 (opponent goal line), y is 0..68 across the pitch.
export const FORMATION_433: { pos: Position; x: number; y: number }[] = [
  { pos: 'GK', x: 5, y: 34 },
  { pos: 'RB', x: 30, y: 60 },
  { pos: 'CB', x: 22, y: 44 },
  { pos: 'CB', x: 22, y: 24 },
  { pos: 'LB', x: 30, y: 8 },
  { pos: 'DM', x: 40, y: 34 },
  { pos: 'CM', x: 52, y: 46 },
  { pos: 'CM', x: 52, y: 22 },
  { pos: 'RW', x: 75, y: 60 },
  { pos: 'ST', x: 82, y: 34 },
  { pos: 'LW', x: 75, y: 8 },
];

const ROLE_BASE: Record<Position, Attributes> = {
  GK: { passing: 55, dribbling: 20, finishing: 5, pace: 40, defending: 30 },
  RB: { passing: 68, dribbling: 62, finishing: 30, pace: 78, defending: 72 },
  LB: { passing: 68, dribbling: 62, finishing: 30, pace: 78, defending: 72 },
  CB: { passing: 64, dribbling: 45, finishing: 28, pace: 62, defending: 82 },
  DM: { passing: 78, dribbling: 60, finishing: 45, pace: 62, defending: 76 },
  CM: { passing: 80, dribbling: 70, finishing: 58, pace: 68, defending: 62 },
  RW: { passing: 72, dribbling: 82, finishing: 70, pace: 86, defending: 38 },
  LW: { passing: 72, dribbling: 82, finishing: 70, pace: 86, defending: 38 },
  ST: { passing: 66, dribbling: 74, finishing: 84, pace: 78, defending: 34 },
};

function squad(clubId: string, names: string[], tweaks: Record<number, Partial<Attributes>> = {}): PlayerProfile[] {
  return FORMATION_433.map((slot, i) => {
    const base = ROLE_BASE[slot.pos];
    const t = tweaks[i] || {};
    return {
      id: `${clubId}-${i + 1}`,
      shirt: i + 1,
      name: names[i] as string,
      pos: slot.pos,
      home: { x: slot.x, y: slot.y },
      passing: t.passing ?? base.passing,
      dribbling: t.dribbling ?? base.dribbling,
      finishing: t.finishing ?? base.finishing,
      pace: t.pace ?? base.pace,
      defending: t.defending ?? base.defending,
    };
  });
}

export type ClubId = 'harbour' | 'ironvale' | 'northgate' | 'southmere';

export const CLUBS: Record<ClubId, Club> = {
  harbour: {
    id: 'harbour',
    name: 'Harbour City',
    short: 'HBC',
    colors: { primary: '#1f6feb', secondary: '#ffffff' },
    style: { press: 0.8, directness: 0.35, tempo: 0.75, width: 0.6, shootiness: 0.45 },
    styleLabel: 'High press, quick combinations',
    players: squad('harbour', [
      'Tomas Vell', 'Kofi Asante', 'Rui Barros', 'Elias Brandt', 'Sami Okafor', 'Jonah Pike',
      'Mateo Ruiz', 'Arjun Mehta', 'Leo Marchetti', 'Dani Kowalski', 'Yusuf Demir',
    ], { 9: { finishing: 88 }, 6: { passing: 86 } }),
  },
  ironvale: {
    id: 'ironvale',
    name: 'Ironvale Athletic',
    short: 'IVA',
    colors: { primary: '#c2410c', secondary: '#111827' },
    style: { press: 0.35, directness: 0.75, tempo: 0.55, width: 0.45, shootiness: 0.6 },
    styleLabel: 'Deep block, direct counters',
    players: squad('ironvale', [
      'Bram Hollis', 'Nico Ferreira', 'Owen Lusk', 'Ade Bamidele', 'Finn Carver', 'Ivo Petrov',
      'Callum Reid', 'Hiro Tanaka', 'Marco Silvan', 'Zeke Mbeki', 'Luca Romero',
    ], { 8: { pace: 92 }, 9: { finishing: 82, pace: 84 } }),
  },
  northgate: {
    id: 'northgate',
    name: 'Northgate Rovers',
    short: 'NGR',
    colors: { primary: '#15803d', secondary: '#fef08a' },
    style: { press: 0.55, directness: 0.25, tempo: 0.45, width: 0.4, shootiness: 0.3 },
    styleLabel: 'Patient possession',
    players: squad('northgate', [
      'Pieter Aalst', 'Gabe Moreno', 'Theo Lindqvist', 'Malik Osei', 'Ravi Kapoor', 'Sven Dahl',
      'Ilan Cohen', 'Kai Nakamura', 'Andres Vega', 'Oscar Blum', 'Emre Kaya',
    ], { 6: { passing: 88 }, 7: { passing: 85 } }),
  },
  southmere: {
    id: 'southmere',
    name: 'Southmere United',
    short: 'SMU',
    colors: { primary: '#7c3aed', secondary: '#f5f5f4' },
    style: { press: 0.6, directness: 0.55, tempo: 0.65, width: 0.8, shootiness: 0.5 },
    styleLabel: 'Wing play and crosses',
    players: squad('southmere', [
      'Jan Novak', 'Felipe Cruz', 'Dmitri Volkov', 'Kwame Mensah', 'Alfie Grant', 'Nasser Haddad',
      'Rafa Ortega', 'Liam Doyle', 'Bruno Costa', 'Tariq Aziz', 'Joel Martin',
    ], { 8: { dribbling: 88 }, 10: { dribbling: 87 } }),
  },
};

export function isClubId(id: unknown): id is ClubId {
  return typeof id === 'string' && Object.hasOwn(CLUBS, id);
}

export function getClub(id: string): Club {
  const club = isClubId(id) ? CLUBS[id] : undefined;
  if (!club) throw new Error(`Unknown club: ${id}`);
  return club;
}
