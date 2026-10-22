// Broadcast-camera drawing: a raised side view of the pitch that pans with the
// ball, with players drawn as small running figures in their club kits.
import type { Meta } from './types.ts';
import type { Player, World } from './world.ts';

const LENGTH = 105, WIDTH = 68;

const SKIN = ['#f1c7a3', '#d9a27a', '#b97a52', '#8d5a3b', '#5e3b26', '#e8b48f'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export class Renderer {
  ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  camX = 52.5;
  // Metres of pitch length across the screen at the near touchline: about 48 on a
  // wide screen, closer in on a tall phone so the players stay readable.
  view = 48;
  // Extra zoom while a goal is celebrated (1 = none), eased in and out.
  zoom = 1;
  kits: Record<'home' | 'away', { shirt: string; shorts: string; gk: string }>;

  constructor(public canvas: HTMLCanvasElement, meta: Meta) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.kits = {
      home: { shirt: meta.home.colors.dark, shorts: meta.home.colors.secondary === '#ffffff' ? '#e9edf2' : meta.home.colors.secondary, gk: '#e8d33f' },
      away: { shirt: meta.away.colors.dark, shorts: meta.away.colors.secondary, gk: '#2ec4b6' },
    };
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.view = Math.max(22, Math.min(48, (28 * this.w) / Math.max(1, this.h)));
    // A phone-width frame: closer still, about a quarter of the pitch across.
    if (this.w < 520) this.view = Math.min(this.view, 26);
  }

  // Perspective: the far touchline (y = 0) is higher and narrower than the near one.
  top() { return this.h * 0.2; }
  depth() { return this.h * 0.7; }
  scale(y: number) { return (this.w / (this.view / this.zoom)) * (0.7 + 0.3 * (y / WIDTH)); }
  project(x: number, y: number) {
    return { x: this.w / 2 + (x - this.camX) * this.scale(y), y: this.top() + this.depth() * (y / WIDTH) };
  }

  draw(world: World, dt: number) {
    const { ctx, w, h } = this;
    // Camera: follow the ball, smoothly, without showing beyond the pitch ends;
    // move in on the scorer for a few seconds after a goal.
    const goalCam = world.celebrate && world.clock - (world.netHit?.t ?? -99) < 8;
    this.zoom += ((goalCam ? 1.45 : 1) - this.zoom) * Math.min(1, dt * 1.5);
    const half = this.view / this.zoom / 2 - 4;
    const want = Math.max(half, Math.min(LENGTH - half, world.ball.x));
    this.camX += (want - this.camX) * Math.min(1, dt * 2.2);

    // Stand and crowd.
    const sky = ctx.createLinearGradient(0, 0, 0, this.top() + 10);
    sky.addColorStop(0, '#0d1626');
    sky.addColorStop(1, '#1d2a3f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const sx = ((i * 97.3 - this.camX * 6) % (w + 40) + w + 40) % (w + 40) - 20;
      const sy = this.top() * 0.25 + ((i * 53) % 100) / 100 * this.top() * 0.62;
      ctx.fillStyle = ['#c5323b', '#2a78d6', '#e8e8e8', '#eb6834', '#3b4558'][i % 5] as string;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(sx, sy, 3, 4);
    }
    ctx.globalAlpha = 1;

    // Grass with mown stripes, then the markings.
    const quad = (x0: number, y0: number, x1: number, y1: number, color: string) => {
      const a = this.project(x0, y0), b = this.project(x1, y0), c = this.project(x1, y1), d = this.project(x0, y1);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
    };
    quad(-6, -4, LENGTH + 6, WIDTH + 6, '#1d6b34');
    for (let i = 0; i < 20; i++) quad((i * LENGTH) / 20, 0, ((i + 1) * LENGTH) / 20, WIDTH, i % 2 ? '#24803f' : '#2a8c46');

    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    const line = (pts: [number, number][], close = false) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => { const p = this.project(x, y); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      if (close) ctx.closePath();
      ctx.stroke();
    };
    const circle = (cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2) => {
      const pts: [number, number][] = [];
      for (let k = 0; k <= 40; k++) { const a = a0 + ((a1 - a0) * k) / 40; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      line(pts);
    };
    line([[0, 0], [LENGTH, 0], [LENGTH, WIDTH], [0, WIDTH]], true);
    line([[LENGTH / 2, 0], [LENGTH / 2, WIDTH]]);
    circle(LENGTH / 2, WIDTH / 2, 9.15);
    for (const end of [0, LENGTH]) {
      const s = end ? -1 : 1;
      line([[end, 13.84], [end + s * 16.5, 13.84], [end + s * 16.5, 54.16], [end, 54.16]]);
      line([[end, 24.84], [end + s * 5.5, 24.84], [end + s * 5.5, 43.16], [end, 43.16]]);
      circle(end + s * 11, 34, 9.15, end ? Math.PI - 0.93 : -0.93, end ? Math.PI + 0.93 : 0.93);
    }
    this.goal(0, -1, world);
    this.goal(LENGTH, 1, world);

    // Players and ball, far to near so nearer figures overlap.
    const things: { y: number; draw: () => void }[] = world.players.map((p) => ({ y: p.y, draw: () => this.player(p, world) }));
    things.push({ y: world.ball.y + 0.01, draw: () => this.ballDraw(world) });
    things.sort((a, b) => a.y - b.y).forEach((t) => t.draw());
  }

  goal(x: number, dir: 1 | -1, world: World) {
    const { ctx } = this;
    const posts = [30.34, 37.66].map((y) => this.project(x, y));
    const hgt = (y: number) => 2.44 * this.scale(y) * 1.25;
    // After a goal the net billows out behind the line, then settles.
    const since = world.netHit && world.netHit.x === x ? world.clock - world.netHit.t : 99;
    const bulge = since < 3 ? Math.sin(Math.min(1, since * 2.5) * Math.PI) * Math.exp(-since) * 1.6 : 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let k = 0; k <= 6; k++) {
      const yy = 30.34 + (7.32 * k) / 6;
      const belly = bulge * Math.sin((k / 6) * Math.PI);
      const a = this.project(x, yy), b = this.project(x + dir * (2 + belly), yy);
      ctx.beginPath(); ctx.moveTo(a.x, a.y - hgt(yy)); ctx.lineTo(b.x, b.y - hgt(yy) * 0.85); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    const [p0, p1] = posts as [{ x: number; y: number }, { x: number; y: number }];
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y); ctx.lineTo(p0.x, p0.y - hgt(30.34)); ctx.lineTo(p1.x, p1.y - hgt(37.66)); ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  player(p: Player, world: World) {
    const { ctx } = this;
    const s = this.scale(p.y);
    const f = this.project(p.x, p.y);
    const H = 1.85 * s * 1.8; // figures drawn larger than life so they read on screen
    const kit = this.kits[p.side];
    const speed = Math.hypot(p.vx, p.vy);
    const run = Math.min(1, speed / 6);
    const swing = Math.sin(p.phase) * 0.55 * run;
    const bob = Math.abs(Math.cos(p.phase)) * H * 0.03 * run;
    const celebrating = world.celebrate && world.celebrate.side === p.side;
    const jump = celebrating && world.celebrate?.scorer === p.id ? Math.abs(Math.sin(world.clock * 2.4)) * H * 0.25 : 0;
    // Kicking: the leg nearest the ball swings through over a third of a second.
    const kickU = (world.clock - p.kick) / 0.35;
    const kicking = kickU >= 0 && kickU < 1;
    // A keeper's dive: the whole figure tips over sideways and lands.
    const diveU = p.dive ? (world.clock - p.dive.t) / 1.4 : 2;
    if (p.dive && diveU >= 1) p.dive = null;
    ctx.save();
    if (diveU < 1 && p.dive) {
      const tip = Math.min(1, diveU * 4) * 1.35 * p.dive.dir * -p.facing;
      ctx.translate(f.x, f.y);
      ctx.rotate(tip);
      ctx.translate(-f.x, -f.y + Math.sin(Math.min(1, diveU * 3) * Math.PI) * H * 0.15);
    }

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(f.x + H * 0.08, f.y, H * 0.2, H * 0.06, 0, 0, Math.PI * 2); ctx.fill();

    const hipY = f.y - H * 0.47 - bob - jump;
    const leg = H * 0.47;
    ctx.lineCap = 'round';
    // Legs (socks in shirt colour, boots dark).
    for (const sgn of [1, -1]) {
      const a = kicking && sgn === 1 ? -0.5 + Math.sin(kickU * Math.PI) * 1.6 : kicking ? -0.15 : swing * sgn;
      const fx = f.x + Math.sin(a) * leg * p.facing, fy = hipY + Math.cos(a) * leg;
      ctx.strokeStyle = p.gk ? kit.gk : kit.shirt;
      ctx.lineWidth = H * 0.085;
      ctx.beginPath(); ctx.moveTo(f.x, hipY); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = H * 0.07;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + p.facing * H * 0.05, fy); ctx.stroke();
    }
    // Shorts.
    ctx.fillStyle = p.gk ? '#222' : kit.shorts;
    ctx.fillRect(f.x - H * 0.1, hipY - H * 0.08, H * 0.2, H * 0.13);
    // Shirt (torso, leaning forward when running).
    const lean = run * 0.15 * p.facing;
    const shoulderX = f.x + lean * H, shoulderY = hipY - H * 0.33;
    ctx.fillStyle = p.gk ? kit.gk : kit.shirt;
    ctx.beginPath();
    ctx.moveTo(f.x - H * 0.11, hipY - H * 0.06);
    ctx.lineTo(shoulderX - H * 0.13, shoulderY);
    ctx.lineTo(shoulderX + H * 0.13, shoulderY);
    ctx.lineTo(f.x + H * 0.11, hipY - H * 0.06);
    ctx.closePath();
    ctx.fill();
    // Arms swing against the legs (raised when celebrating).
    ctx.strokeStyle = SKIN[hash(p.id) % SKIN.length] as string;
    ctx.lineWidth = H * 0.06;
    for (const sgn of [1, -1]) {
      const a = celebrating ? -2.6 * sgn : -swing * sgn * 0.9;
      ctx.beginPath(); ctx.moveTo(shoulderX, shoulderY + H * 0.03);
      ctx.lineTo(shoulderX + Math.sin(a) * H * 0.3 * p.facing, shoulderY + H * 0.03 + Math.cos(a) * H * 0.3);
      ctx.stroke();
    }
    // Head.
    ctx.fillStyle = SKIN[hash(p.id) % SKIN.length] as string;
    ctx.beginPath(); ctx.arc(shoulderX, shoulderY - H * 0.09, H * 0.085, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b1d14';
    ctx.beginPath(); ctx.arc(shoulderX, shoulderY - H * 0.12, H * 0.08, Math.PI, 0); ctx.fill();
    // Shirt number.
    if (H > 26) {
      ctx.fillStyle = p.gk ? '#111' : '#ffffff';
      ctx.font = `700 ${Math.round(H * 0.15)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(p.shirt), f.x + lean * H * 0.5, hipY - H * 0.15);
    }
    // Name over whoever has the ball.
    if (world.ball.carrier === p.id || (celebrating && world.celebrate?.scorer === p.id)) {
      ctx.font = `600 ${Math.max(12, Math.round(H * 0.17))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const label = p.name.split(' ').slice(-1)[0] as string;
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(8,12,20,0.75)';
      ctx.fillRect(shoulderX - tw / 2, shoulderY - H * 0.48, tw, H * 0.22);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, shoulderX, shoulderY - H * 0.32);
    }
    ctx.restore();
  }

  ballDraw(world: World) {
    const { ctx } = this;
    const b = world.ball;
    const s = this.scale(b.y);
    const g = this.project(b.x, b.y);
    const r = Math.max(3, 0.22 * s * 1.6);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(g.x, g.y, r * 1.1, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    const by = g.y - r - b.z * s * 1.4;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(g.x, by, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(g.x + r * 0.2, by - r * 0.1, r * 0.35, 0, Math.PI * 2); ctx.fill();
  }
}
