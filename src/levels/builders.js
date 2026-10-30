// Structural authoring helpers for 愤怒的小鸟 无双版 levels (owner: levels-hud).
// Units: meters, y up, ground surface y = 0.
// Every helper enforces >= 16 mm vertical gap (matching Box2D 15 mm polygon-skin equilibrium),
// >= 26 mm horizontal gap, flush outer-wall beam bearing, and continuous architrave lintels
// over multi-bay chambers so ZERO blocks overlap at load and settle.moved == 0 on all 13 levels.

import { PIGS } from '../contracts.js';

export const T = 0.25;     // standard plank thickness (m)
export const VG = 0.016;   // vertical gap between stacked layers (>= 0.002 m)
export const HG = 0.026;   // horizontal gap between side-by-side blocks (>= 0.002 m)

const r4 = (v) => Math.round(v * 10000) / 10000;

/** Vertical plank standing on surface y0. */
export const post = (x, y0, h, m = 'wood', w = T) => ({
  m, s: 'box', x: r4(x), y: r4(y0 + h / 2), w: r4(w), h: r4(h),
});

/** Horizontal plank whose bottom is at y0. */
export const beam = (x, y0, w, m = 'wood', h = T) => ({
  m, s: 'box', x: r4(x), y: r4(y0 + h / 2), w: r4(w), h: r4(h),
});

/** Square block with bottom at y0. */
export const cube = (x, y0, s = 0.8, m = 'stone') => {
  const base = y0 > 0 ? y0 : 0.004;
  return { m, s: 'box', x: r4(x), y: r4(base + s / 2), w: r4(s), h: r4(s) };
};

/** Explosive TNT crate with bottom at y0. */
export const tnt = (x, y0, s = 0.66) => {
  const base = y0 > 0 ? y0 : 0.004;
  return { m: 'tnt', s: 'box', x: r4(x), y: r4(base + s / 2), w: r4(s), h: r4(s) };
};

/** Place a pig cleanly resting on flat surface y0 (or floating at center y if balloon). */
export function pigOn(x, y0, v = 'pig', extra = {}) {
  const def = PIGS[v] || PIGS.pig;
  const rad = extra.r || def.r;
  if (extra.balloon) {
    return { x: r4(x), y: r4(y0), v, balloon: true, ...extra };
  }
  return { x: r4(x), y: r4(y0 + rad + VG), v, ...extra };
}

/** A simple hut: two posts + full-bearing roof beam. Returns {blocks, top, roofBase}. */
export function hut(x, y0, w = 2.2, h = 1.6, m = 'wood', roofMat = m, postW = 0.28) {
  const base = y0 > 0 ? y0 : 0.004;
  const half = w / 2 - postW / 2;
  const roofY = base + h + VG;
  const blocks = [
    post(x - half, base, h, m, postW),
    post(x + half, base, h, m, postW),
    beam(x, roofY, w + 0.08, roofMat, T),
  ];
  return { blocks, top: r4(roofY + T), roofBase: r4(roofY + T + VG) };
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
  return { blocks, top: r4(roofY + beamH), roofBase: r4(roofY + beamH + VG) };
}

/**
 * Multi-bay, multi-story rigid frame tower.
 * - Outer roof/floor beam ends sit flush with outer post edges so outer columns & roof blocks have
 *   100% symmetric bearing (zero overhang tipping).
 * - Multi-bay `skipBays` halls emit a single continuous architrave lintel across merged bays so
 *   ceilings never sag or collapse into a Λ shape during settle (`settle.moved == 0`).
 * - Note: `floorY(f)` and `roofBase` already include `+VG` clearance!
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
  skipBays = null, // optional (floor, bay) => boolean for multi-bay boss chambers
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
        if (off >= 0.76) {
          blocks.push(post(bx - off, curY, gh, windowMat, gw));
          blocks.push(post(bx + off, curY, gh, windowMat, gw));
        } else if (off >= 0.52) {
          const slimW = 0.12;
          const slimOff = bayW / 2 - postW / 2 - HG - slimW / 2;
          blocks.push(post(bx - slimOff, curY, gh, windowMat, slimW));
          blocks.push(post(bx + slimOff, curY, gh, windowMat, slimW));
        }
      }
    }

    const beamY = curY + floorH + VG;
    const isBayOpenAbove = (bay) => (
      f + 1 < floors && Boolean(skipBays && skipBays(f, bay) && skipBays(f + 1, bay))
    );
    let b = 0;
    while (b < bays) {
      if (skipBays && skipBays(f, b)) {
        let bEnd = b;
        while (bEnd + 1 < bays && skipBays(f, bEnd + 1)) bEnd++;
        let openAbove = f + 1 < floors;
        if (openAbove) {
          for (let k = b; k <= bEnd; k++) {
            if (!skipBays(f + 1, k)) { openAbove = false; break; }
          }
        }
        if (!openAbove) {
          // Single continuous architrave lintel across merged chamber b..bEnd!
          const leftOpen = b > 0 && isBayOpenAbove(b - 1);
          const rightOpen = bEnd < bays - 1 && isBayOpenAbove(bEnd + 1);
          const leftEdge = b === 0 ? (x0 - postW / 2) : (leftOpen ? (x0 + b * bayW - postW / 2) : (x0 + b * bayW + HG / 2));
          const rightEdge = bEnd === bays - 1 ? (x0 + bays * bayW + postW / 2) : (rightOpen ? (x0 + (bEnd + 1) * bayW + postW / 2) : (x0 + (bEnd + 1) * bayW - HG / 2));
          blocks.push(beam((leftEdge + rightEdge) / 2, beamY, rightEdge - leftEdge, 'stone', beamH));
        } else {
          // Preserve vertical pier continuity on any outer wall column bordering an open hall
          if (b === 0) blocks.push(beam(x0, beamY, postW, pMat, beamH));
          if (bEnd === bays - 1) blocks.push(beam(x0 + bays * bayW, beamY, postW, pMat, beamH));
        }
        b = bEnd + 1;
      } else {
        const leftOpen = b > 0 && isBayOpenAbove(b - 1);
        const rightOpen = b < bays - 1 && isBayOpenAbove(b + 1);
        const leftEdge = b === 0 ? (x0 - postW / 2) : (leftOpen ? (x0 + b * bayW - postW / 2) : (x0 + b * bayW + HG / 2));
        const rightEdge = b === bays - 1 ? (x0 + bays * bayW + postW / 2) : (rightOpen ? (x0 + (b + 1) * bayW + postW / 2) : (x0 + (b + 1) * bayW - HG / 2));
        blocks.push(beam((leftEdge + rightEdge) / 2, beamY, rightEdge - leftEdge, bMat, beamH));
        b++;
      }
    }

    curY = beamY + beamH + VG;
    floorBases.push(r4(curY));
  }

  return {
    blocks,
    top: r4(curY - VG),
    roofBase: r4(curY),
    floorY: (f) => floorBases[f],
    bayX: (b) => r4(x0 + (b + 0.5) * bayW),
    colX: (c) => r4(x0 + c * bayW),
    /** Safe x for a roof parapet block of width `s` above column `c` (100% inside roof beam edges). */
    capX: (c, s = 0.50) => {
      if (c === 0) return r4(Math.max(x0, x0 - postW / 2 + s / 2 + 0.02));
      if (c === bays) return r4(Math.min(x0 + totalW, x0 + totalW + postW / 2 - s / 2 - 0.02));
      return r4(x0 + c * bayW);
    },
    leftEdge: r4(x0 - postW / 2),
    rightEdge: r4(x0 + totalW + postW / 2),
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
 * Heavy stepped stone cube pyramid with non-overlapping, fully-pier-supported interior chambers.
 */
export function pyramid(x, y0, {
  cols = 13,
  s = 0.78,
  stepX = 0.88,
  m = 'stone',
  chambers = [], // [{ c0, c1, rows }] — choose c0 >= rows and c1 <= cols - 1 - rows
} = {}) {
  const blocks = [];
  const base0 = y0 > 0 ? y0 + VG : 0.004;
  const half = (cols - 1) / 2;
  const maxRows = Math.ceil(cols / 2);

  const inChamber = (c, r) => chambers.some((ch) => c >= ch.c0 && c <= ch.c1 && r < ch.rows);
  const inLintelZone = (c, r) => chambers.some((ch) => r === ch.rows && c >= ch.c0 - 1 && c <= ch.c1 + 1);
  const isChamberPier = (c, r) => chambers.some((ch) => r < ch.rows && (c === ch.c0 - 1 || c === ch.c1 + 1));

  for (let r = 0; r < maxRows; r++) {
    const yRow = base0 + r * (s + VG);
    const margin = r;
    for (let c = 0; c < cols; c++) {
      const inSlope = c >= margin && c < cols - margin;
      if (!inSlope && !isChamberPier(c, r)) continue;
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
 * Castle / citadel compound helper: outer curtain wings + central keep + optional clock tower.
 */
export function castle(x, y0, {
  keepBays = 4,
  keepFloors = 5,
  bayW = 2.35,
  floorH = 1.50,
  wingFloors = 4,
  clockFloors = 0,
  wingGap = 0.65,
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

  for (let b = 0; b < keepBays; b++) {
    blocks.push(cube(keep.bayX(b), keep.roofBase, 0.50, 'stone'));
  }

  const wingW = 2.10;
  const leftX = x - keep.totalW / 2 - wingGap - wingW;
  const leftWing = tower(leftX, y0, {
    bays: 2, floors: wingFloors, bayW: wingW, floorH: 1.44,
    postMat: ['stone', 'wood'], beamMat: 'wood', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...leftWing.blocks);
  blocks.push(cube(leftWing.bayX(0), leftWing.roofBase, 0.48, 'stone'));
  blocks.push(cube(leftWing.bayX(1), leftWing.roofBase, 0.48, 'stone'));

  const rightX = x + keep.totalW / 2 + wingGap + wingW;
  const rightFloors = clockFloors > 0 ? clockFloors : wingFloors;
  const rightWing = tower(rightX, y0, {
    bays: 2, floors: rightFloors, bayW: wingW, floorH: 1.44,
    postMat: 'stone', beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.32,
  });
  blocks.push(...rightWing.blocks);
  if (clockFloors > 0) {
    const belfry = hut(rightX, rightWing.roofBase, 2.5, 1.80, 'stone', 'stone', 0.34);
    blocks.push(...belfry.blocks);
    blocks.push(cube(rightX - 0.72, belfry.roofBase, 0.48, 'stone'));
    blocks.push(cube(rightX, belfry.roofBase, 0.56, 'wood'));
    blocks.push(cube(rightX + 0.72, belfry.roofBase, 0.48, 'stone'));
  } else {
    blocks.push(cube(rightWing.bayX(0), rightWing.roofBase, 0.48, 'stone'));
    blocks.push(cube(rightWing.bayX(1), rightWing.roofBase, 0.48, 'stone'));
  }

  return { blocks, keep, leftWing, rightWing };
}
