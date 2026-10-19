// UI smoke check: open the app in a headless Chromium, let a match play, then
// report console errors and save screenshots. Uses the DevTools protocol over
// Node's built-in WebSocket, so no npm dependencies.
//
//   CHROME=/path/to/chrome node scripts/ui-check.mjs http://localhost:3000/?autostart=1&speed=60 out/ui 20
//
// Args: url, output prefix, seconds to wait. Exits 1 if the page threw errors.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const [url, prefix = 'out/ui', seconds = '15'] = process.argv.slice(2);
const chrome = process.env.CHROME || 'chromium';
const sizes = [
  ['desktop', 1440, 1100, false],
  ['mobile', 390, 844, true],
];

const profile = mkdtempSync(join(tmpdir(), 'mc-ui-'));
const proc = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  proc.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  proc.on('exit', (code) => reject(new Error(`chrome exited ${code}: ${buf.slice(-500)}`)));
});

const browser = new WebSocket(wsUrl);
await new Promise((r) => browser.addEventListener('open', r, { once: true }));
let nextId = 0;
const pending = new Map();
const listeners = [];
browser.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else listeners.forEach((fn) => fn(msg));
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    browser.send(JSON.stringify({ id, method, params, sessionId }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
listeners.push((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
});

let report = {};
try {
  for (const [name, width, height, mobile] of sizes) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
    await send('Page.navigate', { url }, sessionId);
    await sleep(Number(seconds) * 1000);
    const { result } = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        feed: document.querySelectorAll('#feed li').length,
        overlays: document.querySelectorAll('#overlays .ov').length,
        trace: document.querySelectorAll('#trace li').length,
        score: document.getElementById('homeScore').textContent + '-' + document.getElementById('awayScore').textContent,
        clock: document.getElementById('clock').textContent,
        horizontalScroll: document.documentElement.scrollWidth > innerWidth + 1,
      })`,
      returnByValue: true,
    }, sessionId);
    report[name] = JSON.parse(result.value);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(4000, height * 2), scale: 1 } }, sessionId);
    const file = `${prefix}-${name}.png`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    report[name].screenshot = file;
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
