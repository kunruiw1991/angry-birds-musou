// SimWorld — planck wrapper, entity model, contact damage, removal (owner: physics-core).
// Skeleton by opus-director: functional baseline; physics-core hardens/tunes it.
// RULES: deterministic (no Math.random, no Date, no DOM). Never destroy bodies inside planck
// callbacks: queue via this.remove(ent) and flush after step.

import * as planck from '../../vendor/planck.mjs';
import { PHYS, MATERIALS, PIGS, KIND, CAT, EV, SCORE } from '../contracts.js';
import { bus } from '../core/bus.js';
import { mulberry32 } from '../core/rng.js';

const IMPACT_MIN_SPEED = 1.0;   // m/s approach speed below which contacts deal no damage (TUNE)
const DMG_K = 1.0;              // damage = DMG_K * J * vApproach * takeMul * dmgMul (TUNE)

export class SimWorld {
  constructor(seed = 1, level = null) {
    this.pl = new planck.World({ gravity: { x: 0, y: -PHYS.GRAVITY }, allowSleep: true });
    this.rng = mulberry32(seed);
    this.seed = seed;
    this.level = level;
    this.ents = [];          // live ents (render iterates this)
    this.byId = new Map();
    this.nextId = 1;
    this.effects = [];       // Effect[] (visual only)
    this.time = 0;           // sim seconds since level start
    this.frame = 0;
    this.damageEnabled = false;
    this.velIters = PHYS.VEL_ITERS;
    this.posIters = PHYS.POS_ITERS;
    this.stats = { damageDealt: 0, blocksDestroyed: 0, pigsKilled: 0, lastStepMs: 0 };
    this._impacts = [];
    this._removeQ = [];
    this.onKill = null;      // set by Game: (ent, cause) => void (scoring)

    this.pl.on('pre-solve', (contact) => this._preSolve(contact));
    this.pl.on('post-solve', (contact, impulse) => this._postSolve(contact, impulse));
  }

  // ---------- entity creation ----------
  /**
   * @param {Object} s  {kind, mat, shape:'box'|'circle'|'poly', x, y, angle, w,h | r | verts,
   *   skin, hp, static, bullet, sensor, gravityScale, density, friction, restitution,
   *   vx, vy, angularVelocity, ttl, dmgMul, owner, category, mask, fixedRotation, linearDamping}
   */
  addEnt(s) {
    const matDef = MATERIALS[s.mat] || MATERIALS.wood;
    const isStatic = !!s.static;
    const body = this.pl.createBody({
      type: isStatic ? 'static' : (s.kinematic ? 'kinematic' : 'dynamic'),
      position: { x: s.x, y: s.y },
      angle: s.angle || 0,
      bullet: !!s.bullet,
      fixedRotation: !!s.fixedRotation,
      gravityScale: s.gravityScale ?? 1,
      linearDamping: s.linearDamping ?? 0,
      angularDamping: s.angularDamping ?? 0.05,
      allowSleep: s.allowSleep ?? true,
    });
    let shape;
    if (s.shape === 'circle') shape = new planck.Circle(s.r);
    else if (s.shape === 'poly') shape = new planck.Polygon(s.verts.map((v) => new planck.Vec2(v.x, v.y)));
    else shape = new planck.Box(s.w / 2, s.h / 2);
    const cat = s.category ?? defaultCategory(s.kind);
    body.createFixture(shape, {
      density: s.density ?? matDef.density,
      friction: s.friction ?? matDef.friction,
      restitution: s.restitution ?? matDef.restitution,
      isSensor: !!s.sensor,
      filterCategoryBits: cat,
      filterMaskBits: s.mask ?? 0xffff,
    });
    if (s.vx || s.vy) body.setLinearVelocity(new planck.Vec2(s.vx || 0, s.vy || 0));
    if (s.angularVelocity) body.setAngularVelocity(s.angularVelocity);

    const area = s.shape === 'circle' ? Math.PI * s.r * s.r
      : s.shape === 'poly' ? polyArea(s.verts) : s.w * s.h;
    let hp = s.hp;
    if (hp == null) {
      if (s.kind === KIND.PIG) hp = (PIGS[s.skin] || PIGS.pig).hp;
      else if (s.kind === KIND.BLOCK) hp = Math.round(matDef.hp * clamp(area / 0.3, 0.5, 3.0));
      else hp = Infinity;
    }
    const ent = {
      id: this.nextId++, kind: s.kind, mat: s.mat, shape: s.shape || 'box',
      w: s.w, h: s.h, r: s.r, verts: s.verts, hp, maxHp: hp,
      skin: s.skin || s.mat, alive: true, body, spawnT: this.time,
      ttl: s.ttl, dmgMul: s.dmgMul ?? 1, status: {}, data: s.data || {}, owner: s.owner,
      area, isStatic,
    };
    body.setUserData(ent);
    this.ents.push(ent);
    this.byId.set(ent.id, ent);
    return ent;
  }

  remove(ent) {
    if (!ent || !ent.alive) return;
    ent.alive = false;
    this._removeQ.push(ent);
  }

  // ---------- damage ----------
  /** Apply damage to an ent. Returns damage actually applied. */
  damage(ent, amount, info = {}) {
    if (!ent || !ent.alive || !(ent.hp < Infinity) || amount <= 0) return 0;
    const take = (MATERIALS[ent.mat]?.takeMul ?? 1) * (info.raw ? 1 : 1);
    const dmg = info.raw ? amount : amount * take;
    if (dmg < 0.5) return 0;
    const applied = Math.min(ent.hp, dmg);
    ent.hp -= dmg;
    this.stats.damageDealt += applied;
    const p = ent.body.getPosition();
    const killed = ent.hp <= 0;
    bus.emit(EV.DAMAGE, {
      id: ent.id, kind: ent.kind, mat: ent.mat, amount: Math.round(dmg),
      x: info.x ?? p.x, y: info.y ?? p.y, killed, big: dmg >= 200,
    });
    if (this.onDamage) this.onDamage(ent, applied, info);
    if (killed) this.kill(ent, info.cause || 'damage');
    return applied;
  }

  kill(ent, cause = 'damage') {
    if (!ent.alive) return;
    const p = ent.body.getPosition();
    const v = ent.body.getLinearVelocity();
    if (ent.kind === KIND.PIG) {
      this.stats.pigsKilled++;
      bus.emit(EV.PIG_POP, { id: ent.id, x: p.x, y: p.y, r: ent.r, variant: ent.skin,
        boss: !!(PIGS[ent.skin] && PIGS[ent.skin].boss), score: SCORE.PIG_KILL });
    } else if (ent.kind === KIND.BLOCK) {
      this.stats.blocksDestroyed++;
      bus.emit(EV.BREAK, { id: ent.id, kind: ent.kind, mat: ent.mat, x: p.x, y: p.y, w: ent.w, h: ent.h,
        r: ent.r, angle: ent.body.getAngle(), vx: v.x, vy: v.y, mass: ent.body.getMass() });
      const ex = MATERIALS[ent.mat]?.explode;
      if (ex) this.after(0.05, () => this.explode(p.x, p.y, { ...ex, source: 'tnt' }));
    }
    if (this.onKill) this.onKill(ent, cause);
    this.remove(ent);
  }

  // ---------- AoE / queries ----------
  queryCircle(x, y, r, filter = null) {
    const out = [];
    const aabb = new planck.AABB(new planck.Vec2(x - r, y - r), new planck.Vec2(x + r, y + r));
    const seen = new Set();
    this.pl.queryAABB(aabb, (fx) => {
      const ent = fx.getBody().getUserData();
      if (!ent || !ent.alive || seen.has(ent.id)) return true;
      seen.add(ent.id);
      const p = ent.body.getPosition();
      const er = ent.r || Math.max(ent.w || 0, ent.h || 0) / 2;
      if (Math.hypot(p.x - x, p.y - y) <= r + er && (!filter || filter(ent))) out.push(ent);
      return true;
    });
    out.sort((a, b) => a.id - b.id);  // deterministic order
    return out;
  }

  /** Radial explosion: damage falls off linearly to 30% at the rim; impulse radial. */
  explode(x, y, { r = 2, dmg = 150, impulse = 15, source = 'explosion', power = 'normal', fx = true } = {}) {
    const hits = this.queryCircle(x, y, r, (e) => !e.isStatic);
    for (const e of hits) {
      const p = e.body.getWorldCenter();
      const dx = p.x - x, dy = p.y - y;
      const d = Math.max(0.2, Math.hypot(dx, dy));
      const fall = 1 - 0.7 * Math.min(1, d / r);
      if (e.kind === KIND.BLOCK || e.kind === KIND.PIG) this.damage(e, dmg * fall, { x: p.x, y: p.y, cause: source });
      if (e.alive && e.body.isDynamic()) {
        const j = impulse * fall * Math.min(3, Math.max(0.4, e.body.getMass()));
        e.body.applyLinearImpulse(new planck.Vec2(dx / d * j, dy / d * j + j * 0.25), p, true);
      }
    }
    if (fx) this.addEffect({ type: 'explosion', x, y, r, power, ttl: power === 'mega' ? 1.2 : 0.7 });
    bus.emit(EV.EXPLOSION, { x, y, r, power });
    return hits;
  }

  /** Damage everything whose body intersects the segment (pierce). */
  damageRay(x1, y1, x2, y2, { dmg = 80, impulse = 4, width = 0.3, source = 'ray' } = {}) {
    const hits = new Map();
    const p1 = new planck.Vec2(x1, y1), p2 = new planck.Vec2(x2, y2);
    this.pl.rayCast(p1, p2, (fx, point) => {
      const e = fx.getBody().getUserData();
      if (e && e.alive && !e.isStatic && !hits.has(e.id)) hits.set(e.id, { e, x: point.x, y: point.y });
      return 1;  // continue full length
    });
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const list = [...hits.values()].sort((a, b) => a.e.id - b.e.id);
    for (const { e, x, y } of list) {
      if (e.kind === KIND.BLOCK || e.kind === KIND.PIG) this.damage(e, dmg, { x, y, cause: source });
      if (e.alive && e.body.isDynamic()) e.body.applyLinearImpulse(new planck.Vec2(ux * impulse, uy * impulse), new planck.Vec2(x, y), true);
    }
    return list.map((h) => h.e);
  }

  addEffect(e) {
    e.t0 = this.time;
    if (e.ttl == null) e.ttl = 0.6;
    this.effects.push(e);
    return e;
  }

  // ---------- scheduling (deterministic, sim-time) ----------
  after(seconds, fn) { return this.addTask(() => { fn(); return false; }, { delay: seconds }); }
  /** fn(dt, age) returns true to keep running. */
  addTask(fn, { delay = 0 } = {}) {
    const t = { fn, start: this.time + delay, born: this.time, dead: false };
    (this._tasks ||= []).push(t);
    return t;
  }

  // ---------- stepping ----------
  step(dt = PHYS.DT) {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    this.pl.step(dt, this.velIters, this.posIters);
    this.time += dt;
    this.frame++;
    this._processImpacts();
    this._runTasks(dt);
    this._lifecycle();
    this._flushRemovals();
    if (this.effects.length) this.effects = this.effects.filter((e) => this.time - e.t0 < e.ttl);
    this.stats.lastStepMs = (typeof performance !== 'undefined') ? performance.now() - t0 : 0;
  }

  _runTasks(dt) {
    if (!this._tasks || !this._tasks.length) return;
    const tasks = this._tasks;
    this._tasks = [];
    for (const t of tasks) {
      if (t.dead) continue;
      if (this.time < t.start) { this._tasks.push(t); continue; }
      let keep = false;
      try { keep = t.fn(dt, this.time - t.start); } catch (err) { console.error('[task]', err); }
      if (keep) this._tasks.push(t); else t.dead = true;
    }
  }

  _lifecycle() {
    for (const e of this.ents) {
      if (!e.alive) continue;
      if (e.ttl != null && this.time - e.spawnT > e.ttl) { this.remove(e); continue; }
      const p = e.body.getPosition();
      if (p.y < PHYS.KILL_Y || (this.level && (p.x < this.level.bounds.x0 - 25 || p.x > this.level.bounds.x1 + 25))) {
        if (e.kind === KIND.PIG) this.kill(e, 'fall'); else this.remove(e);
      }
      // poison DoT (status.poison = {dps, until})
      const po = e.status.poison;
      if (po && e.alive) {
        if (this.time > po.until) delete e.status.poison;
        else this.damage(e, po.dps * PHYS.DT, { cause: 'poison', raw: true, quiet: true });
      }
    }
    // projectile cap
    let nProj = 0;
    for (const e of this.ents) if (e.alive && e.kind === KIND.PROJ) nProj++;
    if (nProj > PHYS.MAX_PROJECTILES) {
      for (const e of this.ents) {
        if (nProj <= PHYS.MAX_PROJECTILES) break;
        if (e.alive && e.kind === KIND.PROJ) { this.remove(e); nProj--; }
      }
    }
  }

  _flushRemovals() {
    if (!this._removeQ.length) return;
    for (const e of this._removeQ) {
      this.pl.destroyBody(e.body);
      this.byId.delete(e.id);
    }
    this._removeQ.length = 0;
    this.ents = this.ents.filter((e) => e.alive);
  }

  _preSolve(contact) {
    contact.__v = 0;
    if (!this.damageEnabled) return;
    const fA = contact.getFixtureA(), fB = contact.getFixtureB();
    if (fA.isSensor() || fB.isSensor()) return;
    const man = contact.getManifold();
    if (!man || man.pointCount === 0) return;
    const wm = contact.getWorldManifold(null);
    if (!wm) return;
    const p = wm.points[0];
    const bA = fA.getBody(), bB = fB.getBody();
    const vA = bA.getLinearVelocityFromWorldPoint(p), vB = bB.getLinearVelocityFromWorldPoint(p);
    const vn = (vB.x - vA.x) * wm.normal.x + (vB.y - vA.y) * wm.normal.y;
    if (vn < -IMPACT_MIN_SPEED) { contact.__v = -vn; contact.__px = p.x; contact.__py = p.y; }
  }

  _postSolve(contact, impulse) {
    const v = contact.__v;
    if (!v) return;
    let J = 0;
    const n = impulse.normalImpulses;
    for (let i = 0; i < n.length; i++) J += n[i];
    if (J <= 0) return;
    const a = contact.getFixtureA().getBody().getUserData();
    const b = contact.getFixtureB().getBody().getUserData();
    this._impacts.push({ a, b, J, v, x: contact.__px, y: contact.__py });
  }

  _processImpacts() {
    if (!this._impacts.length) return;
    const list = this._impacts;
    this._impacts = [];
    for (const { a, b, J, v, x, y } of list) {
      const base = DMG_K * J * v;
      if (a && a.alive && b) this.damage(a, base * (b.dmgMul ?? 1), { x, y, cause: 'impact', by: b });
      if (b && b.alive && a) this.damage(b, base * (a.dmgMul ?? 1), { x, y, cause: 'impact', by: a });
      if (this.onImpact) this.onImpact(a, b, J, v, x, y);
    }
  }

  // ---------- helpers ----------
  settleAndSleep(steps = PHYS.SETTLE_STEPS) {
    const was = this.damageEnabled;
    this.damageEnabled = false;
    for (let i = 0; i < steps; i++) this.pl.step(PHYS.DT, this.velIters, this.posIters);
    for (const e of this.ents) if (e.body.isDynamic()) { e.body.setLinearVelocity(new planck.Vec2(0, 0)); e.body.setAngularVelocity(0); e.body.setAwake(false); }
    this.damageEnabled = was;
  }

  countAwake() { let n = 0; for (const e of this.ents) if (e.alive && e.body.isDynamic() && e.body.isAwake()) n++; return n; }
  pigs() { return this.ents.filter((e) => e.alive && e.kind === KIND.PIG); }
  destroy() { this.ents = []; this.byId.clear(); this.effects = []; this._tasks = []; }
}

export function defaultCategory(kind) {
  switch (kind) {
    case KIND.GROUND: case KIND.TERRAIN: return CAT.STATIC;
    case KIND.PIG: return CAT.PIG;
    case KIND.BIRD: return CAT.BIRD;
    case KIND.PROJ: return CAT.PROJ;
    default: return CAT.BLOCK;
  }
}
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function polyArea(vs) { let a = 0; for (let i = 0; i < vs.length; i++) { const p = vs[i], q = vs[(i + 1) % vs.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; }
export { planck };
