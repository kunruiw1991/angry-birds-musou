// 白公主「投蛋射击」 (owner: birds-a).
// Spec: docs/DESIGN.md §3 row 5 — Tap: 4 s hover mode (gravity off, drift 2 m/s forward, rise >= 6 m),
// fires 40 exploding eggs (every 0.1 s, 28 m/s, gravityScale 0.3) at held pointer or auto-aimed pigs/blocks.

import {
  TAU, clamp, holdTurn, setGravityScale, guardExplosiveProj,
  distributeTargets, emitBirdHit, makeHudIcon,
  drawCartoonEyes, drawAngryBrows, drawCartoonBeak,
} from './a_helpers.js';

export const MATILDA_TUNE = Object.freeze({
  shootDur: 4.0,          // spec 4.0 s (0%)
  driftVx: 2.0,           // spec 2 m/s (0%)
  minHoverY: 6.5,         // spec >= 6 m (+8.3%)
  eggInterval: 0.075,     // spec 0.1 s (-25%)
  eggMaxCount: 50,        // spec 40 (+25%)
  eggSpeed: 28,           // spec 26 m/s (+7.7%)
  eggGravityScale: 0.30,  // spec 0.3 (0%)
  eggBlastR: 1.50,        // spec 1.2 m (+25%)
  eggBlastDmg: 112,       // spec 90 (+24.4%)
  eggBlastImpulse: 11.5,  // spec 9 (+27.8%)
  retargetEvery: 4,       // spec every 5 eggs (-20%)
});

function buildEggBodyPath(g, r) {
  // Classic pear/egg silhouette (+y is down: narrower top, fuller bottom)
  g.beginPath();
  g.moveTo(0, -r * 1.08);
  g.bezierCurveTo(r * 0.68, -r * 1.04, r * 1.08, -r * 0.25, r * 1.02, r * 0.38);
  g.bezierCurveTo(r * 0.96, r * 0.92, r * 0.52, r * 1.08, 0, r * 1.08);
  g.bezierCurveTo(-r * 0.54, r * 1.08, -r * 0.98, r * 0.90, -r * 1.02, r * 0.36);
  g.bezierCurveTo(-r * 1.06, -r * 0.26, -r * 0.66, -r * 1.04, 0, -r * 1.08);
  g.closePath();
}

function drawMatildaSprite(g, ent, _t) {
  const r = ent.r || 0.50;
  const shooting = !!(ent.data && ent.data.shooting);

  // Tail feathers (left)
  g.fillStyle = '#232020';
  for (const [ang, len] of [[-0.25, 1.32], [0.05, 1.38], [0.32, 1.26]]) {
    g.save();
    g.rotate(ang);
    g.beginPath();
    g.ellipse(-r * len * 0.82, 0, r * 0.28, r * 0.11, 0, 0, TAU);
    g.fill();
    g.restore();
  }

  // Three wispy top crest plumes
  g.fillStyle = shooting ? '#e85b56' : '#efede6';
  g.strokeStyle = '#1f1a18';
  g.lineWidth = r * 0.08;
  for (const [ox, oy, rot] of [[-0.14, -1.16, -0.35], [0.02, -1.24, 0.02], [0.18, -1.14, 0.38]]) {
    g.save();
    g.translate(r * ox, r * oy);
    g.rotate(rot);
    g.beginPath();
    g.ellipse(0, 0, r * 0.11, r * 0.24, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.restore();
  }

  // Egg-shaped body (white normally; flushes angry coral-salmon in turret mode like white.jpg!)
  g.save();
  buildEggBodyPath(g, r);
  g.fillStyle = shooting ? '#ee6a64' : '#f7f5ef';
  g.fill();
  g.clip();

  // Soft highlight & warm cream belly
  g.fillStyle = shooting ? '#ff9994' : '#ffffff';
  g.beginPath();
  g.ellipse(-r * 0.25, -r * 0.35, r * 0.45, r * 0.55, 0.2, 0, TAU);
  g.fill();

  g.fillStyle = shooting ? '#ffd6c9' : '#efe3c6';
  g.beginPath();
  g.ellipse(r * 0.06, r * 0.78, r * 0.76, r * 0.50, 0, 0, TAU);
  g.fill();

  // Rosy pink cheek blush
  g.fillStyle = shooting ? 'rgba(255, 225, 120, 0.55)' : 'rgba(244, 138, 156, 0.65)';
  g.beginPath();
  g.ellipse(-r * 0.12, r * 0.18, r * 0.19, r * 0.14, 0, 0, TAU);
  g.ellipse(r * 0.62, r * 0.16, r * 0.15, r * 0.12, 0, 0, TAU);
  g.fill();
  g.restore();

  // Crisp dark cartoon outline
  buildEggBodyPath(g, r);
  g.strokeStyle = '#1f1a18';
  g.lineWidth = r * 0.088;
  g.stroke();

  // Expressive eyes, dark brows/lashes, plump orange beak
  drawCartoonEyes(g, r, { x1: 0.12, x2: 0.46, y: -0.10, rx: 0.19, ry: 0.22, pupil: 0.085 });
  drawAngryBrows(g, r, {
    color: '#241c1a',
    yOuter: shooting ? -0.40 : -0.35,
    yInner: -0.18,
    xLeft: -0.10,
    xMid: 0.31,
    xRight: 0.70,
    thick: 0.12,
  });
  drawCartoonBeak(g, r, { x0: 0.36, tipX: 1.08, yMid: 0.16, topH: 0.24, botH: 0.20 });
}

function drawExplosiveEgg(g, ent, _t) {
  const r = ent.r || 0.28;
  // Soft warm glow ring
  g.fillStyle = 'rgba(255, 235, 165, 0.38)';
  g.beginPath();
  g.ellipse(0, 0, r * 1.55, r * 1.25, 0, 0, TAU);
  g.fill();

  // Glossy white oval egg shell
  g.fillStyle = '#fffdf7';
  g.strokeStyle = '#1e1915';
  g.lineWidth = r * 0.14;
  g.beginPath();
  g.ellipse(0, 0, r * 1.18, r * 0.90, 0, 0, TAU);
  g.fill();
  g.stroke();

  // Cream bottom shading + bright specular highlight
  g.fillStyle = '#f2e0b6';
  g.beginPath();
  g.ellipse(-r * 0.18, r * 0.25, r * 0.75, r * 0.42, 0.15, 0, TAU);
  g.fill();

  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(r * 0.30, -r * 0.30, r * 0.34, r * 0.18, -0.3, 0, TAU);
  g.fill();
}

const matilda = {
  id: 'matilda',
  name: '白公主',
  ability: '投蛋射击',
  desc: '悬停空中4秒化身炮台，朝按住方向或自动索敌连射40颗高爆白蛋',
  color: '#f4f4f4',
  radius: 0.50,
  density: 5,
  dmgMul: 1,

  onLaunch(_ctx, _bird) {},

  onStep(_ctx, _bird, _dt) {},

  onTap(ctx, bird, target) {
    const p0 = ctx.pos(bird);
    bird.data.shooting = true;
    setGravityScale(ctx, bird, 0);
    bird.body.setAngularVelocity(0);
    bird.body.setAngle(0);

    const auraFx = ctx.addEffect({
      type: 'matilda_aura',
      x: p0.x,
      y: p0.y,
      tx: target ? target.x : p0.x + 12,
      ty: target ? target.y : 2.0,
      ttl: MATILDA_TUNE.shootDur + 0.2,
    });

    ctx.juice({ shake: 0.22, hitstop: 22, flash: { alpha: 0.15, color: '#fff3e0' } });
    ctx.sfx('egg', { vol: 0.85, pitch: 1.05 });
    emitBirdHit(ctx, 'matilda', p0.x, p0.y, 18);

    holdTurn(ctx, MATILDA_TUNE.shootDur + 1.6);

    const liveEggs = [];
    let eggsFired = 0;
    let nextFireAge = 0; // Fire egg #0 immediately at age = 0 (0 ms latency!)
    let curAutoTarget = null;
    let retargetCycle = 0;

    const pickAimPoint = (bx, by) => {
      // 1. Live held pointer has top priority
      if (ctx.pointer && ctx.pointer.down && Number.isFinite(ctx.pointer.x) && Number.isFinite(ctx.pointer.y)) {
        return { x: ctx.pointer.x, y: Math.max(0.3, ctx.pointer.y) };
      }
      // 2. Explicit tap target for the first burst of 5 eggs
      if (eggsFired < MATILDA_TUNE.retargetEvery && target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
        return { x: target.x, y: Math.max(0.4, target.y) };
      }
      // 3. Auto-aim nearest pigs / surviving blocks, retargeting every 5 eggs or when current target dies
      const needRetarget = !curAutoTarget
        || (eggsFired % MATILDA_TUNE.retargetEvery === 0)
        || (curAutoTarget.ent && !curAutoTarget.ent.alive);
      if (needRetarget) {
        const list = distributeTargets(ctx, bx, by, 10, { aheadOnly: false });
        curAutoTarget = list[retargetCycle % list.length];
        retargetCycle++;
      }
      if (curAutoTarget && curAutoTarget.ent && curAutoTarget.ent.alive) {
        const ep = ctx.pos(curAutoTarget.ent);
        return { x: ep.x, y: ep.y };
      }
      return curAutoTarget ? { x: curAutoTarget.x, y: curAutoTarget.y } : { x: bx + 14, y: 2.0 };
    };

    const fireOneEgg = () => {
      if (!bird.alive) return;
      const bp = ctx.pos(bird);
      const aim = pickAimPoint(bp.x, bp.y);
      auraFx.tx = aim.x;
      auraFx.ty = aim.y;

      const dx = aim.x - bp.x;
      const rawDy = aim.y - bp.y;
      const dist = Math.hypot(dx, rawDy) || 1;
      const flightT = dist / MATILDA_TUNE.eggSpeed;
      // Compensate for egg gravityScale (0.3 * 10 = 3.0 m/s^2) so stream hits pinpoint!
      const gEff = 10 * MATILDA_TUNE.eggGravityScale;
      const compDy = rawDy + 0.5 * gEff * flightT * flightT;
      const baseAng = Math.atan2(compDy, dx) + ctx.range(-0.032, 0.032);

      const vx = Math.cos(baseAng) * MATILDA_TUNE.eggSpeed;
      const vy = Math.sin(baseAng) * MATILDA_TUNE.eggSpeed;
      const sx = bp.x + Math.cos(baseAng) * (bird.r + 0.34);
      const sy = Math.max(0.45, bp.y + Math.sin(baseAng) * (bird.r + 0.34));

      ctx.addEffect({
        type: 'matilda_muzzle',
        x: sx,
        y: sy,
        angle: baseAng,
        ttl: 0.22,
      });

      const trail = ctx.addEffect({
        type: 'matilda_trail',
        x: sx,
        y: sy,
        pts: [{ x: sx, y: sy, t: ctx.time }],
        ttl: 1.4,
      });

      const egg = ctx.spawnProjectile({
        x: sx,
        y: sy,
        vx,
        vy,
        angle: baseAng,
        r: 0.28,
        skin: 'matilda_egg',
        owner: 'matilda',
        density: 2.8,
        gravityScale: MATILDA_TUNE.eggGravityScale,
        ttl: 3.2,
        bullet: true,
        explode: {
          r: MATILDA_TUNE.eggBlastR,
          dmg: MATILDA_TUNE.eggBlastDmg,
          impulse: MATILDA_TUNE.eggBlastImpulse,
          power: 'normal',
        },
        onHit: (ent) => {
          const ep = ctx.pos(ent);
          ctx.addEffect({ type: 'matilda_egg_pop', x: ep.x, y: ep.y, r: MATILDA_TUNE.eggBlastR, ttl: 0.36 });
        },
      });

      liveEggs.push({ egg, trail });
      eggsFired++;
      ctx.sfx('egg', { vol: 0.42, pitch: 0.95 + (eggsFired % 6) * 0.04 });
    };

    // Fire Egg #0 immediately so VFX + projectile exist at t = 0 ms!
    fireOneEgg();
    nextFireAge = MATILDA_TUNE.eggInterval;

    // Hover & rapid-fire loop for 4.0 s, plus egg trail updates until all eggs detonate
    ctx.addTask((_dt, age) => {
      const now = ctx.time;

      if (bird.alive && age < MATILDA_TUNE.shootDur) {
        const bp = ctx.pos(bird);
        const rect = ctx.actionRect();
        // Drift 2 m/s forward (gently braking near right structure edge) & rise smoothly to >= 6.5 m
        const driftVx = bp.x > rect.x1 - 6 ? 0.4 : MATILDA_TUNE.driftVx;
        const hoverVy = bp.y < MATILDA_TUNE.minHoverY
          ? clamp((MATILDA_TUNE.minHoverY + 0.6 - bp.y) * 3.4, 1.8, 7.5)
          : Math.sin(age * 6) * 0.45;
        ctx.setVelocity(bird, driftVx, hoverVy);
        bird.body.setAngularVelocity(0);
        bird.body.setAngle(0);

        auraFx.x = bp.x;
        auraFx.y = bp.y;
        if (ctx.pointer && ctx.pointer.down) {
          auraFx.tx = ctx.pointer.x;
          auraFx.ty = ctx.pointer.y;
        }

        while (eggsFired < MATILDA_TUNE.eggMaxCount && age >= nextFireAge) {
          fireOneEgg();
          nextFireAge += MATILDA_TUNE.eggInterval;
        }
      } else if (bird.alive && bird.data.shooting) {
        // End of 4 s shooting mode -> restore normal gravity!
        bird.data.shooting = false;
        setGravityScale(ctx, bird, 1);
      }

      // Update live egg trails & ground-skim detonation check
      for (let i = liveEggs.length - 1; i >= 0; i--) {
        const item = liveEggs[i];
        if (!item.egg || !item.egg.alive) {
          liveEggs.splice(i, 1);
          continue;
        }
        if (guardExplosiveProj(ctx, item.egg, 0.04)) {
          liveEggs.splice(i, 1);
          continue;
        }
        const ep = ctx.pos(item.egg);
        const ev = ctx.vel(item.egg);
        item.egg.body.setAngle(Math.atan2(ev.y, ev.x));
        item.trail.x = ep.x;
        item.trail.y = ep.y;
        item.trail.pts.push({ x: ep.x, y: ep.y, t: now });
        if (item.trail.pts.length > 16) item.trail.pts.shift();
      }

      return age < MATILDA_TUNE.shootDur || liveEggs.length > 0;
    });
  },

  drawBird: drawMatildaSprite,

  projSkins: {
    'bird:matilda': drawMatildaSprite,
    matilda_egg: drawExplosiveEgg,
  },

  effects: {
    /** Hovering turret halo + aiming sightline + reticle for Matilda. */
    matilda_aura(g, e, t, cam) {
      const rem = Math.max(0, e.ttl - (t - e.t0));
      const fade = clamp(rem / 0.25, 0, 1);
      const cx = cam.sx(e.x), cy = cam.sy(e.y);
      const tx = cam.sx(e.tx), ty = cam.sy(e.ty);

      g.save();
      g.globalCompositeOperation = 'lighter';

      // Spinning golden-rose turret ring around Matilda
      const rr = (0.92 + 0.08 * Math.sin(t * 20)) * cam.s;
      g.strokeStyle = `rgba(255, 150, 140, ${(0.72 * fade).toFixed(3)})`;
      g.lineWidth = Math.max(2.5, 0.11 * cam.s);
      g.beginPath();
      g.arc(cx, cy, rr, 0, TAU);
      g.stroke();

      // Hover lift wind arcs underneath
      g.strokeStyle = `rgba(255, 245, 210, ${(0.65 * fade).toFixed(3)})`;
      g.lineWidth = Math.max(2, 0.08 * cam.s);
      const waveY = cy + (0.68 + ((t * 4) % 0.5)) * cam.s;
      g.beginPath();
      g.ellipse(cx, waveY, 0.85 * cam.s, 0.20 * cam.s, 0, 0, TAU);
      g.stroke();

      // Dotted aiming laser + target crosshair
      g.setLineDash([8, 8]);
      g.strokeStyle = `rgba(255, 230, 120, ${(0.45 * fade).toFixed(3)})`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(tx, ty);
      g.stroke();
      g.setLineDash([]);

      g.strokeStyle = `rgba(255, 95, 95, ${(0.78 * fade).toFixed(3)})`;
      g.lineWidth = 2.5;
      const cr = 0.55 * cam.s;
      g.beginPath();
      g.arc(tx, ty, cr, 0, TAU);
      g.moveTo(tx - cr * 1.35, ty);
      g.lineTo(tx + cr * 1.35, ty);
      g.moveTo(tx, ty - cr * 1.35);
      g.lineTo(tx, ty + cr * 1.35);
      g.stroke();
      g.restore();
    },

    /** Crisp white-gold muzzle flash ring on each egg shot. */
    matilda_muzzle(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const a = 1 - k;
      const cx = cam.sx(e.x), cy = cam.sy(e.y);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255, 245, 190, ${(0.85 * a).toFixed(3)})`;
      g.beginPath();
      g.arc(cx, cy, (0.25 + 0.45 * k) * cam.s, 0, TAU);
      g.fill();
      g.restore();
    },

    /** Bright pearl-gold streak trailing each fired explosive egg. */
    matilda_trail(g, e, t, cam) {
      const pts = e.pts;
      if (!pts || pts.length < 2) return;
      const win = 0.38;
      g.save();
      g.lineCap = 'round';
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const a = clamp(1 - (t - p1.t) / win, 0, 1);
        if (a <= 0.02) continue;
        const x0 = cam.sx(p0.x), y0 = cam.sy(p0.y);
        const x1 = cam.sx(p1.x), y1 = cam.sy(p1.y);
        g.strokeStyle = `rgba(255, 165, 25, ${(0.60 * a).toFixed(3)})`;
        g.lineWidth = Math.max(4, 0.46 * cam.s * a);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();

        g.strokeStyle = `rgba(255, 253, 240, ${(0.95 * a).toFixed(3)})`;
        g.lineWidth = Math.max(2, 0.21 * cam.s * a);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      g.restore();
    },

    /** Golden-white yolk shockwave burst on egg detonation. */
    matilda_egg_pop(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const a = 1 - k;
      const cx = cam.sx(e.x), cy = cam.sy(e.y);
      const rr = (e.r || 1.5) * cam.s * (0.3 + 0.85 * Math.pow(k, 0.6));
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255, 225, 95, ${(0.88 * a).toFixed(3)})`;
      g.lineWidth = Math.max(2.5, 0.22 * cam.s * a);
      g.beginPath();
      g.arc(cx, cy, rr, 0, TAU);
      g.stroke();
      g.restore();
    },
  },
};

matilda.icon = makeHudIcon(matilda, 0.33, 0.48, 0.56);

export default matilda;
