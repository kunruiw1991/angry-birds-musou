// 大红「巨大化」 (owner: birds-b).
// Spec: docs/DESIGN.md §3 row 7 — grow radius ×4 (0.62 -> 2.48 m) over 0.25 s (5 fixture swaps),
// same density (mass ×16, velocity preserved), ×5+ contact dmg (red 1000+ numbers),
// first ground hit = shockwave r 4..5.2 / 250..325 dmg / impulse 30..39 + big shake.

import { KIND } from '../contracts.js';
import {
  clamp,
  holdTurn,
  resizeCircle,
  resolveTarget,
  groundTopAt,
  hash01,
  drawBirdIcon,
} from './b_helpers.js';

const BASE_R = 0.62;
const GIANT_R = 2.48; // exact ×4.0 radius -> ×16.0 mass at constant density
const GROW_STEPS = 5;
const GROW_DUR = 0.25;

function drawTerenceSprite(g, ent, t = 0) {
  const r = ent.r || BASE_R;
  const giant = !!(ent.data && ent.data.giant);

  // Rage aura ring when giant
  if (giant) {
    const pulse = 1.06 + 0.05 * Math.sin((t || 0) * 18);
    g.save();
    g.globalAlpha = 0.32;
    g.fillStyle = '#ff2a1a';
    g.beginPath();
    g.arc(0, 0, r * pulse, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffcf40';
    g.lineWidth = r * 0.06;
    g.stroke();
    g.restore();
  }

  // Tail feathers (left side -x)
  g.fillStyle = '#1b1414';
  for (let i = -1; i <= 1; i++) {
    g.save();
    g.translate(-r * 0.92, r * 0.05 + i * r * 0.16);
    g.rotate(i * 0.28 - 0.1);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-r * 0.34, -r * 0.09);
    g.lineTo(-r * 0.30, r * 0.10);
    g.closePath();
    g.fill();
    g.restore();
  }

  // Top head crest feathers (2 thick dark crimson plumes)
  g.fillStyle = '#990d14';
  g.strokeStyle = '#1a1111';
  g.lineWidth = r * 0.07;
  for (let i = 0; i < 2; i++) {
    g.beginPath();
    const ox = -r * 0.10 + i * r * 0.18;
    g.ellipse(ox, -r * 1.04, r * 0.15, r * 0.24, -0.35 + i * 0.32, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  // Main chubby crimson body (slightly wide heavy silhouette)
  g.fillStyle = '#b3141b';
  g.strokeStyle = '#1a1111';
  g.lineWidth = r * 0.085;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();

  // Bottom shadow crescent inside body
  g.save();
  g.beginPath();
  g.arc(0, 0, r * 0.96, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#7f0b10';
  g.beginPath();
  g.arc(-r * 0.12, r * 0.24, r * 0.98, 0, Math.PI * 2);
  g.fill();

  // Pale rose-tan belly patch
  g.fillStyle = '#e7b6a8';
  g.beginPath();
  g.ellipse(r * 0.14, r * 0.72, r * 0.64, r * 0.42, 0, 0, Math.PI * 2);
  g.fill();

  // Terence's signature dark crimson spots/stripes on cheeks & sides
  g.fillStyle = '#6e080d';
  g.beginPath();
  g.ellipse(-r * 0.42, r * 0.08, r * 0.15, r * 0.24, 0.2, 0, Math.PI * 2);
  g.ellipse(-r * 0.15, r * 0.24, r * 0.12, r * 0.19, 0.1, 0, Math.PI * 2);
  g.fill();

  // Top highlight
  g.fillStyle = 'rgba(255, 160, 150, 0.25)';
  g.beginPath();
  g.ellipse(-r * 0.22, -r * 0.55, r * 0.42, r * 0.20, -0.35, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Outer thick cartoon outline
  g.strokeStyle = '#1a1111';
  g.lineWidth = r * 0.085;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();

  // Grumpy dark eye-bags under eyes
  g.fillStyle = '#5c070b';
  g.beginPath();
  g.ellipse(r * 0.16, -r * 0.02, r * 0.22, r * 0.16, 0, 0, Math.PI * 2);
  g.ellipse(r * 0.54, -r * 0.02, r * 0.20, r * 0.15, 0, 0, Math.PI * 2);
  g.fill();

  // Angry glaring eyes
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#1a1111';
  g.lineWidth = r * 0.05;
  g.beginPath();
  g.arc(r * 0.17, -r * 0.08, r * 0.19, 0, Math.PI * 2);
  g.arc(r * 0.54, -r * 0.08, r * 0.17, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  // Pupils
  g.fillStyle = giant ? '#2b0000' : '#111111';
  g.beginPath();
  g.arc(r * 0.22, -r * 0.07, r * 0.075, 0, Math.PI * 2);
  g.arc(r * 0.57, -r * 0.07, r * 0.07, 0, Math.PI * 2);
  g.fill();
  if (giant) {
    g.fillStyle = '#ff3b1f';
    g.beginPath();
    g.arc(r * 0.23, -r * 0.08, r * 0.035, 0, Math.PI * 2);
    g.arc(r * 0.58, -r * 0.08, r * 0.032, 0, Math.PI * 2);
    g.fill();
  }

  // MASSIVE V-shaped black eyebrows (Terence's unmistakable 30px silhouette!)
  g.fillStyle = '#140e0e';
  g.beginPath();
  g.moveTo(-r * 0.22, -r * 0.34);
  g.lineTo(r * 0.38, -r * 0.13);
  g.lineTo(r * 0.84, -r * 0.34);
  g.lineTo(r * 0.78, -r * 0.50);
  g.lineTo(r * 0.38, -r * 0.28);
  g.lineTo(-r * 0.14, -r * 0.52);
  g.closePath();
  g.fill();

  // Heavy hooked orange beak
  g.fillStyle = '#d97706';
  g.strokeStyle = '#1a1111';
  g.lineWidth = r * 0.055;
  g.beginPath();
  g.moveTo(r * 0.25, r * 0.14);
  g.lineTo(r * 0.86, r * 0.18);
  g.lineTo(r * 0.34, r * 0.38);
  g.closePath();
  g.fill();
  g.stroke();

  g.fillStyle = '#fbbf24';
  g.beginPath();
  g.moveTo(r * 0.24, r * 0.02);
  g.lineTo(r * 1.02, r * 0.15);
  g.lineTo(r * 0.28, r * 0.20);
  g.closePath();
  g.fill();
  g.stroke();
}

function triggerGroundShockwave(ctx, bird, x, y) {
  if (bird.data.groundSlammed) return;
  bird.data.groundSlammed = true;
  const gy = Math.max(0.2, groundTopAt(ctx, x, y + 1.5) + 0.25);

  // Main seismic shockwave (r 5.2 = 4.0 * 1.30, dmg 325 = 250 * 1.30, impulse 39 = 30 * 1.30)
  ctx.explode(x, gy, {
    r: 5.2,
    dmg: 325,
    impulse: 39,
    power: 'mega',
    source: 'terence_shockwave',
  });
  ctx.addEffect({ type: 'terence_shock', x, y: gy, r: 6.2, seed: bird.id, ttl: 0.9 });
  ctx.juice({ shake: 0.95, hitstop: 80, flash: { alpha: 0.28, color: '#ff4224' } });
  ctx.sfx('mega_explosion', { x, y: gy });

  // Secondary ground fissure tremors rippling left & right + flying boulder debris
  for (let side = -1; side <= 1; side += 2) {
    ctx.after(0.10, () => {
      const sx = x + side * 4.2;
      const sgy = groundTopAt(ctx, sx, gy + 3) + 0.2;
      ctx.damageCircle(sx, sgy, 3.6, { dmg: 150, impulse: 22, source: 'terence_quake' });
      ctx.addEffect({ type: 'terence_shock', x: sx, y: sgy, r: 3.8, seed: bird.id + side * 7, ttl: 0.65 });
    });
  }

  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI * (0.14 + 0.72 * (i / 7)));
    const spd = ctx.range(11, 18);
    ctx.spawnProjectile({
      x: x + Math.cos(ang) * 1.2,
      y: gy + 0.6,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd + 3,
      r: ctx.range(0.30, 0.46),
      skin: 'terence_rock',
      density: 4.5,
      dmgMul: 2.5,
      ttl: 1.8,
      owner: 'terence',
      explode: { r: 1.3, dmg: 95, impulse: 10, power: 'small' },
    });
  }
}

export default {
  id: 'terence',
  name: '大红',
  ability: '巨大化',
  desc: '瞬间变大4倍，体重×16碾压一切，落地引发大地震冲击波',
  color: '#b3141b',
  radius: BASE_R,
  density: 5.5,
  dmgMul: 1.25,

  onLaunch(_ctx, bird) {
    bird.data.giant = false;
    bird.data.groundSlammed = false;
    bird.data.crushMap = new Map();
    bird.data.nextTrailT = 0;
    bird.data.nextCrushT = 0;
  },

  onTap(ctx, bird, target) {
    if (!bird || !bird.alive) return;
    holdTurn(ctx, 2.8);

    const p = ctx.pos(bird);
    const v = ctx.vel(bird);
    const aim = resolveTarget(ctx, bird, target);

    bird.data.giant = true;
    bird.data.tapT = ctx.time;
    bird.dmgMul = 6.0; // ×5 tuned +20% (within ±30%)

    // Preserve momentum & steer giant charge toward target fortress if flying over/short
    const dx = aim.x - p.x;
    const dy = (aim.y + 0.8) - p.y;
    const dist = Math.hypot(dx, dy) || 1;
    const curSpd = Math.hypot(v.x, v.y);
    const chargeSpd = clamp(Math.max(curSpd * 1.15, 22), 20, 27);
    if (dx > 1.5) {
      ctx.setVelocity(bird, (dx / dist) * chargeSpd, clamp((dy / dist) * chargeSpd, -22, 6));
    } else {
      ctx.setVelocity(bird, v.x * 1.12, Math.min(v.y, -14));
    }

    // Immediate VFX (< 16 ms) + growth roar blast
    ctx.addEffect({ type: 'terence_grow', x: p.x, y: p.y, r: GIANT_R * 1.9, bird, ttl: 0.65 });
    ctx.damageCircle(p.x, p.y, 4.2, { dmg: 110, impulse: 18, source: 'terence_roar' });
    ctx.juice({ shake: 0.42, hitstop: 35 });
    ctx.sfx('grow', { x: p.x, y: p.y });

    // 5 fixture swaps over 0.25 s: 0.62 -> 2.48 m (radius ×4, mass ×16)
    for (let step = 1; step <= GROW_STEPS; step++) {
      const delay = ((step - 1) / (GROW_STEPS - 1)) * GROW_DUR;
      const rTarget = BASE_R + (GIANT_R - BASE_R) * (step / GROW_STEPS);
      if (delay <= 0) {
        resizeCircle(ctx, bird, rTarget);
      } else {
        ctx.after(delay, () => {
          if (!bird.alive) return;
          resizeCircle(ctx, bird, rTarget);
          const bp = ctx.pos(bird);
          ctx.addEffect({ type: 'shockwave', x: bp.x, y: bp.y, r: rTarget * 1.5, color: '#ff4d36', ttl: 0.26 });
        });
      }
    }

    // Safety fallback so shockwave still fires if wedged high on indestructible/dense rubble
    ctx.after(1.25, () => {
      if (bird.alive && !bird.data.groundSlammed) {
        const bp = ctx.pos(bird);
        triggerGroundShockwave(ctx, bird, bp.x, bp.y);
      }
    });
  },

  onStep(ctx, bird, _dt) {
    if (!bird || !bird.alive || !bird.data.giant) return;
    const p = ctx.pos(bird);
    const v = ctx.vel(bird);
    const spd = Math.hypot(v.x, v.y);

    // Crimson juggernaut wake stamps
    if (ctx.time >= (bird.data.nextTrailT || 0) && spd > 4.5) {
      bird.data.nextTrailT = ctx.time + 0.05;
      ctx.addEffect({ type: 'terence_trail', x: p.x, y: p.y, r: bird.r, vx: v.x, vy: v.y, ttl: 0.36 });
    }

    // Unstoppable ×16-mass bulldozer crush: smash blocks/pigs in path with red 1000+ damage numbers
    if (ctx.time >= (bird.data.nextCrushT || 0) && spd > 3.2) {
      bird.data.nextCrushT = ctx.time + 0.06;
      const crushMap = bird.data.crushMap || (bird.data.crushMap = new Map());
      const hits = ctx.queryCircle(p.x, p.y, bird.r + 0.38, (e) => !e.isStatic && (e.kind === KIND.BLOCK || e.kind === KIND.PIG));
      const ux = v.x / (spd || 1);
      const uy = v.y / (spd || 1);
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        const lastT = crushMap.get(e.id) || -99;
        if (ctx.time - lastT < 0.22) continue;
        crushMap.set(e.id, ctx.time);
        const ep = ctx.pos(e);
        const heavyDmg = Math.round(clamp(spd * 58, 520, 1450));
        ctx.damage(e, heavyDmg, { x: ep.x, y: ep.y, cause: 'terence_crush' });
        if (e.alive) {
          ctx.applyImpulse(e, ux * 20 + (ep.x - p.x) * 4, uy * 12 + 8);
        }
      }
      // Keep heavy forward plow momentum through light debris
      if (hits.length > 0 && spd < 18 && !bird.data.groundSlammed) {
        ctx.setVelocity(bird, v.x * 1.06, v.y);
      }
    }

    // First ground / static terrain hit -> seismic shockwave
    if (!bird.data.groundSlammed && ctx.time - (bird.data.tapT || 0) >= 0.05) {
      const gTop = groundTopAt(ctx, p.x, p.y + 1.5);
      const hitStatic = p.y - bird.r <= gTop + 0.24 ||
        ctx.queryCircle(p.x, p.y, bird.r + 0.16, (e) => e.isStatic).length > 0;
      if (hitStatic) {
        triggerGroundShockwave(ctx, bird, p.x, p.y);
      }
    }
  },

  drawBird: drawTerenceSprite,

  icon(g, size) {
    drawBirdIcon(drawTerenceSprite, BASE_R, g, size, 0);
  },

  projSkins: {
    terence_rock(g, ent) {
      const r = ent.r || 0.35;
      g.fillStyle = '#7a3b26';
      g.strokeStyle = '#1f120d';
      g.lineWidth = r * 0.14;
      g.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const rr = r * (0.78 + 0.28 * hash01(ent.id * 11 + i));
        if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#ff6a2b';
      g.beginPath();
      g.arc(r * 0.15, -r * 0.15, r * 0.24, 0, Math.PI * 2);
      g.fill();
    },
  },

  effects: {
    terence_grow(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const bp = e.bird && e.bird.alive ? e.bird.body.getPosition() : { x: e.x, y: e.y };
      const sx = cam.sx(bp.x);
      const sy = cam.sy(bp.y);
      const maxPx = e.r * cam.s;

      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let ring = 0; ring < 3; ring++) {
        const rk = clamp(k * 1.4 - ring * 0.18, 0, 1);
        if (rk <= 0) continue;
        const rad = maxPx * (0.25 + 0.85 * rk);
        g.globalAlpha = (1 - rk) * 0.75;
        g.strokeStyle = ring === 0 ? '#ffe066' : '#ff2e1f';
        g.lineWidth = Math.max(3, (1 - rk) * 14);
        g.beginPath();
        g.arc(sx, sy, rad, 0, Math.PI * 2);
        g.stroke();
      }
      // Radial power spikes
      g.strokeStyle = '#fff0a8';
      g.lineWidth = 3.5;
      g.globalAlpha = (1 - k) * 0.85;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + k * 0.8;
        const r0 = maxPx * (0.30 + k * 0.35);
        const r1 = maxPx * (0.65 + k * 0.55);
        g.beginPath();
        g.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0);
        g.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1);
        g.stroke();
      }
      g.restore();
    },

    terence_trail(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const sx = cam.sx(e.x);
      const sy = cam.sy(e.y);
      const rad = e.r * cam.s * (1 - 0.25 * k);
      g.save();
      g.globalAlpha = (1 - k) * 0.38;
      g.fillStyle = k < 0.35 ? '#ff4a2b' : '#b3141b';
      g.beginPath();
      g.arc(sx, sy, rad, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#ffd166';
      g.lineWidth = 2.5;
      g.stroke();
      g.restore();
    },

    terence_shock(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const sx = cam.sx(e.x);
      const sy = cam.sy(e.y);
      const maxR = e.r * cam.s;
      const ease = 1 - (1 - k) * (1 - k);

      g.save();
      // Expanding seismic dome
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (1 - k) * 0.55;
      g.fillStyle = k < 0.25 ? '#fff3b0' : '#ff4d1a';
      g.beginPath();
      g.arc(sx, sy, maxR * ease, Math.PI, Math.PI * 2);
      g.closePath();
      g.fill();

      // Double shockwave arcs
      for (let i = 0; i < 2; i++) {
        const rr = maxR * clamp(ease - i * 0.16, 0.05, 1.1);
        g.globalAlpha = (1 - k) * (i === 0 ? 0.92 : 0.65);
        g.strokeStyle = i === 0 ? '#ffe885' : '#ff2a1a';
        g.lineWidth = Math.max(2, (1 - k) * (i === 0 ? 14 : 9));
        g.beginPath();
        g.arc(sx, sy, rr, Math.PI * 0.96, Math.PI * 2.04);
        g.stroke();
      }

      // Angled flying rock slabs & dust puffs erupting along the ground
      g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 14; i++) {
        const u = (i / 13) * 2 - 1;
        const h1 = hash01(e.seed + i * 5.3);
        const h2 = hash01(e.seed + i * 11.7);
        const px = sx + u * maxR * ease * 0.92;
        const lift = maxR * (0.14 + 0.34 * h1) * Math.sin(Math.min(1, k * 1.35) * Math.PI);
        if (lift <= 2) continue;
        g.save();
        g.globalAlpha = (1 - k) * 0.82;
        g.translate(px, sy - lift);
        g.rotate(u * 1.2 + k * (h2 - 0.5) * 5);
        const rw = 8 + h1 * 12;
        const rh = 6 + h2 * 9;
        g.fillStyle = i % 3 === 0 ? '#ff7b29' : '#7a5234';
        g.strokeStyle = '#1f120d';
        g.lineWidth = 2;
        g.fillRect(-rw * 0.5, -rh * 0.5, rw, rh);
        g.strokeRect(-rw * 0.5, -rh * 0.5, rw, rh);
        g.restore();
      }
      g.restore();
    },
  },
};
