// Small helpers shared by the tests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { simulateMatch } from '../src/engine/simulate.ts';
import { Crew } from '../src/agents/crew.ts';
import type { RpcResponse } from '../src/mcp/server.ts';
import type { ContentScreen } from '../src/ai/safety.ts';
import type { Audience, ChatRequest, JsonModel, TextTranslator } from '../src/types.ts';

// Narrow away null and undefined, failing the test if the value is missing.
export function must<T>(value: T | null | undefined, what = 'value'): T {
  assert.ok(value !== null && value !== undefined, `${what} is missing`);
  return value;
}

// A model double from a plain function.
export function model(json: (request: ChatRequest) => unknown | Promise<unknown>, name = 'test'): JsonModel {
  return { name, json: async (request) => json(request) };
}

export function translator(translate: (texts: string[], language: string) => string[]): TextTranslator {
  return { translate: async (texts, language) => translate(texts, language) };
}

export async function runCrew(
  llm: JsonModel | null,
  { seed = 7, translator = null, safety = null, audiences }: { seed?: number; translator?: TextTranslator | null; safety?: ContentScreen | null; audiences?: Audience[] } = {},
) {
  const match = simulateMatch({ seed });
  const crew = new Crew({ meta: match.meta, llm, translator, safety, ...(audiences && { audiences }) });
  for (const ev of match.events) await crew.onEvent(ev);
  return { match, crew };
}

// The evidence pack an agent was given, from a recorded request.
export function evidenceOf(request: ChatRequest) {
  return (request.user as { evidence: import('../src/agents/evidence.ts').EvidencePack }).evidence;
}

export interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

// A throwaway HTTP server that records requests and answers with handler().
export async function mockServer(handler: (request: RecordedRequest) => [status: number, payload: unknown]) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const entry: RecordedRequest = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null };
      requests.push(entry);
      const [status, payload] = handler(entry);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

// The result of a JSON-RPC response, failing the test on an error or no reply.
export function rpcResult(res: RpcResponse | null): Record<string, any> {
  const r = must(res, 'RPC response');
  assert.ok('result' in r, `RPC error: ${'error' in r ? r.error.message : ''}`);
  return r.result;
}

export function rpcError(res: RpcResponse | null): { code: number; message: string } {
  const r = must(res, 'RPC response');
  assert.ok('error' in r, 'expected an RPC error');
  return r.error;
}

// A fetch Response stand-in for the model and translator clients.
export function fakeResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): import('../src/ai/llm.ts').HttpResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => text, json: async () => JSON.parse(text) };
}
