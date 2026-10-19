import { Text } from '@fluentui/react-components';
import { OverlayLayer, useOverlays } from './Overlays.tsx';
import type { FeedItem, LiveEvent, LiveMeta } from '../../../src/types.ts';

interface Props {
  meta: LiveMeta | null;
  trail: LiveEvent[];
  items: FeedItem[];
  events: Map<string, LiveEvent>;
  idle: boolean;
}

export default function Pitch({ meta, trail, items, events, idle }: Props) {
  const { active, highlight } = useOverlays(items);

  const side = (team: string | null) => (team === meta?.home.id ? 'home' : 'away');
  const last = trail[trail.length - 1];
  const cited = highlight ? highlight.cites.map((id) => events.get(id)).filter((e): e is LiveEvent => Boolean(e)) : [];
  const ring = highlight?.overlay.type === 'pressing_heatmap';
  const lines = highlight && (highlight.overlay.type === 'pass_trail' || highlight.overlay.type === 'goal_card');

  return (
    <div className="pitch-wrap" data-tour="pitch" style={{ ['--home' as string]: meta?.home.colors.primary, ['--away' as string]: meta?.away.colors.primary }}>
      <svg className="pitch" viewBox="-2 -2 109 72" role="img" aria-label="Pitch with the latest ball movement">
        <rect x="0" y="0" width="105" height="68" className="grass" />
        {Array.from({ length: 7 }, (_, i) => (
          <rect key={i} x={i * 15} y="0" width="7.5" height="68" className="stripe" />
        ))}
        <g className="lines">
          <rect x="0" y="0" width="105" height="68" />
          <line x1="52.5" y1="0" x2="52.5" y2="68" />
          <circle cx="52.5" cy="34" r="9.15" />
          <rect x="0" y="13.85" width="16.5" height="40.3" />
          <rect x="88.5" y="13.85" width="16.5" height="40.3" />
          <rect x="0" y="24.85" width="5.5" height="18.3" />
          <rect x="99.5" y="24.85" width="5.5" height="18.3" />
          <rect x="-1.5" y="30.34" width="1.5" height="7.32" />
          <rect x="105" y="30.34" width="1.5" height="7.32" />
        </g>
        <g>
          {lines &&
            cited.filter((ev) => ev.endX !== undefined).map((ev) => <line key={`l${ev.id}`} x1={ev.x} y1={ev.y} x2={ev.endX} y2={ev.endY} className="hl-pass" />)}
          {cited.map((ev) => (
            <circle key={`c${ev.id}`} cx={ev.x} cy={ev.y} r={ring ? 3 : 0.9} className={ring ? 'hl-ring' : 'hl-dot'} />
          ))}
        </g>
        <g>
          {trail.map((ev, i) => {
            const opacity = (i + 1) / trail.length;
            return (
              <g key={ev.id} opacity={opacity}>
                {ev.type === 'shot' ? (
                  <line x1={ev.x} y1={ev.y} x2={(ev.x ?? 0) > 52.5 ? 105 : 0} y2={34} className="shot-line" />
                ) : ev.endX !== undefined ? (
                  <line x1={ev.x} y1={ev.y} x2={ev.endX} y2={ev.endY} className={`trail-line ${side(ev.team)}`} />
                ) : null}
                <circle cx={ev.x} cy={ev.y} r={0.55} className="trail-dot" />
              </g>
            );
          })}
        </g>
        <circle className="ball" r={1.1} cx={last ? (last.endX ?? last.x) : 52.5} cy={last ? (last.endY ?? last.y) : 34} />
      </svg>

      <OverlayLayer active={active} />

      {idle && (
        <div className="idle">
          <Text as="p" block size={500} weight="semibold">
            Pick a match and press Kick off.
          </Text>
          <Text as="p" block className="muted">
            The crew watches every event, picks the moments that matter, explains why, and tells the story your way.
          </Text>
        </div>
      )}
    </div>
  );
}
