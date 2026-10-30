// 胖红「风火轮」 (owner: birds-a).
// Spec: docs/DESIGN.md §3 row 1 — 12 orbiting mini-Reds grind on touch; Tap = 12 homing mini-Reds
// with glowing pink ribbon trails + Red ×2 dmg & +30% speed.

import { KIND } from '../contracts.js';
import {
  TAU, clamp, hash01, holdTurn, spawnBirdClone, steerTowards, guardExplosiveProj,
  distributeTargets, pickPrimaryTarget, emitBirdHit, makeHudIcon, drawSmoothRibbon,
  drawCartoonEyes, drawAngryBrows, drawCartoonBeak,
} from './a_helpers.js';

export const RED_TUNE = Object.freeze({
  orbitCount: 12,
  orbitRadius: 1.35,      // spec 1.3 m (+3.8%)
  orbitRevPerSec: 3.0,    // spec 3 rev/s
  grindInterval: 0.10,    // spec 0.1 s
  grindDmg: 34,           // spec 30 (+13.3%)
  grindImpulse: 1.8,      // spec 1.5 (+20%)
  homingSpeed: 19.5,      // spec 18 m/s (+8.3%)
  homingSteer: 36,        // spec 30 m/s^2 (+20%)
  homingDur: 1.35,        // spec 1.2 s (+12.5%)
  cloneDmgMul: 2.0,       // spec ×2
  cloneBlastR: 1.15,      // spec 0.9 m (+27.8%)
  cloneBlastDmg: 75,      // spec 60 (+25%)
  cloneBlastImpulse: 10,
  selfSpeedMul: 1.30,     // spec +30%
  selfDmgMul: 2.0,        // spec ×2
});

function drawRedSprite(g, ent, _t) {
  const r = ent.r || 0.45;
  const supercharged = !!(ent.data && ent.data.tapped);

  if (supercharged) {
    g.fillStyle = 'rgba(255, 60, 130, 0.28)';
    g.beginPath();
    g.arc(0, 0, r * 1.32, 0, TAU);
    g.fill();
  }

  // Black tail feathers (left)
  g.fillStyle = '#171314';
  for (const [ang, len, wid] of [[-0.36, 1.38, 0.15], [0.02, 1.48, 0.17], [0.35, 1.32, 0.14]]) {
    g.save();
    g.rotate(ang);
    g.beginPath();
    g.moveTo(-r * 0.75, 0);
    g.lineTo(-r * len, -r * wid);
    g.lineTo(-r * len, r * wid);
    g.closePath();
    g.fill();
    g.restore();
  }

  // Top signature double red crest tuft
  g.fillStyle = '#d82228';
  g.strokeStyle = '#1a1112';
  g.lineWidth = r * 0.085;
  g.beginPath();
  g.ellipse(-r * 0.14, -r * 1.06, r * 0.22, r * 0.34, -0.35, 0, TAU);
  g.fill();
  g.stroke();
  g.beginPath();
  g.ellipse(r * 0.12, -r * 1.14, r * 0.20, r * 0.38, 0.22, 0, TAU);
  g.fill();
  g.stroke();

  // Main plump crimson body + warm tan belly patch
  g.save();
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fillStyle = '#df242a';
  g.fill();
  g.clip();

  // Shading crescent top-left & warm belly at bottom (+y is down)
  g.fillStyle = '#f2444a';
  g.beginPath();
  g.arc(-r * 0.22, -r * 0.28, r * 0.65, 0, TAU);
  g.fill();

  g.fillStyle = '#f3d7ba';
  g.beginPath();
  g.ellipse(r * 0.08, r * 0.82, r * 0.78, r * 0.52, 0, 0, TAU);
  g.fill();

  // Darker crimson spots on cheeks
  g.fillStyle = '#a3151b';
  g.beginPath();
  g.ellipse(-r * 0.36, r * 0.08, r * 0.13, r * 0.17, 0.2, 0, TAU);
  g.ellipse(-r * 0.14, r * 0.20, r * 0.09, r * 0.13, 0.1, 0, TAU);
  g.ellipse(-r * 0.54, r * 0.22, r * 0.08, r * 0.11, -0.1, 0, TAU);
  g.fill();
  g.restore();

  // Thick dark cartoon outline
  g.strokeStyle = '#1a1112';
  g.lineWidth = r * 0.09;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.stroke();

  // Eyes, heavy black V-brows, sharp orange beak
  drawCartoonEyes(g, r, { x1: 0.14, x2: 0.48, y: -0.08, rx: 0.20, ry: 0.22, pupil: 0.085 });
  drawAngryBrows(g, r, {
    color: '#110d0e', yOuter: -0.40, yInner: -0.17, xLeft: -0.14, xMid: 0.34, xRight: 0.76, thick: 0.16,
  });
  drawCartoonBeak(g, r, { x0: 0.38, tipX: 1.12, yMid: 0.16, topH: 0.22, botH: 0.18 });
}

const red = {
  id: 'red',
  name: '胖红',
  ability: '风火轮',
  desc: '12只迷你红鸟环绕旋转绞碎一切，点击后风火轮化作追踪流星雨双倍伤害',
  color: '#d8262c',
  radius: 0.45,
  density: 5,
  dmgMul: 1,

  onLaunch(ctx, bird) {
    const p = ctx.pos(bird);
    bird.data.orbitPhase = 0;
    bird.data.grindAcc = 0;
    bird.data.tapped = false;
    const ringFx = ctx.addEffect({
      type: 'red_ring',
      x: p.x,
      y: p.y,
      r: RED_TUNE.orbitRadius,
      phase: 0,
      count: RED_TUNE.orbitCount,
      tapped: false,
      ttl: 12.5,
    });
    bird.data.ringFx = ringFx;
    ctx.sfx('ring', { vol: 0.45 });
  },

  onStep(ctx, bird, dt) {
    const ringFx = bird.data.ringFx;
    if (!bird.alive) {
      if (ringFx) ringFx.ttl = Math.min(ringFx.ttl, ctx.time - ringFx.t0 + 0.15);
      return;
    }
    const p = ctx.pos(bird);
    bird.data.orbitPhase = (bird.data.orbitPhase || 0) + TAU * RED_TUNE.orbitRevPerSec * dt;
    if (ringFx) {
      ringFx.x = p.x;
      ringFx.y = p.y;
      ringFx.phase = bird.data.orbitPhase;
      ringFx.tapped = !!bird.data.tapped;
    }

    // Pre-tap 风火轮 grinding: every 0.1 s each of the 12 orbiters shreds touched blocks/pigs.
    if (!bird.data.tapped) {
      bird.data.grindAcc = (bird.data.grindAcc || 0) + dt;
      if (bird.data.grindAcc >= RED_TUNE.grindInterval) {
        bird.data.grindAcc -= RED_TUNE.grindInterval;
        const hitThisTick = new Set();
        let anyHit = false;
        for (let i = 0; i < RED_TUNE.orbitCount; i++) {
          const ang = bird.data.orbitPhase + (i * TAU) / RED_TUNE.orbitCount;
          const ox = p.x + Math.cos(ang) * RED_TUNE.orbitRadius;
          const oy = p.y + Math.sin(ang) * RED_TUNE.orbitRadius;
          const tx = -Math.sin(ang);
          const ty = Math.cos(ang);
          const touched = ctx.queryCircle(ox, oy, 0.38, (e) => !e.isStatic && (e.kind === KIND.BLOCK || e.kind === KIND.PIG));
          for (const e of touched) {
            if (hitThisTick.has(e.id)) continue;
            hitThisTick.add(e.id);
            ctx.damage(e, RED_TUNE.grindDmg, { x: ox, y: oy, cause: 'red_grind' });
            const rx = Math.cos(ang);
            const ry = Math.sin(ang);
            ctx.applyImpulse(
              e,
              (tx * 0.75 + rx * 0.55) * RED_TUNE.grindImpulse,
              (ty * 0.75 + ry * 0.55 + 0.25) * RED_TUNE.grindImpulse,
            );
            anyHit = true;
          }
          if (touched.length) {
            ctx.addEffect({ type: 'red_burst', x: ox, y: oy, r: 0.75, ttl: 0.24 });
          }
        }
        if (anyHit) {
          ctx.sfx('wood', { vol: 0.3, pitch: 1.25 });
          ctx.juice({ shake: 0.08 });
        }
      }
    }
  },

  onTap(ctx, bird, _target) {
    const p = ctx.pos(bird);
    const tapX = p.x;
    const tapY = p.y;
    const tapRect = ctx.actionRect();
    const v = ctx.vel(bird);
    bird.data.tapped = true;
    bird.dmgMul = RED_TUNE.selfDmgMul;
    if (bird.data.ringFx) {
      bird.data.ringFx.tapped = true;
      bird.data.ringFx.ttl = Math.min(bird.data.ringFx.ttl, (ctx.time - bird.data.ringFx.t0) + 1.4);
    }

    // Boost Red himself (+30% speed; if stalled after collision, launch toward primary local target)
    const curSpd = Math.hypot(v.x, v.y);
    const prim = pickPrimaryTarget(ctx, tapX, tapY, { rect: tapRect });
    if (curSpd >= 7) {
      ctx.setVelocity(bird, v.x * RED_TUNE.selfSpeedMul, v.y * RED_TUNE.selfSpeedMul);
    } else {
      const dx = prim.x - tapX;
      const dy = prim.y - tapY + 1.2;
      const d = Math.hypot(dx, dy) || 1;
      ctx.setVelocity(bird, (dx / d) * 17, (dy / d) * 17);
    }

    // Immediate VFX + audio + juice (0 ms latency)
    ctx.addEffect({ type: 'red_burst', x: tapX, y: tapY, r: 3.6, ttl: 0.6 });
    ctx.sfx('ring', { vol: 0.9, pitch: 1.15 });
    ctx.juice({ shake: 0.35, hitstop: 30, flash: { alpha: 0.20, color: '#ff4d94' } });
    emitBirdHit(ctx, 'red', tapX, tapY, 22);
    holdTurn(ctx, 2.4);

    // Spawn 12 homing mini-Reds from the orbiting 风火轮 ring (local reach from bird at tap time)
    const n = RED_TUNE.orbitCount;
    const targets = distributeTargets(ctx, tapX, tapY, n, { aheadOnly: false, rect: tapRect });
    const phase = bird.data.orbitPhase || 0;
    const trackers = [];

    for (let i = 0; i < n; i++) {
      const ang = phase + (i * TAU) / n;
      const ox = p.x + Math.cos(ang) * RED_TUNE.orbitRadius;
      const oy = Math.max(0.38, p.y + Math.sin(ang) * RED_TUNE.orbitRadius);
      const tgt = targets[i];

      // Alternate direct spears and sweeping high chakra arcs (matches video's curving pink ribbons!)
      const highArc = (i % 2 === 1);
      const baseAng = Math.atan2(tgt.y - oy, tgt.x - ox);
      const launchAng = highArc
        ? clamp(baseAng + 0.55 + ((i % 4 === 1) ? 0.22 : -0.12), -0.3, 1.35)
        : baseAng + ((i % 4 === 0) ? 0.18 : -0.18);
      const spd = RED_TUNE.homingSpeed;
      const vx = Math.cos(launchAng) * spd;
      const vy = Math.max(highArc ? 6.5 : -6.0, Math.sin(launchAng) * spd);

      const trail = ctx.addEffect({
        type: 'red_trail',
        x: ox,
        y: oy,
        pts: [{ x: ox, y: oy, t: ctx.time }],
        ttl: 2.3,
      });

      const clone = spawnBirdClone(ctx, 'red', {
        x: ox,
        y: oy,
        vx,
        vy,
        r: 0.26,
        dmgMul: RED_TUNE.cloneDmgMul,
        gravityScale: 0.14,
        ttl: 2.6,
        bullet: true,
        explode: {
          r: RED_TUNE.cloneBlastR,
          dmg: RED_TUNE.cloneBlastDmg,
          impulse: RED_TUNE.cloneBlastImpulse,
          power: 'small',
        },
        onHit: (ent) => {
          const cp = ctx.pos(ent);
          ctx.addEffect({ type: 'red_burst', x: cp.x, y: cp.y, r: 1.65, ttl: 0.45 });
          emitBirdHit(ctx, 'red', cp.x, cp.y, 18);
        },
      });

      trackers.push({
        clone,
        trail,
        target: tgt,
        steerDelay: highArc ? 0.18 + (i / n) * 0.16 : 0.03 + (i / n) * 0.06,
      });
    }

    // Also attach a blazing crimson streak behind Red himself
    const selfTrail = ctx.addEffect({
      type: 'red_trail',
      x: p.x,
      y: p.y,
      thick: 1.55,
      pts: [{ x: p.x, y: p.y, t: ctx.time }],
      ttl: 1.9,
    });

    ctx.addTask((dt, age) => {
      let anyAlive = false;
      const now = ctx.time;

      if (bird.alive && age < 1.35) {
        const bp = ctx.pos(bird);
        selfTrail.x = bp.x;
        selfTrail.y = bp.y;
        selfTrail.pts.push({ x: bp.x, y: bp.y, t: now });
        if (selfTrail.pts.length > 34) selfTrail.pts.shift();
      }

      for (let i = 0; i < trackers.length; i++) {
        const tr = trackers[i];
        const c = tr.clone;
        if (!c || !c.alive) continue;
        if (guardExplosiveProj(ctx, c, 0.04)) continue;

        anyAlive = true;
        const cp = ctx.pos(c);
        tr.trail.x = cp.x;
        tr.trail.y = cp.y;
        tr.trail.pts.push({ x: cp.x, y: cp.y, t: now });
        if (tr.trail.pts.length > 32) tr.trail.pts.shift();

        if (age >= tr.steerDelay && age <= RED_TUNE.homingDur + tr.steerDelay) {
          // Refresh target if assigned ent was already destroyed
          let tx = tr.target.x;
          let ty = tr.target.y;
          if (tr.target.ent && tr.target.ent.alive) {
            const ep = ctx.pos(tr.target.ent);
            tx = ep.x;
            ty = ep.y;
          } else if (tr.target.ent && !tr.target.ent.alive) {
            const fresh = ctx.findTargets({ x: tapX, y: tapY, kinds: [KIND.PIG], fallbackBlocks: true, max: 8 });
            if (fresh.length) {
              const pick = fresh[i % fresh.length];
              const fp = ctx.pos(pick);
              tr.target = { x: fp.x, y: fp.y, ent: pick };
              tx = fp.x;
              ty = fp.y;
            } else {
              tr.target = { x: tr.target.x, y: tr.target.y, ent: null };
            }
          }
          steerTowards(ctx, c, tx, ty, RED_TUNE.homingSteer, dt, RED_TUNE.homingSpeed);
        }
      }
      return anyAlive && age < 2.4;
    });
  },

  drawBird: drawRedSprite,

  projSkins: {
    'bird:red': drawRedSprite,
    red_mini: drawRedSprite,
  },

  effects: {
    /** Spinning 风火轮 around Red: 12 mini-Reds + additive pink/crimson/white chakra blades. */
    red_ring(g, e, t, cam) {
      const cx = cam.sx(e.x);
      const cy = cam.sy(e.y);
      const radPx = (e.r || 1.35) * cam.s;
      const phase = e.phase || 0;
      const rem = Math.max(0, e.ttl - (t - e.t0));
      const fade = clamp(rem / 0.25, 0, 1);

      g.save();
      g.translate(cx, cy);
      g.globalAlpha = fade;

      // Additive glowing pink-crimson wind-fire wheel rings
      g.save();
      g.globalCompositeOperation = 'lighter';
      const ringScale = e.tapped ? 0.62 : 1.0;
      const rr = radPx * ringScale;

      g.strokeStyle = 'rgba(255, 38, 120, 0.55)';
      g.lineWidth = Math.max(6, 0.34 * cam.s);
      g.beginPath();
      g.arc(0, 0, rr, 0, TAU);
      g.stroke();

      g.strokeStyle = 'rgba(255, 130, 195, 0.75)';
      g.lineWidth = Math.max(3, 0.16 * cam.s);
      g.beginPath();
      g.arc(0, 0, rr * 0.96, 0, TAU);
      g.stroke();

      // 8 curved fiery wind-blades spinning rapidly
      for (let i = 0; i < 8; i++) {
        const a0 = -phase * 1.25 + (i * TAU) / 8;
        g.strokeStyle = i % 2 === 0 ? 'rgba(255, 235, 245, 0.85)' : 'rgba(255, 70, 145, 0.85)';
        g.lineWidth = Math.max(2.5, 0.11 * cam.s);
        g.beginPath();
        g.arc(0, 0, rr * (1.03 + 0.06 * Math.sin(t * 18 + i)), a0, a0 + 0.52);
        g.stroke();
      }
      g.restore();

      // Draw the 12 orbiting mini-Red birds while untapped
      if (!e.tapped) {
        const n = e.count || 12;
        const miniEnt = { r: 0.24, data: {}, status: {}, skin: 'red' };
        for (let i = 0; i < n; i++) {
          const ang = phase + (i * TAU) / n;
          const ox = Math.cos(ang) * radPx;
          const oy = -Math.sin(ang) * radPx; // world y up -> screen y down
          g.save();
          g.translate(ox, oy);
          g.rotate(-ang + Math.PI * 0.5);
          g.scale(cam.s, cam.s);
          drawRedSprite(g, miniEnt, t);
          g.restore();
        }
      }
      g.restore();
    },

    /** Long glowing pink-magenta-white ribbon trail behind homing 风火轮 mini-Reds. */
    red_trail(g, e, t, cam) {
      const m = e.thick || 1.0;
      drawSmoothRibbon(g, cam, e.pts, t, 0.72, [
        { color: '255, 22, 115', alpha: 0.78, widthM: 0.48 * m, minPx: 4 },
        { color: '255, 115, 190', alpha: 0.88, widthM: 0.26 * m, minPx: 2.5 },
        { color: '255, 248, 252', alpha: 0.96, widthM: 0.11 * m, minPx: 1.4 },
      ]);
    },

    /** Pink-crimson starburst ring on 风火轮 release & homing hits. */
    red_burst(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const cx = cam.sx(e.x);
      const cy = cam.sy(e.y);
      const maxR = (e.r || 1.8) * cam.s;
      const curR = maxR * (0.25 + 0.85 * Math.pow(k, 0.65));
      const alpha = 1 - k;

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255, 55, 140, ${(alpha * 0.85).toFixed(3)})`;
      g.lineWidth = Math.max(2, (1 - k) * 0.28 * cam.s);
      g.beginPath();
      g.arc(cx, cy, curR, 0, TAU);
      g.stroke();

      g.strokeStyle = `rgba(255, 235, 250, ${(alpha * 0.9).toFixed(3)})`;
      g.lineWidth = Math.max(1.5, (1 - k) * 0.12 * cam.s);
      g.beginPath();
      g.arc(cx, cy, curR * 0.78, 0, TAU);
      g.stroke();

      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8 + hash01(e.t0 * 100 + i) * 0.5;
        const r0 = curR * 0.45;
        const r1 = curR * 1.18;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.stroke();
      }
      g.restore();
    },
  },
};

red.icon = makeHudIcon(red, 0.36, 0.48, 0.55);

export default red;
