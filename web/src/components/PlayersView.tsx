// The match as animated players: 22 running figures in their club kits, drawn
// flat (a broadcast-style 2D camera on a canvas) or in 3D (a floodlit stadium,
// three.js, loaded only when picked). Driven by the same live events as the
// tactics board; the feed only places the players involved in each action, and
// the rest move as a team (see players2d/world.ts). Animates outside React renders.
import { useEffect, useRef, useState } from 'react';
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

export type PlayersMode = '2d' | '3d';

interface Painter {
  resize(): void;
  draw(world: World, dt: number): void;
  dispose?(): void;
}

interface Props {
  meta: LiveMeta | null;
  subscribe: (fn: (ev: LiveEvent) => void) => () => void;
  eventLog: () => LiveEvent[];
  idle: boolean;
  mode?: PlayersMode;
}

export default function PlayersView({ meta, subscribe, eventLog, idle, mode = '2d' }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !meta) return;
    let stopped = false;
    let painter: Painter | null = null;
    const world = new World(meta);
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
    const resize = new ResizeObserver(() => painter?.resize());
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
      painter?.draw(world, dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    setNotice(null);
    if (mode === '3d') {
      import('../players3d/scene.ts')
        .then(({ Scene3D }) => {
          if (!stopped) painter = new Scene3D(el, meta);
        })
        .catch(() => {
          // No WebGL (or the 3D code failed to load): say so; the canvas stays empty.
          if (!stopped) setNotice('3D needs WebGL, which this browser has turned off. Switch to Players for the 2D view.');
        });
    } else painter = new Renderer(el, meta);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      unsubscribe();
      painter?.dispose?.();
    };
  }, [meta, subscribe, eventLog, mode]);

  return (
    <div className="players-view" data-tour="players">
      {/* A canvas keeps the first kind of context it is given, so 2D and 3D each get their own. */}
      <canvas key={mode} ref={canvas} aria-label={`Animated match in ${mode === '3d' ? '3D' : '2D'}: players and ball`} role="img" />
      {(!meta || notice) && (
        <Text className="players-idle" align="center">
          {notice ?? (idle ? 'Kick off a match to watch the players. Real time or 3× looks most natural.' : 'Waiting for kick-off…')}
        </Text>
      )}
    </div>
  );
}
