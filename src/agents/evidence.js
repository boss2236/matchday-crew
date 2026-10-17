// Evidence packs and the grounding check.
//
// Agents never see the raw event stream. For each moment they get an evidence
// pack: the moment, the events it cites (with player names resolved), and the
// current match snapshot. Whatever they write is then checked against that
// pack: every number and every player name must come from it, and every
// event they cite must be in it. Anything that fails is rejected.

const NAME_FIELDS = ['player', 'recipient', 'target'];

export function describeEvent(ev, state) {
  const out = { id: ev.id, clock: ev.clock, minute: ev.minute, type: ev.type, team: ev.team ? teamName(state, ev.team) : null };
  for (const f of NAME_FIELDS) if (ev[f]) out[f] = state.playerName(ev[f]);
  for (const k of ['outcome', 'xg', 'distance', 'progress', 'difficulty', 'speedKmh', 'pressured', 'cause', 'score']) {
    if (ev[k] !== undefined) out[k] = ev[k];
  }
  return out;
}

export function teamName(state, teamId) {
  return teamId === state.meta.home.id ? state.meta.home.name : teamId === state.meta.away.id ? state.meta.away.name : teamId;
}

export function buildEvidence(moment, state, eventsById) {
  const events = moment.evidence.map((id) => eventsById.get(id)).filter(Boolean).map((ev) => describeEvent(ev, state));
  const snap = state.snapshot();
  const home = state.meta.home;
  const away = state.meta.away;
  const data = { ...moment.data };
  for (const k of ['assist', 'recipient']) if (data[k]) data[k] = state.playerName(data[k]);
  return {
    moment: {
      id: moment.id,
      type: moment.type,
      clock: moment.clock,
      minute: moment.minute,
      team: moment.team ? teamName(state, moment.team) : null,
      player: moment.player ? state.playerName(moment.player) : null,
      data,
    },
    events,
    match: {
      home: home.name,
      away: away.name,
      homeStyle: home.styleLabel,
      awayStyle: away.styleLabel,
      score: `${snap.score.home}-${snap.score.away}`,
      minute: snap.minute,
      momentum: snap.momentum,
      chaos: snap.chaos,
      stats: { [home.name]: pickStats(snap.home), [away.name]: pickStats(snap.away) },
    },
  };
}

function pickStats(t) {
  return {
    possessionPct: t.possessionPct,
    shots: t.shots,
    shotsOnTarget: t.shotsOnTarget,
    xg: t.xg,
    passAccuracyPct: t.passAccuracyPct,
    finalThirdEntries: t.finalThirdEntries,
    ppda: t.ppda,
    tacklesWon: t.tacklesWon,
    interceptions: t.interceptions,
  };
}

// Collect every number that appears anywhere in the evidence pack.
export function allowedNumbers(pack) {
  const nums = new Set();
  const visit = (v) => {
    if (typeof v === 'number') addNumber(nums, v);
    else if (typeof v === 'string') for (const n of extractNumbers(v)) addNumber(nums, n);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(pack);
  return nums;
}

function addNumber(set, n) {
  set.add(String(n));
  set.add(String(Math.round(n)));
  set.add(String(Math.round(n * 10) / 10));
  // xG 0.31 is commonly written as 31%.
  if (n > 0 && n < 1) {
    set.add(String(Math.round(n * 100)));
    set.add(String(Math.round(n * 1000) / 10));
  }
}

export function extractNumbers(text) {
  return (String(text).match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

// Numbers that are always fine: small counts and the standard match length.
const ALWAYS_OK = new Set(['0', '1', '2', '3', '45', '90']);

export function verify(output, pack, state, { textFields = ['text'], citeField = 'cites' } = {}) {
  const problems = [];
  const nums = allowedNumbers(pack);
  const evidenceIds = new Set(pack.events.map((e) => e.id));
  const knownNames = new Set();
  for (const p of state.players.values()) knownNames.add(p.name);
  const packText = JSON.stringify(pack);

  for (const field of textFields) {
    const text = output?.[field];
    if (typeof text !== 'string' || !text.trim()) {
      problems.push(`missing ${field}`);
      continue;
    }
    for (const n of extractNumbers(text)) {
      const s = String(n);
      if (!ALWAYS_OK.has(s) && !nums.has(s) && !nums.has(String(Math.round(n)))) problems.push(`number ${s} is not in the evidence`);
    }
    for (const name of knownNames) {
      if (text.includes(name) && !packText.includes(name)) problems.push(`player ${name} is not in the evidence`);
      // Surnames on their own are common in commentary.
      const surname = name.split(' ').slice(-1)[0];
      if (new RegExp(`\\b${surname}\\b`).test(text) && !packText.includes(surname)) problems.push(`player ${surname} is not in the evidence`);
    }
  }

  const cites = output?.[citeField];
  if (!Array.isArray(cites) || cites.length === 0) problems.push('no cited events');
  else for (const id of cites) if (!evidenceIds.has(id)) problems.push(`cited event ${id} is not in the evidence`);

  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}
