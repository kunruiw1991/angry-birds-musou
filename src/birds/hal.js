// 长嘴绿「神鹰回旋」 (owner: birds-a).
// Spec: docs/DESIGN.md §3 row 6 — Tap: boomerang U-turn spin (vx -> -0.9 vx, vy >= +4) + summon 8
// Mighty Eagles (3.5 m wingspan) 0.16 s apart swooping from upper-right through the structure and out.

import { KIND } from '../contracts.js';
import {
  TAU, clamp, hash01, holdTurn,
  distributeTargets, emitBirdHit, makeHudIcon,
  drawCartoonEyes, drawAngryBrows,
} from './a_helpers.js';

export const HAL_TUNE = Object.freeze({
  turnVxMul: -0.90,      // spec -0.9 vx (0%)
  minTurnVy: 4.6,        // spec >= +4 (+15%)
  eagleCount: 8,         // spec 8 (0%)
  eagleSpacing: 0.16,    // spec 0.2 s (-20%: puts 6 eagles live on screen at 0.8s!)
  eagleSwoopDur: 1.05,   // spec 1.1 s (-4.5%)
  eagleSpan: 3.5,        // spec 3.2 m (+9.4%)
  eagleHitR: 1.50,       // spec 1.2 m (+25%)
  eagleDmg: 265,         // spec 220 (+20.5%)
  eagleImpulse: 17.5,    // spec 14 (+25%)
});

function drawHalSprite(g, ent, _t) {
  const r = ent.r || 0.48;

  // Black & dark-green tail feathers (left)
  g.fillStyle = '#182414';
  for (const [ang, len] of [[-0.28, 1.38], [0.06, 1.46], [0.34, 1.30]]) {
    g.save();
    g.rotate(ang);
    g.beginPath();
    g.ellipse(-r * len * 0.82, 0, r * 0.30, r * 0.11, 0, 0, TAU);
    g.fill();
    g.restore();
  }

  // Swept-back dark-emerald head crest plumes
  g.fillStyle = '#2d821c';
  g.strokeStyle = '#13240d';
  g.lineWidth = r * 0.08;
  g.beginPath();
  g.ellipse(-r * 0.35, -r * 0.96, r * 0.34, r * 0.15, -0.35, 0, TAU);
  g.fill();
  g.stroke();
  g.beginPath();
  g.ellipse(-r * 0.16, -r * 1.06, r * 0.28, r * 0.14, -0.20, 0, TAU);
  g.fill();
  g.stroke();

  // Emerald-green oval body + crisp white belly
  g.save();
  g.beginPath();
  g.ellipse(-r * 0.08, 0, r * 0.98, r * 0.92, 0, 0, TAU);
  g.fillStyle = '#4cb834';
  g.fill();
  g.clip();

  g.fillStyle = '#75db58';
  g.beginPath();
  g.arc(-r * 0.32, -r * 0.30, r * 0.56, 0, TAU);
  g.fill();

  g.fillStyle = '#f2f8ef';
  g.beginPath();
  g.ellipse(0, r * 0.78, r * 0.78, r * 0.45, 0, 0, TAU);
  g.fill();
  g.restore();

  g.strokeStyle = '#13240d';
  g.lineWidth = r * 0.09;
  g.beginPath();
  g.ellipse(-r * 0.08, 0, r * 0.98, r * 0.92, 0, 0, TAU);
  g.stroke();

  // Eyes & angry brows
  drawCartoonEyes(g, r, { x1: -0.02, x2: 0.30, y: -0.14, rx: 0.18, ry: 0.21, pupil: 0.08 });
  drawAngryBrows(g, r, {
    color: '#1b4a12', yOuter: -0.44, yInner: -0.24, xLeft: -0.26, xMid: 0.16, xRight: 0.52, thick: 0.13,
  });

  // HUGE signature boomerang/toucan golden-orange beak (+1.62r right!)
  g.lineJoin = 'round';
  g.strokeStyle = '#1c1408';
  g.lineWidth = r * 0.08;

  // Lower mandible
  g.fillStyle = '#d97206';
  g.beginPath();
  g.moveTo(r * 0.22, r * 0.14);
  g.quadraticCurveTo(r * 0.88, r * 0.22, r * 1.38, r * 0.34);
  g.quadraticCurveTo(r * 0.84, r * 0.46, r * 0.18, r * 0.38);
  g.closePath();
  g.fill();
  g.stroke();

  // Massive curved upper mandible
  g.fillStyle = '#ffad0a';
  g.beginPath();
  g.moveTo(r * 0.18, -r * 0.16);
  g.quadraticCurveTo(r * 1.06, -r * 0.22, r * 1.64, r * 0.24);
  g.quadraticCurveTo(r * 1.02, r * 0.22, r * 0.18, r * 0.16);
  g.closePath();
  g.fill();
  g.stroke();

  // Orange-red tip accent on Hal's giant beak
  g.fillStyle = '#f25c05';
  g.beginPath();
  g.arc(r * 1.34, r * 0.14, r * 0.12, 0, TAU);
  g.fill();
}

function drawMightyEagleScreen(g, cx, cy, angleWorld, spanPx, flapPhase) {
  // Mighty Eagle in screen px, oriented along heading (-angleWorld in screen y-down coords)
  const flap = Math.sin(flapPhase) * 0.18;
  const s = spanPx * 0.5; // half-wingspan in px

  g.save();
  g.translate(cx, cy);
  g.rotate(-angleWorld);

  // Sonic golden V-shockwave at the eagle's beak
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255, 228, 120, 0.72)';
  g.lineWidth = Math.max(2.5, s * 0.09);
  g.beginPath();
  g.moveTo(-s * 0.35, -s * 0.72);
  g.lineTo(s * 0.72, 0);
  g.lineTo(-s * 0.35, s * 0.72);
  g.stroke();
  g.restore();

  // Fanned snow-white tail feathers (back = -x)
  g.fillStyle = '#f4f1e8';
  g.strokeStyle = '#1c130d';
  g.lineWidth = Math.max(1.8, s * 0.045);
  g.beginPath();
  g.moveTo(-s * 0.30, 0);
  g.lineTo(-s * 0.88, -s * 0.28);
  g.quadraticCurveTo(-s * 1.02, 0, -s * 0.88, s * 0.28);
  g.closePath();
  g.fill();
  g.stroke();

  // Swept mighty dark-brown wings (top & bottom in top-down/3-quarter dynamic swoop pose!)
  for (const side of [-1, 1]) {
    const tipY = side * s * (0.98 + flap * side * 0.35);
    const tipX = -s * (0.18 + Math.abs(flap) * 0.2);

    g.fillStyle = '#3d2314';
    g.beginPath();
    g.moveTo(s * 0.18, side * s * 0.10);
    g.quadraticCurveTo(s * 0.12, side * s * 0.68, tipX, tipY);
    g.lineTo(tipX - s * 0.22, tipY * 0.82);
    g.quadraticCurveTo(-s * 0.32, side * s * 0.45, -s * 0.38, side * s * 0.10);
    g.closePath();
    g.fill();
    g.stroke();

    // Lighter bronze secondary plumage band
    g.fillStyle = '#6e4328';
    g.beginPath();
    g.moveTo(s * 0.08, side * s * 0.14);
    g.quadraticCurveTo(0, side * s * 0.52, tipX * 0.7, tipY * 0.72);
    g.lineTo(-s * 0.26, side * s * 0.32);
    g.closePath();
    g.fill();
  }

  // Muscular dark torso
  g.fillStyle = '#2d190e';
  g.beginPath();
  g.ellipse(-s * 0.05, 0, s * 0.42, s * 0.22, 0, 0, TAU);
  g.fill();
  g.stroke();

  // Iconic snow-white Bald/Mighty Eagle head & neck ruff (+x forward)
  g.fillStyle = '#faf8f2';
  g.beginPath();
  g.ellipse(s * 0.28, 0, s * 0.26, s * 0.20, 0, 0, TAU);
  g.fill();
  g.stroke();

  // Hooked golden raptor beak
  g.fillStyle = '#ffba14';
  g.beginPath();
  g.moveTo(s * 0.46, -s * 0.10);
  g.quadraticCurveTo(s * 0.76, -s * 0.06, s * 0.72, s * 0.10);
  g.lineTo(s * 0.44, s * 0.08);
  g.closePath();
  g.fill();
  g.stroke();

  // Fierce golden-amber eagle eye + dark brow ridge
  g.fillStyle = '#ffea47';
  g.beginPath();
  g.arc(s * 0.36, -s * 0.05, s * 0.055, 0, TAU);
  g.fill();
  g.fillStyle = '#140d08';
  g.beginPath();
  g.arc(s * 0.38, -s * 0.05, s * 0.026, 0, TAU);
  g.fill();
  g.strokeStyle = '#1c130d';
  g.lineWidth = Math.max(2, s * 0.045);
  g.beginPath();
  g.moveTo(s * 0.24, -s * 0.12);
  g.lineTo(s * 0.46, -s * 0.07);
  g.stroke();

  g.restore();
}

const hal = {
  id: 'hal',
  name: '长嘴绿',
  ability: '神鹰回旋',
  desc: '回旋镖急转掉头，旋转召唤8只无敌神鹰从天俯冲横扫全场',
  color: '#4cb834',
  radius: 0.48,
  density: 5,
  dmgMul: 1,

  onLaunch(_ctx, _bird) {},

  onStep(ctx, bird, _dt) {
    if (bird.alive && bird.data.spinFx) {
      const p = ctx.pos(bird);
      bird.data.spinFx.x = p.x;
      bird.data.spinFx.y = p.y;
    }
  },

  onTap(ctx, bird, target) {
    const p = ctx.pos(bird);
    const v = ctx.vel(bird);

    // 1. Boomerang U-turn spin: vx -> -0.9 vx, vy >= +4.6
    const newVx = Math.abs(v.x) >= 5 ? v.x * HAL_TUNE.turnVxMul : -12;
    const newVy = Math.max(v.y, HAL_TUNE.minTurnVy);
    ctx.setVelocity(bird, newVx, newVy);
    bird.body.setAngularVelocity(-24);
    bird.dmgMul = 2.0;
    bird.data.spinning = true;

    bird.data.spinFx = ctx.addEffect({
      type: 'hal_spin',
      x: p.x,
      y: p.y,
      r: 1.45,
      ttl: 2.1,
    });

    ctx.sfx('eagle', { vol: 0.9, pitch: 1.0 });
    ctx.juice({ shake: 0.28, hitstop: 26, flash: { alpha: 0.16, color: '#d4ffb2' } });
    emitBirdHit(ctx, 'hal', p.x, p.y, 20);

    const totalDur = (HAL_TUNE.eagleCount - 1) * HAL_TUNE.eagleSpacing + HAL_TUNE.eagleSwoopDur + 0.5;
    holdTurn(ctx, totalDur);

    // 2. Summon 8 Mighty Eagles (0.16 s apart; Eagle #0 spawns immediately at t = 0!)
    const spawnEagle = (idx) => {
      const rect = ctx.actionRect();
      const targets = distributeTargets(ctx, p.x, p.y, HAL_TUNE.eagleCount, {
        aheadOnly: false,
        explicitTarget: idx === 0 ? target : null,
      });
      const tgt = targets[idx % targets.length];
      const tx = tgt.x;
      // Dip to y = 1..3.2 m through structures (or directly through high/balloon pigs!)
      const isHighPig = tgt.ent && tgt.ent.kind === KIND.PIG && tgt.y > 3.2;
      const dipY = isHighPig ? clamp(tgt.y, 1.0, 9.5) : clamp(tgt.y, 1.0, 3.2);

      // Quadratic Bezier swoop P(u) from upper-right sky -> (tx, dipY) at u=0.5 -> upper-left exit
      const x0 = Math.max(rect.x1 + 5, tx + 17 + (idx % 3) * 2.4);
      const y0 = Math.max(rect.y1 + 2.5, 17.5 + (idx % 2) * 2.2);
      const x2 = Math.min(rect.x0 - 4, tx - 17 - (idx % 2) * 2.2);
      const y2 = Math.max(rect.y1 + 1.0, 15.0 + (idx % 3) * 1.8);
      const x1 = 2 * tx - 0.5 * (x0 + x2);
      const y1 = 2 * dipY - 0.5 * (y0 + y2);

      const dur = HAL_TUNE.eagleSwoopDur;
      const eagleFx = ctx.addEffect({
        type: 'hal_eagle',
        x: x0,
        y: y0,
        angle: Math.PI * 1.25,
        span: HAL_TUNE.eagleSpan,
        seed: idx + 1,
        trail: [{ x: x0, y: y0, t: ctx.time }],
        ttl: dur + 0.35,
      });

      ctx.sfx('eagle', { vol: 0.62, pitch: 0.90 + (idx % 4) * 0.06 });

      const hitIds = new Set();
      let prevX = x0;
      let prevY = y0;
      let featherBursts = 0;

      ctx.addTask((_dt, age) => {
        const u = clamp(age / dur, 0, 1);
        const om = 1 - u;
        const cx = om * om * x0 + 2 * om * u * x1 + u * u * x2;
        const cy = om * om * y0 + 2 * om * u * y1 + u * u * y2;
        const tvx = 2 * om * (x1 - x0) + 2 * u * (x2 - x1);
        const tvy = 2 * om * (y1 - y0) + 2 * u * (y2 - y1);
        const tLen = Math.hypot(tvx, tvy) || 1;
        const ux = tvx / tLen;
        const uy = tvy / tLen;

        eagleFx.x = cx;
        eagleFx.y = cy;
        eagleFx.angle = Math.atan2(tvy, tvx);
        eagleFx.done = age >= dur;
        eagleFx.trail.push({ x: cx, y: cy, t: ctx.time });
        if (eagleFx.trail.length > 26) eagleFx.trail.shift();

        // Swept collision query within 1.5 m of the eagle along its path
        const segLen = Math.hypot(cx - prevX, cy - prevY);
        const steps = Math.max(1, Math.ceil(segLen / 0.6));
        for (let s = 1; s <= steps; s++) {
          const su = s / steps;
          const qx = prevX + (cx - prevX) * su;
          const qy = prevY + (cy - prevY) * su;
          const hits = ctx.queryCircle(qx, qy, HAL_TUNE.eagleHitR, (e) => !e.isStatic && (e.kind === KIND.BLOCK || e.kind === KIND.PIG));
          for (const e of hits) {
            if (hitIds.has(e.id)) continue;
            hitIds.add(e.id);
            const ep = ctx.pos(e);
            ctx.damage(e, HAL_TUNE.eagleDmg, { x: ep.x, y: ep.y, cause: 'hal_eagle' });
            ctx.applyImpulse(e, ux * HAL_TUNE.eagleImpulse, uy * HAL_TUNE.eagleImpulse + 3.5);
            if (featherBursts < 5) {
              featherBursts++;
              ctx.addEffect({
                type: 'hal_feathers',
                x: ep.x,
                y: ep.y,
                r: 1.8,
                seed: e.id + idx * 17,
                ttl: 0.55,
              });
              emitBirdHit(ctx, 'hal', ep.x, ep.y, 26);
              ctx.juice({ shake: 0.14 });
            }
          }
        }

        prevX = cx;
        prevY = cy;
        return age < dur;
      });
    };

    spawnEagle(0);
    for (let i = 1; i < HAL_TUNE.eagleCount; i++) {
      ctx.after(i * HAL_TUNE.eagleSpacing, () => spawnEagle(i));
    }
  },

  drawBird: drawHalSprite,

  projSkins: {
    'bird:hal': drawHalSprite,
  },

  effects: {
    /** Emerald-gold boomerang vortex blades spinning around Hal. */
    hal_spin(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const a = 1 - k;
      const cx = cam.sx(e.x), cy = cam.sy(e.y);
      const rr = (e.r || 1.4) * cam.s;

      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const ang = -t * 22 + (i * TAU) / 4;
        g.strokeStyle = i % 2 === 0
          ? `rgba(110, 255, 95, ${(0.82 * a).toFixed(3)})`
          : `rgba(255, 225, 90, ${(0.78 * a).toFixed(3)})`;
        g.lineWidth = Math.max(3, 0.16 * cam.s);
        g.beginPath();
        g.arc(cx, cy, rr, ang, ang + 0.95);
        g.stroke();
      }
      g.restore();
    },

    /** 3.5 m wingspan Mighty Eagle swoop + golden-emerald slipstream ribbons! */
    hal_eagle(g, e, t, cam) {
      const pts = e.trail;
      const win = 0.42;

      // 1. Twin glowing golden-emerald slipstream ribbons behind the swooping eagle
      if (pts && pts.length >= 2) {
        g.save();
        g.lineCap = 'round';
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i], p1 = pts[i + 1];
          const a = clamp(1 - (t - p1.t) / win, 0, 1);
          if (a <= 0.02) continue;
          const x0 = cam.sx(p0.x), y0 = cam.sy(p0.y);
          const x1 = cam.sx(p1.x), y1 = cam.sy(p1.y);

          // Rich emerald-gold outer wind ribbon (source-over pops on desert sky!)
          g.strokeStyle = `rgba(90, 200, 50, ${(0.38 * a).toFixed(3)})`;
          g.lineWidth = Math.max(7, 1.55 * cam.s * a);
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.stroke();

          g.strokeStyle = `rgba(255, 185, 25, ${(0.65 * a).toFixed(3)})`;
          g.lineWidth = Math.max(4, 0.90 * cam.s * a);
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.stroke();

          g.strokeStyle = `rgba(255, 253, 235, ${(0.92 * a).toFixed(3)})`;
          g.lineWidth = Math.max(2, 0.34 * cam.s * a);
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.stroke();
        }
        g.restore();
      }

      // 2. Mighty Eagle body & flapping wings while mid-swoop
      if (!e.done) {
        const cx = cam.sx(e.x);
        const cy = cam.sy(e.y);
        const spanPx = (e.span || 3.5) * cam.s;
        drawMightyEagleScreen(g, cx, cy, e.angle || Math.PI, spanPx, t * 24 + (e.seed || 0) * 1.7);
      }
    },

    /** Burst of brown, white, and emerald feathers + golden impact slash! */
    hal_feathers(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const a = 1 - k;
      const cx = cam.sx(e.x), cy = cam.sy(e.y);
      const maxR = (e.r || 1.8) * cam.s;

      g.save();
      // Golden impact slash ring
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255, 225, 110, ${(0.85 * a).toFixed(3)})`;
      g.lineWidth = Math.max(2, 0.16 * cam.s * a);
      g.beginPath();
      g.arc(cx, cy, maxR * (0.25 + 0.75 * Math.pow(k, 0.6)), 0, TAU);
      g.stroke();
      g.restore();

      // 10 spinning feathers flying outward
      g.globalAlpha = a;
      const colors = ['#5c361e', '#faf6eb', '#4cb834', '#d99b38'];
      for (let i = 0; i < 10; i++) {
        const h1 = hash01((e.seed || 1) * 31 + i * 7);
        const h2 = hash01((e.seed || 1) * 17 + i * 13);
        const ang = h1 * TAU;
        const dist = maxR * (0.18 + 0.95 * Math.pow(k, 0.65) * (0.55 + 0.6 * h2));
        const fx = cx + Math.cos(ang) * dist;
        const fy = cy + Math.sin(ang) * dist + k * k * 0.4 * cam.s;
        const rot = ang + k * (h2 > 0.5 ? 5 : -5);

        g.save();
        g.translate(fx, fy);
        g.rotate(rot);
        g.fillStyle = colors[i % colors.length];
        g.strokeStyle = '#1c120b';
        g.lineWidth = Math.max(1, 0.03 * cam.s);
        g.beginPath();
        g.ellipse(0, 0, Math.max(4, 0.24 * cam.s), Math.max(1.8, 0.09 * cam.s), 0, 0, TAU);
        g.fill();
        g.stroke();
        g.restore();
      }
      g.restore();
    },
  },
};

hal.icon = makeHudIcon(hal, 0.30, 0.40, 0.54);

export default hal;
