// Ability context: the ONLY API bird modules use to touch the sim (owner: physics-core).
// Skeleton by opus-director. Bird modules receive `ctx` in onLaunch/onTap/onStep/onContact.
// Everything here is deterministic (seeded rng, sim time, sim-defined rects — never the camera).

import { KIND, CAT, EV, PHYS } from '../contracts.js';
import { bus } from '../core/bus.js';
import { planck } from './world.js';

export function makeAbilityCtx(game) {
  const W = () => game.world;
  const ctx = {
    get world() { return W(); },
    get time() { return W().time; },
    get level() { return game.level; },
    /** Held pointer in world coords {x,y,down} (input writes it; tests leave it up => auto-aim). */
    get pointer() { return game.pointer; },
    get game() { return game; },
    rng: () => W().rng(),
    range: (a, b) => W().rng.range(a, b),

    /** Sim-defined "screen" rect for full-screen effects: union of structure bounds and the
     *  current bird position, padded. Deterministic (independent of the real viewport). */
    actionRect() {
      const L = game.level;
      const b = game.structureBounds || { x0: 10, x1: 40, y0: 0, y1: 12 };
      const bird = game.bird && game.bird.alive ? game.bird.body.getPosition() : null;
      let x0 = b.x0 - 4, x1 = b.x1 + 4;
      if (bird) { x0 = Math.min(x0, bird.x - 4); x1 = Math.max(x1, bird.x + 6); }
      return { x0: Math.max(L.bounds.x0, x0), x1: Math.min(L.bounds.x1, x1), y0: 0, y1: Math.max(b.y1 + 6, 14) };
    },

    /** Spawn a projectile ent. s: {x,y,vx,vy, shape:'circle'|'box', r|w,h, skin, density,
     *  ttl, gravityScale, bullet, sensor, dmgMul, owner, explode:{r,dmg,impulse,power},
     *  hitsBlocksOnly, onHit(ent, other) } — explode/onHit fire on first impact. */
    spawnProjectile(s) {
      const ent = W().addEnt({
        kind: KIND.PROJ, mat: 'proj', shape: s.shape || 'circle', r: s.r ?? 0.25, w: s.w, h: s.h,
        x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle || 0, skin: s.skin || 'proj',
        density: s.density, ttl: s.ttl ?? 6, gravityScale: s.gravityScale ?? 1,
        bullet: s.bullet ?? true, sensor: !!s.sensor, dmgMul: s.dmgMul ?? 1, owner: s.owner,
        fixedRotation: !!s.fixedRotation, restitution: s.restitution, friction: s.friction,
        angularVelocity: s.angularVelocity, linearDamping: s.linearDamping,
        mask: s.mask ?? (0xffff & ~CAT.PROJ & ~CAT.BIRD),  // projectiles ignore each other + birds
      });
      ent.data.explode = s.explode || null;
      ent.data.onHit = s.onHit || null;
      ent.data.hits = 0;
      return ent;
    },

    explode: (x, y, o) => W().explode(x, y, o),
    damageRay: (x1, y1, x2, y2, o) => W().damageRay(x1, y1, x2, y2, o),
    damageCircle(x, y, r, { dmg = 50, impulse = 0, source = 'aoe', filter = null } = {}) {
      const hits = W().queryCircle(x, y, r, (e) => !e.isStatic && (!filter || filter(e)));
      for (const e of hits) {
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

    /** Targets sorted by distance from (x,y). kinds default ['pig']; falls back to blocks if no pigs. */
    findTargets({ x, y, kinds = [KIND.PIG], max = 50, aheadOnly = false, fallbackBlocks = true } = {}) {
      let list = W().ents.filter((e) => e.alive && kinds.includes(e.kind) && (!aheadOnly || e.body.getPosition().x >= x - 1));
      if (!list.length && fallbackBlocks) list = W().ents.filter((e) => e.alive && e.kind === KIND.BLOCK);
      const d2 = (e) => { const p = e.body.getPosition(); return (p.x - x) ** 2 + (p.y - y) ** 2; };
      list.sort((a, b) => d2(a) - d2(b) || a.id - b.id);
      return list.slice(0, max);
    },

    applyImpulse(ent, ix, iy) { if (ent.alive && ent.body.isDynamic()) ent.body.applyLinearImpulse(new planck.Vec2(ix, iy), ent.body.getWorldCenter(), true); },
    setVelocity(ent, vx, vy) { if (ent.alive) ent.body.setLinearVelocity(new planck.Vec2(vx, vy)); },
    pos: (ent) => ent.body.getPosition(),
    vel: (ent) => ent.body.getLinearVelocity(),
    removeEnt: (ent) => W().remove(ent),
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
