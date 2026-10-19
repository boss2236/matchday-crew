import { Badge, Card, Caption1, Text, Tooltip } from '@fluentui/react-components';
import { Timer20Regular } from '@fluentui/react-icons';
import type { LiveMeta, LiveSnapshot } from '../../../src/types.ts';

interface Props {
  meta: LiveMeta | null;
  snap: LiveSnapshot | null;
  clock: string;
}

export default function Scoreboard({ meta, snap, clock }: Props) {
  const m = snap?.momentum ?? 0;
  const chaos = snap?.chaos ?? 0;
  const homeColor = meta?.home.colors.primary ?? 'var(--colorBrandBackground)';
  const awayColor = meta?.away.colors.primary ?? 'var(--colorPaletteDarkOrangeBackground3)';
  return (
    <Card className="scoreboard gutter" aria-live="polite">
      <div className="score-row">
        <div className="team">
          <span className="swatch" style={{ background: homeColor }} />
          <Text weight="semibold" size={500} truncate wrap={false} className="team-name">
            {meta?.home.name ?? 'Home'}
          </Text>
        </div>
        <div className="score">
          <span id="homeScore">{snap?.score.home ?? 0}</span>
          <span className="dash">–</span>
          <span id="awayScore">{snap?.score.away ?? 0}</span>
          <Badge id="clock" appearance="tint" color="success" icon={<Timer20Regular />} className="clock">
            {clock}
          </Badge>
        </div>
        <div className="team away">
          <Text weight="semibold" size={500} truncate wrap={false} className="team-name">
            {meta?.away.name ?? 'Away'}
          </Text>
          <span className="swatch" style={{ background: awayColor }} />
        </div>
      </div>
      <div className="meters">
        <Tooltip content="Who is on top over the last five minutes: shots, xG, final-third entries and regains" relationship="description">
          <div className="meter">
            <Caption1 className="meter-label">Momentum</Caption1>
            <div className="momentum" role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={m} aria-label="Momentum, positive favours the home side">
              <div
                className="momentum-fill"
                style={{ left: `${m >= 0 ? 50 : 50 + m / 2}%`, width: `${Math.abs(m) / 2}%`, background: m >= 0 ? homeColor : awayColor }}
              />
            </div>
          </div>
        </Tooltip>
        <Tooltip content="How often the ball changes hands and how much play is under pressure" relationship="description">
          <div className="meter">
            <Caption1 className="meter-label">Control ↔ Chaos · {chaos}</Caption1>
            <div className="chaos" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={chaos} aria-label="Chaos index">
              <div className="chaos-fill" style={{ width: `${chaos}%` }} />
            </div>
          </div>
        </Tooltip>
      </div>
    </Card>
  );
}
