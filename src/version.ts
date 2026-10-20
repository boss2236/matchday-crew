// A fingerprint of the server code. The server reports it in /api/config and
// the web app is built with the same value, so the app can tell a visitor when
// the page and the running server come from different code (for example, a
// server started before the last build) instead of half-working.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function sourceFingerprint(dir: string = new URL('.', import.meta.url).pathname): string {
  const hash = createHash('sha256');
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.ts')) hash.update(name).update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest('hex').slice(0, 12);
}
