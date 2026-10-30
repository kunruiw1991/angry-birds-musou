// 13 hand-authored levels across 3 biomes for 愤怒的小鸟 无双版 (owner: levels-hud).
// Spec: docs/DESIGN.md §4 + Design Amendment A1 (#88 spans & multi-cluster 3-x) + #93 (settle.moved == 0).
// Units: meters, y up, ground top y = 0.
// Every level passes:
// - >= 2 mm load-time gaps (0 overlaps) & settle.moved == 0 (zero pre-AIM collapse/drift)
// - G4 (600 idle frames -> 0 dead, 0 displaced, 0 damage)
// - Structure spans: 1-x <= 14 m, 2-x 16–26 m, 3-x 26–45 m in 2–3 separated clusters
// - Bosses (1900 / 5400 / 11578) sheltered in stone chambers requiring >= 2 birds on typical runs
// - G1, G2, G3, G5, G6 (RANDOM clear >= 70 %, >= 90 % on 1-x), G7 (RANDOM 3* <= 60 % on 2-x/3-x; AIMED 3* >= 20 %)
// - star2 = median RANDOM clear score rounded to 1000.

import { BIRD_IDS } from '../contracts.js';
import {
  VG, post, beam, cube, tnt, pigOn, hut, frame, tower, cubeStack, pyramid, castle,
} from './builders.js';

export { post, beam, cube, tnt, hut, frame, tower, pyramid, castle };

const G0 = 0.004; // ground clearance (>= 2 mm above y = 0)

// ---------------------------------------------------------------------------
// Biome 1: 草原 (grass) — Power fantasy opening (1-1 .. 1-4, span <= 14 m)
// ---------------------------------------------------------------------------

/** 1-1 风火轮 — two small wood/glass huts on flat ground (3 pigs, >= 30 blocks, span ~11.0 m). */
function level11() {
  const blocks = [];
  const pigs = [];

  // Left 2-story wood & glass cottage at x = 15.8
  const t1 = tower(15.8, 0, {
    bays: 2, floors: 2, bayW: 1.78, floorH: 1.36,
    postMat: ['glass', 'wood'], beamMat: 'wood', windowMat: 'glass', postW: 0.24,
  });
  blocks.push(...t1.blocks);
  const attic1 = hut(15.8, t1.roofBase, 1.86, 1.10, 'glass', 'wood', 0.24);
  blocks.push(...attic1.blocks);
  pigs.push(pigOn(t1.bayX(0), 0, 'pig'));
  pigs.push(pigOn(15.8, attic1.roofBase, 'pig'));
  blocks.push(tnt(t1.bayX(1), G0, 0.64));

  // Center TNT & crate bridge
  blocks.push(cube(18.5, G0, 0.60, 'glass'));
  blocks.push(tnt(19.3, G0, 0.66));

  // Right 2-story glass & wood cottage at x = 22.2 (TNT inside bay 0 -> 1-shot chain wipe!)
  const t2 = tower(22.2, 0, {
    bays: 2, floors: 2, bayW: 1.78, floorH: 1.36,
    postMat: ['glass', 'wood'], beamMat: ['wood', 'glass'], windowMat: 'glass', postW: 0.24,
  });
  blocks.push(...t2.blocks);
  blocks.push(cube(t2.capX(0, 0.46), t2.roofBase, 0.46, 'glass'));
  blocks.push(cube(t2.capX(1, 0.50), t2.roofBase, 0.50, 'glass'));
  blocks.push(cube(t2.capX(2, 0.46), t2.roofBase, 0.46, 'glass'));
  blocks.push(tnt(t2.bayX(0), G0, 0.64));
  pigs.push(pigOn(t2.bayX(1), 0, 'pig'));

  return {
    id: '1-1', name: '风火轮', biome: 'grass',
    birds: ['red', 'red'], par: 1, star2: 59000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 40, y1: 24 },
    terrain: [], blocks, pigs,
  };
}

/** 1-2 流星分裂 — glass towers + 2 balloon pigs (5 pigs, >= 40 blocks, span ~10.8 m). */
function level12() {
  const blocks = [];
  const pigs = [];

  const xs = [15.6, 19.8, 24.0];
  const heights = [3, 3, 2];
  xs.forEach((tx, idx) => {
    const tw = tower(tx, 0, {
      bays: 1, floors: heights[idx], bayW: 2.15, floorH: 1.38,
      postMat: ['glass', 'wood', 'glass'], beamMat: ['wood', 'glass'],
      windowMat: 'glass', postW: 0.26,
    });
    blocks.push(...tw.blocks);
    blocks.push(cube(tx - 0.54, tw.roofBase, 0.48, 'glass'));
    blocks.push(cube(tx + 0.54, tw.roofBase, 0.48, 'glass'));
    pigs.push(pigOn(tx, tw.floorY(idx === 1 ? 2 : 0), idx === 1 ? 'helmet' : 'pig'));
  });

  blocks.push(tnt(17.7, G0, 0.66));
  blocks.push(cube(17.7, G0 + 0.66 + VG, 0.52, 'glass'));
  blocks.push(tnt(21.9, G0, 0.66));
  blocks.push(cube(21.9, G0 + 0.66 + VG, 0.52, 'glass'));

  // 2 Balloon pigs floating cleanly in open sky
  pigs.push(pigOn(17.7, 7.5, 'pig', { balloon: true }));
  pigs.push(pigOn(21.9, 8.1, 'pig', { balloon: true }));

  return {
    id: '1-2', name: '流星分裂', biome: 'grass',
    birds: ['blues', 'red'], par: 1, star2: 103000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 40, y1: 26 },
    terrain: [], blocks, pigs,
  };
}

/** 1-3 激光冲刺 — long low fortress, pigs spread horizontally (7 pigs, >= 50 blocks, span ~13.1 m). */
function level13() {
  const blocks = [];
  const pigs = [];

  const longFort = tower(20.8, 0, {
    bays: 6, floors: 2, bayW: 1.96, floorH: 1.36,
    postMat: ['wood', 'glass'], beamMat: 'wood', windowMat: 'glass', postW: 0.26,
  });
  blocks.push(...longFort.blocks);

  for (let c = 0; c <= 6; c++) {
    blocks.push(cube(longFort.capX(c, 0.46), longFort.roofBase, 0.46, c % 2 === 0 ? 'wood' : 'glass'));
  }
  blocks.push(tnt(longFort.bayX(1), longFort.floorY(1), 0.62));
  blocks.push(tnt(longFort.bayX(3), longFort.floorY(1), 0.62));
  blocks.push(tnt(longFort.bayX(5), longFort.floorY(1), 0.62));

  pigs.push(pigOn(longFort.bayX(0), 0, 'pig'));
  pigs.push(pigOn(longFort.bayX(1), 0, 'helmet'));
  pigs.push(pigOn(longFort.bayX(2), 0, 'pig'));
  pigs.push(pigOn(longFort.bayX(3), 0, 'helmet'));
  pigs.push(pigOn(longFort.bayX(4), 0, 'pig'));
  pigs.push(pigOn(longFort.bayX(5), 0, 'pig'));
  pigs.push(pigOn(longFort.bayX(2), longFort.floorY(1), 'helmet'));

  return {
    id: '1-3', name: '激光冲刺', biome: 'grass',
    birds: ['chuck', 'blues', 'red'], par: 1, star2: 168000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 42, y1: 25 },
    terrain: [], blocks, pigs,
  };
}

/** 1-4 全屏爆破 — stone+wood fort with TNT, boss 钢盔猪将军 (6 pigs, >= 70 blocks, span ~13.7 m). */
function level14() {
  const blocks = [];
  const pigs = [];

  // Front 2-bay wood/glass bailey at x = 16.8 (leftEdge = 15.0, structureBounds x0 ~ 14.34)
  const front = tower(16.8, 0, {
    bays: 2, floors: 2, bayW: 1.72, floorH: 1.32,
    postMat: ['wood', 'glass'], beamMat: 'wood', windowMat: 'glass', postW: 0.24,
  });
  blocks.push(...front.blocks);
  blocks.push(tnt(front.bayX(0), G0, 0.62));
  blocks.push(tnt(front.bayX(1), front.floorY(1), 0.60));
  blocks.push(cube(front.capX(0, 0.46), front.roofBase, 0.46, 'wood'));
  blocks.push(cube(front.capX(1, 0.46), front.roofBase, 0.46, 'glass'));
  blocks.push(cube(front.capX(2, 0.46), front.roofBase, 0.46, 'wood'));
  pigs.push(pigOn(front.bayX(1), 0, 'pig'));
  pigs.push(pigOn(front.bayX(0), front.floorY(1), 'pig'));

  // Rear armored stone keep at x = 23.6 (4 bays x 1.88 = 7.52 -> outer post 27.36 + 0.74 = 28.10 -> span = 13.76 m <= 14.0 m!)
  const keep = tower(23.6, 0, {
    bays: 4, floors: 3, bayW: 1.88, floorH: 1.48,
    postMat: 'stone', beamMat: ['stone', 'stone', 'wood'],
    windowMat: 'glass', postW: 0.32,
    skipBays: (f, b) => f < 2 && (b === 2 || b === 3),
  });
  blocks.push(...keep.blocks);

  // Boss 钢盔猪将军 (1900 HP) sheltered in rear stone vault (bays 2..3, x = 25.48) — survives blind early taps, falls to Bird 2 or deep AIMED Bomb!
  const bossX = (keep.bayX(2) + keep.bayX(3)) / 2;
  pigs.push(pigOn(bossX, 0, 'boss_helmet'));

  // 3 more guards in front half of keep (5 outer guards total -> 5/6 = 83% Shot-1 kill for G1!)
  pigs.push(pigOn(keep.bayX(0), 0, 'pig'));
  pigs.push(pigOn(keep.bayX(1), 0, 'helmet'));
  pigs.push(pigOn(keep.bayX(0), keep.floorY(1), 'pig'));
  blocks.push(tnt(keep.bayX(1), keep.floorY(1), 0.62));

  for (let c = 0; c <= 4; c++) {
    const s = cubeStack(keep.capX(c, 0.46), keep.roofBase, 3, 0.46, ['stone', 'wood', 'glass']);
    blocks.push(...s.blocks);
  }

  return {
    id: '1-4', name: '全屏爆破', biome: 'grass',
    birds: ['bomb', 'chuck', 'blues'], par: 1, star2: 197000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 42, y1: 26 },
    terrain: [], blocks, pigs,
  };
}

// ---------------------------------------------------------------------------
// Biome 2: 沙漠 (desert) — Precision & verticality (2-1 .. 2-4, span 16–26 m)
// ---------------------------------------------------------------------------

/** 2-1 投蛋射击 — stone pillars with pigs on top, slingshot on a dirt mesa (6 pigs, >= 60 blocks, span ~21.5 m). */
function level21() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: -1.4, y: 1.8, w: 6.4, h: 3.6 },
  ];

  // Five desert twin-pillars spanning x = 15.8 .. 35.4 (span = 21.46 m in [16, 26] m)
  const specs = [
    { x: 15.8, n: 4, v: 'pig', m: ['wood', 'stone'] },
    { x: 20.6, n: 6, v: 'pig', m: ['stone', 'wood'] },
    { x: 25.4, n: 5, v: 'helmet', m: ['stone', 'stone', 'wood'] },
    { x: 30.2, n: 6, v: 'helmet', m: ['stone', 'stone', 'wood'] },
    { x: 35.4, n: 4, v: 'helmet', m: ['stone'] },
  ];
  for (let i = 0; i < specs.length; i++) {
    const sp = specs[i];
    const leftS = cubeStack(sp.x - 0.44, G0, sp.n, 0.78, sp.m);
    const rightS = cubeStack(sp.x + 0.44, G0, sp.n, 0.78, sp.m);
    blocks.push(...leftS.blocks, ...rightS.blocks);
    blocks.push(beam(sp.x, leftS.nextY, 1.86, 'stone', 0.26));
    const capTop = leftS.nextY + 0.26;
    if (i === 4) {
      // Rear stone shrine hood sheltering the 5th pillar pig from blind early taps
      const hood = hut(sp.x, capTop + VG, 1.80, 1.28, 'stone', 'stone', 0.28);
      blocks.push(...hood.blocks);
      pigs.push(pigOn(sp.x, capTop, sp.v));
    } else {
      pigs.push(pigOn(sp.x, capTop, sp.v));
    }
  }

  // Valley hut at x = 23.0 + TNT crate stacks between pillars
  const valleyHut = hut(23.0, G0, 1.80, 1.36, 'wood', 'glass', 0.26);
  blocks.push(...valleyHut.blocks);
  pigs.push(pigOn(23.0, 0, 'pig'));

  for (const bx of [18.2, 27.8, 32.8]) {
    blocks.push(tnt(bx, G0, 0.66));
    blocks.push(cube(bx, G0 + 0.66 + VG, 0.54, 'glass'));
    blocks.push(cube(bx, G0 + 0.66 + VG + 0.54 + VG, 0.46, 'wood'));
  }

  return {
    id: '2-1', name: '投蛋射击', biome: 'desert',
    birds: ['matilda', 'bomb', 'red'], par: 1, star2: 107000,
    sling: { x: 0, y: 3.6 }, bounds: { x0: -10, x1: 48, y1: 28 },
    terrain, blocks, pigs,
  };
}

/** 2-2 神鹰回旋 — structures behind a tall static dirt wall (7 pigs, >= 70 blocks, span ~20.3 m). */
function level22() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: -1.2, y: 1.0, w: 5.8, h: 2.0 },
    { x: 13.0, y: 2.7, w: 2.0, h: 5.4 },
  ];

  // Vanguard wood/glass fort right behind the dirt wall (x = 18.0, leftEdge = 15.91)
  const w1 = tower(18.0, 0, {
    bays: 2, floors: 3, bayW: 1.95, floorH: 1.40,
    postMat: ['wood', 'glass', 'wood'], beamMat: 'wood', windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...w1.blocks);
  pigs.push(pigOn(w1.bayX(0), 0, 'pig'));
  pigs.push(pigOn(w1.bayX(1), w1.floorY(1), 'helmet'));
  pigs.push(pigOn(w1.bayX(0), w1.roofBase, 'pig'));
  blocks.push(tnt(w1.bayX(1), 0, 0.64));

  blocks.push(tnt(21.6, G0, 0.66));
  blocks.push(cube(21.6, G0 + 0.66 + VG, 0.54, 'wood'));

  // Middle stone/wood watchtower (x = 25.4)
  const w2 = tower(25.4, 0, {
    bays: 2, floors: 3, bayW: 1.95, floorH: 1.42,
    postMat: ['stone', 'wood'], beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...w2.blocks);
  pigs.push(pigOn(w2.bayX(0), 0, 'helmet'));
  pigs.push(pigOn(w2.bayX(1), w2.floorY(2), 'pig'));
  blocks.push(tnt(w2.bayX(0), w2.floorY(1), 0.64));

  // Rear stone bunker (x = 34.2, rightEdge = 36.24 -> span = 20.33 m in [16, 26] m)
  const w3 = tower(34.2, 0, {
    bays: 2, floors: 2, bayW: 1.90, floorH: 1.42,
    postMat: 'stone', beamMat: 'stone', windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...w3.blocks);
  blocks.push(cube(w3.capX(0, 0.48), w3.roofBase, 0.48, 'stone'));
  blocks.push(cube(w3.capX(1, 0.48), w3.roofBase, 0.48, 'stone'));
  blocks.push(cube(w3.capX(2, 0.48), w3.roofBase, 0.48, 'stone'));
  pigs.push(pigOn(w3.bayX(0), 0, 'helmet'));
  pigs.push(pigOn(w3.bayX(1), w3.floorY(1), 'pig'));
  blocks.push(tnt(w3.bayX(1), 0, 0.62));

  return {
    id: '2-2', name: '神鹰回旋', biome: 'desert',
    birds: ['hal', 'matilda', 'chuck'], par: 1, star2: 166000,
    sling: { x: 0, y: 2.0 }, bounds: { x0: -10, x1: 48, y1: 28 },
    terrain, blocks, pigs,
  };
}

/** 2-3 巨大化 — heavy stone pyramid with pigs inside (8 pigs, >= 80 blocks, span ~21.6 m). */
function level23() {
  const blocks = [];
  const pigs = [];

  // Front desert shrine (x = 16.4, leftEdge = 15.10)
  const shrineL = tower(16.4, 0, {
    bays: 1, floors: 4, bayW: 2.30, floorH: 1.46,
    postMat: ['wood', 'stone'], beamMat: 'wood', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...shrineL.blocks);
  pigs.push(pigOn(16.4, 0, 'pig'));
  pigs.push(pigOn(16.4, shrineL.floorY(1), 'helmet'));
  blocks.push(tnt(16.4, shrineL.floorY(2), 0.64));
  blocks.push(cube(16.4 - 0.62, shrineL.roofBase, 0.50, 'stone'));
  blocks.push(cube(16.4 + 0.62, shrineL.roofBase, 0.50, 'stone'));

  // 13-col stepped stone pyramid at x = 25.4 with fully-pier-supported interior tombs (c=2..4 & c=8..10)
  const pyr = pyramid(25.4, 0, {
    cols: 13,
    s: 0.78,
    stepX: 0.90,
    m: (c, r) => ((c + r) % 4 === 0 ? 'wood' : 'stone'),
    chambers: [
      { c0: 2, c1: 4, rows: 2 },
      { c0: 8, c1: 10, rows: 2 },
    ],
  });
  blocks.push(...pyr.blocks);

  // Tomb occupants cleanly centered with > 25 cm clearance from piers
  pigs.push(pigOn(pyr.colX(2.40), 0, 'helmet'));
  pigs.push(pigOn(pyr.colX(3.60), 0, 'pig'));
  pigs.push(pigOn(pyr.colX(8.40), 0, 'pig'));
  pigs.push(pigOn(pyr.colX(9.60), 0, 'helmet'));

  // Apex TNT + capstone directly centered on the 0.78 m top pyramid block (zero overhang!)
  blocks.push(tnt(25.4, pyr.roofBase, 0.62));
  blocks.push(cube(25.4, pyr.roofBase + 0.62 + VG, 0.48, 'wood'));

  // Rear stone obelisk bunker (x = 35.4, rightEdge = 36.725 -> span = 21.625 m in [16, 26] m)
  const shrineR = tower(35.4, 0, {
    bays: 1, floors: 4, bayW: 2.35, floorH: 1.56,
    postMat: 'stone', beamMat: 'stone', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...shrineR.blocks);
  pigs.push(pigOn(35.4, 0, 'pig'));
  pigs.push(pigOn(35.4, shrineR.floorY(1), 'king'));
  blocks.push(tnt(35.4, shrineR.floorY(3), 0.62));
  blocks.push(...cubeStack(35.4 - 0.62, shrineR.roofBase, 2, 0.48, ['stone', 'wood']).blocks);
  blocks.push(...cubeStack(35.4 + 0.62, shrineR.roofBase, 2, 0.48, ['stone', 'wood']).blocks);

  return {
    id: '2-3', name: '巨大化', biome: 'desert',
    birds: ['terence', 'hal', 'bomb'], par: 1, star2: 170000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 50, y1: 28 },
    terrain: [], blocks, pigs,
  };
}

/** 2-4 气球风暴 — 3-tier fortress, boss 巫师猪 5400 (9 pigs, >= 110 blocks, span ~22.4 m). */
function level24() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: -1.2, y: 1.1, w: 5.8, h: 2.2 },
    { x: 24.4, y: 0.7, w: 7.4, h: 1.4 },
    { x: 33.4, y: 1.4, w: 8.2, h: 2.8 },
  ];

  // Tier 1 (ground y = 0, x = 16.8, leftEdge = 14.61): vanguard wood/glass bastion
  const tier1 = tower(16.8, 0, {
    bays: 2, floors: 3, bayW: 2.05, floorH: 1.40,
    postMat: ['wood', 'stone', 'wood'], beamMat: 'wood', windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...tier1.blocks);
  for (let c = 0; c <= 2; c++) blocks.push(cube(tier1.capX(c, 0.48), tier1.roofBase, 0.48, 'wood'));
  pigs.push(pigOn(tier1.bayX(0), 0, 'pig'));
  pigs.push(pigOn(tier1.bayX(1), tier1.floorY(1), 'helmet'));
  blocks.push(tnt(tier1.bayX(1), 0, 0.64));
  blocks.push(tnt(tier1.bayX(0), tier1.floorY(2), 0.62));

  // Tier 2 (terrace top y = 1.4, x = 24.4): middle ward
  const tier2 = tower(24.4, 1.4, {
    bays: 3, floors: 3, bayW: 2.15, floorH: 1.56,
    postMat: ['stone', 'wood', 'stone'], beamMat: ['stone', 'wood'],
    windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...tier2.blocks);
  for (let c = 0; c <= 3; c++) blocks.push(cube(tier2.capX(c, 0.48), tier2.roofBase, 0.48, 'wood'));
  pigs.push(pigOn(tier2.bayX(0), tier2.floorY(0), 'helmet'));
  pigs.push(pigOn(tier2.bayX(2), tier2.floorY(0), 'pig'));
  pigs.push(pigOn(tier2.bayX(1), tier2.floorY(1), 'king'));
  blocks.push(tnt(tier2.bayX(1), tier2.floorY(0), 0.64));
  blocks.push(tnt(tier2.bayX(0), tier2.floorY(2), 0.62));
  blocks.push(tnt(tier2.bayX(2), tier2.floorY(2), 0.62));

  // Tier 3 (terrace top y = 2.8, x = 33.4, rightEdge = 37.01 -> span = 22.40 m): Wizard's stone sanctum
  const tier3 = tower(33.4, 2.8, {
    bays: 3, floors: 3, bayW: 2.30, floorH: 1.60,
    postMat: 'stone', beamMat: 'stone', windowMat: 'glass', postW: 0.32,
    skipBays: (f, b) => f < 2 && (b === 0 || b === 1),
  });
  blocks.push(...tier3.blocks);
  // Boss 巫师猪 (5400 HP) inside stone sanctum WITHOUT ground TNTs -> needs >= 2 birds!
  const wizX = (tier3.bayX(0) + tier3.bayX(1)) / 2;
  pigs.push(pigOn(wizX, tier3.floorY(0), 'boss_wizard'));
  pigs.push(pigOn(tier3.bayX(2), tier3.floorY(0), 'helmet'));
  pigs.push(pigOn(tier3.bayX(2), tier3.floorY(1), 'pig'));
  pigs.push(pigOn(tier3.bayX(1), tier3.floorY(2), 'helmet'));
  blocks.push(tnt(tier3.bayX(0), tier3.floorY(2), 0.62));

  const spire = hut(33.4, tier3.roofBase, 2.2, 1.36, 'wood', 'stone', 0.28);
  blocks.push(...spire.blocks);
  blocks.push(cube(tier3.capX(0, 0.50), tier3.roofBase, 0.50, 'stone'));
  blocks.push(cube(tier3.capX(3, 0.50), tier3.roofBase, 0.50, 'stone'));
  blocks.push(cube(33.4, spire.roofBase, 0.50, 'glass'));

  return {
    id: '2-4', name: '气球风暴', biome: 'desert',
    birds: ['bubbles', 'terence', 'matilda', 'bomb'], par: 2, star2: 295000,
    sling: { x: 0, y: 2.2 }, bounds: { x0: -10, x1: 50, y1: 30 },
    terrain, blocks, pigs,
  };
}

// ---------------------------------------------------------------------------
// Biome 3: 都市 (city) — Multi-cluster grand fortresses (3-1 .. 3-5, span 26–45 m)
// ---------------------------------------------------------------------------

/** 3-1 空军出击 — three separated rooftop buildings (stone + glass windows) (10 pigs, >= 110 blocks, span ~29.4 m). */
function level31() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: -1.4, y: 1.4, w: 6.0, h: 2.8 },
    { x: 14.8, y: 0.8, w: 6.8, h: 1.6 },
    { x: 26.8, y: 1.4, w: 6.2, h: 2.8 },
    { x: 38.8, y: 1.0, w: 5.6, h: 2.0 },
  ];

  // Cluster 1 (x = 14.8, leftEdge = 11.725): 3-bay x 4-floor west rooftop building (rich G2/G5 target)
  const b1 = tower(14.8, 1.6, {
    bays: 3, floors: 4, bayW: 1.95, floorH: 1.38,
    postMat: ['wood', 'stone', 'wood'], beamMat: ['wood', 'stone'], windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...b1.blocks);
  blocks.push(tnt(b1.bayX(1), b1.floorY(1), 0.64));
  blocks.push(tnt(b1.bayX(0), b1.roofBase, 0.64));
  blocks.push(cube(b1.bayX(2), b1.roofBase, 0.56, 'glass'));
  pigs.push(pigOn(b1.bayX(0), b1.floorY(0), 'pig'));
  pigs.push(pigOn(b1.bayX(2), b1.floorY(1), 'helmet'));
  pigs.push(pigOn(b1.bayX(1), b1.floorY(3), 'pig'));

  // Cluster 2 (x = 26.8, 6.4 m gap): 2-bay x 4-floor central high-rise + penthouse
  const b2 = tower(26.8, 2.8, {
    bays: 2, floors: 4, bayW: 2.35, floorH: 1.44,
    postMat: 'stone', beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.32,
  });
  blocks.push(...b2.blocks);
  const penthouse = hut(26.8, b2.roofBase, 2.35, 1.56, 'glass', 'stone', 0.28);
  blocks.push(...penthouse.blocks);
  blocks.push(tnt(b2.bayX(0), b2.floorY(2), 0.64));
  blocks.push(tnt(b2.bayX(1), b2.floorY(2), 0.64));
  pigs.push(pigOn(b2.bayX(0), b2.floorY(0), 'helmet'));
  pigs.push(pigOn(b2.bayX(1), b2.floorY(1), 'pig'));
  pigs.push(pigOn(b2.bayX(0), b2.floorY(3), 'helmet'));
  pigs.push(pigOn(26.8, b2.roofBase, 'king'));

  // Cluster 3 (x = 38.8, 7.2 m gap, rightEdge = 41.10 -> span = 29.375 m): east stone rooftop bunker
  const b3 = tower(38.8, 2.0, {
    bays: 2, floors: 3, bayW: 2.15, floorH: 1.40,
    postMat: 'stone', beamMat: 'stone', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...b3.blocks);
  blocks.push(tnt(b3.bayX(0), b3.floorY(1), 0.64));
  blocks.push(tnt(b3.bayX(1), b3.roofBase, 0.64));
  pigs.push(pigOn(b3.bayX(0), b3.floorY(0), 'pig'));
  pigs.push(pigOn(b3.bayX(1), b3.floorY(2), 'helmet'));
  pigs.push(pigOn(b3.bayX(0), b3.roofBase, 'pig'));

  return {
    id: '3-1', name: '空军出击', biome: 'city',
    birds: ['silver', 'bubbles', 'hal'], par: 1, star2: 277000,
    sling: { x: 0, y: 2.8 }, bounds: { x0: -10, x1: 52, y1: 30 },
    terrain, blocks, pigs,
  };
}

/** 3-2 旋风来袭 — wide junkyard in 3 separated scrap clusters (12 pigs, >= 130 blocks, span ~29.7 m). */
function level32() {
  const blocks = [];
  const pigs = [];

  // 3 separated junkyard clusters: West [13.2, 17.4], Central [23.8, 28.0], East Scrap [33.8, 38.0] (span ~29.9 m in [26, 45] m)
  const bayCenters = [13.2, 17.4, 23.8, 28.0, 33.8, 38.0];
  const mats = ['wood', 'glass', 'stone', 'wood', 'glass'];
  bayCenters.forEach((cx, idx) => {
    const rack = tower(cx, 0, {
      bays: 2, floors: 2, bayW: 1.82, floorH: 1.40,
      postMat: ['wood', 'glass'],
      beamMat: 'wood',
      windowMat: 'glass',
      postW: 0.25,
    });
    blocks.push(...rack.blocks);

    // Small scrap cubes neatly centered on roof (king sits on bayX(0) of heap 3 — never on colX(1) seam!)
    for (let k = -1; k <= 1; k++) {
      if (idx === 3 && k === -1) continue;
      const sx = idx === 3 ? (k === 0 ? rack.bayX(1) - 0.34 : rack.bayX(1) + 0.34) : (cx + k * 0.92);
      const s1 = cubeStack(sx, rack.roofBase, 3, 0.50, [mats[(idx + k + 3) % mats.length], 'wood', 'glass']);
      blocks.push(...s1.blocks);
    }

    const pBay0 = idx % 2 === 0 ? 0 : 1;
    const pBay1 = 1 - pBay0;
    blocks.push(tnt(rack.bayX(pBay1), G0, 0.62));
    if (idx >= 3) {
      blocks.push(tnt(rack.bayX(pBay0), rack.floorY(1), 0.60));
    }

    pigs.push(pigOn(rack.bayX(pBay0), 0, idx % 3 === 0 ? 'helmet' : 'pig'));
    if (idx === 3) {
      pigs.push(pigOn(rack.bayX(0), rack.roofBase, 'king'));
    } else {
      pigs.push(pigOn(rack.bayX(pBay1), rack.floorY(1), 'pig'));
    }
  });

  return {
    id: '3-2', name: '旋风来袭', biome: 'city',
    birds: ['poppy', 'silver', 'terence'], par: 1, star2: 327000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 52, y1: 28 },
    terrain: [], blocks, pigs,
  };
}

/** 3-3 重力反转 — 12 m skyscraper + west glass plaza + east high perch (10 pigs, >= 150 blocks, span ~29.1 m). */
function level33() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: 38.6, y: 1.5, w: 4.8, h: 3.0 },
  ];

  // Cluster 1 (x = 14.8, leftEdge = 11.72): 3-bay x 3-floor West Glass Plaza (60+ blocks for G2/G5!)
  const plaza = tower(14.8, 0, {
    bays: 3, floors: 3, bayW: 1.96, floorH: 1.38,
    postMat: ['wood', 'glass', 'wood'], beamMat: 'wood', windowMat: 'glass', postW: 0.28,
  });
  blocks.push(...plaza.blocks);
  for (let b = 0; b < 3; b++) {
    const s = cubeStack(plaza.bayX(b), plaza.roofBase, 2, 0.50, ['glass', 'wood']);
    blocks.push(...s.blocks);
  }
  blocks.push(tnt(plaza.bayX(0), 0, 0.64));
  blocks.push(tnt(plaza.bayX(2), plaza.floorY(1), 0.64));

  // Cluster 2 (x = 26.6, 4.1 m gap): 4-bay x 7-floor 12.6m+ Skyscraper + Penthouse (9 top-floor pigs + 国王猪!)
  const sky = tower(26.6, 0, {
    bays: 4, floors: 7, bayW: 2.15, floorH: 1.48,
    postMat: ['stone', 'stone', 'wood'], beamMat: ['stone', 'wood'],
    windowMat: 'glass', postW: 0.34, beamH: 0.26,
  });
  blocks.push(...sky.blocks);

  const crown = hut(26.6, sky.roofBase, 2.9, 1.72, 'stone', 'stone', 0.34);
  blocks.push(...crown.blocks);
  blocks.push(cube(26.6 - 0.96, crown.roofBase, 0.50, 'glass'));
  blocks.push(cube(26.6 + 0.96, crown.roofBase, 0.50, 'glass'));

  blocks.push(tnt(sky.bayX(1), G0, 0.66));
  blocks.push(tnt(sky.bayX(2), sky.floorY(2), 0.66));
  blocks.push(tnt(sky.bayX(1), sky.floorY(4), 0.66));
  blocks.push(tnt(sky.bayX(2), sky.floorY(5), 0.66));

  pigs.push(pigOn(26.6, crown.roofBase, 'king'));
  pigs.push(pigOn(sky.bayX(0), sky.floorY(6), 'helmet'));
  pigs.push(pigOn(sky.bayX(1), sky.floorY(6), 'helmet'));
  pigs.push(pigOn(sky.bayX(2), sky.floorY(6), 'helmet'));
  pigs.push(pigOn(sky.bayX(3), sky.floorY(6), 'pig'));
  pigs.push(pigOn(sky.bayX(0), sky.floorY(5), 'pig'));
  pigs.push(pigOn(sky.bayX(3), sky.floorY(5), 'helmet'));
  pigs.push(pigOn(sky.bayX(0), sky.floorY(4), 'pig'));
  pigs.push(pigOn(sky.bayX(3), sky.floorY(4), 'pig'));

  // Cluster 3 (x = 38.6 on 3.0m perch, rightEdge = 40.85 -> span = 29.13 m): East Comms Perch
  const perch = tower(38.6, 3.0, {
    bays: 2, floors: 2, bayW: 2.10, floorH: 1.40,
    postMat: ['stone', 'glass'], beamMat: 'wood', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...perch.blocks);
  blocks.push(tnt(perch.bayX(0), perch.floorY(1), 0.66));
  blocks.push(tnt(perch.bayX(0), perch.roofBase, 0.64));
  pigs.push(pigOn(perch.bayX(1), perch.floorY(1), 'pig'));

  return {
    id: '3-3', name: '重力反转', biome: 'city',
    birds: ['stella', 'poppy', 'bomb'], par: 1, star2: 326000,
    sling: { x: 0, y: 0 }, bounds: { x0: -10, x1: 52, y1: 32 },
    terrain, blocks, pigs,
  };
}

/** 3-4 猪王城堡 — 3-cluster castle compound + clock tower, boss 猪王 11578 (13 pigs, >= 220 blocks, span ~31.3 m). */
function level34() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: -1.4, y: 1.2, w: 6.2, h: 2.4 },
  ];

  // Cluster 1 (x = 15.2, leftEdge = 11.29, rightEdge = 19.11): 4-bay x 4-floor Outer Barbican Gatehouse (~104 blocks!)
  const barbican = tower(15.2, 0, {
    bays: 4, floors: 4, bayW: 1.88, floorH: 1.40,
    postMat: ['wood', 'stone', 'wood'], beamMat: 'wood', windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...barbican.blocks);
  for (let b = 0; b < 4; b++) {
    const s = cubeStack(barbican.bayX(b), barbican.roofBase, 3, 0.46, ['wood', 'glass', 'wood']);
    blocks.push(...s.blocks);
  }
  blocks.push(tnt(barbican.bayX(0), 0, 0.64));
  blocks.push(tnt(barbican.bayX(2), 0, 0.64));
  blocks.push(tnt(barbican.bayX(3), barbican.floorY(1), 0.64));
  blocks.push(tnt(barbican.bayX(1), barbican.floorY(3), 0.64));
  pigs.push(pigOn(barbican.bayX(1), 0, 'pig'));
  pigs.push(pigOn(barbican.bayX(0), barbican.floorY(2), 'helmet'));
  pigs.push(pigOn(barbican.bayX(2), barbican.floorY(3), 'pig'));

  // Cluster 2 (x = 27.2, 3.2 m gap): 4-bay x 5-floor Royal Stone Keep with throne vault for boss_king (11578 HP)
  const keep = tower(27.2, 0, {
    bays: 4, floors: 5, bayW: 2.38, floorH: 1.54,
    postMat: 'stone', beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.32, beamH: 0.26,
    skipBays: (f, b) => f < 3 && (b === 1 || b === 2),
  });
  blocks.push(...keep.blocks);
  const keepCrown = hut(27.2, keep.roofBase, 2.6, 1.55, 'stone', 'stone', 0.32);
  blocks.push(...keepCrown.blocks);
  blocks.push(...cubeStack(keep.bayX(0), keep.roofBase, 2, 0.48, ['stone', 'glass']).blocks);
  blocks.push(...cubeStack(keep.bayX(3), keep.roofBase, 2, 0.48, ['stone', 'glass']).blocks);

  // Boss 猪王 (11578 HP, r = 1.60) in lower stone vault (NO ground TNTs inside vault -> needs >= 2 birds!)
  pigs.push(pigOn(27.2, 0, 'boss_king'));
  blocks.push(tnt(keep.bayX(1), keep.floorY(3), 0.66));
  blocks.push(tnt(keep.bayX(2), keep.floorY(3), 0.66));
  blocks.push(tnt(keep.bayX(0), keep.floorY(1), 0.64));
  blocks.push(tnt(keep.bayX(3), keep.floorY(1), 0.64));

  pigs.push(pigOn(keep.bayX(0), 0, 'helmet'));
  pigs.push(pigOn(keep.bayX(3), 0, 'helmet'));
  pigs.push(pigOn(keep.bayX(0), keep.floorY(2), 'pig'));
  pigs.push(pigOn(keep.bayX(3), keep.floorY(2), 'pig'));
  pigs.push(pigOn(keep.bayX(1), keep.floorY(4), 'king'));
  pigs.push(pigOn(keep.bayX(2), keep.floorY(4), 'helmet'));

  // Cluster 3 (x = 39.4, 4.1 m gap, rightEdge = 42.62 -> span = 31.33 m): 3-bay x 5-floor Clock Tower Bastion
  const clock = tower(39.4, 0, {
    bays: 3, floors: 4, bayW: 2.04, floorH: 1.42,
    postMat: 'stone', beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.32,
  });
  blocks.push(...clock.blocks);
  const belfry = tower(39.4, clock.roofBase - VG, {
    bays: 1, floors: 2, bayW: 2.04, floorH: 1.42,
    postMat: 'stone', beamMat: 'stone', windowMat: 'glass', postW: 0.32,
  });
  blocks.push(...belfry.blocks);
  blocks.push(cube(clock.bayX(0), clock.roofBase, 0.50, 'stone'));
  blocks.push(cube(clock.bayX(2), clock.roofBase, 0.50, 'stone'));
  blocks.push(cube(39.4 - 0.55, belfry.roofBase, 0.48, 'stone'));
  blocks.push(cube(39.4 + 0.55, belfry.roofBase, 0.48, 'stone'));
  blocks.push(tnt(clock.bayX(1), clock.floorY(1), 0.64));
  blocks.push(tnt(39.4, belfry.floorY(0), 0.64));

  pigs.push(pigOn(clock.bayX(0), 0, 'helmet'));
  pigs.push(pigOn(clock.bayX(2), clock.floorY(1), 'pig'));
  pigs.push(pigOn(clock.bayX(1), clock.floorY(3), 'helmet'));

  return {
    id: '3-4', name: '猪王城堡', biome: 'city',
    birds: ['gale', 'stella', 'silver', 'bomb', 'bubbles'], par: 2, star2: 441000,
    sling: { x: 0, y: 2.4 }, bounds: { x0: -10, x1: 56, y1: 34 },
    terrain, blocks, pigs,
  };
}

/** 3-5 无双乱斗 — 3-cluster mega fortress (all 12 birds, par 6, 20 pigs, >= 300 blocks, span ~32.9 m). */
function level35() {
  const blocks = [];
  const pigs = [];
  const terrain = [
    { x: -1.6, y: 1.5, w: 6.4, h: 3.0 },
    { x: 29.4, y: 0.8, w: 10.4, h: 1.6 },
  ];

  // Cluster 1 (x = 15.0 & 21.5, leftEdge = 10.96, rightEdge = 23.38): West Vanguard + Supply Depot (~165 blocks!)
  const gate = tower(15.0, 0, {
    bays: 4, floors: 5, bayW: 1.95, floorH: 1.38,
    postMat: ['wood', 'stone', 'wood', 'glass', 'wood'],
    beamMat: 'wood',
    windowMat: 'glass',
    postW: 0.28,
  });
  blocks.push(...gate.blocks);
  for (let b = 0; b < 4; b++) {
    const s = cubeStack(gate.bayX(b), gate.roofBase, 3, 0.48, ['wood', 'glass', 'wood']);
    blocks.push(...s.blocks);
  }
  blocks.push(tnt(gate.bayX(1), G0, 0.66));
  blocks.push(tnt(gate.bayX(3), G0, 0.66));
  blocks.push(tnt(gate.bayX(0), gate.floorY(2), 0.64));
  blocks.push(tnt(gate.bayX(2), gate.floorY(2), 0.64));
  blocks.push(tnt(gate.bayX(1), gate.floorY(4), 0.64));

  // 2-bay x 4-floor wood/glass courtyard depot bridging x = 21.5
  const depot = tower(21.5, 0, {
    bays: 2, floors: 4, bayW: 1.75, floorH: 1.36,
    postMat: ['wood', 'glass'], beamMat: 'wood', windowMat: 'glass', postW: 0.26,
  });
  blocks.push(...depot.blocks);
  for (let b = 0; b < 2; b++) {
    blocks.push(...cubeStack(depot.bayX(b), depot.roofBase, 3, 0.46, ['glass', 'wood', 'glass']).blocks);
  }
  blocks.push(tnt(depot.bayX(0), G0, 0.64));
  blocks.push(tnt(depot.bayX(1), depot.floorY(2), 0.62));

  pigs.push(pigOn(gate.bayX(0), 0, 'pig'));
  pigs.push(pigOn(gate.bayX(2), 0, 'helmet'));
  pigs.push(pigOn(gate.bayX(0), gate.floorY(1), 'pig'));
  pigs.push(pigOn(gate.bayX(3), gate.floorY(2), 'helmet'));
  pigs.push(pigOn(gate.bayX(2), gate.floorY(4), 'pig'));
  pigs.push(pigOn(depot.bayX(1), 0, 'pig'));

  // Cluster 2 (x = 29.4, y0 = 1.6): 4-bay x 5-floor Elevated Central Imperial Citadel
  const citadel = tower(29.4, 1.6, {
    bays: 4, floors: 5, bayW: 2.34, floorH: 1.54,
    postMat: 'stone', beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.32,
    skipBays: (f, b) => f < 2 && (b === 1 || b === 2),
  });
  blocks.push(...citadel.blocks);
  const spire = hut(29.4, citadel.roofBase, 2.6, 1.60, 'stone', 'stone', 0.32);
  blocks.push(...spire.blocks);
  blocks.push(...cubeStack(citadel.bayX(0), citadel.roofBase, 2, 0.48, ['stone', 'glass']).blocks);
  blocks.push(...cubeStack(citadel.bayX(3), citadel.roofBase, 2, 0.48, ['stone', 'glass']).blocks);

  // Boss 巫师猪 (5400 HP) inside stone citadel hall (NO ground TNTs inside hall!)
  pigs.push(pigOn(29.4, citadel.floorY(0), 'boss_wizard'));
  blocks.push(tnt(citadel.bayX(0), citadel.floorY(2), 0.64));
  blocks.push(tnt(citadel.bayX(3), citadel.floorY(2), 0.64));
  blocks.push(tnt(citadel.bayX(1), citadel.floorY(3), 0.64));

  pigs.push(pigOn(citadel.bayX(0), citadel.floorY(0), 'helmet'));
  pigs.push(pigOn(citadel.bayX(3), citadel.floorY(0), 'king'));
  pigs.push(pigOn(citadel.bayX(0), citadel.floorY(1), 'pig'));
  pigs.push(pigOn(citadel.bayX(3), citadel.floorY(1), 'helmet'));
  pigs.push(pigOn(citadel.bayX(2), citadel.floorY(2), 'helmet'));
  pigs.push(pigOn(citadel.bayX(1), citadel.floorY(4), 'king'));
  pigs.push(pigOn(29.4, citadel.roofBase, 'king'));

  // Cluster 3 (x = 40.0, rightEdge = 43.85 -> span = 32.89 m): 4-bay x 5-floor Rear Arsenal Tower
  const rear = tower(40.0, 0, {
    bays: 4, floors: 5, bayW: 1.85, floorH: 1.40,
    postMat: ['stone', 'wood', 'stone'], beamMat: ['stone', 'wood'], windowMat: 'glass', postW: 0.30,
  });
  blocks.push(...rear.blocks);
  for (let b = 0; b < 4; b++) {
    const s = cubeStack(rear.bayX(b), rear.roofBase, 2, 0.48, ['stone', 'glass']);
    blocks.push(...s.blocks);
  }
  blocks.push(tnt(rear.bayX(0), G0, 0.64));
  blocks.push(tnt(rear.bayX(2), rear.floorY(2), 0.64));
  blocks.push(tnt(rear.bayX(1), rear.floorY(4), 0.64));

  pigs.push(pigOn(rear.bayX(1), 0, 'helmet'));
  pigs.push(pigOn(rear.bayX(3), rear.floorY(1), 'pig'));
  pigs.push(pigOn(rear.bayX(2), rear.floorY(3), 'helmet'));
  pigs.push(pigOn(rear.bayX(0), rear.floorY(4), 'helmet'));

  // 2 Balloon pigs patrolling high above the cluster gaps (exact 20 pigs total!)
  pigs.push(pigOn(23.7, 13.0, 'pig', { balloon: true }));
  pigs.push(pigOn(35.3, 13.4, 'pig', { balloon: true }));

  return {
    id: '3-5', name: '无双乱斗', biome: 'city',
    birds: BIRD_IDS.slice(), par: 6, star2: 656000,
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
