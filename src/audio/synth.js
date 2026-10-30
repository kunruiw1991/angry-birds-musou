// WebAudio procedural SFX + BGM (owner: juice-audio). SKELETON by opus-director: API only.
// Rules: WebAudio only (zero speechSynthesis, zero audio files), AudioContext created on the
// first user gesture, master compressor, voice cap. Spec: docs/DESIGN.md §Audio.

import { bus } from '../core/bus.js';
import { EV } from '../contracts.js';

let ac = null, master = null, muted = false;

export const audio = {
  /** Call from the first pointerdown/keydown handler. Idempotent. */
  unlock() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ac.destination);
  },
  init() {
    bus.on(EV.SFX, (p) => this.play(p.name, p));
  },
  play(name, opts = {}) { /* juice-audio implements */ },
  music(biome) { /* juice-audio implements */ },
  setMuted(b) { muted = !!b; if (master) master.gain.value = muted ? 0 : 0.8; },
  isMuted() { return muted; },
  get context() { return ac; },
};
