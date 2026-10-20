import { Text } from '@fluentui/react-components';
import { OverlayLayer, useOverlays } from './Overlays.tsx';
import type { FeedItem, LiveEvent, LiveMeta } from '../../../src/types.ts';
import type { PlayerSpot } from '../useLiveMatch.ts';
import { useTeamColors } from '../teamColors.ts';

interface Props {
  meta: LiveMeta | null;
  trail: LiveEvent[];
  players: Record<string, PlayerSpot>;
  onBall: string | null;
  focus: string | null;
  items: FeedItem[];
  events: Map<string, LiveEvent>;
  idle: boolean;
}

// The animated pitch: ball, recent passes and shots, and the events the current
// overlay cites. Used by the main app and by the broadcast view.
interface PitchSvgProps {
  meta: LiveMeta | null;
  trail: LiveEvent[];
  events: Map<string, LiveEvent>;
  highlight: FeedItem | null;
  players?: Record<string, PlayerSpot>;
  onBall?: string | null;
  focus?: string | null;
}

// Players fade once they have not touched the ball for a while (match seconds).
const FADE_AFTER = 240;

export function PitchSvg({ meta, trail, events, highlight, players = {}, onBall = null, focus = null }: PitchSvgProps) {
  const colors = useTeamColors(meta);
  const shirts = new Map([...(meta?.home.players ?? []), ...(meta?.away.players ?? [])].map((p) => [p.id, p.shirt]));
  const now = trail[trail.length - 1]?.t ?? 0;
  const spots = Object.values(players).filter((p) => now - p.t < FADE_AFTER * 2);
  const label = (onBall && players[onBall]) || null;
  const side = (team: string | null) => (team === meta?.home.id ? 'home' : 'away');
  const last = trail[trail.length - 1];
  // The ball sits with whoever has it; before anyone does, at the end of the last play.
  const ball = label ? { x: label.x + 1.4, y: label.y + 1.4 } : last ? { x: last.endX ?? last.x ?? 52.5, y: last.endY ?? last.y ?? 34 } : { x: 52.5, y: 34 };
  const cited = highlight ? highlight.cites.map((id) => events.get(id)).filter((e): e is LiveEvent => Boolean(e)) : [];
  const ring = highlight?.overlay.type === 'pressing_heatmap';
  const lines = highlight && (highlight.overlay.type === 'pass_trail' || highlight.overlay.type === 'goal_card');
  return (
    <svg
      className="pitch"
      viewBox="-2 -2 109 72"
      role="img"
      aria-label="Pitch with the latest ball movement"
      style={{ ['--home' as string]: colors.home, ['--away' as string]: colors.away }}
    >
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
              <circle cx={ev.x} cy={ev.y} r={0.4} className="trail-dot" />
            </g>
          );
        })}
      </g>
      <g className="players">
        {spots.map((p) => {
          const age = now - p.t;
          return (
            // Dot and number move together, so they never drift apart mid-animation.
            <g
              key={p.id}
              className={`player ${side(p.team)}${p.id === onBall ? ' on-ball' : ''}${p.id === focus ? ' focus' : ''}`}
              opacity={Math.max(0.25, 1 - age / FADE_AFTER)}
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
            >
              <circle r={1.9} />
              <text y={0.75}>{shirts.get(p.id) ?? ''}</text>
            </g>
          );
        })}
        {label && (
          <text className="player-label" style={{ transform: `translate(${label.x}px, ${label.y - 3}px)` }}>
            {shirts.get(label.id) ?? ''} {label.name}
          </text>
        )}
      </g>
      <circle className="ball" r={1.35} style={{ transform: `translate(${ball.x}px, ${ball.y}px)` }} />
    </svg>
  );
}

export default function Pitch({ meta, trail, items, events, idle, players, onBall, focus }: Props) {
  const { active, highlight } = useOverlays(items);
  return (
    <div className="pitch-wrap" data-tour="pitch">
      <PitchSvg meta={meta} trail={trail} events={events} highlight={highlight} players={players} onBall={onBall} focus={focus} />

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
