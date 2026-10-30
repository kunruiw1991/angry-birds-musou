// Game: level build, bird queue, turn flow, scoring, stars (owner: physics-core).
// Skeleton by opus-director (functional baseline). Deterministic: no DOM, no Math.random.

import { PHYS, SLING, KIND, EV, STATE, SCORE, MATERIALS, PIGS } from '../contracts.js';
import { bus } from '../core/bus.js';
import { SimWorld, planck } from './world.js';
import { makeAbilityCtx } from './ability_ctx.js';
import { BIRDS } from '../birds/index.js';
import { LEVELS, getLevel } from '../levels/levels.js';

const TURN_TIMEOUT_S = 12;       // hard cap per bird turn
const REST_SPEED = 0.35;         // bird considered resting below this speed (m/s)
const REST_TIME = 1.2;           // seconds resting before the bird poofs
const CLEAR_GRACE_S = 1.2;       // after the last pig dies, let the chaos play before CLEAR

export class Game {
  constructor() {
    this.state = STATE.TITLE;
    this.world = null;
    this.level = null;
    this.ctx = makeAbilityCtx(this);
    this.score = 0;
    this.combo = 0;
    this._lastKillT = -99;
    this.pointer = { x: 0, y: 0, down: false };  // world-space pointer, written by ui/input.js (白公主 aiming)
  }

  setState(s) {
    const prev = this.state;
    if (prev === s) return;
    this.state = s;
    bus.emit(EV.STATE, { state: s, prev });
  }

  // ---------------- level lifecycle ----------------
  startLevel(id, { seed = 1 } = {}) {
    const L = getLevel(id);
    if (!L) throw new Error(`unknown level ${id}`);
    if (this.world) this.world.destroy();
    this.level = L;
    this.seed = seed;
    const w = this.world = new SimWorld(seed, L);
    w.onKill = (e, cause) => this._onKill(e, cause);
    w.onDamage = (e, applied) => this._onDamage(e, applied);
    w.onImpact = (a, b, J, v, x, y) => this._onImpact(a, b, J, v, x, y);
    this.score = 0; this.combo = 0; this._lastKillT = -99;
    this.queue = L.birds.slice();
    this.birdIndex = 0;
    this.birdsUsed = 0;
    this.bird = null;
    this.abilityUsed = false;
    this.flightT = 0; this.restT = 0; this.clearT = null; this.turnT = 0;
    this.firstPigKillT = null; this.launchT = null; this.abilityT = null;
    this.events = [];   // compact log for tests: {t, type, ...}

    // ground (static) spanning bounds
    w.addEnt({ kind: KIND.GROUND, mat: 'terrain', static: true, shape: 'box',
      x: (L.bounds.x0 + L.bounds.x1) / 2, y: -2, w: (L.bounds.x1 - L.bounds.x0) + 80, h: 4 });
    for (const t of L.terrain || []) {
      if (t.verts) w.addEnt({ kind: KIND.TERRAIN, mat: 'terrain', static: true, shape: 'poly', x: t.x || 0, y: t.y || 0, verts: t.verts.map(([x, y]) => ({ x, y })) });
      else w.addEnt({ kind: KIND.TERRAIN, mat: 'terrain', static: true, shape: 'box', x: t.x, y: t.y, w: t.w, h: t.h });
    }
    for (const b of L.blocks || []) {
      const shape = b.s === 'circle' ? 'circle' : b.s === 'tri' || b.s === 'poly' ? 'poly' : 'box';
      const verts = b.s === 'tri' ? [{ x: -b.w / 2, y: -b.h / 2 }, { x: b.w / 2, y: -b.h / 2 }, { x: -b.w / 2, y: b.h / 2 }]
        : b.verts ? b.verts.map(([x, y]) => ({ x, y })) : undefined;
      w.addEnt({ kind: KIND.BLOCK, mat: b.m || 'wood', shape, x: b.x, y: b.y, w: b.w, h: b.h, r: b.r, verts, angle: b.a || 0, skin: b.m || 'wood' });
    }
    for (const p of L.pigs || []) {
      const v = PIGS[p.v || 'pig'] || PIGS.pig;
      const e = w.addEnt({ kind: KIND.PIG, mat: 'pig', shape: 'circle', x: p.x, y: p.y, r: p.r || v.r, skin: p.v || 'pig', hp: p.hp ?? v.hp,
        gravityScale: p.balloon ? 0 : 1, linearDamping: p.balloon ? 1.5 : 0 });
      if (p.balloon) e.status.balloon = true;
    }
    this.structureBounds = computeBounds(w.ents);
    w.settleAndSleep();
    this.initialPose = new Map();
    for (const e of w.ents) if (e.kind === KIND.BLOCK || e.kind === KIND.PIG) {
      const p = e.body.getPosition(); this.initialPose.set(e.id, { x: p.x, y: p.y, a: e.body.getAngle(), kind: e.kind });
    }
    w.time = 0; w.frame = 0;
    w.after(PHYS.DAMAGE_GRACE_S, () => { w.damageEnabled = true; });
    this.pigsAtStart = w.pigs().length;
    this.blocksAtStart = w.ents.filter((e) => e.kind === KIND.BLOCK).length;
    bus.emit(EV.LEVEL_START, { levelId: L.id, biome: L.biome });
    this.setState(STATE.AIM);
    this._emitBirdReady();
    return this.getState();
  }

  get currentBirdId() { return this.queue ? this.queue[this.birdIndex] : null; }
  get birdsLeft() { return this.queue ? this.queue.length - this.birdIndex - (this.state === STATE.FLIGHT ? 1 : 0) : 0; }

  /** Pouch rest point (world). */
  pouch() { const s = this.level.sling; return { x: s.x, y: s.y + SLING.FORK_HEIGHT }; }

  // ---------------- player actions ----------------
  /** angleDeg: 0 = right, 90 = up. power in [0,1]. Returns true if launched. */
  launch(angleDeg, power) {
    if (this.state !== STATE.AIM || !this.currentBirdId) return false;
    power = Math.max(0, Math.min(1, power));
    if (power < SLING.MIN_POWER) return false;
    const def = BIRDS[this.currentBirdId];
    const a = angleDeg * Math.PI / 180;
    const rest = this.pouch();
    const pull = power * SLING.MAX_PULL;
    const x = rest.x - Math.cos(a) * pull, y = Math.max(rest.y - Math.sin(a) * pull, 0.6);
    const speed = power * SLING.MAX_SPEED;
    const r = def.radius ?? 0.45;
    const bird = this.world.addEnt({ kind: KIND.BIRD, mat: 'bird', shape: 'circle', r, x, y,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, skin: def.id, density: def.density ?? 5,
      bullet: true, dmgMul: def.dmgMul ?? 1, angularDamping: 0.6 });
    bird.data.birdId = def.id;
    this.bird = bird;
    this.abilityUsed = false;
    this.flightT = 0; this.restT = 0; this.turnT = 0;
    this.birdsUsed++;
    this.launchT = this.world.time;
    this.abilityT = null;
    this.setState(STATE.FLIGHT);
    this._log('launch', { bird: def.id, angleDeg, power });
    bus.emit(EV.LAUNCH, { birdId: def.id, x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, power });
    try { def.onLaunch && def.onLaunch(this.ctx, bird); } catch (err) { console.error('[onLaunch]', err); }
    return true;
  }

  /** Trigger the current bird's 10x ability. target = {x,y} world point or null (auto). */
  useAbility(target = null) {
    if (this.state !== STATE.FLIGHT || this.abilityUsed || !this.bird) return false;
    const def = BIRDS[this.bird.data.birdId];
    if (!def || !def.onTap) return false;
    this.abilityUsed = true;
    this.abilityT = this.world.time;
    const p = this.bird.alive ? this.bird.body.getPosition() : (target || { x: 0, y: 0 });
    this._log('ability', { bird: def.id });
    bus.emit(EV.ABILITY, { birdId: def.id, x: p.x, y: p.y, name: def.ability });
    try { def.onTap(this.ctx, this.bird, target); } catch (err) { console.error('[onTap]', err); }
    return true;
  }

  /** Player skips the rest of this turn ("下一只"). */
  skipTurn() {
    if (this.state !== STATE.FLIGHT) return false;
    this._endTurn('skip');
    return true;
  }

  // ---------------- stepping ----------------
  step(dt = PHYS.DT) {
    if (!this.world || this.state === STATE.TITLE || this.state === STATE.PAUSED) return;
    const w = this.world;
    // bird module per-step hook
    if (this.state === STATE.FLIGHT && this.bird) {
      const def = BIRDS[this.bird.data.birdId];
      if (def && def.onStep) { try { def.onStep(this.ctx, this.bird, dt); } catch (err) { console.error('[onStep]', err); } }
    }
    // balloon pigs bob
    for (const e of w.ents) if (e.status.balloon && e.alive) {
      const v = e.body.getLinearVelocity();
      e.body.setLinearVelocity(new planck.Vec2(v.x * 0.98, v.y * 0.98 + Math.sin(w.time * 2 + e.id) * 0.01));
    }
    w.step(dt);

    if (this.state === STATE.FLIGHT) this._updateTurn(dt);
    if (this.state === STATE.SETTLE) this._updateSettle(dt);
    if (this.clearT == null && this.pigsAtStart > 0 && w.pigs().length === 0 &&
        (this.state === STATE.FLIGHT || this.state === STATE.SETTLE || this.state === STATE.AIM)) {
      this.clearT = w.time;
      bus.emit(EV.BANNER, { text: '全灭！', big: true, color: '#ffcc00' });
      bus.emit(EV.JUICE, { slowmo: { scale: 0.35, dur: 0.8 } });
    }
    if (this.clearT != null && w.time - this.clearT >= CLEAR_GRACE_S && this.state !== STATE.CLEAR) this._finish(true);
  }

  _updateTurn(dt) {
    const w = this.world;
    this.flightT += dt; this.turnT += dt;
    const b = this.bird;
    if (b && b.alive) {
      const v = b.body.getLinearVelocity();
      if (Math.hypot(v.x, v.y) < REST_SPEED) this.restT += dt; else this.restT = 0;
      if (this.restT > REST_TIME) { w.remove(b); bus.emit(EV.SFX, { name: 'poof' }); }
    }
    const birdDone = !b || !b.alive;
    const projLive = w.ents.some((e) => e.alive && e.kind === KIND.PROJ);
    const tasksLive = (w._tasks || []).some((t) => !t.dead);
    const settled = w.countAwake() <= 2;
    if ((birdDone && !projLive && !tasksLive && settled && this.turnT > 1.0) || this.turnT > TURN_TIMEOUT_S) this._endTurn('auto');
  }

  _endTurn(reason) {
    const w = this.world;
    if (this.bird && this.bird.alive) w.remove(this.bird);
    this.bird = null;
    this._log('turnEnd', { reason });
    bus.emit(EV.TURN_END, { birdsLeft: this.queue.length - this.birdIndex - 1, pigsLeft: w.pigs().length });
    this.birdIndex++;
    if (w.pigs().length === 0) { if (this.clearT == null) this.clearT = w.time - CLEAR_GRACE_S + 0.3; return; }
    if (this.birdIndex >= this.queue.length) { this.setState(STATE.SETTLE); this.settleT = 0; return; }
    this.setState(STATE.AIM);
    this._emitBirdReady();
  }

  _updateSettle(dt) {
    this.settleT += dt;
    if (this.world.pigs().length > 0 && (this.settleT > 2.5 || (this.settleT > 1 && this.world.countAwake() <= 2))) this._finish(false);
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
      this.setState(STATE.CLEAR);
      this._log('clear', { score: this.score, stars });
      bus.emit(EV.LEVEL_CLEAR, { levelId: L.id, score: this.score, stars, birdsUsed: this.birdsUsed });
    } else {
      this.stars = 0;
      this.setState(STATE.FAIL);
      this._log('fail', { score: this.score });
      bus.emit(EV.LEVEL_FAIL, { levelId: L.id, score: this.score, pigsLeft: this.world.pigs().length });
    }
  }

  // ---------------- scoring hooks ----------------
  _onDamage(e, applied) {
    if (e.kind !== KIND.BLOCK && e.kind !== KIND.PIG) return;
    const d = Math.round(applied * SCORE.PER_DAMAGE);
    if (d > 0) this.score += d;
    if (e.status.balloon && e.kind === KIND.PIG) { e.status.balloon = false; e.body.setGravityScale(1); e.body.setLinearDamping(0); bus.emit(EV.SFX, { name: 'balloon_pop' }); }
  }

  _onKill(e, cause) {
    const w = this.world;
    if (e.kind !== KIND.BLOCK && e.kind !== KIND.PIG) return;
    if (w.time - this._lastKillT <= SCORE.COMBO_WINDOW_S) this.combo++; else this.combo = 1;
    this._lastKillT = w.time;
    const mul = Math.min(SCORE.COMBO_MUL_MAX, 1 + SCORE.COMBO_MUL_STEP * this.combo);
    let delta = 0;
    if (e.kind === KIND.PIG) {
      const boss = PIGS[e.skin] && PIGS[e.skin].boss;
      delta = Math.round(SCORE.PIG_KILL * (boss ? 4 : 1) * mul);
      if (this.firstPigKillT == null) this.firstPigKillT = w.time;
      this._log('pigKill', { id: e.id, cause });
    } else {
      delta = Math.round((MATERIALS[e.mat]?.score || 300) * mul);
    }
    this.score += delta;
    const p = e.body.getPosition();
    bus.emit(EV.SCORE, { delta, total: this.score, x: p.x, y: p.y, reason: e.kind });
    if (this.combo >= 3) bus.emit(EV.COMBO, { count: this.combo });
  }

  _onImpact(a, b) {
    for (const [p, o] of [[a, b], [b, a]]) {
      if (!p || p.kind !== KIND.PROJ || !p.alive || p.data.hits) continue;
      if (o && o.kind === KIND.BIRD) continue;
      p.data.hits = 1;
      const pos = p.body.getPosition();
      if (p.data.onHit) { try { p.data.onHit(p, o); } catch (err) { console.error('[onHit]', err); } }
      if (p.data.explode) { this.world.explode(pos.x, pos.y, { ...p.data.explode, source: p.owner || 'proj' }); this.world.remove(p); }
    }
  }

  _emitBirdReady() {
    bus.emit(EV.BIRD_READY, { birdId: this.currentBirdId, index: this.birdIndex, remaining: this.queue.length - this.birdIndex });
  }

  _log(type, o = {}) { this.events.push({ t: +this.world.time.toFixed(3), type, ...o }); }

  // ---------------- state snapshot (deep plain object) ----------------
  displacedCount() {
    let n = 0;
    for (const [id, p0] of this.initialPose) {
      if (p0.kind !== KIND.BLOCK) continue;
      const e = this.world.byId.get(id);
      if (!e || !e.alive) { n++; continue; }
      const p = e.body.getPosition();
      if (Math.hypot(p.x - p0.x, p.y - p0.y) > 0.5 || Math.abs(e.body.getAngle() - p0.a) > 0.4) n++;
    }
    return n;
  }

  getState() {
    const w = this.world;
    if (!w) return { state: this.state };
    const b = this.bird && this.bird.alive ? this.bird.body.getPosition() : null;
    const bv = this.bird && this.bird.alive ? this.bird.body.getLinearVelocity() : null;
    return {
      state: this.state, levelId: this.level.id, biome: this.level.biome, seed: this.seed,
      time: +w.time.toFixed(4), frame: w.frame, score: this.score, stars: this.stars ?? 0,
      combo: this.combo, birdQueue: this.queue.slice(), birdIndex: this.birdIndex,
      birdsUsed: this.birdsUsed, birdsLeft: this.birdsLeft, currentBird: this.currentBirdId,
      abilityUsed: this.abilityUsed,
      bird: b ? { x: +b.x.toFixed(3), y: +b.y.toFixed(3), vx: +bv.x.toFixed(3), vy: +bv.y.toFixed(3) } : null,
      pigs: w.ents.filter((e) => e.kind === KIND.PIG).map((e) => { const p = e.body.getPosition(); return { id: e.id, x: +p.x.toFixed(3), y: +p.y.toFixed(3), hp: Math.max(0, Math.round(e.hp)), maxHp: e.maxHp, variant: e.skin }; }),
      pigsAtStart: this.pigsAtStart, pigsLeft: w.pigs().length,
      blocksAtStart: this.blocksAtStart, blocksLeft: w.ents.filter((e) => e.kind === KIND.BLOCK).length,
      displaced: this.displacedCount(),
      bodies: w.ents.length, awake: w.countAwake(),
      projectiles: w.ents.filter((e) => e.kind === KIND.PROJ).length,
      effects: w.effects.length,
      stats: { ...w.stats }, firstPigKillT: this.firstPigKillT, launchT: this.launchT, abilityT: this.abilityT,
      events: this.events.slice(-200),
    };
  }
}

function computeBounds(ents) {
  let x0 = Infinity, x1 = -Infinity, y1 = 0;
  for (const e of ents) {
    if (e.kind !== KIND.BLOCK && e.kind !== KIND.PIG) continue;
    const p = e.body.getPosition();
    const ext = e.r || Math.max(e.w || 0, e.h || 0) / 2;
    x0 = Math.min(x0, p.x - ext); x1 = Math.max(x1, p.x + ext); y1 = Math.max(y1, p.y + ext);
  }
  if (!isFinite(x0)) { x0 = 15; x1 = 35; y1 = 8; }
  return { x0, x1, y0: 0, y1 };
}

export { LEVELS };
