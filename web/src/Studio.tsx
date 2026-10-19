// Studio mode: the crew's overlays on a transparent 16:9 page, for a browser
// source in streaming or production software (OBS, vMix) laid over a live match
// feed. Same options as the main app's deep links, plus:
//   bg=green|transparent  chroma green for tools without transparency
//   voice=1               read lines aloud
// Example: /studio?match=0&language=Arabic&persona=casual&speed=20
import { useEffect, useMemo, useState } from 'react';
import { Badge, Text } from '@fluentui/react-components';
import type { AppConfig, Persona } from '../../src/types.ts';
import { useLiveMatch } from './useLiveMatch.ts';
import { OverlayLayer, useOverlays } from './components/Overlays.tsx';
import { useVoice } from './useVoice.ts';

export default function Studio() {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const persona: Persona = q.get('persona') === 'casual' ? 'casual' : 'analyst';
  const language = q.get('language') ?? 'English';
  const live = useLiveMatch();
  const items = useMemo(() => live.items.filter((i) => i.audience === persona), [live.items, persona]);
  const { active } = useOverlays(items);
  const [azureVoice, setAzureVoice] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.view = q.get('bg') === 'green' ? 'studio-green' : 'studio';
    fetch('api/config')
      .then((r) => r.json())
      .then((config: AppConfig) => {
        setAzureVoice(config.speech);
        const index = Number(q.get('match') ?? 0);
        const fixture = config.fixtures[index] ?? config.fixtures[0];
        if (!fixture) return;
        const params = new URLSearchParams({ seed: String(fixture.seed), home: fixture.home, away: fixture.away, speed: q.get('speed') ?? '20', language });
        for (const k of ['club', 'player', 'metric']) {
          const v = q.get(k);
          if (v) params.set(k, v);
        }
        live.start(params);
      });
    // Start once on load.
  }, []);

  useVoice({ enabled: q.get('voice') === '1', items, language, azure: azureVoice });

  const m = live.snap?.momentum ?? 0;
  return (
    <div className="studio">
      {live.meta && (
        <div className="scorebug" aria-live="polite">
          <span className="sb-team" style={{ borderColor: live.meta.home.colors.primary }}>
            {live.meta.home.short}
          </span>
          <span className="sb-score">
            <span id="homeScore">{live.snap?.score.home ?? 0}</span>–<span id="awayScore">{live.snap?.score.away ?? 0}</span>
          </span>
          <span className="sb-team" style={{ borderColor: live.meta.away.colors.primary }}>
            {live.meta.away.short}
          </span>
          <span className="sb-clock" id="clock">
            {live.clock}
          </span>
          <span className="sb-momentum" title="Momentum">
            <span style={{ left: `${m >= 0 ? 50 : 50 + m / 2}%`, width: `${Math.abs(m) / 2}%`, background: m >= 0 ? live.meta.home.colors.primary : live.meta.away.colors.primary }} />
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
