// The match in 3D: the same World as the 2D players view (players2d/world.ts),
// drawn with three.js as a floodlit stadium seen from a broadcast camera on the
// halfway line. World metres map to scene metres: x along the pitch, the pitch's
// y across it (scene z, the near touchline towards the camera), height up.
import * as THREE from 'three';
import type { Meta } from '../players2d/types.ts';
import type { Player, World } from '../players2d/world.ts';

const LENGTH = 105, WIDTH = 68;
const SKIN = ['#f1c7a3', '#d9a27a', '#b97a52', '#8d5a3b', '#5e3b26', '#e8b48f'];
const HAIR = ['#2b1d14', '#1a1410', '#4a3020', '#0f0f0f', '#6b4a2b'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// Figures are drawn a little larger than life so they read at broadcast distance.
const SIZE = 1.25;

// World (pitch metres) -> scene coordinates.
const sx = (x: number) => x - LENGTH / 2;
const sz = (y: number) => y - WIDTH / 2;

interface Figure {
  root: THREE.Group;
  body: THREE.Group;
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
  heading: number;
}

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d') as CanvasRenderingContext2D);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// The pitch surface: mown stripes and the markings, painted once.
function pitchTexture() {
  const ppm = 16; // pixels per metre
  const pad = 4;
  return canvasTexture((LENGTH + pad * 2) * ppm, (WIDTH + pad * 2) * ppm, (ctx) => {
    const X = (x: number) => (x + pad) * ppm, Y = (y: number) => (y + pad) * ppm;
    ctx.fillStyle = '#1f7337';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = i % 2 ? '#2b7f43' : '#318a4a';
      ctx.fillRect(X((i * LENGTH) / 20), Y(0), (LENGTH / 20) * ppm + 1, WIDTH * ppm);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 0.14 * ppm;
    ctx.strokeRect(X(0), Y(0), LENGTH * ppm, WIDTH * ppm);
    ctx.beginPath(); ctx.moveTo(X(LENGTH / 2), Y(0)); ctx.lineTo(X(LENGTH / 2), Y(WIDTH)); ctx.stroke();
    ctx.beginPath(); ctx.arc(X(LENGTH / 2), Y(WIDTH / 2), 9.15 * ppm, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(X(LENGTH / 2), Y(WIDTH / 2), 0.25 * ppm, 0, Math.PI * 2); ctx.fill();
    for (const end of [0, LENGTH]) {
      const s = end ? -1 : 1;
      ctx.strokeRect(Math.min(X(end), X(end + s * 16.5)), Y(13.84), 16.5 * ppm, 40.32 * ppm);
      ctx.strokeRect(Math.min(X(end), X(end + s * 5.5)), Y(24.84), 5.5 * ppm, 18.32 * ppm);
      ctx.beginPath(); ctx.arc(X(end + s * 11), Y(34), 0.25 * ppm, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      if (end) ctx.arc(X(end - 11), Y(34), 9.15 * ppm, Math.PI - 0.93, Math.PI + 0.93);
      else ctx.arc(X(11), Y(34), 9.15 * ppm, -0.93, 0.93);
      ctx.stroke();
    }
  });
}

// A stand full of fans: rows of coloured specks.
function crowdTexture() {
  return canvasTexture(2048, 256, (ctx) => {
    ctx.fillStyle = '#141c2b';
    ctx.fillRect(0, 0, 2048, 256);
    const colours = ['#c5323b', '#2a78d6', '#e8e8e8', '#eb6834', '#3b4558', '#f2c14e', '#1f2a3d'];
    for (let row = 0; row < 16; row++) {
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = colours[(i * 7 + row * 3 + ((i * row) % 5)) % colours.length] as string;
        ctx.fillRect(i * 7.9 + (row % 2) * 3, row * 16 + 4, 5, 9);
      }
    }
  });
}

// A shirt number for the back of a torso.
function numberTexture(shirt: number, colour: string, ink: string) {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = ink;
    ctx.font = '800 76px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(shirt), 64, 70);
  });
}

function labelSprite(text: string) {
  const tex = canvasTexture(256, 64, (ctx) => {
    ctx.font = '700 34px system-ui, sans-serif';
    const w = Math.min(250, ctx.measureText(text).width + 28);
    ctx.fillStyle = 'rgba(8,12,20,0.82)';
    ctx.beginPath();
    ctx.roundRect((256 - w) / 2, 6, w, 52, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 33);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(4, 1, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// Broadcast: high on the near side at halfway. Tactical: high above, most of the
// pitch in view. Follow: low behind the team with the ball, looking at the goal
// it attacks.
export type CameraMode = 'broadcast' | 'tactical' | 'follow';

export class Scene3D {
  cameraMode: CameraMode = 'broadcast';
  camAt = new THREE.Vector3();
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 16 / 9, 1, 600);
  figures = new Map<string, Figure>();
  ball: THREE.Mesh;
  ballShadow: THREE.Mesh;
  nets: { x: number; mesh: THREE.Mesh; base: Float32Array }[] = [];
  label: THREE.Sprite | null = null;
  labelFor = '';
  camX = 0;
  w = 0;
  h = 0;

  constructor(public canvas: HTMLCanvasElement, meta: Meta) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color('#0b1220');
    this.scene.fog = new THREE.Fog('#0b1220', 140, 320);

    // Floodlights: a soft sky fill and one strong key light casting the shadows.
    this.scene.add(new THREE.HemisphereLight('#cfe3ff', '#1d3b22', 1.25));
    const sun = new THREE.DirectionalLight('#fff6e6', 2.4);
    sun.position.set(-30, 70, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -64, right: 64, top: 44, bottom: -44, near: 10, far: 200 });
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    // Pitch, the grass around it, and the stands on three sides (the camera's side is open).
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(LENGTH + 40, WIDTH + 40), new THREE.MeshLambertMaterial({ color: '#1b6331' }));
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.02;
    surround.receiveShadow = true;
    this.scene.add(surround);
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(LENGTH + 8, WIDTH + 8), new THREE.MeshLambertMaterial({ map: pitchTexture() }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    this.scene.add(pitch);
    const crowd = crowdTexture();
    crowd.wrapS = THREE.RepeatWrapping;
    const stand = (len: number, x: number, z: number, ry: number) => {
      const tex = crowd.clone();
      tex.repeat.set(len / 60, 1);
      tex.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 16), new THREE.MeshLambertMaterial({ map: tex, color: '#9aa3b5' }));
      m.position.set(x + Math.sin(ry) * -4, 6.5, z + Math.cos(ry) * -4);
      m.rotation.set(-0.6, ry, 0, 'YXZ');
      this.scene.add(m);
      const board = new THREE.Mesh(new THREE.BoxGeometry(len, 1, 0.2), new THREE.MeshLambertMaterial({ color: '#16233a', emissive: '#0d2f5c' }));
      board.position.set(x, 0.5, z);
      board.rotation.y = ry;
      this.scene.add(board);
    };
    stand(LENGTH + 30, 0, -WIDTH / 2 - 12, 0);
    stand(WIDTH + 30, -LENGTH / 2 - 12, 0, Math.PI / 2);
    stand(WIDTH + 30, LENGTH / 2 + 12, 0, -Math.PI / 2);

    for (const x of [0, LENGTH]) this.goal(x);

    // Players.
    const kits = {
      home: { shirt: meta.home.colors.dark, shorts: meta.home.colors.secondary === '#ffffff' ? '#e9edf2' : meta.home.colors.secondary, gk: '#e8d33f' },
      away: { shirt: meta.away.colors.dark, shorts: meta.away.colors.secondary, gk: '#2ec4b6' },
    };
    for (const side of ['home', 'away'] as const) {
      for (const p of meta[side].players) {
        const gk = p.pos === 'GK';
        const kit = kits[side];
        this.figures.set(p.id, this.figure(p.id, p.shirt, gk ? kit.gk : kit.shirt, gk ? '#222222' : kit.shorts, gk));
      }
    }

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45 }));
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.3 }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
    this.camera.position.set(0, 24, sz(WIDTH) + 42);
    this.resize();
  }

  goal(x: number) {
    const dir = x === 0 ? -1 : 1;
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
    const group = new THREE.Group();
    const post = (z: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.44, 12), white);
      m.position.set(0, 1.22, z);
      m.castShadow = true;
      group.add(m);
    };
    post(-3.66);
    post(3.66);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7.56, 12), white);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0, 2.44, 0);
    group.add(bar);
    // The net: one sheet from the crossbar back and down to the ground 2 m behind
    // the line, which bulges outwards when the ball hits it.
    const geo = new THREE.PlaneGeometry(1, 1, 16, 8);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5, v = pos.getY(i) + 0.5; // across the goal; ground (0) to crossbar (1)
      pos.setXYZ(i, dir * 2 * (1 - v), 2.44 * v, (u - 0.5) * 7.32);
    }
    const net = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.4 }));
    group.add(net);
    group.position.set(sx(x), 0, 0);
    this.scene.add(group);
    this.nets.push({ x, mesh: net, base: Float32Array.from(pos.array as Float32Array) });
  }

  figure(id: string, shirt: number, shirtColour: string, shortsColour: string, gk: boolean): Figure {
    const h = hash(id);
    const skin = new THREE.MeshStandardMaterial({ color: SKIN[h % SKIN.length], roughness: 0.7 });
    const kit = new THREE.MeshStandardMaterial({ color: shirtColour, roughness: 0.6 });
    const shorts = new THREE.MeshStandardMaterial({ color: shortsColour, roughness: 0.7 });
    const boots = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.5 });
    const back = new THREE.MeshStandardMaterial({ map: numberTexture(shirt, shirtColour, gk ? '#111111' : '#ffffff'), roughness: 0.6 });
    const cast = <T extends THREE.Object3D>(o: T) => {
      o.traverse((c) => (c.castShadow = true));
      return o;
    };

    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    root.scale.setScalar(SIZE);
    // Legs pivot at the hip: thigh-to-ankle in the kit's socks, a boot at the end.
    const leg = (side: number) => {
      const g = new THREE.Group();
      g.position.set(side * 0.11, 0.92, 0);
      const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.72, 4, 8), kit);
      limb.position.y = -0.44;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.26), boots);
      boot.position.set(0, -0.87, 0.06);
      g.add(limb, boot);
      body.add(cast(g));
      return g;
    };
    const legs: [THREE.Group, THREE.Group] = [leg(1), leg(-1)];
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.24), shorts);
    hips.position.y = 0.9;
    // Torso: the shirt, with the number on the back (box face order: +x -x +y -y +z -z).
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.24), [kit, kit, kit, kit, kit, back]);
    torso.position.y = 1.3;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
    head.position.y = 1.74;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: HAIR[h % HAIR.length], roughness: 0.9 }));
    hair.position.y = 1.76;
    body.add(cast(hips), cast(torso), cast(head), cast(hair));
    const arm = (side: number) => {
      const g = new THREE.Group();
      g.position.set(side * 0.27, 1.55, 0);
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.18, 4, 8), kit);
      sleeve.position.y = -0.12;
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 4, 8), gk ? kit : skin);
      fore.position.y = -0.42;
      g.add(sleeve, fore);
      body.add(cast(g));
      return g;
    };
    const arms: [THREE.Group, THREE.Group] = [arm(1), arm(-1)];
    this.scene.add(root);
    return { root, body, legs, arms, heading: 0 };
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h || (w === this.w && h === this.h)) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  pose(f: Figure, p: Player, world: World, dt: number) {
    f.root.position.set(sx(p.x), 0, sz(p.y));
    const speed = Math.hypot(p.vx, p.vy);
    const run = Math.min(1, speed / 6);
    // Face where they run; standing still, face the ball.
    const b = world.ball;
    const want = speed > 0.6 ? Math.atan2(p.vx, p.vy) : Math.atan2(b.x - p.x, b.y - p.y);
    let d = want - f.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    f.heading += d * Math.min(1, dt * 8);
    f.root.rotation.y = f.heading;

    const swing = Math.sin(p.phase) * 0.7 * run;
    const kickU = (world.clock - p.kick) / 0.35;
    const kicking = kickU >= 0 && kickU < 1;
    f.legs[0].rotation.x = kicking ? 0.4 - Math.sin(kickU * Math.PI) * 1.5 : swing;
    f.legs[1].rotation.x = kicking ? 0.15 : -swing;
    const celebrating = world.celebrate?.side === p.side;
    const scorer = celebrating && world.celebrate?.scorer === p.id;
    for (const [i, a] of f.arms.entries()) {
      const s = i ? 1 : -1;
      a.rotation.x = celebrating ? 0 : -swing * 0.9 * (i ? -1 : 1);
      a.rotation.z = celebrating ? s * 2.7 : s * 0.12;
    }
    const bob = Math.abs(Math.cos(p.phase)) * 0.05 * run;
    const jump = scorer ? Math.abs(Math.sin(world.clock * 2.4)) * 0.45 : 0;
    f.body.position.y = bob + jump;
    f.body.rotation.x = run * 0.18;
    // A keeper's dive: tip over sideways towards the shot and drop.
    const diveU = p.dive ? (world.clock - p.dive.t) / 1.4 : 2;
    if (diveU < 1 && p.dive) {
      const across = p.dive.dir * Math.cos(f.heading) >= 0 ? -1 : 1;
      f.body.rotation.z = across * Math.min(1, diveU * 4) * 1.35;
      f.body.position.y = Math.sin(Math.min(1, diveU * 3) * Math.PI) * 0.5;
    } else f.body.rotation.z = 0;
  }

  draw(world: World, dt: number) {
    this.resize();
    for (const p of world.players) {
      const f = this.figures.get(p.id);
      if (f) this.pose(f, p, world, dt);
    }
    const b = world.ball;
    this.ball.position.set(sx(b.x), 0.22 + b.z, sz(b.y));
    this.ball.rotation.x += dt * 6 * (b.flight || b.carrier ? 1 : 0);
    this.ballShadow.position.set(sx(b.x), 0.01, sz(b.y));

    // Net bulge after a goal.
    for (const n of this.nets) {
      const since = world.netHit && world.netHit.x === n.x ? world.clock - world.netHit.t : 99;
      const bulge = since < 3 ? Math.sin(Math.min(1, since * 2.5) * Math.PI) * Math.exp(-since) * 1.4 : 0;
      const pos = n.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const dir = n.x === 0 ? -1 : 1;
      for (let i = 0; i < pos.count; i++) {
        const y = n.base[i * 3 + 1] as number, z = n.base[i * 3 + 2] as number;
        const belly = bulge * Math.cos((z / 7.32) * Math.PI) * Math.sin((y / 2.44) * Math.PI);
        pos.setX(i, (n.base[i * 3] as number) + dir * belly);
      }
      pos.needsUpdate = true;
    }

    // A name tag over whoever has the ball (or the scorer, celebrating).
    const who = world.celebrate?.scorer ?? b.carrier ?? '';
    if (who !== this.labelFor) {
      if (this.label) {
        this.scene.remove(this.label);
        this.label.material.map?.dispose();
        this.label.material.dispose();
        this.label = null;
      }
      const p = world.byId.get(who);
      if (p) {
        this.label = labelSprite(p.name.split(' ').slice(-1)[0] as string);
        this.scene.add(this.label);
      }
      this.labelFor = who;
    }
    const tagged = world.byId.get(this.labelFor);
    if (this.label && tagged) this.label.position.set(sx(tagged.x), 3.3 * SIZE, sz(tagged.y));

    this.aim(world, dt);
    this.renderer.render(this.scene, this.camera);
  }

  aim(world: World, dt: number) {
    const b = world.ball;
    const narrow = this.w && this.w < 520;
    const wantX = clamp(sx(b.x), -LENGTH / 2 + 14, LENGTH / 2 - 14);
    this.camX += (wantX - this.camX) * Math.min(1, dt * 2.2);
    const ballZ = clamp(sz(b.y), -20, 20);

    // After a goal the director cuts to a low, close shot of the scorer's
    // celebration, then back to the chosen camera.
    const scorer = world.celebrate?.scorer ? world.byId.get(world.celebrate.scorer) : undefined;
    if (scorer && world.clock - (world.netHit?.t ?? -99) < 9) {
      const towards = world.netHit && world.netHit.x > 0 ? 1 : -1;
      const at = new THREE.Vector3(sx(scorer.x), 1.4, sz(scorer.y));
      this.camera.fov = narrow ? 50 : 38;
      this.camera.position.set(at.x - towards * 9, 4.6, at.z + 12);
      this.camAt.copy(at);
    } else {
      let pos: THREE.Vector3, at: THREE.Vector3, fov: number;
      if (this.cameraMode === 'tactical') {
        fov = narrow ? 52 : 38;
        pos = new THREE.Vector3(this.camX * 0.55, 78, 48);
        at = new THREE.Vector3(this.camX * 0.55, 0, 2);
      } else if (this.cameraMode === 'follow') {
        const dir = !world.possession || world.attacksRight(world.possession) ? 1 : -1;
        fov = narrow ? 60 : 46;
        pos = new THREE.Vector3(sx(b.x) - dir * 22, 9, ballZ * 0.6);
        at = new THREE.Vector3(sx(b.x) + dir * 18, 0, ballZ * 0.4);
      } else {
        // Broadcast: high on the near side at halfway, panning with the ball.
        fov = narrow ? 34 : 24;
        pos = new THREE.Vector3(this.camX * 0.9, 24, sz(WIDTH) + 42);
        at = new THREE.Vector3(this.camX, 0, ballZ * 0.45 - 1);
      }
      // Glide between shots rather than jumping (the goal cut above is a hard cut).
      const k = Math.min(1, dt * 3);
      this.camera.fov += (fov - this.camera.fov) * k;
      this.camera.position.lerp(pos, k);
      this.camAt.lerp(at, k);
    }
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.camAt);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
    this.renderer.dispose();
  }
}
