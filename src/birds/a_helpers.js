// Shared deterministic sim + cartoon art helpers for birds-a (red, blues, chuck, bomb, matilda, hal).
// Owner: birds-a. Uses ONLY the ability ctx contract (with local fallbacks until physics-core lands helpers).

import { KIND, EV } from '../contracts.js';

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Deterministic [0,1) hash for render-only detail (sparkles/feathers) without Math.random. */
export function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** Keep the turn alive while a multi-phase ability executes. */
export function holdTurn(ctx, sec) {
  if (typeof ctx.holdTurn === 'function') {
    try { ctx.holdTurn(sec); } catch (_) { /* ignore signature drift */ }
  }
  ctx.addTask((_dt, age) => age < sec);
}

/** Toggle fixture sensor state cleanly on a bird/projectile ent. */
export function setSensor(ctx, ent, flag) {
  if (!ent || !ent.alive) return;
  if (typeof ctx.setSensor === 'function') {
    ctx.setSensor(ent, !!flag);
    return;
  }
  for (let f = ent.body.getFixtureList(); f; f = f.getNext()) {
    f.setSensor(!!flag);
  }
  ent.body.setAwake(true);
}

/** Set gravityScale on an ent. */
export function setGravityScale(ctx, ent, scale) {
  if (!ent || !ent.alive) return;
  if (typeof ctx.setGravityScale === 'function') {
    ctx.setGravityScale(ent, scale);
    return;
  }
  ent.body.setGravityScale(scale);
  ent.body.setAwake(true);
}

/** Spawn a mini-bird clone projectile ('bird:<id>'), compatible with physics-core's spawnClone. */
export function spawnBirdClone(ctx, birdId, opts = {}) {
  const skin = opts.skin || `bird:${birdId}`;
  let ent;
  if (typeof ctx.spawnClone === 'function' && skin === `bird:${birdId}`) {
    ent = ctx.spawnClone(birdId, opts);
    if (ent) {
      if (opts.explode && !ent.data.explode) ent.data.explode = opts.explode;
      if (opts.onHit && !ent.data.onHit) ent.data.onHit = opts.onHit;
      if (opts.restitution != null) {
        for (let f = ent.body.getFixtureList(); f; f = f.getNext()) f.setRestitution(opts.restitution);
      }
    }
    return ent;
  }
  return ctx.spawnProjectile({
    ...opts,
    owner: birdId,
    skin,
  });
}

/** Steer a live ent toward (tx, ty) with max acceleration `accel` (m/s^2), maintaining `speed` if set. */
export function steerTowards(ctx, ent, tx, ty, accel, dt, speed = null) {
  if (!ent || !ent.alive) return;
  const p = ctx.pos(ent);
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return;
  const ux = dx / d;
  const uy = dy / d;
  const v = ctx.vel(ent);
  if (speed == null && typeof ctx.steer === 'function') {
    ctx.steer(ent, tx, ty, accel);
    return;
  }
  const curSpd = Math.hypot(v.x, v.y);
  const wantSpd = speed ?? Math.max(curSpd, 12);
  const dvx = ux * wantSpd - v.x;
  const dvy = uy * wantSpd - v.y;
  const dv = Math.hypot(dvx, dvy);
  const maxDv = accel * dt;
  let nvx = v.x;
  let nvy = v.y;
  if (dv <= maxDv || dv < 1e-4) {
    nvx = ux * wantSpd;
    nvy = uy * wantSpd;
  } else {
    nvx += (dvx / dv) * maxDv;
    nvy += (dvy / dv) * maxDv;
    if (speed != null) {
      const ns = Math.hypot(nvx, nvy) || 1;
      nvx = (nvx / ns) * speed;
      nvy = (nvy / ns) * speed;
    }
  }
  ctx.setVelocity(ent, nvx, nvy);
}

/** Safety check for exploding projectiles that skim flat ground or stall before postSolve fires. */
export function guardExplosiveProj(ctx, ent, groundY = 0.04) {
  if (!ent || !ent.alive || ent.data.hits || !ent.data.explode) return false;
  const p = ctx.pos(ent);
  const r = ent.r || Math.max(ent.w || 0.4, ent.h || 0.4) * 0.45;
  if (p.y <= r + groundY) {
    ent.data.hits = 1;
    if (ent.data.onHit) {
      try { ent.data.onHit(ent, null); } catch (_) { /* ignore */ }
    }
    ctx.explode(p.x, Math.max(0.15, p.y), { ...ent.data.explode, source: ent.owner || 'proj' });
    ctx.removeEnt(ent);
    return true;
  }
  return false;
}

/**
 * Deterministically pick `count` distributed targets ({x, y, ent}) within `findTargets`'s default
 * local reach (Amendment A1: 20 m from refX, refY; fallback inside local actionRect).
 */
export function distributeTargets(ctx, refX, refY, count, { aheadOnly = false, explicitTarget = null, rect = null } = {}) {
  const pigsAll = ctx.findTargets({ x: refX, y: refY, kinds: [KIND.PIG], fallbackBlocks: false, max: 60 });
  const blocksAll = ctx.findTargets({ x: refX, y: refY, kinds: [KIND.BLOCK], fallbackBlocks: false, max: 180 });

  let pigs = aheadOnly ? pigsAll.filter((e) => ctx.pos(e).x >= refX - 1.5) : pigsAll;
  if (!pigs.length) pigs = pigsAll;
  let blocks = aheadOnly ? blocksAll.filter((e) => ctx.pos(e).x >= refX - 1.5) : blocksAll;
  if (!blocks.length) blocks = blocksAll;

  // Sort blocks across horizontal span so buckets cover left-to-right of the local cluster.
  const blocksByX = blocks.slice().sort((a, b) => (ctx.pos(a).x - ctx.pos(b).x) || (a.id - b.id));
  const tnts = blocksByX.filter((e) => e.mat === 'tnt');

  const pool = [];
  if (explicitTarget && Number.isFinite(explicitTarget.x) && Number.isFinite(explicitTarget.y)) {
    pool.push({ x: explicitTarget.x, y: Math.max(0.5, explicitTarget.y), ent: null });
  }
  for (const p of pigs) {
    const pos = ctx.pos(p);
    pool.push({ x: pos.x, y: pos.y, ent: p });
  }
  for (const t of tnts) {
    const pos = ctx.pos(t);
    pool.push({ x: pos.x, y: pos.y, ent: t });
  }
  if (blocksByX.length) {
    const stride = Math.max(1, Math.floor(blocksByX.length / Math.max(6, count)));
    for (let i = 0; i < blocksByX.length; i += stride) {
      const b = blocksByX[i];
      const pos = ctx.pos(b);
      pool.push({ x: pos.x, y: pos.y, ent: b });
    }
    for (const b of blocksByX) {
      if (pool.length >= count * 2) break;
      const pos = ctx.pos(b);
      pool.push({ x: pos.x, y: pos.y, ent: b });
    }
  }

  const r = rect || ctx.actionRect();
  const span = Math.max(4, r.x1 - r.x0);
  const pad = Math.min(3.5, span * 0.18);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (pool.length) {
      const base = pool[i % pool.length];
      const jx = i < pigs.length ? ctx.range(-0.25, 0.25) : ctx.range(-0.7, 0.7);
      const jy = i < pigs.length ? ctx.range(-0.2, 0.25) : ctx.range(-0.4, 0.5);
      out.push({
        x: base.x + jx,
        y: Math.max(0.45, base.y + jy),
        ent: base.ent,
      });
    } else {
      const u = (i + 0.5) / Math.max(1, count);
      out.push({
        x: r.x0 + pad + (span - 2 * pad) * u,
        y: ctx.range(1.0, Math.min(6.0, r.y1 * 0.45)),
        ent: null,
      });
    }
  }
  return out;
}

/** Pick a primary world target within default `findTargets` reach of (refX, refY). */
export function pickPrimaryTarget(ctx, refX, refY, { explicitTarget = null, rect = null } = {}) {
  if (explicitTarget && Number.isFinite(explicitTarget.x) && Number.isFinite(explicitTarget.y)) {
    return { x: explicitTarget.x, y: Math.max(0.5, explicitTarget.y), ent: null };
  }
  const ahead = ctx.findTargets({ x: refX, y: refY, kinds: [KIND.PIG], aheadOnly: true, fallbackBlocks: false, max: 5 });
  if (ahead.length) {
    const p = ctx.pos(ahead[0]);
    return { x: p.x, y: p.y, ent: ahead[0] };
  }
  const any = ctx.findTargets({ x: refX, y: refY, kinds: [KIND.PIG], aheadOnly: false, fallbackBlocks: true, max: 8 });
  if (any.length) {
    const p = ctx.pos(any[0]);
    return { x: p.x, y: p.y, ent: any[0] };
  }
  const r = rect || ctx.actionRect();
  return { x: (r.x0 + r.x1) * 0.55, y: 2.2, ent: null };
}

/** Emit EV.BIRD_HIT for feather burst particles in juice-audio. */
export function emitBirdHit(ctx, birdId, x, y, speed = 18) {
  ctx.emit(EV.BIRD_HIT, { birdId, x, y, speed });
}

/** Build a standard HUD icon renderer from a module's drawBird(g, ent, t). */
export function makeHudIcon(birdDef, scale = 0.36, offsetX = 0.48, offsetY = 0.54) {
  return function icon(g, size) {
    g.save();
    g.translate(size * offsetX, size * offsetY);
    birdDef.drawBird(g, { r: size * scale, data: {}, status: {}, skin: birdDef.id }, 0);
    g.restore();
  };
}

/**
 * Draw a silky-smooth continuous trail polyline without per-segment round-cap beading.
 * `layers` = array of { color: 'r,g,b', alpha: 0.8, widthM: 0.45, minPx: 2 }.
 */
export function drawSmoothRibbon(g, cam, pts, t, windowS, layers) {
  if (!pts || pts.length < 2) return;
  let i0 = 0;
  while (i0 < pts.length - 1 && t - pts[i0].t > windowS) i0++;
  if (pts.length - i0 < 2) return;

  const pTail = pts[i0];
  const pHead = pts[pts.length - 1];
  const headFade = clamp(1 - (t - pHead.t) / windowS, 0, 1);
  if (headFade <= 0.02) return;

  const x0 = cam.sx(pTail.x), y0 = cam.sy(pTail.y);
  const x1 = cam.sx(pHead.x), y1 = cam.sy(pHead.y);
  const sameSpot = Math.hypot(x1 - x0, y1 - y0) < 2;

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';

  g.beginPath();
  g.moveTo(x0, y0);
  for (let i = i0 + 1; i < pts.length; i++) {
    g.lineTo(cam.sx(pts[i].x), cam.sy(pts[i].y));
  }

  for (const L of layers) {
    const aPeak = (L.alpha * headFade).toFixed(3);
    const aMid = (L.alpha * 0.55 * headFade).toFixed(3);
    if (sameSpot) {
      g.strokeStyle = `rgba(${L.color}, ${aPeak})`;
    } else {
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, `rgba(${L.color}, 0)`);
      grad.addColorStop(0.45, `rgba(${L.color}, ${aMid})`);
      grad.addColorStop(1, `rgba(${L.color}, ${aPeak})`);
      g.strokeStyle = grad;
    }
    g.lineWidth = Math.max(L.minPx || 2, L.widthM * cam.s);
    g.stroke();
  }
  g.restore();
}

/** Draw classic Angry Birds dual cartoon eyes + pupils in local meter frame (y down). */
export function drawCartoonEyes(g, r, {
  x1 = 0.16, x2 = 0.48, y = -0.10, rx = 0.19, ry = 0.21, pupil = 0.085,
  bagColor = null,
} = {}) {
  if (bagColor) {
    g.fillStyle = bagColor;
    g.beginPath();
    g.ellipse(r * x1, r * (y + 0.05), r * (rx * 1.25), r * (ry * 1.22), 0, 0, TAU);
    g.ellipse(r * x2, r * (y + 0.05), r * (rx * 1.22), r * (ry * 1.2), 0, 0, TAU);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#181818';
  g.lineWidth = r * 0.055;
  g.beginPath();
  g.ellipse(r * x1, r * y, r * rx, r * ry, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.beginPath();
  g.ellipse(r * x2, r * y, r * (rx * 0.92), r * (ry * 0.95), 0, 0, TAU);
  g.fill();
  g.stroke();

  g.fillStyle = '#111111';
  g.beginPath();
  g.arc(r * (x1 + rx * 0.28), r * y, r * pupil, 0, TAU);
  g.arc(r * (x2 + rx * 0.24), r * y, r * (pupil * 0.92), 0, TAU);
  g.fill();

  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(r * (x1 + rx * 0.05), r * (y - ry * 0.3), r * (pupil * 0.36), 0, TAU);
  g.arc(r * (x2 + rx * 0.05), r * (y - ry * 0.3), r * (pupil * 0.34), 0, TAU);
  g.fill();
}

/** Draw thick V-slanted angry cartoon eyebrows in local meter frame (y down). */
export function drawAngryBrows(g, r, {
  color = '#111111', yOuter = -0.38, yInner = -0.18, xLeft = -0.08, xMid = 0.34, xRight = 0.72, thick = 0.14,
} = {}) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(r * xLeft, r * (yOuter - thick * 0.5));
  g.lineTo(r * xMid, r * (yInner - thick * 0.35));
  g.lineTo(r * xRight, r * (yOuter - thick * 0.45));
  g.lineTo(r * (xRight - 0.03), r * (yOuter + thick * 0.55));
  g.lineTo(r * xMid, r * (yInner + thick * 0.55));
  g.lineTo(r * (xLeft + 0.03), r * (yOuter + thick * 0.55));
  g.closePath();
  g.fill();
}

/** Draw sharp two-part cartoon beak in local meter frame (y down). */
export function drawCartoonBeak(g, r, {
  x0 = 0.42, tipX = 1.12, yMid = 0.14, topH = 0.22, botH = 0.18,
} = {}) {
  g.lineJoin = 'round';
  g.strokeStyle = '#1a140c';
  g.lineWidth = r * 0.065;

  // Lower mandible
  g.fillStyle = '#d97808';
  g.beginPath();
  g.moveTo(r * x0, r * yMid);
  g.lineTo(r * (tipX - 0.14), r * (yMid + 0.05));
  g.lineTo(r * (x0 + 0.04), r * (yMid + botH));
  g.closePath();
  g.fill();
  g.stroke();

  // Upper mandible
  g.fillStyle = '#ffb30f';
  g.beginPath();
  g.moveTo(r * x0, r * (yMid - topH));
  g.lineTo(r * tipX, r * (yMid + 0.02));
  g.lineTo(r * (x0 - 0.02), r * (yMid + 0.04));
  g.closePath();
  g.fill();
  g.stroke();
}
