// Boot + main loop + wiring (owner: opus-director / integrator). Builders: do not edit; ask on the
// board if you need a new hook. Fixed 60 Hz sim decoupled from render (accumulator), juice
// time-scale + hit-stop applied to sim time only, perf ring buffers for the perf gate.

import { PHYS, STATE, EV } from './contracts.js';
import { bus } from './core/bus.js';
import { Game } from './sim/game.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { juice } from './fx/juice.js';
import { particles } from './fx/particles.js';
import { popups } from './fx/popups.js';
import { audio } from './audio/synth.js';
import { Input } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { installSeam } from './seam.js';
import { LEVELS } from './levels/levels.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const hudRoot = document.getElementById('hud');

const game = new Game();
const cam = new Camera();
const renderer = new Renderer(canvas);
juice.init(); particles.init(); popups.init(); audio.init();
renderer.addLayer(particles);
renderer.addLayer(popups);
const input = new Input(canvas, game, cam, audio);

const frameMs = new Float32Array(240); let frameIdx = 0, frameCount = 0;
const stepMs = new Float32Array(240); let stepIdx = 0, stepCount = 0;

const app = {
  game, cam, renderer, input, juice, particles, popups, audio, paused: false,
  startLevel(id, { seed = 1, birds = null } = {}) {
    particles.clear && particles.clear();
    popups.clear && popups.clear();
    game.startLevel(id, { seed, birds });
    cam.snapTo && cam.snapTo(game);
  },
  restart() { if (game.level) app.startLevel(game.level.id, { seed: game.seed }); },
  ability() { game.useAbility(null); },
  next() { game.skipTurn(); },
  perfStats() {
    const pct = (arr, n, q) => { const a = Array.from(arr.slice(0, Math.min(n, arr.length))).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0; };
    return {
      frameP50: pct(frameMs, frameCount, 0.5), frameP95: pct(frameMs, frameCount, 0.95),
      stepP50: pct(stepMs, stepCount, 0.5), stepP95: pct(stepMs, stepCount, 0.95),
      bodies: game.world ? game.world.ents.length : 0, particles: particles.count ? particles.count() : 0,
      popups: popups.count ? popups.count() : 0, dpr: renderer.dpr,
    };
  },
};
window.__APP__ = app;  // debug handle (not part of the frozen seam)

const hud = new Hud(hudRoot, game, app);
installSeam(app);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  cam.resize(w, h); renderer.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now(), acc = 0;
function frame(now) {
  const f0 = performance.now();
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!app.paused) {
    juice.update(realDt);
    if (!juice.frozen()) acc += realDt * juice.timeScale();
    let steps = 0;
    while (acc >= PHYS.DT && steps < PHYS.MAX_STEPS_PER_FRAME) {
      const s0 = performance.now();
      game.step(PHYS.DT);
      stepMs[stepIdx] = performance.now() - s0; stepIdx = (stepIdx + 1) % stepMs.length; stepCount++;
      acc -= PHYS.DT; steps++;
    }
    if (steps === PHYS.MAX_STEPS_PER_FRAME) acc = 0;
    particles.update(realDt); popups.update(realDt);
  }
  cam.update(realDt, game);
  juice.applyToCamera(cam);
  renderer.draw(game, cam, input);
  juice.drawOverlay(renderer.g, cam);
  hud.update(realDt);
  frameMs[frameIdx] = performance.now() - f0; frameIdx = (frameIdx + 1) % frameMs.length; frameCount++;
  requestAnimationFrame(frame);
}

const startId = params.get('level') || (LEVELS[0] && LEVELS[0].id);
const seed = parseInt(params.get('seed') || '1', 10);
if (startId) app.startLevel(startId, { seed });
requestAnimationFrame(frame);

// ?smoke=1 : headless smoke check (tests/smoke.py reads #smoke from the dumped DOM)
if (params.get('smoke')) {
  const out = document.createElement('pre'); out.id = 'smoke'; document.body.appendChild(out);
  try {
    const M = window.__MUSOU__;
    const results = [];
    for (const lv of M.listLevels()) {
      M.startLevel(lv.id, { seed: 7 });
      M.launch(40, 0.9); M.stepFrames(40); M.useAbility(); M.stepFrames(240);
      const s = M.getState();
      results.push(`${lv.id}:pigs ${s.pigsLeft}/${s.pigsAtStart} displaced ${s.displaced}/${s.blocksAtStart} score ${s.score} state ${s.state}`);
    }
    out.textContent = 'SMOKE_OK ' + results.join(' | ') + ' ERRORS=' + JSON.stringify(window.__ERRORS__ || []);
  } catch (err) {
    out.textContent = 'SMOKE_FAIL ' + (err && err.stack || err) + ' ERRORS=' + JSON.stringify(window.__ERRORS__ || []);
  }
}
