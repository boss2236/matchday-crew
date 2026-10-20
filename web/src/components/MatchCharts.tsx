// Match charts: the match so far as a trend line, a momentum swing chart, a
// share donut or a table, for whichever stat the viewer picks. The choice is
// remembered in this browser. Every view names both sides in text, so nothing
// relies on colour alone, and the table carries the same numbers.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Card, CardHeader, Caption1, Caption1Strong, Select, Tab, TabList, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text } from '@fluentui/react-components';
import { DataArea20Regular } from '@fluentui/react-icons';
import type { LiveMeta, TeamSnapshot } from '../../../src/types.ts';
import type { HistoryPoint } from '../useLiveMatch.ts';
import { useTeamColors } from '../teamColors.ts';

type View = 'trend' | 'momentum' | 'share' | 'table';
type StatKey = 'xg' | 'shots' | 'shotsOnTarget' | 'passes' | 'possessionPct' | 'passAccuracyPct' | 'progressivePasses' | 'finalThirdEntries' | 'tacklesWon' | 'interceptions';

// share: whether "each side's part of the total" means something (a rate like
// pass accuracy does not add up between teams).
const STATS: { key: StatKey; label: string; digits: number; share: boolean; percent?: boolean }[] = [
  { key: 'xg', label: 'Expected goals (xG)', digits: 2, share: true },
  { key: 'shots', label: 'Shots', digits: 0, share: true },
  { key: 'shotsOnTarget', label: 'Shots on target', digits: 0, share: true },
  { key: 'possessionPct', label: 'Possession %', digits: 0, share: true, percent: true },
  { key: 'passes', label: 'Passes', digits: 0, share: true },
  { key: 'passAccuracyPct', label: 'Pass accuracy %', digits: 0, share: false, percent: true },
  { key: 'progressivePasses', label: 'Progressive passes', digits: 0, share: true },
  { key: 'finalThirdEntries', label: 'Final-third entries', digits: 0, share: true },
  { key: 'tacklesWon', label: 'Tackles won', digits: 0, share: true },
  { key: 'interceptions', label: 'Interceptions', digits: 0, share: true },
];

const VIEWS: { id: View; label: string }[] = [
  { id: 'trend', label: 'Trend' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'share', label: 'Share' },
  { id: 'table', label: 'Table' },
];

const HEIGHT = 190;
const PAD = { top: 12, right: 44, bottom: 24, left: 34 };

function remembered<T extends string>(key: string, ok: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && ok.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts for this visit.
  }
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || 320);
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.round(entry.contentRect.width) || 320));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// Round numbers for the y axis: 0 and up to three steps above the data.
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

const minuteOf = (t: number) => Math.floor(t / 60);
const fmt = (v: number, digits: number) => v.toFixed(digits);
const value = (team: TeamSnapshot, key: StatKey) => Number(team[key] ?? 0);

interface Props {
  history: HistoryPoint[];
  meta: LiveMeta | null;
}

export default function MatchCharts({ history, meta }: Props) {
  const [view, setView] = useState<View>(() => remembered('mc-chart-view', VIEWS.map((v) => v.id), 'trend'));
  const [stat, setStat] = useState<StatKey>(() => remembered('mc-chart-stat', STATS.map((s) => s.key), 'xg'));
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const colors = useTeamColors(meta);
  useEffect(() => setHover(null), [view, stat]);

  const shareStats = STATS.filter((s) => s.share);
  const shown = view === 'share' && !STATS.find((s) => s.key === stat)?.share ? 'possessionPct' : stat;
  const def = STATS.find((s) => s.key === shown) ?? (STATS[0] as (typeof STATS)[number]);
  const home = meta?.home.short ?? 'Home';
  const away = meta?.away.short ?? 'Away';
  const latest = history[history.length - 1];

  // Shared x scale: the full 90 minutes, stretching into stoppage time.
  const tMax = Math.max(90 * 60, latest?.t ?? 0);
  const plotW = Math.max(120, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t / tMax) * plotW;
  const ticks = (width < 360 ? [0, 45, 90] : [0, 15, 30, 45, 60, 75, 90]).filter((m) => m * 60 <= tMax);

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    if (history.length < 2) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * tMax;
    let best = 0;
    for (let i = 1; i < history.length; i++) if (Math.abs((history[i] as HistoryPoint).t - t) < Math.abs((history[best] as HistoryPoint).t - t)) best = i;
    setHover(best);
  };
  const hovered = hover !== null ? history[hover] : undefined;

  const xAxis = (
    <g className="axis">
      {ticks.map((m) => (
        <text key={m} x={x(m * 60)} y={HEIGHT - 6} textAnchor="middle">
          {m === 45 ? 'HT' : `${m}'`}
        </text>
      ))}
      <line className="ht" x1={x(45 * 60)} x2={x(45 * 60)} y1={PAD.top} y2={PAD.top + plotH} />
    </g>
  );

  const hitArea = <rect className="hit" x={PAD.left} y={0} width={plotW} height={HEIGHT} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />;

  const tooltip = (lines: string[]) =>
    hovered && (
      <div className="chart-tip" style={{ left: Math.min(Math.max(x(hovered.t), 70), width - 70) }}>
        <Caption1Strong block>{minuteOf(hovered.t)}'</Caption1Strong>
        {lines.map((l) => (
          <Caption1 block key={l}>
            {l}
          </Caption1>
        ))}
      </div>
    );

  let body: ReactNode;
  if (history.length < 2 || !latest) {
    body = (
      <div className="chart-empty">
        <Caption1 className="muted">Charts fill in once the match kicks off.</Caption1>
      </div>
    );
  } else if (view === 'trend') {
    const top = def.percent ? 100 : niceMax(Math.max(...history.flatMap((p) => [value(p.home, shown), value(p.away, shown)])));
    const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
    const path = (side: 'home' | 'away') => history.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(value(p[side], shown)).toFixed(1)}`).join('');
    // End labels in text colour beside each line's last dot, nudged apart if they would overlap.
    let hy = y(value(latest.home, shown));
    let ay = y(value(latest.away, shown));
    if (Math.abs(hy - ay) < 13) {
      const mid = (hy + ay) / 2;
      [hy, ay] = hy <= ay ? [mid - 7, mid + 7] : [mid + 7, mid - 7];
    }
    body = (
      <>
        <svg width={width} height={HEIGHT} role="img" aria-label={`${def.label} over the match: ${home} ${fmt(value(latest.home, shown), def.digits)}, ${away} ${fmt(value(latest.away, shown), def.digits)}`}>
          <g className="grid">
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.left} x2={PAD.left + plotW} y1={y(top * f)} y2={y(top * f)} />
                <text x={PAD.left - 6} y={y(top * f) + 4} textAnchor="end">
                  {Number((top * f).toFixed(2))}
                </text>
              </g>
            ))}
          </g>
          {xAxis}
          {(['away', 'home'] as const).map((side) => (
            <path key={side} className="series" d={path(side)} style={{ stroke: colors[side] }} />
          ))}
          {(['away', 'home'] as const).map((side) => (
            <circle key={side} className="end" cx={x(latest.t)} cy={y(value(latest[side], shown))} r={4} style={{ fill: colors[side] }} />
          ))}
          <text className="end-label" x={x(latest.t) + 8} y={hy + 4}>
            {fmt(value(latest.home, shown), def.digits)}
          </text>
          <text className="end-label" x={x(latest.t) + 8} y={ay + 4}>
            {fmt(value(latest.away, shown), def.digits)}
          </text>
          {hovered && (
            <g className="crosshair">
              <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.top} y2={PAD.top + plotH} />
              {(['home', 'away'] as const).map((side) => (
                <circle key={side} cx={x(hovered.t)} cy={y(value(hovered[side], shown))} r={4} style={{ fill: colors[side] }} />
              ))}
            </g>
          )}
          {hitArea}
        </svg>
        {hovered && tooltip([`${home} ${fmt(value(hovered.home, shown), def.digits)}`, `${away} ${fmt(value(hovered.away, shown), def.digits)}`])}
      </>
    );
  } else if (view === 'momentum') {
    const y = (v: number) => PAD.top + plotH / 2 - (v / 100) * (plotH / 2);
    const line = history.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.momentum).toFixed(1)}`).join('');
    const area = `${line}L${x(latest.t).toFixed(1)},${y(0)}L${x(history[0]?.t ?? 0).toFixed(1)},${y(0)}Z`;
    const id = `mom-${meta?.matchId ?? 'm'}`;
    const lead = (m: number) => (m > 0 ? `${home} on top` : m < 0 ? `${away} on top` : 'Even');
    body = (
      <>
        <svg width={width} height={HEIGHT} role="img" aria-label={`Momentum over the match, now ${latest.momentum}: ${lead(latest.momentum)}`}>
          <defs>
            <clipPath id={`${id}-up`}>
              <rect x={0} y={0} width={width} height={y(0)} />
            </clipPath>
            <clipPath id={`${id}-down`}>
              <rect x={0} y={y(0)} width={width} height={HEIGHT} />
            </clipPath>
          </defs>
          <g className="grid">
            {[100, 0, -100].map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} className={v === 0 ? 'zero' : undefined} />
                <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
                  {Math.abs(v)}
                </text>
              </g>
            ))}
          </g>
          {xAxis}
          <path className="momentum-area" d={area} clipPath={`url(#${id}-up)`} style={{ fill: colors.home }} />
          <path className="momentum-area" d={area} clipPath={`url(#${id}-down)`} style={{ fill: colors.away }} />
          <path className="series neutral" d={line} />
          <circle className="end" cx={x(latest.t)} cy={y(latest.momentum)} r={4} style={{ fill: latest.momentum >= 0 ? colors.home : colors.away }} />
          <text className="side-label" x={PAD.left + 6} y={PAD.top + 12}>
            ▲ {home} on top
          </text>
          <text className="side-label" x={PAD.left + 6} y={PAD.top + plotH - 4}>
            ▼ {away} on top
          </text>
          {hovered && (
            <g className="crosshair">
              <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.top} y2={PAD.top + plotH} />
              <circle cx={x(hovered.t)} cy={y(hovered.momentum)} r={4} style={{ fill: hovered.momentum >= 0 ? colors.home : colors.away }} />
            </g>
          )}
          {hitArea}
        </svg>
        {hovered && tooltip([`${lead(hovered.momentum)} (${Math.abs(hovered.momentum)})`])}
      </>
    );
  } else if (view === 'share') {
    const h = value(latest.home, shown);
    const a = value(latest.away, shown);
    const total = h + a;
    const hShare = total ? h / total : 0.5;
    const r = 62;
    const c = 2 * Math.PI * r;
    // A 2px surface gap at each join (in arc length), so the two parts read as separate.
    const gap = total && h && a ? 4 : 0;
    const seg = (from: number, frac: number, color: string, label: string) => (
      <circle
        cx={80}
        cy={80}
        r={r}
        className="donut"
        style={{ stroke: color }}
        strokeDasharray={`${Math.max(0, frac * c - gap)} ${c}`}
        strokeDashoffset={-(from * c + gap / 2)}
        transform="rotate(-90 80 80)"
      >
        <title>{label}</title>
      </circle>
    );
    const pct = (f: number) => `${Math.round(f * 100)}%`;
    body = (
      <div className="share">
        <svg width={160} height={160} role="img" aria-label={`${def.label} share: ${home} ${pct(hShare)}, ${away} ${pct(1 - hShare)}`}>
          <circle cx={80} cy={80} r={r} className="donut-track" />
          {total > 0 && seg(0, hShare, colors.home, `${home} ${fmt(h, def.digits)} (${pct(hShare)})`)}
          {total > 0 && seg(hShare, 1 - hShare, colors.away, `${away} ${fmt(a, def.digits)} (${pct(1 - hShare)})`)}
          <text x={80} y={78} textAnchor="middle" className="donut-big">
            {total ? pct(Math.max(hShare, 1 - hShare)) : '–'}
          </text>
          <text x={80} y={98} textAnchor="middle" className="donut-small">
            {total ? (hShare === 0.5 ? 'level' : hShare > 0.5 ? home : away) : 'none yet'}
          </text>
        </svg>
        <ul className="share-legend">
          {(['home', 'away'] as const).map((side) => {
            const v = side === 'home' ? h : a;
            return (
              <li key={side}>
                <span className="swatch" style={{ background: colors[side] }} />
                <Text weight="semibold">{meta?.[side].name ?? side}</Text>
                <Text className="share-value">
                  {fmt(v, def.digits)}
                  {' '}
                  <span className="muted">({total ? pct(side === 'home' ? hShare : 1 - hShare) : '–'})</span>
                </Text>
              </li>
            );
          })}
          <li className="muted share-note">
            <Caption1>
              Each side's part of all {def.label.replace(/ \(.*\)| %/g, '').toLowerCase()} so far, at {minuteOf(latest.t)}'.
            </Caption1>
          </li>
        </ul>
      </div>
    );
  } else {
    // One row per quarter hour played, plus the latest.
    const rows: { minute: number; p: HistoryPoint }[] = [];
    for (let m = 15; m * 60 <= latest.t; m += 15) {
      const at = [...history].reverse().find((p) => p.t <= m * 60);
      if (at) rows.push({ minute: m, p: at });
    }
    if (rows[rows.length - 1]?.p !== latest) rows.push({ minute: minuteOf(latest.t), p: latest });
    body = (
      <Table size="extra-small" aria-label={`${def.label} and momentum by minute`} className="chart-table">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Minute</TableHeaderCell>
            <TableHeaderCell>{home}</TableHeaderCell>
            <TableHeaderCell>{away}</TableHeaderCell>
            <TableHeaderCell>Momentum</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ minute, p }) => (
            <TableRow key={minute}>
              <TableCell>{minute}'</TableCell>
              <TableCell>{fmt(value(p.home, shown), def.digits)}</TableCell>
              <TableCell>{fmt(value(p.away, shown), def.digits)}</TableCell>
              <TableCell>{p.momentum === 0 ? 'Even' : `${p.momentum > 0 ? home : away} +${Math.abs(p.momentum)}`}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <Card className="charts" data-tour="charts">
      <CardHeader
        image={<DataArea20Regular />}
        header={<Text weight="semibold">Match charts</Text>}
        description={<Caption1 className="muted">Pick a view and a stat</Caption1>}
      />
      <div className="chart-controls">
        <TabList
          size="small"
          selectedValue={view}
          onTabSelect={(_, d) => {
            setView(d.value as View);
            remember('mc-chart-view', d.value as string);
          }}
          aria-label="Chart view"
        >
          {VIEWS.map((v) => (
            <Tab key={v.id} value={v.id}>
              {v.label}
            </Tab>
          ))}
        </TabList>
        {view !== 'momentum' && (
          <Select
            size="small"
            aria-label="Stat to chart"
            value={shown}
            onChange={(_, d) => {
              setStat(d.value as StatKey);
              remember('mc-chart-stat', d.value);
            }}
          >
            {(view === 'share' ? shareStats : STATS).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        )}
      </div>
      {view !== 'share' && view !== 'table' && meta && (
        <div className="chart-legend" aria-hidden="true">
          {view === 'momentum' ? (
            <Caption1 className="muted">Who is on top over the last five minutes (−100 to 100)</Caption1>
          ) : (
            (['home', 'away'] as const).map((side) => (
              <Caption1 key={side}>
                <span className="swatch" style={{ background: colors[side] }} /> {meta[side].name}
              </Caption1>
            ))
          )}
        </div>
      )}
      <div className="chart-box" ref={box}>
        {body}
      </div>
    </Card>
  );
}
