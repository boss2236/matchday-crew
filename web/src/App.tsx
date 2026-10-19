import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, MessageBar, MessageBarBody, Spinner, Tab, TabList, Text, Title3, Tooltip } from '@fluentui/react-components';
import { SportSoccer24Filled, WeatherMoon20Regular, WeatherSunny20Regular } from '@fluentui/react-icons';
import type { AppConfig, Persona } from '../../src/types.ts';
import type { ThemeName } from './main.tsx';
import { useLiveMatch } from './useLiveMatch.ts';
import Controls from './components/Controls.tsx';
import type { Settings } from './components/Controls.tsx';
import Scoreboard from './components/Scoreboard.tsx';
import Pitch from './components/Pitch.tsx';
import Stats from './components/Stats.tsx';
import Feed from './components/Feed.tsx';
import CrewTrace from './components/CrewTrace.tsx';
import { FocusCard, MetricCard } from './components/FocusCards.tsx';

export default function App({ theme, onToggleTheme }: { theme: ThemeName; onToggleTheme: () => void }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [persona, setPersona] = useState<Persona>(() => (new URLSearchParams(location.search).get('persona') === 'casual' ? 'casual' : 'analyst'));
  const [settings, setSettings] = useState<Settings | null>(null);
  const live = useLiveMatch();

  useEffect(() => {
    fetch('api/config')
      .then((r) => r.json())
      .then((c: AppConfig) => setConfig(c))
      .catch(() => setConfigError('Cannot reach the server.'));
  }, []);

  const visible = useMemo(() => live.items.filter((i) => i.audience === persona), [live.items, persona]);

  const kickOff = (s: Settings) => {
    setSettings(s);
    const params = new URLSearchParams({ seed: String(s.fixture.seed), home: s.fixture.home, away: s.fixture.away, speed: s.speed, language: s.language });
    if (s.club) params.set('club', s.club);
    if (s.player) params.set('player', s.player);
    if (s.metric) params.set('metric', s.metric);
    live.start(params);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <SportSoccer24Filled />
          </span>
          <div>
            <Title3 as="h1" block>Matchday Crew</Title3>
            <Text size={200} block className="muted">AI broadcast crew · explainable match intelligence</Text>
          </div>
        </div>
        <div className="topbar-actions">
          <Tooltip content="Every club, player and match here is made up" relationship="description">
            <Badge appearance="tint" color="warning">Synthetic data</Badge>
          </Tooltip>
          <Tooltip content={theme === 'dark' ? 'Light theme' : 'Dark theme'} relationship="label">
            <Button appearance="subtle" icon={theme === 'dark' ? <WeatherSunny20Regular /> : <WeatherMoon20Regular />} onClick={onToggleTheme} />
          </Tooltip>
        </div>
      </header>

      {configError && (
        <MessageBar intent="error" className="gutter">
          <MessageBarBody>{configError}</MessageBarBody>
        </MessageBar>
      )}
      {!config && !configError && <Spinner className="gutter" label="Loading" />}
      {config && <Controls config={config} running={live.status === 'live'} hasRun={live.runId > 0} onKickOff={kickOff} />}
      {live.status === 'error' && (
        <MessageBar intent="warning" className="gutter">
          <MessageBarBody>{live.error}</MessageBarBody>
        </MessageBar>
      )}

      <Scoreboard meta={live.meta} snap={live.snap} clock={live.clock} />

      <main className="layout">
        <section className="stage" aria-label="Match view">
          <TabList selectedValue={persona} onTabSelect={(_, d) => setPersona(d.value as Persona)} aria-label="Who is watching" className="persona">
            <Tab value="analyst">Analyst</Tab>
            <Tab value="casual">Casual fan</Tab>
          </TabList>
          <Pitch
            key={`${live.runId}-${persona}`}
            meta={live.meta}
            trail={live.trail}
            items={visible}
            events={live.events}
            idle={live.status === 'idle'}
          />
          <div className="ticker" aria-label="Live events">
            {live.ticker.map((t) => (
              <span key={t.id} className={settings?.player && t.players.includes(settings.player) ? 'mine' : undefined}>
                <b>{t.clock}</b> {t.text}
              </span>
            ))}
          </div>
          <Stats snap={live.snap} meta={live.meta} />
        </section>

        <aside className="side">
          {settings?.player && <FocusCard player={live.snap?.favouritePlayer} meta={live.meta} />}
          {settings?.metric && <MetricCard metric={live.snap?.metric} meta={live.meta} runId={live.runId} />}
          <Feed items={visible} status={live.status} summary={live.summary} />
          <CrewTrace trace={live.trace} counts={live.counts} />
        </aside>
      </main>

      <footer className="foot">
        <Text size={200}>
          Model: {config?.model ?? 'none (templates)'} · Translator: {config?.translator ? 'Azure AI Translator' : 'off'}
        </Text>
        <Text size={200}>All clubs, players and matches are synthetic. Not affiliated with any real league.</Text>
      </footer>
    </div>
  );
}
