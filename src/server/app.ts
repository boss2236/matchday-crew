// HTTP server for the second-screen app. Node's built-in http only.
//
//   GET /                 the Fluent UI web app (web/dist)
//   GET /healthz          liveness and readiness for Azure Container Apps probes
//   GET /api/config       fixtures, clubs, squads, languages and what is configured
//   GET /api/live?...     Server-Sent Events stream of one live match session
//
// /api/live query: seed, home, away, speed (match seconds per real second),
// language, club (favourite club id), player (favourite player id), metric
// (the one metric this viewer follows, see src/stats/metrics.ts).

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { CLUBS, isClubId } from '../engine/teams.ts';
import type { ClubId } from '../engine/teams.ts';
import { LANGUAGES, languageCode } from '../ai/translator.ts';
import { FIXTURES, clubSummary } from '../live/fixtures.ts';
import { LiveSession, audiencesFor } from '../live/session.ts';
import type { Emit } from '../live/session.ts';
import { METRICS, isMetricId, metricIds } from '../stats/metrics.ts';
import type { AppConfig, JsonModel, MetricId, TextTranslator } from '../types.ts';

// The Fluent UI app, built by `npm run build` into web/dist.
export const DEFAULT_PUBLIC_DIR = new URL('../../web/dist/', import.meta.url).pathname;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

export interface LiveQuery {
  seed: number;
  home: ClubId;
  away: ClubId;
  speed: number;
  language: string;
  favouriteClub: string | null;
  favouritePlayer: string | null;
  focusMetric: MetricId | null;
}

export function parseLiveQuery(searchParams: URLSearchParams): LiveQuery {
  const num = (k: string, d: number, min: number, max: number) => {
    const v = Number(searchParams.get(k));
    return Number.isFinite(v) && searchParams.has(k) ? Math.min(max, Math.max(min, v)) : d;
  };
  const seed = Math.trunc(num('seed', 7, 1, 1_000_000));
  const fixed = FIXTURES.find((f) => f.seed === seed);
  const homeParam = searchParams.get('home');
  const awayParam = searchParams.get('away');
  const home: ClubId = isClubId(homeParam) ? homeParam : fixed?.home ?? 'harbour';
  let away: ClubId = isClubId(awayParam) ? awayParam : fixed?.away ?? 'ironvale';
  if (away === home) away = (Object.keys(CLUBS) as ClubId[]).find((id) => id !== home) as ClubId;
  const code = languageCode(searchParams.get('language'));
  const language = (code && Object.keys(LANGUAGES).find((n) => LANGUAGES[n] === code)) || 'English';
  const club = searchParams.get('club');
  const favouriteClub = club === home || club === away ? CLUBS[club].name : null;
  const playerId = searchParams.get('player');
  const favouritePlayer = [...CLUBS[home].players, ...CLUBS[away].players].find((p) => p.id === playerId)?.name ?? null;
  const metric = searchParams.get('metric');
  const focusMetric = isMetricId(metric) ? metric : null;
  return { seed, home, away, speed: num('speed', 20, 0, 600), language, favouriteClub, favouritePlayer, focusMetric };
}

export interface AppOptions {
  llm?: (JsonModel & { stats?: unknown }) | null;
  translator?: TextTranslator | null;
  modelLabel?: string | null;
  maxSessions?: number;
  publicDir?: string;
}

export type App = Server & { sessions: Set<LiveSession> };

export function createApp({
  llm = null,
  translator = null,
  modelLabel = null,
  maxSessions = Number(process.env.MAX_LIVE_SESSIONS) || 4,
  publicDir = DEFAULT_PUBLIC_DIR,
}: AppOptions = {}): App {
  const sessions = new Set<LiveSession>();

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  async function serveStatic(res: ServerResponse, pathname: string) {
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
    const root = publicDir.endsWith('/') ? publicDir : `${publicDir}/`;
    const file = join(root, rel);
    if (!file.startsWith(root)) return json(res, 404, { error: 'not found' });
    try {
      const body = await readFile(file);
      // Vite fingerprints everything under assets/, so it can be cached for good.
      const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
      res.end(body);
    } catch {
      json(res, 404, { error: 'not found' });
    }
  }

  function live(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (sessions.size >= maxSessions) return json(res, 503, { error: 'too many live sessions, try again shortly' });
    const q = parseLiveQuery(url.searchParams);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': matchday crew\n\n');
    const emit: Emit = (type, data) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
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
      .catch((err: unknown) => emit('error', { message: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        close();
        res.end();
      });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      if (url.pathname === '/healthz') {
        return json(res, 200, { ok: true, model: modelLabel, translator: Boolean(translator), cache: llm?.stats ?? null, liveSessions: sessions.size });
      }
      if (url.pathname === '/api/config') {
        const config: AppConfig = {
          fixtures: FIXTURES,
          clubs: clubSummary(),
          languages: Object.keys(LANGUAGES),
          metrics: metricIds.map((id) => ({ id, label: METRICS[id].label })),
          model: modelLabel,
          translator: Boolean(translator),
          synthetic: true,
        };
        return json(res, 200, config);
      }
      if (url.pathname === '/api/live') return live(req, res, url);
      return serveStatic(res, url.pathname);
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      else res.end();
    }
  });
  return Object.assign(server, { sessions });
}
