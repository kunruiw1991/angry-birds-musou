// Shared deterministic helpers + procedural cartoon art utilities for birds-b (rows 7–12).
// Owner: birds-b. Uses ONLY ability ctx (falls back cleanly to ctx.planck / ctx.world until
// physics-core's extended ctx helpers land, and delegates to ctx.<fn> automatically once present).
// ZERO Math.random / Date / camera in sim helpers.

import { KIND, CAT } from '../contracts.js';

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
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

/** Deterministic list of live dynamic blocks and pigs sorted by id. */
export function dynamicTargets(ctx, filter = null) {
  const src = typeof ctx.allEnts === 'function' ? ctx.allEnts() : ctx.world.ents;
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const e = src[i];
    if (!e || !e.alive || e.isStatic) continue;
    if (e.kind !== KIND.BLOCK && e.kind !== KIND.PIG) continue;
    if (filter && !filter(e)) continue;
    out.push(e);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

export function getStructureBounds(ctx) {
  if (ctx.structureBounds) return ctx.structureBounds;
  if (ctx.game && ctx.game.structureBounds) return ctx.game.structureBounds;
  const r = ctx.actionRect();
  return { x0: r.x0 + 4, x1: r.x1 - 4, y0: 0, y1: Math.max(6, r.y1 - 6) };
}

/**
 * Deterministic auto-aim when target == null.
 * Picks the densest pig+block cluster ahead of the bird (or anywhere if bird passed structures).
 */
export function resolveTarget(ctx, bird, target, { preferAhead = true, clusterR = 5.0 } = {}) {
  if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    return { x: target.x, y: target.y };
  }
  const bp = bird && bird.alive ? ctx.pos(bird) : { x: 0, y: 4 };
  const all = dynamicTargets(ctx);
  if (!all.length) {
    const sb = getStructureBounds(ctx);
    return { x: (sb.x0 + sb.x1) * 0.5, y: Math.max(1.5, sb.y1 * 0.35) };
  }
  const pigs = all.filter((e) => e.kind === KIND.PIG);
  let pool = preferAhead ? pigs.filter((e) => ctx.pos(e).x >= bp.x - 2) : pigs;
  if (!pool.length) pool = pigs.length ? pigs : all;

  const r2 = clusterR * clusterR;
  let best = pool[0];
  let bestScore = -1e9;
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    const cp = ctx.pos(c);
    let score = c.kind === KIND.PIG ? 6 : 1;
    for (let j = 0; j < all.length; j++) {
      const o = all[j];
      const op = ctx.pos(o);
      const d2 = (op.x - cp.x) ** 2 + (op.y - cp.y) ** 2;
      if (d2 <= r2) score += o.kind === KIND.PIG ? 4 : 1.2;
    }
    // Slight preference for closer targets on ties
    score -= Math.hypot(cp.x - bp.x, cp.y - bp.y) * 0.04;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  const p = ctx.pos(best);
  return { x: p.x, y: p.y };
}

/** Find ground/static terrain surface y just below (x, maxY) so funnels sit on mesas/ground. */
export function groundTopAt(ctx, x, maxY = 12) {
  let top = 0;
  const ents = ctx.world.ents;
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
