// The match as animated players: a broadcast-style camera over 22 running figures
// in their club kits. Driven by the same live events as the tactics board; the
// feed only places the players involved in each action, and the rest move as a
// team (see players2d/world.ts). Animates on a canvas, outside React renders.
import { useEffect, useRef } from 'react';
import { Text } from '@fluentui/react-components';
import type { LiveEvent, LiveMeta } from '../../../src/types.ts';
import { World } from '../players2d/world.ts';
import { Renderer } from '../players2d/render.ts';

// Instant runs have no match pace; animate them as if at 20x.
const INSTANT_PACE = 20;
// Longest slice of match time per simulation step, so fast replays stay smooth.
const MAX_STEP = 0.05;
// A goal is held on screen this long in real seconds, at no more than GOAL_PACE,
// whatever the replay speed; events that arrive meanwhile wait, then catch up.
const GOAL_HOLD = 5;
const GOAL_PACE = 2;

interface Props {
  meta: LiveMeta | null;
  subscribe: (fn: (ev: LiveEvent) => void) => () => void;
  eventLog: () => LiveEvent[];
  idle: boolean;
}

export default function PlayersView({ meta, subscribe, eventLog, idle }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !meta) return;
    const world = new World(meta);
    const renderer = new Renderer(el, meta);
    // Opened mid-match: catch up on what already happened, then follow live.
    for (const ev of eventLog()) world.apply(ev);
    const pace = meta.speed || INSTANT_PACE;
    let held: LiveEvent[] = [];
    let goalAt = -Infinity;
    const unsubscribe = subscribe((ev) => {
      if (performance.now() - goalAt < GOAL_HOLD * 1000) return void held.push(ev);
      world.apply(ev);
      if (ev.type === 'goal') goalAt = performance.now();
    });
    const resize = new ResizeObserver(() => renderer.resize());
    resize.observe(el);
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const holding = now - goalAt < GOAL_HOLD * 1000;
      if (!holding && held.length) {
        for (const ev of held) world.apply(ev);
        held = [];
      }
      let left = dt * (holding ? Math.min(pace, GOAL_PACE) : pace);
      while (left > 0) {
        const step = Math.min(MAX_STEP, left);
        world.step(step);
        left -= step;
      }
      renderer.draw(world, dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      unsubscribe();
    };
  }, [meta, subscribe, eventLog]);

  return (
    <div className="players-view" data-tour="players">
      <canvas ref={canvas} aria-label="Animated match: players and ball" role="img" />
      {!meta && (
        <Text className="players-idle" align="center">
          {idle ? 'Kick off a match to watch the players. Real time or 3× looks most natural.' : 'Waiting for kick-off…'}
        </Text>
      )}
    </div>
  );
}
