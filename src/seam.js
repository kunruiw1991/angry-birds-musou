// window.__MUSOU__ test seam (owner: physics-core).
// Frozen object; getState() returns a deep-cloned plain deterministic object. stepFrames runs the
// fixed-step sim synchronously with no rendering (and SimWorld tracks step timings for perf()).

import { PHYS, KIND, STATE, BIRD_IDS } from './contracts.js';
import { LEVELS } from './levels/levels.js';
import { BIRDS } from './birds/index.js';
import { SimWorld, planck } from './sim/world.js';

export function installSeam(app) {
  const { game } = app;

  const debug = Object.freeze({
    /** Initialize a clean flat-ground sandbox world inside `game` for physics/damage calibration. */
    resetSandbox({ seed = 1, bounds = { x0: -50, x1: 100, y1: 60 }, damageEnabled = true } = {}) {
      if (game.world) game.world.destroy();
      const sandboxLevel = {
        id: '__sandbox__', name: 'Sandbox', biome: 'grass', birds: ['red'],
        par: 1, star2: 0, sling: { x: 0, y: 0 }, bounds, terrain: [], blocks: [], pigs: [],
      };
      game.level = sandboxLevel;
      game.seed = seed;
      const w = game.world = new SimWorld(seed, sandboxLevel);
      w.onKill = (e, cause) => game._onKill(e, cause);
      w.onDamage = (e, applied) => game._onDamage(e, applied);
      w.onImpact = (a, b, J, v, x, y) => game._onImpact(a, b, J, v, x, y);
      w.onBeginContact = (a, b, x, y, speed, sensor) => game._onBeginContact(a, b, x, y, speed, sensor);
      w.addEnt({
        kind: KIND.GROUND, mat: 'terrain', static: true, shape: 'box',
        x: (bounds.x0 + bounds.x1) / 2, y: -2, w: (bounds.x1 - bounds.x0) + 80, h: 4,
      });
      game.score = 0; game._dmgScoreCarry = 0; game.stars = 0; game.combo = 0; game._lastKillT = -99;
      game.queue = ['red']; game.birdIndex = 0; game.birdsUsed = 0; game.bird = null;
      game.lastBirdPos = { x: 0, y: 2 };
      game.abilityUsed = false; game.holdUntilT = 0;
      game.flightT = 0; game.restT = 0; game.clearT = null; game.turnT = 0; game.settleT = 0;
      game.firstPigKillT = null; game.launchT = null; game.abilityT = null;
      game.events = [];
      game.initialPose = new Map();
      game.settleStats = { moved: 0, maxDrift: 0, maxRot: 0 };
      game._settleOffenders = [];
      game.pigsAtStart = 0; game.blocksAtStart = 0;
      game.structureBounds = { x0: 10, x1: 30, y0: 0, y1: 10 };
      w.damageEnabled = !!damageEnabled;
      game.state = STATE.AIM;
      app.paused = true;
      return true;
    },
    spawnEnt(spec) {
      if (!game.world) debug.resetSandbox();
      const e = game.world.addEnt(spec);
      if (e.kind === KIND.PIG) game.pigsAtStart++;
      if (e.kind === KIND.BLOCK) game.blocksAtStart++;
      return cloneEnt(e);
    },
    setVelocity(id, vx, vy, angularVelocity = null) {
      const e = game.world && game.world.byId.get(id);
      if (!e || !e.alive) return false;
      e.body.setLinearVelocity(new planck.Vec2(vx, vy));
      if (angularVelocity != null) e.body.setAngularVelocity(angularVelocity);
      e.body.setAwake(true);
      return true;
    },
    setDamageEnabled(b) {
      if (!game.world) return false;
      game.world.damageEnabled = !!b;
      return game.world.damageEnabled;
    },
    settle(steps = PHYS.SETTLE_STEPS) {
      if (!game.world) return false;
      game.world.settleAndSleep(steps);
      return true;
    },
    getEnt(id) {
      const e = game.world && game.world.byId.get(id);
      return e ? cloneEnt(e) : null;
    },
    listEnts() {
      if (!game.world) return [];
      return game.world.ents.filter((e) => e.alive).map(cloneEnt);
    },
    settleReport() {
      return clone({
        ...(game.settleStats || { moved: 0, maxDrift: 0, maxRot: 0 }),
        offenders: game._settleOffenders || [],
      });
    },
  });

  const seam = {
    version: 1,
    listLevels: () => LEVELS.map((l) => ({
      id: l.id, name: l.name, biome: l.biome, birds: l.birds.slice(), par: l.par, star2: l.star2,
    })),
    listBirds: () => BIRD_IDS.map((id) => ({
      id, name: BIRDS[id].name, ability: BIRDS[id].ability, desc: BIRDS[id].desc,
    })),
    /** opts.birds overrides the level's bird queue (e.g. ['chuck']) for ability testing. */
    startLevel(id, { seed = 1, birds = null } = {}) {
      app.startLevel(id, { seed, birds });
      return clone(game.getState());
    },
    launch(angleDeg, power) { return game.launch(angleDeg, power); },
    useAbility(x, y) { return game.useAbility(x == null ? null : { x, y }); },
    skipTurn() { return game.skipTurn(); },
    stepFrames(n = 1) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) game.step(PHYS.DT);
      return { ms: performance.now() - t0, state: game.state, time: game.world ? +game.world.time.toFixed(4) : 0 };
    },
    getState: () => clone(game.getState()),
    setPaused(b) { app.paused = !!b; return app.paused; },
    perf() {
      const base = app.perfStats ? app.perfStats() : {};
      const sp = game.world ? game.world.stepPerf() : null;
      return clone({
        ...base,
        stepP50: sp && sp.samples ? sp.stepP50 : (base.stepP50 || 0),
        stepP95: sp && sp.samples ? sp.stepP95 : (base.stepP95 || 0),
        lastStepMs: sp ? sp.lastStepMs : 0,
        awake: game.world ? game.world.countAwake() : 0,
        projectiles: game.world ? game.world.ents.filter((e) => e.alive && e.kind === KIND.PROJ).length : 0,
        effects: game.world ? game.world.effects.length : 0,
      });
    },
    debug,
  };
  Object.defineProperty(window, '__MUSOU__', { value: Object.freeze(seam), writable: false, configurable: false });
  return seam;
}

function cloneEnt(e) {
  const p = e.body.getPosition();
  const v = e.body.getLinearVelocity();
  return clone({
    id: e.id, kind: e.kind, mat: e.mat, shape: e.shape, skin: e.skin,
    alive: e.alive, hp: e.hp === Infinity ? null : +e.hp.toFixed(2),
    maxHp: e.maxHp === Infinity ? null : e.maxHp,
    rawDamageTaken: +(e._rawDmgTaken || 0).toFixed(2),
    hpLost: +(e._hpLost || 0).toFixed(2),
    x: +p.x.toFixed(4), y: +p.y.toFixed(4),
    vx: +v.x.toFixed(4), vy: +v.y.toFixed(4),
    angle: +e.body.getAngle().toFixed(4),
    angularVelocity: +e.body.getAngularVelocity().toFixed(4),
    mass: +e.body.getMass().toFixed(4),
    awake: e.body.isAwake(),
    sensor: !!e.sensor,
    status: e.status,
  });
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }
