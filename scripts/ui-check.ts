// UI smoke check: open the app in a headless Chromium, let a match play, then
// report console errors and save screenshots. Uses the DevTools protocol over
// Node's built-in WebSocket, so no npm dependencies.
//
//   CHROME=/path/to/chrome node scripts/ui-check.ts "http://localhost:3000/?autostart=1&speed=60" out/ui 20
//
// Args: url, output prefix, seconds to wait. Exits 1 if the page threw errors.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, any>;
  result?: Record<string, any>;
  error?: { message: string };
}

interface PageReport {
  feed: number;
  overlays: number;
  trace: number;
  score: string;
  clock: string;
  horizontalScroll: boolean;
  scrollY?: number;
  screenshot?: string;
}

const [url, prefix = 'out/ui', seconds = '15'] = process.argv.slice(2);
if (!url) {
  console.error('usage: node scripts/ui-check.ts <url> [prefix] [seconds]');
  process.exit(2);
}
const chrome = process.env.CHROME || 'chromium';
const sizes: [name: string, width: number, height: number, mobile: boolean][] = [
  ['desktop', 1440, 1100, false],
  ['mobile', 390, 844, true],
];

const profile = mkdtempSync(join(tmpdir(), 'mc-ui-'));
const proc = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
const wsUrl = await new Promise<string>((resolve, reject) => {
  let buf = '';
  proc.stderr.on('data', (d: Buffer) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m?.[1]) resolve(m[1]);
  });
  proc.on('exit', (code) => reject(new Error(`chrome exited ${code}: ${buf.slice(-500)}`)));
});

const browser = new WebSocket(wsUrl);
await new Promise((r) => browser.addEventListener('open', r, { once: true }));
let nextId = 0;
const pending = new Map<number, (msg: CdpMessage) => void>();
const listeners: ((msg: CdpMessage) => void)[] = [];
browser.addEventListener('message', (e: MessageEvent) => {
  const msg = JSON.parse(String(e.data)) as CdpMessage;
  const done = msg.id !== undefined ? pending.get(msg.id) : undefined;
  if (done && msg.id !== undefined) {
    done(msg);
    pending.delete(msg.id);
  } else listeners.forEach((fn) => fn(msg));
});
const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
  new Promise<Record<string, any>>((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result ?? {})));
    browser.send(JSON.stringify({ id, method, params, sessionId }));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const errors: string[] = [];
listeners.push((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params?.exceptionDetails?.exception?.description ?? msg.params?.exceptionDetails?.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    errors.push((msg.params.args as { value?: unknown; description?: string }[]).map((a) => a.value ?? a.description).join(' '));
  }
});

const report: Record<string, PageReport> = {};
try {
  for (const [name, width, height, mobile] of sizes) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
    await send('Page.navigate', { url }, sessionId);
    await sleep(Number(seconds) * 1000);
    const { result } = await send(
      'Runtime.evaluate',
      {
        expression: `JSON.stringify({
          feed: document.querySelectorAll('#feed li').length,
          overlays: document.querySelectorAll('#overlays .ov').length,
          trace: document.querySelectorAll('#trace li').length,
          score: document.getElementById('homeScore')?.textContent + '-' + document.getElementById('awayScore')?.textContent,
          clock: document.getElementById('clock')?.textContent ?? '',
          horizontalScroll: document.documentElement.scrollWidth > innerWidth + 1,
          scrollY: Math.round(scrollY),
          pageHeight: document.documentElement.scrollHeight,
        })`,
        returnByValue: true,
      },
      sessionId,
    );
    const page = JSON.parse(result.value) as PageReport & { pageHeight: number };
    // Optional extra probe for debugging layout: UI_EVAL='<expression returning JSON-able>'
    if (process.env.UI_EVAL) {
      const probe = await send('Runtime.evaluate', { expression: process.env.UI_EVAL, returnByValue: true }, sessionId);
      console.error(`[${name}] UI_EVAL:`, JSON.stringify(probe.result?.value ?? probe.exceptionDetails?.text));
    }
    // Full-page capture: grow the viewport to the page, from the top.
    await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' }, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(4000, page.pageHeight), deviceScaleFactor: 1, mobile }, sessionId);
    await sleep(600);
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = `${prefix}-${name}.png`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(shot.data as string, 'base64'));
    report[name] = { ...page, screenshot: file };
    await send('Target.closeTarget', { targetId });
  }
} finally {
  browser.close();
  proc.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

console.log(JSON.stringify({ report, errors }, null, 2));
process.exit(errors.length ? 1 : 0);
