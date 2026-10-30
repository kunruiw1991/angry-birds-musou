# 愤怒的小鸟 无双版 · Angry Birds Musou — Design (owner: opus-director)

Reference: Bilibili BV1c9ieYaEGw 《我给每个鸟加强了10倍，愤怒的小鸟无双版！》 (frames studied in
`/tmp/ab_musou/seg/*.jpg`). The author's rule: **"不用管平衡性，怎么离谱怎么来"** — balance be damned,
the more outrageous the better. Every shot must become a screen-filling spectacle within 2 s:
numbers flying, structures collapsing, pigs popping. Audience: a family on iPad/laptop, touch-first,
Chinese UI.

This doc is binding. Numbers are starting values; owners may tune within ±30 % to hit the fun gates
(§13) and must report the final values. Bigger changes → ask @opus-director.

---------------------------------------------------------------------------------------------------
## 1. Architecture & file ownership

Zero-build ES2022 modules, relative imports with `.js`, Canvas 2D renderer, planck.js (Box2D, MIT)
vendored at `vendor/planck.mjs`. Fixed 60 Hz sim (accumulator in `src/main.js`) decoupled from render.
Sim is deterministic per seed (seeded `world.rng`, sim time, sim-defined rects). Render/audio/juice
listen to the event bus (`src/core/bus.js`) and NEVER touch the physics world.

| Owner | Files (you may create more files inside your dirs) |
|---|---|
| opus-director | `index.html`, `src/main.js`, `src/contracts.js`, `src/core/*`, `src/birds/index.js`, `tests/cdp.py`, `tests/smoke.py`, `docs/DESIGN.md`, README, git/deploy |
| physics-core | `src/sim/world.js`, `src/sim/game.js`, `src/sim/ability_ctx.js`, `src/seam.js`, `src/sim/*` (new) |
| birds-a | `src/birds/{red,blues,chuck,bomb,matilda,hal}.js` (+ `src/birds/a_*.js` helpers) |
| birds-b | `src/birds/{terence,bubbles,silver,poppy,stella,gale}.js` (+ `src/birds/b_*.js` helpers) |
| render-art | `src/render/*` (renderer, camera, backgrounds, sprites, generic effects) |
| levels-hud | `src/levels/*`, `src/ui/*`, `styles/main.css` |
| juice-audio | `src/fx/*`, `src/audio/*` |
| qa-gates | `tests/*` except `cdp.py`/`smoke.py` (harness, `run_e2e.py`, `sim_gates.py`, layout audit) |

Contracts live in code: `src/contracts.js` (constants, ids, Ent/Effect typedefs, event names),
`src/birds/index.js` header (bird module contract), `src/sim/ability_ctx.js` (ability API),
`src/seam.js` (`window.__MUSOU__`). Need a new hook in a file you don't own → ask its owner on the board.

**Never break the tree:** after every save run `python3 tests/smoke.py` (≈10 s) → must print
`SMOKE_OK ... errors=[]`. Scratch/screenshots/logs only under `/tmp/ab_musou/` (shots in
`/tmp/ab_musou/shots/<your-name>/`). No CDN, no runtime network, no new vendor libs without asking.
Headless Chrome needs `--no-proxy-server` (use `tests/cdp.py`'s `Browser`).

---------------------------------------------------------------------------------------------------
## 2. World, physics, damage (physics-core)

- Meters, y up, ground top y = 0, gravity 10. Slingshot base `level.sling` (pouch = base + (0, 2.0)).
  MAX_PULL 2.4 m → MAX_SPEED 23 m/s (range ≈ 50 m at 45°). Structures at x ≈ 16–60.
- Level load: build static ground/terrain, blocks, pigs → **90 silent settle steps (damage off) →
  sleep every body** → 0.5 s damage grace. Structures must start perfectly still (gate G4).
- Contact damage (impact-only, resting stacks never self-damage): in `pre-solve` record approach
  speed v (≥ 1.0 m/s), in `post-solve` take the summed normal impulse J;
  `dmg = K · J · v · takeMul(victim) · dmgMul(other)`. Tune K to this table:

| Event | Target damage |
|---|---|
| 红鸟 (no ability) 18 m/s head-on into a wood plank | 60–150 (plank) |
| same into glass | ≥ 75 (one-hit break) |
| same into stone block | 25–80 |
| bird 18 m/s into a normal pig | ≥ 100 (kill) |
| 1.2 m wood plank toppling from 2 m onto a pig | 30–80 |
| 0.8 m stone cube falling 2 m onto a pig | ≥ 100 |
| awake resting stack for 10 s / block sliding at 2 m/s | 0 |

- Materials (`MATERIALS`): wood 120 hp, glass 50 (×1.5 taken), stone 280 (×0.6), TNT 20 (×3, explodes
  r 2.6 / 260 dmg / impulse 26, chains). HP scales with area (standard plank 0.30 m²).
- Pigs: 小猪 100, 钢盔猪 200, 国王猪 600, bosses 钢盔猪将军 1900 / 巫师猪 5400 / 猪王 11578 (the
  video's HUD numbers). Pigs take ×4 contact damage. Balloon pigs float (gravityScale 0) until any damage
  pops the balloon. Ents below y −15 or ±25 m outside bounds are removed (pigs = killed).
- Score: +1 per HP of damage, block kill = material score (wood 500/glass 300/stone 800/TNT 1000),
  pig 5000 (boss ×4), combo (kills within 0.6 s) multiplier 1 + 0.05·n (≤ 3), unused bird +10000.
- Stars: ★ clear · ★ score ≥ `level.star2` · ★ birdsUsed ≤ `level.par` (shown on the level card as
  “★分数 ≥ X · ★用鸟 ≤ N”).
- Turn flow: AIM → FLIGHT (tap = ability once) → turn ends when bird gone/resting 1.2 s AND no live
  projectiles AND no ability tasks AND ≤ 2 awake bodies (or 12 s cap, or player taps 下一只).
  Last pig dies → banner 全灭！ + slow-mo, CLEAR after 1.2 s of chaos. Out of birds → SETTLE (≤ 2.5 s)
  → FAIL if pigs remain.
- Ability context (`ctx`, src/sim/ability_ctx.js) — the only sim API birds use: `rng/range`,
  `actionRect()` (sim-defined “screen” = structure bounds ∪ bird ± pad; use for full-screen effects),
  `spawnProjectile`, `explode`, `damageRay`, `damageCircle`, `damage`, `queryCircle`, `findTargets`,
  `applyImpulse/setVelocity/pos/vel`, `addEffect`, `addTask/after` (sim-time scheduling),
  `juice/sfx/banner/emit`, `pointer` (held pointer for 白公主). physics-core owns and hardens it;
  additions must stay backward compatible.
- Caps: ≤ 120 live projectiles (oldest culled), ≤ 420 dynamic bodies. Under load (> 200 awake) drop
  solver iterations to 6/2.

---------------------------------------------------------------------------------------------------
## 3. Birds — the 10× roster (birds-a: 1–6, birds-b: 7–12)

Each tap must produce visible VFX within 100 ms and its first damage within ≤ 1.2 s. All counts
below are the design; tune ±30 % for perf/fun, report finals. Auto-target (`target == null`, ability
button / tests) must pick something sensible (nearest pig ahead, else densest blocks).

| # | id | 名字 · 技能 | 10× ability (design numbers) | Video ref |
|---|---|---|---|---|
| 1 | red | 胖红 · 风火轮 | From launch 12 mini red birds orbit at r 1.3 m, 3 rev/s; each orbiter grinds what it touches (every 0.1 s: 30 dmg + tangential impulse 1.5). **Tap**: the ring flies out as 12 homing projectiles (18 m/s, steer 30 m/s² for 1.2 s, ×2 dmg, small blast r 0.9 / 60 dmg each) with pink streak trails; Red himself ×2 dmg +30 % speed. | 0:44–1:12 |
| 2 | blues | 蓝弟弟 · 流星分裂 | **Tap**: split into an X of 13 (two diagonals of 7 sharing the centre, spacing 0.55 m, parent velocity, r 0.28, ×1.5 dmg). 0.25 s later each clone calls a meteor 蓝弟弟 from the sky (spawn above actionRect top, 30 m/s dive at distributed targets, cyan beam trail, blast r 1.4 / 120 dmg / impulse 12), staggered over 0.2–1.0 s. | cover, 0:04–0:16, 1:48 |
| 3 | chuck | 飞镖黄 · 激光冲刺 | **Tap**: dash ×3 speed (≥ 45 m/s) for 0.6 s, piercing (sensor, 120 dmg once per body + impulse 8 along dash). A laser orb stays at the dash origin and fires 12 lasers over 0.5 s at targets ahead (±4° jitter), each a 45 m piercing ray: 90 dmg/body, impulse 3; beams glow 0.35 s (thick yellow, white core, additive). | 1:16–1:44 |
| 4 | bomb | 炸弹黑 · 全屏爆破 | **Tap**: 24 random explosions across actionRect over 1.0 s (r 1.6, 140 dmg, impulse 12), then at 1.05 s a **mega-blast** at the bird (r 5.5, 600 dmg, impulse 70, hit-stop 90 ms, slow-mo 0.35× 0.5 s, white flash 0.55, shake 1.0) that flings a ring of 16 TNT crates radially at 16 m/s which explode on impact (r 1.8, 200 dmg, impulse 18). No tap → mega-blast alone 1.5 s after first big impact. | 0:16–0:20, 2:00–2:20 |
| 5 | matilda | 白公主 · 投蛋射击 | **Tap**: shooting mode 4 s — gravity off, drift 2 m/s forward (rise to ≥ 6 m), fire an egg every 0.1 s (40 eggs, 26 m/s, gravityScale 0.3) at the held pointer (`ctx.pointer`) or auto-aim nearest pigs (retarget every 5 eggs); each egg blasts r 1.2 / 90 dmg / impulse 9. Then falls normally. | 2:24–2:48 |
| 6 | hal | 长嘴绿 · 神鹰回旋 | **Tap**: boomerang U-turn spin (vx → −0.9vx, vy ≥ +4) and summon 8 神鹰 (3.2 m wingspan silhouettes) 0.2 s apart; each swoops from upper-right off-screen down through the structure (dip to y 1–3 m at a target x) and out in 1.1 s; anything within 1.2 m of an eagle takes 220 dmg once per eagle + impulse 14 along its path; feather bursts. | 2:48–3:00 |
| 7 | terence | 大红 · 巨大化 | **Tap**: grow radius ×4 (0.62 → 2.48 m) over 0.25 s (5 fixture swaps), same density (mass ×16, momentum kept), ×5 contact dmg (numbers ≥ 1000), first ground hit = shockwave r 4 / 250 dmg / impulse 30 + big shake. | 3:04–3:16 |
| 8 | bubbles | 泡泡橙 · 气球风暴 | **Tap**: Bubbles inflates to r 2.0 for 1.5 s (radial push 25 + 100 dmg within 3.5 m) and releases 30 giant orange balloon-Bubbles (r 0.7–1.3) across the actionRect top: they fall first (gravityScale 1.8 for 1.2 s, “先下”) smashing everything (×3 dmg), then float up (gravityScale −1.2, “后上”) and leave; balloons ignore each other. | 3:20–3:44 |
| 9 | silver | 炫舞银 · 空军出击 | **Tap**: loop-de-loop (0.35 s, r 1.2 m) then slam at 32 m/s toward the target; on impact shockwave r 3 / 300 dmg and the **air force**: 40 silver birds dive from the upper-left sky in 4 waves of 10 (0.35 s apart), each at 28 m/s onto a target (pigs first, then tallest blocks), blast r 1.0 / 120 dmg, white streaks. Air force also triggers 1.5 s after tap if no impact. | 4:32–5:08 |
| 10 | poppy | 波比 · 旋风来袭 | **Tap**: Poppy slams down (vy −25); on landing (or 0.8 s) raises 14 tornadoes spread across actionRect, each 3.0 s: funnel r 1.6 m / height 7 m, wanders ±2 m and drifts to the nearest pig at 1 m/s, pulls bodies within 3.2 m toward its axis (force 25·m) + lift (1.4·m·g) + swirl; 25 dmg per 0.25 s to bodies inside. Yellow-white swirling funnels. | 5:48–6:08 |
| 11 | stella | 史黛拉 · 重力反转 | **Tap**: target = tap point (auto: densest pig cluster). A pink bubble field r 5.5 m captures up to 60 dynamic bodies: 0.9 s anti-gravity float (gravityScale −0.6, damping 2, pink bubble per body), then all are hurled at the target at 24 m/s with ×3 dmg for 1.5 s; gravity restored. | 3:48–4:12 |
| 12 | gale | 盖雅 · 剧毒斩 | **Tap**: poison nova r 6 m — every block/pig inside poisoned 6 s at 30 HP/s (`ent.status.poison`, magenta tint); each poisoned object that dies releases a mini purple slash (6 m ray, 60 dmg) at a random nearby target. 0.4 s later 6 purple lightning slashes cross the actionRect through targets (pigs first): 140 dmg + impulse per body (`damageRay`), zig-zag lightning visuals + purple flash 0.25. | 6:12–6:36 |

Art rules for birds (sprites drawn by each bird module): thick dark outline (≈0.08 r), flat bright
fills, white eye whites + black pupils, angry brows, orange beak, signature feature (Red's tuft &
brows, Chuck's triangle, Bomb's fuse with spark, Matilda's egg shape, Hal's long green beak,
Terence's huge brows, Bubbles' orange round puff, Silver's grey/white loop crest, Poppy's yellow
fluffy tuft, Stella's pink curl, Gale's purple crown). Clones/minions reuse the bird art at small scale.

---------------------------------------------------------------------------------------------------
## 4. Levels (levels-hud) — 13 hand-authored levels, 3 biomes

Power fantasy first (one shot wipes it), then taller fortresses where aim + ability timing matter for
★★★. Each level introduces/features one bird (first in its list). `par` = birds for ★3. star2 =
median clear score of the RANDOM policy (§13), rounded to 1000.

| id | 名字 | biome | birds (in order) | par | layout intent | pigs | blocks |
|---|---|---|---|---|---|---|---|
| 1-1 | 风火轮 | grass | red, red | 1 | two small wood/glass huts on flat ground | 3 | ≥ 30 |
| 1-2 | 流星分裂 | grass | blues, red | 1 | glass towers + 2 balloon pigs | 5 | ≥ 40 |
| 1-3 | 激光冲刺 | grass | chuck, blues, red | 1 | long low fortress, pigs spread horizontally | 7 | ≥ 50 |
| 1-4 | 全屏爆破 | grass | bomb, chuck, blues | 1 | stone+wood fort with TNT, boss 钢盔猪将军 | 6 | ≥ 70 |
| 2-1 | 投蛋射击 | desert | matilda, bomb, red | 1 | stone pillars with pigs on top, slingshot on a dirt mesa | 6 | ≥ 60 |
| 2-2 | 神鹰回旋 | desert | hal, matilda, chuck | 1 | structures behind a tall static dirt wall | 7 | ≥ 70 |
| 2-3 | 巨大化 | desert | terence, hal, bomb | 1 | heavy stone pyramid with pigs inside | 8 | ≥ 80 |
| 2-4 | 气球风暴 | desert | bubbles, terence, matilda, bomb | 2 | 3-tier fortress, boss 巫师猪 5400 | 9 | ≥ 110 |
| 3-1 | 空军出击 | city | silver, bubbles, hal | 1 | three rooftop buildings (stone + glass windows) | 10 | ≥ 110 |
| 3-2 | 旋风来袭 | city | poppy, silver, terence | 1 | wide junkyard of small blocks | 12 | ≥ 130 |
| 3-3 | 重力反转 | city | stella, poppy, bomb | 1 | 12 m skyscraper, pigs on top floors + 国王猪 | 10 | ≥ 150 |
| 3-4 | 猪王城堡 | city | gale, stella, silver, bomb, bubbles | 2 | giant stone castle + clock tower, boss 猪王 11578 | 13 | ≥ 220 |
| 3-5 | 无双乱斗 | city | all 12 in codex order | 6 | mega fortress (bonus, unlock after 3-4) | 20 | ≥ 300 |

Use the authoring helpers (`post/beam/cube/hut` + your own `tower/pyramid/frame/castle`). Blocks never
overlap at load (≥ 2 mm gaps). Every level must pass G4 (idle-stable) and G6 (clearable).

---------------------------------------------------------------------------------------------------
## 5. Camera (render-art)

- **Intro** (level start): frame the structure 0.6 s, ease to AIM framing over 1.2 s; any tap skips.
- **AIM**: frame [sling.x − 5, max(sling.x + 22, structure.x1 + 2)] if the scale keeps world height ≤ 24 m,
  else frame the sling area and show a small "→ 🐷" hint. Ground band ≈ 10–14 % of the viewport bottom.
- **FOLLOW** (flight before ability): centre = bird + 0.35 s velocity lookahead; zoom out with speed.
- **CARNAGE** (after ability / first impact): frame the bbox of active effects + awake bodies + live
  projectiles + bird, padded 3 m; scale clamp [whole level, 10 m tall]; position τ 0.25 s, zoom τ 0.45 s.
- **FREE**: one-finger drag on empty space pans, pinch / wheel zoom; auto-return 4 s after the last
  gesture or on next bird. Never show below y −2 or > 3 m beyond bounds. Juice shake adds on top.
- Portrait: fit width to [sling.x − 4, structure.x1 + 2], extra sky above.

## 6. Input (levels-hud)

- AIM: press within max(70 px, 1.6 m) of the pouch **or anywhere in the left 35 % of the screen**
  (relative drag) to aim; pull clamps at 2.4 m; trajectory preview = first ~0.9 s of the arc (dots
  shrinking); release with power ≥ 0.15 launches, else cancels. Press on the right 65 % = camera pan.
- FLIGHT: tap anywhere not on a HUD button = ability at that world point (once); keep holding to steer
  白公主 (`game.pointer = {x,y,down}` in world coords). After the ability, drag = free look.
- Keyboard: Space ability · R restart · N next bird · Esc pause.

## 7. HUD & menus (levels-hud) — DOM overlay, Chinese, ≥ 68 px targets, ≤ 5 controls in play

- Play controls (≤ 4 visible): ⏸ 暂停 & ↻ 重开 (top-left), **技能** button bottom-right (≥ 112×96, bird
  icon + 技能名, pulsing glow while ready, dim after use), **下一只 →** (left of 技能, only in FLIGHT after
  ability used or 2.5 s).
- Info (non-interactive): top-centre pill “关卡 2-3 · 分数 (count-up) · ★★★” (stars light as earned;
  sub-line “★分数≥52000 · ★用鸟≤1”), top-right 🐷 × N, boss HP bar (red bar + number, like the video)
  when a boss is alive, bird queue drawn in-world behind the sling.
- Banners: on BIRD_READY “飞镖黄 · 激光冲刺” (1.2 s); 全灭！ etc. (combo texts are juice-audio's).
- Title: “愤怒的小鸟” + big **无双版** (orange #ff6a1a, thick dark stroke, slight tilt — like the cover),
  live level rendered behind, buttons 开始游戏 / 选关 / 鸟类图鉴.
- Level select: 3 biome rows (草原 · 沙漠 · 都市) of tiles ≥ 96 px with stars/locks; 3-5 unlocks after 3-4.
- 图鉴: 12 bird cards (icon, name, 技能, one-line desc).
- Pause: 继续 / 重新开始 / 选关 / 音效 开/关. Results: 过关！ + 3 stars popping 0.35 s apart (chime),
  score count-up, best, 重玩 / 下一关 (primary). Fail: 猪猪还在！ 重试 (primary) / 选关.
- Progress: `localStorage['musou_progress'] = {v:1, levels:{id:{stars,best}}, unlocked, muted}` and
  merge `{musou:{stars,cleared,updated}}` into `localStorage['qq_hall_progress']`.
- 844×390: compress (pill 16 px, 技能 96×80). 390×844 portrait: non-blocking chip “横屏更好玩” 3 s.

## 8. Art direction (render-art)

Bright cartoon, flat fills, dark outlines — the video's look.
- **grass**: sky #3d9be0→#a8dcff, puffy white clouds (parallax 0.2), pale green hills (0.4); ground =
  grass strip #5fb336 over dark-blue cobblestone soil #1e3a78 with rounded stones (exactly the video).
- **desert**: sky #f6e3a0→#fff4d6, sun, dunes #e8c77a/#d9b25e, mesas; sand ground over brown earth.
- **city (night)**: sky #050a24→#1b1f4f, twinkling stars, moon with glow, purple skyline silhouettes
  with lit windows (parallax 0.3/0.5); dark dirt ground with a thin grass strip.
- Terrain: dark brown earth #5b3b22 with speckles + biome grass top (the slingshot often stands on one).
- Blocks: wood #d08a3a (border #7a4a1a, grain lines), glass/ice rgba(170,230,255,.75) (border #5fb0d8,
  white glint), stone #a3a9ae with inner inset square (border #5e6469) like the video's grey squares,
  TNT red crate with “TNT”. Cracks at < 66 % and < 33 % hp.
- Pigs: #7ac943 body, #355f1b outline, snout #a6dd6e + nostrils, eyes looking at the sling, ears;
  helmet (grey dome), king (gold crown), bosses bigger (mustache helmet / blue wizard hat with stars /
  huge crown + cape); bruise + black eye < 50 % hp; balloon pigs hang under a coloured balloon.
- Slingshot: Y fork #7a4a22, dark bands, leather pouch; bird queue on the ground behind it.
- Perf: offscreen sprite cache keyed by (type, size bucket, damage stage, zoom bucket); no shadowBlur in
  per-entity loops; DPR ≤ 2, adaptive down to 1.25 if frame p95 > 22 ms for 2 s.
- Generic effects (render-art): `explosion` (video style: white-yellow core 60 ms → orange fireball →
  black smoke puffs expanding, mega = screen-filling), `shockwave`, `flashring`, `beam`, `text`.

## 9. Juice (juice-audio)

- **Damage numbers** for every DAMAGE ≥ 5, merged per entity within 0.12 s; tiers: < 50 white 18 px,
  50–199 yellow 22, 200–499 orange 28, ≥ 500 red 34; rise 1.2 m over 0.8 s, scale pop 1.4→1.0, fade
  last 40 %, cap 80 (drop smallest). Pig kill “+5000” green 30 px.
- **Combo text** (top-centre): 连击 ×N at N ≥ 5 (grows with N), 大破坏！ at 20, **无双！！** at 40
  (giant orange stroked text like the cover).
- **Particles** (cap 900, halve spawns above 600): wood 8 splinters, glass 10 shards + sparkle, stone 7
  chunks + 3 dust puffs, explosions 14 sparks + 6 smoke puffs, pig pop green ring + smoke + stars,
  feathers (bird colour) on bird impacts.
- **Shake** (trauma): explosion +0.12 (mega +0.9), break +min(0.25, mass·0.02), pig pop +0.05; offset
  22 px·trauma², rot ±1.2°·trauma², decay 1.5/s. **Hit-stop**: pig pop 35 ms (≤ 1 per 120 ms), boss
  kill 160 ms, mega abilities 90 ms. **Slow-mo**: JUICE.slowmo; last pig 0.35× for 0.8 s, ease out 0.25 s.
  **Flash**: mega 0.55 white, Gale slashes 0.25 purple.
- **Pitch ladder**: break/pop SFX within 0.45 s of each other step +1 semitone (cap +12), then reset.

## 10. Audio (juice-audio) — WebAudio only, procedural, zero speechSynthesis, zero files

AudioContext on first gesture; master compressor (−18 dB, 4:1); voice cap 28; per-name throttle
25 ms. SFX: stretch (pitch follows pull), launch, whoosh, wood, glass, stone, pig_pop, boss_hit,
explosion, mega_explosion, laser, egg, eagle, tornado, balloon, balloon_pop, poison, slash, grow,
meteor, jet, ring, poof, star1–3, clear, fail, ui_click, ability_ready + a per-bird 3-note ability
sting. BGM: original jaunty 6/8 tunes per biome (do NOT copy the real Angry Birds theme), volume
0.22, ducks 40 % on mega moments, mute toggle persisted.

## 11. Performance budget

≥ 50 fps on iPad with 300+ bodies: sleeping, caps (projectiles 120, particles 900, popups 80,
effects 200), sprite cache, culling off-screen draws, solver 6/2 under load. Headless gate: sim step
p95 ≤ 8 ms and frame p95 ≤ 25 ms on 3-5 during 炸弹黑 chaos at 1280×800.

## 12. Test seam (physics-core) — `window.__MUSOU__` (frozen)

`listLevels()`, `listBirds()`, `startLevel(id,{seed})`, `launch(angleDeg, power01)`,
`useAbility(x?,y?)`, `skipTurn()`, `stepFrames(n)` (sync, no render), `getState()` (deep clone:
state, score, stars, birds, pigs[], displaced, bodies, awake, projectiles, effects, stats,
firstPigKillT/launchT/abilityT, events[]), `setPaused(b)`, `perf()` (frame/step p50/p95, particles,
popups). Render-side stats via `window.__APP__.perfStats()`.

---------------------------------------------------------------------------------------------------
## 13. Fun gates (opus-director enforces; qa-gates implements `tests/sim_gates.py`)

Policies — **RANDOM**: angle U[20°, 55°], power U[0.70, 1.0], ability at U[0.35, 0.9] s after launch
with auto-target, each turn runs to its natural end. **AIMED**: per bird, try 8 (angle, power, t_ability)
candidates from a fixed grid on fresh replays of the same seed, keep the best (most pigs killed, then
score), then move to the next bird.

| Gate | Target |
|---|---|
| G1 power fantasy | 1-1…1-4, RANDOM 20 seeds: the FIRST bird kills ≥ 60 % of pigs in ≥ 70 % of seeds |
| G2 spectacle volume | median blocks displaced+destroyed by the first shot ≥ 40 % of blocks (all levels) and ≥ 25 absolute on levels with ≥ 60 blocks |
| G3 latency | 1-1…2-4 RANDOM: median (firstPigKill − ability) ≤ 1.2 s, (firstPigKill − launch) ≤ 2.2 s |
| G4 stability | idle 600 frames after startLevel, all 13 levels × 3 seeds: 0 pigs dead, 0 displaced, 0 damage |
| G5 no dud ability | each bird on its intro level, 10 seeds: within 2.5 s of the tap ≥ 400 damage, ≥ 12 bodies displaced/killed, ≥ 1 new effect/projectile within 0.1 s — in ≥ 9/10 seeds |
| G6 clearable | RANDOM full run clear rate ≥ 70 % on every level (≥ 90 % on 1-x) |
| G7 stars mean something | ★★★ rate under RANDOM ≤ 60 % on 2-x/3-x; AIMED reaches ★★★ in ≥ 1/5 seeds on every level |
| G8 determinism | same seed + inputs → identical getState() JSON after 900 frames (3 levels × 2 runs) |
| G9 perf | 3-5 + 炸弹黑 chaos: sim step p95 ≤ 8 ms, frame p95 ≤ 25 ms headless 1280×800 |
| G10 layout | 1280×800, 1024×768, 844×390, 390×844: 0 scrollbars, no overlapping HUD rects, controls ≥ 68 px, ≤ 5 visible in play, no clipped text |
| G11 hygiene | 0 console errors over a scripted 13-level playthrough, 0 HTTP 4xx/5xx, no `speechSynthesis`, AudioContext only after a gesture |
| G12 peak chaos | within 2 s of each ability: peak particles ≥ 120 and popups ≥ 15 (`__APP__.perfStats()`) |

**Director's eye gate (Phase 2):** for each bird, a 1280×800 shot ~0.8 s after the tap must look like
the video: ≥ 30 % of the frame covered by ability VFX/projectiles/debris, ≥ 10 damage numbers
visible, structure visibly breaking. Tests passing ≠ fun.

## 14. Reports

When done (and after each change request), post on the board, ≤ 25 lines:
`[<NAME> READY] files… · smoke OK · numbers (tables vs targets) · screenshots /tmp/ab_musou/shots/<name>/… · known gaps`.
Measurable, not prose. Address @opus-director.
