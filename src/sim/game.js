// Game: level build, bird queue, turn flow, scoring, stars (owner: physics-core).
// Deterministic: no DOM, no localStorage, no Math.random, no wall-clock values in getState().

import { PHYS, SLING, KIND, EV, STATE, SCORE, MATERIALS, PIGS } from '../contracts.js';
import { bus } from '../core/bus.js';
import { SimWorld } from './world.js';
import { makeAbilityCtx } from './ability_ctx.js';
import { BIRDS } from '../birds/index.js';
import { LEVELS, getLevel } from '../levels/levels.js';

const TURN_TIMEOUT_S = 12;       // hard cap per bird turn
const REST_SPEED = 0.35;         // bird considered resting below this speed (m/s)
const REST_TIME = 1.2;           // seconds resting before the bird poofs
const CLEAR_GRACE_S = 1.2;       // after the last pig dies, let the chaos play before CLEAR
const SETTLE_MAX_S = 2.5;        // after out of birds, wait up to 2.5 s before FAIL

export class Game {
  constructor() {
    this.state = STATE.TITLE;
    this.world = null;
    this.level = null;
    this.ctx = makeAbilityCtx(this);
    this.score = 0;
    this._dmgScoreCarry = 0;
    this.stars = 0;
    this.combo = 0;
    this._lastKillT = -99;
    this.holdUntilT = 0;
    this.lastBirdPos = { x: 0, y: 2 };
    this.settleStats = { moved: 0, maxDrift: 0, maxRot: 0 };
    this._settleOffenders = [];
    this._bestByLevel = new Map();
    this.pointer = { x: 0, y: 0, down: false };  // world-space pointer, written by ui/input.js (白公主 aiming)
  }

  setState(s) {
    const prev = this.state;
    if (prev === s) return;
    this.state = s;
    bus.emit(EV.STATE, { state: s, prev });
  }

  // ---------------- level lifecycle ----------------
  startLevel(id, { seed = 1, birds = null } = {}) {
    const L = getLevel(id);
    if (!L) throw new Error(`unknown level ${id}`);
    if (this.world) this.world.destroy();
    this.level = L;
    this.seed = seed;
    const w = this.world = new SimWorld(seed, L);
    w.onKill = (e, cause) => this._onKill(e, cause);
    w.onDamage = (e, applied) => this._onDamage(e, applied);
    w.onImpact = (a, b, J, v, x, y) => this._onImpact(a, b, J, v, x, y);
    w.onBeginContact = (a, b, x, y, speed, sensor) => this._onBeginContact(a, b, x, y, speed, sensor);

    this.score = 0;
    this._dmgScoreCarry = 0;
    this.stars = 0;
    this.combo = 0;
    this._lastKillT = -99;
    this.holdUntilT = 0;
    this.lastBirdPos = this.pouch();
    this.queue = (birds && birds.length ? birds : L.birds).slice();
    this.birdIndex = 0;
    this.birdsUsed = 0;
    this.bird = null;
    this.abilityUsed = false;
    this.flightT = 0; this.restT = 0; this.clearT = null; this.turnT = 0; this.settleT = 0;
    this.firstPigKillT = null; this.launchT = null; this.abilityT = null;
    this.events = [];   // compact deterministic log for tests: {t, type, ...}

    // Ground (static) spanning bounds
    w.addEnt({
      kind: KIND.GROUND, mat: 'terrain', static: true, shape: 'box',
      x: (L.bounds.x0 + L.bounds.x1) / 2, y: -2, w: (L.bounds.x1 - L.bounds.x0) + 80, h: 4,
    });
    for (const t of L.terrain || []) {
      if (t.verts) {
        w.addEnt({
          kind: KIND.TERRAIN, mat: 'terrain', static: true, shape: 'poly',
          x: t.x || 0, y: t.y || 0, verts: t.verts.map(([x, y]) => ({ x, y })),
        });
      } else {
        w.addEnt({ kind: KIND.TERRAIN, mat: 'terrain', static: true, shape: 'box', x: t.x, y: t.y, w: t.w, h: t.h, angle: t.a || 0 });
      }
    }
    for (const b of L.blocks || []) {
      const shape = b.s === 'circle' ? 'circle' : b.s === 'tri' || b.s === 'poly' ? 'poly' : 'box';
      const verts = b.s === 'tri' ? [{ x: -b.w / 2, y: -b.h / 2 }, { x: b.w / 2, y: -b.h / 2 }, { x: -b.w / 2, y: b.h / 2 }]
        : b.verts ? b.verts.map(([x, y]) => ({ x, y })) : undefined;
      w.addEnt({
        kind: KIND.BLOCK, mat: b.m || 'wood', shape, x: b.x, y: b.y, w: b.w, h: b.h, r: b.r,
        verts, angle: b.a || 0, skin: b.m || 'wood',
      });
    }
    for (const p of L.pigs || []) {
      const v = PIGS[p.v || 'pig'] || PIGS.pig;
      const e = w.addEnt({
        kind: KIND.PIG, mat: 'pig', shape: 'circle', x: p.x, y: p.y, r: p.r || v.r,
        skin: p.v || 'pig', hp: p.hp ?? v.hp,
        gravityScale: p.balloon ? 0 : 1, linearDamping: p.balloon ? 1.5 : 0,
      });
      if (p.balloon) e.status.balloon = true;
    }

    const authoredPose = [];
    for (let i = 0; i < w.ents.length; i++) {
      const e = w.ents[i];
      if (e.kind === KIND.BLOCK || e.kind === KIND.PIG) {
        const p = e.body.getPosition();
        authoredPose.push({ id: e.id, kind: e.kind, mat: e.mat, x: p.x, y: p.y, a: e.body.getAngle() });
      }
    }

    w.settleAndSleep(PHYS.SETTLE_STEPS);

    let settleMoved = 0, maxDrift = 0, maxRot = 0;
    const settleOffenders = [];
    for (let i = 0; i < authoredPose.length; i++) {
      const ap = authoredPose[i];
      const e = w.byId.get(ap.id);
      if (!e || !e.alive) {
        settleMoved++;
        settleOffenders.push({ id: ap.id, kind: ap.kind, mat: ap.mat, x0: +ap.x.toFixed(3), y0: +ap.y.toFixed(3), drift: 999, rot: 0 });
        continue;
      }
      const p = e.body.getPosition();
      const a = e.body.getAngle();
      const drift = Math.hypot(p.x - ap.x, p.y - ap.y);
      const rot = Math.abs(Math.atan2(Math.sin(a - ap.a), Math.cos(a - ap.a)));
      if (drift > maxDrift) maxDrift = drift;
      if (rot > maxRot) maxRot = rot;
      if (drift > 0.10 || rot > 0.05) {
        settleMoved++;
        settleOffenders.push({
          id: ap.id, kind: ap.kind, mat: ap.mat,
          x0: +ap.x.toFixed(3), y0: +ap.y.toFixed(3), a0: +ap.a.toFixed(3),
          x1: +p.x.toFixed(3), y1: +p.y.toFixed(3), a1: +a.toFixed(3),
          drift: +drift.toFixed(4), rot: +rot.toFixed(4),
        });
      }
    }
    this.settleStats = { moved: settleMoved, maxDrift: +maxDrift.toFixed(4), maxRot: +maxRot.toFixed(4) };
    this._settleOffenders = settleOffenders;

    this.structureBounds = computeBounds(w.ents);
    this.initialPose = new Map();
    for (let i = 0; i < w.ents.length; i++) {
      const e = w.ents[i];
      if (e.kind === KIND.BLOCK || e.kind === KIND.PIG) {
        const p = e.body.getPosition();
        this.initialPose.set(e.id, { x: p.x, y: p.y, a: e.body.getAngle(), kind: e.kind });
      }
    }
    w.time = 0; w.frame = 0;
    w.after(PHYS.DAMAGE_GRACE_S, () => { w.damageEnabled = true; });
    this.pigsAtStart = w.pigs().length;
    this.blocksAtStart = w.ents.filter((e) => e.alive && e.kind === KIND.BLOCK).length;
    bus.emit(EV.LEVEL_START, { levelId: L.id, biome: L.biome });
    this.setState(STATE.AIM);
    this._emitBirdReady();
    return this.getState();
  }

  get currentBirdId() { return this.queue ? (this.queue[this.birdIndex] ?? null) : null; }
  get birdsLeft() {
    if (!this.queue) return 0;
    return Math.max(0, this.queue.length - this.birdIndex - (this.state === STATE.FLIGHT ? 1 : 0));
  }

  /** Pouch rest point (world). */
  pouch() { const s = this.level.sling; return { x: s.x, y: s.y + SLING.FORK_HEIGHT }; }

  // ---------------- player actions ----------------
  /** angleDeg: 0 = right, 90 = up. power in [0,1]. Returns true if launched. */
  launch(angleDeg, power) {
    if (this.state !== STATE.AIM || this.clearT != null || !this.currentBirdId) return false;
    power = Math.max(0, Math.min(1, power));
    if (power < SLING.MIN_POWER) return false;
    const def = BIRDS[this.currentBirdId];
    if (!def) return false;
    const a = angleDeg * Math.PI / 180;
    const rest = this.pouch();
    const pull = power * SLING.MAX_PULL;
    const x = rest.x - Math.cos(a) * pull, y = Math.max(rest.y - Math.sin(a) * pull, 0.6);
    const speed = power * SLING.MAX_SPEED;
    const vx = Math.cos(a) * speed, vy = Math.sin(a) * speed;
    const r = def.radius ?? 0.45;
    // Launching enables contact damage immediately if still in initial 0.5 s grace.
    this.world.damageEnabled = true;
    const bird = this.world.addEnt({
      kind: KIND.BIRD, mat: 'bird', shape: 'circle', r, x, y,
      vx, vy, skin: def.id, density: def.density ?? 5,
      bullet: true, dmgMul: def.dmgMul ?? 1, angularDamping: 0.6,
    });
    bird.data.birdId = def.id;
    this.bird = bird;
    this.lastBirdPos = { x, y };
    this.abilityUsed = false;
    this.holdUntilT = 0;
    this.flightT = 0; this.restT = 0; this.turnT = 0;
    this.birdsUsed++;
    this.launchT = +this.world.time.toFixed(4);
    this.abilityT = null;
    this.setState(STATE.FLIGHT);
    this._log('launch', { bird: def.id, angleDeg: +angleDeg.toFixed(2), power: +power.toFixed(3) });
    bus.emit(EV.LAUNCH, { birdId: def.id, x, y, vx, vy, power });
    bus.emit(EV.SFX, { name: 'launch', x, y });
    try { def.onLaunch && def.onLaunch(this.ctx, bird); } catch (err) { console.error('[onLaunch]', err); }
    return true;
  }

  /** Trigger the current bird's 10x ability. target = {x,y} world point or null (auto). */
  useAbility(target = null) {
    if (this.state !== STATE.FLIGHT || this.abilityUsed || !this.bird) return false;
    const def = BIRDS[this.bird.data.birdId];
    if (!def || !def.onTap) return false;
    this.abilityUsed = true;
    this.abilityT = +this.world.time.toFixed(4);
    const p = this.bird.alive ? this.bird.body.getPosition() : (this.lastBirdPos || target || { x: 0, y: 0 });
    if (this.bird.alive) this.lastBirdPos = { x: p.x, y: p.y };
    this._log('ability', { bird: def.id });
    bus.emit(EV.ABILITY, { birdId: def.id, x: p.x, y: p.y, name: def.ability });
    try { def.onTap(this.ctx, this.bird, target); } catch (err) { console.error('[onTap]', err); }
    return true;
  }

  /** Player skips the rest of this turn ("下一只"). */
  skipTurn() {
    if (this.state !== STATE.FLIGHT) return false;
    if (this.clearT != null || this.world.pigs().length === 0) {
      this._finish(true);
      return true;
    }
    this._endTurn('skip');
    return true;
  }

  // ---------------- stepping ----------------
  step(dt = PHYS.DT) {
    if (!this.world || this.state === STATE.TITLE || this.state === STATE.PAUSED ||
        this.state === STATE.CLEAR || this.state === STATE.FAIL) return;
    const w = this.world;

    // Bird module per-step hook while flight is active.
    if (this.state === STATE.FLIGHT && this.bird) {
      if (this.bird.alive) {
        const bp = this.bird.body.getPosition();
        this.lastBirdPos = { x: bp.x, y: bp.y };
      }
      const def = BIRDS[this.bird.data.birdId];
      if (def && def.onStep) {
        try { def.onStep(this.ctx, this.bird, dt); } catch (err) { console.error('[onStep]', err); }
      }
    }

    w.step(dt);
    if (this.bird && this.bird.alive) {
      const bp = this.bird.body.getPosition();
      this.lastBirdPos = { x: bp.x, y: bp.y };
    }

    // Check last-pig-dead celebration trigger before turn/settle auto-transitions.
    const pigsLeft = w.pigs().length;
    if (this.clearT == null && this.pigsAtStart > 0 && pigsLeft === 0 &&
        (this.state === STATE.FLIGHT || this.state === STATE.SETTLE || this.state === STATE.AIM)) {
      this.clearT = w.time;
      bus.emit(EV.BANNER, { text: '全灭！', big: true, color: '#ffcc00' });
      bus.emit(EV.JUICE, { slowmo: { scale: 0.35, dur: 0.8 } });
    }
    if (this.clearT != null) {
      if (w.time - this.clearT >= CLEAR_GRACE_S && this.state !== STATE.CLEAR) this._finish(true);
      return;
    }

    if (this.state === STATE.FLIGHT) this._updateTurn(dt);
    else if (this.state === STATE.SETTLE) this._updateSettle(dt);
  }

  _updateTurn(dt) {
    const w = this.world;
    this.flightT += dt;
    this.turnT += dt;
    const tasksLive = w.hasActiveTasks();
    const holdLive = w.time < this.holdUntilT;
    const abilityBusy = tasksLive || holdLive;

    const b = this.bird;
    if (b && b.alive) {
      if (abilityBusy) {
        this.restT = 0;
      } else {
        const v = b.body.getLinearVelocity();
        const p = b.body.getPosition();
        const spd = Math.hypot(v.x, v.y);
        // Gentle ground rolling resistance for slow trickle (< 3 m/s) so missed shots settle naturally.
        if (spd > 0.05 && spd < 3.0 && Math.abs(v.y) < 0.25 && p.y <= (b.r || 0.45) + 0.06) {
          const damp = Math.max(0, 1 - 1.5 * dt);
          b.body.setLinearVelocity({ x: v.x * damp, y: v.y });
        }
        if (spd < REST_SPEED) this.restT += dt; else this.restT = 0;
        if (this.restT > REST_TIME) { w.remove(b); bus.emit(EV.SFX, { name: 'poof' }); }
      }
    }

    const birdDone = !b || !b.alive;
    let projLive = false;
    for (let i = 0; i < w.ents.length; i++) {
      if (w.ents[i].alive && w.ents[i].kind === KIND.PROJ) { projLive = true; break; }
    }
    const settled = w.countAwake() <= 2;
    if ((birdDone && !projLive && !abilityBusy && settled && this.turnT > 1.0) || this.turnT > TURN_TIMEOUT_S) {
      this._endTurn('auto');
    }
  }

  _endTurn(reason) {
    const w = this.world;
    if (this.bird && this.bird.alive) {
      const bp = this.bird.body.getPosition();
      this.lastBirdPos = { x: bp.x, y: bp.y };
      w.remove(this.bird);
    }
    this.bird = null;
    this.holdUntilT = 0;
    const pigsLeft = w.pigs().length;
    this._log('turnEnd', { reason });
    bus.emit(EV.TURN_END, { birdsLeft: Math.max(0, this.queue.length - this.birdIndex - 1), pigsLeft });
    this.birdIndex++;
    if (pigsLeft === 0 && this.pigsAtStart > 0) {
      if (this.clearT == null) this.clearT = w.time - CLEAR_GRACE_S + 0.3;
      return;
    }
    if (this.birdIndex >= this.queue.length) {
      this.setState(STATE.SETTLE);
      this.settleT = 0;
      return;
    }
    this.setState(STATE.AIM);
    this._emitBirdReady();
  }

  _updateSettle(dt) {
    const w = this.world;
    this.settleT += dt;
    const busy = w.hasActiveTasks() || w.hasPoisonedPigs();
    if (w.pigs().length > 0 && (this.settleT > SETTLE_MAX_S || (this.settleT > 1.0 && !busy && w.countAwake() <= 2))) {
      this._finish(false);
    }
  }

  _finish(cleared) {
    const L = this.level;
    if (cleared) {
      const unused = Math.max(0, this.queue.length - this.birdsUsed);
      const bonus = unused * SCORE.UNUSED_BIRD;
      this.score += bonus;
      if (bonus) bus.emit(EV.SCORE, { delta: bonus, total: this.score, reason: 'unusedBirds' });
      let stars = 1;
      if (this.score >= (L.star2 ?? 0)) stars++;
      if (this.birdsUsed <= (L.par ?? 1)) stars++;
      this.stars = stars;
      const best = Math.max(this._bestByLevel.get(L.id) || 0, this.score);
      this._bestByLevel.set(L.id, best);
      this.setState(STATE.CLEAR);
      this._log('clear', { score: this.score, stars, birdsUsed: this.birdsUsed });
      bus.emit(EV.LEVEL_CLEAR, { levelId: L.id, score: this.score, stars, birdsUsed: this.birdsUsed, best });
    } else {
      this.stars = 0;
      this.setState(STATE.FAIL);
      this._log('fail', { score: this.score });
      bus.emit(EV.LEVEL_FAIL, { levelId: L.id, score: this.score, pigsLeft: this.world.pigs().length });
    }
  }

  // ---------------- scoring & contact hooks ----------------
  _onDamage(e, applied) {
    if (e.kind !== KIND.BLOCK && e.kind !== KIND.PIG) return;
    this._dmgScoreCarry += applied * SCORE.PER_DAMAGE;
    const d = Math.floor(this._dmgScoreCarry + 1e-9);
    if (d > 0) {
      this._dmgScoreCarry -= d;
      this.score += d;
    }
  }

  _onKill(e, cause) {
    const w = this.world;
    if (e.kind !== KIND.BLOCK && e.kind !== KIND.PIG) return 0;
    if (w.time - this._lastKillT <= SCORE.COMBO_WINDOW_S) this.combo++; else this.combo = 1;
    this._lastKillT = w.time;
    const mul = Math.min(SCORE.COMBO_MUL_MAX, 1 + SCORE.COMBO_MUL_STEP * this.combo);
    let delta = 0;
    if (e.kind === KIND.PIG) {
      const boss = !!(PIGS[e.skin] && PIGS[e.skin].boss);
      delta = Math.round(SCORE.PIG_KILL * (boss ? 4 : 1) * mul);
      if (this.firstPigKillT == null) this.firstPigKillT = +w.time.toFixed(4);
      this._log('pigKill', { id: e.id, cause });
    } else {
      delta = Math.round((MATERIALS[e.mat]?.score || 300) * mul);
    }
    this.score += delta;
    const p = e.body.getPosition();
    bus.emit(EV.SCORE, { delta, total: this.score, x: p.x, y: p.y, reason: e.kind });
    if (this.combo >= 2) bus.emit(EV.COMBO, { count: this.combo });
    return delta;
  }

  _triggerProjectileContact(p, o, x, y) {
    if (!p || p.kind !== KIND.PROJ || !p.alive) return;
    if (!o || o.kind === KIND.BIRD || o.kind === KIND.PROJ) return;
    if (p.data.hitsBlocksOnly && o.kind !== KIND.BLOCK && o.kind !== KIND.PIG) return;

    if (p.data.pierce) {
      if (!p.data.hitIds) p.data.hitIds = new Set();
      if (p.data.hitIds.has(o.id)) return;
      p.data.hitIds.add(o.id);
      p.data.hits = (p.data.hits || 0) + 1;
      if (p.data.onHit) { try { p.data.onHit(p, o, { x, y }); } catch (err) { console.error('[onHit]', err); } }
      if (p.data.explode && p.alive) {
        this.world.explode(x, y, { ...p.data.explode, source: p.owner || 'proj' });
        if (p.data.removeOnExplode !== false) this.world.remove(p);
      }
      return;
    }

    if (p.data.hits) return;
    p.data.hits = 1;
    if (p.data.onHit) { try { p.data.onHit(p, o, { x, y }); } catch (err) { console.error('[onHit]', err); } }
    if (p.data.explode && p.alive) {
      this.world.explode(x, y, { ...p.data.explode, source: p.owner || 'proj' });
      this.world.remove(p);
    }
  }

  _triggerBirdContact(bird, other, info) {
    if (!bird || bird !== this.bird || !bird.alive || !other || other.kind === KIND.PROJ) return;
    const def = BIRDS[bird.data.birdId];
    if (def && def.onContact) {
      try { def.onContact(this.ctx, bird, other, info); } catch (err) { console.error('[onContact]', err); }
    }
    if (bird.data.onHit) {
      try { bird.data.onHit(bird, other, info); } catch (err) { console.error('[bird.onHit]', err); }
    }
  }

  _onImpact(a, b, J, v, x, y) {
    const info = { J, v, x, y, sensor: false };
    this._triggerBirdContact(a, b, info);
    this._triggerBirdContact(b, a, info);
    this._triggerProjectileContact(a, b, x, y);
    this._triggerProjectileContact(b, a, x, y);
  }

  _onBeginContact(a, b, x, y, speed, sensor) {
    if (sensor) {
      const info = { J: 0, v: speed, x, y, sensor: true };
      this._triggerBirdContact(a, b, info);
      this._triggerBirdContact(b, a, info);
    }
    this._triggerProjectileContact(a, b, x, y);
    this._triggerProjectileContact(b, a, x, y);
  }

  _emitBirdReady() {
    bus.emit(EV.BIRD_READY, {
      birdId: this.currentBirdId, index: this.birdIndex, remaining: this.queue.length - this.birdIndex,
    });
  }

  _log(type, o = {}) { this.events.push({ t: +this.world.time.toFixed(3), type, ...o }); }

  // ---------------- state snapshot (deep plain deterministic object) ----------------
  displacedCount() {
    if (!this.initialPose || !this.world) return 0;
    let n = 0;
    for (const [id, p0] of this.initialPose) {
      if (p0.kind !== KIND.BLOCK) continue;
      const e = this.world.byId.get(id);
      if (!e || !e.alive) { n++; continue; }
      const p = e.body.getPosition();
      if (Math.hypot(p.x - p0.x, p.y - p0.y) > 0.25 || Math.abs(e.body.getAngle() - p0.a) > 0.2) n++;
    }
    return n;
  }

  getState() {
    const w = this.world;
    if (!w) return { state: this.state };
    const b = this.bird && this.bird.alive ? this.bird.body.getPosition() : null;
    const bv = this.bird && this.bird.alive ? this.bird.body.getLinearVelocity() : null;
    const pigs = [];
    let blocksLeft = 0;
    let projectiles = 0;
    let liveBodies = 0;
    for (let i = 0; i < w.ents.length; i++) {
      const e = w.ents[i];
      if (!e.alive) continue;
      liveBodies++;
      if (e.kind === KIND.PIG) {
        const p = e.body.getPosition();
        pigs.push({
          id: e.id, x: +p.x.toFixed(3), y: +p.y.toFixed(3),
          hp: Math.max(0, Math.round(e.hp)), maxHp: e.maxHp, variant: e.skin,
          balloon: !!e.status.balloon, poisoned: !!e.status.poison,
        });
      } else if (e.kind === KIND.BLOCK) {
        blocksLeft++;
      } else if (e.kind === KIND.PROJ) {
        projectiles++;
      }
    }
    return {
      state: this.state,
      levelId: this.level ? this.level.id : null,
      biome: this.level ? this.level.biome : null,
      seed: this.seed,
      time: +w.time.toFixed(4),
      frame: w.frame,
      score: this.score,
      stars: this.stars ?? 0,
      combo: this.combo,
      birds: this.queue ? this.queue.slice() : [],
      birdQueue: this.queue ? this.queue.slice() : [],
      birdIndex: this.birdIndex,
      birdsUsed: this.birdsUsed,
      birdsLeft: this.birdsLeft,
      currentBird: this.currentBirdId,
      abilityUsed: this.abilityUsed,
      bird: b ? { x: +b.x.toFixed(3), y: +b.y.toFixed(3), vx: +bv.x.toFixed(3), vy: +bv.y.toFixed(3) } : null,
      pigs,
      pigsAtStart: this.pigsAtStart,
      pigsLeft: pigs.length,
      blocksAtStart: this.blocksAtStart,
      blocksLeft,
      displaced: this.displacedCount(),
      settle: this.settleStats
        ? { moved: this.settleStats.moved, maxDrift: this.settleStats.maxDrift }
        : { moved: 0, maxDrift: 0 },
      bodies: liveBodies,
      awake: w.countAwake(),
      projectiles,
      effects: w.effects.length,
      stats: {
        damageDealt: +w.stats.damageDealt.toFixed(2),
        blocksDestroyed: w.stats.blocksDestroyed,
        pigsKilled: w.stats.pigsKilled,
      },
      firstPigKillT: this.firstPigKillT,
      launchT: this.launchT,
      abilityT: this.abilityT,
      events: this.events.slice(-200),
    };
  }
}

function computeBounds(ents) {
  let x0 = Infinity, x1 = -Infinity, y1 = 0;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (!e.alive || (e.kind !== KIND.BLOCK && e.kind !== KIND.PIG)) continue;
    const p = e.body.getPosition();
    const ext = e.r || Math.max(e.w || 0, e.h || 0) / 2;
    x0 = Math.min(x0, p.x - ext);
    x1 = Math.max(x1, p.x + ext);
    y1 = Math.max(y1, p.y + ext);
  }
  if (!isFinite(x0)) { x0 = 15; x1 = 35; y1 = 8; }
  return { x0, x1, y0: 0, y1 };
}

export { LEVELS };
