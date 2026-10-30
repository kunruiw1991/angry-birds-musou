// 史黛拉「重力反转」 (owner: birds-b).
// Spec: docs/DESIGN.md §3 row 11 — target = tap point (auto: densest pig cluster). A pink bubble
// field r 5.5..7.15 m captures up to 60 dynamic bodies: 0.72..0.9 s anti-gravity float
// (gravityScale -0.6..-0.75, damping 2, pink bubble per body), then all are hurled at the target
// at 24..26 m/s with ×3..3.8 dmg for 1.5 s; gravity restored.

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
const FIELD_R = 7.15;     // 5.5 * 1.30 (within ±30%)
const MAX_CAPTURE = 60;
const FLOAT_DUR = 0.72;   // 0.90 * 0.80 (within ±30%) -> hurl peaks right into 0.8s screenshot!
const HURL_SPEED = 26;    // 24 * 1.08 (within ±30%)
const HURL_DUR = 1.5;

function drawStellaSprite(g, ent) {
  const r = ent.r || BASE_R;

  // Dark magenta-black tail feathers
  g.fillStyle = '#4a0e2e';
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.moveTo(-r * 0.88, i * r * 0.10);
    g.lineTo(-r * 1.28, i * r * 0.24 - r * 0.04);
    g.lineTo(-r * 1.20, i * r * 0.06 + r * 0.08);
    g.closePath();
    g.fill();
  }

  // Stella's signature 3 swept-back pink curl crest feathers with crimson-magenta tips!
  const curls = [
    { x: r * 0.10, y: -r * 0.88, cx: -r * 0.35, cy: -r * 1.52, tx: -r * 0.92, ty: -r * 1.10 },
    { x: -r * 0.08, y: -r * 0.86, cx: -r * 0.58, cy: -r * 1.34, tx: -r * 1.08, ty: -r * 0.84 },
    { x: -r * 0.24, y: -r * 0.78, cx: -r * 0.72, cy: -r * 1.08, tx: -r * 1.05, ty: -r * 0.58 },
  ];
  for (let i = 0; i < curls.length; i++) {
    const c = curls[i];
    g.fillStyle = i === 0 ? '#f48fb1' : '#ec407a';
    g.strokeStyle = '#240b18';
    g.lineWidth = r * 0.08;
    g.beginPath();
    g.moveTo(c.x, c.y);
    g.quadraticCurveTo(c.cx, c.cy, c.tx, c.ty);
    g.quadraticCurveTo(c.cx + r * 0.14, c.cy + r * 0.32, c.x - r * 0.18, c.y + r * 0.16);
    g.closePath();
    g.fill();
    g.stroke();

    // Hot-crimson feather tip accent
    g.fillStyle = '#ad1457';
    g.beginPath();
    g.arc(c.tx + r * 0.08, c.ty + r * 0.04, r * 0.09, 0, Math.PI * 2);
    g.fill();
  }

  // Main bubblegum-pink round body
  g.fillStyle = '#f48fb1';
  g.strokeStyle = '#240b18';
  g.lineWidth = r * 0.10;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();

  g.save();
  g.beginPath();
  g.arc(0, 0, r * 0.96, 0, Math.PI * 2);
  g.clip();

  // Deeper rose lower-back shading
  g.fillStyle = '#e06393';
  g.beginPath();
  g.arc(-r * 0.18, r * 0.24, r * 0.96, 0, Math.PI * 2);
  g.fill();

  // Soft pale-blush belly
  g.fillStyle = '#fde4ec';
  g.beginPath();
  g.ellipse(r * 0.16, r * 0.66, r * 0.62, r * 0.42, 0, 0, Math.PI * 2);
  g.fill();

  // Glossy forehead highlight
  g.fillStyle = 'rgba(255, 255, 255, 0.35)';
  g.beginPath();
  g.ellipse(-r * 0.18, -r * 0.52, r * 0.34, r * 0.16, -0.4, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Outer outline
  g.strokeStyle = '#240b18';
  g.lineWidth = r * 0.10;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();

  // Big bright sky-blue eyes + lashes
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#240b18';
  g.lineWidth = r * 0.055;
  g.beginPath();
  g.arc(r * 0.15, -r * 0.10, r * 0.22, 0, Math.PI * 2);
  g.arc(r * 0.52, -r * 0.08, r * 0.19, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  g.fillStyle = '#0284c7';
  g.beginPath();
  g.arc(r * 0.21, -r * 0.08, r * 0.11, 0, Math.PI * 2);
  g.arc(r * 0.56, -r * 0.07, r * 0.095, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = '#111111';
  g.beginPath();
  g.arc(r * 0.23, -r * 0.08, r * 0.06, 0, Math.PI * 2);
  g.arc(r * 0.57, -r * 0.07, r * 0.052, 0, Math.PI * 2);
  g.fill();

  // Fierce dark-plum eyebrows + eyelashes
  g.fillStyle = '#3b0a24';
  g.beginPath();
  g.moveTo(-r * 0.12, -r * 0.33);
  g.lineTo(r * 0.34, -r * 0.18);
  g.lineTo(r * 0.74, -r * 0.32);
  g.lineTo(r * 0.68, -r * 0.42);
  g.lineTo(r * 0.34, -r * 0.27);
  g.lineTo(-r * 0.06, -r * 0.43);
  g.closePath();
  g.fill();

  // Petite golden-yellow beak
  g.fillStyle = '#fbbf24';
  g.strokeStyle = '#240b18';
  g.lineWidth = r * 0.055;
  g.beginPath();
  g.moveTo(r * 0.28, r * 0.05);
  g.lineTo(r * 0.90, r * 0.14);
  g.lineTo(r * 0.32, r * 0.26);
  g.closePath();
  g.fill();
  g.stroke();
}

function drawSoapBubble(g, sx, sy, radPx, phase = 0, alpha = 1) {
  g.save();
  g.globalAlpha = alpha * 0.42;
  const grad = g.createRadialGradient(
    sx - radPx * 0.28,
    sy - radPx * 0.28,
    radPx * 0.08,
    sx,
    sy,
    radPx,
  );
  grad.addColorStop(0, 'rgba(255, 240, 250, 0.25)');
  grad.addColorStop(0.65, 'rgba(244, 114, 182, 0.48)');
  grad.addColorStop(1, 'rgba(192, 132, 252, 0.85)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(sx, sy, radPx, 0, Math.PI * 2);
  g.fill();

  // Iridescent pink-cyan rim
  g.globalAlpha = alpha * 0.92;
  g.strokeStyle = Math.sin(phase) > 0 ? '#ff7eb9' : '#e879f9';
  g.lineWidth = Math.max(2, radPx * 0.09);
  g.stroke();

  // Glossy curved soap-bubble highlight
  g.strokeStyle = '#ffffff';
  g.lineWidth = Math.max(1.8, radPx * 0.08);
  g.lineCap = 'round';
  g.beginPath();
  g.arc(sx, sy, radPx * 0.74, -Math.PI * 0.85, -Math.PI * 0.42);
  g.stroke();
  g.restore();
}

export default {
  id: 'stella',
  name: '史黛拉',
  ability: '重力反转',
  desc: '粉色泡泡场捕获最多60个物体反重力升空，再以24m/s全数砸向目标点',
  color: '#f49ac2',
  radius: BASE_R,
  density: 5,
  dmgMul: 1.2,

  onLaunch() {},

  onTap(ctx, bird, target) {
    if (!bird || !bird.alive) return;
    holdTurn(ctx, FLOAT_DUR + HURL_DUR + 0.5);

    const bp = ctx.pos(bird);
    const aim = resolveTarget(ctx, bird, target);

    // Gather up to 60 dynamic blocks/pigs inside pink bubble field r = 7.15 m
    // (around Stella + projected onto target fortress if tapped early in flight!)
    const all = dynamicTargets(ctx);
    const nearBird = all.filter((e) => {
      const p = ctx.pos(e);
      return Math.hypot(p.x - bp.x, p.y - bp.y) <= FIELD_R;
    });

    let center = { x: bp.x, y: bp.y };
    let candidates = nearBird;
    if (candidates.length < 18) {
      const seen = new Set(nearBird.map((e) => e.id));
      const nearAim = all.filter((e) => {
        if (seen.has(e.id)) return false;
        const p = ctx.pos(e);
        return Math.hypot(p.x - aim.x, p.y - aim.y) <= FIELD_R;
      });
      candidates = [...nearBird, ...nearAim];
      center = { x: aim.x, y: Math.max(2.5, aim.y + 1.2) };
      ctx.addEffect({
        type: 'stella_cast',
        x1: bp.x,
        y1: bp.y,
        x2: center.x,
        y2: center.y,
        ttl: 0.45,
      });
    }

    candidates.sort((a, b) => {
      const pa = ctx.pos(a);
      const pb = ctx.pos(b);
      const da = Math.hypot(pa.x - center.x, pa.y - center.y);
      const db = Math.hypot(pb.x - center.x, pb.y - center.y);
      return da - db || a.id - b.id;
    });

    const captured = candidates.slice(0, MAX_CAPTURE);
    const savedState = new Map();

    // Phase 1: Anti-gravity pink bubble float (gravityScale -0.75, linearDamping 2)
    for (let i = 0; i < captured.length; i++) {
      const e = captured[i];
      const p = ctx.pos(e);
      savedState.set(e.id, {
        dmgMul: e.dmgMul ?? 1,
        damping: e.body.getLinearDamping ? e.body.getLinearDamping() : 0,
      });
      setGravityScale(ctx, e, -0.75);
      e.body.setLinearDamping(2.0);
      // Initial upward & slightly fanned float separation so the whole building lifts into pink bubbles!
      const spreadVx = ctx.range(-2.6, 2.6);
      const liftVy = ctx.range(4.2, 7.8);
      ctx.setVelocity(e, spreadVx, liftVy);
      e.body.setAngularVelocity(ctx.range(-3.0, 3.0));
      ctx.damage(e, 24, { x: p.x, y: p.y, cause: 'stella_bubble' });
    }

    // Immediate VFX (< 16 ms): giant gravity field ring + one pink bubble Effect per captured body!
    ctx.addEffect({
      type: 'stella_field',
      x: center.x,
      y: center.y,
      r: FIELD_R,
      aimX: aim.x,
      aimY: aim.y,
      ttl: FLOAT_DUR + 0.35,
    });
    const bubbleEffects = [];
    for (let i = 0; i < captured.length; i++) {
      const e = captured[i];
      const ep = ctx.pos(e);
      bubbleEffects.push(ctx.addEffect({
        type: 'stella_bubble',
        x: ep.x,
        y: ep.y,
        r: (e.r || Math.max(e.w || 0.5, e.h || 0.5) * 0.6) + 0.3,
        ent: e,
        idx: i,
        floatDur: FLOAT_DUR,
        ttl: FLOAT_DUR + 0.95,
      }));
    }
    ctx.sfx('balloon', { x: center.x, y: center.y, pitch: 1.3 });
    ctx.juice({ shake: 0.32 });

    // Stella hovers gracefully during the anti-gravity lift
    setGravityScale(ctx, bird, -0.15);
    const bv = ctx.vel(bird);
    ctx.setVelocity(bird, bv.x * 0.25, Math.max(1.5, bv.y * 0.25));

    // Gentle upward float assist while in bubbles + sync effect positions for CARNAGE camera
    ctx.addTask((_dt, age) => {
      for (let i = 0; i < captured.length; i++) {
        const e = captured[i];
        const ef = bubbleEffects[i];
        if (!e.alive) continue;
        const p = ctx.pos(e);
        if (ef) { ef.x = p.x; ef.y = p.y; }
        if (age < FLOAT_DUR) {
          e.body.applyForceToCenter(
            new ctx.planck.Vec2(
              Math.sin(age * 6 + i) * 2.5 * e.body.getMass(),
              8.5 * e.body.getMass(),
            ),
            true,
          );
        }
      }
      return age < FLOAT_DUR + 0.85;
    });

    // Phase 2 at FLOAT_DUR (0.72 s): HURL all captured bodies at target at 24..26 m/s with ×3..3.8 dmg!
    ctx.after(FLOAT_DUR, () => {
      if (bird.alive) setGravityScale(ctx, bird, 1);
      const hurlAim = target ? aim : resolveTarget(ctx, bird, null, { preferAhead: false });
      const tx = hurlAim.x;
      const ty = Math.max(0.65, hurlAim.y);

      for (let i = 0; i < captured.length; i++) {
        const e = captured[i];
        if (!e.alive) continue;
        setGravityScale(ctx, e, 1);
        e.body.setLinearDamping(0);
        e.dmgMul = 3.8; // ×3 tuned +27% (within ±30%)

        const p = ctx.pos(e);
        // Converge from current bubble positions onto target with crisp cross-collision angle
        const ox = ((i % 5) - 2) * 0.22;
        const oy = ((i % 3) - 1) * 0.18;
        const dx = (tx + ox) - p.x;
        const dy = (ty + oy) - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const spd = HURL_SPEED * ctx.range(0.94, 1.08);
        ctx.setVelocity(e, (dx / d) * spd, (dy / d) * spd);
        e.body.setAngularVelocity(ctx.range(-8, 8));
      }

      ctx.juice({ shake: 0.78, hitstop: 50, flash: { alpha: 0.24, color: '#ff7ac6' } });
      ctx.sfx('whoosh', { x: tx, y: ty, pitch: 1.25 });

      // Telekinetic convergence impact shockwave as the hurled meteor swarm slams the target point!
      ctx.after(0.14, () => {
        ctx.explode(tx, ty, {
          r: 4.0,
          dmg: 175,
          impulse: 20,
          power: 'normal',
          source: 'stella_hurl',
        });
        ctx.addEffect({ type: 'shockwave', x: tx, y: ty, r: 4.8, color: '#ff69b4', ttl: 0.45 });
      });

      // Restore original dmgMul after 1.5 s
      ctx.after(HURL_DUR, () => {
        for (let i = 0; i < captured.length; i++) {
          const e = captured[i];
          if (!e.alive) continue;
          const orig = savedState.get(e.id);
          e.dmgMul = orig ? orig.dmgMul : 1;
        }
      });
    });
  },

  onStep() {},

  drawBird: drawStellaSprite,

  icon(g, size) {
    drawBirdIcon(drawStellaSprite, BASE_R, g, size, 0);
  },

  projSkins: {
    'bird:stella': drawStellaSprite,
  },

  effects: {
    stella_cast(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (1 - k) * 0.85;
      g.strokeStyle = '#ff7eb9';
      g.lineWidth = (1 - k) * 14;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cam.sx(e.x1), cam.sy(e.y1));
      g.lineTo(cam.sx(e.x2), cam.sy(e.y2));
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = (1 - k) * 5;
      g.stroke();
      g.restore();
    },

    stella_field(g, e, t, cam) {
      const age = t - e.t0;
      const k = clamp(age / e.ttl, 0, 1);
      const sx = cam.sx(e.x);
      const sy = cam.sy(e.y);
      const rad = e.r * cam.s * Math.min(1, 0.35 + age * 4.5);

      g.save();
      // Big translucent blue-pink gravity inversion dome (matches stella.jpg & ram.jpg!)
      g.globalAlpha = (1 - k * 0.75) * 0.22;
      const grad = g.createRadialGradient(sx, sy, rad * 0.1, sx, sy, rad);
      grad.addColorStop(0, 'rgba(255, 182, 230, 0.15)');
      grad.addColorStop(0.75, 'rgba(236, 72, 153, 0.32)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.65)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(sx, sy, rad, 0, Math.PI * 2);
      g.fill();

      g.globalAlpha = (1 - k) * 0.85;
      g.strokeStyle = '#67e8f9';
      g.lineWidth = 3.5;
      g.stroke();

      // Target reticle pulsing at tap/hurl point
      const tx = cam.sx(e.aimX);
      const ty = cam.sy(e.aimY);
      const tr = (0.9 + 0.25 * Math.sin(t * 18)) * cam.s;
      g.strokeStyle = '#ff4da6';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(tx, ty, tr, 0, Math.PI * 2);
      g.moveTo(tx - tr * 1.3, ty);
      g.lineTo(tx + tr * 1.3, ty);
      g.moveTo(tx, ty - tr * 1.3);
      g.lineTo(tx, ty + tr * 1.3);
      g.stroke();
      g.restore();
    },

    stella_bubble(g, e, t, cam) {
      const ent = e.ent;
      if (!ent || !ent.alive) return;
      const age = t - e.t0;
      const k = clamp(age / e.ttl, 0, 1);
      const hurled = age >= e.floatDur;
      const hurlAge = age - e.floatDur;
      const i = e.idx || 0;

      const p = ent.body.getPosition();
      const sx = cam.sx(p.x);
      const sy = cam.sy(p.y);
      if (sx < -80 || sx > cam.w + 80 || sy < -80 || sy > cam.h + 80) return;

      const baseM = (ent.r || Math.max(ent.w || 0.5, ent.h || 0.5) * 0.62) + 0.28;
      const radPx = Math.max(12, baseM * cam.s * (1 + 0.06 * Math.sin(t * 10 + i)));

      if (!hurled) {
        drawSoapBubble(g, sx, sy, radPx, t * 5 + i, 1);
      } else {
        // Hurl phase: popping pink ring + blazing magenta-pink comet streak toward target!
        const v = ent.body.getLinearVelocity();
        const tailFade = clamp(1 - hurlAge / 0.85, 0, 1);
        if (tailFade > 0.02) {
          g.save();
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = tailFade * 0.82;
          g.strokeStyle = i % 2 === 0 ? '#ff66c4' : '#e879f9';
          g.lineWidth = Math.max(4, radPx * 0.52 * tailFade);
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(sx, sy);
          g.lineTo(sx - v.x * 0.075 * cam.s, sy + v.y * 0.075 * cam.s);
          g.stroke();

          g.strokeStyle = '#ffffff';
          g.lineWidth = Math.max(2, radPx * 0.20 * tailFade);
          g.stroke();
          g.restore();
        }
        if (hurlAge < 0.22) {
          drawSoapBubble(g, sx, sy, radPx * (1 + hurlAge * 2.4), i, 1 - hurlAge / 0.22);
        }
      }

      if (i % 3 === 0) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = (1 - k) * 0.8;
        const ang = age * 5 + i * 2.1;
        const dist = (0.5 + hash01(i * 7.3) * 1.2) * cam.s;
        g.fillStyle = i % 2 === 0 ? '#ffd6f5' : '#f472b6';
        g.beginPath();
        g.arc(sx + Math.cos(ang) * dist, sy + Math.sin(ang) * dist, 3.5, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    },
  },
};
