// 蓝弟弟「流星分裂」 (owner: birds-a).
// Spec: docs/DESIGN.md §3 row 2 — Tap splits into an X of 13 clones; 0.20..0.98 s later each calls
// a sky Meteor 蓝弟弟 diving at 32 m/s with glowing cyan sky beams & explosive impacts.

import {
  TAU, clamp, holdTurn, spawnBirdClone, guardExplosiveProj,
  distributeTargets, pickPrimaryTarget, emitBirdHit, makeHudIcon,
  drawCartoonEyes, drawAngryBrows, drawCartoonBeak,
} from './a_helpers.js';

export const BLUES_TUNE = Object.freeze({
  splitCount: 13,          // X of 13 (two diagonals of 7 sharing center)
  splitSpacing: 0.55,      // spec 0.55 m
  cloneRadius: 0.28,       // spec 0.28 m
  cloneDmgMul: 1.8,        // spec ×1.5 (+20%)
  meteorCount: 13,         // 1 per clone
  meteorStart: 0.20,       // spec 0.25 s (-20%)
  meteorSpan: 0.78,        // staggered over 0.20..0.98 s (spec 0.2..1.0 s)
  meteorSpeed: 32,         // spec 30 m/s (+6.7%)
  meteorBlastR: 1.75,      // spec 1.4 m (+25%)
  meteorBlastDmg: 150,     // spec 120 (+25%)
  meteorBlastImpulse: 15,  // spec 12 (+25%)
});

function drawBluesSprite(g, ent, _t) {
  const r = ent.r || 0.30;

  // Tail tuft (left)
  g.fillStyle = '#2668b8';
  g.strokeStyle = '#102038';
  g.lineWidth = r * 0.09;
  for (const ang of [-0.28, 0.24]) {
    g.save();
    g.rotate(ang);
    g.beginPath();
    g.ellipse(-r * 1.05, 0, r * 0.28, r * 0.13, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.restore();
  }

  // Top head crest feathers
  g.fillStyle = '#4da6ff';
  g.beginPath();
  g.ellipse(-r * 0.18, -r * 1.02, r * 0.24, r * 0.15, -0.55, 0, TAU);
  g.fill();
  g.stroke();
  g.beginPath();
  g.ellipse(r * 0.04, -r * 1.08, r * 0.20, r * 0.14, -0.25, 0, TAU);
  g.fill();
  g.stroke();

  // Round sky-blue body + pale ice-blue belly
  g.save();
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fillStyle = '#4aa3f5';
  g.fill();
  g.clip();

  g.fillStyle = '#7cc4ff';
  g.beginPath();
  g.arc(-r * 0.22, -r * 0.28, r * 0.62, 0, TAU);
  g.fill();

  g.fillStyle = '#cbeaff';
  g.beginPath();
  g.ellipse(r * 0.10, r * 0.80, r * 0.72, r * 0.48, 0, 0, TAU);
  g.fill();
  g.restore();

  // Crisp dark cartoon outline
  g.strokeStyle = '#102038';
  g.lineWidth = r * 0.10;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.stroke();

  // Signature orange-red eye rings + big peppy eyes + snappy orange beak
  drawCartoonEyes(g, r, {
    x1: 0.15, x2: 0.49, y: -0.06, rx: 0.21, ry: 0.23, pupil: 0.095, bagColor: '#d9532f',
  });
  drawAngryBrows(g, r, {
    color: '#163560', yOuter: -0.38, yInner: -0.20, xLeft: -0.06, xMid: 0.34, xRight: 0.72, thick: 0.12,
  });
  drawCartoonBeak(g, r, { x0: 0.42, tipX: 1.12, yMid: 0.16, topH: 0.20, botH: 0.16 });
}

function drawMeteorBlues(g, ent, t) {
  const r = ent.r || 0.31;
  // Blazing cyan comet sheath around the diving 蓝弟弟 (no shadowBlur for perf)
  g.save();
  g.fillStyle = 'rgba(0, 225, 255, 0.34)';
  g.beginPath();
  g.ellipse(-r * 0.55, 0, r * 2.1, r * 1.38, 0, 0, TAU);
  g.fill();

  g.fillStyle = 'rgba(200, 252, 255, 0.68)';
  g.beginPath();
  g.arc(r * 0.1, 0, r * 1.22, 0, TAU);
  g.fill();
  g.restore();

  drawBluesSprite(g, ent, t);
}

const blues = {
  id: 'blues',
  name: '蓝弟弟',
  ability: '流星分裂',
  desc: '瞬间分裂成13只X阵，随后每只分身从天召唤一颗流星蓝弟弟轰炸全场',
  color: '#4aa3f5',
  radius: 0.30,
  density: 5,
  dmgMul: 1,

  onLaunch(_ctx, _bird) {},

  onStep(_ctx, _bird, _dt) {},

  onTap(ctx, bird, target) {
    const p = ctx.pos(bird);
    let v = ctx.vel(bird);
    if (Math.hypot(v.x, v.y) < 7) {
      const prim = pickPrimaryTarget(ctx, p.x, p.y, target);
      const dx = prim.x - p.x;
      const dy = prim.y - p.y + 2.0;
      const d = Math.hypot(dx, dy) || 1;
      v = { x: (dx / d) * 16, y: (dy / d) * 16 };
      ctx.setVelocity(bird, v.x, v.y);
    }

    // Center of the X is the parent bird itself
    bird.dmgMul = BLUES_TUNE.cloneDmgMul;

    const diag = BLUES_TUNE.splitSpacing / Math.SQRT2;
    const splitPoints = [{ x: p.x, y: p.y }];

    // Spawn the other 12 clones along both diagonals of 7: k in {-3,-2,-1,1,2,3}, signY in {+1,-1}
    for (const k of [-3, -2, -1, 1, 2, 3]) {
      for (const sy of [1, -1]) {
        const ox = p.x + k * diag;
        const oy = Math.max(0.36, p.y + k * sy * diag);
        const cvx = v.x + k * 0.85;
        const cvy = v.y + k * sy * 0.95;
        spawnBirdClone(ctx, 'blues', {
          x: ox,
          y: oy,
          vx: cvx,
          vy: cvy,
          r: BLUES_TUNE.cloneRadius,
          dmgMul: BLUES_TUNE.cloneDmgMul,
          restitution: 0.36,
          ttl: 4.5,
          bullet: true,
        });
        splitPoints.push({ x: ox, y: oy });
      }
    }

    // Immediate VFX + SFX + juice on tap (0 ms latency)
    ctx.addEffect({
      type: 'blues_split',
      x: p.x,
      y: p.y,
      pts: splitPoints,
      span: 3 * BLUES_TUNE.splitSpacing,
      ttl: 0.55,
    });
    ctx.sfx('poof', { vol: 0.85, pitch: 1.2 });
    ctx.juice({ shake: 0.25, hitstop: 25, flash: { alpha: 0.16, color: '#7beeff' } });
    emitBirdHit(ctx, 'blues', p.x, p.y, 18);

    holdTurn(ctx, 2.5);

    // Track active meteors for comet tails + ground-skim safety
    const liveMeteors = [];
    ctx.addTask((_dt, age) => {
      const now = ctx.time;
      for (let i = liveMeteors.length - 1; i >= 0; i--) {
        const m = liveMeteors[i];
        if (!m.ent || !m.ent.alive) {
          liveMeteors.splice(i, 1);
          continue;
        }
        if (guardExplosiveProj(ctx, m.ent, 0.05)) {
          liveMeteors.splice(i, 1);
          continue;
        }
        const mp = ctx.pos(m.ent);
        m.trail.x = mp.x;
        m.trail.y = mp.y;
        m.trail.pts.push({ x: mp.x, y: mp.y, t: now });
        if (m.trail.pts.length > 22) m.trail.pts.shift();
      }
      return age < 2.4 || liveMeteors.length > 0;
    });

    // Stagger 13 sky meteors over 0.20 .. 0.98 s
    const nMet = BLUES_TUNE.meteorCount;
    for (let i = 0; i < nMet; i++) {
      const delay = BLUES_TUNE.meteorStart + (i / Math.max(1, nMet - 1)) * BLUES_TUNE.meteorSpan;
      ctx.after(delay, () => {
        const rect = ctx.actionRect();
        // Re-evaluate live targets at each meteor call so late meteors hunt survivors!
        const curTargets = distributeTargets(ctx, p.x, p.y, nMet, {
          aheadOnly: false,
          explicitTarget: i === 0 ? target : null,
        });
        const tgt = curTargets[i % curTargets.length];

        const slantX = ctx.range(-5.2, -1.6);
        const sx = tgt.x + slantX;
        const sy = rect.y1 + 2.2 + (i % 3) * 1.1;
        const dx = tgt.x - sx;
        const dy = tgt.y - sy;
        const dist = Math.hypot(dx, dy) || 1;
        const vx = (dx / dist) * BLUES_TUNE.meteorSpeed;
        const vy = (dy / dist) * BLUES_TUNE.meteorSpeed;
        const angle = Math.atan2(vy, vx);

        // Sky-piercing cyan meteor light beam (video signature!)
        ctx.addEffect({
          type: 'blues_beam',
          x: tgt.x,
          y: tgt.y,
          sx,
          sy,
          tx: tgt.x,
          ty: Math.max(0, tgt.y - 0.3),
          ttl: 0.65,
        });

        const trail = ctx.addEffect({
          type: 'blues_trail',
          x: sx,
          y: sy,
          pts: [{ x: sx, y: sy, t: ctx.time }],
          ttl: 1.6,
        });

        const meteor = ctx.spawnProjectile({
          x: sx,
          y: sy,
          vx,
          vy,
          angle,
          r: 0.31,
          skin: 'blues_meteor',
          owner: 'blues',
          dmgMul: BLUES_TUNE.cloneDmgMul,
          gravityScale: 0,
          ttl: 2.2,
          bullet: true,
          explode: {
            r: BLUES_TUNE.meteorBlastR,
            dmg: BLUES_TUNE.meteorBlastDmg,
            impulse: BLUES_TUNE.meteorBlastImpulse,
            power: 'normal',
          },
          onHit: (ent) => {
            const mp = ctx.pos(ent);
            ctx.addEffect({ type: 'blues_impact', x: mp.x, y: mp.y, r: 2.1, ttl: 0.45 });
            emitBirdHit(ctx, 'blues', mp.x, mp.y, 24);
          },
        });

        liveMeteors.push({ ent: meteor, trail });
        ctx.sfx('meteor', { vol: 0.55, pitch: 0.92 + (i % 5) * 0.06 });
      });
    }
  },

  drawBird: drawBluesSprite,

  projSkins: {
    'bird:blues': drawBluesSprite,
    blues_clone: drawBluesSprite,
    blues_meteor: drawMeteorBlues,
  },

  effects: {
    /** Crisp cyan X-flash + 13 clone poof rings on split. */
    blues_split(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const alpha = 1 - k;
      const cx = cam.sx(e.x);
      const cy = cam.sy(e.y);
      const arm = (e.span || 1.8) * cam.s * (0.7 + 0.45 * k);

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      for (const [dx, dy] of [[1, 1], [1, -1]]) {
        const inv = 1 / Math.SQRT2;
        g.strokeStyle = `rgba(60, 220, 255, ${(alpha * 0.75).toFixed(3)})`;
        g.lineWidth = Math.max(4, 0.36 * cam.s * (1 - k));
        g.beginPath();
        g.moveTo(cx - dx * inv * arm, cy - dy * inv * arm);
        g.lineTo(cx + dx * inv * arm, cy + dy * inv * arm);
        g.stroke();

        g.strokeStyle = `rgba(235, 253, 255, ${(alpha * 0.9).toFixed(3)})`;
        g.lineWidth = Math.max(1.5, 0.13 * cam.s * (1 - k));
        g.beginPath();
        g.moveTo(cx - dx * inv * arm, cy - dy * inv * arm);
        g.lineTo(cx + dx * inv * arm, cy + dy * inv * arm);
        g.stroke();
      }

      if (e.pts) {
        g.strokeStyle = `rgba(155, 240, 255, ${(alpha * 0.8).toFixed(3)})`;
        g.lineWidth = Math.max(1.8, 0.08 * cam.s);
        for (const pt of e.pts) {
          g.beginPath();
          g.arc(cam.sx(pt.x), cam.sy(pt.y), (0.22 + 0.36 * k) * cam.s, 0, TAU);
          g.stroke();
        }
      }
      g.restore();
    },

    /** Sky-to-ground glowing cyan meteor beam (matches blue.jpg & bomb_b.jpg). */
    blues_beam(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const fade = k < 0.18 ? k / 0.18 : 1 - (k - 0.18) / 0.82;
      const x0 = cam.sx(e.sx), y0 = cam.sy(e.sy);
      const x1 = cam.sx(e.tx), y1 = cam.sy(e.ty);

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';

      // Wide cyan atmospheric shaft
      g.strokeStyle = `rgba(0, 195, 255, ${(0.34 * fade).toFixed(3)})`;
      g.lineWidth = Math.max(8, 1.05 * cam.s * (0.65 + 0.35 * fade));
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();

      // Bright electric cyan core beam
      g.strokeStyle = `rgba(110, 242, 255, ${(0.68 * fade).toFixed(3)})`;
      g.lineWidth = Math.max(3.5, 0.42 * cam.s * fade);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();

      // White-hot inner thread
      g.strokeStyle = `rgba(240, 255, 255, ${(0.9 * fade).toFixed(3)})`;
      g.lineWidth = Math.max(1.5, 0.14 * cam.s * fade);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();

      // Target lock ring on structure/ground
      g.strokeStyle = `rgba(120, 245, 255, ${(0.75 * fade).toFixed(3)})`;
      g.lineWidth = Math.max(2, 0.09 * cam.s);
      g.beginPath();
      g.ellipse(x1, y1, 0.9 * cam.s * (0.6 + 0.5 * k), 0.35 * cam.s * (0.6 + 0.5 * k), 0, 0, TAU);
      g.stroke();
      g.restore();
    },

    /** Glowing cyan-white comet wake behind each diving meteor. */
    blues_trail(g, e, t, cam) {
      const pts = e.pts;
      if (!pts || pts.length < 2) return;
      const win = 0.42;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const a = clamp(1 - (t - p1.t) / win, 0, 1);
        if (a <= 0.02) continue;
        const x0 = cam.sx(p0.x), y0 = cam.sy(p0.y);
        const x1 = cam.sx(p1.x), y1 = cam.sy(p1.y);
        g.strokeStyle = `rgba(20, 220, 255, ${(0.68 * a).toFixed(3)})`;
        g.lineWidth = Math.max(3, 0.58 * cam.s * a);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();

        g.strokeStyle = `rgba(240, 255, 255, ${(0.92 * a).toFixed(3)})`;
        g.lineWidth = Math.max(1.4, 0.22 * cam.s * a);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      g.restore();
    },

    /** Cyan shock-ring + star flare when a meteor detonates. */
    blues_impact(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const alpha = 1 - k;
      const cx = cam.sx(e.x), cy = cam.sy(e.y);
      const rr = (e.r || 2.0) * cam.s * (0.28 + 0.82 * Math.pow(k, 0.6));

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(60, 235, 255, ${(0.9 * alpha).toFixed(3)})`;
      g.lineWidth = Math.max(2.5, 0.25 * cam.s * alpha);
      g.beginPath();
      g.arc(cx, cy, rr, 0, TAU);
      g.stroke();

      g.fillStyle = `rgba(220, 252, 255, ${(0.65 * alpha).toFixed(3)})`;
      g.beginPath();
      g.arc(cx, cy, rr * 0.45 * alpha, 0, TAU);
      g.fill();
      g.restore();
    },
  },
};

blues.icon = makeHudIcon(blues, 0.36, 0.48, 0.54);

export default blues;
