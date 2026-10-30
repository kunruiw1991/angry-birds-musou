// Generic visual effects in SCREEN PIXELS (owner: render-art).
// Spec: docs/DESIGN.md §8 & src/contracts.js EFFECT_TYPES:
//   explosion (video style: white-yellow core -> orange fireball -> black smoke puffs;
//              power === 'mega' fills the screen),
//   shockwave, flashring, beam, text.
// Zero shadowBlur anywhere for high-FPS chaos performance.

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hashSeed(e) {
  const xi = Math.round((e.x || 0) * 17) | 0;
  const yi = Math.round((e.y || 0) * 17) | 0;
  const ti = Math.round((e.t0 || 0) * 60) | 0;
  return ((xi * 73856093) ^ (yi * 19349663) ^ (ti * 83492791)) >>> 0;
}

function seeded01(seed, idx) {
  let s = (seed + idx * 0x9E3779B9) >>> 0;
  s ^= s >>> 16;
  s = Math.imul(s, 0x85EBCA6B) >>> 0;
  s ^= s >>> 13;
  return (s >>> 0) / 4294967296;
}

export const GENERIC_EFFECTS = {
  explosion(g, e, t, cam) {
    const ttl = e.ttl || 0.7;
    const age = t - e.t0;
    const k = clamp01(age / ttl);
    if (k >= 1) return;

    const isMega = e.power === 'mega';
    const isSmall = e.power === 'small';
    const sx = cam.sx(e.x);
    const sy = cam.sy(e.y);

    const worldR = (e.r || 2.0) * (isSmall ? 0.85 : 1.08);
    const basePx = worldR * cam.s;
    const R = isMega
      ? Math.max(basePx * 1.55, Math.hypot(cam.w, cam.h) * 0.54)
      : Math.max(14, basePx);

    // Quick cull for normal/small off-screen explosions
    if (!isMega && (sx + R * 1.4 < 0 || sx - R * 1.4 > cam.w || sy + R * 1.4 < 0 || sy - R * 1.4 > cam.h)) {
      return;
    }

    const seed = hashSeed(e);
    const easeOut = 1 - Math.pow(1 - k, 2.6);
    const fade = k < 0.62 ? 1 : clamp01((1 - k) / 0.38);

    // 0. Mega supersonic shockwave & radial rays
    if (isMega && k < 0.78) {
      const sk = clamp01(k / 0.78);
      const sr = R * (0.25 + 1.05 * (1 - Math.pow(1 - sk, 3)));
      g.globalAlpha = (1 - sk) * 0.75;
      g.strokeStyle = '#ffae33';
      g.lineWidth = Math.max(4, (1 - sk) * 26);
      g.beginPath();
      g.arc(sx, sy, sr, 0, Math.PI * 2);
      g.stroke();

      g.strokeStyle = '#fffbe0';
      g.lineWidth = Math.max(2, (1 - sk) * 10);
      g.beginPath();
      g.arc(sx, sy, sr * 0.96, 0, Math.PI * 2);
      g.stroke();
    }

    // 1. Outer scalloped black/charcoal smoke puffs (exact video signature!)
    const nPuffs = isMega ? 14 : isSmall ? 7 : 9;
    const smokeExpand = 0.42 + 0.72 * easeOut;
    g.globalAlpha = fade * (k < 0.08 ? 0.65 + k * 4 : 0.96);
    g.fillStyle = '#161214';
    g.beginPath();
    for (let i = 0; i < nPuffs; i++) {
      const jitter = (seeded01(seed, i) - 0.5) * 0.35;
      const distJit = 0.82 + seeded01(seed, i + 31) * 0.34;
      const ang = (i / nPuffs) * Math.PI * 2 + jitter + k * 0.22;
      const dist = R * smokeExpand * distJit * 0.68;
      const pr = R * (0.28 + seeded01(seed, i + 67) * 0.16) * (0.7 + 0.45 * easeOut);
      const px = sx + Math.cos(ang) * dist;
      const py = sy + Math.sin(ang) * dist;
      g.moveTo(px + pr, py);
      g.arc(px, py, pr, 0, Math.PI * 2);
    }
    // Central dark smoke backing
    if (k < 0.78) {
      const cr = R * smokeExpand * 0.62 * (1 - Math.max(0, k - 0.55) * 1.4);
      if (cr > 1) {
        g.moveTo(sx + cr, sy);
        g.arc(sx, sy, cr, 0, Math.PI * 2);
      }
    }
    g.fill();

    // Secondary warm charcoal smoke highlights on outer puffs
    if (k > 0.12) {
      g.globalAlpha = fade * 0.55;
      g.fillStyle = '#2d2528';
      g.beginPath();
      for (let i = 0; i < nPuffs; i += 2) {
        const ang = (i / nPuffs) * Math.PI * 2 + 0.18 + k * 0.22;
        const dist = R * smokeExpand * 0.62;
        const pr = R * 0.22 * (0.75 + 0.35 * easeOut);
        const px = sx + Math.cos(ang) * dist;
        const py = sy + Math.sin(ang) * dist;
        g.moveTo(px + pr, py);
        g.arc(px, py, pr, 0, Math.PI * 2);
      }
      g.fill();
    }

    // 2. Scalloped bright orange-red fireball (peaks early-mid, shrinks inside smoke)
    if (k < 0.76) {
      const fk = k / 0.76;
      const fireScale = fk < 0.25 ? (0.55 + fk * 1.8) : (1.0 - (fk - 0.25) * 1.15);
      if (fireScale > 0.04) {
        const fireR = R * 0.64 * fireScale;
        g.globalAlpha = clamp01(1.15 - fk * 1.15);
        g.fillStyle = '#ff5510';
        g.beginPath();
        g.arc(sx, sy, fireR * 0.85, 0, Math.PI * 2);
        const fireLobes = isMega ? 10 : 7;
        for (let i = 0; i < fireLobes; i++) {
          const ang = (i / fireLobes) * Math.PI * 2 + seeded01(seed, i + 101) * 0.4;
          const d = fireR * 0.58;
          const lr = fireR * (0.38 + seeded01(seed, i + 131) * 0.16);
          const lx = sx + Math.cos(ang) * d;
          const ly = sy + Math.sin(ang) * d;
          g.moveTo(lx + lr, ly);
          g.arc(lx, ly, lr, 0, Math.PI * 2);
        }
        g.fill();

        // Golden-orange inner flame
        g.fillStyle = '#ff9d1c';
        g.beginPath();
        g.arc(sx, sy, fireR * 0.66, 0, Math.PI * 2);
        g.fill();
      }
    }

    // 3. Searing white-yellow core (strongest in first ~60-150 ms, exact video flash!)
    if (k < 0.45) {
      const ck = k / 0.45;
      const coreScale = age < 0.065 ? 1.08 : (1 - ck * 0.88);
      const coreR = R * (isMega ? 0.52 : 0.44) * Math.max(0.05, coreScale);
      g.globalAlpha = clamp01(1 - ck * 0.9);
      g.fillStyle = '#fff280';
      g.beginPath();
      g.arc(sx, sy, coreR * 1.22, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(sx, sy, coreR * 0.78, 0, Math.PI * 2);
      g.fill();
    }

    g.globalAlpha = 1;
  },

  shockwave(g, e, t, cam) {
    const k = clamp01((t - e.t0) / (e.ttl || 0.45));
    if (k >= 1) return;
    const ease = 1 - Math.pow(1 - k, 3);
    const sx = cam.sx(e.x), sy = cam.sy(e.y);
    const R = Math.max(8, (e.r || 3) * cam.s * (0.15 + 0.90 * ease));
    if (sx + R < 0 || sx - R > cam.w || sy + R < 0 || sy - R > cam.h) return;

    const alpha = Math.pow(1 - k, 1.35);
    const col = e.color || '#ffffff';
    const baseW = Math.max(3, (e.width ? e.width * cam.s : 11) * (1 - k * 0.72));

    g.globalAlpha = alpha * 0.48;
    g.strokeStyle = col;
    g.lineWidth = baseW * 1.9;
    g.beginPath();
    g.arc(sx, sy, R, 0, Math.PI * 2);
    g.stroke();

    g.globalAlpha = alpha;
    g.strokeStyle = '#ffffff';
    g.lineWidth = baseW * 0.65;
    g.beginPath();
    g.arc(sx, sy, R, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  },

  flashring(g, e, t, cam) {
    const k = clamp01((t - e.t0) / (e.ttl || 0.35));
    if (k >= 1) return;
    const ease = 1 - Math.pow(1 - k, 2.5);
    const sx = cam.sx(e.x), sy = cam.sy(e.y);
    const maxR = Math.max(10, (e.r || 2.2) * cam.s);
    if (sx + maxR < 0 || sx - maxR > cam.w || sy + maxR < 0 || sy - maxR > cam.h) return;

    const col = e.color || '#fff396';
    if (k < 0.4) {
      g.globalAlpha = (1 - k / 0.4) * 0.55;
      g.fillStyle = col;
      g.beginPath();
      g.arc(sx, sy, maxR * (0.4 + 0.5 * ease), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1 - k;
    g.strokeStyle = col;
    g.lineWidth = Math.max(2.5, 9 * (1 - k));
    g.beginPath();
    g.arc(sx, sy, maxR * (0.28 + 0.78 * ease), 0, Math.PI * 2);
    g.stroke();

    g.strokeStyle = '#ffffff';
    g.lineWidth = Math.max(1.5, 4 * (1 - k));
    g.beginPath();
    g.arc(sx, sy, maxR * (0.18 + 0.55 * ease), 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  },

  beam(g, e, t, cam) {
    const k = clamp01((t - e.t0) / (e.ttl || 0.35));
    if (k >= 1) return;
    const x1 = cam.sx(e.x), y1 = cam.sy(e.y);
    const x2 = cam.sx(e.x2 ?? e.x), y2 = cam.sy(e.y2 ?? e.y);
    const wPx = Math.max(3, (e.width || 0.32) * cam.s * (1 - k * 0.45));
    const col = e.color || '#ffe600';
    const alpha = clamp01(1.15 - k * 1.15);

    const prevComp = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';

    // Outer colored aura
    g.globalAlpha = alpha * 0.38;
    g.strokeStyle = col;
    g.lineWidth = wPx * 2.3;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();

    // Vivid mid beam
    g.globalAlpha = alpha * 0.88;
    g.strokeStyle = col;
    g.lineWidth = wPx * 1.1;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();

    // White-hot inner core
    g.globalAlpha = alpha;
    g.strokeStyle = '#ffffff';
    g.lineWidth = Math.max(1.8, wPx * 0.42);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();

    // Origin flare
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x1, y1, wPx * 0.85, 0, Math.PI * 2);
    g.fill();

    g.globalCompositeOperation = prevComp;
    g.globalAlpha = 1;
  },

  text(g, e, t, cam) {
    const k = clamp01((t - e.t0) / (e.ttl || 0.9));
    if (k >= 1 || !e.text) return;
    const pop = k < 0.18 ? (1.36 - (k / 0.18) * 0.36) : 1.0;
    const alpha = k < 0.65 ? 1 : clamp01((1 - k) / 0.35);
    const sx = cam.sx(e.x);
    const sy = cam.sy(e.y) - k * 34;
    const size = Math.round((e.size || 28) * pop);

    g.globalAlpha = alpha;
    g.font = `900 ${size}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(3, size * 0.18);
    g.strokeStyle = '#111111';
    g.strokeText(e.text, sx, sy);
    g.fillStyle = e.color || '#ffe14a';
    g.fillText(e.text, sx, sy);
    g.globalAlpha = 1;
  },
};
