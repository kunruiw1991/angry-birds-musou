// Ability context: the ONLY API bird modules use to touch the sim (owner: physics-core).
// Bird modules receive `ctx` in onLaunch(ctx, bird), onTap(ctx, bird, target),
// onStep(ctx, bird, dt), and optional onContact(ctx, bird, other, impact).
//
// DETERMINISM CONTRACT: Everything here uses seeded `world.rng`, sim `world.time`, and
// sim-defined bounds (`actionRect()`, `structureBounds`) — never `Math.random`, `Date`, or camera.
//
// ABILITY CTX API SUMMARY:
// - State & RNG: world, time, level, pointer ({x,y,down}), game, structureBounds, DT, planck,
//     rng() (+ rng.range/int/pick/sign), range(a,b), int(a,b), pick(arr), sign(), actionRect()
// - Spawning:
//     spawnProjectile(s) -> PROJ ent (supports explode, onHit, sensor, pierce, hitsBlocksOnly)
//     spawnClone(birdId, {x,y,vx,vy,r,dmgMul,ttl,gravityScale,...}) -> PROJ ent with skin 'bird:<id>'
// - Queries & Damage:
//     allEnts(filter?), queryCircle(x,y,r,filter?),
//     findTargets({x,y,kinds,max,maxDist=20,aheadOnly,fallbackBlocks}),
//     explode(x,y,{r,dmg,impulse,source,power,fx}), damageRay(x1,y1,x2,y2,{dmg,impulse,width,source}),
//     damageCircle(x,y,r,{dmg,impulse,source,filter}), damage(ent,amount,info)
// - Physics & Body Mutation:
//     pos(ent), vel(ent), applyImpulse(ent,ix,iy), setVelocity(ent,vx,vy),
//     steer(ent,tx,ty,accel,dt?), resizeCircle(ent,r), setSensor(ent,b), setGravityScale(ent,s),
//     removeEnt(ent)
// - Turn & Scheduling:
//     holdTurn(sec), addTask(fn,{delay}), after(sec,fn)
// - VFX & Audio Events:
//     addEffect(e), emit(type,payload), juice(payload), sfx(name,opts), banner(text,sub,opts)

import { KIND, CAT, EV, PHYS, MATERIALS } from '../contracts.js';
import { bus } from '../core/bus.js';
import { planck, defaultCategory } from './world.js';
import { BIRDS } from '../birds/index.js';

export function makeAbilityCtx(game) {
  const W = () => game.world;
  const rngFn = () => W().rng();
  rngFn.range = (a, b) => W().rng.range(a, b);
  rngFn.int = (a, b) => W().rng.int(a, b);
  rngFn.pick = (arr) => W().rng.pick(arr);
  rngFn.sign = () => W().rng.sign();

  const ctx = {
    get world() { return W(); },
    get time() { return W().time; },
    get level() { return game.level; },
    /** Held pointer in world coords {x,y,down} (input writes it; tests leave it up => auto-aim). */
    get pointer() { return game.pointer; },
    get game() { return game; },
    /** Level structure AABB {x0,x1,y0,y1} in world meters. */
    get structureBounds() {
      const b = game.structureBounds;
      return b ? { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 } : { x0: 15, x1: 35, y0: 0, y1: 8 };
    },

    rng: rngFn,
    range: (a, b) => W().rng.range(a, b),
    int: (a, b) => W().rng.int(a, b),
    pick: (arr) => W().rng.pick(arr),
    sign: () => W().rng.sign(),

    /** Bird's local "screen" rect (Design Amendment A1): x in [bx-6, bx+22] clipped to level bounds
     *  (bx/by = live bird pos at call time, or last known if gone); y in [0, max(structureTop+5, by+6, 14)]. */
    actionRect() {
      const L = game.level;
      let bx = 0, by = 2;
      if (game.bird && game.bird.alive) {
        const bp = game.bird.body.getPosition();
        bx = bp.x; by = bp.y;
        game.lastBirdPos = { x: bx, y: bp.y };
      } else if (game.lastBirdPos) {
        bx = game.lastBirdPos.x; by = game.lastBirdPos.y;
      } else if (L && L.sling) {
        const p = game.pouch();
        bx = p.x; by = p.y;
      }
      const structureTop = game.structureBounds ? game.structureBounds.y1 : 8;
      let x0 = bx - 6, x1 = bx + 22;
      if (L && L.bounds) {
        x0 = Math.max(L.bounds.x0, Math.min(L.bounds.x1, x0));
        x1 = Math.max(L.bounds.x0, Math.min(L.bounds.x1, x1));
        if (x1 - x0 < 8) {
          if (x1 <= L.bounds.x0 + 8) { x0 = L.bounds.x0; x1 = Math.min(L.bounds.x1, L.bounds.x0 + 8); }
          else { x1 = L.bounds.x1; x0 = Math.max(L.bounds.x0, L.bounds.x1 - 8); }
        }
      }
      return {
        x0,
        x1,
        y0: 0,
        y1: Math.max(structureTop + 5, by + 6, 14),
      };
    },

    /** Spawn a projectile ent. s: {x,y,vx,vy, shape:'circle'|'box'|'poly', r|w,h|verts, skin,
     *  density, ttl, gravityScale, bullet, sensor, pierce, dmgMul, owner,
     *  explode:{r,dmg,impulse,power}, hitsBlocksOnly, onHit(ent, other, hit) } —
     *  explode/onHit fire on first impact (including sensor contacts & slow hits), or once per
     *  body when pierce:true. */
    spawnProjectile(s) {
      const ent = W().addEnt({
        kind: KIND.PROJ, mat: s.mat || 'proj', shape: s.shape || 'circle',
        r: s.r ?? 0.25, w: s.w, h: s.h, verts: s.verts,
        x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle || 0, skin: s.skin || 'proj',
        density: s.density, ttl: s.ttl ?? 6, gravityScale: s.gravityScale ?? 1,
        bullet: s.bullet ?? true, sensor: !!s.sensor, dmgMul: s.dmgMul ?? 1, owner: s.owner,
        fixedRotation: !!s.fixedRotation, restitution: s.restitution, friction: s.friction,
        angularVelocity: s.angularVelocity, linearDamping: s.linearDamping,
        angularDamping: s.angularDamping, category: s.category,
        mask: s.mask ?? (0xffff & ~CAT.PROJ & ~CAT.BIRD),
        data: s.data ? { ...s.data } : {},
      });
      ent.data.explode = s.explode || null;
      ent.data.onHit = s.onHit || null;
      ent.data.hitsBlocksOnly = !!s.hitsBlocksOnly;
      ent.data.pierce = !!s.pierce;
      ent.data.removeOnExplode = s.removeOnExplode;
      ent.data.hits = 0;
      return ent;
    },

    /** Spawn a bird-clone projectile with skin 'bird:<birdId>' (drawn via BIRDS[birdId].drawBird)
     *  and EV.BIRD_HIT feather/thud emission on >= 5 m/s impacts. Accepts all spawnProjectile opts. */
    spawnClone(birdId, s = {}) {
      const def = BIRDS && BIRDS[birdId];
      const ent = ctx.spawnProjectile({
        ...s,
        shape: s.shape || 'circle',
        r: s.r ?? (def && def.radius ? +(def.radius * 0.65).toFixed(3) : 0.28),
        density: s.density ?? (def && def.density ? def.density : 3.0),
        dmgMul: s.dmgMul ?? 1,
        ttl: s.ttl ?? 6,
        gravityScale: s.gravityScale ?? 1,
        skin: s.skin || `bird:${birdId}`,
        owner: s.owner || birdId,
      });
      ent.data.birdId = birdId;
      return ent;
    },

    explode: (x, y, o) => W().explode(x, y, o),
    damageRay: (x1, y1, x2, y2, o) => W().damageRay(x1, y1, x2, y2, o),
    damageCircle(x, y, r, { dmg = 50, impulse = 0, source = 'aoe', filter = null } = {}) {
      const hits = W().queryCircle(x, y, r, (e) => !e.isStatic && (!filter || filter(e)));
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        const p = e.body.getWorldCenter();
        if (e.kind === KIND.BLOCK || e.kind === KIND.PIG) W().damage(e, dmg, { x: p.x, y: p.y, cause: source });
        if (impulse && e.alive && e.body.isDynamic()) {
          const dx = p.x - x, dy = p.y - y, d = Math.max(0.2, Math.hypot(dx, dy));
          e.body.applyLinearImpulse(new planck.Vec2(dx / d * impulse, dy / d * impulse), p, true);
        }
      }
      return hits;
    },
    damage: (ent, amount, info) => W().damage(ent, amount, info),
    queryCircle: (x, y, r, f) => W().queryCircle(x, y, r, f),

    /** Return all live entities in deterministic id order matching optional filter(ent). */
    allEnts(filter = null) {
      const out = [];
      const ents = W().ents;
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (e.alive && (!filter || filter(e))) out.push(e);
      }
      return out;
    },

    /** Targets within `maxDist` (default 20 m; pass Infinity to opt out) sorted by distance from (x,y).
     *  kinds default ['pig']; falls back to blocks within `maxDist` if no matching targets in range. */
    findTargets({ x, y, kinds = [KIND.PIG], max = 50, maxDist = 20, aheadOnly = false, fallbackBlocks = true } = {}) {
      let ox = x, oy = y;
      if (ox == null || oy == null) {
        const bp = (game.bird && game.bird.alive) ? game.bird.body.getPosition() : (game.lastBirdPos || { x: 0, y: 2 });
        if (ox == null) ox = bp.x;
        if (oy == null) oy = bp.y;
      }
      const maxD2 = maxDist < Infinity ? maxDist * maxDist : Infinity;
      const d2 = (e) => { const p = e.body.getPosition(); return (p.x - ox) ** 2 + (p.y - oy) ** 2; };
      const ents = W().ents;
      const list = [];
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (!e.alive || !kinds.includes(e.kind)) continue;
        const p = e.body.getPosition();
        if (aheadOnly && p.x < ox - 1) continue;
        if (d2(e) <= maxD2) list.push(e);
      }
      if (!list.length && fallbackBlocks) {
        for (let i = 0; i < ents.length; i++) {
          const e = ents[i];
          if (!e.alive || e.kind !== KIND.BLOCK) continue;
          const p = e.body.getPosition();
          if (aheadOnly && p.x < ox - 1) continue;
          if (d2(e) <= maxD2) list.push(e);
        }
      }
      list.sort((a, b) => d2(a) - d2(b) || a.id - b.id);
      return list.slice(0, max);
    },

    applyImpulse(ent, ix, iy) {
      if (ent && ent.alive && ent.body.isDynamic()) {
        ent.body.applyLinearImpulse(new planck.Vec2(ix, iy), ent.body.getWorldCenter(), true);
      }
    },
    setVelocity(ent, vx, vy) {
      if (ent && ent.alive) {
        ent.body.setLinearVelocity(new planck.Vec2(vx, vy));
        ent.body.setAwake(true);
      }
    },

    /** Steer `ent` toward world point (tx, ty) with acceleration `accel` (m/s^2). */
    steer(ent, tx, ty, accel = 30, dt = PHYS.DT) {
      if (!ent || !ent.alive) return ent;
      const p = ent.body.getPosition();
      const dx = tx - p.x, dy = ty - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-4) return ent;
      const ux = dx / dist, uy = dy / dist;
      const v = ent.body.getLinearVelocity();
      const spd = Math.hypot(v.x, v.y);
      if (spd < 1.0) {
        ent.body.setLinearVelocity(new planck.Vec2(v.x + ux * accel * dt, v.y + uy * accel * dt));
      } else {
        const dvx = ux * spd - v.x, dvy = uy * spd - v.y;
        const dmag = Math.hypot(dvx, dvy);
        const stepDv = Math.min(dmag, accel * 1.5 * dt);
        const nvx = dmag > 1e-5 ? v.x + (dvx / dmag) * stepDv : ux * spd;
        const nvy = dmag > 1e-5 ? v.y + (dvy / dmag) * stepDv : uy * spd;
        const nspd = Math.hypot(nvx, nvy) || 1;
        ent.body.setLinearVelocity(new planck.Vec2((nvx / nspd) * spd, (nvy / nspd) * spd));
      }
      ent.body.setAwake(true);
      return ent;
    },

    /** Keep the current bird turn alive (and prevent resting auto-poof) for `sec` sim seconds. */
    holdTurn(sec = 1.0) {
      if (sec > 0 && W()) game.holdUntilT = Math.max(game.holdUntilT || 0, W().time + sec);
    },

    /** Swap `ent`'s fixture to a circle of radius `r`, keeping density (mass ~ r^2) & velocity. */
    resizeCircle(ent, r) {
      if (!ent || !ent.alive || !(r > 0)) return ent;
      const run = () => {
        if (!ent.alive) return;
        const body = ent.body;
        const v = body.getLinearVelocity();
        const vx = v.x, vy = v.y;
        const w = body.getAngularVelocity();
        const oldR = ent.r || 0.45;
        const fx = body.getFixtureList();
        const density = fx ? fx.getDensity() : (MATERIALS[ent.mat]?.density ?? 5);
        const friction = fx ? fx.getFriction() : 0.6;
        const restitution = fx ? fx.getRestitution() : 0.3;
        const isSensor = fx ? fx.isSensor() : !!ent.sensor;
        const cat = fx ? fx.getFilterCategoryBits() : defaultCategory(ent.kind);
        const mask = fx ? fx.getFilterMaskBits() : 0xffff;

        while (body.getFixtureList()) body.destroyFixture(body.getFixtureList());
        body.createFixture(new planck.Circle(r), {
          density, friction, restitution, isSensor,
          filterCategoryBits: cat, filterMaskBits: mask,
        });
        body.resetMassData();
        // Prevent deep ground embedding when growing near y = 0.
        const p = body.getPosition();
        if (r > oldR && p.y - oldR >= -0.15 && p.y < r) {
          body.setPosition(new planck.Vec2(p.x, r + 0.02));
        }
        body.setLinearVelocity(new planck.Vec2(vx, vy));
        body.setAngularVelocity(w);
        body.setAwake(true);
        ent.r = r;
        ent.shape = 'circle';
        ent.area = Math.PI * r * r;
      };
      if (W() && W().pl.isLocked()) W().after(0, run);
      else run();
      return ent;
    },

    /** Toggle sensor state on all fixtures of `ent` and wake its body. */
    setSensor(ent, b) {
      if (!ent || !ent.alive) return ent;
      const flag = !!b;
      const run = () => {
        if (!ent.alive) return;
        for (let fx = ent.body.getFixtureList(); fx; fx = fx.getNext()) fx.setSensor(flag);
        ent.sensor = flag;
        ent.body.setAwake(true);
      };
      if (W() && W().pl.isLocked()) W().after(0, run);
      else run();
      return ent;
    },

    /** Set gravityScale on `ent` and wake its body so anti-gravity/zero-g takes effect immediately. */
    setGravityScale(ent, s) {
      if (!ent || !ent.alive) return ent;
      ent.body.setGravityScale(s);
      ent.body.setAwake(true);
      return ent;
    },

    pos: (ent) => ent.body.getPosition(),
    vel: (ent) => ent.body.getLinearVelocity(),
    removeEnt(ent) {
      if (ent && ent === game.bird && ent.alive) {
        const bp = ent.body.getPosition();
        game.lastBirdPos = { x: bp.x, y: bp.y };
      }
      W().remove(ent);
    },
    addEffect: (e) => W().addEffect(e),
    addTask: (fn, o) => W().addTask(fn, o),
    after: (s, fn) => W().after(s, fn),
    emit: (type, payload) => bus.emit(type, payload),
    juice: (payload) => bus.emit(EV.JUICE, payload),
    sfx: (name, o = {}) => bus.emit(EV.SFX, { name, ...o }),
    banner: (text, sub, o = {}) => bus.emit(EV.BANNER, { text, sub, ...o }),
    planck,
    DT: PHYS.DT,
  };
  return ctx;
}
