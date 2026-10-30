// window.__MUSOU__ test seam (owner: physics-core). SKELETON by opus-director.
// Frozen object; getState() returns a deep-cloned plain object. stepFrames runs the fixed-step
// sim synchronously with no rendering (the RAF loop keeps drawing whatever state results).

import { PHYS } from './contracts.js';
import { BIRD_IDS } from './contracts.js';
import { LEVELS } from './levels/levels.js';
import { BIRDS } from './birds/index.js';

export function installSeam(app) {
  const { game } = app;
  const seam = {
    version: 1,
    listLevels: () => LEVELS.map((l) => ({ id: l.id, name: l.name, biome: l.biome, birds: l.birds.slice(), par: l.par, star2: l.star2 })),
    listBirds: () => BIRD_IDS.map((id) => ({ id, name: BIRDS[id].name, ability: BIRDS[id].ability, desc: BIRDS[id].desc })),
    /** opts.birds overrides the level's bird queue (e.g. ['chuck']) for ability testing. */
    startLevel(id, { seed = 1, birds = null } = {}) { app.startLevel(id, { seed, birds }); return clone(game.getState()); },
    launch(angleDeg, power) { return game.launch(angleDeg, power); },
    useAbility(x, y) { return game.useAbility(x == null ? null : { x, y }); },
    skipTurn() { return game.skipTurn(); },
    stepFrames(n = 1) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) game.step(PHYS.DT);
      return { ms: performance.now() - t0, state: game.state, time: game.world ? game.world.time : 0 };
    },
    getState: () => clone(game.getState()),
    setPaused(b) { app.paused = !!b; return app.paused; },
    perf: () => clone(app.perfStats()),
  };
  Object.defineProperty(window, '__MUSOU__', { value: Object.freeze(seam), writable: false, configurable: false });
  return seam;
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }
