// 盖雅「剧毒斩」 (owner: birds-b).
// Spec: docs/DESIGN.md §3 row 12 — poison nova r 6..7.8 m: every block/pig inside poisoned 6 s at
// 30..38 HP/s (ent.status.poison, magenta tint); each poisoned object that dies releases a mini
// purple slash (6..6.6 m ray, 60..70 dmg) at a random nearby target. 0.34..0.4 s later 6 purple
// lightning slashes cross actionRect through targets (pigs first): 140..165 dmg + impulse per body
// (damageRay), zig-zag lightning visuals + purple flash 0.25.

import { KIND } from '../contracts.js';
import {
  clamp,
  holdTurn,
  setGravityScale,
  dynamicTargets,
  resolveTarget,
  hash01,
  drawBirdIcon,
} from './b_helpers.js';

const BASE_R = 0.44;
const NOVA_R = 7.8;       // 6.0 * 1.30 (within ±30%)
const POISON_DUR = 6.0;
const POISON_DPS = 38;    // 30 * 1.27 (within ±30%)
const SLASH_DELAY = 0.34; // 0.40 * 0.85 (within ±30%)
const SLASH_COUNT = 6;
const SLASH_DMG = 165;    // 140 * 1.18 (within ±30%)
const MINI_RAY_LEN = 6.6; // 6.0 * 1.10 (within ±30%)
const MINI_DMG = 72;      // 60 * 1.20 (within ±30%)

function drawGaleSprite(g, ent) {
  const r = ent.r || BASE_R;

  // Dramatic swept-out royal-purple wing/ear plumes (signature silhouette in gale.jpg & tele.jpg!)
  g.fillStyle = '#5b2182';
  g.strokeStyle = '#1b0929';
  g.lineWidth = r * 0.085;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(side * r * 0.45, -r * 0.15);
    g.quadraticCurveTo(side * r * 1.48, -r * 0.62, side * r * 1.62, -r * 0.08);
    g.quadraticCurveTo(side * r * 1.18, r * 0.28, side * r * 0.62, r * 0.22);
    g.closePath();
    g.fill();
    g.stroke();
  }

  // Regal plum tail feathers
  g.fillStyle = '#3b0764';
  g.beginPath();
  g.moveTo(-r * 0.85, -r * 0.15);
  g.lineTo(-r * 1.35, -r * 0.32);
  g.lineTo(-r * 1.22, 0);
  g.lineTo(-r * 1.35, r * 0.26);
  g.lineTo(-r * 0.85, r * 0.15);
  g.closePath();
  g.fill();

  // Main royal-purple body
  g.fillStyle = '#7e3fa8';
  g.strokeStyle = '#1b0929';
  g.lineWidth = r * 0.10;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();

  g.save();
  g.beginPath();
  g.arc(0, 0, r * 0.96, 0, Math.PI * 2);
  g.clip();

  // Deep violet shadow
  g.fillStyle = '#581c87';
  g.beginPath();
  g.arc(-r * 0.18, r * 0.26, r * 0.96, 0, Math.PI * 2);
  g.fill();

  // Soft lavender chest patch
  g.fillStyle = '#e9d5ff';
  g.beginPath();
  g.ellipse(r * 0.16, r * 0.66, r * 0.60, r * 0.42, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Outer outline
  g.strokeStyle = '#1b0929';
  g.lineWidth = r * 0.10;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();

  // Gleaming 5-point GOLD CROWN with crimson ruby gem on top!
  g.fillStyle = '#facc15';
  g.strokeStyle = '#1b0929';
  g.lineWidth = r * 0.075;
  g.beginPath();
  g.moveTo(-r * 0.46, -r * 0.86);
  g.lineTo(-r * 0.54, -r * 1.36);
  g.lineTo(-r * 0.22, -r * 1.08);
  g.lineTo(0, -r * 1.50);
  g.lineTo(r * 0.22, -r * 1.08);
  g.lineTo(r * 0.54, -r * 1.36);
  g.lineTo(r * 0.46, -r * 0.86);
  g.closePath();
  g.fill();
  g.stroke();

  // Crown ruby center gem
  g.fillStyle = '#f43f5e';
  g.beginPath();
  g.arc(0, -r * 1.05, r * 0.11, 0, Math.PI * 2);
  g.fill();

  // Fierce eyes with violet eyeshadow lids
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#1b0929';
  g.lineWidth = r * 0.055;
  g.beginPath();
  g.arc(r * 0.14, -r * 0.10, r * 0.21, 0, Math.PI * 2);
  g.arc(r * 0.50, -r * 0.09, r * 0.19, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  // Violet lids
  g.fillStyle = '#9333ea';
  g.beginPath();
  g.arc(r * 0.14, -r * 0.10, r * 0.21, Math.PI * 1.02, Math.PI * 1.98);
  g.fill();
  g.beginPath();
  g.arc(r * 0.50, -r * 0.09, r * 0.19, Math.PI * 1.02, Math.PI * 1.98);
  g.fill();

  g.fillStyle = '#2e1065';
  g.beginPath();
  g.arc(r * 0.20, -r * 0.06, r * 0.085, 0, Math.PI * 2);
  g.arc(r * 0.54, -r * 0.05, r * 0.075, 0, Math.PI * 2);
  g.fill();

  // Sharp aristocratic brows
  g.strokeStyle = '#1b0929';
  g.lineWidth = r * 0.085;
  g.beginPath();
  g.moveTo(-r * 0.14, -r * 0.30);
  g.lineTo(r * 0.32, -r * 0.17);
  g.lineTo(r * 0.72, -r * 0.34);
  g.stroke();

  // Sharp curved golden beak
  g.fillStyle = '#f59e0b';
  g.strokeStyle = '#1b0929';
  g.lineWidth = r * 0.055;
  g.beginPath();
  g.moveTo(r * 0.26, r * 0.05);
  g.lineTo(r * 0.96, r * 0.15);
  g.lineTo(r * 0.30, r * 0.27);
  g.closePath();
  g.fill();
  g.stroke();
}

/**
 * Execute ctx.damageRay along centerline AND ensure a generous blade width (`halfW`) so fast
 * diagonal lightning slashes hit blocks & pigs cleanly without missing by a hair.
 */
function slashSegment(ctx, x1, y1, x2, y2, { dmg, impulse, halfW = 0.55, source = 'gale_slash' }) {
  const hitSet = new Set();
  const rayHits = ctx.damageRay(x1, y1, x2, y2, { dmg, impulse, width: halfW * 2, source });
  if (Array.isArray(rayHits)) {
    for (let i = 0; i < rayHits.length; i++) {
      if (rayHits[i]) hitSet.add(rayHits[i].id);
    }
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const len = Math.sqrt(len2);
  const ux = dx / len;
  const uy = dy / len;

  const ents = dynamicTargets(ctx);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (hitSet.has(e.id)) continue;
    const p = ctx.pos(e);
    const tProj = clamp(((p.x - x1) * dx + (p.y - y1) * dy) / len2, 0, 1);
    const cx = x1 + tProj * dx;
    const cy = y1 + tProj * dy;
    const er = e.r || Math.max(e.w || 0.3, e.h || 0.3) * 0.45;
    if (Math.hypot(p.x - cx, p.y - cy) <= halfW + er) {
      hitSet.add(e.id);
      ctx.damage(e, dmg, { x: p.x, y: p.y, cause: source });
      if (e.alive) ctx.applyImpulse(e, ux * impulse, uy * impulse + 2);
    }
  }
}

function drawZigZagBolt(g, x1, y1, x2, y2, segs, jitterPx, seed, t) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  g.beginPath();
  g.moveTo(x1, y1);
  for (let i = 1; i < segs; i++) {
    const u = i / segs;
    const env = Math.sin(u * Math.PI);
    const off = (hash01(seed + i * 19.7 + Math.floor(t * 24) * 3.1) * 2 - 1) * jitterPx * env;
    g.lineTo(x1 + dx * u + nx * off, y1 + dy * u + ny * off);
  }
  g.lineTo(x2, y2);
  g.stroke();
}

export default {
  id: 'gale',
  name: '盖雅',
  ability: '剧毒斩',
  desc: '剧毒新星使周围物体持续掉血且死亡溅射毒斩，随后6道紫色闪电斩横贯全屏',
  color: '#7a3fa0',
  radius: BASE_R,
  density: 5,
  dmgMul: 1.2,

  onLaunch() {},

  onTap(ctx, bird, target) {
    if (!bird || !bird.alive) return;
    holdTurn(ctx, 3.2);

    const bp = ctx.pos(bird);
    const aim = resolveTarget(ctx, bird, target);

    // 1. Poison Nova (r = 7.8 m around Gale + target fortress cluster if tapped mid-air)
    const all = dynamicTargets(ctx);
    const poisoned = [];
    const seen = new Set();

    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      const p = ctx.pos(e);
      const nearBird = Math.hypot(p.x - bp.x, p.y - bp.y) <= NOVA_R;
      const nearAim = Math.hypot(p.x - aim.x, p.y - aim.y) <= NOVA_R;
      if (!nearBird && !nearAim) continue;
      seen.add(e.id);
      e.status.poison = { dps: POISON_DPS, until: ctx.time + POISON_DUR };
      e.status.tint = '#d946ef';
      e.data._galeLastPos = { x: p.x, y: p.y };
      e.data._galeDeathSlashed = false;
      poisoned.push(e);

      // Immediate toxic burst so damage popups & glass cracks appear at t = 0
      ctx.damage(e, 32, { x: p.x, y: p.y, cause: 'gale_nova' });
      if (e.alive) {
        const cx = nearBird ? bp.x : aim.x;
        const cy = nearBird ? bp.y : aim.y;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.max(0.3, Math.hypot(dx, dy));
        ctx.applyImpulse(e, (dx / d) * 4.5, (dy / d) * 4.5 + 2);
      }
    }

    // Immediate VFX (< 16 ms): expanding magenta poison nova + live toxic aura on poisoned bodies!
    ctx.addEffect({ type: 'gale_nova', x: bp.x, y: bp.y, r: NOVA_R, ttl: 0.65 });
    if (Math.hypot(aim.x - bp.x, aim.y - bp.y) > 3.2) {
      ctx.addEffect({ type: 'gale_nova', x: aim.x, y: aim.y, r: NOVA_R, ttl: 0.65 });
    }
    ctx.addEffect({
      type: 'gale_poison_aura',
      ents: poisoned,
      ttl: POISON_DUR,
    });
    ctx.sfx('poison', { x: bp.x, y: bp.y });
    ctx.juice({ shake: 0.36, flash: { alpha: 0.16, color: '#d946ef' } });

    // Brief hover before Gale's lightning-slash blitz
    setGravityScale(ctx, bird, 0.15);
    const bv = ctx.vel(bird);
    ctx.setVelocity(bird, bv.x * 0.25, Math.max(1.0, bv.y * 0.2));

    // 2. Death-chain listener: every poisoned object that dies releases a 6.6 m mini purple slash!
    ctx.addTask((_dt, age) => {
      let anyAlivePoisoned = false;
      for (let i = 0; i < poisoned.length; i++) {
        const e = poisoned[i];
        if (e.alive) {
          const p = ctx.pos(e);
          e.data._galeLastPos = { x: p.x, y: p.y };
          if (e.status && e.status.poison) anyAlivePoisoned = true;
        } else if (!e.data._galeDeathSlashed) {
          e.data._galeDeathSlashed = true;
          const lp = e.data._galeLastPos || { x: aim.x, y: aim.y };
          const nearby = dynamicTargets(
            ctx,
            (o) => {
              const op = ctx.pos(o);
              const d = Math.hypot(op.x - lp.x, op.y - lp.y);
              return d > 0.2 && d <= 8.5;
            },
          );
          let ang;
          if (nearby.length > 0) {
            const pick = nearby[Math.floor(ctx.rng() * nearby.length) % nearby.length];
            const tp = ctx.pos(pick);
            ang = Math.atan2(tp.y - lp.y, tp.x - lp.x);
          } else {
            ang = ctx.rng() * Math.PI * 2;
          }
          const x1 = lp.x - Math.cos(ang) * (MINI_RAY_LEN * 0.35);
          const y1 = lp.y - Math.sin(ang) * (MINI_RAY_LEN * 0.35);
          const x2 = lp.x + Math.cos(ang) * (MINI_RAY_LEN * 0.65);
          const y2 = lp.y + Math.sin(ang) * (MINI_RAY_LEN * 0.65);
          slashSegment(ctx, x1, y1, x2, y2, {
            dmg: MINI_DMG,
            impulse: 8,
            halfW: 0.42,
            source: 'gale_death_slash',
          });
          ctx.addEffect({
            type: 'gale_slash',
            x: lp.x,
            y: lp.y,
            r: 2.5,
            sx1: x1,
            sy1: y1,
            sx2: x2,
            sy2: y2,
            mini: true,
            seed: e.id * 13 + 5,
            ttl: 0.48,
          });
          ctx.sfx('slash', { x: lp.x, y: lp.y, vol: 0.35, pitch: 1.35 });
        }
      }
      return anyAlivePoisoned && age < POISON_DUR + 0.3;
    });

    // 3. 0.34 s later: 6 full-screen purple lightning slashes crisscrossing actionRect through targets!
    for (let s = 0; s < SLASH_COUNT; s++) {
      ctx.after(SLASH_DELAY + s * 0.055, () => {
        const rect = ctx.actionRect();
        const span = Math.hypot(rect.x1 - rect.x0 + 16, rect.y1 + 10);
        const liveAll = dynamicTargets(ctx);
        const pigs = liveAll.filter((e) => e.kind === KIND.PIG);
        const ordered = [...pigs, ...liveAll.filter((e) => e.kind === KIND.BLOCK)];

        let tx = aim.x;
        let ty = aim.y;
        if (ordered.length > 0) {
          const tgt = ordered[s % ordered.length];
          const tp = ctx.pos(tgt);
          tx = tp.x;
          ty = tp.y;
        } else {
          tx = rect.x0 + ((s + 1) / (SLASH_COUNT + 1)) * (rect.x1 - rect.x0);
          ty = 2.5 + (s % 3) * 2.0;
        }

        // Crisscross dramatic diagonal angles spanning the ENTIRE screen
        const baseAngles = [-0.42, -2.68, 0.36, 2.74, -0.72, -2.42];
        const ang = baseAngles[s % baseAngles.length] + ctx.range(-0.08, 0.08);
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        const x1 = tx - ux * span * 0.55;
        const y1 = ty - uy * span * 0.55;
        const x2 = tx + ux * span * 0.55;
        const y2 = ty + uy * span * 0.55;

        slashSegment(ctx, x1, y1, x2, y2, {
          dmg: SLASH_DMG,
          impulse: 16,
          halfW: 0.58,
          source: 'gale_slash',
        });

        ctx.addEffect({
          type: 'gale_slash',
          x: tx,
          y: ty,
          r: 4.5,
          sx1: x1,
          sy1: y1,
          sx2: x2,
          sy2: y2,
          mini: false,
          seed: (s + 1) * 37,
          ttl: 0.72,
        });

        // Gale dashes rapidly through the target along the slash!
        if (bird.alive) {
          bird.body.setTransform(new ctx.planck.Vec2(tx + ux * 2.2, Math.max(1.2, ty + uy * 2.2)), ang);
          ctx.setVelocity(bird, ux * 10, uy * 6);
          if (s === SLASH_COUNT - 1) setGravityScale(ctx, bird, 1);
        }

        ctx.sfx('slash', { x: tx, y: ty, pitch: 0.92 + s * 0.08 });
        if (s === 0 || s === SLASH_COUNT - 1) {
          // Purple flash 0.25 per DESIGN.md §3 row 12!
          ctx.juice({
            flash: { alpha: 0.25, color: '#a855f7' },
            shake: 0.76,
            hitstop: s === 0 ? 55 : 35,
          });
        } else {
          ctx.juice({ shake: 0.28 });
        }
      });
    }
  },

  onStep() {},

  drawBird: drawGaleSprite,

  icon(g, size) {
    drawBirdIcon(drawGaleSprite, BASE_R, g, size, 0);
  },

  projSkins: {
    'bird:gale': drawGaleSprite,
  },

  effects: {
    gale_nova(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const ease = 1 - (1 - k) * (1 - k);
      const sx = cam.sx(e.x);
      const sy = cam.sy(e.y);
      const rad = e.r * cam.s * (0.18 + 0.85 * ease);

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (1 - k) * 0.48;
      const grad = g.createRadialGradient(sx, sy, rad * 0.1, sx, sy, rad);
      grad.addColorStop(0, 'rgba(255, 210, 255, 0.7)');
      grad.addColorStop(0.65, 'rgba(217, 70, 239, 0.55)');
      grad.addColorStop(1, 'rgba(126, 34, 206, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(sx, sy, rad, 0, Math.PI * 2);
      g.fill();

      g.globalAlpha = (1 - k) * 0.9;
      g.strokeStyle = '#f0abfc';
      g.lineWidth = Math.max(2.5, (1 - k) * 11);
      g.beginPath();
      g.arc(sx, sy, rad * 0.92, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    },

    gale_poison_aura(g, e, t, cam) {
      g.save();
      for (let i = 0; i < e.ents.length; i++) {
        const ent = e.ents[i];
        if (!ent || !ent.alive || !ent.status || !ent.status.poison) continue;
        const p = ent.body.getPosition();
        const sx = cam.sx(p.x);
        const sy = cam.sy(p.y);
        if (sx < -60 || sx > cam.w + 60 || sy < -60 || sy > cam.h + 60) continue;

        const wPx = (ent.w || (ent.r || 0.4) * 2) * cam.s;
        const hPx = (ent.h || (ent.r || 0.4) * 2) * cam.s;

        // Magenta toxic glow overlay (matches bright pink/magenta blocks in gale.jpg & tele.jpg!)
        g.globalAlpha = 0.34 + 0.10 * Math.sin(t * 10 + i);
        g.fillStyle = '#e838f5';
        if (ent.shape === 'circle') {
          g.beginPath();
          g.arc(sx, sy, wPx * 0.56, 0, Math.PI * 2);
          g.fill();
        } else {
          g.save();
          g.translate(sx, sy);
          g.rotate(-ent.body.getAngle());
          g.fillRect(-wPx * 0.54, -hPx * 0.54, wPx * 1.08, hPx * 1.08);
          g.restore();
        }

        // Rising toxic bubbles
        g.globalAlpha = 0.82;
        for (let b = 0; b < 2; b++) {
          const u = ((t * 1.6 + hash01(ent.id * 5 + b * 11)) % 1);
          const bx = sx + (hash01(ent.id * 9 + b) - 0.5) * wPx;
          const by = sy - u * 26;
          g.fillStyle = b === 0 ? '#f5d0fe' : '#d946ef';
          g.beginPath();
          g.arc(bx, by, (1 - u * 0.5) * 4.2, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
    },

    // Full-screen electric purple zig-zag lightning slash + Gale phantom afterimages!
    gale_slash(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const x1 = cam.sx(e.sx1);
      const y1 = cam.sy(e.sy1);
      const x2 = cam.sx(e.sx2);
      const y2 = cam.sy(e.sy2);
      const fade = 1 - k * k;

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      g.lineJoin = 'bevel';

      if (e.mini) {
        g.globalAlpha = fade * 0.85;
        g.strokeStyle = '#c026d3';
        g.lineWidth = 9 * fade;
        drawZigZagBolt(g, x1, y1, x2, y2, 9, 14, e.seed, t);

        g.strokeStyle = '#ffffff';
        g.lineWidth = 3 * fade;
        drawZigZagBolt(g, x1, y1, x2, y2, 9, 10, e.seed, t);
        g.restore();
        return;
      }

      // 1. Wide royal-violet outer sword-beam glow
      g.globalAlpha = fade * 0.55;
      g.strokeStyle = '#9333ea';
      g.lineWidth = 26 * fade;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();

      // 2. Twin jagged magenta-electric zig-zag lightning bolts
      g.globalAlpha = fade * 0.92;
      g.strokeStyle = '#e879f9';
      g.lineWidth = 10 * fade;
      drawZigZagBolt(g, x1, y1, x2, y2, 18, 28, e.seed, t);

      g.strokeStyle = '#c084fc';
      g.lineWidth = 6 * fade;
      drawZigZagBolt(g, x1, y1, x2, y2, 16, 42, e.seed + 99, t);

      // 3. Blazing white razor core + lightning core
      g.globalAlpha = fade;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 4.2 * fade;
      drawZigZagBolt(g, x1, y1, x2, y2, 18, 16, e.seed, t);

      // 4. Dashing Gale crown-bird phantom silhouettes along the slash (gale.jpg frame 7!)
      g.globalCompositeOperation = 'source-over';
      const ang = Math.atan2(y2 - y1, x2 - x1);
      for (let p = 0; p < 3; p++) {
        const u = clamp(0.28 + p * 0.20 + k * 0.16, 0.1, 0.9);
        const px = x1 + (x2 - x1) * u;
        const py = y1 + (y2 - y1) * u;
        if (px < -40 || px > cam.w + 40 || py < -40 || py > cam.h + 40) continue;
        g.save();
        g.globalAlpha = fade * (0.55 + p * 0.15);
        g.translate(px, py);
        g.rotate(ang);
        g.scale(cam.s, cam.s);
        drawGaleSprite(g, { r: BASE_R * 0.92, data: {}, status: {} });
        g.restore();
      }

      g.restore();
    },
  },
};
