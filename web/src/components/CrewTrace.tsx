import { Badge, Card, CardHeader, Caption1, Text, Tooltip } from '@fluentui/react-components';
import type { BadgeProps } from '@fluentui/react-components';
import { Bot20Regular } from '@fluentui/react-icons';
import type { TraceStatus } from '../../../src/types.ts';
import type { TraceRow } from '../useLiveMatch.ts';

const ORDER: TraceStatus[] = ['selected', 'skipped', 'ok', 'rejected', 'template', 'error', 'overlay'];
const COLOR: Record<TraceStatus, BadgeProps['color']> = {
  selected: 'success',
  skipped: 'subtle',
  ok: 'success',
  rejected: 'danger',
  error: 'danger',
  template: 'warning',
  overlay: 'informative',
};

export default function CrewTrace({ trace, counts }: { trace: TraceRow[]; counts: Partial<Record<TraceStatus, number>> }) {
  return (
    <Card className="crew-panel">
      <CardHeader
        image={<Bot20Regular />}
        header={<Text weight="semibold">Behind the broadcast</Text>}
        description={<Caption1 className="muted">What each agent is doing. Lines that fail the fact check are rejected before they air.</Caption1>}
      />
      <div className="crew-stats">
        {ORDER.filter((k) => counts[k]).map((k) => (
          <Badge key={k} appearance="tint" color={COLOR[k]}>
            {k} {counts[k]}
          </Badge>
        ))}
      </div>
      <ol className="trace" id="trace">
        {trace.map((r) => (
          <li key={r.key}>
            <Text weight="semibold" size={200} truncate wrap={false} className="agent">
              {r.agent}
            </Text>
            <Badge appearance="ghost" color={COLOR[r.status]} size="small" className="st">
              {r.status}
            </Badge>
            <Tooltip content={`${r.momentId} · ${r.detail}${r.ms ? ` · ${r.ms} ms` : ''}`} relationship="description">
              <Text size={200} truncate wrap={false} className="detail">
                {r.detail}
              </Text>
            </Tooltip>
          </li>
        ))}
      </ol>
    </Card>
  );
}
