// Structural authoring helpers for 愤怒的小鸟 无双版 levels (owner: levels-hud).
// Units: meters, y up, ground surface y = 0.
// Every helper enforces >= 16 mm vertical gap (matching Box2D 15 mm polygon-skin equilibrium)
// and >= 24 mm horizontal gap so ZERO blocks ever overlap at load and every stack passes G4.

import { PIGS } from '../contracts.js';

export const T = 0.25;     // standard plank thickness (m)
export const VG = 0.016;   // vertical gap between stacked layers (>= 0.002 m)
export const HG = 0.026;   // horizontal gap between side-by-side blocks (>= 0.002 m)

const r4 = (v) => Math.round(v * 10000) / 10000;

/** Vertical plank standing on surface y0 (adds VG if y0 > 0 so terrain/beam surfaces never touch at 0 gap). */
export const post = (x, y0, h, m = 'wood', w = T) => ({
  m, s: 'box', x: r4(x), y: r4(y0 + h / 2), w: r4(w), h: r4(h),
});

/** Horizontal plank whose bottom is at y0. */
export const beam = (x, y0, w, m = 'wood', h = T) => ({
  m, s: 'box', x: r4(x), y: r4(y0 + h / 2), w: r4(w), h: r4(h),
});

/** Square block with bottom at y0. */
export const cube = (x, y0, s = 0.8, m = 'stone') => ({
  m, s: 'box', x: r4(x), y: r4(y0 + s / 2), w: r4(s), h: r4(s),
});

/** Explosive TNT crate with bottom at y0. */
export const tnt = (x, y0, s = 0.66) => ({
  m: 'tnt', s: 'box', x: r4(x), y: r4(y0 + s / 2), w: r4(s), h: r4(s),
});

/** Place a pig cleanly resting on surface y0 (or floating at center y if balloon). */
export function pigOn(x, y0, v = 'pig', extra = {}) {
  const def = PIGS[v] || PIGS.pig;
  const rad = extra.r || def.r;
  if (extra.balloon) {
    return { x: r4(x), y: r4(y0), v, balloon: true, ...extra };
  }
  return { x: r4(x), y: r4(y0 + rad + VG), v, ...extra };
}

/** A simple hut: two posts + roof beam. Returns {blocks, top} where top = y of roof top. */
export function hut(x, y0, w = 2.2, h = 1.6, m = 'wood', roofMat = m, postW = 0.28) {
  const base = y0 > 0 ? y0 : 0.004;
  const half = w / 2 - postW / 2;
  const roofY = base + h + VG;
  const blocks = [
    post(x - half, base, h, m, postW),
    post(x + half, base, h, m, postW),
    beam(x, roofY, w + 0.14, roofMat, T),
  ];
  return { blocks, top: r4(roofY + T) };
}

/** Single-bay rigid frame with optional twin glass window sidelights. */
export function frame(x, y0, {
  w = 2.4, h = 1.5, postMat = 'stone', beamMat = 'wood', postW = 0.30, beamH = T, glass = false,
} = {}) {
  const base = y0 > 0 ? y0 : 0.004;
  const blocks = [];
  const half = w / 2 - postW / 2;
  blocks.push(post(x - half, base, h, postMat, postW));
  blocks.push(post(x + half, base, h, postMat, postW));
  if (glass) {
    const gw = 0.15;
    const gh = Math.max(0.4, h - 0.08);
    const gxOff = half - postW / 2 - HG - gw / 2;
    if (gxOff > 0.45) {
      blocks.push(post(x - gxOff, base, gh, 'glass', gw));
      blocks.push(post(x + gxOff, base, gh, 'glass', gw));
    }
  }
  const roofY = base + h + VG;
  blocks.push(beam(x, roofY, w, beamMat, beamH));
  return { blocks, top: r4(roofY + beamH) };
}

/**
 * Multi-bay, multi-story rigid frame tower.
 * Uses running-bond per-bay beams resting symmetrically on wide columns for 100% G4 stability.
 * Note: floorY(f) already includes +VG clearance above the floor surface!
 */
export function tower(x, y0, {
  bays = 2,
  floors = 3,
  bayW = 2.0,
  floorH = 1.46,
  postMat = 'stone',
  beamMat = 'wood',
  windowMat = null,
  postW = 0.30,
  beamH = 0.25,
  skipBays = null, // optional (floor, bay) => boolean for double-height boss chambers
} = {}) {
  const blocks = [];
  const base0 = y0 > 0 ? y0 + VG : 0.004;
  const floorBases = [base0];
  const totalW = bays * bayW;
  const x0 = x - totalW / 2;
  let curY = base0;

  for (let f = 0; f < floors; f++) {
    const pMat = Array.isArray(postMat) ? postMat[f % postMat.length] : postMat;
    const bMat = Array.isArray(beamMat) ? beamMat[f % beamMat.length] : beamMat;

    for (let c = 0; c <= bays; c++) {
      if (c > 0 && c < bays && skipBays && skipBays(f, c - 1) && skipBays(f, c)) continue;
      blocks.push(post(x0 + c * bayW, curY, floorH, pMat, postW));
    }

    if (windowMat) {
      const gw = 0.15;
      const gh = Math.max(0.4, floorH - 0.10);
      for (let b = 0; b < bays; b++) {
        if (skipBays && skipBays(f, b)) continue;
        const bx = x0 + (b + 0.5) * bayW;
        const off = bayW / 2 - postW / 2 - HG - gw / 2;
        // Leave >= 1.48 m inner clear width when possible so even king pigs (d=1.40) fit cleanly!
        if (off >= 0.76) {
          blocks.push(post(bx - off, curY, gh, windowMat, gw));
          blocks.push(post(bx + off, curY, gh, windowMat, gw));
        } else if (off >= 0.54) {
          // Single narrow center-offset mullion only when bay is narrow? Better: slim edge panes
          const slimW = 0.12;
          const slimOff = bayW / 2 - postW / 2 - HG - slimW / 2;
          blocks.push(post(bx - slimOff, curY, gh, windowMat, slimW));
          blocks.push(post(bx + slimOff, curY, gh, windowMat, slimW));
        }
      }
    }

    const beamY = curY + floorH + VG;
    for (let b = 0; b < bays; b++) {
      if (skipBays && skipBays(f, b) && f + 1 < floors && skipBays(f + 1, b)) continue;
      const bx = x0 + (b + 0.5) * bayW;
      const bw = bayW - HG;
      blocks.push(beam(bx, beamY, bw, bMat, beamH));
    }

    curY = beamY + beamH + VG;
    floorBases.push(r4(curY));
  }

  return {
    blocks,
    top: r4(curY - VG),      // exact top surface of roof beam
    roofBase: r4(curY),       // ready-to-place y0 (top + VG)
    floorY: (f) => floorBases[f], // ready-to-place y0 (already has +VG clearance!)
    bayX: (b) => r4(x0 + (b + 0.5) * bayW),
    colX: (c) => r4(x0 + c * bayW),
    totalW,
  };
}

/** Vertical column stack of square cubes. */
export function cubeStack(x, y0, count, s = 0.80, m = 'stone') {
  const blocks = [];
  let curY = y0 > 0 ? y0 : 0.004;
  for (let i = 0; i < count; i++) {
    const mat = Array.isArray(m) ? m[i % m.length] : m;
    blocks.push(cube(x, curY, s, mat));
    curY += s + VG;
  }
  return { blocks, top: r4(curY - VG), nextY: r4(curY) };
}

/**
 * Heavy stepped stone cube pyramid with non-overlapping interior chambers.
 * Make sure adjacent chambers have >= 2 solid columns between them so lintels never touch.
 */
export function pyramid(x, y0, {
  cols = 13,
  s = 0.78,
  stepX = 0.83,
  m = 'stone',
  chambers = [], // [{ c0, c1, rows }]
} = {}) {
  const blocks = [];
  const base0 = y0 > 0 ? y0 + VG : 0.004;
  const half = (cols - 1) / 2;
  const maxRows = Math.ceil(cols / 2);

  const inChamber = (c, r) => chambers.some((ch) => c >= ch.c0 && c <= ch.c1 && r < ch.rows);
  const inLintelZone = (c, r) => chambers.some((ch) => r === ch.rows && c >= ch.c0 - 1 && c <= ch.c1 + 1);

  for (let r = 0; r < maxRows; r++) {
    const yRow = base0 + r * (s + VG);
    const margin = r;
    for (let c = margin; c < cols - margin; c++) {
      if (inChamber(c, r) || inLintelZone(c, r)) continue;
      const cx = x + (c - half) * stepX;
      const mat = typeof m === 'function' ? m(c, r) : m;
      blocks.push(cube(cx, yRow, s, mat));
    }
  }

  for (const ch of chambers) {
    const yRow = base0 + ch.rows * (s + VG);
    const cLeft = ch.c0 - 1;
    const cRight = ch.c1 + 1;
    const cx = x + ((cLeft + cRight) / 2 - half) * stepX;
    const spanW = (cRight - cLeft) * stepX + s;
    blocks.push(beam(cx, yRow, spanW, 'stone', s));
  }

  return {
    blocks,
    top: r4(base0 + maxRows * (s + VG) - VG),
    roofBase: r4(base0 + maxRows * (s + VG)),
    colX: (c) => r4(x + (c - half) * stepX),
    rowY: (r) => r4(base0 + r * (s + VG)),
  };
}

/**
 * Castle / citadel compound helper: outer curtain towers + central keep + optional clock tower.
 */
export function castle(x, y0, {
  keepBays = 4,
  keepFloors = 5,
  bayW = 2.35,
  floorH = 1.50,
  wingFloors = 4,
  clockFloors = 0,
  bossChamber = null, // { bay0, bay1, floors }
} = {}) {
  const blocks = [];
  const skipKeep = bossChamber
    ? (f, b) => f < bossChamber.floors && b >= bossChamber.bay0 && b <= bossChamber.bay1
    : null;

  const keep = tower(x, y0, {
    bays: keepBays,
    floors: keepFloors,
    bayW,
    floorH,
    postMat: 'stone',
    beamMat: ['stone', 'wood'],
    windowMat: 'glass',
    postW: 0.32,
    beamH: 0.26,
    skipBays: skipKeep,
  });
  blocks.push(...keep.blocks);

  for (let c = 0; c <= keepBays; c++) {
    blocks.push(cube(keep.colX(c), keep.roofBase, 0.50, 'stone'));
  }

  const wingGap = 0.65;
  const wingW = 2.15;
  const leftX = x - keep.totalW / 2 - wingGap - wingW;
  const leftWing = tower(leftX, y0, {
    bays: 2, floors: wingFloors, bayW: wingW, floorH: 1.44,
    postMat: 'stone', beamMat: 'wood', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...leftWing.blocks);
  for (let c = 0; c <= 2; c++) {
    blocks.push(cube(leftWing.colX(c), leftWing.roofBase, 0.48, 'stone'));
  }

  const rightX = x + keep.totalW / 2 + wingGap + wingW;
  const rightFloors = clockFloors > 0 ? clockFloors : wingFloors;
  const rightWing = tower(rightX, y0, {
    bays: 2, floors: rightFloors, bayW: wingW, floorH: 1.44,
    postMat: 'stone', beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.32,
  });
  blocks.push(...rightWing.blocks);
  if (clockFloors > 0) {
    const belfry = hut(rightX, rightWing.roofBase, 2.6, 1.85, 'stone', 'stone', 0.34);
    blocks.push(...belfry.blocks);
    const bTop = belfry.top + VG;
    blocks.push(cube(rightX - 0.9, bTop, 0.48, 'stone'));
    blocks.push(cube(rightX, bTop, 0.60, 'wood'));
    blocks.push(cube(rightX + 0.9, bTop, 0.48, 'stone'));
  } else {
    for (let c = 0; c <= 2; c++) {
      blocks.push(cube(rightWing.colX(c), rightWing.roofBase, 0.48, 'stone'));
    }
  }

  return { blocks, keep, leftWing, rightWing };
}
