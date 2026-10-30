// 泡泡橙「气球风暴」 (owner: birds-b).
// Spec: docs/DESIGN.md §3 row 8 — Bubbles inflates to r 2.0 for 1.5 s (radial push 25 + 100 dmg
// within 3.5 m) and releases 30 giant orange balloon-Bubbles (r 0.7–1.3) across actionRect top:
// they fall first (gravityScale 1.8 for 1.2 s, "先下") smashing everything (×3 dmg),
// then float up (gravityScale -1.2, "后上") and leave; balloons ignore each other.

import { CAT } from '../contracts.js';
import {
  clamp,
  holdTurn,
  resizeCircle,
  setGravityScale,
  getStructureBounds,
  resolveTarget,
  hash01,
  drawBirdIcon,
} from './b_helpers.js';

const BASE_R = 0.36;
const INFLATE_R = 2.0;
const BALLOON_COUNT = 30;
const FALL_TIME_S = 1.2;

function drawBubblesSprite(g, ent, t = 0) {
  const r = ent.r || BASE_R;
  const inflated = r >= 0.65 || !!(ent.data && ent.data.inflated);
  const squish = ent.data && ent.data.squishUntil > t ? 1 + 0.16 * Math.sin((ent.data.squishUntil - t) * 40) : 1;

  g.save();
  g.scale(squish, 2 - squish);

  // Stubby black tail feathers (smaller proportion when giant balloon)
  const fScale = inflated ? 0.52 : 1.0;
  g.fillStyle = '#1c1613';
  for (let i = -1; i <= 1; i += 2) {
    g.beginPath();
    g.moveTo(-r * 0.90, i * r * 0.08 * fScale);
    g.lineTo(-r * (0.90 + 0.34 * fScale), i * r * 0.24 * fScale);
    g.lineTo(-r * (0.90 + 0.26 * fScale), 0);
    g.closePath();
    g.fill();
  }

  // Top black-and-orange crest feather
  g.fillStyle = '#1c1613';
  g.beginPath();
  g.ellipse(-r * 0.05, -r * (0.98 + 0.20 * fScale), r * 0.11 * fScale + r * 0.04, r * 0.24 * fScale + r * 0.05, -0.25, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ff9f1c';
  g.beginPath();
  g.arc(-r * 0.08, -r * (1.02 + 0.22 * fScale), r * 0.07 * fScale + r * 0.02, 0, Math.PI * 2);
  g.fill();

  // Balloon knot at bottom when inflated into giant balloon
  if (inflated) {
    g.fillStyle = '#d96b08';
    g.strokeStyle = '#1a120b';
    g.lineWidth = r * 0.05;
    g.beginPath();
    g.moveTo(-r * 0.11, r * 0.96);
    g.lineTo(r * 0.11, r * 0.96);
    g.lineTo(r * 0.16, r * 1.10);
    g.lineTo(-r * 0.16, r * 1.10);
    g.closePath();
    g.fill();
    g.stroke();
  }

  // Main bright orange puffball / giant balloon body
  g.fillStyle = '#ff9419';
  g.strokeStyle = '#1a120b';
  g.lineWidth = inflated ? r * 0.065 : r * 0.11;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();

  g.save();
  g.beginPath();
  g.arc(0, 0, r * 0.97, 0, Math.PI * 2);
  g.clip();

  // Warm darker orange lower shading
  g.fillStyle = '#e06d06';
  g.beginPath();
  g.arc(-r * 0.10, r * 0.26, r * 0.98, 0, Math.PI * 2);
  g.fill();

  // Golden-cream belly patch
  g.fillStyle = '#ffd180';
  g.beginPath();
  g.ellipse(r * 0.10, r * 0.68, r * 0.58, r * 0.36, 0, 0, Math.PI * 2);
  g.fill();

  // Glossy curved balloon specular highlight (signature video look!)
  g.fillStyle = inflated ? 'rgba(255, 250, 220, 0.52)' : 'rgba(255, 240, 200, 0.34)';
  g.beginPath();
  g.ellipse(-r * 0.36, -r * 0.42, r * 0.32, r * 0.16, -0.62, 0, Math.PI * 2);
  g.fill();
  if (inflated) {
    g.beginPath();
    g.arc(-r * 0.55, -r * 0.14, r * 0.08, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // Crisp outer outline
  g.strokeStyle = '#1a120b';
  g.lineWidth = inflated ? r * 0.065 : r * 0.11;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();

  // Cute tiny angry face (stays small & hilarious in the center of the giant inflated balloon!)
  const fs = inflated ? 0.50 : 1.0;
  const fx = inflated ? r * 0.10 : r * 0.20;
  const fy = inflated ? -r * 0.02 : -r * 0.06;

  // White eyes
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#1a120b';
  g.lineWidth = r * 0.055 * fs;
  g.beginPath();
  g.arc(fx - r * 0.14 * fs, fy, r * 0.21 * fs, 0, Math.PI * 2);
  g.arc(fx + r * 0.26 * fs, fy, r * 0.19 * fs, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  // Pupils
  g.fillStyle = '#111111';
  g.beginPath();
  g.arc(fx - r * 0.09 * fs, fy, r * 0.085 * fs, 0, Math.PI * 2);
  g.arc(fx + r * 0.29 * fs, fy, r * 0.08 * fs, 0, Math.PI * 2);
  g.fill();

  // Big brown-black angry eyebrows
  g.fillStyle = '#2b1708';
  g.beginPath();
  g.moveTo(fx - r * 0.40 * fs, fy - r * 0.26 * fs);
  g.lineTo(fx + r * 0.06 * fs, fy - r * 0.10 * fs);
  g.lineTo(fx + r * 0.48 * fs, fy - r * 0.27 * fs);
  g.lineTo(fx + r * 0.42 * fs, fy - r * 0.39 * fs);
  g.lineTo(fx + r * 0.06 * fs, fy - r * 0.22 * fs);
  g.lineTo(fx - r * 0.34 * fs, fy - r * 0.39 * fs);
  g.closePath();
  g.fill();

  // Cute diamond orange-yellow beak + puffed cheek lines
  g.fillStyle = '#ffca28';
  g.strokeStyle = '#1a120b';
  g.lineWidth = r * 0.05 * fs;
  g.beginPath();
  g.moveTo(fx + r * 0.06 * fs, fy + r * 0.04 * fs);
  g.lineTo(fx + r * 0.56 * fs, fy + r * 0.17 * fs);
  g.lineTo(fx + r * 0.08 * fs, fy + r * 0.32 * fs);
  g.lineTo(fx - r * 0.10 * fs, fy + r * 0.18 * fs);
  g.closePath();
  g.fill();
  g.stroke();

  g.restore();
}

function spawnBalloon(ctx, x, y, vx, vy, r) {
  const spawnFn = typeof ctx.spawnClone === 'function'
    ? (opts) => ctx.spawnClone('bubbles', opts)
    : (opts) => ctx.spawnProjectile(opts);
  const b = spawnFn({
    x,
    y,
    vx,
    vy,
    r,
    skin: 'bubbles_balloon',
    density: 3.4,
    restitution: 0.56,
    friction: 0.25,
    gravityScale: 1.8, // Phase 1: "先下"
    dmgMul: 3.4,       // ×3 contact dmg (+13%)
    ttl: 2.9,
    owner: 'bubbles',
    // Balloons ignore each other and birds
    mask: 0xffff & ~CAT.PROJ & ~CAT.BIRD,
    onHit(ent, other) {
      // Allow repeated bouncy crush impacts both on the way down and on the way up!
      ent.data.hits = 0;
      if (!ent.alive) return;
      if (ctx.time < (ent.data.nextSmashT || 0)) return;
      ent.data.nextSmashT = ctx.time + 0.16;
      ent.data.squishUntil = ctx.time + 0.22;
      const bp = ctx.pos(ent);
      if (other && !other.isStatic) {
        ctx.damageCircle(bp.x, bp.y, ent.r * 1.45, {
          dmg: 88,
          impulse: 11,
          source: 'bubbles_balloon',
        });
      }
      ctx.addEffect({ type: 'bubbles_bounce', x: bp.x, y: bp.y, r: ent.r * 1.55, ttl: 0.28 });
      ctx.sfx('balloon_pop', { x: bp.x, y: bp.y, vol: 0.32, pitch: 0.9 + (1.3 - ent.r) * 0.4 });
    },
  });
  b.data.inflated = true;

  // Phase 2 after 1.2 s: "后上" — reverse gravity to -1.2..-1.4 and float skyward smashing overhangs!
  ctx.after(FALL_TIME_S, () => {
    if (!b.alive) return;
    setGravityScale(ctx, b, -1.35);
    const curV = ctx.vel(b);
    ctx.setVelocity(b, curV.x * 0.8 + ctx.range(-2.2, 2.2), Math.max(curV.y, 5.5));
    const bp = ctx.pos(b);
    ctx.addEffect({ type: 'bubbles_bounce', x: bp.x, y: bp.y, r: b.r * 1.35, up: true, ttl: 0.32 });
  });
  return b;
}

export default {
  id: 'bubbles',
  name: '泡泡橙',
  ability: '气球风暴',
  desc: '瞬间膨胀推开四周，并在全屏放出30个巨型橙色气球先砸下再升起',
  color: '#f39a1d',
  radius: BASE_R,
  density: 5,
  dmgMul: 1,

  onLaunch(_ctx, bird) {
    bird.data.inflated = false;
  },

  onTap(ctx, bird, target) {
    if (!bird || !bird.alive) return;
    holdTurn(ctx, 3.1);

    const p = ctx.pos(bird);
    const rect = ctx.actionRect();
    const sb = getStructureBounds(ctx);
    const aim = resolveTarget(ctx, bird, target);

    // 1. Inflate Bubbles himself to r = 2.0 m for 1.5 s + radial push 25..30 + 100..125 dmg within 3.5..4.4 m
    bird.data.inflated = true;
    bird.data.squishUntil = ctx.time + 0.35;
    bird.dmgMul = 3.2;
    resizeCircle(ctx, bird, INFLATE_R, { density: 3.5, restitution: 0.62 });
    ctx.damageCircle(p.x, p.y, 4.3, { dmg: 125, impulse: 30, source: 'bubbles_inflate' });
    ctx.addEffect({ type: 'bubbles_burst', x: p.x, y: p.y, r: 4.8, ttl: 0.55 });
    ctx.addEffect({
      type: 'bubbles_confetti',
      x0: rect.x0,
      x1: rect.x1,
      y0: 0,
      y1: rect.y1,
      seed: Math.round(p.x * 13 + 7),
      ttl: 2.8,
    });
    ctx.juice({ shake: 0.52, hitstop: 40 });
    ctx.sfx('balloon', { x: p.x, y: p.y });

    ctx.after(1.5, () => {
      if (!bird.alive) return;
      bird.data.inflated = false;
      bird.dmgMul = 1;
      resizeCircle(ctx, bird, BASE_R, { density: 5, restitution: 0.3 });
      const bp = ctx.pos(bird);
      ctx.addEffect({ type: 'bubbles_bounce', x: bp.x, y: bp.y, r: 2.2, ttl: 0.3 });
      ctx.sfx('poof', { x: bp.x, y: bp.y });
    });

    // 2. Release 30 giant orange balloon-Bubbles (r 0.75–1.30) across actionRect top
    // 20 concentrated across structure bounds + 10 spanning full actionRect for screen-wide spectacle
    const spanX0 = Math.min(rect.x0 + 1.5, sb.x0 - 4);
    const spanX1 = Math.max(rect.x1 - 1.5, sb.x1 + 4);
    const structX0 = sb.x0 - 2.2;
    const structX1 = sb.x1 + 2.2;
    const topBase = Math.max(sb.y1 + 2.5, 9.5);

    for (let i = 0; i < BALLOON_COUNT; i++) {
      const inStruct = i < 20;
      const u = inStruct ? (i + 0.5) / 20 : ((i - 20) + 0.5) / 10;
      const baseX = inStruct
        ? structX0 + u * Math.max(4, structX1 - structX0)
        : spanX0 + u * Math.max(8, spanX1 - spanX0);
      const bx = baseX + ctx.range(-0.9, 0.9);
      const highWave = i % 3 === 0;
      const by = topBase + (highWave ? ctx.range(4.5, 9.0) : ctx.range(-1.0, 4.2));
      const br = ctx.range(0.76, 1.30);
      const vx = clamp((aim.x - bx) * 0.16, -3.5, 3.5) + ctx.range(-1.4, 1.4);
      const vy = highWave ? ctx.range(-11.5, -7.5) : ctx.range(-15.5, -10.5);
      const delay = (i % 6) * 0.045; // first 5 spawn at t=0.00s, staggered sky-to-ground cascade!
      if (delay === 0) {
        spawnBalloon(ctx, bx, by, vx, vy, br);
      } else {
        ctx.after(delay, () => spawnBalloon(ctx, bx, by, vx, vy, br));
      }
    }
  },

  onStep() {},

  drawBird: drawBubblesSprite,

  icon(g, size) {
    drawBirdIcon(drawBubblesSprite, BASE_R, g, size, 0);
  },

  projSkins: {
    bubbles_balloon: drawBubblesSprite,
    'bird:bubbles': drawBubblesSprite,
  },

  effects: {
    bubbles_burst(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const sx = cam.sx(e.x);
      const sy = cam.sy(e.y);
      const rad = e.r * cam.s * (0.25 + 0.85 * (1 - (1 - k) * (1 - k)));

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (1 - k) * 0.7;
      g.fillStyle = k < 0.3 ? '#fff3b0' : '#ff9419';
      g.beginPath();
      g.arc(sx, sy, rad * 0.75, 0, Math.PI * 2);
      g.fill();

      g.strokeStyle = '#ffbe3d';
      g.lineWidth = Math.max(3, (1 - k) * 14);
      g.beginPath();
      g.arc(sx, sy, rad, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    },

    bubbles_bounce(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const sx = cam.sx(e.x);
      const sy = cam.sy(e.y);
      const rad = e.r * cam.s * (0.45 + 0.65 * k);
      g.save();
      g.globalAlpha = (1 - k) * 0.8;
      g.strokeStyle = e.up ? '#fff099' : '#ff9f1c';
      g.lineWidth = Math.max(2, (1 - k) * 7);
      g.beginPath();
      g.arc(sx, sy, rad, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    },

    bubbles_confetti(g, e, t, cam) {
      const age = t - e.t0;
      const k = clamp(age / e.ttl, 0, 1);
      const fade = k < 0.8 ? 1 : (1 - k) / 0.2;
      const colors = ['#ff9419', '#ff6b6b', '#ffd166', '#ffbe76', '#fff3b0'];

      g.save();
      g.globalAlpha = fade * 0.88;
      for (let i = 0; i < 64; i++) {
        const h1 = hash01(e.seed + i * 3.1);
        const h2 = hash01(e.seed + i * 7.7);
        const h3 = hash01(e.seed + i * 13.3);
        const wx = e.x0 + h1 * (e.x1 - e.x0) + Math.sin(age * 3.5 + i) * 1.1;
        // Fall down during first 1.2s, drift upward after 1.2s matching the balloons!
        const baseY = e.y0 + 1 + h2 * (e.y1 - e.y0 + 2);
        const dy = age < 1.2 ? -age * (4 + h3 * 4) : -1.2 * (4 + h3 * 4) + (age - 1.2) * (6 + h3 * 4);
        const wy = ((baseY + dy) % (e.y1 + 4) + (e.y1 + 4)) % (e.y1 + 4);
        const px = cam.sx(wx);
        const py = cam.sy(wy);
        if (px < -20 || px > cam.w + 20 || py < -20 || py > cam.h + 20) continue;
        g.fillStyle = colors[i % colors.length];
        g.save();
        g.translate(px, py);
        g.rotate(age * (3 + h3 * 5) + i);
        g.fillRect(-5, -3, 10, 6);
        g.restore();
      }
      g.restore();
    },
  },
};
