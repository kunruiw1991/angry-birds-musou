// Procedural WebAudio synthesizer + BGM mixer (owner: juice-audio).
// Pure WebAudio synthesis; zero external audio assets. AudioContext is created ONLY inside
// audio.unlock() on the first user gesture. Spec: docs/DESIGN.md §10.

import { bus } from '../core/bus.js';
import { EV, STATE, STORAGE_KEY } from '../contracts.js';
import { createBgmController } from './bgm.js';

const MAX_VOICES = 28;
const THROTTLE_MS = 25;
const LADDER_WINDOW_S = 0.45;
const LADDER_CAP = 12;
const BGM_BASE_VOL = 0.22;
const MASTER_BASE_VOL = 0.85;

const LADDER_SFX = new Set(['wood', 'glass', 'stone', 'pig_pop', 'balloon_pop']);
const HIGH_PRI_SFX = new Set([
  'mega_explosion', 'explosion', 'clear', 'fail', 'star1', 'star2', 'star3',
  'boss_hit', 'pig_pop', 'ability_sting', 'slash', 'laser',
]);

// 12 distinct 3-note ability motifs [midi1, midi2, midi3, wave, stepSec]
const BIRD_STINGS = {
  red:     { notes: [74, 79, 81], wave: 'sawtooth', step: 0.065 }, // D5-G5-A5 heroic fourths
  blues:   { notes: [76, 83, 88], wave: 'triangle', step: 0.055 }, // E5-B5-E6 crystal triad
  chuck:   { notes: [78, 82, 85], wave: 'sawtooth', step: 0.045 }, // F#5-A#5-C#6 speed blitz
  bomb:    { notes: [60, 67, 72], wave: 'sawtooth', step: 0.075 }, // C4-G4-C5 fuse power fifth
  matilda: { notes: [79, 83, 86], wave: 'sine',     step: 0.065 }, // G5-B5-D6 bright chime
  hal:     { notes: [76, 81, 83], wave: 'square',   step: 0.065 }, // E5-A5-B5 desert hawk call
  terence: { notes: [48, 55, 60], wave: 'sawtooth', step: 0.085 }, // C3-G3-C4 titan stomp
  bubbles: { notes: [77, 81, 86], wave: 'triangle', step: 0.060 }, // F5-A5-D6 bouncy sixth
  silver:  { notes: [81, 88, 93], wave: 'triangle', step: 0.055 }, // A5-E6-A6 jet fanfare
  poppy:   { notes: [74, 78, 83], wave: 'triangle', step: 0.060 }, // D5-F#5-B5 whirlwind
  stella:  { notes: [75, 82, 91], wave: 'sine',     step: 0.070 }, // Eb5-Bb5-G6 anti-grav celesta
  gale:    { notes: [69, 72, 80], wave: 'sawtooth', step: 0.065 }, // A4-C5-G#5 dark violet minor
};

export const SFX_LIST = Object.freeze([
  'stretch', 'launch', 'whoosh', 'wood', 'glass', 'stone', 'pig_pop', 'boss_hit',
  'explosion', 'mega_explosion', 'laser', 'egg', 'eagle', 'tornado', 'balloon',
  'balloon_pop', 'poison', 'slash', 'grow', 'meteor', 'jet', 'ring', 'poof',
  'star1', 'star2', 'star3', 'clear', 'fail', 'ui_click', 'ability_ready', 'ability_sting',
]);

let initialized = false;
let ac = null;
let masterComp = null;
let masterGain = null;
let sfxBus = null;
let bgmBus = null;
let noiseBuf = null;
let distCurve = null;

let muted = false;
const bgm = createBgmController();
const activeVoices = [];
const lastPlayMs = new Map();

let ladderStep = 0;
let ladderLastS = -999;

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function loadMutedPref() {
  try {
    const raw = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.muted === 'boolean') {
      muted = parsed.muted;
    }
  } catch (_) {
    // Ignore storage access errors in restricted sandboxes
  }
}

function saveMutedPref() {
  try {
    if (!window.localStorage) return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : { v: 1, levels: {} };
    if (data && typeof data === 'object') {
      data.muted = muted;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch (_) {
    // Ignore storage errors
  }
}

function makeNoiseBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 1.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  let b0 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.55 * b0 + 0.45 * w;
    ch[i] = Math.max(-1, Math.min(1, w * 0.7 + b0 * 0.5));
  }
  return buf;
}

function makeDistortionCurve() {
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + 14) * x * 20 * (Math.PI / 180)) / (Math.PI + 14 * Math.abs(x));
  }
  return curve;
}

function pruneVoices(now) {
  for (let i = activeVoices.length - 1; i >= 0; i--) {
    if (activeVoices[i].end <= now) {
      activeVoices.splice(i, 1);
    }
  }
}

function acquireVoice(dur, priority = false) {
  if (!ac) return null;
  const now = ac.currentTime;
  pruneVoices(now);
  if (activeVoices.length >= MAX_VOICES) {
    if (!priority) return null;
    const oldest = activeVoices.shift();
    if (oldest && oldest.stop) {
      try { oldest.stop(); } catch (_) { /* ignore */ }
    }
  }
  const slot = { end: now + dur + 0.03, stop: null };
  activeVoices.push(slot);
  return slot;
}

function nextPitchLadder(noLadder = false) {
  if (noLadder) return 1;
  const nowS = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  if (nowS - ladderLastS <= LADDER_WINDOW_S) {
    ladderStep = Math.min(LADDER_CAP, ladderStep + 1);
  } else {
    ladderStep = 0;
  }
  ladderLastS = nowS;
  return Math.pow(2, ladderStep / 12);
}

function resetPitchLadder() {
  ladderStep = 0;
  ladderLastS = -999;
}

function duckBgm(duckFactor = 0.6, holdSec = 0.55, releaseSec = 0.45) {
  // §10: BGM volume 0.22, ducks 40% on mega moments -> 0.22 * (1 - 0.40) = 0.132 (or lower)
  if (!ac || !bgmBus) return;
  const t = ac.currentTime;
  const target = BGM_BASE_VOL * Math.max(0.2, Math.min(1, duckFactor));
  bgmBus.gain.cancelScheduledValues(t);
  bgmBus.gain.setValueAtTime(bgmBus.gain.value, t);
  bgmBus.gain.linearRampToValueAtTime(target, t + 0.03);
  bgmBus.gain.setValueAtTime(target, t + holdSec);
  bgmBus.gain.linearRampToValueAtTime(BGM_BASE_VOL, t + holdSec + releaseSec);
}

// ---------- Low-level WebAudio building blocks ----------

function playOscSweep({
  wave = 'sine', f0 = 440, f1 = 220, dur = 0.18, vol = 0.4,
  delay = 0, attack = 0.004, filterHz = 0, filterType = 'lowpass', priority = false,
}) {
  const slot = acquireVoice(delay + dur, priority);
  if (!slot) return;
  const t0 = ac.currentTime + delay;
  const tEnd = t0 + dur;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(Math.max(20, f0), t0);
  if (f1 !== f0) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), tEnd);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(Math.max(0.001, vol), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, tEnd);

  if (filterHz > 0) {
    const flt = ac.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.setValueAtTime(filterHz, t0);
    osc.connect(flt);
    flt.connect(g);
  } else {
    osc.connect(g);
  }
  g.connect(sfxBus);
  osc.start(t0);
  osc.stop(tEnd + 0.01);
  slot.stop = () => { try { osc.stop(); } catch (_) { /* ignore */ } };
}

function playNoiseBurst({
  dur = 0.2, vol = 0.35, delay = 0, filterType = 'bandpass',
  f0 = 1000, f1 = 0, q = 1.2, attack = 0.004, distort = false, priority = false,
}) {
  if (!noiseBuf) return;
  const slot = acquireVoice(delay + dur, priority);
  if (!slot) return;
  const t0 = ac.currentTime + delay;
  const tEnd = t0 + dur;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const offset = Math.random() * Math.max(0, 1.4 - Math.min(1.3, dur));

  const flt = ac.createBiquadFilter();
  flt.type = filterType;
  flt.frequency.setValueAtTime(Math.max(30, f0), t0);
  if (f1 > 0 && f1 !== f0) {
    flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), tEnd);
  }
  flt.Q.setValueAtTime(q, t0);

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(Math.max(0.001, vol), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, tEnd);

  src.connect(flt);
  if (distort && distCurve) {
    const shaper = ac.createWaveShaper();
    shaper.curve = distCurve;
    flt.connect(shaper);
    shaper.connect(g);
  } else {
    flt.connect(g);
  }
  g.connect(sfxBus);
  src.start(t0, offset, Math.min(noiseBuf.duration - offset, dur + 0.02));
  slot.stop = () => { try { src.stop(); } catch (_) { /* ignore */ } };
}

// ---------- Individual §10 SFX patches ----------

function synthSfx(name, opts = {}) {
  const vol = Math.max(0.05, Math.min(1.5, opts.vol ?? 1));
  let pitch = Math.max(0.4, Math.min(2.5, opts.pitch ?? 1));
  if (LADDER_SFX.has(name)) {
    pitch *= nextPitchLadder(!!opts.noLadder);
  }
  const pri = HIGH_PRI_SFX.has(name);

  switch (name) {
    case 'stretch': {
      const pull = opts.pull ?? opts.power ?? 0.5;
      const p = (opts.pitch ?? (0.78 + 0.72 * pull));
      playOscSweep({ wave: 'triangle', f0: 155 * p, f1: 210 * p, dur: 0.075, vol: 0.22 * vol, filterHz: 900 });
      playOscSweep({ wave: 'sawtooth', f0: 92 * p, f1: 112 * p, dur: 0.055, vol: 0.1 * vol, filterHz: 500 });
      break;
    }

    case 'launch': {
      playOscSweep({ wave: 'triangle', f0: 145 * pitch, f1: 560 * pitch, dur: 0.19, vol: 0.48 * vol, priority: true });
      playNoiseBurst({ dur: 0.14, vol: 0.28 * vol, filterType: 'bandpass', f0: 500, f1: 2200, q: 1.4 });
      break;
    }

    case 'whoosh': {
      playNoiseBurst({ dur: 0.22, vol: 0.26 * vol, filterType: 'bandpass', f0: 380 * pitch, f1: 1550 * pitch, q: 1.8, attack: 0.03 });
      break;
    }

    case 'wood': {
      playOscSweep({ wave: 'triangle', f0: 310 * pitch, f1: 145 * pitch, dur: 0.095, vol: 0.38 * vol });
      playOscSweep({ wave: 'sine', f0: 475 * pitch, f1: 240 * pitch, dur: 0.065, vol: 0.26 * vol, delay: 0.01 });
      playNoiseBurst({ dur: 0.065, vol: 0.22 * vol, filterType: 'bandpass', f0: 1400 * pitch, q: 2.2 });
      break;
    }

    case 'glass': {
      playOscSweep({ wave: 'sine', f0: 2450 * pitch, f1: 1850 * pitch, dur: 0.14, vol: 0.24 * vol });
      playOscSweep({ wave: 'triangle', f0: 3680 * pitch, f1: 2950 * pitch, dur: 0.11, vol: 0.2 * vol, delay: 0.015 });
      playOscSweep({ wave: 'sine', f0: 4920 * pitch, f1: 3900 * pitch, dur: 0.09, vol: 0.15 * vol, delay: 0.028 });
      playNoiseBurst({ dur: 0.11, vol: 0.25 * vol, filterType: 'highpass', f0: 3200, q: 1.0 });
      break;
    }

    case 'stone': {
      playOscSweep({ wave: 'sine', f0: 118 * pitch, f1: 46 * pitch, dur: 0.16, vol: 0.46 * vol });
      playNoiseBurst({ dur: 0.15, vol: 0.34 * vol, filterType: 'lowpass', f0: 780 * pitch, f1: 260, q: 1.1 });
      break;
    }

    case 'pig_pop': {
      playOscSweep({ wave: 'sine', f0: 210 * pitch, f1: 680 * pitch, dur: 0.13, vol: 0.45 * vol, priority: pri });
      playOscSweep({ wave: 'sawtooth', f0: 165 * pitch, f1: 118 * pitch, dur: 0.09, vol: 0.22 * vol, filterHz: 750, priority: pri });
      playNoiseBurst({ dur: 0.08, vol: 0.22 * vol, filterType: 'bandpass', f0: 1600 * pitch, q: 1.8 });
      break;
    }

    case 'boss_hit': {
      playOscSweep({ wave: 'sine', f0: 155 * pitch, f1: 58 * pitch, dur: 0.22, vol: 0.52 * vol, priority: true });
      playOscSweep({ wave: 'triangle', f0: 720 * pitch, f1: 660 * pitch, dur: 0.18, vol: 0.28 * vol, priority: true });
      playOscSweep({ wave: 'square', f0: 1085 * pitch, f1: 990 * pitch, dur: 0.14, vol: 0.16 * vol, filterHz: 2400 });
      break;
    }

    case 'explosion':
    case 'tnt': {
      playOscSweep({ wave: 'sine', f0: 115 * pitch, f1: 30, dur: 0.42, vol: 0.58 * vol, priority: true });
      playNoiseBurst({ dur: 0.44, vol: 0.46 * vol, filterType: 'lowpass', f0: 1100, f1: 180, q: 0.9, distort: true, priority: true });
      break;
    }

    case 'mega_explosion': {
      duckBgm(0.55, 0.7, 0.55); // >40% duck on mega moment
      playOscSweep({ wave: 'sine', f0: 95, f1: 22, dur: 0.88, vol: 0.78 * vol, priority: true });
      playOscSweep({ wave: 'sawtooth', f0: 140, f1: 32, dur: 0.65, vol: 0.42 * vol, filterHz: 420, priority: true });
      playNoiseBurst({ dur: 0.85, vol: 0.65 * vol, filterType: 'lowpass', f0: 1800, f1: 140, q: 1.1, distort: true, priority: true });
      playNoiseBurst({ dur: 0.32, vol: 0.4 * vol, delay: 0.04, filterType: 'bandpass', f0: 2400, f1: 500, q: 1.4, priority: true });
      break;
    }

    case 'laser': {
      playOscSweep({ wave: 'sawtooth', f0: 1950 * pitch, f1: 260 * pitch, dur: 0.16, vol: 0.34 * vol, filterHz: 3600, priority: true });
      playOscSweep({ wave: 'square', f0: 2600 * pitch, f1: 420 * pitch, dur: 0.11, vol: 0.18 * vol });
      break;
    }

    case 'egg': {
      playOscSweep({ wave: 'sine', f0: 480 * pitch, f1: 920 * pitch, dur: 0.09, vol: 0.34 * vol });
      playOscSweep({ wave: 'triangle', f0: 880 * pitch, f1: 380 * pitch, dur: 0.11, delay: 0.05, vol: 0.25 * vol });
      break;
    }

    case 'eagle': {
      playOscSweep({ wave: 'sawtooth', f0: 1720 * pitch, f1: 1020 * pitch, dur: 0.34, vol: 0.32 * vol, filterHz: 2600, attack: 0.02 });
      playOscSweep({ wave: 'triangle', f0: 1680 * pitch, f1: 960 * pitch, dur: 0.3, delay: 0.03, vol: 0.24 * vol });
      playNoiseBurst({ dur: 0.3, vol: 0.25 * vol, filterType: 'bandpass', f0: 900, f1: 420, q: 1.4, attack: 0.03 });
      break;
    }

    case 'tornado': {
      playNoiseBurst({ dur: 0.48, vol: 0.34 * vol, filterType: 'bandpass', f0: 340 * pitch, f1: 1050 * pitch, q: 2.6, attack: 0.05 });
      playNoiseBurst({ dur: 0.42, vol: 0.24 * vol, delay: 0.12, filterType: 'bandpass', f0: 950 * pitch, f1: 400 * pitch, q: 2.2, attack: 0.05 });
      break;
    }

    case 'balloon': {
      playOscSweep({ wave: 'sine', f0: 230 * pitch, f1: 610 * pitch, dur: 0.22, vol: 0.36 * vol, attack: 0.02 });
      playOscSweep({ wave: 'triangle', f0: 345 * pitch, f1: 790 * pitch, dur: 0.16, delay: 0.03, vol: 0.2 * vol });
      break;
    }

    case 'balloon_pop': {
      playOscSweep({ wave: 'sine', f0: 880 * pitch, f1: 190 * pitch, dur: 0.085, vol: 0.42 * vol });
      playNoiseBurst({ dur: 0.075, vol: 0.32 * vol, filterType: 'highpass', f0: 1500, q: 1.2 });
      break;
    }

    case 'poison': {
      playOscSweep({ wave: 'sine', f0: 340 * pitch, f1: 590 * pitch, dur: 0.08, vol: 0.28 * vol });
      playOscSweep({ wave: 'sine', f0: 420 * pitch, f1: 710 * pitch, dur: 0.08, delay: 0.06, vol: 0.26 * vol });
      playNoiseBurst({ dur: 0.24, vol: 0.22 * vol, filterType: 'bandpass', f0: 2800, f1: 1400, q: 2.0 });
      break;
    }

    case 'slash': {
      playNoiseBurst({ dur: 0.16, vol: 0.44 * vol, filterType: 'bandpass', f0: 3800 * pitch, f1: 520 * pitch, q: 2.4, priority: true });
      playOscSweep({ wave: 'sawtooth', f0: 1450 * pitch, f1: 220 * pitch, dur: 0.14, vol: 0.32 * vol, filterHz: 3200, priority: true });
      break;
    }

    case 'grow': {
      playOscSweep({ wave: 'sawtooth', f0: 82 * pitch, f1: 310 * pitch, dur: 0.34, vol: 0.44 * vol, filterHz: 950, attack: 0.02 });
      playOscSweep({ wave: 'triangle', f0: 123 * pitch, f1: 465 * pitch, dur: 0.34, vol: 0.34 * vol, attack: 0.02 });
      break;
    }

    case 'meteor': {
      playOscSweep({ wave: 'sine', f0: 1480 * pitch, f1: 290 * pitch, dur: 0.28, vol: 0.32 * vol });
      playNoiseBurst({ dur: 0.26, vol: 0.28 * vol, filterType: 'bandpass', f0: 1900, f1: 480, q: 1.6 });
      break;
    }

    case 'jet': {
      playNoiseBurst({ dur: 0.32, vol: 0.38 * vol, filterType: 'bandpass', f0: 480, f1: 2100, q: 1.5, distort: true });
      playOscSweep({ wave: 'sawtooth', f0: 280 * pitch, f1: 1120 * pitch, dur: 0.28, vol: 0.24 * vol, filterHz: 2200 });
      break;
    }

    case 'ring': {
      playOscSweep({ wave: 'sine', f0: 880 * pitch, f1: 900 * pitch, dur: 0.24, vol: 0.3 * vol });
      playOscSweep({ wave: 'triangle', f0: 1320 * pitch, f1: 1350 * pitch, dur: 0.22, delay: 0.03, vol: 0.24 * vol });
      break;
    }

    case 'poof': {
      playOscSweep({ wave: 'triangle', f0: 230 * pitch, f1: 85 * pitch, dur: 0.15, vol: 0.3 * vol });
      playNoiseBurst({ dur: 0.16, vol: 0.24 * vol, filterType: 'bandpass', f0: 720, f1: 320, q: 1.2, attack: 0.015 });
      break;
    }

    case 'star1': {
      playOscSweep({ wave: 'sine', f0: 1046.5, f1: 1046.5, dur: 0.32, vol: 0.42 * vol, priority: true });
      playOscSweep({ wave: 'triangle', f0: 2093, f1: 2093, dur: 0.2, vol: 0.18 * vol, priority: true });
      break;
    }

    case 'star2': {
      playOscSweep({ wave: 'sine', f0: 1318.5, f1: 1318.5, dur: 0.34, vol: 0.44 * vol, priority: true });
      playOscSweep({ wave: 'triangle', f0: 2637, f1: 2637, dur: 0.22, vol: 0.2 * vol, priority: true });
      break;
    }

    case 'star3': {
      playOscSweep({ wave: 'sine', f0: 1568, f1: 1568, dur: 0.22, vol: 0.42 * vol, priority: true });
      playOscSweep({ wave: 'sine', f0: 2093, f1: 2093, dur: 0.42, delay: 0.07, vol: 0.48 * vol, priority: true });
      playOscSweep({ wave: 'triangle', f0: 3136, f1: 3136, dur: 0.28, delay: 0.07, vol: 0.22 * vol, priority: true });
      break;
    }

    case 'clear': {
      duckBgm(0.5, 0.9, 0.5);
      const fanfare = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      fanfare.forEach((f, idx) => {
        playOscSweep({
          wave: 'triangle', f0: f, f1: f,
          dur: idx === fanfare.length - 1 ? 0.55 : 0.18,
          delay: idx * 0.085,
          vol: 0.38 * vol,
          priority: true,
        });
      });
      break;
    }

    case 'fail': {
      duckBgm(0.5, 0.85, 0.5);
      const notes = [196, 185, 174.6, 164.8];
      notes.forEach((f, idx) => {
        playOscSweep({
          wave: 'sawtooth',
          f0: f,
          f1: idx === 3 ? f * 0.88 : f * 0.97,
          dur: idx === 3 ? 0.48 : 0.2,
          delay: idx * 0.21,
          vol: 0.34 * vol,
          filterHz: 750,
          priority: true,
        });
      });
      break;
    }

    case 'ui_click': {
      playOscSweep({ wave: 'triangle', f0: 720 * pitch, f1: 1020 * pitch, dur: 0.045, vol: 0.28 * vol });
      break;
    }

    case 'ability_ready': {
      playOscSweep({ wave: 'sine', f0: 784, f1: 784, dur: 0.09, vol: 0.22 * vol });
      playOscSweep({ wave: 'triangle', f0: 1174.7, f1: 1174.7, dur: 0.14, delay: 0.065, vol: 0.24 * vol });
      break;
    }

    case 'ability_sting': {
      playBirdSting(opts.birdId || 'red', vol);
      break;
    }

    default: {
      if (name && name.startsWith('sting:')) {
        playBirdSting(name.slice(6), vol);
      } else {
        playOscSweep({ wave: 'triangle', f0: 440 * pitch, f1: 330 * pitch, dur: 0.08, vol: 0.22 * vol });
      }
      break;
    }
  }
}

function playBirdSting(birdId, vol = 1) {
  if (!ac) return;
  const cfg = BIRD_STINGS[birdId] || BIRD_STINGS.red;
  duckBgm(0.6, 0.45, 0.35);
  cfg.notes.forEach((m, idx) => {
    const f = midiHz(m);
    playOscSweep({
      wave: cfg.wave,
      f0: f,
      f1: idx === 2 ? f * 1.015 : f,
      dur: idx === 2 ? 0.22 : cfg.step * 1.35,
      delay: idx * cfg.step,
      vol: 0.36 * vol,
      filterHz: cfg.wave === 'sawtooth' || cfg.wave === 'square' ? 2400 : 0,
      priority: true,
    });
  });
}

export const audio = {
  /** Call from the first pointerdown/keydown/touchstart handler. Idempotent. */
  unlock() {
    if (ac) {
      if (ac.state === 'suspended') {
        ac.resume().catch(() => {});
      }
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ac = new AC();
    } catch (_) {
      return false;
    }

    masterComp = ac.createDynamicsCompressor();
    masterComp.threshold.setValueAtTime(-18, ac.currentTime);
    masterComp.knee.setValueAtTime(12, ac.currentTime);
    masterComp.ratio.setValueAtTime(4, ac.currentTime);
    masterComp.attack.setValueAtTime(0.003, ac.currentTime);
    masterComp.release.setValueAtTime(0.18, ac.currentTime);

    masterGain = ac.createGain();
    masterGain.gain.setValueAtTime(muted ? 0 : MASTER_BASE_VOL, ac.currentTime);

    sfxBus = ac.createGain();
    sfxBus.gain.setValueAtTime(0.95, ac.currentTime);

    bgmBus = ac.createGain();
    bgmBus.gain.setValueAtTime(BGM_BASE_VOL, ac.currentTime);

    sfxBus.connect(masterComp);
    bgmBus.connect(masterComp);
    masterComp.connect(masterGain);
    masterGain.connect(ac.destination);

    noiseBuf = makeNoiseBuffer(ac);
    distCurve = makeDistortionCurve();

    if (ac.state === 'suspended') {
      ac.resume().catch(() => {});
    }

    bgm.attach(ac, bgmBus, noiseBuf);
    return true;
  },

  init() {
    if (initialized) return;
    initialized = true;
    loadMutedPref();

    // Unlock AudioContext on any genuine first user gesture (canvas OR HUD buttons/keys)
    const onGesture = () => this.unlock();
    window.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
    window.addEventListener('touchstart', onGesture, { capture: true, passive: true });
    window.addEventListener('keydown', onGesture, { capture: true, passive: true });

    bus.on(EV.SFX, (p = {}) => {
      if (p.name) this.play(p.name, p);
    });

    bus.on(EV.LEVEL_START, (p = {}) => {
      resetPitchLadder();
      this.music(p.biome || 'grass');
    });

    bus.on(EV.BIRD_READY, () => {
      this.play('ability_ready', { vol: 0.45 });
    });

    bus.on(EV.LAUNCH, (p = {}) => {
      this.play('launch', { pitch: 0.9 + 0.25 * (p.power ?? 0.8) });
      this.play('whoosh', { vol: 0.55 });
    });

    bus.on(EV.BIRD_HIT, (p = {}) => {
      const v = Math.min(1, (p.speed || 7) / 18);
      this.play('wood', { vol: 0.32 * v, pitch: 0.76, noLadder: true });
    });

    bus.on(EV.ABILITY, (p = {}) => {
      this.play('ability_sting', { birdId: p.birdId || 'red', vol: 1.0 });
    });

    bus.on(EV.BREAK, (p = {}) => {
      const m = p.mat === 'glass' ? 'glass' : p.mat === 'stone' ? 'stone' : 'wood';
      this.play(m, { x: p.x, y: p.y });
    });

    bus.on(EV.PIG_POP, (p = {}) => {
      this.play('pig_pop', { pitch: p.boss ? 0.72 : 1.0, vol: p.boss ? 1.0 : 0.88 });
      if (p.boss) this.play('boss_hit', { vol: 0.9 });
    });

    bus.on(EV.DAMAGE, (p = {}) => {
      if (p.kind === 'pig' && !p.killed && p.amount >= 90) {
        this.play('boss_hit', { vol: 0.65 });
      }
    });

    bus.on(EV.EXPLOSION, (p = {}) => {
      if (p.power === 'mega') {
        this.play('mega_explosion', p);
      } else {
        this.play('explosion', { ...p, vol: p.power === 'small' ? 0.65 : 0.9 });
      }
    });

    bus.on(EV.COMBO, (p = {}) => {
      if (p.count === 20 || p.count === 40) {
        this.play('ring', { pitch: p.count >= 40 ? 1.35 : 1.1, vol: 0.88 });
      }
    });

    bus.on(EV.LEVEL_CLEAR, (p = {}) => {
      this.play('clear');
      const stars = Math.min(3, Math.max(0, p.stars || 0));
      for (let i = 1; i <= stars; i++) {
        setTimeout(() => this.play(`star${i}`), i * 350);
      }
    });

    bus.on(EV.LEVEL_FAIL, () => {
      this.play('fail');
    });

    bus.on(EV.STATE, (p = {}) => {
      bgm.setPaused(p.state === STATE.PAUSED);
    });
  },

  play(name, opts = {}) {
    if (!name || !ac || muted) return false;
    if (ac.state === 'suspended') {
      ac.resume().catch(() => {});
    }
    const throttleKey = name === 'ability_sting' ? `sting:${opts.birdId || 'red'}` : name;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const prevMs = lastPlayMs.get(throttleKey) ?? -9999;
    if (nowMs - prevMs < THROTTLE_MS) return false;
    lastPlayMs.set(throttleKey, nowMs);

    synthSfx(name, opts);
    return true;
  },

  music(biome) {
    bgm.setBiome(biome || 'grass');
  },

  setMuted(b) {
    muted = !!b;
    saveMutedPref();
    if (ac && masterGain) {
      const t = ac.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setTargetAtTime(muted ? 0 : MASTER_BASE_VOL, t, 0.015);
    }
    return muted;
  },

  toggleMuted() {
    return this.setMuted(!muted);
  },

  isMuted() {
    return muted;
  },

  get context() {
    return ac;
  },

  get sfxList() {
    return SFX_LIST;
  },

  stats() {
    if (ac) pruneVoices(ac.currentTime);
    return {
      unlocked: !!ac,
      state: ac ? ac.state : 'uninitialized',
      muted,
      biome: bgm.getBiome(),
      activeVoices: activeVoices.length,
      maxVoices: MAX_VOICES,
      ladderStep,
    };
  },
};
