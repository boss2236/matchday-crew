import { useEffect, useRef, useState } from 'react';
import { Badge, Caption1, Text } from '@fluentui/react-components';
import type { FeedItem, LiveEvent, LiveMeta } from '../../../src/types.ts';

const OVERLAY_KICKER: Record<string, string> = {
  goal_card: 'Goal',
  chance_card: 'Big chance',
  pressing_heatmap: 'Pressing spell',
  momentum_bar: 'Momentum shift',
  pass_trail: 'Pass of the match',
  player_tag: 'Top speed',
  score_summary: 'Score',
  recap_panel: 'Full-time recap',
  info_card: 'Insight',
};

interface Props {
  meta: LiveMeta | null;
  trail: LiveEvent[];
  items: FeedItem[];
  events: Map<string, LiveEvent>;
  idle: boolean;
}

interface Active {
  item: FeedItem;
  leaving: boolean;
}

// Chips with the overlay's machine-readable data, as a renderer would show them.
function chips(item: FeedItem): string[] {
  const d = item.overlay.data as Record<string, any>;
  switch (item.overlay.type) {
    case 'goal_card':
      return [d.score && `Score ${d.score.home}-${d.score.away}`, d.xg !== undefined && `xG ${d.xg}`, d.assist && `Assist ${d.assist}`].filter(Boolean);
    case 'chance_card':
      return [`xG ${d.xg}`, String(d.outcome ?? '').replace('_', ' ')].filter(Boolean);
    case 'momentum_bar':
      return [`Momentum ${Math.abs(d.momentum)}`, `Chaos ${d.chaos}`];
    case 'pressing_heatmap':
      return [`${d.regains} high regains`];
    case 'pass_trail':
      return [d.to && `To ${d.to}`, `Difficulty ${d.difficulty}/100`, `${d.distance} m`].filter(Boolean);
    case 'player_tag':
      return [`${d.speedKmh} km/h`];
    default:
      return [];
  }
}

export default function Pitch({ meta, trail, items, events, idle }: Props) {
  const [active, setActive] = useState<Active[]>([]);
  const [highlight, setHighlight] = useState<FeedItem | null>(null);
  // Start from what already aired, so switching persona does not replay old overlays.
  const seen = useRef(items.length);
  const timers = useRef<number[]>([]);

  // New items become overlays for their duration, one per screen position.
  useEffect(() => {
    const fresh = items.slice(seen.current);
    seen.current = items.length;
    for (const item of fresh) {
      const pos = item.overlay.position;
      setActive((list) => [...(pos === 'full_screen' ? [] : list.filter((a) => a.item.overlay.position !== pos)), { item, leaving: false }]);
      setHighlight(item);
      const shown = Math.max(4000, item.overlay.durationMs);
      timers.current.push(
        window.setTimeout(() => setActive((list) => list.map((a) => (a.item === item ? { ...a, leaving: true } : a))), shown),
        window.setTimeout(() => {
          setActive((list) => list.filter((a) => a.item !== item));
          setHighlight((h) => (h === item ? null : h));
        }, shown + 350),
      );
    }
  }, [items]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const side = (team: string | null) => (team === meta?.home.id ? 'home' : 'away');
  const last = trail[trail.length - 1];
  const cited = highlight ? highlight.cites.map((id) => events.get(id)).filter((e): e is LiveEvent => Boolean(e)) : [];
  const ring = highlight?.overlay.type === 'pressing_heatmap';
  const lines = highlight && (highlight.overlay.type === 'pass_trail' || highlight.overlay.type === 'goal_card');

  return (
    <div className="pitch-wrap" style={{ ['--home' as string]: meta?.home.colors.primary, ['--away' as string]: meta?.away.colors.primary }}>
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

      <div className="overlay-layer" id="overlays" aria-live="polite">
        {active.map(({ item, leaving }) => (
          <div key={item.id} className={`ov ${item.overlay.position}${item.type === 'goal' ? ' goal' : ''}${leaving ? ' out' : ''}`}>
            <div className="kicker">
              <span>{OVERLAY_KICKER[item.overlay.type] ?? 'Insight'}</span>
              <Caption1 className="muted">{item.clock}</Caption1>
            </div>
            <Text as="p" block weight="bold" size={400} className="head" dir="auto">
              {item.headline}
            </Text>
            <Text as="p" block size={300} className="body" dir="auto">
              {item.text}
            </Text>
            {chips(item).length > 0 && (
              <div className="chips">
                {chips(item).map((c) => (
                  <Badge key={c} appearance="outline" shape="rounded" color="informative">
                    {c}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

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
