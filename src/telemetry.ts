// Azure Application Insights telemetry over the ingestion REST API (no SDK):
// requests, dependency calls (model, translator, speech, content safety),
// custom events (one per match session) and exceptions, batched every 5 s.
//
//   APPLICATIONINSIGHTS_CONNECTION_STRING  from the Application Insights
//                                          resource's Overview page
//
// Without it every call is a no-op. Telemetry never throws into the app.
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { FetchLike } from './ai/llm.ts';

type Props = Record<string, string | number | boolean | undefined>;

export interface Telemetry {
  enabled: boolean;
  request(name: string, url: string, status: number, ms: number, props?: Props): void;
  dependency(type: string, name: string, target: string, ms: number, success: boolean, props?: Props): void;
  event(name: string, props?: Props, measurements?: Record<string, number>): void;
  exception(err: unknown, props?: Props): void;
  flush(): Promise<void>;
}

export const noTelemetry: Telemetry = {
  enabled: false,
  request() {},
  dependency() {},
  event() {},
  exception() {},
  flush: async () => {},
};

export function parseConnectionString(cs: string | undefined): { iKey: string; endpoint: string } | null {
  if (!cs) return null;
  const parts = Object.fromEntries(
    cs
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i).toLowerCase(), p.slice(i + 1)];
      }),
  );
  if (!parts.instrumentationkey) return null;
  const endpoint = (parts.ingestionendpoint || 'https://dc.services.visualstudio.com/').replace(/\/?$/, '/');
  return { iKey: parts.instrumentationkey, endpoint };
}

// Application Insights wants durations as "hh:mm:ss.fff" (with a day prefix if needed).
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const days = Math.floor(total / 86_400_000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const h = Math.floor(total / 3_600_000) % 24;
  const m = Math.floor(total / 60_000) % 60;
  const s = Math.floor(total / 1000) % 60;
  const f = total % 1000;
  return `${days ? `${days}.` : ''}${pad(h)}:${pad(m)}:${pad(s)}.${pad(f, 3)}`;
}

const clean = (props: Props = {}) => Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));

export class AppInsights implements Telemetry {
  enabled = true;
  iKey: string;
  url: string;
  fetch: FetchLike;
  role: string;
  buffer: object[];
  timer: ReturnType<typeof setInterval>;
  failures: number;

  constructor(connectionString: string, { fetchImpl = globalThis.fetch, role = 'nutmeg-desk', intervalMs = 5000 }: { fetchImpl?: FetchLike; role?: string; intervalMs?: number } = {}) {
    const parsed = parseConnectionString(connectionString);
    if (!parsed) throw new Error('invalid Application Insights connection string');
    this.iKey = parsed.iKey;
    this.url = `${parsed.endpoint}v2/track`;
    this.fetch = fetchImpl;
    this.role = role;
    this.buffer = [];
    this.failures = 0;
    this.timer = setInterval(() => void this.flush(), intervalMs);
    this.timer.unref?.();
  }

  envelope(type: string, baseType: string, baseData: object, opName?: string) {
    this.buffer.push({
      name: `Microsoft.ApplicationInsights.${type}`,
      time: new Date().toISOString(),
      iKey: this.iKey,
      tags: { 'ai.cloud.role': this.role, 'ai.cloud.roleInstance': hostname(), 'ai.operation.id': randomUUID(), ...(opName && { 'ai.operation.name': opName }) },
      data: { baseType, baseData: { ver: 2, ...baseData } },
    });
    if (this.buffer.length >= 100) void this.flush();
  }

  request(name: string, url: string, status: number, ms: number, props?: Props) {
    this.envelope('Request', 'RequestData', { id: randomUUID(), name, url, duration: formatDuration(ms), responseCode: String(status), success: status < 500, properties: clean(props) }, name);
  }

  dependency(type: string, name: string, target: string, ms: number, success: boolean, props?: Props) {
    this.envelope('RemoteDependency', 'RemoteDependencyData', { id: randomUUID(), name, type, target, duration: formatDuration(ms), success, resultCode: success ? '200' : 'error', properties: clean(props) });
  }

  event(name: string, props?: Props, measurements?: Record<string, number>) {
    this.envelope('Event', 'EventData', { name, properties: clean(props), measurements: measurements ?? {} });
  }

  exception(err: unknown, props?: Props) {
    const e = err instanceof Error ? err : new Error(String(err));
    this.envelope('Exception', 'ExceptionData', {
      exceptions: [{ typeName: e.name, message: e.message, hasFullStack: Boolean(e.stack), stack: e.stack ?? '' }],
      properties: clean(props),
    });
  }

  async flush(): Promise<void> {
    if (!this.buffer.length) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      const res = await this.fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch) });
      if (!res.ok) throw new Error(`ingestion ${res.status}`);
    } catch (err) {
      // Never let monitoring hurt the app: drop the batch, warn once.
      if (this.failures++ === 0) console.warn(`Application Insights: ${err instanceof Error ? err.message : String(err)} (further failures are silent)`);
    }
  }
}

// Times an async call as a dependency. Errors are recorded and rethrown.
export async function track<T>(telemetry: Telemetry, type: string, name: string, target: string, fn: () => Promise<T>, props?: Props): Promise<T> {
  const started = Date.now();
  try {
    const out = await fn();
    telemetry.dependency(type, name, target, Date.now() - started, true, props);
    return out;
  } catch (err) {
    telemetry.dependency(type, name, target, Date.now() - started, false, { ...props, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    throw err;
  }
}
