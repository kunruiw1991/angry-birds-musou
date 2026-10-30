// Bird registry (owner: opus-director). Imports the 12 bird modules; each lives in its own file
// owned by birds-a (red, blues, chuck, bomb, matilda, hal) or birds-b (terence, bubbles,
// silver, poppy, stella, gale).
//
// BIRD MODULE CONTRACT (default export of src/birds/<id>.js):
// {
//   id, name (中文), ability (中文 技能名), desc (one line 中文), color (css),
//   radius (m), density, dmgMul (outgoing contact damage multiplier),
//   onLaunch(ctx, bird)            optional, right after launch
//   onTap(ctx, bird, target)       the 10x ability. target = {x,y} world point or null (auto-aim)
//   onStep(ctx, bird, dt)          optional, every sim step while this bird's turn is active
//   drawBird(g, ent, t)            sprite. g: LOCAL frame, origin = bird center, rotated with the
//                                  body, x right / y DOWN, 1 unit = 1 meter. ent.r = radius.
//   projSkins: { skinId(g, ent, t) }   projectile sprites, same local frame as drawBird.
//   effects:   { type(g, e, t, cam) }  effect renderers in SCREEN PIXELS: cam.sx(x), cam.sy(y)
//                                  map world->px, cam.s = px per meter, cam.w/cam.h viewport px.
//                                  age = t - e.t0, k = age / e.ttl. Prefix types with the bird id.
//   icon(g, size)                  optional HUD icon drawn into a size x size px box.
// }
// `ctx` is the ability context (src/sim/ability_ctx.js). Sim logic must be deterministic: use
// ctx.rng()/ctx.range(), ctx.time, ctx.actionRect() — never Math.random, Date, or the camera.

import red from './red.js';
import blues from './blues.js';
import chuck from './chuck.js';
import bomb from './bomb.js';
import matilda from './matilda.js';
import hal from './hal.js';
import terence from './terence.js';
import bubbles from './bubbles.js';
import silver from './silver.js';
import poppy from './poppy.js';
import stella from './stella.js';
import gale from './gale.js';

export const BIRDS = Object.freeze({ red, blues, chuck, bomb, matilda, hal, terence, bubbles, silver, poppy, stella, gale });

/** All projectile skin renderers across birds, merged: skinId -> fn. */
export const PROJ_SKINS = Object.freeze(Object.assign({}, ...Object.values(BIRDS).map((b) => b.projSkins || {})));
/** All bird-registered effect renderers, merged: type -> fn. */
export const BIRD_EFFECTS = Object.freeze(Object.assign({}, ...Object.values(BIRDS).map((b) => b.effects || {})));
