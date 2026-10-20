import { useEffect, useState } from 'react';
import { Card, CardHeader, Caption1, Text } from '@fluentui/react-components';
import { DataTrending20Regular, PersonStar20Regular } from '@fluentui/react-icons';
import type { LiveMeta, MetricReading, PlayerView } from '../../../src/types.ts';
import { useTeamColors } from '../teamColors.ts';

const PLAYER_CELLS: [key: keyof PlayerView, label: string][] = [
  ['goals', 'Goals'],
  ['xg', 'xG'],
  ['passesComplete', 'Passes done'],
  ['passAccuracyPct', 'Pass %'],
  ['topSpeedKmh', 'Top km/h'],
  ['carryDistance', 'Carried m'],
  ['tacklesWon', 'Tackles won'],
  ['interceptions', 'Intercepts'],
  ['involvement', 'Touches'],
];

export function FocusCard({ player, meta }: { player: PlayerView | null | undefined; meta: LiveMeta | null }) {
  const team = player && meta ? (player.team === meta.home.id ? meta.home.name : meta.away.name) : '';
  return (
    <Card className="focus">
      <CardHeader
        image={<PersonStar20Regular />}
        header={<Text weight="semibold">Player focus</Text>}
        description={<Caption1 className="muted">{player ? `${player.pos} · ${team}` : 'Waiting for kick-off'}</Caption1>}
      />
      {player && (
        <>
          <Text size={500} weight="bold">
            {player.shirt}. {player.name}
          </Text>
          <div className="focus-grid">
            {PLAYER_CELLS.map(([key, label]) => (
              <div key={key}>
                <Text weight="bold" size={500} block>
                  {String(player[key] ?? '–')}
                </Text>
                <Caption1>{label}</Caption1>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

interface Point {
  t: number;
  home: number;
  away: number;
}

export function MetricCard({ metric, meta, runId }: { metric: MetricReading | null | undefined; meta: LiveMeta | null; runId: number }) {
  const colors = useTeamColors(meta);
  const [history, setHistory] = useState<Point[]>([]);
  useEffect(() => setHistory([]), [runId]);
  useEffect(() => {
    if (!metric || typeof metric.home !== 'number' || typeof metric.away !== 'number') return;
    const { t, home, away } = metric;
    setHistory((h) => {
      const last = h[h.length - 1];
      return !last || t - last.t >= 30 ? [...h, { t, home, away }] : h;
    });
  }, [metric]);

  const maxT = Math.max(history[history.length - 1]?.t ?? 0, 60);
  const maxV = Math.max(...history.flatMap((p) => [p.home, p.away]), 1e-6);
  const points = (side: 'home' | 'away') => history.map((p) => `${(p.t / maxT) * 300},${66 - (p[side] / maxV) * 62}`).join(' ');
  const notes: string[] = [];
  if (metric?.lowerIsBetter) notes.push('Lower means a more intense press.');
  if (metric?.leaders?.length) notes.push(`Fastest: ${metric.leaders.map((l) => `${l.name} ${l.value} km/h`).join(', ')}.`);
  if (metric?.chaos !== undefined) notes.push(`Chaos index ${metric.chaos}.`);
  notes.push('The crew leads with this metric in your lines.');

  return (
    <Card className="metric-panel">
      <CardHeader
        image={<DataTrending20Regular />}
        header={<Text weight="semibold">Following: {metric?.label ?? 'metric'}</Text>}
        description={<Caption1 className="muted">{metric?.unit ?? ''}</Caption1>}
      />
      <div className="metric-values">
        {(['home', 'away'] as const).map((side) => (
          <div key={side}>
            <span className="dot" style={{ background: colors[side] }} />
            <Text size={600} weight="bold">
              {metric?.[side] ?? '–'}
            </Text>
            <Caption1 className="muted">{meta?.[side].short ?? side}</Caption1>
          </div>
        ))}
      </div>
      <svg className="spark" viewBox="0 0 300 70" preserveAspectRatio="none" role="img" aria-label="Metric over the match">
        {history.length > 1 && (
          <>
            <polyline points={points('home')} style={{ stroke: colors.home }} />
            <polyline points={points('away')} style={{ stroke: colors.away }} />
          </>
        )}
      </svg>
      <Caption1 className="muted">{notes.join(' ')}</Caption1>
    </Card>
  );
}
