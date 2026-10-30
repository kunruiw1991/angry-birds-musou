// Level data + authoring helpers (owner: levels-hud). SKELETON by opus-director: one test level.
// Replace with the 13 levels of docs/DESIGN.md §Levels. Units: meters, y up, ground top y = 0.
//
// Level schema:
// { id:'1-1', name:'风火轮', biome:'grass'|'desert'|'city', birds:[ids...], par:N (3rd star if
//   birdsUsed<=par), star2:score (2nd star), sling:{x,y} (base; pouch = y+2.0),
//   bounds:{x0,x1,y1}, terrain:[{x,y,w,h} | {verts:[[x,y],...]}] (static dirt),
//   blocks:[{m:'wood'|'glass'|'stone'|'tnt', s:'box'|'circle'|'tri', x,y,w,h|r, a}],
//   pigs:[{x,y,v:'pig'|'helmet'|'king'|'boss_helmet'|'boss_wizard'|'boss_king', r?, hp?, balloon?}] }
// Blocks must not overlap at load (leave >= 0.002 m gaps); the world settles 90 silent steps
// then sleeps everything, so stacks start perfectly still.

const T = 0.25;  // standard plank thickness

/** Vertical plank standing on y0. */
export const post = (x, y0, h, m = 'wood', w = T) => ({ m, s: 'box', x, y: y0 + h / 2, w, h });
/** Horizontal plank whose bottom is at y0. */
export const beam = (x, y0, w, m = 'wood', h = T) => ({ m, s: 'box', x, y: y0 + h / 2, w, h });
/** Square block with bottom at y0. */
export const cube = (x, y0, s = 0.8, m = 'stone') => ({ m, s: 'box', x, y: y0 + s / 2, w: s, h: s });

/** A simple hut: two posts + roof beam. Returns {blocks, top} where top = y of roof top. */
export function hut(x, y0, w = 2.2, h = 1.8, m = 'wood') {
  const blocks = [post(x - w / 2 + T / 2, y0, h, m), post(x + w / 2 - T / 2, y0, h, m), beam(x, y0 + h + 0.002, w + 0.2, m)];
  return { blocks, top: y0 + h + 0.002 + T };
}

function level11() {
  const blocks = [];
  const pigs = [];
  let h1 = hut(20, 0, 2.4, 1.8, 'wood'); blocks.push(...h1.blocks); pigs.push({ x: 20, y: 0.46 });
  let h2 = hut(20, h1.top + 0.002, 2.0, 1.4, 'glass'); blocks.push(...h2.blocks); pigs.push({ x: 20, y: h1.top + 0.47 });
  let h3 = hut(25, 0, 2.4, 2.2, 'wood'); blocks.push(...h3.blocks); pigs.push({ x: 25, y: 0.46, v: 'helmet' });
  blocks.push(cube(23.2, 0, 0.8, 'stone'), cube(26.8, 0, 0.8, 'stone'));
  return {
    id: '1-1', name: '风火轮', biome: 'grass', birds: ['red', 'red'], par: 1, star2: 20000,
    sling: { x: 0, y: 0 }, bounds: { x0: -12, x1: 45, y1: 26 },
    terrain: [], blocks, pigs,
  };
}

export const LEVELS = [level11()];
export function getLevel(id) { return LEVELS.find((l) => l.id === id) || null; }
