// 飞镖黄「激光冲刺」 (owner: birds-a).
// Spec: docs/DESIGN.md §3 row 3 — Tap: ×3 speed (≥45 m/s) piercing dash for 0.6 s (120+ dmg/body)
// + laser orb stays at dash origin firing 12 piercing 45+ m golden lasers ahead over ~0.55 s.

import { KIND } from '../contracts.js';
import {
  TAU, clamp, hash01, holdTurn, setSensor, setGravityScale,
  distributeTargets, pickPrimaryTarget, emitBirdHit, makeHudIcon, drawSmoothRibbon,
  drawCartoonEyes, drawAngryBrows, drawCartoonBeak,
} from './a_helpers.js';

export const CHUCK_TUNE = Object.freeze({
  dashSpeedMul: 3.1,      // spec ×3 (+3.3%)
  dashMinSpeed: 48,       // spec ≥ 45 m/s (+6.7%)
  dashDur: 0.60,          // spec 0.6 s (0%)
  dashDmg: 145,           // spec 120 (+20.8%)
  dashImpulse: 10.0,      // spec 8 (+25%)
  laserCount: 12,         // spec 12
  laserWindow: 0.56,      // spec 0.5 s (+12%)
  laserJitterDeg: 4.0,    // spec ±4°
  laserLen: 32,           // spec 45 m (-28.9% within ±30%, A1 local reach)
  laserDmg: 115,          // spec 90 (+27.8%)
  laserImpulse: 3.9,      // spec 3 (+30%)
  laserGlowTtl: 0.45,     // spec 0.35 s (+28.6%)
});

function drawChuckSprite(g, ent, _t) {
  const r = ent.r || 0.42;
  const dashing = !!(ent.data && ent.data.dashing);

  if (dashing) {
    g.fillStyle = 'rgba(255, 238, 60, 0.35)';
    g.beginPath();
    g.moveTo(r * 1.65, 0);
    g.lineTo(-r * 1.55, -r * 1.25);
    g.lineTo(-r * 1.55, r * 1.25);
    g.closePath();
    g.fill();
  }

  // Jagged black tail tuft (left-bottom)
  g.fillStyle = '#18150c';
  g.beginPath();
  g.moveTo(-r * 0.82, r * 0.12);
  g.lineTo(-r * 1.42, -r * 0.06);
  g.lineTo(-r * 1.18, r * 0.22);
  g.lineTo(-r * 1.48, r * 0.36);
  g.lineTo(-r * 0.85, r * 0.48);
  g.closePath();
  g.fill();

  // Spiky black top hair tuft
  g.fillStyle = '#18150c';
  g.beginPath();
  g.moveTo(-r * 0.16, -r * 0.92);
  g.lineTo(-r * 0.34, -r * 1.42);
  g.lineTo(-r * 0.04, -r * 1.14);
  g.lineTo(r * 0.14, -r * 1.48);
  g.lineTo(r * 0.18, -r * 0.95);
  g.closePath();
  g.fill();

  // Rounded-corner iconic yellow cone/triangle body (+y is down, +x is right)
  const buildTriPath = () => {
    g.beginPath();
    g.moveTo(0, -r * 1.06);
    g.quadraticCurveTo(r * 0.62, -r * 0.92, r * 1.02, r * 0.62);
    g.quadraticCurveTo(r * 1.06, r * 0.92, r * 0.72, r * 0.95);
    g.lineTo(-r * 0.76, r * 0.95);
    g.quadraticCurveTo(-r * 1.08, r * 0.92, -r * 0.98, r * 0.56);
    g.quadraticCurveTo(-r * 0.58, -r * 0.92, 0, -r * 1.06);
    g.closePath();
  };

  g.save();
  buildTriPath();
  g.fillStyle = '#f8d810';
  g.fill();
  g.clip();

  // Bright lemon highlight on upper-left slope
  g.fillStyle = '#ffef68';
  g.beginPath();
  g.ellipse(-r * 0.22, -r * 0.32, r * 0.42, r * 0.58, 0.25, 0, TAU);
  g.fill();

  // White/cream belly band along bottom
  g.fillStyle = '#fff8dc';
  g.beginPath();
  g.ellipse(r * 0.05, r * 0.94, r * 0.95, r * 0.36, 0, 0, TAU);
  g.fill();
  g.restore();

  // Thick dark outline around triangle
  buildTriPath();
  g.strokeStyle = '#1b1608';
  g.lineWidth = r * 0.095;
  g.stroke();

  // Focused eyes + fierce dark-rust slanted eyebrows + sharp aerodynamic beak
  drawCartoonEyes(g, r, { x1: 0.12, x2: 0.44, y: 0.04, rx: 0.18, ry: 0.20, pupil: 0.08 });
  drawAngryBrows(g, r, {
    color: '#8f2c12', yOuter: -0.26, yInner: -0.05, xLeft: -0.14, xMid: 0.30, xRight: 0.68, thick: 0.13,
  });
  drawCartoonBeak(g, r, { x0: 0.40, tipX: 1.24, yMid: 0.28, topH: 0.19, botH: 0.15 });
}

const chuck = {
  id: 'chuck',
  name: '飞镖黄',
  ability: '激光冲刺',
  desc: '三倍速化作金色闪电穿透全场，起点凝聚光球连射12道贯穿激光',
  color: '#f5d10f',
  radius: 0.42,
  density: 5,
  dmgMul: 1,

  onLaunch(_ctx, _bird) {},

  onStep(_ctx, _bird, _dt) {},

  onTap(ctx, bird, _target) {
    const origin = ctx.pos(bird);
    const ox = origin.x;
    const oy = origin.y;
    const tapRect = ctx.actionRect();
    const v = ctx.vel(bird);
    const curSpd = Math.hypot(v.x, v.y);
    const dashSpd = Math.max(CHUCK_TUNE.dashMinSpeed, curSpd * CHUCK_TUNE.dashSpeedMul);

    // Compute dash vector within default local reach from bird at tap time (Amendment A1)
    const prim = pickPrimaryTarget(ctx, ox, oy, { rect: tapRect });
    const tdx = prim.x - ox;
    const tdy = prim.y - oy;
    const td = Math.hypot(tdx, tdy) || 1;
    const tux = tdx / td;
    const tuy = tdy / td;
    let ux, uy;
    if (curSpd > 4 && v.x > 2 && oy < 8.5) {
      const vux = v.x / curSpd;
      const vuy = v.y / curSpd;
      const bx = vux * 0.45 + tux * 0.55;
      const by = vuy * 0.45 + tuy * 0.55;
      const bd = Math.hypot(bx, by) || 1;
      ux = bx / bd;
      uy = by / bd;
    } else {
      ux = tux;
      uy = tuy;
    }

    // Enter piercing sensor dash mode
    bird.data.dashing = true;
    setSensor(ctx, bird, true);
    setGravityScale(ctx, bird, 0);
    ctx.setVelocity(bird, ux * dashSpd, uy * dashSpd);
    bird.body.setAngle(Math.atan2(uy, ux));

    // Spawn Laser Orb at dash origin + dash Mach trail
    ctx.addEffect({
      type: 'chuck_orb',
      x: ox,
      y: oy,
      r: 1.35,
      ttl: 1.05,
    });
    const dashTrail = ctx.addEffect({
      type: 'chuck_dash',
      x: ox,
      y: oy,
      ox,
      oy,
      pts: [{ x: ox, y: oy, a: Math.atan2(uy, ux), t: ctx.time }],
      ttl: 1.05,
    });

    ctx.sfx('jet', { vol: 0.9, pitch: 1.15 });
    ctx.juice({ shake: 0.36, hitstop: 32, flash: { alpha: 0.22, color: '#fff59d' } });
    emitBirdHit(ctx, 'chuck', ox, oy, 30);

    holdTurn(ctx, 1.8);

    // Swept piercing dash task (0.60 s, bounded to local actionRect + level bounds)
    const piercedIds = new Set();
    let prevX = ox;
    let prevY = oy;
    let dashEnded = false;
    const xBoundMax = Math.min(
      (ctx.level && ctx.level.bounds ? ctx.level.bounds.x1 : 70) - 2.5,
      tapRect.x1 + 5.0,
    );

    const finishDash = () => {
      if (dashEnded) return;
      dashEnded = true;
      bird.data.dashing = false;
      if (bird.alive) {
        setSensor(ctx, bird, false);
        setGravityScale(ctx, bird, 1);
        ctx.setVelocity(bird, ux * 11, Math.max(-3, uy * 11));
      }
    };

    ctx.addTask((_dt, age) => {
      if (!bird.alive || dashEnded) return false;
      const cp = ctx.pos(bird);
      let cx = cp.x;
      let cy = cp.y;

      // Ground skim safety so sensor Chuck never tunnels below y = 0 ground
      if (cy < bird.r + 0.14 && uy < 0) {
        uy = 0.04;
        const norm = Math.hypot(ux, uy) || 1;
        ux /= norm;
        uy /= norm;
        cy = bird.r + 0.16;
        bird.body.setPosition(new ctx.planck.Vec2(cx, cy));
      }
      ctx.setVelocity(bird, ux * dashSpd, uy * dashSpd);
      bird.body.setAngle(Math.atan2(uy, ux));

      // Swept segment query from prev -> cur so 48+ m/s never skips thin planks
      const segDx = cx - prevX;
      const segDy = cy - prevY;
      const segLen = Math.hypot(segDx, segDy);
      const samples = Math.max(1, Math.ceil(segLen / 0.42));
      for (let s = 1; s <= samples; s++) {
        const u = s / samples;
        const sx = prevX + segDx * u;
        const sy = prevY + segDy * u;
        const hits = ctx.queryCircle(sx, sy, bird.r + 0.42, (e) => !e.isStatic && (e.kind === KIND.BLOCK || e.kind === KIND.PIG));
        for (const e of hits) {
          if (piercedIds.has(e.id)) continue;
          piercedIds.add(e.id);
          const ep = ctx.pos(e);
          ctx.damage(e, CHUCK_TUNE.dashDmg, { x: ep.x, y: ep.y, cause: 'chuck_dash' });
          ctx.applyImpulse(e, ux * CHUCK_TUNE.dashImpulse, uy * CHUCK_TUNE.dashImpulse + 2.0);
          ctx.addEffect({ type: 'chuck_spark', x: ep.x, y: ep.y, r: 1.0, ttl: 0.32 });
          emitBirdHit(ctx, 'chuck', ep.x, ep.y, 28);
        }
      }

      prevX = cx;
      prevY = cy;
      dashTrail.x = cx;
      dashTrail.y = cy;
      dashTrail.pts.push({ x: cx, y: cy, a: Math.atan2(uy, ux), t: ctx.time });
      if (dashTrail.pts.length > 42) dashTrail.pts.shift();

      if (age >= CHUCK_TUNE.dashDur || cx >= xBoundMax) {
        finishDash();
        return false;
      }
      return true;
    });

    // Fire 12 piercing 32 m lasers from the dash origin (ox, oy) over 0.56 s (local reach per A1)
    const nLasers = CHUCK_TUNE.laserCount;
    for (let i = 0; i < nLasers; i++) {
      const delay = 0.015 + (i / Math.max(1, nLasers - 1)) * CHUCK_TUNE.laserWindow;
      ctx.after(delay, () => {
        const targets = distributeTargets(ctx, ox, oy, nLasers, {
          aheadOnly: true,
          rect: tapRect,
        });
        const tgt = targets[i % targets.length];
        const baseAng = Math.atan2(tgt.y - oy, tgt.x - ox);
        const jitter = ctx.range(-CHUCK_TUNE.laserJitterDeg, CHUCK_TUNE.laserJitterDeg) * (Math.PI / 180);
        const ang = baseAng + jitter;
        const x2 = ox + Math.cos(ang) * CHUCK_TUNE.laserLen;
        const y2 = oy + Math.sin(ang) * CHUCK_TUNE.laserLen;

        const hitEnts = ctx.damageRay(ox, oy, x2, y2, {
          dmg: CHUCK_TUNE.laserDmg,
          impulse: CHUCK_TUNE.laserImpulse,
          width: 0.35,
          source: 'chuck_laser',
        });

        const sparks = [];
        for (let k = 0; k < Math.min(6, hitEnts.length); k++) {
          const he = hitEnts[k];
          if (he && he.body) {
            const hp = he.body.getPosition();
            sparks.push({ x: hp.x, y: hp.y });
          }
        }

        ctx.addEffect({
          type: 'chuck_laser',
          x: (ox + x2) * 0.5,
          y: (oy + y2) * 0.5,
          x1: ox,
          y1: oy,
          x2,
          y2,
          sparks,
          ttl: CHUCK_TUNE.laserGlowTtl,
        });
        ctx.sfx('laser', { vol: 0.55, pitch: 0.94 + (i % 6) * 0.05 });
        if (i % 3 === 0) ctx.juice({ shake: 0.14 });
      });
    }
  },

  drawBird: drawChuckSprite,

  projSkins: {
    'bird:chuck': drawChuckSprite,
  },

  effects: {
    /** Pulsing golden-white plasma laser orb anchored at Chuck's dash origin. */
    chuck_orb(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const fade = k < 0.1 ? k / 0.1 : (k > 0.72 ? (1 - k) / 0.28 : 1);
      const cx = cam.sx(e.x);
      const cy = cam.sy(e.y);
      const pulse = 1 + 0.18 * Math.sin(t * 36);
      const rr = (e.r || 1.3) * cam.s * pulse;

      g.save();
      // Rich amber-gold outer halo (source-over so golden color reads crisply on bright sky!)
      g.fillStyle = `rgba(255, 165, 0, ${(0.55 * fade).toFixed(3)})`;
      g.beginPath();
      g.arc(cx, cy, rr * 1.18, 0, TAU);
      g.fill();

      // Spinning electric yellow ring + star spikes
      g.strokeStyle = `rgba(255, 232, 0, ${(0.92 * fade).toFixed(3)})`;
      g.lineWidth = Math.max(3, 0.16 * cam.s);
      g.beginPath();
      g.arc(cx, cy, rr * 0.72, 0, TAU);
      g.stroke();

      for (let i = 0; i < 8; i++) {
        const a = t * 8 + (i * TAU) / 8;
        const len = rr * (i % 2 === 0 ? 1.36 : 0.94);
        g.strokeStyle = i % 2 === 0
          ? `rgba(255, 230, 0, ${(0.92 * fade).toFixed(3)})`
          : `rgba(255, 255, 240, ${(0.92 * fade).toFixed(3)})`;
        g.lineWidth = Math.max(2, 0.09 * cam.s);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * rr * 0.2, cy + Math.sin(a) * rr * 0.2);
        g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        g.stroke();
      }

      // White-hot plasma core
      g.fillStyle = `rgba(255, 255, 245, ${(0.98 * fade).toFixed(3)})`;
      g.beginPath();
      g.arc(cx, cy, rr * 0.42, 0, TAU);
      g.fill();
      g.restore();
    },

    /** Thick golden-yellow piercing laser beam with vivid yellow halo + white-hot core. */
    chuck_laser(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const fade = k < 0.12 ? k / 0.12 : Math.pow(1 - (k - 0.12) / 0.88, 0.72);
      const x1 = cam.sx(e.x1), y1 = cam.sy(e.y1);
      const x2 = cam.sx(e.x2), y2 = cam.sy(e.y2);

      g.save();
      g.lineCap = 'round';

      // Rich amber-gold outer sheath (source-over keeps intense yellow contrast on blue sky!)
      g.strokeStyle = `rgba(255, 155, 0, ${(0.55 * fade).toFixed(3)})`;
      g.lineWidth = Math.max(9, 0.96 * cam.s * fade);
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();

      // Electric vivid yellow main beam
      g.strokeStyle = `rgba(255, 232, 0, ${(0.92 * fade).toFixed(3)})`;
      g.lineWidth = Math.max(5, 0.50 * cam.s * fade);
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();

      // Additive glow bloom + blazing pure-white core
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255, 225, 40, ${(0.55 * fade).toFixed(3)})`;
      g.lineWidth = Math.max(4, 0.36 * cam.s * fade);
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();

      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = `rgba(255, 255, 255, ${(0.96 * fade).toFixed(3)})`;
      g.lineWidth = Math.max(2, 0.17 * cam.s * fade);
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();

      // Impact flares along pierced targets
      if (e.sparks && e.sparks.length) {
        for (const sp of e.sparks) {
          const sx = cam.sx(sp.x), sy = cam.sy(sp.y);
          g.fillStyle = `rgba(255, 220, 0, ${(0.85 * fade).toFixed(3)})`;
          g.beginPath();
          g.arc(sx, sy, 0.55 * cam.s * fade, 0, TAU);
          g.fill();
          g.fillStyle = `rgba(255, 255, 255, ${(0.95 * fade).toFixed(3)})`;
          g.beginPath();
          g.arc(sx, sy, 0.25 * cam.s * fade, 0, TAU);
          g.fill();
        }
      }
      g.restore();
    },

    /** Supersonic golden Mach streak + shockwave cone along Chuck's piercing dash. */
    chuck_dash(g, e, t, cam) {
      const pts = e.pts;
      if (!pts || pts.length < 2) return;

      drawSmoothRibbon(g, cam, pts, t, 0.65, [
        { color: '255, 165, 0', alpha: 0.68, widthM: 0.82, minPx: 5 },
        { color: '255, 232, 15', alpha: 0.88, widthM: 0.46, minPx: 3 },
        { color: '255, 255, 240', alpha: 0.96, widthM: 0.18, minPx: 1.6 },
      ]);

      // Mach V-cone at head if still fresh
      const head = pts[pts.length - 1];
      const ha = clamp(1 - (t - head.t) / 0.25, 0, 1);
      if (ha > 0.05) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.lineCap = 'round';
        const hx = cam.sx(head.x), hy = cam.sy(head.y);
        g.translate(hx, hy);
        g.rotate(-head.a);
        g.strokeStyle = `rgba(255, 250, 180, ${(0.88 * ha).toFixed(3)})`;
        g.lineWidth = Math.max(2.5, 0.14 * cam.s);
        g.beginPath();
        g.moveTo(-1.3 * cam.s, -0.95 * cam.s);
        g.lineTo(0.8 * cam.s, 0);
        g.lineTo(-1.3 * cam.s, 0.95 * cam.s);
        g.stroke();
        g.restore();
      }
    },

    /** Electric yellow-white burst spark on pierced blocks. */
    chuck_spark(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const a = 1 - k;
      const cx = cam.sx(e.x), cy = cam.sy(e.y);
      const rr = (e.r || 1.0) * cam.s * (0.3 + 0.8 * k);

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255, 245, 110, ${(0.9 * a).toFixed(3)})`;
      g.lineWidth = Math.max(2, 0.12 * cam.s * a);
      for (let i = 0; i < 6; i++) {
        const ang = (i * TAU) / 6 + hash01(e.t0 * 73 + i);
        g.beginPath();
        g.moveTo(cx + Math.cos(ang) * rr * 0.2, cy + Math.sin(ang) * rr * 0.2);
        g.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
        g.stroke();
      }
      g.restore();
    },
  },
};

chuck.icon = makeHudIcon(chuck, 0.35, 0.48, 0.56);

export default chuck;
