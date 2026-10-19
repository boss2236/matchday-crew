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
import type { Speech } from '../ai/speech.ts';
import { MAX_SPEECH_CHARS } from '../ai/speech.ts';
import { agentCard, handleA2A } from '../a2a/agent.ts';
import { sourceFingerprint } from '../version.ts';

const BUILD = sourceFingerprint();
import type { A2ARequest } from '../a2a/agent.ts';

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

// Fixed-window rate limit per client and route. Small and in-memory: one
// replica, scale-to-zero hosting.
export class RateLimiter {
  limits: Record<string, number>;
  windowMs: number;
  hits: Map<string, { count: number; resetAt: number }>;
  constructor(limits: Record<string, number>, windowMs = 60_000) {
    this.limits = limits;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  // Seconds to wait, or 0 when the request may go ahead.
  check(route: string, client: string, now = Date.now()): number {
    const limit = this.limits[route];
    if (!limit) return 0;
    const key = `${route} ${client}`;
    let entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (now >= v.resetAt) this.hits.delete(k);
    }
    entry.count += 1;
    return entry.count > limit ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }
}

export const DEFAULT_LIMITS = { '/api/live': 12, '/api/speak': 90, '/a2a': 30 };

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};

// Behind Azure Container Apps the client address is the first X-Forwarded-For hop.
function clientOf(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

async function readBody(req: IncomingMessage, max = 64 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface AppOptions {
  llm?: (JsonModel & { stats?: unknown }) | null;
  translator?: TextTranslator | null;
  speech?: Speech | null;
  limits?: Record<string, number>;
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
  speech = null,
  limits = DEFAULT_LIMITS,
}: AppOptions = {}): App {
  const sessions = new Set<LiveSession>();
  const limiter = new RateLimiter(limits);

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  async function serveStatic(res: ServerResponse, pathname: string) {
    // App routes that the single-page app handles itself.
    const page = pathname === '/' || pathname === '/studio';
    const rel = normalize(page ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
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

  async function speak(res: ServerResponse, url: URL) {
    if (!speech) return json(res, 404, { error: 'speech not configured' });
    const text = (url.searchParams.get('text') ?? '').trim();
    if (!text || text.length > MAX_SPEECH_CHARS) return json(res, 400, { error: `text is required, at most ${MAX_SPEECH_CHARS} characters` });
    const language = url.searchParams.get('language') ?? 'English';
    const audio = await speech.synthesize(text, languageCode(language) ? language : 'English');
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=3600', 'content-length': audio.length });
    res.end(audio);
  }

  async function a2a(req: IncomingMessage, res: ServerResponse) {
    let body: A2ARequest;
    try {
      body = JSON.parse(await readBody(req)) as A2ARequest;
    } catch (err) {
      const status = (err as { status?: number }).status ?? 400;
      return json(res, status, { jsonrpc: '2.0', id: null, error: { code: -32700, message: status === 413 ? 'request too large' : 'parse error' } });
    }
    return json(res, 200, await handleA2A(body, { llm, translator }));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    try {
      const wait = limiter.check(url.pathname, clientOf(req));
      if (wait) {
        res.setHeader('retry-after', String(wait));
        return json(res, 429, { error: 'too many requests, slow down', retryAfterSeconds: wait });
      }
      if (url.pathname === '/a2a') {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST JSON-RPC here' });
        return await a2a(req, res);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      if (url.pathname === '/.well-known/agent-card.json' || url.pathname === '/.well-known/agent.json') {
        const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? 'http';
        return json(res, 200, agentCard(`${proto}://${req.headers.host ?? 'localhost'}`));
      }
      if (url.pathname === '/api/speak') return await speak(res, url);
      if (url.pathname === '/healthz') {
        return json(res, 200, { ok: true, model: modelLabel, translator: Boolean(translator), speech: Boolean(speech), cache: llm?.stats ?? null, liveSessions: sessions.size });
      }
      if (url.pathname === '/api/config') {
        const config: AppConfig = {
          fixtures: FIXTURES,
          clubs: clubSummary(),
          languages: Object.keys(LANGUAGES),
          metrics: metricIds.map((id) => ({ id, label: METRICS[id].label })),
          model: modelLabel,
          translator: Boolean(translator),
          speech: Boolean(speech),
          build: BUILD,
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
