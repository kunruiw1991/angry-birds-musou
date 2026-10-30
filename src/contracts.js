// 愤怒的小鸟 无双版 — shared contracts (owner: opus-director).
// This file is the LAW every module codes against. Do not edit without asking
// @opus-director on the board. Values marked TUNE may be tuned by their owner
// through the per-module overrides described next to them.
//
// Coordinate system: world units are METERS, y points UP, ground surface y = 0.
// The slingshot sits near x = 0; structures live at x ~ 14..70.

export const PHYS = Object.freeze({
  DT: 1 / 60,               // fixed sim step (s)
  MAX_STEPS_PER_FRAME: 4,   // accumulator clamp (avoid spiral of death)
  GRAVITY: 10,              // m/s^2 (applied as (0,-GRAVITY))
  VEL_ITERS: 8,             // planck velocity iterations (may drop to 6 under load)
  POS_ITERS: 3,             // planck position iterations (may drop to 2 under load)
  SETTLE_STEPS: 90,         // silent settle steps at level load (damage off), then sleep all
  DAMAGE_GRACE_S: 0.5,      // no contact damage for this long after level start
  MAX_PROJECTILES: 120,     // hard cap of live kind==='proj' ents (oldest culled first)
  MAX_BODIES: 420,          // hard cap of all dynamic ents
  KILL_Y: -15,              // ents below this y are removed (pigs count as killed)
});

export const SLING = Object.freeze({
  FORK_HEIGHT: 2.0,         // pouch rest point = sling base + (0, FORK_HEIGHT)
  MAX_PULL: 2.4,            // m, max drag distance from pouch rest
  MAX_SPEED: 23,            // m/s launch speed at full pull (power = 1)
  MIN_POWER: 0.15,          // releases weaker than this cancel the shot
});

// Block materials. hp is for a "standard plank" of area 0.30 m^2; actual block
// hp = hp * clamp(area / 0.30, 0.5, 3.0). takeMul multiplies incoming damage.
export const MATERIALS = Object.freeze({
  wood:  { density: 0.8, friction: 0.7, restitution: 0.10, hp: 120, takeMul: 1.0, score: 500 },
  glass: { density: 0.6, friction: 0.25, restitution: 0.05, hp: 50,  takeMul: 1.5, score: 300 },
  stone: { density: 2.4, friction: 0.9, restitution: 0.00, hp: 280, takeMul: 0.6, score: 800 },
  tnt:   { density: 0.8, friction: 0.7, restitution: 0.10, hp: 20,  takeMul: 3.0, score: 1000,
           explode: { r: 2.6, dmg: 260, impulse: 26 } },
  pig:   { density: 0.8, friction: 0.6, restitution: 0.30, hp: 100, takeMul: 4.0, score: 5000 },
  bird:  { density: 5.0, friction: 0.6, restitution: 0.30, hp: Infinity, takeMul: 0, score: 0 },
  proj:  { density: 3.0, friction: 0.5, restitution: 0.20, hp: Infinity, takeMul: 0, score: 0 },
});

// Pig variants (radius default 0.45 m unless the level overrides r).
export const PIGS = Object.freeze({
  pig:         { hp: 100,   r: 0.45, label: '小猪' },
  helmet:      { hp: 200,   r: 0.48, label: '钢盔猪' },
  king:        { hp: 600,   r: 0.70, label: '国王猪' },
  boss_helmet: { hp: 1900,  r: 1.10, label: '钢盔猪将军', boss: true },
  boss_wizard: { hp: 5400,  r: 1.30, label: '巫师猪', boss: true },
  boss_king:   { hp: 11578, r: 1.60, label: '猪王', boss: true },
});

export const SCORE = Object.freeze({
  PER_DAMAGE: 1,            // +1 point per HP of damage dealt to blocks/pigs
  PIG_KILL: 5000,           // boss: PIG_KILL * 4
  UNUSED_BIRD: 10000,       // end-of-level bonus per unused bird
  COMBO_WINDOW_S: 0.6,      // kills within this window chain the combo
  COMBO_MUL_STEP: 0.05,     // kill-score multiplier = 1 + step * combo (max COMBO_MUL_MAX)
  COMBO_MUL_MAX: 3,
});

// The 12 birds. Order = codex order. Each id maps to src/birds/<id>.js.
export const BIRD_IDS = Object.freeze([
  'red', 'blues', 'chuck', 'bomb', 'matilda', 'hal',          // birds-a
  'terence', 'bubbles', 'silver', 'poppy', 'stella', 'gale',  // birds-b
]);

export const BIOMES = Object.freeze(['grass', 'desert', 'city']);

// Entity kinds. Every planck body has userData = an Ent (see typedef).
export const KIND = Object.freeze({
  GROUND: 'ground', TERRAIN: 'terrain', BLOCK: 'block', PIG: 'pig', BIRD: 'bird', PROJ: 'proj',
});

// Collision filter categories (planck filterCategoryBits / filterMaskBits).
export const CAT = Object.freeze({
  STATIC: 0x0001, BLOCK: 0x0002, PIG: 0x0004, BIRD: 0x0008, PROJ: 0x0010, GHOST: 0x0020,
});

/**
 * @typedef {Object} Ent  Attached as planck body userData; render iterates world.ents.
 * @property {number} id          deterministic incremental id
 * @property {string} kind        KIND.*
 * @property {string} mat         'wood'|'glass'|'stone'|'tnt'|'pig'|'bird'|'proj'|'terrain'
 * @property {'box'|'circle'|'poly'} shape
 * @property {number} [w] @property {number} [h]   box full size (m)
 * @property {number} [r]                          circle radius (m)
 * @property {Array<{x:number,y:number}>} [verts]  poly local verts (m, CCW)
 * @property {number} hp @property {number} maxHp
 * @property {string} skin        render skin: bird id | pig variant | projectile skin id | material
 * @property {boolean} alive
 * @property {Object} body        planck Body
 * @property {number} spawnT      sim time when spawned
 * @property {number} [ttl]       seconds to live (projectiles)
 * @property {number} [dmgMul]    outgoing contact-damage multiplier (default 1)
 * @property {Object} status      e.g. { poison:{dps,until}, tint:'#f0f', frozen:false }
 * @property {Object} data        free per-owner storage (abilities may stash state here)
 * @property {string} [owner]     bird id that spawned it (projectiles)
 */

/**
 * @typedef {Object} Effect  Transient VISUAL ONLY datum pushed by sim into world.effects.
 * Drawn by the renderer registered for `type` (see EFFECT_TYPES / bird modules' effects).
 * @property {string} type  @property {number} t0  sim time born  @property {number} ttl seconds
 * Plus any type-specific fields (x,y,r,x2,y2,color,...). Effects never affect the sim.
 */

// Generic effect types the core renderer (render-art) draws. Birds may register more
// in their module's `effects` map; ids must be prefixed with the bird id (e.g. 'chuck_laser').
export const EFFECT_TYPES = Object.freeze([
  'explosion',   // {x,y,r, power: 'small'|'normal'|'mega'} black smoke + orange fire (video style)
  'shockwave',   // {x,y,r, color}
  'flashring',   // {x,y,r, color}
  'beam',        // {x,y,x2,y2,width,color}
  'text',        // {x,y,text,color,size} world-anchored big text (rare; prefer bus 'banner')
]);

// Event bus names (sim -> juice/audio/hud/camera). Payloads are plain objects.
export const EV = Object.freeze({
  LEVEL_START: 'level:start',   // {levelId, biome}
  BIRD_READY: 'bird:ready',     // {birdId, index, remaining}
  LAUNCH: 'bird:launch',        // {birdId, x, y, vx, vy, power}
  BIRD_HIT: 'bird:hit',         // {birdId, x, y, speed}  bird/clone impact >= 5 m/s (feathers + thud)
  ABILITY: 'ability',           // {birdId, x, y, name}
  DAMAGE: 'damage',             // {id, kind, mat, amount, x, y, killed, big}
  BREAK: 'break',               // {id, kind, mat, x, y, w, h, r, angle, vx, vy, mass}
  PIG_POP: 'pig:pop',           // {id, x, y, r, score, boss, variant}
  EXPLOSION: 'explosion',       // {x, y, r, power}
  SCORE: 'score',               // {delta, total, x, y, reason}
  COMBO: 'combo',               // {count}
  JUICE: 'juice',               // {shake?, hitstop?(ms), slowmo?:{scale,dur}, flash?:{alpha,color}}
  SFX: 'sfx',                   // {name, x?, y?, vol?, pitch?}
  BANNER: 'banner',             // {text, sub?, color?, big?}
  TURN_END: 'turn:end',         // {birdsLeft, pigsLeft}
  LEVEL_CLEAR: 'level:clear',   // {levelId, score, stars, birdsUsed, best}
  LEVEL_FAIL: 'level:fail',     // {levelId, score, pigsLeft}
  STATE: 'game:state',          // {state, prev}
});

// Game states.
export const STATE = Object.freeze({
  TITLE: 'title', INTRO: 'intro', AIM: 'aim', FLIGHT: 'flight', SETTLE: 'settle',
  CLEAR: 'clear', FAIL: 'fail', PAUSED: 'paused',
});

export const STORAGE_KEY = 'musou_progress';  // {v:1, levels:{'1-1':{stars,best}}, muted, lastLevel}

export const UI = Object.freeze({
  MIN_TARGET_PX: 68,        // every interactive control >= 68x68 CSS px
  MAX_PLAY_CONTROLS: 5,     // visible interactive controls during AIM/FLIGHT
});
