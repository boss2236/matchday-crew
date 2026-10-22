import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Caption1, Field, Select, Text } from '@fluentui/react-components';
import { ArrowClockwise24Regular, Options20Regular, Play24Filled } from '@fluentui/react-icons';
import type { FormEvent } from 'react';
import type { AppConfig } from '../../../src/types.ts';

type Fixture = AppConfig['fixtures'][number];

export interface Settings {
  fixture: Fixture;
  speed: string;
  language: string;
  club: string;
  player: string;
  metric: string;
}

const SPEEDS: [value: string, label: string][] = [
  ['1', 'Real time (90 min)'],
  ['3', '3× (30 min)'],
  ['10', '10× (9 min)'],
  ['20', '20× (4.5 min)'],
  ['60', '60× (1.5 min)'],
  ['0', 'Instant'],
];

function randomFixture(clubs: AppConfig['clubs']): Fixture {
  const ids = clubs.map((c) => c.id).sort(() => Math.random() - 0.5);
  return { seed: 11 + Math.floor(Math.random() * 99989), home: ids[0] as string, away: ids[1] as string };
}

// Match setup. Reads deep links once: ?match=0&speed=60&language=Arabic&club=harbour
// &player=harbour-9&metric=xg&autostart=1
interface ControlsProps {
  config: AppConfig;
  running: boolean;
  hasRun: boolean;
  onKickOff: (settings: Settings) => void;
}

export default function Controls({ config, running, hasRun, onKickOff }: ControlsProps) {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const pick = (v: string | null, ok: (v: string) => unknown): string | null => (v !== null && ok(v) ? v : null);
  const [fixtureKey, setFixtureKey] = useState(() => pick(q.get('match'), (v) => v === 'random' || config.fixtures[Number(v)]) ?? '0');
  const [random, setRandom] = useState(() => randomFixture(config.clubs));
  const [speed, setSpeed] = useState(() => pick(q.get('speed'), (v) => SPEEDS.some(([s]) => s === v)) ?? '20');
  const [language, setLanguage] = useState(() => pick(q.get('language'), (v) => config.languages.includes(v)) ?? 'English');
  const [club, setClub] = useState(q.get('club') ?? '');
  const [player, setPlayer] = useState(q.get('player') ?? '');
  const [metric, setMetric] = useState(() => pick(q.get('metric'), (v) => config.metrics.some((m) => m.id === v)) ?? '');

  // On phones the setup folds into a one-line summary once a match is on
  // (CSS only applies it below 960px; desktop always shows the full form).
  const [folded, setFolded] = useState(false);

  const clubName = (id: string) => config.clubs.find((c) => c.id === id)?.name ?? id;
  const fixture: Fixture = fixtureKey === 'random' ? random : (config.fixtures[Number(fixtureKey)] ?? (config.fixtures[0] as Fixture));
  const inMatch = [fixture.home, fixture.away];
  const clubOk = !club || inMatch.includes(club);
  const playerClubs = club && clubOk ? [club, ...inMatch.filter((c) => c !== club)] : inMatch;
  const playerOk = !player || inMatch.some((id) => config.clubs.find((c) => c.id === id)?.players.some((p) => p.id === player));

  // Keep favourites valid when the fixture changes.
  useEffect(() => {
    if (!clubOk) setClub('');
    if (!playerOk) setPlayer('');
  }, [clubOk, playerOk]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    setFolded(true);
    onKickOff({ fixture, speed, language, club: clubOk ? club : '', player: playerOk ? player : '', metric });
  };

  const autostarted = useRef(false);
  useEffect(() => {
    if (q.get('autostart') === '1' && !autostarted.current) {
      autostarted.current = true;
      submit();
    }
  });

  return (
    <Card className={`controls gutter${folded && hasRun ? ' folded' : ''}`} appearance="filled-alternative" data-tour="controls">
      <div className="controls-summary">
        <div className="controls-summary-text">
          <Text weight="semibold" truncate wrap={false} block>
            {clubName(fixture.home)} vs {clubName(fixture.away)}
          </Text>
          <Caption1 className="muted" truncate wrap={false} block>
            {SPEEDS.find(([v]) => v === speed)?.[1]} · {language}
          </Caption1>
        </div>
        <Button appearance="subtle" icon={<Options20Regular />} onClick={() => setFolded(false)} aria-label="Change match settings">
          Change
        </Button>
        <Button appearance="primary" icon={<ArrowClockwise24Regular />} onClick={() => submit()} aria-label={running ? 'Restart' : 'Watch again'} />
      </div>
      <form onSubmit={submit} className="controls-grid" aria-label="Match setup">
        <Field label="Match">
          <Select
            id="fixture"
            value={fixtureKey}
            onChange={(_, d) => {
              if (d.value === 'random') setRandom(randomFixture(config.clubs));
              setFixtureKey(d.value);
            }}
          >
            {config.fixtures.map((f, i) => (
              <option key={f.seed} value={String(i)}>
                {clubName(f.home)} vs {clubName(f.away)} · seed {f.seed}
              </option>
            ))}
            <option value="random">
              {fixtureKey === 'random' ? `New match: ${clubName(random.home)} vs ${clubName(random.away)}` : 'New match (random seed)'}
            </option>
          </Select>
        </Field>
        <Field label="Speed">
          <Select id="speed" value={speed} onChange={(_, d) => setSpeed(d.value)}>
            {SPEEDS.map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Language">
          <Select id="language" value={language} onChange={(_, d) => setLanguage(d.value)}>
            {config.languages.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="Favourite club">
          <Select id="club" value={clubOk ? club : ''} onChange={(_, d) => setClub(d.value)}>
            <option value="">None</option>
            {inMatch.map((id) => (
              <option key={id} value={id}>{clubName(id)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Player focus">
          <Select id="player" value={playerOk ? player : ''} onChange={(_, d) => setPlayer(d.value)}>
            <option value="">None</option>
            {playerClubs.map((id) => {
              const c = config.clubs.find((x) => x.id === id);
              if (!c) return null;
              return (
                <optgroup key={id} label={c.name}>
                  {c.players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.shirt}. {p.name} ({p.pos})
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </Select>
        </Field>
        <Field label="Follow a metric">
          <Select id="metric" value={metric} onChange={(_, d) => setMetric(d.value)}>
            <option value="">None</option>
            {config.metrics.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </Select>
        </Field>
        <Button id="start" data-tour="kickoff" type="submit" appearance="primary" size="large" icon={hasRun ? <ArrowClockwise24Regular /> : <Play24Filled />} className="kickoff">
          {hasRun ? (running ? 'Restart' : 'Watch again') : 'Kick off'}
        </Button>
      </form>
    </Card>
  );
}
