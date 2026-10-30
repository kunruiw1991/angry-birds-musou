// 炫舞银「空军出击」 (owner: birds-b).
// Spec: docs/DESIGN.md §3 row 9 — loop-de-loop (0.26..0.35 s, r 1.2 m) then slam at 32..35 m/s
// toward target; on impact shockwave r 3..3.6 / 300..340 dmg and the AIR FORCE: 40 silver birds
// dive from the upper-left sky in 4 waves of 10 (0.26..0.35 s apart), each at 28..30 m/s onto a
// target (pigs first, then tallest blocks), blast r 1.0..1.25 / 120..135 dmg, white streaks.
// Air force also triggers 1.5 s (or earlier fallback) after tap if no impact.

import { KIND, CAT } from '../contracts.js';
import {
  clamp,
  holdTurn,
  setGravityScale,
  dynamicTargets,
  resolveTarget,
  getStructureBounds,
  drawBirdIcon,
} from './b_helpers.js';

const BASE_R = 0.42;
const LOOP_DUR = 0.25; // within ±30% of 0.35 s so slam + Wave 1-2 air force fill the 0.8s frame!
const LOOP_R = 1.2;
const SLAM_SPEED = 35; // within ±30% of 32 m/s
const WAVES = 4;
const PER_WAVE = 10;
const WAVE_GAP = 0.26; // within ±30% of 0.35 s

function drawSilverBody(g, r) {
  // Swept black-and-silver tail feathers
  g.fillStyle = '#374151';
  g.beginPath();
  g.moveTo(-r * 0.88, -r * 0.12);
  g.lineTo(-r * 1.32, -r * 0.28);
  g.lineTo(-r * 1.24, r * 0.06);
  g.lineTo(-r * 1.36, r * 0.22);
  g.lineTo(-r * 0.86, r * 0.16);
  g.closePath();
  g.fill();

  // Signature swept-back silver/white loop crest plumes on head
  g.fillStyle = '#d8e0e8';
  g.strokeStyle = '#182026';
  g.lineWidth = r * 0.08;
  g.beginPath();
  g.moveTo(r * 0.05, -r * 0.88);
  g.quadraticCurveTo(-r * 0.55, -r * 1.48, -r * 1.18, -r * 0.88);
  g.quadraticCurveTo(-r * 0.65, -r * 0.92, -r * 0.22, -r * 0.72);
  g.closePath();
  g.fill();
  g.stroke();

  g.fillStyle = '#9aa8b6';
  g.beginPath();
  g.moveTo(-r * 0.10, -r * 0.82);
  g.quadraticCurveTo(-r * 0.62, -r * 1.18, -r * 1.02, -r * 0.62);
  g.quadraticCurveTo(-r * 0.55, -r * 0.68, -r * 0.25, -r * 0.60);
  g.closePath();
  g.fill();
  g.stroke();

  // Main sleek silver-grey body
  g.fillStyle = '#b4c0cc';
  g.strokeStyle = '#182026';
  g.lineWidth = r * 0.10;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();

  g.save();
  g.beginPath();
  g.arc(0, 0, r * 0.96, 0, Math.PI * 2);
  g.clip();

  // Cool slate back shading
  g.fillStyle = '#7e8d9c';
  g.beginPath();
  g.arc(-r * 0.22, r * 0.18, r * 0.95, 0, Math.PI * 2);
  g.fill();

  // Bright white face/chest mask (Silver's distinct two-tone face)
  g.fillStyle = '#f3f7fb';
  g.beginPath();
  g.ellipse(r * 0.24, r * 0.34, r * 0.68, r * 0.62, -0.15, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Outer outline
  g.strokeStyle = '#182026';
  g.lineWidth = r * 0.10;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();

  // Big expressive eyes with cool silver eyelids
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#182026';
  g.lineWidth = r * 0.055;
  g.beginPath();
  g.arc(r * 0.16, -r * 0.12, r * 0.22, 0, Math.PI * 2);
  g.arc(r * 0.52, -r * 0.10, r * 0.19, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  // Half-lids + fierce brows
  g.fillStyle = '#6c7a89';
  g.beginPath();
  g.arc(r * 0.16, -r * 0.12, r * 0.22, Math.PI * 1.05, Math.PI * 1.95);
  g.fill();
  g.beginPath();
  g.arc(r * 0.52, -r * 0.10, r * 0.19, Math.PI * 1.05, Math.PI * 1.95);
  g.fill();

  g.fillStyle = '#111827';
  g.beginPath();
  g.arc(r * 0.22, -r * 0.08, r * 0.085, 0, Math.PI * 2);
  g.arc(r * 0.56, -r * 0.07, r * 0.075, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = '#182026';
  g.lineWidth = r * 0.09;
  g.beginPath();
  g.moveTo(-r * 0.10, -r * 0.34);
  g.lineTo(r * 0.34, -r * 0.20);
  g.lineTo(r * 0.74, -r * 0.32);
  g.stroke();

  // Curved golden-yellow beak with Silver's playful lower jaw
  g.fillStyle = '#eab308';
  g.strokeStyle = '#182026';
  g.lineWidth = r * 0.055;
  g.beginPath();
  g.moveTo(r * 0.26, r * 0.06);
  g.lineTo(r * 0.98, r * 0.14);
  g.lineTo(r * 0.30, r * 0.28);
  g.closePath();
  g.fill();
  g.stroke();
}

function drawSilverSprite(g, ent) {
  const r = ent.r || BASE_R;
  drawSilverBody(g, r);
}

function pickAirForceTargets(ctx, count) {
  const all = dynamicTargets(ctx);
  if (!all.length) {
    const sb = getStructureBounds(ctx);
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({
        x: sb.x0 + ((i + 0.5) / count) * Math.max(6, sb.x1 - sb.x0),
        y: Math.max(1.0, sb.y1 * 0.3),
      });
    }
    return out;
  }
  // Spread each wave across ALL pigs + distinct x-columns of blocks so all buildings get bombed!
  const pigs = all
    .filter((e) => e.kind === KIND.PIG)
    .sort((a, b) => ctx.pos(a).x - ctx.pos(b).x || a.id - b.id);
  const blocks = all
    .filter((e) => e.kind === KIND.BLOCK)
    .sort((a, b) => ctx.pos(b).y - ctx.pos(a).y || a.id - b.id);
  const ordered = [...pigs, ...blocks];
  const out = [];
  const stride = Math.max(1, Math.floor(pigs.length / Math.max(1, Math.min(count, pigs.length))));
  for (let i = 0; i < count; i++) {
    const idx = i < pigs.length ? (i * stride + i) % pigs.length : i % ordered.length;
    const e = ordered[idx];
    const p = ctx.pos(e);
    out.push({
      x: p.x + ctx.range(-1.1, 1.1),
      y: Math.max(0.4, p.y + ctx.range(-0.4, 0.7)),
    });
  }
  return out;
}

function launchAirForce(ctx, bird) {
  if (bird.data.airForceCalled) return;
  bird.data.airForceCalled = true;
  ctx.sfx('jet');

  for (let w = 0; w < WAVES; w++) {
    const delay = w * WAVE_GAP;
    const spawnWave = () => {
      const rect = ctx.actionRect();
      const targets = pickAirForceTargets(ctx, PER_WAVE);
      ctx.sfx('whoosh', { pitch: 1.05 + w * 0.08, vol: 0.55 });

      for (let i = 0; i < PER_WAVE; i++) {
        const tgt = targets[i];
        // Dive from upper-left sky along a dramatic ~50-60 deg diagonal (clears left mesas cleanly)
        const dxSpan = ctx.range(9.5, 16.5);
        const dySpan = ctx.range(13.5, 19.5);
        const sx = tgt.x - dxSpan;
        const sy = Math.max(rect.y1 + ctx.range(1.0, 5.5), tgt.y + dySpan);
        const dx = tgt.x - sx;
        const dy = tgt.y - sy;
        const len = Math.hypot(dx, dy) || 1;
        const spd = ctx.range(28, 31.5);
        const vx = (dx / len) * spd;
        const vy = (dy / len) * spd;
        const angle = Math.atan2(vy, vx);

        const spawnFn = typeof ctx.spawnClone === 'function'
          ? (opts) => ctx.spawnClone('silver', opts)
          : (opts) => ctx.spawnProjectile(opts);
        const jet = spawnFn({
          x: sx,
          y: sy,
          vx,
          vy,
          angle,
          r: 0.40,
          skin: 'silver_jet',
          density: 3.5,
          gravityScale: 0,
          bullet: true,
          dmgMul: 2.0,
          ttl: 1.8,
          owner: 'silver',
          mask: 0xffff & ~CAT.PROJ & ~CAT.BIRD,
          explode: { r: 1.25, dmg: 130, impulse: 14, power: 'normal' },
        });
        ctx.addEffect({
          type: 'silver_streak',
          x: sx,
          y: sy,
          x2: tgt.x,
          y2: tgt.y,
          proj: jet,
          ttl: 0.68,
        });
      }
    };

    if (delay === 0) spawnWave();
    else ctx.after(delay, spawnWave);
  }
}

export default {
  id: 'silver',
  name: '炫舞银',
  ability: '空军出击',
  desc: '空翻高速俯冲震碎建筑，撞击后召唤4波共40只炫舞银空军轰炸全屏',
  color: '#b9c3cc',
  radius: BASE_R,
  density: 5,
  dmgMul: 1.2,

  onLaunch(_ctx, bird) {
    bird.data.slamming = false;
    bird.data.slammed = false;
    bird.data.airForceCalled = false;
  },

  onTap(ctx, bird, target) {
    if (!bird || !bird.alive) return;
    holdTurn(ctx, 3.0);

    const startP = { ...ctx.pos(bird) };
    const startV = { ...ctx.vel(bird) };
    const inAng = Math.atan2(startV.y, startV.x);
    const loopCx = startP.x - Math.sin(inAng) * LOOP_R;
    const loopCy = startP.y + Math.cos(inAng) * LOOP_R;
    const aim = resolveTarget(ctx, bird, target);

    setGravityScale(ctx, bird, 0);
    ctx.sfx('whoosh', { x: startP.x, y: startP.y, pitch: 1.25 });
    ctx.addEffect({
      type: 'silver_loop',
      cx: loopCx,
      cy: loopCy,
      r: LOOP_R,
      a0: inAng - Math.PI * 0.5,
      ttl: LOOP_DUR + 0.35,
    });

    // Phase 1: tight 360-degree loop-de-loop over LOOP_DUR (0.25 s)
    ctx.addTask((_dt, age) => {
      if (!bird.alive) return false;
      if (age < LOOP_DUR) {
        const u = age / LOOP_DUR;
        const theta = (inAng - Math.PI * 0.5) + u * Math.PI * 2;
        const nx = loopCx + Math.cos(theta) * LOOP_R;
        const ny = loopCy + Math.sin(theta) * LOOP_R;
        const cur = ctx.pos(bird);
        ctx.setVelocity(bird, (nx - cur.x) / ctx.DT, (ny - cur.y) / ctx.DT);
        bird.body.setAngle(theta + Math.PI * 0.5);
        return true;
      }

      // Phase 2: 32..35 m/s supersonic slam straight into target!
      setGravityScale(ctx, bird, 0.25);
      const bp = ctx.pos(bird);
      const liveAim = target ? aim : resolveTarget(ctx, bird, null);
      const dx = liveAim.x - bp.x;
      const dy = liveAim.y - bp.y;
      const d = Math.hypot(dx, dy) || 1;
      const vx = (dx / d) * SLAM_SPEED;
      const vy = (dy / d) * SLAM_SPEED;
      ctx.setVelocity(bird, vx, vy);
      bird.body.setAngle(Math.atan2(vy, vx));
      bird.dmgMul = 3.5;
      bird.data.slamming = true;
      bird.data.slamStartT = ctx.time;
      ctx.addEffect({
        type: 'silver_streak',
        x: bp.x,
        y: bp.y,
        x2: liveAim.x,
        y2: liveAim.y,
        proj: bird,
        hero: true,
        ttl: 0.65,
      });
      ctx.sfx('jet', { x: bp.x, y: bp.y });
      return false;
    });

    // Fallback: air force also triggers if no impact (1.15 s = within ±30% of 1.5 s)
    ctx.after(1.15, () => {
      launchAirForce(ctx, bird);
    });
  },

  onStep(ctx, bird) {
    if (!bird || !bird.alive || !bird.data.slamming || bird.data.slammed) return;
    const p = ctx.pos(bird);
    const v = ctx.vel(bird);
    const spd = Math.hypot(v.x, v.y);
    const hitNearby = ctx.queryCircle(
      p.x,
      p.y,
      bird.r + 0.35,
      (e) => e.id !== bird.id && (e.isStatic || e.kind === KIND.BLOCK || e.kind === KIND.PIG),
    );
    if (hitNearby.length > 0 || spd < SLAM_SPEED * 0.68 || p.y <= bird.r + 0.25) {
      bird.data.slammed = true;
      setGravityScale(ctx, bird, 1);
      ctx.explode(p.x, p.y, {
        r: 3.5,
        dmg: 330,
        impulse: 32,
        power: 'normal',
        source: 'silver_slam',
      });
      ctx.addEffect({ type: 'silver_boom', x: p.x, y: p.y, r: 4.2, ttl: 0.5 });
      ctx.juice({ shake: 0.68, hitstop: 55 });
      launchAirForce(ctx, bird);
    }
  },

  drawBird: drawSilverSprite,

  icon(g, size) {
    drawBirdIcon(drawSilverSprite, BASE_R, g, size, 0);
  },

  projSkins: {
    'bird:silver': drawSilverSprite,
    silver_jet(g, ent) {
      const r = ent.r || 0.35;
      // Draw mini Silver + white supersonic Mach shock cone (exact video look in silver.jpg!)
      drawSilverBody(g, r);
      g.save();
      g.globalAlpha = 0.86;
      const grad = g.createLinearGradient(r * 1.1, 0, -r * 3.8, 0);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      grad.addColorStop(0.45, 'rgba(215, 242, 255, 0.65)');
      grad.addColorStop(1, 'rgba(180, 225, 255, 0.0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(r * 1.15, 0);
      g.lineTo(-r * 3.6, -r * 1.45);
      g.lineTo(-r * 2.7, 0);
      g.lineTo(-r * 3.6, r * 1.45);
      g.closePath();
      g.fill();

      // Sonic ring collar
      g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      g.lineWidth = r * 0.14;
      g.beginPath();
      g.ellipse(-r * 0.5, 0, r * 0.25, r * 1.08, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    },
  },

  effects: {
    silver_loop(g, e, t, cam) {
      const age = t - e.t0;
      const k = clamp(age / e.ttl, 0, 1);
      const drawSweep = Math.min(1, age / LOOP_DUR) * Math.PI * 2;
      const sx = cam.sx(e.cx);
      const sy = cam.sy(e.cy);
      const rad = e.r * cam.s;

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (1 - k) * 0.9;
      g.strokeStyle = '#bae6fd';
      g.lineWidth = 10 * (1 - 0.5 * k);
      g.lineCap = 'round';
      g.beginPath();
      // World +angle is CCW (up), screen y is flipped so negate angle
      g.arc(sx, sy, rad, -e.a0 - drawSweep, -e.a0);
      g.stroke();

      g.strokeStyle = '#ffffff';
      g.lineWidth = 4;
      g.stroke();
      g.restore();
    },

    silver_streak(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const cur = e.proj && e.proj.alive ? e.proj.body.getPosition() : { x: e.x2, y: e.y2 };
      const x1 = cam.sx(e.x);
      const y1 = cam.sy(e.y);
      const x2 = cam.sx(cur.x);
      const y2 = cam.sy(cur.y);

      g.save();
      g.globalCompositeOperation = 'lighter';
      const grad = g.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, 'rgba(200, 235, 255, 0)');
      grad.addColorStop(0.55, `rgba(220, 244, 255, ${(1 - k) * 0.45})`);
      grad.addColorStop(1, `rgba(255, 255, 255, ${(1 - k) * 0.92})`);
      g.strokeStyle = grad;
      g.lineCap = 'round';
      g.lineWidth = (e.hero ? 14 : 7) * (1 - 0.4 * k);
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      g.restore();
    },

    silver_boom(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const sx = cam.sx(e.x);
      const sy = cam.sy(e.y);
      const rad = e.r * cam.s * (0.2 + 0.85 * (1 - (1 - k) * (1 - k)));

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (1 - k) * 0.88;
      g.strokeStyle = '#ffffff';
      g.lineWidth = Math.max(2, (1 - k) * 12);
      g.beginPath();
      g.arc(sx, sy, rad, 0, Math.PI * 2);
      g.stroke();

      g.strokeStyle = '#7dd3fc';
      g.lineWidth = Math.max(2, (1 - k) * 6);
      g.beginPath();
      g.arc(sx, sy, rad * 0.72, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    },
  },
};
