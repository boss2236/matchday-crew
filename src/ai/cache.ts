// Response cache for model calls. Same prompt, same answer, no second call.
//
// Matches are seeded and agents are deterministic up to the model call, so a
// replay of the same match for the same audience sends the same prompts. The
// cache turns that into instant, free replays: the demo and the judges' test
// link never wait on a rate limit, and with no model configured at all the
// cache alone can serve lines that a model wrote earlier.
//
// One JSON file per prompt, named by a hash of the request. The key ignores
// which provider answered, so a cache filled on Groq also serves Foundry runs.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatRequest, JsonModel } from '../types.ts';

export const DEFAULT_CACHE_DIR = new URL('../../data/llm-cache/', import.meta.url).pathname;

export function cacheKey({ system, user, maxTokens = 500 }: ChatRequest): string {
  return createHash('sha256').update(JSON.stringify({ system, user, maxTokens })).digest('hex').slice(0, 32);
}

export class CacheMissError extends Error {
  code = 'CACHE_MISS' as const;
}

export class CachedChat implements JsonModel {
  inner: JsonModel | null;
  dir: string;
  write: boolean;
  name: string;
  usage: { calls: number; promptTokens: number; completionTokens: number };
  stats: { hits: number; misses: number; writeError?: string };

  // inner: a ChatClient (or anything with json()), or null for replay-only mode.
  constructor(inner: JsonModel | null, { dir = DEFAULT_CACHE_DIR, write = true }: { dir?: string; write?: boolean } = {}) {
    this.inner = inner;
    this.dir = dir;
    this.write = write && Boolean(inner);
    this.name = inner ? `cache+${inner.name}` : 'cache';
    this.usage = inner?.usage ?? { calls: 0, promptTokens: 0, completionTokens: 0 };
    this.stats = { hits: 0, misses: 0 };
  }

  async json(request: ChatRequest): Promise<unknown> {
    const file = join(this.dir, `${cacheKey(request)}.json`);
    if (existsSync(file)) {
      this.stats.hits += 1;
      return JSON.parse(readFileSync(file, 'utf8')).output;
    }
    this.stats.misses += 1;
    if (!this.inner) throw new CacheMissError('no cached answer and no model configured');
    const output = await this.inner.json(request);
    if (this.write) {
      try {
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(file, JSON.stringify({ model: this.inner.name, output }, null, 1));
      } catch (err) {
        // A read-only filesystem (some containers) must not cost us a good answer.
        this.write = false;
        this.stats.writeError = (err as NodeJS.ErrnoException).code ?? String(err);
      }
    }
    return output;
  }
}
