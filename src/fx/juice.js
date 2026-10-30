// Juice controller: trauma shake, hit-stop, slow-mo with ease-out, screen flash (owner: juice-audio).
// Pure bus listener + render-time controller; never mutates physics world. Spec: docs/DESIGN.md §9.

import { bus } from '../core/bus.js';
import { EV } from '../contracts.js';

const DEG_TO_RAD = Math.PI / 180;
const MAX_SHAKE_PX = 22;          // 22 px * trauma^2
const MAX_SHAKE_ROT = 1.2 * DEG_TO_RAD; // ±1.2 deg * trauma^2
const TRAUMA_DECAY = 1.5;         // 1.5 / s
const PIG_HITSTOP_MS = 35;        // 35 ms, <= 1 per 120 ms
const PIG_HITSTOP_CD_MS = 120;
const BOSS_HITSTOP_MS = 160;
const MEGA_HITSTOP_MS = 90;
const DEFAULT_EASE_OUT_S = 0.25;

let initialized = false;
let trauma = 0;
let shakeClock = 0;

let hitstopMs = 0;
let pigHitstopCdMs = 0;

let slowScale = 1;
let slowFloor = 1;
let slowHoldS = 0;
let slowEaseDurS = DEFAULT_EASE_OUT_S;
let slowEaseElapsedS = 0;

let flashA = 0;
let flashColor = '#ffffff';
let flashDecayRate = 2.6;

function addTrauma(amount) {
  if (!(amount > 0)) return;
  trauma = Math.min(1, trauma + amount);
}

function triggerHitstop(ms) {
  if (!(ms > 0)) return;
  hitstopMs = Math.max(hitstopMs, ms);
}

function triggerSlowmo(scale = 0.35, dur = 0.8, ease = DEFAULT_EASE_OUT_S) {
  const clampedScale = Math.max(0.05, Math.min(1, scale));
  if (clampedScale >= 1 || !(dur > 0)) return;
  slowFloor = slowHoldS > 0 ? Math.min(slowFloor, clampedScale) : clampedScale;
  slowHoldS = Math.max(slowHoldS, dur);
  slowEaseDurS = Math.max(0.05, ease);
  slowEaseElapsedS = 0;
  slowScale = slowFloor;
}

function triggerFlash(alpha = 0.4, color = '#ffffff', dur = 0.32) {
  if (!(alpha > 0)) return;
  if (alpha >= flashA) {
    flashColor = color || '#ffffff';
    flashDecayRate = 1 / Math.max(0.08, dur);
  }
  flashA = Math.min(1, Math.max(flashA, alpha));
}

function resetState() {
  trauma = 0;
  hitstopMs = 0;
  pigHitstopCdMs = 0;
  slowScale = 1;
  slowFloor = 1;
  slowHoldS = 0;
  slowEaseElapsedS = 0;
  flashA = 0;
  flashColor = '#ffffff';
}

export const juice = {
  init() {
    if (initialized) return;
    initialized = true;

    bus.on(EV.LEVEL_START, () => {
      resetState();
    });

    bus.on(EV.JUICE, (p = {}) => {
      if (p.shake) addTrauma(p.shake);
      if (p.hitstop) triggerHitstop(p.hitstop);
      if (p.slowmo) {
        triggerSlowmo(
          p.slowmo.scale ?? 0.35,
          p.slowmo.dur ?? 0.8,
          p.slowmo.ease ?? DEFAULT_EASE_OUT_S,
        );
      }
      if (p.flash) {
        triggerFlash(
          p.flash.alpha ?? 0.4,
          p.flash.color || '#ffffff',
          p.flash.dur ?? 0.32,
        );
      }
    });

    bus.on(EV.EXPLOSION, (p = {}) => {
      if (p.power === 'mega') {
        addTrauma(0.9);
        triggerHitstop(MEGA_HITSTOP_MS);
        triggerFlash(0.55, '#ffffff', 0.42);
      } else if (p.power === 'small') {
        addTrauma(0.08);
      } else {
        addTrauma(0.12);
      }
    });

    bus.on(EV.BREAK, (p = {}) => {
      const m = p.mass != null ? p.mass : 1.2;
      addTrauma(Math.min(0.25, Math.max(0.02, m * 0.02)));
    });

    bus.on(EV.PIG_POP, (p = {}) => {
      if (p.boss) {
        addTrauma(0.3);
        triggerHitstop(BOSS_HITSTOP_MS);
      } else {
        addTrauma(0.05);
        if (pigHitstopCdMs <= 0) {
          triggerHitstop(PIG_HITSTOP_MS);
          pigHitstopCdMs = PIG_HITSTOP_CD_MS;
        }
      }
    });

    bus.on(EV.SFX, (p = {}) => {
      // Gale purple lightning slashes: ensure 0.25 purple flash even if only SFX was emitted
      if (p.name === 'slash' && flashA < 0.25) {
        triggerFlash(0.25, '#c44dff', 0.26);
      }
    });
  },

  update(realDt) {
    if (!(realDt > 0)) return;
    shakeClock += realDt;
    trauma = Math.max(0, trauma - TRAUMA_DECAY * realDt);

    if (pigHitstopCdMs > 0) {
      pigHitstopCdMs = Math.max(0, pigHitstopCdMs - realDt * 1000);
    }

    if (hitstopMs > 0) {
      hitstopMs = Math.max(0, hitstopMs - realDt * 1000);
    } else if (slowHoldS > 0) {
      slowHoldS -= realDt;
      slowScale = slowFloor;
      if (slowHoldS <= 0) {
        slowEaseElapsedS = -slowHoldS;
        slowHoldS = 0;
      }
    } else if (slowScale < 1) {
      slowEaseElapsedS += realDt;
      const u = Math.min(1, slowEaseElapsedS / slowEaseDurS);
      const easeOut = u * (2 - u);
      slowScale = slowFloor + (1 - slowFloor) * easeOut;
      if (u >= 1) {
        slowScale = 1;
        slowFloor = 1;
      }
    }

    if (flashA > 0) {
      flashA = Math.max(0, flashA - flashDecayRate * realDt);
    }
  },

  frozen() {
    return hitstopMs > 0;
  },

  timeScale() {
    return slowScale;
  },

  applyToCamera(cam) {
    if (!cam) return;
    if (trauma <= 0.0001) {
      cam.shakeX = 0;
      cam.shakeY = 0;
      cam.rot = 0;
      return;
    }
    const t2 = trauma * trauma;
    const nx = Math.sin(shakeClock * 57.3) * 0.55 + (Math.random() * 2 - 1) * 0.45;
    const ny = Math.cos(shakeClock * 49.1) * 0.55 + (Math.random() * 2 - 1) * 0.45;
    const nr = Math.sin(shakeClock * 41.7) * 0.55 + (Math.random() * 2 - 1) * 0.45;
    cam.shakeX = MAX_SHAKE_PX * t2 * nx;
    cam.shakeY = MAX_SHAKE_PX * t2 * ny;
    cam.rot = MAX_SHAKE_ROT * t2 * nr;
  },

  /** Screen-space overlay (flash). Called last by main.js. */
  drawOverlay(g, cam) {
    if (!g || !cam || flashA <= 0.004) return;
    g.save();
    g.globalAlpha = Math.min(1, flashA);
    g.fillStyle = flashColor;
    g.fillRect(0, 0, cam.w, cam.h);
    g.restore();
  },

  reset: resetState,

  stats() {
    return { trauma, hitstopMs, slowScale, flashA, flashColor };
  },
};
