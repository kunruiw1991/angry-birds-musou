// Original jaunty 6/8 procedural BGM engine per biome (owner: juice-audio).
// Pure WebAudio step-sequencer; zero external audio files. Spec: docs/DESIGN.md §10.
// Each biome uses a 24-step (4 bars of 6/8 compound meter: 1-2-3 4-5-6) loop.

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Original 6/8 compositions (MIDI note numbers, 0 = rest):
// 1. GRASS: Sunny G-major pastoral jig (G major: G B D E F# A), lively bouncy 6/8
const BIOME_SCORES = {
  grass: {
    eighthDur: 0.185, // ~108 dotted-quarter BPM (jaunty 6/8)
    leadWave: 'triangle',
    bassWave: 'triangle',
    harmWave: 'sine',
    lead: [
      79, 0, 83, 86, 0, 83,   81, 0, 79, 76, 0, 74,
      79, 81, 83, 88, 0, 86,  83, 0, 81, 79, 0, 0,
    ],
    harm: [
      71, 0, 0, 74, 0, 0,     72, 0, 0, 67, 0, 0,
      71, 0, 0, 76, 0, 0,     74, 0, 72, 71, 0, 0,
    ],
    bass: [
      55, 0, 62, 50, 0, 62,   48, 0, 55, 52, 0, 59,
      55, 0, 62, 57, 0, 64,   50, 0, 57, 55, 0, 50,
    ],
    perc: [
      'k', 0, 'h', 's', 0, 'h',  'k', 0, 'h', 's', 'h', 'h',
      'k', 0, 'h', 's', 0, 'h',  'k', 'h', 's', 'k', 0, 'h',
    ],
  },

  // 2. DESERT: Breezy D-mixolydian caravan 6/8 dance (D E F# G A B C)
  desert: {
    eighthDur: 0.195,
    leadWave: 'sawtooth',
    leadFilterHz: 1700,
    bassWave: 'triangle',
    harmWave: 'triangle',
    lead: [
      74, 0, 78, 81, 83, 81,  79, 0, 78, 76, 0, 74,
      76, 0, 79, 81, 0, 84,   83, 81, 78, 74, 0, 0,
    ],
    harm: [
      66, 0, 0, 69, 0, 0,     67, 0, 0, 64, 0, 0,
      64, 0, 0, 69, 0, 0,     67, 0, 66, 62, 0, 0,
    ],
    bass: [
      50, 0, 57, 50, 57, 0,   48, 0, 55, 48, 55, 0,
      52, 0, 59, 57, 0, 55,   48, 0, 50, 50, 0, 45,
    ],
    perc: [
      't', 0, 'h', 't', 'h', 't',  't', 0, 'h', 's', 0, 'h',
      't', 0, 'h', 't', 'h', 't',  't', 't', 'h', 's', 0, 'h',
    ],
  },

  // 3. CITY: Cool upbeat A-dorian night caper 6/8 groove (A B C D E F# G)
  city: {
    eighthDur: 0.172,
    leadWave: 'square',
    leadFilterHz: 1950,
    bassWave: 'sawtooth',
    bassFilterHz: 520,
    harmWave: 'triangle',
    lead: [
      69, 0, 72, 76, 0, 78,   79, 76, 72, 74, 0, 0,
      72, 0, 76, 81, 0, 79,   78, 0, 76, 69, 0, 0,
    ],
    harm: [
      64, 0, 0, 67, 0, 0,     66, 0, 0, 62, 0, 0,
      64, 0, 0, 69, 0, 0,     66, 0, 64, 60, 0, 0,
    ],
    bass: [
      45, 0, 57, 45, 0, 52,   48, 0, 60, 50, 0, 57,
      45, 0, 57, 41, 0, 53,   43, 0, 55, 45, 0, 52,
    ],
    perc: [
      'k', 'h', 'h', 's', 'h', 'h',  'k', 'h', 'k', 's', 'h', 'h',
      'k', 'h', 'h', 's', 'h', 'h',  'k', 'k', 's', 'h', 's', 'h',
    ],
  },
};

export function createBgmController() {
  let ac = null;
  let outGain = null;
  let noiseBuf = null;
  let currentBiome = null;
  let paused = false;
  let timerId = null;
  let stepIndex = 0;
  let nextNoteTime = 0;

  function scheduleTone(freq, t, dur, wave, gainPeak, filterHz = 0) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainPeak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);

    if (filterHz > 0) {
      const flt = ac.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(filterHz, t);
      osc.connect(flt);
      flt.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(outGain);
    osc.start(t);
    osc.stop(t + dur + 0.015);
  }

  function schedulePerc(kind, t) {
    if (kind === 'k' || kind === 't') {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sine';
      const f0 = kind === 't' ? 165 : 125;
      const f1 = kind === 't' ? 78 : 44;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + 0.09);
      g.gain.setValueAtTime(0.28, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      osc.connect(g);
      g.connect(outGain);
      osc.start(t);
      osc.stop(t + 0.12);
      return;
    }
    if (!noiseBuf) return;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const flt = ac.createBiquadFilter();
    const g = ac.createGain();
    if (kind === 's') {
      flt.type = 'bandpass';
      flt.frequency.setValueAtTime(1900, t);
      flt.Q.setValueAtTime(1.2, t);
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
      src.start(t, 0, 0.095);
    } else {
      flt.type = 'highpass';
      flt.frequency.setValueAtTime(5500, t);
      g.gain.setValueAtTime(0.075, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.038);
      src.start(t, 0.1, 0.045);
    }
    src.connect(flt);
    flt.connect(g);
    g.connect(outGain);
  }

  function scheduleStep(score, idx, t) {
    const dur = score.eighthDur;
    const accent = idx % 6 === 0 ? 1.15 : idx % 3 === 0 ? 1.05 : 0.88;
    const mLead = score.lead[idx];
    if (mLead) {
      scheduleTone(
        midiToHz(mLead),
        t,
        dur * 1.45,
        score.leadWave,
        0.24 * accent,
        score.leadFilterHz || 0,
      );
    }
    const mHarm = score.harm[idx];
    if (mHarm) {
      scheduleTone(midiToHz(mHarm), t, dur * 1.8, score.harmWave, 0.13);
    }
    const mBass = score.bass[idx];
    if (mBass) {
      scheduleTone(
        midiToHz(mBass),
        t,
        dur * 1.55,
        score.bassWave,
        0.3 * accent,
        score.bassFilterHz || 0,
      );
    }
    const p = score.perc[idx];
    if (p) schedulePerc(p, t);
  }

  function tick() {
    if (!ac || !outGain || paused || !currentBiome) return;
    if (ac.state !== 'running') return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const score = BIOME_SCORES[currentBiome] || BIOME_SCORES.grass;
    const now = ac.currentTime;
    if (nextNoteTime < now - 0.05) {
      nextNoteTime = now + 0.03;
    }
    while (nextNoteTime < now + 0.26) {
      scheduleStep(score, stepIndex % 24, nextNoteTime);
      nextNoteTime += score.eighthDur;
      stepIndex = (stepIndex + 1) % 24;
    }
  }

  function ensureTimer() {
    if (timerId != null) return;
    timerId = setInterval(tick, 95);
  }

  function stopTimer() {
    if (timerId != null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  return {
    attach(context, gainNode, sharedNoiseBuffer) {
      ac = context;
      outGain = gainNode;
      noiseBuf = sharedNoiseBuffer;
      if (currentBiome && !paused) {
        nextNoteTime = ac.currentTime + 0.04;
        ensureTimer();
        tick();
      }
    },

    setBiome(biome) {
      if (!biome || biome === 'off' || biome === 'none') {
        currentBiome = null;
        stopTimer();
        return;
      }
      const next = BIOME_SCORES[biome] ? biome : 'grass';
      if (currentBiome !== next) {
        currentBiome = next;
        stepIndex = 0;
        if (ac) nextNoteTime = ac.currentTime + 0.04;
      }
      if (ac && !paused) {
        ensureTimer();
        tick();
      }
    },

    setPaused(b) {
      paused = !!b;
      if (!paused && ac && currentBiome) {
        nextNoteTime = ac.currentTime + 0.04;
        ensureTimer();
      }
    },

    getBiome() {
      return currentBiome;
    },
  };
}
