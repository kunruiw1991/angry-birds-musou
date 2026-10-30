// Juice controller: shake, hit-stop, slow-mo, flash (owner: juice-audio).
// SKELETON by opus-director: API + trivial behavior. Spec: docs/DESIGN.md §Juice.
// main.js calls update(realDt) once per frame and reads timeScale()/frozen()/applyToCamera().

import { bus } from '../core/bus.js';
import { EV } from '../contracts.js';

let trauma = 0, hitstopMs = 0, slowScale = 1, slowLeft = 0, flashA = 0, flashColor = '#fff';

export const juice = {
  init() {
    bus.on(EV.JUICE, (p) => {
      if (p.shake) trauma = Math.min(1, trauma + p.shake);
      if (p.hitstop) hitstopMs = Math.max(hitstopMs, p.hitstop);
      if (p.slowmo) { slowScale = Math.min(slowScale, p.slowmo.scale); slowLeft = Math.max(slowLeft, p.slowmo.dur); }
      if (p.flash) { flashA = Math.max(flashA, p.flash.alpha); flashColor = p.flash.color || '#fff'; }
    });
    bus.on(EV.EXPLOSION, (p) => { trauma = Math.min(1, trauma + (p.power === 'mega' ? 0.8 : 0.15)); });
  },
  update(realDt) {
    trauma = Math.max(0, trauma - realDt * 1.6);
    if (hitstopMs > 0) hitstopMs -= realDt * 1000;
    if (slowLeft > 0) { slowLeft -= realDt; if (slowLeft <= 0) slowScale = 1; }
    flashA = Math.max(0, flashA - realDt * 4);
  },
  frozen() { return hitstopMs > 0; },
  timeScale() { return slowScale; },
  applyToCamera(cam) {
    const m = 18 * trauma * trauma;
    cam.shakeX = (Math.random() * 2 - 1) * m; cam.shakeY = (Math.random() * 2 - 1) * m;
  },
  /** Screen-space overlay (flash). Called last by main. */
  drawOverlay(g, cam) {
    if (flashA <= 0) return;
    g.globalAlpha = flashA; g.fillStyle = flashColor; g.fillRect(0, 0, cam.w, cam.h); g.globalAlpha = 1;
  },
  stats() { return { trauma, hitstopMs, slowScale }; },
};
