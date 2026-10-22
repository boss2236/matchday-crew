import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, MessageBar, MessageBarBody, Spinner, Switch, Tab, TabList, Text, Title3, Tooltip } from '@fluentui/react-components';
import { Info16Regular, SportSoccer24Filled, Video20Regular, WeatherMoon20Regular, WeatherSunny20Regular, QuestionCircle20Regular } from '@fluentui/react-icons';
import type { AppConfig, Persona } from '../../src/types.ts';
import type { ThemeName } from './teamColors.ts';
import { useLiveMatch } from './useLiveMatch.ts';
import Controls from './components/Controls.tsx';
import type { Settings } from './components/Controls.tsx';
import Scoreboard from './components/Scoreboard.tsx';
import Pitch from './components/Pitch.tsx';
import PlayersView from './components/PlayersView.tsx';
import Stats from './components/Stats.tsx';
import Feed from './components/Feed.tsx';
import CrewTrace from './components/CrewTrace.tsx';
import MatchCharts from './components/MatchCharts.tsx';
import { FocusCard, MetricCard } from './components/FocusCards.tsx';
import { TourOffer, TourSteps, useTour } from './components/Tour.tsx';
import { useBrowserVoices, useVoice, voiceSupport } from './useVoice.ts';

type View = 'board' | 'players' | '3d';

// The server's model label, short enough for the footer: 'model "x" at https://host/v1' -> 'x (host)'.
const modelName = (label: string) =>
  label.replace(/^model "([^"]+)" at https?:\/\/([^/]+).*$/, '$1 ($2)').replace(/^Microsoft Foundry deployment "([^"]+)"$/, '$1 on Microsoft Foundry');

export default function App({ theme, onToggleTheme }: { theme: ThemeName; onToggleTheme: () => void }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [persona, setPersona] = useState<Persona>(() => (new URLSearchParams(location.search).get('persona') === 'casual' ? 'casual' : 'analyst'));
  const [settings, setSettings] = useState<Settings | null>(null);
  const live = useLiveMatch();
  // The match as a tactics board (where each action happened, what the crew cites)
  // or as animated players, flat or in 3D. ?view=players or ?view=3d opens on them.
  const [view, setView] = useState<View>(() => {
    const v = new URLSearchParams(location.search).get('view');
    return v === 'players' || v === '3d' ? v : 'board';
  });
  const [voice, setVoice] = useState(false);
  const tour = useTour(new URLSearchParams(location.search).get('autostart') === '1');

  useEffect(() => {
    fetch('api/config')
      .then((r) => r.json())
      .then((c: AppConfig) => setConfig(c))
      .catch(() => setConfigError('Cannot reach the server.'));
  }, []);

  const visible = useMemo(() => live.items.filter((i) => i.audience === persona), [live.items, persona]);
  const voiceLanguage = settings?.language ?? 'English';
  useBrowserVoices();
  const support = voiceSupport(voiceLanguage, Boolean(config?.speech));
  const { blocked: soundBlocked, unblock, usingFallback } = useVoice({ enabled: voice && support.ok, items: visible, language: voiceLanguage, azure: Boolean(config?.speech) });

  const studioUrl = () => {
    const p = new URLSearchParams({ persona, speed: settings?.speed && settings.speed !== '0' ? settings.speed : '20', language: settings?.language ?? 'English' });
    const index = config && settings ? config.fixtures.findIndex((f) => f.seed === settings.fixture.seed) : 0;
    p.set('match', String(Math.max(0, index)));
    if (settings?.club) p.set('club', settings.club);
    if (settings?.player) p.set('player', settings.player);
    if (settings?.metric) p.set('metric', settings.metric);
    if (voice) p.set('voice', '1');
    if (view !== 'board') p.set('bg', view);
    return `studio?${p}`;
  };

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
            <Title3 as="h1" block>Nutmeg Desk</Title3>
            <Text size={200} block className="muted tagline">AI broadcast crew · explainable match intelligence</Text>
          </div>
        </div>
        <div className="topbar-actions">
          <Tooltip content="Every club, player and match here is made up" relationship="description">
            <Badge appearance="tint" color="warning">Synthetic data</Badge>
          </Tooltip>
          <Tooltip content="What a viewer at home sees: the live match full-screen with the crew's graphics and a scorebug, no controls. Opens in a new tab." relationship="description">
            <Button as="a" href={studioUrl()} target="_blank" rel="noopener" appearance="subtle" icon={<Video20Regular />} data-tour="studio" aria-label="Broadcast view">
              <span className="btn-text">Broadcast view</span>
            </Button>
          </Tooltip>
          <Tooltip content="Take the tour" relationship="label">
            <Button appearance="subtle" icon={<QuestionCircle20Regular />} onClick={tour.start} />
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
      {config && config.build !== __SERVER_BUILD__ && (
        <MessageBar intent="warning" className="gutter">
          <MessageBarBody>
            The running server is from different code than this page, so some features may not work. Restart the server (stop it, then <code>npm start</code>), or rebuild
            the page with <code>npm run build</code>.
          </MessageBarBody>
        </MessageBar>
      )}
      {live.status === 'error' && (
        <MessageBar intent="warning" className="gutter">
          <MessageBarBody>{live.error}</MessageBarBody>
        </MessageBar>
      )}

      <Scoreboard meta={live.meta} snap={live.snap} clock={live.clock} />

      <main className="layout">
        <section className="stage" aria-label="Match view">
          <div className="stage-bar">
            <TabList selectedValue={persona} onTabSelect={(_, d) => setPersona(d.value as Persona)} aria-label="Who is watching" className="persona" data-tour="persona">
              <Tab value="analyst">Analyst</Tab>
              <Tab value="casual">Casual fan</Tab>
            </TabList>
            <div className="voice-box" data-tour="voice">
              <Tooltip
                content={
                  support.ok
                    ? support.engine === 'azure'
                      ? `Reads each line aloud in ${voiceLanguage} with an Azure AI Speech neural voice.${
                          support.voice ? ` If Azure cannot be reached, your browser voice (${support.voice}) takes over.` : ''
                        }${usingFallback ? ' Azure is unreachable right now, so the browser voice is reading.' : ''}`
                      : `Reads each line aloud in ${voiceLanguage} with your browser voice (${support.voice}). Add an Azure AI Speech key on the server for neural voices.`
                    : support.reason
                }
                relationship="description"
              >
                <Switch
                  label={
                    <span className="voice-label">
                      Voice commentary <Info16Regular />
                    </span>
                  }
                  checked={voice && support.ok}
                  disabled={!support.ok}
                  onChange={(_, d) => setVoice(d.checked)}
                />
              </Tooltip>
              {voice && soundBlocked && (
                <Button size="small" appearance="primary" onClick={unblock}>
                  Allow sound
                </Button>
              )}
            </div>
          </div>
          <TabList size="small" selectedValue={view} onTabSelect={(_, d) => setView(d.value as View)} aria-label="How to show the match" className="view-tabs" data-tour="view">
            <Tab value="board">Tactics board</Tab>
            <Tab value="players">Players</Tab>
            <Tab value="3d">3D</Tab>
          </TabList>
          {view !== 'board' ? (
            <PlayersView
              key={live.runId}
              mode={view === '3d' ? '3d' : '2d'}
              meta={live.meta}
              subscribe={live.subscribe}
              eventLog={live.eventLog}
              idle={live.status === 'idle'}
            />
          ) : (
            <Pitch
              key={`${live.runId}-${persona}`}
              meta={live.meta}
              trail={live.trail}
              players={live.players}
              onBall={live.onBall}
              focus={settings?.player || null}
              items={visible}
              events={live.events}
              idle={live.status === 'idle'}
            />
          )}
          <div className="ticker" aria-label="Live events">
            {live.ticker.map((t) => (
              <span key={t.id} className={settings?.player && t.players.includes(settings.player) ? 'mine' : undefined}>
                <b>{t.clock}</b> {t.text}
              </span>
            ))}
          </div>
          <Stats snap={live.snap} meta={live.meta} />
          <MatchCharts history={live.history} meta={live.meta} />
        </section>

        <aside className="side">
          {settings?.player && <FocusCard player={live.snap?.favouritePlayer} meta={live.meta} />}
          {settings?.metric && <MetricCard metric={live.snap?.metric} meta={live.meta} runId={live.runId} />}
          <Feed items={visible} status={live.status} summary={live.summary} />
          <CrewTrace trace={live.trace} counts={live.counts} />
        </aside>
      </main>

      <TourOffer open={tour.offer} onStart={tour.start} onSkip={tour.skip} />
      {tour.step >= 0 && <TourSteps step={tour.step} setStep={tour.setStep} onFinish={tour.finish} />}

      <footer className="foot">
        <Text size={200}>
          Model: {config?.model ? modelName(config.model) : 'none (templates)'} · Translator: {config?.translator ? 'Azure AI Translator' : 'off'} · Voice:{' '}
          {config?.speech ? 'Azure AI Speech' : 'browser'} · Safety: {config?.safety ? 'Azure AI Content Safety' : 'off'}
        </Text>
        <Text size={200}>All clubs, players and matches are synthetic. Not affiliated with any real league.</Text>
      </footer>
    </div>
  );
}
