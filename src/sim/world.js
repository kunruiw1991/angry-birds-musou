// SimWorld — planck wrapper, entity model, contact damage, removal (owner: physics-core).
// RULES: deterministic (no Math.random, no Date, no DOM). Never destroy/mutate bodies inside
// planck contact callbacks: queue events and flush after pl.step().

import * as planck from '../../vendor/planck.mjs';
import { PHYS, MATERIALS, PIGS, KIND, CAT, EV, SCORE } from '../contracts.js';
import { bus } from '../core/bus.js';
import { mulberry32 } from '../core/rng.js';

export const IMPACT_MIN_SPEED = 2.1;   // m/s normal approach speed threshold (blocks <=2 m/s slide & resting chatter)
export const DMG_K = 0.85;             // calibrated to DESIGN.md §2 table
const POISON_TICK_S = 0.5;             // emit one aggregated EV.DAMAGE per poisoned ent every 0.5 s
const BIRD_HIT_MIN_SPEED = 5.0;        // emit EV.BIRD_HIT for bird/clone impacts >= 5 m/s
const MAX_EFFECTS = 200;               // DESIGN.md §11 visual effects cap
const AWAKE_LOAD_THRESHOLD = 200;      // drop solver to 6/2 above 200 awake bodies

const ZERO_VEC = new planck.Vec2(0, 0);

export class SimWorld {
  constructor(seed = 1, level = null) {
    this.pl = new planck.World({ gravity: { x: 0, y: -PHYS.GRAVITY }, allowSleep: true });
    this.rng = mulberry32(seed);
    this.seed = seed;
    this.level = level;
    this.ents = [];          // live ents in deterministic ascending id order (render iterates this)
    this.byId = new Map();
    this.nextId = 1;
    this.effects = [];       // Effect[] (visual only)
    this.time = 0;           // sim seconds since level start
    this.frame = 0;
    this.damageEnabled = false;
    this.velIters = PHYS.VEL_ITERS;
    this.posIters = PHYS.POS_ITERS;
    // Deterministic sim stats ONLY (wall-clock timing kept separate for G8 determinism).
    this.stats = { damageDealt: 0, blocksDestroyed: 0, pigsKilled: 0 };

    this._lastStepMs = 0;
    this._stepSamples = new Float32Array(240);
    this._stepIdx = 0;
    this._stepCount = 0;

    this._impacts = [];
    this._beginContacts = [];
    this._removeQ = [];
    this._tasks = [];
    this._nextTasks = [];

    this.onKill = null;          // set by Game: (ent, cause) => number (kill score)
    this.onDamage = null;        // set by Game: (ent, applied, info) => void
    this.onImpact = null;        // set by Game: (a, b, J, v, x, y) => void
    this.onBeginContact = null;  // set by Game: (a, b, x, y, speed, sensor) => void

    this.pl.on('begin-contact', (contact) => this._beginContact(contact));
    this.pl.on('pre-solve', (contact) => this._preSolve(contact));
    this.pl.on('post-solve', (contact, impulse) => this._postSolve(contact, impulse));
  }

  // ---------- entity creation ----------
  /**
   * @param {Object} s  {kind, mat, shape:'box'|'circle'|'poly', x, y, angle, w,h | r | verts,
   *   skin, hp, static, kinematic, bullet, sensor, gravityScale, density, friction, restitution,
   *   vx, vy, angularVelocity, ttl, dmgMul, owner, category, mask, fixedRotation, linearDamping,
   *   angularDamping, allowSleep, data}
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
      ttl: s.ttl, dmgMul: s.dmgMul ?? 1, sensor: !!s.sensor,
      status: {}, data: s.data || {}, owner: s.owner,
      area, isStatic,
      _rawDmgTaken: 0, _hpLost: 0, _lastBirdHitT: -99,
      _poisonActive: false, _poisonAcc: 0, _poisonApplied: 0, _poisonNextT: 0,
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

  _popBalloon(ent) {
    if (!ent || !ent.status || !ent.status.balloon) return;
    delete ent.status.balloon;
    ent.body.setGravityScale(1);
    ent.body.setLinearDamping(0);
    ent.body.setAwake(true);
    const p = ent.body.getPosition();
    bus.emit(EV.SFX, { name: 'balloon_pop', x: p.x, y: p.y });
  }

  // ---------- damage ----------
  /** Apply damage to an ent. Returns HP damage actually applied. */
  damage(ent, amount, info = {}) {
    if (!ent || !ent.alive || !(ent.hp < Infinity) || amount <= 0) return 0;
    const take = info.raw ? 1 : (MATERIALS[ent.mat]?.takeMul ?? 1);
    const dmg = amount * take;
    if (dmg < 0.5 && !info.allowSmall) return 0;
    const applied = Math.min(ent.hp, dmg);
    ent._rawDmgTaken += dmg;
    ent._hpLost += applied;
    ent.hp -= dmg;
    this.stats.damageDealt = +(this.stats.damageDealt + applied).toFixed(4);
    const p = ent.body.getPosition();
    if (ent.status && ent.status.balloon) this._popBalloon(ent);
    const killed = ent.hp <= 0;
    if (!info.quiet) {
      bus.emit(EV.DAMAGE, {
        id: ent.id, kind: ent.kind, mat: ent.mat, amount: Math.round(dmg),
        x: info.x ?? p.x, y: info.y ?? p.y, killed, big: dmg >= 200,
      });
    }
    if (this.onDamage) this.onDamage(ent, applied, info);
    if (killed) this.kill(ent, info.cause || 'damage');
    return applied;
  }

  kill(ent, cause = 'damage') {
    if (!ent || !ent.alive) return;
    ent.hp = 0;
    const p = ent.body.getPosition();
    const px = p.x, py = p.y;
    const v = ent.body.getLinearVelocity();
    const vx = v.x, vy = v.y;
    let killScore = 0;
    if (this.onKill) killScore = this.onKill(ent, cause) || 0;
    if (ent.kind === KIND.PIG) {
      this.stats.pigsKilled++;
      const isBoss = !!(PIGS[ent.skin] && PIGS[ent.skin].boss);
      bus.emit(EV.PIG_POP, {
        id: ent.id, x: px, y: py, r: ent.r, variant: ent.skin,
        boss: isBoss, score: killScore || (SCORE.PIG_KILL * (isBoss ? 4 : 1)),
      });
    } else if (ent.kind === KIND.BLOCK) {
      this.stats.blocksDestroyed++;
      bus.emit(EV.BREAK, {
        id: ent.id, kind: ent.kind, mat: ent.mat, x: px, y: py, w: ent.w, h: ent.h,
        r: ent.r, angle: ent.body.getAngle(), vx, vy, mass: ent.body.getMass(),
      });
      const ex = MATERIALS[ent.mat]?.explode;
      if (ex) this.after(0.05, () => this.explode(px, py, { ...ex, source: 'tnt' }));
    }
    if (ent.status?.poison?.onKill) {
      try { ent.status.poison.onKill(ent, cause); } catch (err) { console.error('[poison.onKill]', err); }
    }
    if (ent.data?.onKill) {
      try { ent.data.onKill(ent, cause); } catch (err) { console.error('[ent.onKill]', err); }
    }
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
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  /** Radial explosion: damage falls off linearly to 30% at the rim; impulse radial. */
  explode(x, y, { r = 2, dmg = 150, impulse = 15, source = 'explosion', power = 'normal', fx = true, sfx = true } = {}) {
    const hits = this.queryCircle(x, y, r, (e) => !e.isStatic);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
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
    if (sfx) bus.emit(EV.SFX, { name: power === 'mega' ? 'mega_explosion' : 'explosion', x, y });
    return hits;
  }

  /** Damage everything whose body intersects the swept segment of given width (pierce). */
  damageRay(x1, y1, x2, y2, { dmg = 80, impulse = 4, width = 0.3, source = 'ray' } = {}) {
    const hits = new Map();
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = len > 1e-6 ? (x2 - x1) / len : 1;
    const uy = len > 1e-6 ? (y2 - y1) / len : 0;
    const halfW = Math.max(0, (width || 0) * 0.5);

    // Catch bodies overlapping the ray origin (Box2D rayCast skips shapes containing p1).
    const originHits = this.queryCircle(x1, y1, Math.max(0.08, halfW), (e) => !e.isStatic);
    for (let i = 0; i < originHits.length; i++) {
      const e = originHits[i];
      const p = e.body.getPosition();
      hits.set(e.id, { e, x: p.x, y: p.y });
    }

    if (len > 1e-4) {
      const nx = -uy, ny = ux;
      const offsets = halfW > 0.04 ? [0, halfW, -halfW] : [0];
      for (let k = 0; k < offsets.length; k++) {
        const off = offsets[k];
        const p1 = new planck.Vec2(x1 + nx * off, y1 + ny * off);
        const p2 = new planck.Vec2(x2 + nx * off, y2 + ny * off);
        this.pl.rayCast(p1, p2, (fx, point) => {
          const e = fx.getBody().getUserData();
          if (e && e.alive && !e.isStatic && !hits.has(e.id)) hits.set(e.id, { e, x: point.x, y: point.y });
          return 1;
        });
      }
    }

    const list = [...hits.values()].sort((a, b) => a.e.id - b.e.id);
    for (let i = 0; i < list.length; i++) {
      const { e, x, y } = list[i];
      if (e.kind === KIND.BLOCK || e.kind === KIND.PIG) this.damage(e, dmg, { x, y, cause: source });
      if (e.alive && e.body.isDynamic()) {
        e.body.applyLinearImpulse(new planck.Vec2(ux * impulse, uy * impulse), new planck.Vec2(x, y), true);
      }
    }
    return list.map((h) => h.e);
  }

  addEffect(e) {
    e.t0 = this.time;
    if (e.ttl == null) e.ttl = 0.6;
    if (this.effects.length >= MAX_EFFECTS) this.effects.shift();
    this.effects.push(e);
    return e;
  }

  // ---------- scheduling (deterministic, sim-time) ----------
  after(seconds, fn) { return this.addTask(() => { fn(); return false; }, { delay: seconds }); }
  /** fn(dt, age) returns true to keep running. */
  addTask(fn, { delay = 0 } = {}) {
    const t = { fn, start: this.time + delay, born: this.time, dead: false };
    this._tasks.push(t);
    return t;
  }
  hasActiveTasks() {
    for (let i = 0; i < this._tasks.length; i++) if (!this._tasks[i].dead) return true;
    return false;
  }

  // ---------- stepping ----------
  step(dt = PHYS.DT) {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    const awake = this.countAwake();
    const vIt = awake > AWAKE_LOAD_THRESHOLD ? 6 : this.velIters;
    const pIt = awake > AWAKE_LOAD_THRESHOLD ? 2 : this.posIters;

    this.pl.step(dt, vIt, pIt);
    this.frame++;
    this.time = this.frame * dt;

    this._processImpacts();
    this._processBeginContacts();
    this._runTasks(dt);
    this._lifecycle(dt);
    this._flushRemovals();
    this._pruneEffects();

    const elapsed = (typeof performance !== 'undefined') ? performance.now() - t0 : 0;
    this._lastStepMs = elapsed;
    this._stepSamples[this._stepIdx] = elapsed;
    this._stepIdx = (this._stepIdx + 1) % this._stepSamples.length;
    this._stepCount++;
  }

  stepPerf() {
    const n = Math.min(this._stepCount, this._stepSamples.length);
    if (!n) return { stepP50: 0, stepP95: 0, lastStepMs: 0, samples: 0 };
    const a = Array.from(this._stepSamples.subarray(0, n)).sort((x, y) => x - y);
    return {
      stepP50: a[Math.min(n - 1, Math.floor(0.5 * n))],
      stepP95: a[Math.min(n - 1, Math.floor(0.95 * n))],
      lastStepMs: this._lastStepMs,
      samples: n,
    };
  }

  _pruneEffects() {
    const fx = this.effects;
    if (!fx.length) return;
    let w = 0;
    for (let i = 0; i < fx.length; i++) {
      if (this.time - fx[i].t0 < fx[i].ttl) fx[w++] = fx[i];
    }
    fx.length = w;
  }

  _runTasks(dt) {
    const tasks = this._tasks;
    if (!tasks.length) return;
    const next = this._nextTasks;
    next.length = 0;
    this._tasks = next;
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (t.dead) continue;
      if (this.time + 1e-9 < t.start) { this._tasks.push(t); continue; }
      let keep = false;
      try { keep = t.fn(dt, Math.max(0, this.time - t.start)); } catch (err) { console.error('[task]', err); }
      if (keep && !t.dead) this._tasks.push(t); else t.dead = true;
    }
    tasks.length = 0;
    this._nextTasks = tasks;
  }

  _lifecycle(dt) {
    const ents = this.ents;
    const hasBounds = !!(this.level && this.level.bounds);
    const minX = hasBounds ? this.level.bounds.x0 - 25 : -Infinity;
    const maxX = hasBounds ? this.level.bounds.x1 + 25 : Infinity;

    let nProj = 0;
    let nDyn = 0;

    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.alive || e.isStatic) continue;

      if (e.ttl != null && this.time - e.spawnT > e.ttl) {
        this.remove(e);
        continue;
      }

      const p = e.body.getPosition();
      if (p.y < PHYS.KILL_Y || p.x < minX || p.x > maxX) {
        if (e.kind === KIND.PIG) this.kill(e, 'fall'); else this.remove(e);
        continue;
      }

      // Poison DoT: aggregate and emit ONE EV.DAMAGE per poisoned ent every 0.5 s (or on kill/expiry).
      const po = e.status.poison;
      if (po && (e.kind === KIND.BLOCK || e.kind === KIND.PIG)) {
        if (!e._poisonActive) {
          e._poisonActive = true;
          e._poisonAcc = 0;
          e._poisonApplied = 0;
          e._poisonNextT = (this.time - dt) + POISON_TICK_S - 1e-6;
        }
        if (this.time <= po.until + 1e-6) {
          const rawStep = po.dps * dt;
          const applied = Math.min(e.hp, rawStep);
          e.hp -= rawStep;
          e._rawDmgTaken += rawStep;
          e._hpLost += applied;
          this.stats.damageDealt = +(this.stats.damageDealt + applied).toFixed(4);
          e._poisonAcc += rawStep;
          e._poisonApplied += applied;
          if (e.status.balloon) this._popBalloon(e);
        }
        const expired = this.time >= po.until - 1e-6;
        const killed = e.hp <= 0;
        if (killed || expired || this.time >= e._poisonNextT) {
          if (e._poisonAcc >= 0.5 || killed) {
            bus.emit(EV.DAMAGE, {
              id: e.id, kind: e.kind, mat: e.mat, amount: Math.max(1, Math.round(e._poisonAcc)),
              x: p.x, y: p.y, killed, big: e._poisonAcc >= 200,
            });
            if (this.onDamage && e._poisonApplied > 0) this.onDamage(e, e._poisonApplied, { cause: 'poison' });
          }
          e._poisonAcc = 0;
          e._poisonApplied = 0;
          e._poisonNextT = this.time + POISON_TICK_S - 1e-6;
          if (killed) {
            this.kill(e, 'poison');
            continue;
          }
          if (expired) {
            delete e.status.poison;
            e._poisonActive = false;
          }
        }
      } else if (e._poisonActive) {
        e._poisonActive = false;
        e._poisonAcc = 0;
        e._poisonApplied = 0;
      }

      if (e.alive) {
        nDyn++;
        if (e.kind === KIND.PROJ) nProj++;
      }
    }

    // Hard cap on live projectiles (oldest culled first).
    if (nProj > PHYS.MAX_PROJECTILES) {
      for (let i = 0; i < ents.length && nProj > PHYS.MAX_PROJECTILES; i++) {
        const e = ents[i];
        if (e.alive && e.kind === KIND.PROJ) {
          this.remove(e);
          nProj--;
          nDyn--;
        }
      }
    }

    // Hard cap on total dynamic bodies (cull projectiles first, then oldest blocks; never pigs/birds).
    if (nDyn > PHYS.MAX_BODIES) {
      for (let i = 0; i < ents.length && nDyn > PHYS.MAX_BODIES; i++) {
        const e = ents[i];
        if (e.alive && e.kind === KIND.PROJ) {
          this.remove(e);
          nDyn--;
        }
      }
      for (let i = 0; i < ents.length && nDyn > PHYS.MAX_BODIES; i++) {
        const e = ents[i];
        if (e.alive && !e.isStatic && e.kind === KIND.BLOCK) {
          this.remove(e);
          nDyn--;
        }
      }
    }
  }

  _flushRemovals() {
    const q = this._removeQ;
    if (!q.length) return;
    for (let i = 0; i < q.length; i++) {
      const e = q[i];
      this.pl.destroyBody(e.body);
      this.byId.delete(e.id);
    }
    q.length = 0;
    const ents = this.ents;
    let w = 0;
    for (let i = 0; i < ents.length; i++) {
      if (ents[i].alive) ents[w++] = ents[i];
    }
    ents.length = w;
  }

  _beginContact(contact) {
    if (!contact.isTouching()) return;
    const fA = contact.getFixtureA(), fB = contact.getFixtureB();
    const bA = fA.getBody(), bB = fB.getBody();
    const a = bA.getUserData(), b = bB.getUserData();
    if (!a || !b || !a.alive || !b.alive) return;
    if (a.kind !== KIND.PROJ && b.kind !== KIND.PROJ && a.kind !== KIND.BIRD && b.kind !== KIND.BIRD) return;

    const sensor = fA.isSensor() || fB.isSensor();
    let px = 0, py = 0;
    const man = !sensor ? contact.getManifold() : null;
    if (man && man.pointCount > 0) {
      const wm = contact.getWorldManifold(null);
      if (wm && wm.points && wm.points[0]) { px = wm.points[0].x; py = wm.points[0].y; }
    } else {
      const mover = (a.kind === KIND.PROJ || a.kind === KIND.BIRD) ? a : b;
      const p = mover.body.getPosition();
      px = p.x; py = p.y;
    }
    const vA = bA.getLinearVelocity(), vB = bB.getLinearVelocity();
    const speed = Math.hypot(vB.x - vA.x, vB.y - vA.y);
    this._beginContacts.push({ a, b, x: px, y: py, speed, sensor });
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

  _maybeEmitBirdHit(ent, other, x, y, speed) {
    if (!ent || !ent.alive || !other || speed < BIRD_HIT_MIN_SPEED) return;
    if (other.kind === KIND.BIRD || other.kind === KIND.PROJ) return;
    const birdId = getBirdHitId(ent);
    if (!birdId) return;
    if (this.time - ent._lastBirdHitT < 0.08) return;
    ent._lastBirdHitT = this.time;
    bus.emit(EV.BIRD_HIT, { birdId, x, y, speed: +speed.toFixed(2) });
  }

  _processImpacts() {
    const list = this._impacts;
    if (!list.length) return;
    for (let i = 0; i < list.length; i++) {
      const { a, b, J, v, x, y } = list[i];
      if (!a || !b) continue;
      this._maybeEmitBirdHit(a, b, x, y, v);
      this._maybeEmitBirdHit(b, a, x, y, v);

      const base = DMG_K * J * v;
      if (a.alive) {
        const inertiaA = Math.min(1, 0.8 / (MATERIALS[a.mat]?.density ?? 0.8));
        this.damage(a, base * inertiaA * (b.dmgMul ?? 1), { x, y, cause: 'impact', by: b });
      }
      if (b.alive) {
        const inertiaB = Math.min(1, 0.8 / (MATERIALS[b.mat]?.density ?? 0.8));
        this.damage(b, base * inertiaB * (a.dmgMul ?? 1), { x, y, cause: 'impact', by: a });
      }
      if (this.onImpact) this.onImpact(a, b, J, v, x, y);
    }
    list.length = 0;
  }

  _processBeginContacts() {
    const list = this._beginContacts;
    if (!list.length) return;
    for (let i = 0; i < list.length; i++) {
      const { a, b, x, y, speed, sensor } = list[i];
      if (!a || !b) continue;
      if (this.damageEnabled) {
        this._maybeEmitBirdHit(a, b, x, y, speed);
        this._maybeEmitBirdHit(b, a, x, y, speed);
      }
      if (this.onBeginContact) this.onBeginContact(a, b, x, y, speed, sensor);
    }
    list.length = 0;
  }

  // ---------- helpers ----------
  settleAndSleep(steps = PHYS.SETTLE_STEPS) {
    const was = this.damageEnabled;
    this.damageEnabled = false;
    const savedDamp = [];
    for (let i = 0; i < this.ents.length; i++) {
      const e = this.ents[i];
      if (e.body.isDynamic()) {
        savedDamp.push([e, e.body.getLinearDamping(), e.body.getAngularDamping()]);
        e.body.setLinearDamping(Math.max(e.body.getLinearDamping(), 0.15));
        const ad = e.shape === 'circle' ? 3.0 : 0.3;
        e.body.setAngularDamping(Math.max(e.body.getAngularDamping(), ad));
      }
    }
    for (let i = 0; i < steps; i++) this.pl.step(PHYS.DT, 12, 6);
    for (let i = 0; i < savedDamp.length; i++) {
      const [e, ld, ad] = savedDamp[i];
      e.body.setLinearDamping(ld);
      e.body.setAngularDamping(ad);
      e.body.setLinearVelocity(ZERO_VEC);
      e.body.setAngularVelocity(0);
      e.body.setAwake(false);
    }
    this._impacts.length = 0;
    this._beginContacts.length = 0;
    this.damageEnabled = was;
  }

  countAwake() {
    let n = 0;
    for (let i = 0; i < this.ents.length; i++) {
      const e = this.ents[i];
      if (e.alive && !e.isStatic && e.body.isAwake()) n++;
    }
    return n;
  }

  hasPoisonedPigs() {
    for (let i = 0; i < this.ents.length; i++) {
      const e = this.ents[i];
      if (e.alive && e.kind === KIND.PIG && e.status.poison) return true;
    }
    return false;
  }

  pigs() {
    const out = [];
    for (let i = 0; i < this.ents.length; i++) {
      const e = this.ents[i];
      if (e.alive && e.kind === KIND.PIG) out.push(e);
    }
    return out;
  }

  destroy() {
    this.ents.length = 0;
    this.byId.clear();
    this.effects.length = 0;
    this._tasks.length = 0;
    this._nextTasks.length = 0;
    this._impacts.length = 0;
    this._beginContacts.length = 0;
    this._removeQ.length = 0;
  }
}

export function getBirdHitId(ent) {
  if (ent.kind === KIND.BIRD) return ent.data.birdId || ent.skin || null;
  if (ent.kind === KIND.PROJ) {
    if (ent.data.birdId) return ent.data.birdId;
    if (typeof ent.skin === 'string' && ent.skin.startsWith('bird:')) return ent.skin.slice(5);
  }
  return null;
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
function polyArea(vs) {
  let a = 0;
  for (let i = 0; i < vs.length; i++) {
    const p = vs[i], q = vs[(i + 1) % vs.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}
export { planck };
