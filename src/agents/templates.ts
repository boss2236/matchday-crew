// Deterministic fallback text. Used when no model is configured, when a model
// call fails, or when model output fails the grounding check twice. Every
// fact here comes straight from the evidence pack, so it always verifies.

import type { EvidencePack, MatchContext } from './evidence.ts';

// What every agent answer looks like, model-written or template.
export interface Line {
  headline: string;
  text: string;
  tags?: string[];
  cites: string[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function templateInsight(pack: EvidencePack): Line {
  const m = pack.moment;
  const d = m.data;
  const cites = pack.events.map((e) => e.id).slice(-3);
  const last = pack.events[pack.events.length - 1];
  switch (m.type) {
    case 'goal':
      return {
        headline: `${m.player} scores for ${m.team}`,
        text: `${m.player} finishes a ${d.buildUpPasses}-pass move${d.assist ? `, set up by ${d.assist}` : ''}. The chance was worth ${d.xg} xG.`,
        tags: ['goal'],
        cites,
      };
    case 'big_chance':
      return {
        headline: `Big chance for ${m.team}`,
        text: `${m.player} had a ${pct(d.xg ?? 0)} chance from ${d.distance}m and it was ${String(d.outcome).replace('_', ' ')}.`,
        tags: ['chance'],
        cites,
      };
    case 'pressing_spell':
      return {
        headline: `${m.team} win it back high`,
        text: `${m.team} won the ball back ${d.regains} times in the opponent's half inside ${(d.windowSeconds ?? 0) / 60} minutes.`,
        tags: ['pressing'],
        cites,
      };
    case 'momentum_swing':
      return {
        headline: `${m.team} take control`,
        text: `Momentum has swung to ${m.team}, with the momentum meter at ${Math.abs(d.momentum ?? 0)} and the chaos index at ${d.chaos}.`,
        tags: ['momentum'],
        cites,
      };
    case 'great_pass':
      return {
        headline: `Quality pass from ${m.player}`,
        text: `${m.player} found ${d.recipient} with a ${d.distance}m pass rated ${d.difficulty} out of 100 for difficulty.`,
        tags: ['pass'],
        cites,
      };
    case 'sprint':
      return {
        headline: `${m.player} at full speed`,
        text: `${m.player} hit ${d.speedKmh} km/h carrying the ball ${d.distance}m.`,
        tags: ['speed'],
        cites,
      };
    case 'half_time':
    case 'full_time':
      return {
        headline: `${m.type === 'half_time' ? 'Half-time' : 'Full-time'}: ${pack.match.home} ${pack.match.score} ${pack.match.away}`,
        text: `${m.type === 'half_time' ? 'Half-time' : 'Full-time'}: ${pack.match.home} ${pack.match.score} ${pack.match.away}.`,
        tags: [m.type],
        cites: [last?.id ?? m.id],
      };
    default:
      return { headline: m.type, text: `${m.type.replace('_', ' ')} at ${m.clock}.`, tags: [], cites };
  }
}

export function templateRecap(packs: EvidencePack[], match: MatchContext): Line {
  const goals = packs.filter((p) => p.moment.type === 'goal');
  const lines = goals.map((p) => `${p.moment.player} (${p.moment.minute}')`);
  const cites = packs.flatMap((p) => p.events.slice(-1).map((e) => e.id));
  return {
    headline: `${match.home} ${match.score} ${match.away}`,
    text:
      `${match.home} ${match.score} ${match.away}.` +
      (lines.length ? ` Goals: ${lines.join(', ')}.` : ' No goals.') +
      ` Possession ${match.stats[match.home].possessionPct}-${match.stats[match.away].possessionPct}, xG ${match.stats[match.home].xg}-${match.stats[match.away].xg}.`,
    cites: cites.length ? cites : ['none'],
  };
}
