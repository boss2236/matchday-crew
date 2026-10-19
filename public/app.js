// Matchday Crew second-screen app. Plain browser JavaScript, no build step.
// Connects to /api/live (Server-Sent Events) and renders the match, the crew's
// overlays and feed for the chosen persona, team stats, player focus and the
// agents' own trace.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const TYPE_LABEL = {
  goal: 'Goal', big_chance: 'Big chance', pressing_spell: 'Pressing', momentum_swing: 'Momentum', great_pass: 'Great pass',
  sprint: 'Speed', half_time: 'Half-time', full_time: 'Full-time', recap: 'Recap',
};
const OVERLAY_KICKER = {
  goal_card: 'Goal', chance_card: 'Big chance', pressing_heatmap: 'Pressing spell', momentum_bar: 'Momentum shift',
  pass_trail: 'Pass of the match', player_tag: 'Top speed', score_summary: 'Score', recap_panel: 'Full-time recap', info_card: 'Insight',
};
const SOURCE_LABEL = { model: 'AI', insight: 'AI · Tactician', template: 'Template', 'template+translator': 'Translated', 'insight+translator': 'AI · Translated' };
const STATS = [
  ['possessionPct', 'Possession %'], ['xg', 'Expected goals (xG)'], ['shots', 'Shots'], ['shotsOnTarget', 'On target'],
  ['passAccuracyPct', 'Pass accuracy %'], ['avgPassDifficulty', 'Avg pass difficulty'], ['progressivePasses', 'Progressive passes'],
  ['ppda', 'PPDA (lower = harder press)', true], ['tacklesWon', 'Tackles won'], ['interceptions', 'Interceptions'], ['maxShotSpeedKmh', 'Fastest shot km/h'],
];

let config = null;
let source = null;
let persona = 'analyst';
let meta = null;
let items = [];
let events = new Map();
let trail = [];
let tickerEvents = [];
let crewCounts = {};
let ended = false;
let metricHistory = [];

async function init() {
  try {
    config = await (await fetch('api/config')).json();
  } catch {
    $('modelInfo').textContent = 'Cannot reach the server.';
    return;
  }
  const fixture = $('fixture');
  config.fixtures.forEach((f, i) => fixture.append(new Option(`${clubName(f.home)} vs ${clubName(f.away)} · seed ${f.seed}`, String(i))));
  fixture.append(new Option('New match (random seed)', 'random'));
  config.languages.forEach((l) => $('language').append(new Option(l, l)));
  config.metrics.forEach((m) => $('metric').append(new Option(m.label, m.id)));
  fixture.addEventListener('change', fillFavourites);
  $('club').addEventListener('change', fillPlayers);
  fillFavourites();
  const model = config.model ? `Model: ${config.model}` : 'Model: none (templates)';
  $('modelInfo').textContent = `${model} · Translator: ${config.translator ? 'Azure AI Translator' : 'off'}`;

  $('controls').addEventListener('submit', (e) => {
    e.preventDefault();
    start();
  });
  document.querySelectorAll('.persona button').forEach((b) =>
    b.addEventListener('click', () => {
      persona = b.dataset.persona;
      document.querySelectorAll('.persona button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $('overlays').replaceChildren();
      renderFeed();
    }),
  );
  renderStats(null);
  applyUrlOptions();
}

// Deep links for demos: ?match=0&speed=60&language=Arabic&club=harbour&player=harbour-9&persona=casual&autostart=1
function applyUrlOptions() {
  const q = new URLSearchParams(location.search);
  const set = (id, v) => {
    if (v !== null && [...$(id).options].some((o) => o.value === v)) $(id).value = v;
  };
  set('fixture', q.get('match'));
  fillFavourites();
  set('speed', q.get('speed'));
  set('language', q.get('language'));
  set('club', q.get('club'));
  fillPlayers();
  set('player', q.get('player'));
  set('metric', q.get('metric'));
  if (q.get('persona') === 'casual') document.querySelector('.persona [data-persona="casual"]').click();
  if (q.get('autostart') === '1') start();
}

const clubById = (id) => config.clubs.find((c) => c.id === id);
const clubName = (id) => clubById(id)?.name ?? id;

function chosenFixture() {
  const v = $('fixture').value;
  if (v !== 'random') return config.fixtures[Number(v)];
  if (!chosenFixture.random) {
    const ids = config.clubs.map((c) => c.id).sort(() => Math.random() - 0.5);
    chosenFixture.random = { seed: 11 + Math.floor(Math.random() * 99989), home: ids[0], away: ids[1] };
  }
  return chosenFixture.random;
}

function fillFavourites() {
  chosenFixture.random = null;
  const f = chosenFixture();
  if ($('fixture').value === 'random') {
    $('fixture').selectedOptions[0].textContent = `New match: ${clubName(f.home)} vs ${clubName(f.away)} · seed ${f.seed}`;
  }
  const club = $('club');
  club.replaceChildren(new Option('None', ''));
  for (const id of [f.home, f.away]) club.append(new Option(clubName(id), id));
  fillPlayers();
}

function fillPlayers() {
  const f = chosenFixture();
  const player = $('player');
  player.replaceChildren(new Option('None', ''));
  const clubs = $('club').value ? [$('club').value, f.home === $('club').value ? f.away : f.home] : [f.home, f.away];
  for (const id of clubs) {
    const group = document.createElement('optgroup');
    group.label = clubName(id);
    for (const p of clubById(id).players) group.append(new Option(`${p.shirt}. ${p.name} (${p.pos})`, p.id));
    player.append(group);
  }
}

function start() {
  source?.close();
  const f = chosenFixture();
  const params = new URLSearchParams({ seed: f.seed, home: f.home, away: f.away, speed: $('speed').value, language: $('language').value });
  if ($('club').value) params.set('club', $('club').value);
  if ($('player').value) params.set('player', $('player').value);
  if ($('metric').value) params.set('metric', $('metric').value);

  items = [];
  events = new Map();
  trail = [];
  tickerEvents = [];
  crewCounts = {};
  ended = false;
  $('feed').replaceChildren();
  $('trace').replaceChildren();
  $('overlays').replaceChildren();
  $('highlights').replaceChildren();
  $('trail').replaceChildren();
  $('ticker').replaceChildren();
  $('crewStats').replaceChildren();
  $('feedCount').textContent = '';
  $('idle').hidden = true;
  $('start').textContent = 'Restart';
  $('focusPanel').hidden = !$('player').value;
  $('metricPanel').hidden = !$('metric').value;
  metricHistory = [];
  $('metricSpark').replaceChildren();

  source = new EventSource(`api/live?${params}`);
  source.addEventListener('meta', (e) => onMeta(JSON.parse(e.data)));
  source.addEventListener('event', (e) => onEvent(JSON.parse(e.data)));
  source.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  source.addEventListener('item', (e) => onItem(JSON.parse(e.data)));
  source.addEventListener('trace', (e) => onTrace(JSON.parse(e.data)));
  source.addEventListener('end', (e) => onEnd(JSON.parse(e.data)));
  source.onerror = () => {
    if (ended) return;
    source.close();
    $('modelInfo').textContent = 'Connection lost. Press Restart to try again.';
  };
}

function onMeta(m) {
  meta = m;
  $('homeName').textContent = m.home.name;
  $('awayName').textContent = m.away.name;
  document.documentElement.style.setProperty('--home', m.home.colors.primary);
  document.documentElement.style.setProperty('--away', m.away.colors.primary);
  document.title = `${m.home.short} v ${m.away.short} · Matchday Crew`;
}

function teamSide(teamId) {
  return teamId === meta?.home.id ? 'home' : 'away';
}

function onEvent(ev) {
  $('clock').textContent = ev.type === 'full_time' ? 'FT' : ev.type === 'half_time' ? 'HT' : ev.clock;
  if (ev.x !== undefined) events.set(ev.id, ev);
  if (ev.x !== undefined && ['pass', 'carry', 'shot'].includes(ev.type)) {
    trail.push(ev);
    if (trail.length > 7) trail.shift();
    drawTrail();
  }
  const text = describe(ev);
  if (text) {
    tickerEvents.unshift({ clock: ev.clock, text, mine: isFocus(ev) });
    tickerEvents.length = Math.min(tickerEvents.length, 10);
    const ticker = $('ticker');
    ticker.replaceChildren(
      ...tickerEvents.map((t) => {
        const s = el('span');
        s.append(el('b', null, t.clock), ` ${t.text}`);
        if (t.mine) s.style.color = 'var(--accent)';
        return s;
      }),
    );
  }
}

function isFocus(ev) {
  const fav = $('player').value;
  return fav && (ev.player?.id === fav || ev.recipient?.id === fav);
}

function describe(ev) {
  const p = ev.player?.name;
  switch (ev.type) {
    case 'pass':
      return ev.outcome === 'complete' ? `${p} → ${ev.recipient?.name ?? 'teammate'}` : `${p} pass misplaced`;
    case 'shot':
      return `${p} shoots (${ev.outcome.replace('_', ' ')}, xG ${ev.xg})`;
    case 'goal':
      return `GOAL ${p}!`;
    case 'tackle':
      return `${p} tackle`;
    case 'interception':
      return `${p} intercepts`;
    case 'save':
      return `${p} saves`;
    case 'kickoff':
      return 'Kick-off';
    case 'half_time':
      return 'Half-time';
    case 'full_time':
      return 'Full-time';
    default:
      return null;
  }
}

function drawTrail() {
  const g = $('trail');
  g.replaceChildren();
  trail.forEach((ev, i) => {
    const opacity = (i + 1) / trail.length;
    if (ev.type === 'shot') {
      const goalX = ev.x > 52.5 ? 105 : 0;
      g.append(svg('line', { x1: ev.x, y1: ev.y, x2: goalX, y2: 34, class: 'shot-line', opacity }));
    } else if (ev.endX !== undefined) {
      g.append(svg('line', { x1: ev.x, y1: ev.y, x2: ev.endX, y2: ev.endY, class: `trail-line ${teamSide(ev.team)}`, opacity }));
    }
    g.append(svg('circle', { cx: ev.x, cy: ev.y, r: 0.55, class: 'trail-dot', opacity }));
  });
  const last = trail[trail.length - 1];
  if (last) {
    $('ball').setAttribute('cx', last.endX ?? last.x);
    $('ball').setAttribute('cy', last.endY ?? last.y);
  }
}

function onState(s) {
  $('homeScore').textContent = s.score.home;
  $('awayScore').textContent = s.score.away;
  const m = s.momentum;
  const fill = $('momentumFill');
  fill.style.left = `${m >= 0 ? 50 : 50 + m / 2}%`;
  fill.style.width = `${Math.abs(m) / 2}%`;
  fill.style.background = m >= 0 ? 'var(--home)' : 'var(--away)';
  $('momentum').setAttribute('aria-valuenow', m);
  $('chaosFill').style.width = `${s.chaos}%`;
  $('chaos').setAttribute('aria-valuenow', s.chaos);
  renderStats(s);
  renderFocus(s.favouritePlayer);
  renderMetric(s.metric);
}

function renderMetric(m) {
  if (!m) return;
  $('metricTitle').textContent = `Following: ${m.label}`;
  const fmt = (v) => (v === null || v === undefined ? '–' : v);
  $('metricHome').textContent = fmt(m.home);
  $('metricAway').textContent = fmt(m.away);
  $('metricHomeName').textContent = `${meta?.home.short ?? 'Home'} · ${m.unit}`;
  $('metricAwayName').textContent = `${meta?.away.short ?? 'Away'} · ${m.unit}`;
  const notes = [];
  if (m.lowerIsBetter) notes.push('Lower means a more intense press.');
  if (m.leaders?.length) notes.push(`Fastest: ${m.leaders.map((l) => `${l.name} ${l.value} km/h`).join(', ')}.`);
  if (m.chaos !== undefined) notes.push(`Chaos index ${m.chaos}.`);
  notes.push('The crew leads with this metric in your lines.');
  $('metricNote').textContent = notes.join(' ');

  if (typeof m.home === 'number' && typeof m.away === 'number') {
    const last = metricHistory[metricHistory.length - 1];
    if (!last || m.t - last.t >= 30) metricHistory.push({ t: m.t, home: m.home, away: m.away });
  }
  if (metricHistory.length < 2) return;
  const maxT = Math.max(metricHistory[metricHistory.length - 1].t, 60);
  const maxV = Math.max(...metricHistory.flatMap((p) => [p.home, p.away]), 1e-6);
  const line = (side) =>
    svg('polyline', { class: side, points: metricHistory.map((p) => `${(p.t / maxT) * 300},${66 - (p[side] / maxV) * 62}`).join(' ') });
  $('metricSpark').replaceChildren(line('home'), line('away'));
}

function renderStats(s) {
  const rows = STATS.map(([key, label, lowerIsBetter]) => {
    const h = s ? s.home[key] ?? 0 : 0;
    const a = s ? s.away[key] ?? 0 : 0;
    const row = el('div', 'stat-row');
    const mid = el('div', 'stat-mid');
    const bar = el('div', 'stat-bar');
    let hv = Number(h) || 0;
    let av = Number(a) || 0;
    if (lowerIsBetter && hv && av) [hv, av] = [1 / hv, 1 / av];
    const total = hv + av || 1;
    const hb = el('div', 'h');
    hb.style.width = `${(hv / total) * 100}%`;
    const ab = el('div', 'a');
    ab.style.width = `${(av / total) * 100}%`;
    bar.append(hb, ab);
    mid.append(el('span', 'label', label), bar);
    row.append(el('span', 'v', h ?? '–'), mid, el('span', 'v r', a ?? '–'));
    return row;
  });
  $('statRows').replaceChildren(...rows);
}

function renderFocus(p) {
  if (!p) return;
  const box = $('focus');
  const team = p.team === meta?.home.id ? meta.home.name : meta?.away.name;
  const cells = [
    ['goals', 'Goals'], ['xg', 'xG'], ['passesComplete', 'Passes done'], ['passAccuracyPct', 'Pass %'],
    ['topSpeedKmh', 'Top km/h'], ['carryDistance', 'Carried m'], ['tacklesWon', 'Tackles won'], ['interceptions', 'Intercepts'], ['involvement', 'Touches'],
  ].map(([k, label]) => {
    const d = el('div');
    d.append(el('b', null, p[k] ?? '–'), el('span', null, label));
    return d;
  });
  const grid = el('div', 'focus-grid');
  grid.append(...cells);
  box.replaceChildren(el('div', 'focus-name', `${p.shirt}. ${p.name}`), el('div', 'muted small', `${p.pos} · ${team}`), grid);
}

function onItem(item) {
  items.push(item);
  if (item.audience !== persona) return;
  prependFeed(item);
  showOverlay(item);
}

function renderFeed() {
  $('feed').replaceChildren();
  items.filter((i) => i.audience === persona).forEach(prependFeed);
}

function prependFeed(item) {
  const li = el('li');
  const metaRow = el('div', 'meta');
  const srcClass = item.source.endsWith('+translator') ? 'translator' : ['model', 'insight'].includes(item.source) ? 'model' : 'template';
  metaRow.append(el('span', 'clock-tag', item.clock), el('span', null, TYPE_LABEL[item.type] ?? item.type), el('span', `src ${srcClass}`, SOURCE_LABEL[item.source] ?? item.source));
  const head = el('div', 'head', item.headline);
  head.dir = 'auto';
  const text = el('p', 'text', item.text);
  text.dir = 'auto';
  const ev = el('details', 'evidence');
  ev.append(el('summary', null, `Evidence: ${item.cites.length} event${item.cites.length === 1 ? '' : 's'}`));
  const code = el('code', null, item.cites.join(', '));
  ev.append(code);
  if (item.tags?.length) ev.append(el('div', null, `Tags: ${item.tags.join(', ')}`));
  li.append(metaRow, head, text, ev);
  $('feed').prepend(li);
  const count = items.filter((i) => i.audience === persona).length;
  $('feedCount').textContent = `· ${count}`;
}

function showOverlay(item) {
  const ov = item.overlay;
  const layer = $('overlays');
  if (ov.position === 'full_screen') layer.replaceChildren();
  layer.querySelectorAll(`.ov.${ov.position}`).forEach((n) => n.remove());

  const card = el('div', `ov ${ov.position} ${item.type === 'goal' ? 'goal' : ''}`);
  const kicker = el('div', 'kicker', OVERLAY_KICKER[ov.type] ?? 'Insight');
  kicker.append(el('span', 'muted', item.clock));
  const head = el('div', 'head', item.headline);
  head.dir = 'auto';
  const body = el('div', 'body', item.text);
  body.dir = 'auto';
  card.append(kicker, head, body);
  const chips = overlayChips(ov);
  if (chips.length) {
    const box = el('div', 'chips');
    box.append(...chips.map((c) => el('span', 'chip', c)));
    card.append(box);
  }
  layer.append(card);
  highlight(item);
  setTimeout(() => {
    card.classList.add('out');
    setTimeout(() => card.remove(), 400);
  }, Math.max(4000, ov.durationMs));
}

function overlayChips(ov) {
  const d = ov.data ?? {};
  switch (ov.type) {
    case 'goal_card':
      return [d.score && `Score ${d.score.home ?? d.score}-${d.score.away ?? ''}`.replace(/-$/, ''), d.xg !== undefined && `xG ${d.xg}`, d.assist && `Assist ${d.assist}`].filter(Boolean);
    case 'chance_card':
      return [`xG ${d.xg}`, d.outcome?.replace('_', ' ')].filter(Boolean);
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

function highlight(item) {
  const g = $('highlights');
  g.replaceChildren();
  const cited = item.cites.map((id) => events.get(id)).filter(Boolean);
  if (!cited.length) return;
  if (item.overlay.type === 'pass_trail' || item.overlay.type === 'goal_card') {
    for (const ev of cited) if (ev.endX !== undefined) g.append(svg('line', { x1: ev.x, y1: ev.y, x2: ev.endX, y2: ev.endY, class: 'hl-pass' }));
  }
  for (const ev of cited) g.append(svg(item.overlay.type === 'pressing_heatmap' ? 'circle' : 'circle', { cx: ev.x, cy: ev.y, r: item.overlay.type === 'pressing_heatmap' ? 3 : 0.9, class: item.overlay.type === 'pressing_heatmap' ? 'hl-ring' : 'hl-dot' }));
  setTimeout(() => g.replaceChildren(), Math.max(4000, item.overlay.durationMs));
}

function onTrace(entry) {
  crewCounts[entry.status] = (crewCounts[entry.status] ?? 0) + 1;
  if (entry.status === 'skipped') {
    renderCrewStats();
    return;
  }
  const li = el('li');
  li.append(el('span', 'agent', entry.agent), el('span', `st ${entry.status}`, entry.status), el('span', 'detail', entry.detail));
  li.title = `${entry.agent} · ${entry.momentId} · ${entry.status} · ${entry.detail}${entry.ms ? ` · ${entry.ms} ms` : ''}`;
  const trace = $('trace');
  trace.prepend(li);
  while (trace.children.length > 150) trace.lastChild.remove();
  renderCrewStats();
}

function renderCrewStats() {
  const order = ['selected', 'skipped', 'ok', 'rejected', 'template', 'error', 'overlay'];
  $('crewStats').replaceChildren(
    ...order.filter((k) => crewCounts[k]).map((k) => el('span', 'chip', `${k} ${crewCounts[k]}`)),
  );
}

function onEnd(summary) {
  ended = true;
  source?.close();
  $('start').textContent = 'Watch again';
  $('clock').textContent = 'FT';
  $('feedCount').textContent = `· ${items.filter((i) => i.audience === persona).length} · ${summary.items} items aired`;
}

init();
