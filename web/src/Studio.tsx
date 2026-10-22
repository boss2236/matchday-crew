// Broadcast view: what a viewer at home sees. The live (synthetic) match drawn
// full-screen with a scorebug and the crew's graphics, no controls. Same
// options as the main app's deep links, plus:
//   bg=transparent        only the graphics, for layering in broadcast software
//                         (OBS, vMix) over a video whose events come from the same feed
//   bg=green              the graphics on chroma green, for tools without transparency
//   voice=1               read lines aloud
// Example: /studio?match=0&language=Arabic&persona=casual&speed=20
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Text } from '@fluentui/react-components';
import type { AppConfig, Persona } from '../../src/types.ts';
import { useLiveMatch } from './useLiveMatch.ts';
import { OverlayLayer, useOverlays } from './components/Overlays.tsx';
import { PitchSvg } from './components/Pitch.tsx';
import PlayersView from './components/PlayersView.tsx';
import type { CameraMode } from './components/PlayersView.tsx';
import { useVoice } from './useVoice.ts';
import { useTeamColors } from './teamColors.ts';

export default function Studio() {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const persona: Persona = q.get('persona') === 'casual' ? 'casual' : 'analyst';
  const language = q.get('language') ?? 'English';
  const live = useLiveMatch();
  const items = useMemo(() => live.items.filter((i) => i.audience === persona), [live.items, persona]);
  const { active, highlight } = useOverlays(items);
  // The match picture is the default; animated players (flat or 3D), transparent and green are opt-in.
  const bg = ['transparent', 'green', 'players', '3d'].includes(q.get('bg') ?? '') ? q.get('bg') : 'pitch';
  const players = bg === 'players' || bg === '3d';
  const [azureVoice, setAzureVoice] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.view = bg === 'green' ? 'studio-green' : bg === 'pitch' || players ? 'studio-pitch' : 'studio';
    fetch('api/config')
      .then((r) => r.json())
      .then((config: AppConfig) => {
        setAzureVoice(config.speech);
        const index = Number(q.get('match') ?? 0);
        const fixture = config.fixtures[index] ?? config.fixtures[0];
        if (!fixture) return;
        const params = new URLSearchParams({ seed: String(fixture.seed), home: fixture.home, away: fixture.away, speed: q.get('speed') ?? '20', language });
        for (const k of ['club', 'player', 'metric', 'from']) {
          const v = q.get(k);
          if (v) params.set(k, v);
        }
        live.start(params);
      });
    // Start once on load.
  }, []);

  const { blocked, unblock } = useVoice({ enabled: q.get('voice') === '1', items, language, azure: azureVoice });
  // OBS's browser source exposes window.obsstudio. Anywhere else, show how to
  // use the page and a checkerboard so the transparent background is obvious.
  const inObs = 'obsstudio' in window;
  const preview = !inObs && bg !== 'green' && bg !== 'pitch' && !players;

  const m = live.snap?.momentum ?? 0;
  // The broadcast view always sits on the dark pitch: the dark-surface club colours.
  const colors = useTeamColors(live.meta);
  return (
    <div className={`studio${preview ? ' studio-preview' : ''}`}>
      {bg === 'pitch' && (
        <div className="studio-stage">
          <PitchSvg meta={live.meta} trail={live.trail} events={live.events} highlight={highlight} players={live.players} onBall={live.onBall} focus={q.get('player')} />
          <span className="studio-label">Synthetic match · simulated feed</span>
        </div>
      )}
      {players && (
        <div className="studio-stage">
          <PlayersView
            mode={bg === '3d' ? '3d' : '2d'}
            initialCamera={q.get('cam') === 'tactical' || q.get('cam') === 'follow' ? (q.get('cam') as CameraMode) : 'broadcast'}
            cameraPicker={false}
            meta={live.meta}
            subscribe={live.subscribe}
            eventLog={live.eventLog}
            idle={false}
          />
          <span className="studio-label">Synthetic match · simulated feed</span>
        </div>
      )}
      {preview && (
        <div className="studio-help" role="note">
          <Text weight="semibold" block>
            Transparent graphics for broadcast software
          </Text>
          <Text size={200} block>
            In OBS: Sources → + → Browser → paste this page's URL, width 1920, height 1080. The checkerboard is transparent there and this note is hidden. The lines
            describe this page's synthetic match, so they will not match other footage: remove bg=transparent to see the match itself, &amp;bg=green for a green screen,
            &amp;voice=1 for commentary.
          </Text>
        </div>
      )}
      {blocked && (
        <Button className="studio-sound" appearance="primary" onClick={unblock}>
          Click to allow sound
        </Button>
      )}
      {live.meta && (
        <div className="scorebug" aria-live="polite">
          <span className="sb-team" style={{ borderColor: colors.home }}>
            {live.meta.home.short}
          </span>
          <span className="sb-score">
            <span id="homeScore">{live.snap?.score.home ?? 0}</span>–<span id="awayScore">{live.snap?.score.away ?? 0}</span>
          </span>
          <span className="sb-team" style={{ borderColor: colors.away }}>
            {live.meta.away.short}
          </span>
          <span className="sb-clock" id="clock">
            {live.clock}
          </span>
          <span className="sb-momentum" title="Momentum">
            <span style={{ left: `${m >= 0 ? 50 : 50 + m / 2}%`, width: `${Math.abs(m) / 2}%`, background: m >= 0 ? colors.home : colors.away }} />
          </span>
        </div>
      )}
      <OverlayLayer active={active} />
      {live.status === 'ended' && (
        <Badge className="studio-end" appearance="filled" color="brand">
          Full time
        </Badge>
      )}
      {live.status === 'error' && <Text className="studio-end">{live.error}</Text>}
    </div>
  );
}
