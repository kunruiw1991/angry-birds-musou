// Particles: material debris (wood splinters, glass shards + sparkle, stone chunks + dust),
// explosions (sparks + billowing dark smoke), pig pops (green ring + smoke + stars),
// bird feathers on impacts & abilities. Cap 900, halve spawns above 600 (LOD).
// Pure bus listener + Canvas 2D layer; never mutates physics world. Spec: docs/DESIGN.md §9.

import { bus } from '../core/bus.js';
import { EV } from '../contracts.js';

const MAX_PARTICLES = 900;
const LOD_THRESHOLD = 600;
const TWO_PI = Math.PI * 2;

const BIRD_COLORS = {
  red: ['#e0282e', '#ff8aa0'],
  blues: ['#3fb4f7', '#a8ebff'],
  chuck: ['#ffd41f', '#fff799'],
  bomb: ['#2f2f33', '#ff7a1a'],
  matilda: ['#f7f4ea', '#ffb6c9'],
  hal: ['#39bf42', '#b9ff8c'],
  terence: ['#b3141b', '#ff5959'],
  bubbles: ['#ff881a', '#ffd066'],
  silver: ['#cfd8dc', '#ffffff'],
  poppy: ['#ffe047', '#fff9b3'],
  stella: ['#ff7eb9', '#ffd1eb'],
  gale: ['#9b4dca', '#e88aff'],
};

// Precomputed unit 5-point star vertices
const STAR_VERTS = (() => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 1 : 0.44;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return pts;
})();

const parts = [];
let initialized = false;
let lastAbilityPos = { x: 20, y: 6, birdId: 'red' };

function lodCount(n, priority = false) {
  const cur = parts.length;
  if (cur >= MAX_PARTICLES) {
    if (!priority) return 0;
    // Evict a small slice of oldest particles for high-priority mega/pig events
    const evict = Math.min(24, n);
    parts.splice(0, evict);
    return evict;
  }
  const scaled = cur > LOD_THRESHOLD ? Math.max(1, Math.ceil(n * 0.5)) : n;
  return Math.min(scaled, MAX_PARTICLES - cur);
}

function pushPart(q) {
  if (parts.length < MAX_PARTICLES) parts.push(q);
}

function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

function spawnWoodBreak(x, y, bvx = 0, bvy = 0) {
  // 8 wood splinters + 2 warm dust puffs
  const n = lodCount(8);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(2.5, 9.5);
    pushPart({
      kind: 'splinter',
      x: x + rand(-0.22, 0.22),
      y: y + rand(-0.22, 0.22),
      vx: Math.cos(a) * sp + bvx * 0.25,
      vy: Math.sin(a) * sp + rand(1.5, 4.5) + bvy * 0.25,
      grav: 13.5,
      drag: 0.4,
      rot: rand(0, TWO_PI),
      vrot: rand(-14, 14),
      size: rand(0.14, 0.28),
      color: i % 2 === 0 ? '#d68c38' : '#b56d22',
      stroke: '#63370f',
      age: 0,
      life: rand(0.65, 1.15),
    });
  }
  const nd = lodCount(2);
  for (let i = 0; i < nd; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(0.8, 2.8);
    pushPart({
      kind: 'smoke',
      x: x + rand(-0.2, 0.2),
      y: y + rand(-0.2, 0.2),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + 0.8,
      grav: -1.2,
      drag: 2.2,
      size: rand(0.22, 0.38),
      color: '#cfa36e',
      alpha0: 0.45,
      age: 0,
      life: rand(0.45, 0.75),
    });
  }
}

function spawnGlassBreak(x, y, bvx = 0, bvy = 0) {
  // 10 icy shards + 4 twinkling sparkles
  const n = lodCount(10);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(3.0, 10.5);
    pushPart({
      kind: 'shard',
      x: x + rand(-0.22, 0.22),
      y: y + rand(-0.22, 0.22),
      vx: Math.cos(a) * sp + bvx * 0.25,
      vy: Math.sin(a) * sp + rand(1.2, 4.2) + bvy * 0.25,
      grav: 11.5,
      drag: 0.5,
      rot: rand(0, TWO_PI),
      vrot: rand(-16, 16),
      size: rand(0.13, 0.26),
      color: i % 3 === 0 ? '#e8fbff' : '#9be4ff',
      stroke: '#4ba3cc',
      age: 0,
      life: rand(0.6, 1.05),
    });
  }
  const ns = lodCount(4);
  for (let i = 0; i < ns; i++) {
    pushPart({
      kind: 'sparkle',
      x: x + rand(-0.45, 0.45),
      y: y + rand(-0.45, 0.45),
      vx: rand(-1.5, 1.5),
      vy: rand(0.4, 2.4),
      grav: 0,
      drag: 2.0,
      size: rand(0.16, 0.3),
      color: '#ffffff',
      age: 0,
      life: rand(0.35, 0.65),
    });
  }
}

function spawnStoneBreak(x, y, bvx = 0, bvy = 0) {
  // 7 stone chunks + 3 dust puffs
  const n = lodCount(7);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(2.2, 8.2);
    pushPart({
      kind: 'chunk',
      x: x + rand(-0.22, 0.22),
      y: y + rand(-0.22, 0.22),
      vx: Math.cos(a) * sp + bvx * 0.2,
      vy: Math.sin(a) * sp + rand(1.5, 4.0) + bvy * 0.2,
      grav: 16.0,
      drag: 0.3,
      rot: rand(0, TWO_PI),
      vrot: rand(-10, 10),
      size: rand(0.14, 0.28),
      color: i % 2 === 0 ? '#9da3aa' : '#747a82',
      stroke: '#44494f',
      age: 0,
      life: rand(0.7, 1.2),
    });
  }
  const nd = lodCount(3);
  for (let i = 0; i < nd; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(0.8, 3.0);
    pushPart({
      kind: 'smoke',
      x: x + rand(-0.28, 0.28),
      y: y + rand(-0.28, 0.28),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + 0.9,
      grav: -1.4,
      drag: 2.4,
      size: rand(0.32, 0.56),
      color: '#b0aba4',
      alpha0: 0.62,
      age: 0,
      life: rand(0.55, 0.95),
    });
  }
}

function spawnTntBreak(x, y, bvx = 0, bvy = 0) {
  const n = lodCount(8);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(3.5, 11.0);
    pushPart({
      kind: 'splinter',
      x: x + rand(-0.2, 0.2),
      y: y + rand(-0.2, 0.2),
      vx: Math.cos(a) * sp + bvx * 0.2,
      vy: Math.sin(a) * sp + rand(2.0, 5.0) + bvy * 0.2,
      grav: 13.5,
      drag: 0.4,
      rot: rand(0, TWO_PI),
      vrot: rand(-16, 16),
      size: rand(0.15, 0.28),
      color: i % 2 === 0 ? '#e03126' : '#d68c38',
      stroke: '#4f120d',
      age: 0,
      life: rand(0.65, 1.1),
    });
  }
}

function spawnExplosion(x, y, r = 2, power = 'normal') {
  const isMega = power === 'mega';
  const isSmall = power === 'small';
  const smokeGoal = isMega ? 20 : isSmall ? 4 : 6;
  const sparkGoal = isMega ? 38 : isSmall ? 10 : 14;
  const spread = Math.max(0.4, r * 0.35);

  // Dark charcoal billowing smoke puffs (matching video bomb_a/bomb_b)
  const ns = lodCount(smokeGoal, isMega);
  for (let i = 0; i < ns; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(1.0, isMega ? 11.5 : 5.2);
    pushPart({
      kind: 'smoke',
      x: x + Math.cos(a) * rand(0, spread),
      y: y + Math.sin(a) * rand(0, spread),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + rand(0.8, 3.2),
      grav: -2.0,
      drag: 2.3,
      size: rand(isMega ? 0.55 : 0.32, isMega ? 1.35 : 0.72),
      color: i % 3 === 0 ? '#3d3531' : '#231f1d',
      alpha0: 0.88,
      age: 0,
      life: rand(0.65, isMega ? 1.45 : 1.05),
    });
  }

  // Fiery orange-gold fireball core puffs (pops brightly on both day and night biomes)
  const nf = lodCount(isMega ? 10 : isSmall ? 2 : 4, isMega);
  for (let i = 0; i < nf; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(0.6, isMega ? 7.5 : 3.4);
    pushPart({
      kind: 'smoke',
      x: x + Math.cos(a) * rand(0, spread * 0.6),
      y: y + Math.sin(a) * rand(0, spread * 0.6),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + 0.6,
      grav: -1.5,
      drag: 2.6,
      size: rand(isMega ? 0.45 : 0.25, isMega ? 1.05 : 0.52),
      color: i % 2 === 0 ? '#ff8c1a' : '#ffe14a',
      alpha0: 0.85,
      age: 0,
      life: rand(0.24, isMega ? 0.55 : 0.38),
    });
  }

  // Hot fiery sparks & streaking embers
  const np = lodCount(sparkGoal, isMega);
  for (let i = 0; i < np; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(4.5, isMega ? 24.0 : 14.5);
    pushPart({
      kind: 'spark',
      x: x + rand(-0.2, 0.2),
      y: y + rand(-0.2, 0.2),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + rand(1.0, 4.5),
      grav: 11.0,
      drag: 0.9,
      size: rand(0.12, isMega ? 0.32 : 0.22),
      color: i % 3 === 0 ? '#fff6a8' : i % 3 === 1 ? '#ff941a' : '#ff4500',
      age: 0,
      life: rand(0.4, isMega ? 1.15 : 0.8),
    });
  }

  if (isMega) {
    if (lodCount(1, true) > 0) {
      pushPart({
        kind: 'ring',
        x, y, vx: 0, vy: 0, grav: 0, drag: 0,
        r0: 0.6, r1: Math.max(5.5, r * 1.25),
        color: '#ffae33',
        age: 0, life: 0.55,
      });
    }
  }
}

function spawnPigPop(x, y, r = 0.45, boss = false) {
  // Green expanding ring
  if (lodCount(1, true) > 0) {
    pushPart({
      kind: 'ring',
      x, y, vx: 0, vy: 0, grav: 0, drag: 0,
      r0: r * 0.7,
      r1: r * (boss ? 4.4 : 3.5),
      color: '#7CFC00',
      age: 0,
      life: boss ? 0.6 : 0.45,
    });
  }

  // Cartoon white/mint smoke puffs
  const ns = lodCount(boss ? 16 : 7, true);
  for (let i = 0; i < ns; i++) {
    const a = (i / Math.max(1, ns)) * TWO_PI + rand(-0.25, 0.25);
    const sp = rand(1.4, boss ? 7.0 : 4.2);
    pushPart({
      kind: 'smoke',
      x: x + Math.cos(a) * r * 0.35,
      y: y + Math.sin(a) * r * 0.35,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + 0.9,
      grav: -1.6,
      drag: 2.8,
      size: rand(0.26, boss ? 0.72 : 0.46),
      color: i % 3 === 0 ? '#d6f7be' : '#f4f9f2',
      alpha0: 0.9,
      age: 0,
      life: rand(0.45, 0.85),
    });
  }

  // Spinning golden & lime 5-point stars
  const nStar = lodCount(boss ? 14 : 6, true);
  for (let i = 0; i < nStar; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(2.8, boss ? 10.5 : 6.8);
    pushPart({
      kind: 'star',
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + rand(1.2, 3.2),
      grav: 8.5,
      drag: 1.1,
      rot: rand(0, TWO_PI),
      vrot: rand(-10, 10),
      size: rand(0.15, boss ? 0.34 : 0.24),
      color: i % 2 === 0 ? '#ffe14a' : '#8bf542',
      stroke: '#2b3d08',
      age: 0,
      life: rand(0.55, 0.95),
    });
  }
}

function spawnFeathers(birdId, x, y, count = 9, speedScale = 1) {
  const [cMain, cAcc] = BIRD_COLORS[birdId] || BIRD_COLORS.red;
  const n = lodCount(count);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(1.8, 6.8) * speedScale;
    pushPart({
      kind: 'feather',
      x: x + rand(-0.2, 0.2),
      y: y + rand(-0.2, 0.2),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + rand(0.8, 2.6),
      grav: 3.4,
      drag: 2.9,
      rot: rand(0, TWO_PI),
      phase: rand(0, TWO_PI),
      size: rand(0.14, 0.25),
      color: i % 3 === 0 ? cAcc : cMain,
      age: 0,
      life: rand(0.75, 1.35),
    });
  }
}

function spawnDamageChips(p) {
  // Micro debris & sparks on non-lethal impacts >= 10 HP so grinding/lasers/tornadoes/slashes feel visceral
  if (!p || p.killed || !(p.amount >= 10)) return;
  const count = p.amount >= 120 ? 6 : 4;
  const n = lodCount(count);
  if (n <= 0) return;
  const mat = p.mat || 'wood';
  for (let i = 0; i < n; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(2.2, 7.5);
    if (mat === 'glass') {
      pushPart({
        kind: i === 0 ? 'sparkle' : 'shard',
        x: p.x + rand(-0.15, 0.15),
        y: p.y + rand(-0.15, 0.15),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp + 1.5,
        grav: i === 0 ? 0 : 11,
        drag: 0.8,
        rot: rand(0, TWO_PI),
        vrot: rand(-14, 14),
        size: rand(0.09, 0.17),
        color: '#b5eeff',
        stroke: '#4ba3cc',
        age: 0,
        life: rand(0.45, 0.8),
      });
    } else if (mat === 'stone') {
      pushPart({
        kind: i === 0 ? 'smoke' : 'spark',
        x: p.x + rand(-0.15, 0.15),
        y: p.y + rand(-0.15, 0.15),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp + 1.2,
        grav: i === 0 ? -1.0 : 12,
        drag: i === 0 ? 2.5 : 1.0,
        size: i === 0 ? rand(0.2, 0.34) : rand(0.1, 0.18),
        color: i === 0 ? '#a8a39d' : '#ffd875',
        alpha0: 0.55,
        age: 0,
        life: rand(0.4, 0.75),
      });
    } else if (mat === 'pig') {
      pushPart({
        kind: 'spark',
        x: p.x + rand(-0.15, 0.15),
        y: p.y + rand(-0.15, 0.15),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp + 1.5,
        grav: 10,
        drag: 1.0,
        size: rand(0.11, 0.2),
        color: i % 2 === 0 ? '#a8ff52' : '#ffe14a',
        age: 0,
        life: rand(0.4, 0.75),
      });
    } else {
      pushPart({
        kind: 'splinter',
        x: p.x + rand(-0.15, 0.15),
        y: p.y + rand(-0.15, 0.15),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp + 1.6,
        grav: 13,
        drag: 0.5,
        rot: rand(0, TWO_PI),
        vrot: rand(-14, 14),
        size: rand(0.1, 0.18),
        color: '#d48b38',
        stroke: '#63370f',
        age: 0,
        life: rand(0.45, 0.85),
      });
    }
  }
}

function spawnAbilityBurst(p) {
  const birdId = p.birdId || 'red';
  const x = p.x ?? 0;
  const y = p.y ?? 4;
  lastAbilityPos = { x, y, birdId };
  const [cMain, cAcc] = BIRD_COLORS[birdId] || BIRD_COLORS.red;

  spawnFeathers(birdId, x, y, 18, 1.35);

  if (lodCount(1, true) > 0) {
    pushPart({
      kind: 'ring',
      x, y, vx: 0, vy: 0, grav: 0, drag: 0,
      r0: 0.4, r1: 3.8,
      color: cAcc,
      age: 0, life: 0.48,
    });
  }

  const ns = lodCount(28);
  for (let i = 0; i < ns; i++) {
    const a = (i / Math.max(1, ns)) * TWO_PI + rand(-0.15, 0.15);
    const sp = rand(5.0, 16.0);
    pushPart({
      kind: i % 4 === 0 ? 'sparkle' : 'spark',
      x: x + Math.cos(a) * 0.25,
      y: y + Math.sin(a) * 0.25,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      grav: i % 4 === 0 ? 0 : 4.5,
      drag: 1.4,
      size: rand(0.14, 0.28),
      color: i % 2 === 0 ? cAcc : cMain,
      age: 0,
      life: rand(0.55, 1.05),
    });
  }
}

function spawnSfxAccent(p) {
  if (!p || !p.name) return;
  const x = p.x ?? lastAbilityPos.x;
  const y = p.y ?? lastAbilityPos.y;
  const [cMain, cAcc] = BIRD_COLORS[lastAbilityPos.birdId] || ['#ffe14a', '#ffffff'];
  const themed = ['laser', 'eagle', 'tornado', 'balloon', 'poison', 'slash', 'grow', 'meteor', 'jet', 'ring', 'egg'];
  if (!themed.includes(p.name)) return;
  const n = lodCount(8);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TWO_PI);
    const sp = rand(3.0, 11.0);
    pushPart({
      kind: p.name === 'poison' || p.name === 'balloon' ? 'smoke' : i % 3 === 0 ? 'sparkle' : 'spark',
      x: x + rand(-1.2, 1.2),
      y: y + rand(-0.8, 1.2),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + 1.0,
      grav: p.name === 'poison' ? -2.0 : 3.0,
      drag: 1.6,
      size: rand(0.14, 0.3),
      color: p.name === 'poison' || p.name === 'slash' ? '#df59ff' : i % 2 === 0 ? cAcc : cMain,
      alpha0: 0.75,
      age: 0,
      life: rand(0.5, 0.95),
    });
  }
}

export const particles = {
  init() {
    if (initialized) return;
    initialized = true;

    bus.on(EV.LEVEL_START, () => this.clear());

    bus.on(EV.BREAK, (p = {}) => {
      const m = p.mat || 'wood';
      if (m === 'glass') spawnGlassBreak(p.x, p.y, p.vx, p.vy);
      else if (m === 'stone') spawnStoneBreak(p.x, p.y, p.vx, p.vy);
      else if (m === 'tnt') spawnTntBreak(p.x, p.y, p.vx, p.vy);
      else spawnWoodBreak(p.x, p.y, p.vx, p.vy);
    });

    bus.on(EV.EXPLOSION, (p = {}) => {
      spawnExplosion(p.x ?? 0, p.y ?? 0, p.r ?? 2, p.power || 'normal');
    });

    bus.on(EV.PIG_POP, (p = {}) => {
      spawnPigPop(p.x ?? 0, p.y ?? 0, p.r ?? 0.45, !!p.boss);
    });

    bus.on(EV.BIRD_HIT, (p = {}) => {
      const n = Math.min(14, Math.max(7, Math.round((p.speed || 8) * 0.65)));
      spawnFeathers(p.birdId || 'red', p.x ?? 0, p.y ?? 0, n, Math.min(1.4, (p.speed || 8) / 12));
    });

    bus.on(EV.LAUNCH, (p = {}) => {
      spawnFeathers(p.birdId || 'red', p.x ?? 0, p.y ?? 2, 6, 0.7);
    });

    bus.on(EV.ABILITY, (p = {}) => {
      spawnAbilityBurst(p);
    });

    bus.on(EV.DAMAGE, spawnDamageChips);
    bus.on(EV.SFX, spawnSfxAccent);
  },

  update(dt) {
    if (!(dt > 0)) return;
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.age += dt;
      if (q.age >= q.life) {
        parts[i] = parts[parts.length - 1];
        parts.pop();
        continue;
      }
      if (q.drag) {
        const damp = Math.max(0, 1 - q.drag * dt);
        q.vx *= damp;
        q.vy *= damp;
      }
      if (q.grav) q.vy -= q.grav * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.vrot) q.rot += q.vrot * dt;
    }
  },

  draw(g, cam) {
    if (!g || !cam || !parts.length) return;
    const s = cam.s;
    const w = cam.w;
    const h = cam.h;

    // Pass 1: background smoke/dust puffs & shock rings
    for (let i = 0; i < parts.length; i++) {
      const q = parts[i];
      if (q.kind !== 'smoke' && q.kind !== 'ring') continue;
      const sx = cam.sx(q.x);
      const sy = cam.sy(q.y);
      if (sx < -90 || sx > w + 90 || sy < -90 || sy > h + 90) continue;
      const k = q.age / q.life;
      if (q.kind === 'smoke') {
        const rad = Math.max(1.5, q.size * s * (0.65 + 1.25 * k));
        g.globalAlpha = Math.max(0, (q.alpha0 ?? 0.8) * (1 - k * k));
        g.fillStyle = q.color;
        g.beginPath();
        g.arc(sx, sy, rad, 0, TWO_PI);
        g.fill();
      } else {
        const rad = Math.max(2, (q.r0 + (q.r1 - q.r0) * (1 - (1 - k) * (1 - k))) * s);
        g.globalAlpha = Math.max(0, 1 - k);
        g.strokeStyle = q.color;
        g.lineWidth = Math.max(2, (1 - k * 0.7) * 5.5);
        g.beginPath();
        g.arc(sx, sy, rad, 0, TWO_PI);
        g.stroke();
      }
    }

    // Pass 2: foreground shards, splinters, chunks, sparks, feathers, stars, sparkles
    for (let i = 0; i < parts.length; i++) {
      const q = parts[i];
      if (q.kind === 'smoke' || q.kind === 'ring') continue;
      const sx = cam.sx(q.x);
      const sy = cam.sy(q.y);
      if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) continue;
      const k = q.age / q.life;
      const alpha = k < 0.55 ? 1 : Math.max(0, (1 - k) / 0.45);
      if (alpha <= 0.01) continue;
      g.globalAlpha = alpha;

      if (q.kind === 'spark') {
        const px = Math.max(1.5, q.size * s * 0.42);
        const tailX = sx - q.vx * s * 0.032;
        const tailY = sy + q.vy * s * 0.032;
        g.strokeStyle = q.color;
        g.lineWidth = px;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(tailX, tailY);
        g.lineTo(sx, sy);
        g.stroke();
      } else if (q.kind === 'sparkle') {
        const arm = Math.max(2.5, q.size * s * (0.6 + 0.5 * Math.sin(k * Math.PI)));
        g.strokeStyle = q.color;
        g.lineWidth = Math.max(1.5, arm * 0.28);
        g.beginPath();
        g.moveTo(sx - arm, sy);
        g.lineTo(sx + arm, sy);
        g.moveTo(sx, sy - arm);
        g.lineTo(sx, sy + arm);
        g.stroke();
      } else if (q.kind === 'splinter') {
        const hw = Math.max(2, q.size * s * 1.05);
        const hh = Math.max(1.2, q.size * s * 0.3);
        g.save();
        g.translate(sx, sy);
        g.rotate(q.rot);
        g.fillStyle = q.color;
        g.strokeStyle = q.stroke;
        g.lineWidth = 1.2;
        g.fillRect(-hw, -hh, hw * 2, hh * 2);
        g.strokeRect(-hw, -hh, hw * 2, hh * 2);
        g.restore();
      } else if (q.kind === 'shard') {
        const rad = Math.max(2, q.size * s);
        g.save();
        g.translate(sx, sy);
        g.rotate(q.rot);
        g.fillStyle = q.color;
        g.strokeStyle = q.stroke;
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(0, -rad);
        g.lineTo(rad * 0.65, 0);
        g.lineTo(0, rad * 0.9);
        g.lineTo(-rad * 0.55, rad * 0.1);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      } else if (q.kind === 'chunk') {
        const rad = Math.max(2, q.size * s * 0.78);
        g.save();
        g.translate(sx, sy);
        g.rotate(q.rot);
        g.fillStyle = q.color;
        g.strokeStyle = q.stroke;
        g.lineWidth = 1.3;
        g.beginPath();
        g.moveTo(-rad, -rad * 0.6);
        g.lineTo(rad * 0.8, -rad * 0.9);
        g.lineTo(rad, rad * 0.5);
        g.lineTo(-rad * 0.3, rad);
        g.lineTo(-rad * 0.95, rad * 0.35);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      } else if (q.kind === 'feather') {
        const rad = Math.max(2.2, q.size * s);
        const ang = q.rot + Math.sin(q.age * 9.5 + q.phase) * 0.55;
        g.save();
        g.translate(sx, sy);
        g.rotate(ang);
        g.fillStyle = q.color;
        g.strokeStyle = '#1d1d1d';
        g.lineWidth = 1.0;
        g.beginPath();
        g.ellipse(0, 0, rad * 0.95, rad * 0.42, 0, 0, TWO_PI);
        g.fill();
        g.stroke();
        g.restore();
      } else if (q.kind === 'star') {
        const rad = Math.max(2.5, q.size * s);
        g.save();
        g.translate(sx, sy);
        g.rotate(q.rot);
        g.fillStyle = q.color;
        g.strokeStyle = q.stroke;
        g.lineWidth = 1.2;
        g.beginPath();
        for (let v = 0; v < 20; v += 2) {
          const vx = STAR_VERTS[v] * rad;
          const vy = STAR_VERTS[v + 1] * rad;
          if (v === 0) g.moveTo(vx, vy);
          else g.lineTo(vx, vy);
        }
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      }
    }

    g.globalAlpha = 1;
  },

  count() {
    return parts.length;
  },

  clear() {
    parts.length = 0;
  },
};
