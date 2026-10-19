// Broadcast overlays: each aired item shows for its duration in the screen
// position the Producer agent chose. Shared by the main app and Studio mode.
import { useEffect, useRef, useState } from 'react';
import { Badge, Caption1, Text } from '@fluentui/react-components';
import type { FeedItem } from '../../../src/types.ts';

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

export interface ActiveOverlay {
  item: FeedItem;
  leaving: boolean;
}

// Chips with the overlay's machine-readable data, as a renderer would show them.
export function chips(item: FeedItem): string[] {
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

// Turns newly aired items into timed overlays. Starts from what already aired,
// so remounting (switching persona) does not replay old overlays.
export function useOverlays(items: FeedItem[]) {
  const [active, setActive] = useState<ActiveOverlay[]>([]);
  const [highlight, setHighlight] = useState<FeedItem | null>(null);
  const seen = useRef(items.length);
  const timers = useRef<number[]>([]);

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
  return { active, highlight };
}

export function OverlayLayer({ active }: { active: ActiveOverlay[] }) {
  return (
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
  );
}
