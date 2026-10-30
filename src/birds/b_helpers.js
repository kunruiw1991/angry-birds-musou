// Shared deterministic helpers + procedural cartoon art utilities for birds-b (rows 7–12).
// Owner: birds-b. Uses ONLY ability ctx. Enforces Design Amendment A1 (local reach via
// ctx.actionRect() and ctx.findTargets default reach; zero level-wide homing).
// ZERO Math.random / Date / camera in sim helpers.

import { KIND, CAT } from '../contracts.js';

export const DEFAULT_REACH_M = 20;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Read current sim-defined local screen rect from ctx.actionRect(). */
export function getActionRect(ctx) {
  const r = typeof ctx.actionRect === 'function' ? ctx.actionRect() : ctx.actionRect;
  return r || { x0: 0, x1: 28, y0: 0, y1: 14 };
}

/** Keep the turn alive for at least `sec` sim-seconds while an ability's multi-stage chaos runs. */
export function holdTurn(ctx, sec) {
  if (typeof ctx.holdTurn === 'function') {
    ctx.holdTurn(sec);
  }
  ctx.addTask((_dt, age) => age < sec);
}

/** Swap a circle entity's radius in-place, preserving density, filters, velocity & angular velocity. */
export function resizeCircle(ctx, ent, r, opts = {}) {
  if (!ent || !ent.alive || !ent.body) return;
  if (typeof ctx.resizeCircle === 'function' && !opts.restitution && !opts.density) {
    ctx.resizeCircle(ent, r);
    ent.r = r;
    ent.area = Math.PI * r * r;
    return;
  }
  const body = ent.body;
  const vel = body.getLinearVelocity();
  const av = body.getAngularVelocity();
  let fx = body.getFixtureList();
  let density = opts.density ?? 5;
  let friction = opts.friction ?? 0.6;
  let restitution = opts.restitution ?? 0.3;
  let isSensor = opts.sensor ?? false;
  let cat = CAT.BIRD;
  let mask = 0xffff;
  if (fx) {
    if (opts.density == null) density = fx.getDensity();
    if (opts.friction == null) friction = fx.getFriction();
    if (opts.restitution == null) restitution = fx.getRestitution();
    if (opts.sensor == null) isSensor = fx.isSensor();
    cat = fx.getFilterCategoryBits();
    mask = fx.getFilterMaskBits();
    while (fx) {
      const nxt = fx.getNext();
      body.destroyFixture(fx);
      fx = nxt;
    }
  }
  body.createFixture(new ctx.planck.Circle(r), {
    density,
    friction,
    restitution,
    isSensor,
    filterCategoryBits: cat,
    filterMaskBits: mask,
  });
  body.resetMassData();
  body.setLinearVelocity(new ctx.planck.Vec2(vel.x, vel.y));
  body.setAngularVelocity(av);
  body.setAwake(true);
  ent.r = r;
  ent.area = Math.PI * r * r;
}

export function setGravityScale(ctx, ent, scale) {
  if (!ent || !ent.alive || !ent.body) return;
  if (typeof ctx.setGravityScale === 'function') {
    ctx.setGravityScale(ent, scale);
    return;
  }
  ent.body.setGravityScale(scale);
  ent.body.setAwake(true);
}

export function setSensor(ctx, ent, sensor) {
  if (!ent || !ent.alive || !ent.body) return;
  if (typeof ctx.setSensor === 'function') {
    ctx.setSensor(ent, sensor);
    return;
  }
  for (let fx = ent.body.getFixtureList(); fx; fx = fx.getNext()) {
    fx.setSensor(!!sensor);
  }
  ent.body.setAwake(true);
}

/**
 * Acquire targets strictly via `ctx.findTargets`'s default local reach from `origin = {x, y}`
 * (Design Amendment A1: no level-wide homing).
 */
export function findLocalTargets(
  ctx,
  origin,
  { kinds = [KIND.PIG], max = 50, aheadOnly = false, fallbackBlocks = true } = {},
) {
  const ox = origin.x;
  const oy = origin.y;
  const raw = ctx.findTargets({
    x: ox,
    y: oy,
    kinds,
    max,
    aheadOnly,
    fallbackBlocks,
  });
  const maxD2 = DEFAULT_REACH_M * DEFAULT_REACH_M;
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (!e || !e.alive || e.isStatic) continue;
    const p = ctx.pos(e);
    if ((p.x - ox) ** 2 + (p.y - oy) ** 2 <= maxD2) {
      out.push(e);
    }
  }
  // If pigs were out of 20 m reach and raw returned distant pigs before A1 landed in physics-core,
  // re-query blocks locally so nearby structures within 20 m are still found cleanly.
  if (!out.length && fallbackBlocks && !kinds.includes(KIND.BLOCK)) {
    const rawBlocks = ctx.findTargets({
      x: ox,
      y: oy,
      kinds: [KIND.BLOCK],
      max,
      aheadOnly,
      fallbackBlocks: false,
    });
    for (let i = 0; i < rawBlocks.length; i++) {
      const e = rawBlocks[i];
      if (!e || !e.alive || e.isStatic) continue;
      const p = ctx.pos(e);
      if ((p.x - ox) ** 2 + (p.y - oy) ** 2 <= maxD2) {
        out.push(e);
      }
    }
  }
  return out;
}

/**
 * Deterministic local target resolution from `origin` (tapPos of bird, or pointer tap point).
 * Uses ONLY `findLocalTargets` default reach — never scans across the whole level.
 */
export function resolveLocalTarget(
  ctx,
  origin,
  target,
  { preferAhead = true, clusterR = 5.0 } = {},
) {
  if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    return { x: target.x, y: target.y, hasTarget: true, fromPointer: true };
  }
  let pigs = findLocalTargets(ctx, origin, {
    kinds: [KIND.PIG],
    max: 50,
    aheadOnly: preferAhead,
    fallbackBlocks: false,
  });
  if (!pigs.length && preferAhead) {
    pigs = findLocalTargets(ctx, origin, {
      kinds: [KIND.PIG],
      max: 50,
      aheadOnly: false,
      fallbackBlocks: false,
    });
  }
  const allLocal = findLocalTargets(ctx, origin, {
    kinds: [KIND.PIG, KIND.BLOCK],
    max: 80,
    aheadOnly: false,
    fallbackBlocks: true,
  });
  if (!allLocal.length) {
    const rect = getActionRect(ctx);
    return {
      x: clamp(origin.x + 10, rect.x0 + 2, rect.x1 - 2),
      y: Math.max(1.6, origin.y * 0.4),
      hasTarget: false,
      fromPointer: false,
    };
  }
  const pool = pigs.length ? pigs : allLocal;
  const r2 = clusterR * clusterR;
  let best = pool[0];
  let bestScore = -1e9;
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    const cp = ctx.pos(c);
    let score = c.kind === KIND.PIG ? 6 : 1;
    for (let j = 0; j < allLocal.length; j++) {
      const o = allLocal[j];
      const op = ctx.pos(o);
      const d2 = (op.x - cp.x) ** 2 + (op.y - cp.y) ** 2;
      if (d2 <= r2) score += o.kind === KIND.PIG ? 4 : 1.2;
    }
    score -= Math.hypot(cp.x - origin.x, cp.y - origin.y) * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  const p = ctx.pos(best);
  return { x: p.x, y: p.y, hasTarget: true, fromPointer: false };
}

/** Liang-Barsky clip of segment (x1,y1)->(x2,y2) to rect {x0,x1,y0,y1}. */
export function clipSegmentToRect(x1, y1, x2, y2, rect) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let u1 = 0;
  let u2 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - rect.x0, rect.x1 - x1, y1 - rect.y0, rect.y1 - y1];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-8) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > u2) return null;
        if (t > u1) u1 = t;
      } else {
        if (t < u1) return null;
        if (t < u2) u2 = t;
      }
    }
  }
  return {
    x1: x1 + u1 * dx,
    y1: y1 + u1 * dy,
    x2: x1 + u2 * dx,
    y2: y1 + u2 * dy,
  };
}

/** Find ground/static terrain surface y just below (x, maxY) so funnels sit on mesas/ground. */
export function groundTopAt(ctx, x, maxY = 12) {
  let top = 0;
  const ents = typeof ctx.allEnts === 'function' ? ctx.allEnts() : ctx.world.ents;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (!e || !e.alive || !e.isStatic || e.kind !== KIND.TERRAIN) continue;
    const p = e.body.getPosition();
    if (e.shape === 'box' && e.w && e.h) {
      if (x >= p.x - e.w * 0.5 && x <= p.x + e.w * 0.5) {
        const yTop = p.y + e.h * 0.5;
        if (yTop <= maxY && yTop > top) top = yTop;
      }
    }
  }
  return top;
}

/** Deterministic hash in [0, 1) for smooth non-flickering render visuals. */
export function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** Helper to render an icon by delegating to drawBird in a centered pixel box. */
export function drawBirdIcon(drawBirdFn, radius, g, size, t = 0) {
  g.save();
  g.translate(size * 0.5, size * 0.54);
  const scale = (size * 0.37) / radius;
  g.scale(scale, scale);
  drawBirdFn(g, { r: radius, data: {}, status: {} }, t);
  g.restore();
}
