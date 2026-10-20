import { Card, CardHeader, Caption1, Text } from '@fluentui/react-components';
import { ChartMultiple20Regular } from '@fluentui/react-icons';
import type { LiveMeta, LiveSnapshot, TeamSnapshot } from '../../../src/types.ts';
import { useTeamColors } from '../teamColors.ts';

const STATS: [key: keyof TeamSnapshot, label: string, lowerIsBetter?: boolean][] = [
  ['possessionPct', 'Possession %'],
  ['xg', 'Expected goals (xG)'],
  ['shots', 'Shots'],
  ['shotsOnTarget', 'On target'],
  ['passAccuracyPct', 'Pass accuracy %'],
  ['avgPassDifficulty', 'Avg pass difficulty'],
  ['progressivePasses', 'Progressive passes'],
  ['ppda', 'PPDA (lower = harder press)', true],
  ['tacklesWon', 'Tackles won'],
  ['interceptions', 'Interceptions'],
  ['maxShotSpeedKmh', 'Fastest shot km/h'],
];

export default function Stats({ snap, meta }: { snap: LiveSnapshot | null; meta: LiveMeta | null }) {
  const colors = useTeamColors(meta);
  return (
    <Card className="stats" aria-label="Team stats">
      <CardHeader
        image={<ChartMultiple20Regular />}
        header={<Text weight="semibold">Match stats</Text>}
        description={<Caption1 className="muted">{meta ? `${meta.home.short} vs ${meta.away.short}` : 'Live once the match starts'}</Caption1>}
      />
      <div>
        {STATS.map(([key, label, lowerIsBetter]) => {
          const h = snap ? Number(snap.home[key] ?? 0) : 0;
          const a = snap ? Number(snap.away[key] ?? 0) : 0;
          let hv = h;
          let av = a;
          if (lowerIsBetter && hv && av) [hv, av] = [1 / hv, 1 / av];
          const total = hv + av || 1;
          return (
            <div className="stat-row" key={key}>
              <Text weight="bold" className="v">{snap ? h : '–'}</Text>
              <div className="stat-mid">
                <Caption1 className="label">{label}</Caption1>
                <div className="stat-bar">
                  <div className="h" style={{ width: `${(hv / total) * 100}%`, background: colors.home }} />
                  <div className="a" style={{ width: `${(av / total) * 100}%`, background: colors.away }} />
                </div>
              </div>
              <Text weight="bold" className="v r">{snap ? a : '–'}</Text>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
