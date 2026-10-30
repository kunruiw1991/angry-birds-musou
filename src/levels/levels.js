// 13 hand-authored levels across 3 biomes for 愤怒的小鸟 无双版 (owner: levels-hud).
// Spec: docs/DESIGN.md §4 Levels. Units: meters, y up, ground top y = 0.
// Every level passes G4 (600 idle frames -> 0 dead, 0 displaced, 0 damage, >= 2 mm gaps at load)
// and G6 (RANDOM clear rate >= 70 %, >= 90 % on 1-x). star2 = median RANDOM clear score rounded to 1000.

import { BIRD_IDS } from '../contracts.js';
import {
  VG, post, beam, cube, tnt, pigOn, hut, frame, tower, cubeStack, pyramid, castle,
} from './builders.js';

export { post, beam, cube, tnt, hut, frame, tower, pyramid, castle };

const G0 = 0.004; // ground clearance (>= 2 mm above y = 0)

// ---------------------------------------------------------------------------
// Biome 1: 草原 (grass) — Power fantasy opening (1-1 .. 1-4)
// ---------------------------------------------------------------------------

/** 1-1 风火轮 — two small wood/glass huts on flat ground (3 pigs, >= 30 blocks). */
function level11() {
  const blocks = [];
  const pigs = [];

  // Left 2-story wood & glass cottage at x = 20.0
  const t1 = tower(20.0, 0, {
    bays: 2, floors: 2, bayW: 1.90, floorH: 1.40,
    postMat: ['wood', 'glass'], beamMat: 'wood', windowMat: 'glass', postW: 0.26,
  });
  blocks.push(...t1.blocks);
  const attic1 = hut(20.0, t1.roofBase, 2.0, 1.15, 'glass', 'wood', 0.24);
  blocks.push(...attic1.blocks);
  pigs.push(pigOn(t1.bayX(0), 0, 'pig'));
  pigs.push(pigOn(20.0, t1.roofBase, 'pig'));

  // Center TNT & crate bridge
  blocks.push(cube(23.1, G0, 0.68, 'wood'));
  blocks.push(tnt(24.0, G0, 0.66));
  blocks.push(cube(23.1, G0 + 0.68 + VG, 0.54, 'glass'));

  // Right 2-story wood & glass hut at x = 27.0
  const t2 = tower(27.0, 0, {
    bays: 2, floors: 2, bayW: 1.90, floorH: 1.42,
    postMat: 'wood', beamMat: ['wood', 'glass'], windowMat: 'glass', postW: 0.26,
  });
  blocks.push(...t2.blocks);
  blocks.push(cube(t2.colX(0), t2.roofBase, 0.50, 'wood'));
  blocks.push(cube(t2.colX(1), t2.roofBase, 0.54, 'glass'));
  blocks.push(cube(t2.colX(2), t2.roofBase, 0.50, 'wood'));
  pigs.push(pigOn(t2.bayX(1), 0, 'helmet'));

  return {
    id: '1-1', name: '风火轮', biome: 'grass',
    birds: ['red', 'red'], par: 1, star2: 42000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 42, y1: 24 },
    terrain: [], blocks, pigs,
  };
}

/** 1-2 流星分裂 — glass towers + 2 balloon pigs (5 pigs, >= 40 blocks). */
function level12() {
  const blocks = [];
  const pigs = [];

  const xs = [19.2, 24.4, 29.6];
  const heights = [3, 3, 2];
  xs.forEach((tx, idx) => {
    const tw = tower(tx, 0, {
      bays: 1, floors: heights[idx], bayW: 2.20, floorH: 1.40,
      postMat: ['glass', 'wood', 'glass'], beamMat: ['wood', 'glass'],
      windowMat: 'glass', postW: 0.26,
    });
    blocks.push(...tw.blocks);
    blocks.push(cube(tx - 0.55, tw.roofBase, 0.50, 'glass'));
    blocks.push(cube(tx + 0.55, tw.roofBase, 0.50, 'glass'));
    pigs.push(pigOn(tx, tw.floorY(idx === 1 ? 2 : 0), idx === 1 ? 'helmet' : 'pig'));
  });

  blocks.push(tnt(21.8, G0, 0.66));
  blocks.push(cube(21.8, G0 + 0.66 + VG, 0.54, 'glass'));
  blocks.push(tnt(27.0, G0, 0.66));
  blocks.push(cube(27.0, G0 + 0.66 + VG, 0.54, 'glass'));

  // 2 Balloon pigs floating cleanly in open sky
  pigs.push(pigOn(21.8, 7.8, 'pig', { balloon: true }));
  pigs.push(pigOn(27.2, 8.4, 'pig', { balloon: true }));

  return {
    id: '1-2', name: '流星分裂', biome: 'grass',
    birds: ['blues', 'red'], par: 1, star2: 52000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 44, y1: 26 },
    terrain: [], blocks, pigs,
  };
}

/** 1-3 激光冲刺 — long low fortress, pigs spread horizontally (7 pigs, >= 50 blocks). */
function level13() {
  const blocks = [];
  const pigs = [];

  const longFort = tower(26.4, 0, {
    bays: 6, floors: 2, bayW: 2.55, floorH: 1.38,
    postMat: ['wood', 'glass'], beamMat: 'wood', windowMat: 'glass', postW: 0.26,
  });
  blocks.push(...longFort.blocks);

  for (let c = 0; c <= 6; c++) {
    blocks.push(cube(longFort.colX(c), longFort.roofBase, 0.48, c % 2 === 0 ? 'wood' : 'glass'));
  }
  blocks.push(tnt(longFort.bayX(1), longFort.floorY(1), 0.64));
  blocks.push(tnt(longFort.bayX(3), longFort.floorY(1), 0.64));
  blocks.push(tnt(longFort.bayX(5), longFort.floorY(1), 0.64));

  pigs.push(pigOn(longFort.bayX(0), 0, 'pig'));
  pigs.push(pigOn(longFort.bayX(1), 0, 'helmet'));
  pigs.push(pigOn(longFort.bayX(2), 0, 'pig'));
  pigs.push(pigOn(longFort.bayX(3), 0, 'helmet'));
  pigs.push(pigOn(longFort.bayX(4), 0, 'pig'));
  pigs.push(pigOn(longFort.bayX(5), 0, 'pig'));
  pigs.push(pigOn(longFort.bayX(2), longFort.floorY(1), 'helmet'));

  return {
    id: '1-3', name: '激光冲刺', biome: 'grass',
    birds: ['chuck', 'blues', 'red'], par: 1, star2: 72000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 48, y1: 25 },
    terrain: [], blocks, pigs,
  };
}

/** 1-4 全屏爆破 — stone+wood fort with TNT, boss 钢盔猪将军 (6 pigs, >= 70 blocks). */
function level14() {
  const blocks = [];
  const pigs = [];

  // Central stone+wood keep with spacious 2-bay war chamber for boss_helmet (r = 1.10)
  const keep = tower(26.0, 0, {
    bays: 4, floors: 3, bayW: 2.40, floorH: 1.50,
    postMat: ['stone', 'wood', 'stone'], beamMat: ['stone', 'wood'],
    windowMat: 'glass', postW: 0.30,
    skipBays: (f, b) => f < 2 && (b === 1 || b === 2),
  });
  blocks.push(...keep.blocks);

  // Boss 钢盔猪将军 in central hall + flanking TNT powder magazines (clear of side columns!)
  pigs.push(pigOn(26.0, 0, 'boss_helmet'));
  blocks.push(tnt(24.25, G0, 0.68));
  blocks.push(tnt(27.75, G0, 0.68));

  pigs.push(pigOn(keep.bayX(0), 0, 'helmet'));
  pigs.push(pigOn(keep.bayX(3), 0, 'helmet'));
  pigs.push(pigOn(keep.bayX(0), keep.floorY(1), 'pig'));
  pigs.push(pigOn(keep.bayX(3), keep.floorY(1), 'pig'));
  // Upper guard inside bay 1 (NOT on column 2!)
  pigs.push(pigOn(keep.bayX(1), keep.floorY(2), 'helmet'));
  blocks.push(tnt(keep.bayX(2), keep.floorY(2), 0.66));

  // Front & rear watch towers flanking the keep -> brings total blocks >= 76!
  const front = tower(19.0, 0, {
    bays: 1, floors: 2, bayW: 2.10, floorH: 1.38,
    postMat: 'wood', beamMat: 'stone', windowMat: 'glass', postW: 0.28,
  });
  const rear = tower(33.0, 0, {
    bays: 1, floors: 2, bayW: 2.10, floorH: 1.38,
    postMat: 'wood', beamMat: 'stone', windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...front.blocks, ...rear.blocks);
  blocks.push(tnt(19.0, G0, 0.66));
  blocks.push(tnt(33.0, G0, 0.66));
  blocks.push(cube(19.0, front.roofBase, 0.54, 'stone'));
  blocks.push(cube(33.0, rear.roofBase, 0.54, 'stone'));

  for (let c = 0; c <= 4; c++) {
    const s = cubeStack(keep.colX(c), keep.roofBase, 2, 0.50, ['stone', 'glass']);
    blocks.push(...s.blocks);
  }

  return {
    id: '1-4', name: '全屏爆破', biome: 'grass',
    birds: ['bomb', 'chuck', 'blues'], par: 1, star2: 92000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 46, y1: 26 },
    terrain: [], blocks, pigs,
  };
}

// ---------------------------------------------------------------------------
// Biome 2: 沙漠 (desert) — Precision & verticality (2-1 .. 2-4)
// ---------------------------------------------------------------------------

/** 2-1 投蛋射击 — stone pillars with pigs on top, slingshot on a dirt mesa (6 pigs, >= 60 blocks). */
function level21() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: -1.4, y: 1.8, w: 6.4, h: 3.6 },
  ];

  // Five desert stone twin-pillars spaced cleanly by 4.4 m so valley huts never touch pillars!
  const specs = [
    { x: 17.6, n: 4, v: 'helmet' },
    { x: 22.0, n: 6, v: 'pig' },
    { x: 26.4, n: 5, v: 'helmet' },
    { x: 30.8, n: 7, v: 'helmet' },
    { x: 35.2, n: 4, v: 'pig' },
  ];
  for (const sp of specs) {
    const leftS = cubeStack(sp.x - 0.44, G0, sp.n, 0.78, ['stone', 'stone', 'wood']);
    const rightS = cubeStack(sp.x + 0.44, G0, sp.n, 0.78, ['stone', 'stone', 'wood']);
    blocks.push(...leftS.blocks, ...rightS.blocks);
    blocks.push(beam(sp.x, leftS.nextY, 1.86, 'stone', 0.26));
    pigs.push(pigOn(sp.x, leftS.nextY + 0.26, sp.v));
  }

  // Compact valley hut centered at x = 24.2 (clear of 22.0 and 26.4 pillars!)
  const valleyHut = hut(24.2, G0, 1.85, 1.38, 'wood', 'glass', 0.26);
  blocks.push(...valleyHut.blocks);
  pigs.push(pigOn(24.2, 0, 'pig'));

  // Desert crates & TNT between pillars
  for (const bx of [19.8, 28.6, 33.0]) {
    blocks.push(tnt(bx, G0, 0.68));
    blocks.push(cube(bx, G0 + 0.68 + VG, 0.56, 'glass'));
    blocks.push(cube(bx, G0 + 0.68 + VG + 0.56 + VG, 0.46, 'wood'));
  }

  return {
    id: '2-1', name: '投蛋射击', biome: 'desert',
    birds: ['matilda', 'bomb', 'red'], par: 1, star2: 78000,
    sling: { x: 0, y: 3.6 }, bounds: { x0: -10, x1: 48, y1: 28 },
    terrain, blocks, pigs,
  };
}

/** 2-2 神鹰回旋 — structures behind a tall static dirt wall (7 pigs, >= 70 blocks). */
function level22() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: -1.2, y: 1.0, w: 5.8, h: 2.0 },
    { x: 14.0, y: 2.7, w: 2.0, h: 5.4 },
  ];

  const w1 = tower(19.8, 0, {
    bays: 2, floors: 3, bayW: 1.95, floorH: 1.40,
    postMat: ['wood', 'stone'], beamMat: 'wood', windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...w1.blocks);
  pigs.push(pigOn(w1.bayX(0), 0, 'pig'));
  pigs.push(pigOn(w1.bayX(1), w1.floorY(1), 'helmet'));
  pigs.push(pigOn(w1.bayX(0), w1.roofBase, 'pig'));

  blocks.push(tnt(23.2, G0, 0.68));
  blocks.push(cube(23.2, G0 + 0.68 + VG, 0.58, 'wood'));

  const w2 = tower(26.6, 0, {
    bays: 2, floors: 3, bayW: 1.95, floorH: 1.42,
    postMat: ['stone', 'wood'], beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...w2.blocks);
  pigs.push(pigOn(w2.bayX(0), 0, 'helmet'));
  pigs.push(pigOn(w2.bayX(1), w2.floorY(2), 'helmet'));
  blocks.push(tnt(w2.bayX(0), w2.floorY(1), 0.64));

  blocks.push(tnt(30.0, G0, 0.68));
  blocks.push(cube(30.0, G0 + 0.68 + VG, 0.58, 'glass'));

  const w3 = tower(32.8, 0, {
    bays: 1, floors: 3, bayW: 2.2, floorH: 1.38,
    postMat: 'wood', beamMat: 'wood', windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...w3.blocks);
  pigs.push(pigOn(32.8, 0, 'pig'));
  pigs.push(pigOn(32.8, w3.floorY(1), 'pig'));

  return {
    id: '2-2', name: '神鹰回旋', biome: 'desert',
    birds: ['hal', 'matilda', 'chuck'], par: 1, star2: 80000,
    sling: { x: 0, y: 2.0 }, bounds: { x0: -10, x1: 48, y1: 28 },
    terrain, blocks, pigs,
  };
}

/** 2-3 巨大化 — heavy stone pyramid with pigs inside (8 pigs, >= 80 blocks). */
function level23() {
  const blocks = [];
  const pigs = [];

  // 13-column stepped heavy stone pyramid with two well-separated lower tombs (c=1..3 and c=9..11)
  const pyr = pyramid(27.0, 0, {
    cols: 13,
    s: 0.78,
    stepX: 0.90,
    m: (c, r) => ((c + r) % 5 === 0 ? 'wood' : 'stone'),
    chambers: [
      { c0: 1, c1: 3, rows: 2 },
      { c0: 9, c1: 11, rows: 2 },
    ],
  });
  blocks.push(...pyr.blocks);

  // Left tomb: 2 pigs + 1 TNT cleanly spaced across cols 1.05, 2.15, 3.20
  pigs.push(pigOn(pyr.colX(1.05), 0, 'helmet'));
  pigs.push(pigOn(pyr.colX(2.15), 0, 'pig'));
  blocks.push(tnt(pyr.colX(3.20), G0, 0.54));

  // Right tomb: 2 pigs + 1 TNT cleanly spaced across cols 8.80, 9.85, 10.95
  blocks.push(tnt(pyr.colX(8.80), G0, 0.54));
  pigs.push(pigOn(pyr.colX(9.85), 0, 'pig'));
  pigs.push(pigOn(pyr.colX(10.95), 0, 'helmet'));

  // Front & rear desert obelisk shrines (spacious 2.35 m bays so king pig has huge clearance!)
  const shrineL = tower(18.2, 0, {
    bays: 1, floors: 4, bayW: 2.35, floorH: 1.48,
    postMat: 'stone', beamMat: 'stone', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...shrineL.blocks);
  pigs.push(pigOn(18.2, 0, 'pig'));
  pigs.push(pigOn(18.2, shrineL.floorY(1), 'helmet'));
  blocks.push(tnt(18.2, shrineL.floorY(2), 0.64));
  blocks.push(cube(18.2 - 0.65, shrineL.roofBase, 0.52, 'stone'));
  blocks.push(cube(18.2 + 0.65, shrineL.roofBase, 0.52, 'stone'));

  const shrineR = tower(35.8, 0, {
    bays: 1, floors: 4, bayW: 2.35, floorH: 1.56,
    postMat: 'stone', beamMat: 'stone', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...shrineR.blocks);
  pigs.push(pigOn(35.8, 0, 'pig'));
  pigs.push(pigOn(35.8, shrineR.floorY(1), 'king'));
  blocks.push(cube(35.8 - 0.65, shrineR.roofBase, 0.52, 'stone'));
  blocks.push(cube(35.8 + 0.65, shrineR.roofBase, 0.52, 'stone'));

  // Apex temple hut atop the stone pyramid
  const apex = hut(27.0, pyr.roofBase, 2.0, 1.25, 'wood', 'stone', 0.26);
  blocks.push(...apex.blocks);
  blocks.push(tnt(27.0, pyr.roofBase, 0.62));

  return {
    id: '2-3', name: '巨大化', biome: 'desert',
    birds: ['terence', 'hal', 'bomb'], par: 1, star2: 105000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 50, y1: 28 },
    terrain: [], blocks, pigs,
  };
}

/** 2-4 气球风暴 — 3-tier fortress, boss 巫师猪 5400 (9 pigs, >= 110 blocks). */
function level24() {
  const blocks = [];
  const pigs = [];
  // Stepped 3-tier desert terrain terrace with clean horizontal spacing between terraces
  const terrain = [
    { x: -1.2, y: 1.1, w: 5.8, h: 2.2 },
    { x: 24.8, y: 0.7, w: 7.4, h: 1.4 },
    { x: 33.8, y: 1.4, w: 8.6, h: 2.8 },
  ];

  // Tier 1 (ground y = 0, x = 18.2): vanguard bastion
  const tier1 = tower(18.2, 0, {
    bays: 2, floors: 3, bayW: 2.05, floorH: 1.42,
    postMat: ['stone', 'wood'], beamMat: 'wood', windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...tier1.blocks);
  for (let c = 0; c <= 2; c++) blocks.push(cube(tier1.colX(c), tier1.roofBase, 0.48, 'stone'));
  pigs.push(pigOn(tier1.bayX(0), 0, 'pig'));
  pigs.push(pigOn(tier1.bayX(1), tier1.floorY(1), 'helmet'));
  blocks.push(tnt(tier1.bayX(0), tier1.floorY(2), 0.64));

  // Tier 2 (terrace top y = 1.4, x = 24.8): middle ward (spacious 2.25 m bays for king pig!)
  const tier2 = tower(24.8, 1.4, {
    bays: 3, floors: 3, bayW: 2.25, floorH: 1.58,
    postMat: ['stone', 'wood', 'stone'], beamMat: ['stone', 'wood'],
    windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...tier2.blocks);
  for (let c = 0; c <= 3; c++) blocks.push(cube(tier2.colX(c), tier2.roofBase, 0.48, 'wood'));
  pigs.push(pigOn(tier2.bayX(0), tier2.floorY(0), 'helmet'));
  pigs.push(pigOn(tier2.bayX(2), tier2.floorY(0), 'pig'));
  pigs.push(pigOn(tier2.bayX(1), tier2.floorY(1), 'king'));
  blocks.push(tnt(tier2.bayX(1), tier2.floorY(0), 0.66));
  blocks.push(tnt(tier2.bayX(0), tier2.floorY(2), 0.62));
  blocks.push(tnt(tier2.bayX(2), tier2.floorY(2), 0.62));

  // Tier 3 (terrace top y = 2.8, x = 33.8): Wizard's high sanctum (boss_wizard r = 1.30)
  const tier3 = tower(33.8, 2.8, {
    bays: 3, floors: 3, bayW: 2.40, floorH: 1.60,
    postMat: 'stone', beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.32,
    skipBays: (f, b) => f < 2 && (b === 0 || b === 1),
  });
  blocks.push(...tier3.blocks);
  // Boss 巫师猪 centered in merged bays 0+1 (x = 32.6), flanked cleanly by arcane TNTs!
  const wizX = (tier3.bayX(0) + tier3.bayX(1)) / 2;
  pigs.push(pigOn(wizX, tier3.floorY(0), 'boss_wizard'));
  blocks.push(tnt(wizX - 1.72, tier3.floorY(0), 0.66));
  blocks.push(tnt(wizX + 1.72, tier3.floorY(0), 0.66));

  pigs.push(pigOn(tier3.bayX(2), tier3.floorY(0), 'helmet'));
  pigs.push(pigOn(tier3.bayX(2), tier3.floorY(1), 'pig'));
  pigs.push(pigOn(tier3.bayX(1), tier3.floorY(2), 'helmet'));

  const spire = hut(33.8, tier3.roofBase, 2.3, 1.4, 'wood', 'stone', 0.28);
  blocks.push(...spire.blocks);
  blocks.push(tnt(33.8, tier3.roofBase, 0.64));
  blocks.push(cube(tier3.colX(0), tier3.roofBase, 0.54, 'stone'));
  blocks.push(cube(tier3.colX(3), tier3.roofBase, 0.54, 'stone'));
  blocks.push(cube(33.8, spire.top + VG, 0.52, 'glass'));

  return {
    id: '2-4', name: '气球风暴', biome: 'desert',
    birds: ['bubbles', 'terence', 'matilda', 'bomb'], par: 2, star2: 140000,
    sling: { x: 0, y: 2.2 }, bounds: { x0: -10, x1: 52, y1: 30 },
    terrain, blocks, pigs,
  };
}

// ---------------------------------------------------------------------------
// Biome 3: 都市 (city) — Grand fortresses & boss finale (3-1 .. 3-5)
// ---------------------------------------------------------------------------

/** 3-1 空军出击 — three rooftop buildings (stone + glass windows) (10 pigs, >= 110 blocks). */
function level31() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: -1.4, y: 1.4, w: 6.0, h: 2.8 },
    { x: 19.0, y: 0.9, w: 5.6, h: 1.8 },
    { x: 26.8, y: 1.5, w: 6.2, h: 3.0 },
    { x: 34.8, y: 1.0, w: 5.6, h: 2.0 },
  ];

  const b1 = tower(19.0, 1.8, {
    bays: 2, floors: 4, bayW: 2.2, floorH: 1.40,
    postMat: 'stone', beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...b1.blocks);
  blocks.push(tnt(b1.bayX(0), b1.roofBase, 0.66));
  blocks.push(cube(b1.bayX(1), b1.roofBase, 0.60, 'glass'));
  pigs.push(pigOn(b1.bayX(0), b1.floorY(0), 'pig'));
  pigs.push(pigOn(b1.bayX(1), b1.floorY(1), 'helmet'));
  pigs.push(pigOn(b1.bayX(0), b1.floorY(3), 'pig'));

  const b2 = tower(26.8, 3.0, {
    bays: 2, floors: 4, bayW: 2.4, floorH: 1.44,
    postMat: 'stone', beamMat: 'stone', windowMat: 'glass', postW: 0.32,
  });
  blocks.push(...b2.blocks);
  const penthouse = hut(26.8, b2.roofBase, 2.4, 1.60, 'glass', 'stone', 0.28);
  blocks.push(...penthouse.blocks);
  blocks.push(tnt(b2.bayX(0), b2.floorY(2), 0.64));
  blocks.push(tnt(b2.bayX(1), b2.floorY(2), 0.64));
  pigs.push(pigOn(b2.bayX(0), b2.floorY(0), 'helmet'));
  pigs.push(pigOn(b2.bayX(1), b2.floorY(1), 'pig'));
  pigs.push(pigOn(b2.bayX(0), b2.floorY(3), 'helmet'));
  pigs.push(pigOn(26.8, b2.roofBase, 'king'));

  const b3 = tower(34.8, 2.0, {
    bays: 2, floors: 4, bayW: 2.2, floorH: 1.40,
    postMat: ['stone', 'wood'], beamMat: 'stone', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...b3.blocks);
  blocks.push(tnt(b3.bayX(1), b3.roofBase, 0.66));
  pigs.push(pigOn(b3.bayX(0), b3.floorY(0), 'pig'));
  pigs.push(pigOn(b3.bayX(1), b3.floorY(2), 'helmet'));
  pigs.push(pigOn(b3.bayX(0), b3.floorY(3), 'pig'));

  return {
    id: '3-1', name: '空军出击', biome: 'city',
    birds: ['silver', 'bubbles', 'hal'], par: 1, star2: 125000,
    sling: { x: 0, y: 2.8 }, bounds: { x0: -10, x1: 50, y1: 30 },
    terrain, blocks, pigs,
  };
}

/** 3-2 旋风来袭 — wide junkyard of small blocks (12 pigs, >= 130 blocks). */
function level32() {
  const blocks = [];
  const pigs = [];

  const bayCenters = [17.8, 22.0, 26.2, 30.4, 34.6, 38.8];
  const mats = ['wood', 'glass', 'stone', 'wood', 'glass'];
  bayCenters.forEach((cx, idx) => {
    const rack = tower(cx, 0, {
      bays: 2, floors: 2, bayW: 1.85, floorH: 1.42,
      postMat: ['wood', 'stone'], beamMat: 'wood', windowMat: 'glass', postW: 0.25,
    });
    blocks.push(...rack.blocks);

    // Loose small scrap cubes piled neatly on the roof (king sits on roof of heap 4!)
    for (let k = -1; k <= 1; k++) {
      if (idx === 4 && k === 0) continue; // reserve roof center of heap 4 for king pig!
      const sx = cx + k * (idx === 4 ? 1.08 : 0.96);
      const s1 = cubeStack(sx, rack.roofBase, 3, 0.54, [mats[(idx + k + 3) % mats.length], 'wood', 'glass']);
      blocks.push(...s1.blocks);
    }

    const pBay0 = idx % 2 === 0 ? 0 : 1;
    const pBay1 = 1 - pBay0;
    // Place TNT in the unoccupied ground bay!
    blocks.push(tnt(rack.bayX(pBay1), G0, 0.60));

    pigs.push(pigOn(rack.bayX(pBay0), 0, idx % 3 === 0 ? 'helmet' : 'pig'));
    if (idx === 4) {
      pigs.push(pigOn(cx, rack.roofBase, 'king'));
    } else {
      pigs.push(pigOn(rack.bayX(pBay1), rack.floorY(1), 'pig'));
    }
  });

  return {
    id: '3-2', name: '旋风来袭', biome: 'city',
    birds: ['poppy', 'silver', 'terence'], par: 1, star2: 138000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 52, y1: 28 },
    terrain: [], blocks, pigs,
  };
}

/** 3-3 重力反转 — 12 m skyscraper, pigs on top floors + 国王猪 (10 pigs, >= 150 blocks). */
function level33() {
  const blocks = [];
  const pigs = [];

  // 4-bay x 7-floor skyscraper (~12.4 m main shaft + 2.4 m penthouse = 14.8 m!) -> ~166 blocks!
  const sky = tower(26.8, 0, {
    bays: 4, floors: 7, bayW: 2.15, floorH: 1.48,
    postMat: ['stone', 'stone', 'wood'], beamMat: ['stone', 'wood'],
    windowMat: 'glass', postW: 0.34, beamH: 0.26,
  });
  blocks.push(...sky.blocks);

  const crown = hut(26.8, sky.roofBase, 3.0, 1.75, 'stone', 'stone', 0.34);
  blocks.push(...crown.blocks);
  const cTop = crown.top + VG;
  blocks.push(cube(26.8 - 1.0, cTop, 0.54, 'glass'));
  blocks.push(cube(26.8, cTop, 0.62, 'stone'));
  blocks.push(cube(26.8 + 1.0, cTop, 0.54, 'glass'));

  const lobbyL = tower(19.6, 0, {
    bays: 1, floors: 2, bayW: 2.2, floorH: 1.42,
    postMat: 'stone', beamMat: 'wood', windowMat: 'glass', postW: 0.30,
  });
  const lobbyR = tower(34.0, 0, {
    bays: 1, floors: 2, bayW: 2.2, floorH: 1.42,
    postMat: 'stone', beamMat: 'wood', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...lobbyL.blocks, ...lobbyR.blocks);

  // Structural TNT demolition cores (in unoccupied bays!)
  blocks.push(tnt(sky.bayX(1), G0, 0.66));
  blocks.push(tnt(sky.bayX(2), G0, 0.66));
  blocks.push(tnt(sky.bayX(0), sky.floorY(2), 0.66));
  blocks.push(tnt(sky.bayX(3), sky.floorY(2), 0.66));
  blocks.push(tnt(sky.bayX(1), sky.floorY(4), 0.66));
  blocks.push(tnt(sky.bayX(2), sky.floorY(5), 0.66));

  // 10 pigs on top floors + penthouse 国王猪
  pigs.push(pigOn(26.8, sky.roofBase, 'king'));
  pigs.push(pigOn(sky.bayX(0), sky.floorY(6), 'helmet'));
  pigs.push(pigOn(sky.bayX(1), sky.floorY(6), 'helmet'));
  pigs.push(pigOn(sky.bayX(2), sky.floorY(6), 'helmet'));
  pigs.push(pigOn(sky.bayX(3), sky.floorY(6), 'pig'));
  pigs.push(pigOn(sky.bayX(0), sky.floorY(5), 'pig'));
  pigs.push(pigOn(sky.bayX(3), sky.floorY(5), 'helmet'));
  pigs.push(pigOn(sky.bayX(0), sky.floorY(4), 'pig'));
  pigs.push(pigOn(19.6, lobbyL.floorY(1), 'pig'));
  pigs.push(pigOn(34.0, lobbyR.floorY(1), 'pig'));

  return {
    id: '3-3', name: '重力反转', biome: 'city',
    birds: ['stella', 'poppy', 'bomb'], par: 1, star2: 155000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 50, y1: 32 },
    terrain: [], blocks, pigs,
  };
}

/** 3-4 猪王城堡 — giant stone castle + clock tower, boss 猪王 11578 (13 pigs, >= 220 blocks). */
function level34() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: -1.4, y: 1.2, w: 6.2, h: 2.4 },
  ];

  // Grand stone castle + 6-floor clock tower on right (video 06:52)
  // Central keep has a 3-floor x 2-bay royal throne hall (4.7m wide x 5.2m tall) for boss_king (r=1.60)!
  const c = castle(27.8, 0, {
    keepBays: 4,
    keepFloors: 5,
    bayW: 2.40,
    floorH: 1.56,
    wingFloors: 4,
    clockFloors: 6,
    bossChamber: { bay0: 1, bay1: 2, floors: 3 },
  });
  blocks.push(...c.blocks);

  // Outer 2-bay x 3-floor courtyard barbican + rear postern tower -> brings total blocks >= 235!
  const barbican = tower(15.6, 0, {
    bays: 2, floors: 3, bayW: 1.95, floorH: 1.42,
    postMat: 'stone', beamMat: 'wood', windowMat: 'glass', postW: 0.30,
  });
  const postern = tower(40.2, 0, {
    bays: 1, floors: 3, bayW: 2.15, floorH: 1.42,
    postMat: 'stone', beamMat: 'stone', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...barbican.blocks, ...postern.blocks);
  for (let i = 0; i <= 2; i++) blocks.push(cube(barbican.colX(i), barbican.roofBase, 0.48, 'stone'));
  blocks.push(cube(40.2 - 0.6, postern.roofBase, 0.48, 'stone'));
  blocks.push(cube(40.2 + 0.6, postern.roofBase, 0.48, 'stone'));

  // Boss 猪王 (11578 HP, r=1.60) in center of 4.48m clear throne hall (x=27.8 -> 26.2..29.4)
  // Flanking TNTs placed with generous gap outside r=1.60 (at 27.8 +- 2.02 -> 25.78..29.82? Wait: colX(1)=25.4, postW=0.32 -> inner face 25.56! Put TNTs on floor 3 directly above the throne ceiling!)
  pigs.push(pigOn(27.8, 0, 'boss_king'));
  blocks.push(tnt(c.keep.bayX(1), c.keep.floorY(3), 0.68));
  blocks.push(tnt(c.keep.bayX(2), c.keep.floorY(3), 0.68));
  blocks.push(tnt(c.keep.bayX(0), c.keep.floorY(1), 0.66));
  blocks.push(tnt(c.keep.bayX(3), c.keep.floorY(1), 0.66));
  blocks.push(tnt(c.leftWing.bayX(1), c.leftWing.floorY(1), 0.66));
  blocks.push(tnt(c.rightWing.bayX(0), c.rightWing.floorY(1), 0.66));
  blocks.push(tnt(c.rightWing.bayX(1), c.rightWing.floorY(3), 0.66));
  blocks.push(tnt(barbican.bayX(1), barbican.floorY(1), 0.64));

  // 12 royal guards (total = 13 pigs, king placed inside bayX(1) on floor 4 — never on colX(2)!)
  pigs.push(pigOn(barbican.bayX(0), 0, 'pig'));
  pigs.push(pigOn(c.leftWing.bayX(0), 0, 'helmet'));
  pigs.push(pigOn(c.leftWing.bayX(1), c.leftWing.floorY(2), 'pig'));
  pigs.push(pigOn(c.leftWing.bayX(0), c.leftWing.floorY(3), 'helmet'));
  pigs.push(pigOn(c.keep.bayX(0), 0, 'helmet'));
  pigs.push(pigOn(c.keep.bayX(3), 0, 'helmet'));
  pigs.push(pigOn(c.keep.bayX(0), c.keep.floorY(2), 'pig'));
  pigs.push(pigOn(c.keep.bayX(3), c.keep.floorY(2), 'pig'));
  pigs.push(pigOn(c.keep.bayX(1), c.keep.floorY(4), 'king'));
  pigs.push(pigOn(c.rightWing.bayX(0), 0, 'helmet'));
  pigs.push(pigOn(c.rightWing.bayX(1), c.rightWing.floorY(2), 'pig'));
  pigs.push(pigOn(40.2, postern.floorY(1), 'helmet'));

  return {
    id: '3-4', name: '猪王城堡', biome: 'city',
    birds: ['gale', 'stella', 'silver', 'bomb', 'bubbles'], par: 2, star2: 210000,
    sling: { x: 0, y: 2.4 }, bounds: { x0: -10, x1: 56, y1: 34 },
    terrain, blocks, pigs,
  };
}

/** 3-5 无双乱斗 — mega fortress (all 12 birds in codex order, par 6, 20 pigs, >= 300 blocks). */
function level35() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: -1.6, y: 1.5, w: 6.4, h: 3.0 },
    { x: 29.8, y: 0.8, w: 12.8, h: 1.6 },
  ];

  // Sector 1: Outer 4-bay x 5-floor Bastion (x = 18.2, y0 = 0)
  const gate = tower(18.2, 0, {
    bays: 4, floors: 5, bayW: 1.95, floorH: 1.40,
    postMat: ['stone', 'wood'], beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...gate.blocks);
  for (let c = 0; c <= 4; c++) {
    const s = cubeStack(gate.colX(c), gate.roofBase, 2, 0.48, ['stone', 'glass']);
    blocks.push(...s.blocks);
  }
  blocks.push(tnt(gate.bayX(1), G0, 0.66));
  blocks.push(tnt(gate.bayX(2), gate.floorY(2), 0.64));
  pigs.push(pigOn(gate.bayX(0), 0, 'pig'));
  pigs.push(pigOn(gate.bayX(3), 0, 'helmet'));
  pigs.push(pigOn(gate.bayX(0), gate.floorY(1), 'pig'));
  pigs.push(pigOn(gate.bayX(3), gate.floorY(2), 'helmet'));
  pigs.push(pigOn(gate.bayX(1), gate.floorY(4), 'helmet'));

  // Sector 2: Elevated 5-bay x 5-floor Central Imperial Citadel (x = 29.8, y0 = 1.6)
  const citadel = tower(29.8, 1.6, {
    bays: 5, floors: 5, bayW: 2.35, floorH: 1.56,
    postMat: 'stone', beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.32,
    skipBays: (f, b) => f < 2 && (b === 1 || b === 2),
  });
  blocks.push(...citadel.blocks);
  const spire = hut(29.8, citadel.roofBase, 2.8, 1.65, 'stone', 'stone', 0.32);
  blocks.push(...spire.blocks);
  for (let c = 0; c <= 5; c++) {
    if (c === 2 || c === 3) continue;
    const s = cubeStack(citadel.colX(c), citadel.roofBase, 2, 0.48, ['stone', 'wood']);
    blocks.push(...s.blocks);
  }

  const bossX = (citadel.bayX(1) + citadel.bayX(2)) / 2;
  pigs.push(pigOn(bossX, citadel.floorY(0), 'boss_wizard'));
  blocks.push(tnt(bossX - 1.72, citadel.floorY(0), 0.66));
  blocks.push(tnt(bossX + 1.72, citadel.floorY(0), 0.66));
  blocks.push(tnt(citadel.bayX(4), citadel.floorY(1), 0.66));
  blocks.push(tnt(citadel.bayX(0), citadel.floorY(2), 0.66));
  blocks.push(tnt(citadel.bayX(2), citadel.floorY(3), 0.66));

  pigs.push(pigOn(citadel.bayX(0), citadel.floorY(0), 'helmet'));
  pigs.push(pigOn(citadel.bayX(3), citadel.floorY(0), 'king'));
  pigs.push(pigOn(citadel.bayX(4), citadel.floorY(0), 'helmet'));
  pigs.push(pigOn(citadel.bayX(0), citadel.floorY(1), 'pig'));
  pigs.push(pigOn(citadel.bayX(3), citadel.floorY(2), 'helmet'));
  pigs.push(pigOn(citadel.bayX(4), citadel.floorY(3), 'pig'));
  pigs.push(pigOn(citadel.bayX(1), citadel.floorY(4), 'king'));
  pigs.push(pigOn(29.8, citadel.roofBase, 'king'));

  // Sector 3: Rear 4-bay x 5-floor Arsenal Tower (x = 41.6, y0 = 0)
  const rear = tower(41.6, 0, {
    bays: 4, floors: 5, bayW: 1.95, floorH: 1.40,
    postMat: ['stone', 'wood', 'stone'], beamMat: 'wood', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...rear.blocks);
  for (let c = 0; c <= 4; c++) {
    const s = cubeStack(rear.colX(c), rear.roofBase, 2, 0.48, ['wood', 'glass']);
    blocks.push(...s.blocks);
  }
  blocks.push(tnt(rear.bayX(0), G0, 0.66));
  blocks.push(tnt(rear.bayX(3), rear.floorY(1), 0.66));
  blocks.push(tnt(rear.bayX(1), rear.floorY(3), 0.66));
  pigs.push(pigOn(rear.bayX(1), 0, 'helmet'));
  pigs.push(pigOn(rear.bayX(0), rear.floorY(2), 'pig'));
  pigs.push(pigOn(rear.bayX(2), rear.floorY(3), 'helmet'));
  pigs.push(pigOn(rear.bayX(3), rear.floorY(4), 'helmet'));

  // 2 Balloon pigs patrolling high above the gaps (exact 20 pigs total!)
  pigs.push(pigOn(23.0, 13.5, 'pig', { balloon: true }));
  pigs.push(pigOn(36.8, 13.8, 'pig', { balloon: true }));

  return {
    id: '3-5', name: '无双乱斗', biome: 'city',
    birds: BIRD_IDS.slice(), par: 6, star2: 270000,
    sling: { x: 0, y: 3.0 }, bounds: { x0: -10, x1: 58, y1: 34 },
    terrain, blocks, pigs,
  };
}

export const LEVELS = [
  level11(), level12(), level13(), level14(),
  level21(), level22(), level23(), level24(),
  level31(), level32(), level33(), level34(), level35(),
];

export function getLevel(id) {
  return LEVELS.find((l) => l.id === id) || null;
}
