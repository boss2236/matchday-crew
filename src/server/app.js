// HTTP server for the second-screen app. Node's built-in http only.
//
//   GET /                 the web app (public/)
//   GET /healthz          liveness and readiness for Azure Container Apps probes
//   GET /api/config       fixtures, clubs, squads, languages and what is configured
//   GET /api/live?...     Server-Sent Events stream of one live match session
//
// /api/live query: seed, home, away, speed (match seconds per real second),
// language, club (favourite club id), player (favourite player id), metric
// (the one metric this viewer follows, see src/stats/metrics.js).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { CLUBS } from '../engine/teams.js';
import { LANGUAGES, languageCode } from '../ai/translator.js';
import { FIXTURES, clubSummary } from '../live/fixtures.js';
import { LiveSession, audiencesFor } from '../live/session.js';
import { METRICS, metricIds } from '../stats/metrics.js';

const PUBLIC_DIR = new URL('../../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

export function parseLiveQuery(searchParams) {
  const num = (k, d, min, max) => {
    const v = Number(searchParams.get(k));
    return Number.isFinite(v) && searchParams.has(k) ? Math.min(max, Math.max(min, v)) : d;
  };
  const seed = Math.trunc(num('seed', 7, 1, 1_000_000));
  const fixed = FIXTURES.find((f) => f.seed === seed);
  const home = CLUBS[searchParams.get('home')] ? searchParams.get('home') : fixed?.home ?? 'harbour';
  let away = CLUBS[searchParams.get('away')] ? searchParams.get('away') : fixed?.away ?? 'ironvale';
  if (away === home) away = Object.keys(CLUBS).find((id) => id !== home);
  const language = languageCode(searchParams.get('language')) ? Object.keys(LANGUAGES).find((n) => LANGUAGES[n] === languageCode(searchParams.get('language'))) : 'English';
  const favouriteClub = [home, away].includes(searchParams.get('club')) ? CLUBS[searchParams.get('club')].name : null;
  const playerId = searchParams.get('player');
  const favouritePlayer = [home, away].some((c) => CLUBS[c].players.some((p) => p.id === playerId))
    ? [...CLUBS[home].players, ...CLUBS[away].players].find((p) => p.id === playerId).name
    : null;
  const focusMetric = metricIds.includes(searchParams.get('metric')) ? searchParams.get('metric') : null;
  return { seed, home, away, speed: num('speed', 20, 0, 600), language, favouriteClub, favouritePlayer, focusMetric };
}

export function createApp({ llm = null, translator = null, modelLabel = null, maxSessions = Number(process.env.MAX_LIVE_SESSIONS) || 4 } = {}) {
  const sessions = new Set();

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  async function serveStatic(res, pathname) {
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) return json(res, 404, { error: 'not found' });
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      json(res, 404, { error: 'not found' });
    }
  }

  function live(req, res, url) {
    if (sessions.size >= maxSessions) return json(res, 503, { error: 'too many live sessions, try again shortly' });
    const q = parseLiveQuery(url.searchParams);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': matchday crew\n\n');
    const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    const session = new LiveSession({
      ...q,
      audiences: audiencesFor(q),
      llm,
      translator,
      emit,
    });
    sessions.add(session);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
    const close = () => {
      session.stop();
      sessions.delete(session);
      clearInterval(heartbeat);
    };
    req.on('close', close);
    session
      .run()
      .catch((err) => emit('error', { message: err.message }))
      .finally(() => {
        close();
        res.end();
      });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      if (url.pathname === '/healthz') {
        return json(res, 200, { ok: true, model: modelLabel, translator: Boolean(translator), cache: llm?.stats ?? null, liveSessions: sessions.size });
      }
      if (url.pathname === '/api/config') {
        return json(res, 200, {
          fixtures: FIXTURES,
          clubs: clubSummary(),
          languages: Object.keys(LANGUAGES),
          metrics: metricIds.map((id) => ({ id, label: METRICS[id].label })),
          model: modelLabel,
          translator: Boolean(translator),
          synthetic: true,
        });
      }
      if (url.pathname === '/api/live') return live(req, res, url);
      return serveStatic(res, url.pathname);
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: err.message });
      else res.end();
    }
  });
  server.sessions = sessions;
  return server;
}
