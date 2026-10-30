// 波比「旋风来袭」 (owner: birds-b).
// Spec: docs/DESIGN.md §3 row 10 — Poppy slams down (vy -25..-28); on landing (or 0.56..0.8 s)
// raises 14 tornadoes spread across actionRect, each 3.0 s: funnel r 1.6..1.85 m / height 7..8.4 m,
// wanders ±2 m and drifts to nearest pig at 1..1.25 m/s, pulls bodies within 3.2..3.8 m toward axis
// (force 25..30·m) + lift (1.4·m·g) + swirl; 25..30 dmg per 0.22..0.25 s inside. Yellow-white funnels.

import { KIND } from '../contracts.js';
import {
  clamp,
  getActionRect,
  holdTurn,
  findLocalTargets,
  groundTopAt,
  hash01,
  drawBirdIcon,
} from './b_helpers.js';

const BASE_R = 0.44;
const TORNADO_COUNT = 14;
const TORNADO_DUR = 3.0;
const FUNNEL_R = 1.85;    // 1.6 * 1.15 (within ±30%)
const FUNNEL_H = 9.0;     // 7.0 * 1.28 (within ±30%)
const PULL_R = 3.8;       // 3.2 * 1.19 (within ±30%)
const TICK_S = 0.25;      // exact 0.25 s per DESIGN.md §3
const TICK_DMG = 25;      // exact 25 dmg per DESIGN.md §3 (blocks swirl high before shattering!)

function drawPoppySprite(g, ent) {
  const r = ent.r || BASE_R;

  // Fluffy golden tail feathers
  g.fillStyle = '#e59500';
  g.strokeStyle = '#1f1505';
  g.lineWidth = r * 0.08;
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.ellipse(-r * 0.96, i * r * 0.16, r * 0.26, r * 0.11, i * 0.3, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  // Poppy's signature big fluffy yellow ponytail/tuft plumes on top of head!
  const plumes = [
    { x: -r * 0.28, y: -r * 1.18, rx: r * 0.22, ry: r * 0.42, rot: -0.58, c: '#f6b119' },
    { x: r * 0.02, y: -r * 1.30, rx: r * 0.24, ry: r * 0.48, rot: -0.18, c: '#ffe047' },
    { x: r * 0.28, y: -r * 1.14, rx: r * 0.19, ry: r * 0.36, rot: 0.28, c: '#ffd23f' },
  ];
  for (let i = 0; i < plumes.length; i++) {
    const pl = plumes[i];
    g.fillStyle = pl.c;
    g.strokeStyle = '#1f1505';
    g.lineWidth = r * 0.085;
    g.beginPath();
    g.ellipse(pl.x, pl.y, pl.rx, pl.ry, pl.rot, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  // Main fluffy canary-yellow round body
  g.fillStyle = '#ffd23f';
  g.strokeStyle = '#1f1505';
  g.lineWidth = r * 0.10;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();

  g.save();
  g.beginPath();
  g.arc(0, 0, r * 0.96, 0, Math.PI * 2);
  g.clip();

  // Warm amber lower shadow
  g.fillStyle = '#f2a516';
  g.beginPath();
  g.arc(-r * 0.16, r * 0.26, r * 0.96, 0, Math.PI * 2);
  g.fill();

  // Soft cream-white belly & fluffy cheeks
  g.fillStyle = '#fff7d6';
  g.beginPath();
  g.ellipse(r * 0.18, r * 0.62, r * 0.66, r * 0.46, 0, 0, Math.PI * 2);
  g.fill();

  // Rosy mischievous cheek blush
  g.fillStyle = 'rgba(255, 120, 90, 0.38)';
  g.beginPath();
  g.ellipse(-r * 0.04, r * 0.16, r * 0.16, r * 0.11, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Outer outline
  g.strokeStyle = '#1f1505';
  g.lineWidth = r * 0.10;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();

  // Expressive eyes + golden eyelids + lashes
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#1f1505';
  g.lineWidth = r * 0.055;
  g.beginPath();
  g.arc(r * 0.16, -r * 0.10, r * 0.22, 0, Math.PI * 2);
  g.arc(r * 0.52, -r * 0.09, r * 0.19, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  g.fillStyle = '#0f766e';
  g.beginPath();
  g.arc(r * 0.22, -r * 0.08, r * 0.11, 0, Math.PI * 2);
  g.arc(r * 0.56, -r * 0.07, r * 0.095, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = '#111111';
  g.beginPath();
  g.arc(r * 0.24, -r * 0.08, r * 0.06, 0, Math.PI * 2);
  g.arc(r * 0.57, -r * 0.07, r * 0.055, 0, Math.PI * 2);
  g.fill();

  // Lashes & cheeky arched brows
  g.strokeStyle = '#1f1505';
  g.lineWidth = r * 0.075;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-r * 0.10, -r * 0.28);
  g.lineTo(r * 0.34, -r * 0.18);
  g.lineTo(r * 0.72, -r * 0.30);
  g.stroke();

  // Curved orange-gold beak
  g.fillStyle = '#f59e0b';
  g.strokeStyle = '#1f1505';
  g.lineWidth = r * 0.055;
  g.beginPath();
  g.moveTo(r * 0.28, r * 0.04);
  g.lineTo(r * 0.96, r * 0.14);
  g.lineTo(r * 0.32, r * 0.28);
  g.closePath();
  g.fill();
  g.stroke();
}

function eruptTornadoes(ctx, bird) {
  if (bird.data.erupted) return;
  bird.data.erupted = true;

  const bp = bird.alive ? ctx.pos(bird) : (bird.data.lastPos || { x: 18, y: 1 });
  const tapPos = bird.data.tapPos || { x: bp.x, y: bp.y };
  ctx.damageCircle(bp.x, bp.y, 3.0, { dmg: 130, impulse: 18, source: 'poppy_slam' });
  ctx.addEffect({ type: 'shockwave', x: bp.x, y: bp.y, r: 3.8, color: '#ffe066', ttl: 0.42 });
  ctx.juice({ shake: 0.62, hitstop: 40 });
  ctx.sfx('tornado', { x: bp.x, y: bp.y });

  const rect = bird.data.tapRect || getActionRect(ctx);
  const xLo = rect.x0 + 1.2;
  const xHi = Math.max(xLo + 6, rect.x1 - 1.2);
  const localTargets = findLocalTargets(ctx, tapPos, {
    kinds: [KIND.PIG, KIND.BLOCK],
    max: 30,
    fallbackBlocks: true,
  }).filter((e) => {
    const ep = ctx.pos(e);
    return ep.x >= xLo && ep.x <= xHi;
  });

  const tornadoes = [];
  for (let i = 0; i < TORNADO_COUNT; i++) {
    // Spread all 14 tornadoes strictly across actionRect() (with local clustering inside actionRect)
    const u = (i + 0.5) / TORNADO_COUNT;
    let baseX = xLo + u * (xHi - xLo);
    if (localTargets.length > 0 && i % 2 === 0) {
      const lt = ctx.pos(localTargets[(i >> 1) % localTargets.length]);
      baseX = clamp(baseX * 0.45 + lt.x * 0.55, xLo, xHi);
    }
    const tx = clamp(baseX + ctx.range(-0.8, 0.8), xLo, xHi);
    const y0 = groundTopAt(ctx, tx, rect.y1);
    const phase = ctx.range(0, Math.PI * 2);
    const spinDir = i % 2 === 0 ? 1 : -1;
    const h = FUNNEL_H * ctx.range(0.92, 1.10);
    const r = FUNNEL_R * ctx.range(0.92, 1.10);

    const eff = ctx.addEffect({
      type: 'poppy_tornado',
      x: tx,
      y: y0,
      r,
      h,
      phase,
      spinDir,
      seed: i * 17 + 3,
      ttl: TORNADO_DUR,
    });

    tornadoes.push({
      anchorX: tx,
      x: tx,
      y0,
      r,
      h,
      phase,
      spinDir,
      eff,
    });
  }

  let nextTick = 0;
  let nextSfx = 0.45;

  ctx.addTask((dt, age) => {
    if (age >= TORNADO_DUR) return false;

    // Local pigs only (from tapPos via findTargets default reach, bounded to actionRect)
    const pigs = findLocalTargets(ctx, tapPos, {
      kinds: [KIND.PIG],
      max: 30,
      fallbackBlocks: false,
    }).filter((e) => {
      const ep = ctx.pos(e);
      return ep.x >= rect.x0 - 1.0 && ep.x <= rect.x1 + 1.0;
    });
    const doDmg = age >= nextTick;
    if (doDmg) nextTick += TICK_S;
    if (age >= nextSfx) {
      nextSfx += 0.55;
      ctx.sfx('tornado', { vol: 0.28, pitch: 0.95 + (age / TORNADO_DUR) * 0.2 });
    }

    // Track per-tick damaged ids so overlapping funnels deal juicy multi-hit without excessive spam
    const hitCounts = doDmg ? new Map() : null;

    for (let i = 0; i < tornadoes.length; i++) {
      const tor = tornadoes[i];
      // Drift anchor toward nearest local pig at 1.2 m/s + wander ±2.0 m (strictly within actionRect)
      if (pigs.length > 0) {
        let nearPig = pigs[0];
        let bestDx = Math.abs(ctx.pos(nearPig).x - tor.x);
        for (let pIdx = 1; pIdx < pigs.length; pIdx++) {
          const dx = Math.abs(ctx.pos(pigs[pIdx]).x - tor.x);
          if (dx < bestDx) {
            bestDx = dx;
            nearPig = pigs[pIdx];
          }
        }
        const px = ctx.pos(nearPig).x;
        if (Math.abs(px - tor.anchorX) > 0.2) {
          tor.anchorX = clamp(tor.anchorX + Math.sign(px - tor.anchorX) * 1.2 * dt, xLo, xHi);
        }
      }
      tor.x = clamp(tor.anchorX + Math.sin(age * 3.1 + tor.phase) * 2.0, rect.x0 + 0.5, rect.x1 - 0.5);
      tor.y0 = groundTopAt(ctx, tor.x, rect.y1);
      tor.eff.x = tor.x;
      tor.eff.y = tor.y0;

      // Query dynamic bodies locally around this tornado funnel
      const queryR = Math.hypot(PULL_R + 0.5, tor.h * 0.55 + 1.5);
      const ents = ctx.queryCircle(
        tor.x,
        tor.y0 + tor.h * 0.45,
        queryR,
        (e) => !e.isStatic && (e.kind === KIND.BLOCK || e.kind === KIND.PIG),
      );
      for (let j = 0; j < ents.length; j++) {
        const e = ents[j];
        if (!e.alive) continue;
        const p = ctx.pos(e);
        const dx = tor.x - p.x;
        if (Math.abs(dx) > PULL_R) continue;
        if (p.y < tor.y0 - 0.8 || p.y > tor.y0 + tor.h + 2.0) continue;

        const m = Math.max(0.15, e.body.getMass());
        const v = ctx.vel(e);
        const pullFactor = 1 - Math.abs(dx) / (PULL_R + 0.4);
        const fx = clamp(dx / 1.4, -1.35, 1.35) * 30 * m * (0.55 + 0.65 * pullFactor) - v.x * 2.3 * m;
        const hFrac = clamp((p.y - tor.y0) / tor.h, 0, 1.25);
        const fy = (1.65 - 0.85 * hFrac) * 10 * m - v.y * 0.45 * m;

        e.body.applyForceToCenter(new ctx.planck.Vec2(fx, fy), true);
        e.body.applyTorque(m * 8.5 * tor.spinDir, true);

        if (doDmg && Math.abs(dx) <= tor.r * 1.28 && p.y <= tor.y0 + tor.h + 1.2) {
          const prev = hitCounts.get(e.id) || 0;
          if (prev < 1) {
            hitCounts.set(e.id, 1);
            ctx.damage(e, TICK_DMG, { x: p.x, y: p.y, cause: 'poppy_tornado' });
          }
        }
      }
    }
    return true;
  });
}

export default {
  id: 'poppy',
  name: '波比',
  ability: '旋风来袭',
  desc: '急速下砸，落地升起14道巨型黄金龙卷风卷飞并撕碎全屏敌人',
  color: '#ffd23f',
  radius: BASE_R,
  density: 5,
  dmgMul: 1.2,

  onLaunch(_ctx, bird) {
    bird.data.diving = false;
    bird.data.erupted = false;
  },

  onTap(ctx, bird) {
    if (!bird || !bird.alive) return;
    holdTurn(ctx, TORNADO_DUR + 0.8);

    const p = ctx.pos(bird);
    const v = ctx.vel(bird);
    bird.data.diving = true;
    bird.data.tapPos = { x: p.x, y: p.y };
    bird.data.tapRect = getActionRect(ctx);
    bird.data.lastPos = { x: p.x, y: p.y };
    bird.dmgMul = 2.6;

    // Slam straight down at vy = -28 (within ±30% of -25) + immediate golden corkscrew VFX (< 16 ms)
    ctx.setVelocity(bird, v.x * 0.22, -28);
    ctx.addEffect({ type: 'poppy_dive', bird, x: p.x, y: p.y, ttl: 0.65 });
    ctx.addEffect({ type: 'shockwave', x: p.x, y: p.y, r: 2.8, color: '#ffe047', ttl: 0.32 });
    ctx.sfx('whoosh', { x: p.x, y: p.y, pitch: 1.35 });

    // Fallback eruption at 0.56 s (within ±30% of 0.8 s) if launched very high
    ctx.after(0.56, () => {
      eruptTornadoes(ctx, bird);
    });
  },

  onStep(ctx, bird) {
    if (!bird || !bird.alive || !bird.data.diving || bird.data.erupted) return;
    const p = ctx.pos(bird);
    const v = ctx.vel(bird);
    bird.data.lastPos = { x: p.x, y: p.y };

    const gTop = groundTopAt(ctx, p.x, p.y + 1.5);
    const touched = p.y - bird.r <= gTop + 0.28 ||
      Math.abs(v.y) < 16 ||
      ctx.queryCircle(
        p.x,
        p.y,
        bird.r + 0.32,
        (e) => e.id !== bird.id && (e.isStatic || e.kind === KIND.BLOCK || e.kind === KIND.PIG),
      ).length > 0;

    if (touched) {
      eruptTornadoes(ctx, bird);
    }
  },

  drawBird: drawPoppySprite,

  icon(g, size) {
    drawBirdIcon(drawPoppySprite, BASE_R, g, size, 0);
  },

  projSkins: {
    'bird:poppy': drawPoppySprite,
  },

  effects: {
    poppy_dive(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      if (e.bird && e.bird.alive) {
        const bp = e.bird.body.getPosition();
        e.x = bp.x;
        e.y = bp.y;
      }
      const sx = cam.sx(e.x);
      const sy = cam.sy(e.y);
      const s = cam.s;

      g.save();
      g.globalAlpha = (1 - k) * 0.9;
      for (let i = 0; i < 6; i++) {
        const u = i / 5;
        const ry = sy - u * 2.4 * s;
        const rx = (0.35 + u * 0.9) * s;
        g.strokeStyle = i % 2 === 0 ? '#ffe047' : '#ffffff';
        g.lineWidth = 4.5 - u * 2;
        g.beginPath();
        g.ellipse(sx + Math.sin(t * 28 + i) * 4, ry, rx, rx * 0.32, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    },

    // Iconic stacked yellow-white cartoon swirling funnels (exact tornado.jpg look!)
    poppy_tornado(g, e, t, cam) {
      const age = t - e.t0;
      const k = clamp(age / e.ttl, 0, 1);
      const grow = Math.min(1, age / 0.18);
      const fade = k > 0.84 ? (1 - k) / 0.16 : 1;
      const baseX = cam.sx(e.x);
      const baseY = cam.sy(e.y);
      const hPx = e.h * cam.s * grow;
      const rPx = e.r * cam.s * (0.35 + 0.65 * grow);

      if (baseX + rPx * 2 < 0 || baseX - rPx * 2 > cam.w) return;

      g.save();
      g.globalAlpha = fade * 0.94;

      const rings = 15;
      for (let i = 0; i < rings; i++) {
        const u = i / (rings - 1); // 0 at ground -> 1 at top
        const cy = baseY - u * hPx;
        const sway = Math.sin(t * 13 * e.spinDir + u * 5.2 + e.phase) * rPx * (0.08 + 0.18 * u);
        const cx = baseX + sway;
        const rx = rPx * (0.36 + 0.96 * Math.pow(u, 0.78));
        const ry = Math.max(4, rx * 0.28);
        const tilt = Math.sin(t * 10 + i * 0.7 + e.phase) * 0.12;

        // Cartoon dark-amber outer rim + bright yellow/cream alternating vortex bands
        g.fillStyle = i % 3 === 0 ? '#fffbe0' : i % 2 === 0 ? '#ffe14d' : '#ffca28';
        g.strokeStyle = '#6b4708';
        g.lineWidth = Math.max(1.8, cam.s * 0.055);
        g.beginPath();
        g.ellipse(cx, cy, rx, ry, tilt, 0, Math.PI * 2);
        g.fill();
        g.stroke();

        // Inner white wind highlight arc spinning rapidly
        const arcStart = (t * 16 * e.spinDir + i * 1.1) % (Math.PI * 2);
        g.strokeStyle = '#ffffff';
        g.lineWidth = Math.max(1.5, ry * 0.28);
        g.beginPath();
        g.ellipse(cx, cy, rx * 0.78, ry * 0.68, tilt, arcStart, arcStart + Math.PI * 0.85);
        g.stroke();
      }

      // Base dust & orbiting wind flecks
      for (let j = 0; j < 8; j++) {
        const u = ((age * 1.7 + hash01(e.seed + j * 3)) % 1);
        const ang = age * 12 * e.spinDir + j * 1.6;
        const rx = rPx * (0.5 + 1.05 * u);
        const px = baseX + Math.cos(ang) * rx;
        const py = baseY - u * hPx + Math.sin(ang) * rx * 0.2;
        g.fillStyle = j % 2 === 0 ? '#fff9c4' : '#f59e0b';
        g.fillRect(px - 3, py - 3, 6, 6);
      }

      g.restore();
    },
  },
};
