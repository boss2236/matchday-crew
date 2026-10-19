// Match intelligence as MCP tools. Any MCP client (GitHub Copilot agent mode,
// Claude, Foundry agents with MCP) can list fixtures, pull stats and key
// moments with their evidence, follow a player, and ask the crew to explain a
// moment for a given audience and language.
//
// Every match is regenerated from its seed, so answers are reproducible.

import { simulateMatch } from '../engine/simulate.js';
import { replay } from '../stats/matchState.js';
import { CLUBS } from '../engine/teams.js';
import { Crew } from '../agents/crew.js';
import { buildEvidence } from '../agents/evidence.js';
import { LANGUAGES } from '../ai/translator.js';
import { FIXTURES } from '../live/fixtures.js';

const clubEnum = Object.keys(CLUBS);
const matchArgs = {
  seed: { type: 'integer', description: 'Match seed. Seeds 7-10 are the published dataset.' },
  home: { type: 'string', enum: clubEnum, description: 'Home club id (optional for seeds 7-10)' },
  away: { type: 'string', enum: clubEnum, description: 'Away club id (optional for seeds 7-10)' },
};

function loadMatch({ seed = 7, home, away } = {}) {
  const fixed = FIXTURES.find((f) => f.seed === seed);
  const h = home ?? fixed?.home ?? 'harbour';
  const a = away ?? fixed?.away ?? (h === 'ironvale' ? 'harbour' : 'ironvale');
  if (h === a) throw new Error('home and away must be different clubs');
  return simulateMatch({ seed, home: h, away: a });
}

function findPlayer(state, query) {
  const q = String(query).toLowerCase();
  for (const [id, p] of state.players) if (id === query || p.name.toLowerCase() === q) return id;
  for (const [id, p] of state.players) if (p.name.toLowerCase().includes(q)) return id;
  return null;
}

export const TOOLS = [
  {
    name: 'list_fixtures',
    description: 'List the published synthetic fixtures and the clubs available. All data is synthetic.',
    inputSchema: { type: 'object', properties: {} },
    run: () => ({
      fixtures: FIXTURES.map((f) => ({ ...f, label: `${CLUBS[f.home].name} vs ${CLUBS[f.away].name}` })),
      clubs: clubEnum.map((id) => ({ id, name: CLUBS[id].name, style: CLUBS[id].styleLabel })),
    }),
  },
  {
    name: 'match_summary',
    description: 'Final score, scorers and full team stats (possession, xG, shots, pass accuracy and difficulty, PPDA, momentum, chaos) for a match.',
    inputSchema: { type: 'object', properties: matchArgs },
    run: (args) => {
      const match = loadMatch(args);
      const state = replay(match);
      const snap = state.snapshot();
      return {
        match: `${match.meta.home.name} ${snap.score.home}-${snap.score.away} ${match.meta.away.name}`,
        matchId: match.meta.matchId,
        goals: state.moments.filter((m) => m.type === 'goal').map((m) => ({ clock: m.clock, scorer: state.playerName(m.player), team: m.team === match.meta.home.id ? match.meta.home.name : match.meta.away.name })),
        [match.meta.home.name]: snap.home,
        [match.meta.away.name]: snap.away,
        topPlayers: state.topPlayers(3).map((p) => ({ name: p.name, goals: p.goals, xg: p.xg, passesComplete: p.passesComplete })),
        events: match.events.length,
      };
    },
  },
  {
    name: 'key_moments',
    description: 'Key moments detected in a match (goals, big chances, great passes, sprints, pressing spells, momentum swings) with the event ids that prove each one.',
    inputSchema: { type: 'object', properties: { ...matchArgs, type: { type: 'string', description: 'Only this moment type, e.g. goal or momentum_swing' } } },
    run: (args) => {
      const state = replay(loadMatch(args));
      return state.moments
        .filter((m) => !args.type || m.type === args.type)
        .map((m) => ({ id: m.id, clock: m.clock, type: m.type, importance: m.importance, player: m.player ? state.playerName(m.player) : null, data: m.data, evidence: m.evidence }));
    },
  },
  {
    name: 'player_stats',
    description: 'Full-match stats for one player, by name or id: passes, pass accuracy, shots, xG, goals, top speed, carry distance, defensive actions.',
    inputSchema: { type: 'object', properties: { ...matchArgs, player: { type: 'string', description: 'Player name or id' } }, required: ['player'] },
    run: (args) => {
      const state = replay(loadMatch(args));
      const id = findPlayer(state, args.player);
      if (!id) throw new Error(`no player matching "${args.player}" in this match`);
      return state.playerView(id);
    },
  },
  {
    name: 'explain_moment',
    description: 'Ask the crew (Tactician, Narrator, Verifier) to explain why a key moment matters, for an analyst or a casual fan, in a chosen language. Output is fact-checked against the evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        ...matchArgs,
        momentId: { type: 'string', description: 'Moment id from key_moments, e.g. m004' },
        persona: { type: 'string', enum: ['analyst', 'casual'] },
        language: { type: 'string', enum: Object.keys(LANGUAGES) },
      },
      required: ['momentId'],
    },
    run: async (args, { llm = null, translator = null } = {}) => {
      const match = loadMatch(args);
      const audience = { id: args.persona ?? 'analyst', persona: args.persona ?? 'analyst', language: args.language ?? 'English' };
      const crew = new Crew({ meta: match.meta, llm, translator, audiences: [audience] });
      for (const ev of match.events) {
        crew.eventsById.set(ev.id, ev);
        const moment = crew.state.apply(ev).find((m) => m.id === args.momentId);
        if (moment) {
          const [item] = await crew.cover(moment);
          const pack = buildEvidence(moment, crew.state, crew.eventsById);
          return { clock: item.clock, type: item.type, headline: item.headline, text: item.text, source: item.source, cites: item.cites, evidence: pack.events, trace: crew.trace.filter((r) => r.momentId === moment.id) };
        }
      }
      throw new Error(`moment ${args.momentId} not found in this match`);
    },
  },
];

export async function callTool(name, args = {}, ctx = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.run(args, ctx);
}
