// Camera (owner: render-art). Implements docs/DESIGN.md §5:
//   - Intro pan: 0.6 s on structure -> 1.2 s cubic ease to AIM; any tap / skipIntro() skips.
//   - AIM: frames [sling.x - 5, max(sling.x + 22, structure.x1 + 2)] if world height <= 24 m,
//     else frames the sling area (<= 24 m tall) and exposes offscreenPigsHint ("→ 🐷").
//     Portrait fits width to [sling.x - 4, structure.x1 + 2] with extra sky above.
//     Ground band ~10-14% of viewport bottom.
//   - FOLLOW: bird + 0.35 s velocity lookahead, zoom out with speed.
//   - CARNAGE: after ability or first impact, frames bbox of active effects + awake bodies +
//     live projectiles + bird, padded 3 m; scale clamped [whole level, 10 m tall];
//     position tau = 0.25 s, zoom tau = 0.45 s.
//   - FREE: pan(dxPx, dyPx), zoomAt(px, py, factor), userActive(), auto-return 4 s after last
//     gesture or on next bird. Clamped: never show below y = -2 or > 3 m beyond level bounds.

import { STATE, KIND, EV } from '../contracts.js';
import { bus } from '../core/bus.js';

const INTRO_HOLD_S = 0.6;
const INTRO_EASE_S = 1.2;
const FREE_RETURN_S = 4.0;
const MIN_WORLD_Y = -2.0;
const BOUNDS_PAD_X = 3.0;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep01(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export class Camera {
  constructor() {
    this.cx = 15;
    this.cy = 8;
    this.s = 34;                 // CSS px per meter
    this.w = 1280;
    this.h = 800;                // viewport CSS px
    this.shakeX = 0;
    this.shakeY = 0;
    this.rot = 0;

    this.offscreenPigs = 0;
    this.offscreenPigsHint = false;

    this._freeTimer = 0;
    this._introActive = false;
    this._introT = 0;
    this._introPose = null;
    this._aimPose = null;
    this._carnage = false;
    this._lastGame = null;

    bus.on(EV.LEVEL_START, () => {
      this._freeTimer = 0;
      this._carnage = false;
    });
    bus.on(EV.BIRD_READY, () => {
      this._freeTimer = 0;
      this._carnage = false;
    });
    bus.on(EV.LAUNCH, () => {
      this._freeTimer = 0;
      this._introActive = false;
      this._carnage = false;
    });
    bus.on(EV.ABILITY, () => {
      this._introActive = false;
      this._carnage = true;
    });
    const markImpact = () => {
      if (this._lastGame && this._lastGame.state === STATE.FLIGHT) {
        this._carnage = true;
      }
    };
    bus.on(EV.BIRD_HIT, markImpact);
    bus.on(EV.DAMAGE, markImpact);
    bus.on(EV.BREAK, markImpact);
    bus.on(EV.EXPLOSION, markImpact);
  }

  resize(w, h) {
    this.w = Math.max(1, w || 800);
    this.h = Math.max(1, h || 600);
    if (this._lastGame && this._lastGame.level && this._lastGame.world) {
      const sb = this._structureBounds(this._lastGame);
      this._introPose = this._computeStructurePose(this._lastGame, sb);
      this._aimPose = this._computeAimPose(this._lastGame, sb);
      if (this._introActive && this._introT === 0) {
        this.cx = this._introPose.cx;
        this.cy = this._introPose.cy;
        this.s = this._introPose.s;
      }
      this._clamp(this._lastGame);
      this._updateOffscreenPigs(this._lastGame);
    }
  }

  sx(x) { return (x - this.cx) * this.s + this.w / 2 + this.shakeX; }
  sy(y) { return (this.cy - y) * this.s + this.h / 2 + this.shakeY; }

  toWorld(px, py) {
    return {
      x: (px - this.w / 2 - this.shakeX) / this.s + this.cx,
      y: this.cy - (py - this.h / 2 - this.shakeY) / this.s,
    };
  }

  /** Visible world rect (including current shake offset). */
  view() {
    const a = this.toWorld(0, this.h);
    const b = this.toWorld(this.w, 0);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  /** Legacy helper: frame a world rect (x0..x1, y0..y1) into the viewport. */
  fit(x0, x1, y0, y1, k = 1) {
    const s = Math.min(this.w / Math.max(1, x1 - x0), this.h / Math.max(1, y1 - y0));
    const tcx = (x0 + x1) / 2;
    const tcy = (y0 + y1) / 2;
    this.s += (s - this.s) * k;
    this.cx += (tcx - this.cx) * k;
    this.cy += (tcy - this.cy) * k;
  }

  /** Free-look pan from canvas CSS pixel delta (cur - prev). */
  pan(dxPx, dyPx) {
    if (!Number.isFinite(dxPx) || !Number.isFinite(dyPx)) return;
    if (this._introActive) this.skipIntro();
    this.cx -= dxPx / this.s;
    this.cy += dyPx / this.s;
    this._freeTimer = FREE_RETURN_S;
    if (this._lastGame) {
      this._clamp(this._lastGame);
      this._updateOffscreenPigs(this._lastGame);
    }
  }

  /** Free-look pinch/wheel zoom anchored at canvas CSS pixel (px, py). factor > 1 zooms in. */
  zoomAt(px, py, factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    if (this._introActive) this.skipIntro();
    const wx = (px - this.w / 2) / this.s + this.cx;
    const wy = this.cy - (py - this.h / 2) / this.s;
    const [sMin, sMax] = this._scaleLimits(this._lastGame, true);
    this.s = clamp(this.s * factor, sMin, sMax);
    this.cx = wx - (px - this.w / 2) / this.s;
    this.cy = wy + (py - this.h / 2) / this.s;
    this._freeTimer = FREE_RETURN_S;
    if (this._lastGame) {
      this._clamp(this._lastGame);
      this._updateOffscreenPigs(this._lastGame);
    }
  }

  /** True while player free-look pan/zoom hold is active (auto-returns after 4 s). */
  userActive() {
    return this._freeTimer > 0;
  }

  /** True while the level-start structure->AIM intro pan is still playing. */
  introActive() {
    return this._introActive;
  }

  /** Immediately end the intro pan and snap to AIM framing. */
  skipIntro(game = this._lastGame) {
    this._introActive = false;
    this._introT = INTRO_HOLD_S + INTRO_EASE_S;
    if (game && game.level && game.world) {
      const sb = this._structureBounds(game);
      const aim = this._computeAimPose(game, sb);
      this._aimPose = aim;
      this.cx = aim.cx;
      this.cy = aim.cy;
      this.s = aim.s;
      this._clamp(game);
      this._updateOffscreenPigs(game);
    }
  }

  /** Called on level start (main.js app.startLevel). Starts intro pan unless skipped. */
  snapTo(game, opts = {}) {
    this._lastGame = game;
    this._freeTimer = 0;
    this._carnage = false;
    this.shakeX = 0;
    this.shakeY = 0;
    this.rot = 0;
    if (!game || !game.level || !game.world) return;

    const sb = this._structureBounds(game);
    this._introPose = this._computeStructurePose(game, sb);
    this._aimPose = this._computeAimPose(game, sb);

    const isSmoke = typeof location !== 'undefined' && location.search.includes('smoke=1');
    const wantIntro = !opts.skipIntro && !isSmoke &&
      (game.state === STATE.AIM || game.state === STATE.INTRO);

    if (wantIntro) {
      this._introActive = true;
      this._introT = 0;
      this.cx = this._introPose.cx;
      this.cy = this._introPose.cy;
      this.s = this._introPose.s;
    } else {
      this._introActive = false;
      this._introT = INTRO_HOLD_S + INTRO_EASE_S;
      this.cx = this._aimPose.cx;
      this.cy = this._aimPose.cy;
      this.s = this._aimPose.s;
    }
    this._clamp(game);
    this._updateOffscreenPigs(game);
  }

  update(dt, game) {
    if (!game || !game.world || !game.level) return;
    this._lastGame = game;
    const stepDt = clamp(dt || 0, 0, 0.1);

    if (game.abilityUsed && game.state === STATE.FLIGHT) {
      this._carnage = true;
    }
    if (game.state !== STATE.AIM && game.state !== STATE.INTRO) {
      this._introActive = false;
    }

    // 1. User FREE pan/zoom override (4 s auto-return)
    if (this._freeTimer > 0) {
      this._freeTimer = Math.max(0, this._freeTimer - stepDt);
      this._clamp(game);
      this._updateOffscreenPigs(game);
      return;
    }

    // 2. INTRO pan: 0.6 s structure hold -> 1.2 s ease to AIM
    if (this._introActive) {
      this._introT += stepDt;
      const sb = this._structureBounds(game);
      const p0 = this._introPose || (this._introPose = this._computeStructurePose(game, sb));
      const p1 = this._aimPose = this._computeAimPose(game, sb);
      if (this._introT <= INTRO_HOLD_S) {
        this.cx = p0.cx;
        this.cy = p0.cy;
        this.s = p0.s;
      } else if (this._introT < INTRO_HOLD_S + INTRO_EASE_S) {
        const u = smoothstep01((this._introT - INTRO_HOLD_S) / INTRO_EASE_S);
        this.cx = p0.cx + (p1.cx - p0.cx) * u;
        this.cy = p0.cy + (p1.cy - p0.cy) * u;
        this.s = p0.s + (p1.s - p0.s) * u;
      } else {
        this._introActive = false;
        this.cx = p1.cx;
        this.cy = p1.cy;
        this.s = p1.s;
      }
      this._clamp(game);
      this._updateOffscreenPigs(game);
      return;
    }

    // 3. Active gameplay states
    if (game.state === STATE.FLIGHT) {
      if (!this._carnage && game.world.countAwake() > 4) {
        this._carnage = true;
      }
      if (this._carnage) {
        this._updateCarnage(stepDt, game);
      } else {
        this._updateFollow(stepDt, game);
      }
    } else if (game.state === STATE.SETTLE || (game.state === STATE.CLEAR && game.clearT != null)) {
      this._updateCarnage(stepDt, game);
    } else {
      // AIM, TITLE background, PAUSED, FAIL
      const sb = this._structureBounds(game);
      const aim = this._aimPose = this._computeAimPose(game, sb);
      const kp = 1 - Math.exp(-stepDt / 0.28);
      const kz = 1 - Math.exp(-stepDt / 0.35);
      this.cx += (aim.cx - this.cx) * kp;
      this.cy += (aim.cy - this.cy) * kp;
      this.s += (aim.s - this.s) * kz;
    }

    this._clamp(game);
    this._updateOffscreenPigs(game);
  }

  // ---------------- internal framing helpers ----------------

  _levelBounds(game) {
    const b = (game && game.level && game.level.bounds) || { x0: -12, x1: 50, y1: 26 };
    return {
      x0: b.x0 ?? -12,
      x1: b.x1 ?? 50,
      y1: b.y1 ?? 26,
    };
  }

  _structureBounds(game) {
    if (game && game.structureBounds && Number.isFinite(game.structureBounds.x1)) {
      return game.structureBounds;
    }
    return { x0: 16, x1: 32, y0: 0, y1: 10 };
  }

  _scaleLimits(game, isFree = false) {
    const lb = this._levelBounds(game);
    const maxSpanX = Math.max(20, (lb.x1 + BOUNDS_PAD_X) - (lb.x0 - BOUNDS_PAD_X));
    const maxSpanY = Math.max(16, (lb.y1 + 10) - MIN_WORLD_Y);
    const isPortrait = this.h > this.w;
    const sMin = isPortrait
      ? this.w / maxSpanX
      : Math.max(this.w / maxSpanX, this.h / maxSpanY);
    // CARNAGE max zoom = 10 m tall; FREE allows slightly closer inspection (~7.5 m tall).
    const minTall = isFree ? 7.5 : 10.0;
    const sMax = isPortrait
      ? Math.max(sMin, this.w / minTall)
      : Math.max(sMin, this.h / minTall);
    return [sMin, sMax];
  }

  /** Place cy so ground (y = 0) leaves ~12% ground band at bottom, while y0 >= -2. */
  _groundAlignedCy(s, minTopY = 0) {
    const worldH = this.h / s;
    const groundBand = Math.min(-MIN_WORLD_Y, 0.12 * worldH); // <= 2.0 m below y=0
    let y0 = -groundBand;
    if (y0 + worldH < minTopY) {
      y0 = Math.max(MIN_WORLD_Y, minTopY - worldH);
    }
    return y0 + worldH / 2;
  }

  _computeStructurePose(game, sb) {
    const [sMin] = this._scaleLimits(game, false);
    const isPortrait = this.h > this.w;
    const x0 = sb.x0 - 3.5;
    const x1 = Math.max(x0 + 14, sb.x1 + 3.5);
    const topY = Math.max(sb.y1 + 3.5, 11);
    let s;
    if (isPortrait) {
      s = clamp(this.w / Math.max(14, x1 - x0), sMin, this.w / 11);
    } else {
      const sFit = Math.min(this.w / (x1 - x0), this.h / (topY + 1.8));
      s = clamp(sFit, sMin, this.h / 15.5);
    }
    const cx = (x0 + x1) / 2;
    const cy = this._groundAlignedCy(s, topY);
    return this._clampPose(game, { cx, cy, s });
  }

  _computeAimPose(game, sb) {
    const sling = game.level.sling || { x: 0, y: 0 };
    const pouch = game.pouch ? game.pouch() : { x: sling.x, y: sling.y + 2 };
    const [sMin] = this._scaleLimits(game, false);
    const isPortrait = this.h > this.w;

    // Portrait: fit width to [sling.x - 4, structure.x1 + 2], extra sky above.
    if (isPortrait) {
      const x0 = sling.x - 4;
      const x1 = Math.max(sling.x + 18, sb.x1 + 2);
      const topReq = Math.max(sb.y1 + 2.5, pouch.y + 2.5, 10);
      let s = this.w / Math.max(12, x1 - x0);
      s = Math.min(s, this.h / (topReq + 2.0));
      s = Math.max(sMin, s);
      const cx = (x0 + x1) / 2;
      const cy = this._groundAlignedCy(s, topReq);
      return this._clampPose(game, { cx, cy, s });
    }

    // Landscape: try framing [sling.x - 5, max(sling.x + 22, structure.x1 + 2)].
    const x0 = sling.x - 5;
    const x1 = Math.max(sling.x + 22, sb.x1 + 2);
    const topReq = Math.max(sb.y1 + 2.8, pouch.y + 2.8, 10.5);
    const sFull = Math.min(this.w / (x1 - x0), this.h / (topReq + 1.85));
    const worldHFull = this.h / sFull;

    if (worldHFull <= 24.0) {
      const s = Math.max(sMin, sFull);
      const halfW = (this.w / 2) / s;
      // Keep sling.x - 4.5 comfortably inside the left edge if height-constrained.
      const cx = Math.min((x0 + x1) / 2, (sling.x - 4.2) + halfW);
      const cy = this._groundAlignedCy(s, topReq);
      return this._clampPose(game, { cx, cy, s });
    }

    // Wide level (> 24 m tall if fit whole): frame the sling area at <= 22.5 m tall.
    const targetH = 22.0;
    const s = Math.max(sMin, this.h / targetH);
    const halfW = (this.w / 2) / s;
    const cx = (sling.x - 4.8) + halfW;
    const cy = this._groundAlignedCy(s, Math.max(pouch.y + 3.0, 10));
    return this._clampPose(game, { cx, cy, s });
  }

  _updateFollow(dt, game) {
    const b = game.bird;
    if (!b || !b.alive) {
      this._updateCarnage(dt, game);
      return;
    }
    const p = b.body.getPosition();
    const v = b.body.getLinearVelocity();
    const spd = Math.hypot(v.x, v.y);
    const tcx = p.x + v.x * 0.35;
    const tcy = p.y + v.y * 0.35;

    const [sMin, sMax] = this._scaleLimits(game, false);
    const isPortrait = this.h > this.w;
    const targetSpan = 14.5 + clamp(spd, 0, 32) * 0.32;
    const rawS = isPortrait ? this.w / (targetSpan * 0.95) : this.h / targetSpan;
    const ts = clamp(rawS, sMin, sMax);

    const kp = 1 - Math.exp(-dt / 0.20);
    const kz = 1 - Math.exp(-dt / 0.32);
    this.cx += (tcx - this.cx) * kp;
    this.cy += (tcy - this.cy) * kp;
    this.s += (ts - this.s) * kz;
  }

  _updateCarnage(dt, game) {
    const w = game.world;
    const lb = this._levelBounds(game);
    const sb = this._structureBounds(game);
    const sling = game.level.sling || { x: 0, y: 0 };

    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    const include = (x, y, r = 0.5) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // Ignore debris already plunging far off-stage so CARNAGE stays tight on the action.
      if (y < -2.5 || x < lb.x0 - 4 || x > lb.x1 + 4 || y > lb.y1 + 12) return;
      const rr = Math.max(0.3, Math.min(8, r || 0.5));
      if (x - rr < bx0) bx0 = x - rr;
      if (x + rr > bx1) bx1 = x + rr;
      if (y - rr < by0) by0 = y - rr;
      if (y + rr > by1) by1 = y + rr;
    };

    if (game.bird && game.bird.alive) {
      const p = game.bird.body.getPosition();
      include(p.x, p.y, (game.bird.r || 0.5) + 0.5);
    }

    for (let i = 0; i < w.ents.length; i++) {
      const e = w.ents[i];
      if (!e.alive) continue;
      if (e.kind === KIND.PROJ) {
        const p = e.body.getPosition();
        include(p.x, p.y, e.r || 0.4);
      } else if (
        (e.kind === KIND.BLOCK || e.kind === KIND.PIG || e.kind === KIND.BIRD) &&
        e.body.isDynamic() &&
        e.body.isAwake()
      ) {
        const p = e.body.getPosition();
        const ext = e.r || Math.max(e.w || 0.5, e.h || 0.5) * 0.5;
        include(p.x, p.y, ext);
      }
    }

    for (let i = 0; i < w.effects.length; i++) {
      const ef = w.effects[i];
      if (ef.x != null && ef.y != null) {
        const er = ef.power === 'mega' ? Math.min(10, ef.r || 6) : Math.min(6, ef.r || 1.5);
        include(ef.x, ef.y, er);
      }
      if (ef.x2 != null && ef.y2 != null) {
        include(clamp(ef.x2, lb.x0, lb.x1), clamp(ef.y2, 0, lb.y1 + 4), 1.0);
      }
    }

    if (!Number.isFinite(bx0)) {
      // Fallback: frame remaining pigs or structure bounds
      const pigs = w.pigs();
      if (pigs.length) {
        for (let i = 0; i < pigs.length; i++) {
          const p = pigs[i].body.getPosition();
          include(p.x, p.y, (pigs[i].r || 0.5) + 1.5);
        }
      }
      if (!Number.isFinite(bx0)) {
        bx0 = sb.x0; bx1 = sb.x1; by0 = 0; by1 = Math.max(6, sb.y1);
      }
    }

    // Pad bbox by 3 m per §5
    bx0 -= 3.0;
    bx1 += 3.0;
    by0 = Math.max(MIN_WORLD_Y, by0 - 3.0);
    by1 += 3.0;

    // Scale clamp: [whole level, 10 m tall]
    const wholeX0 = Math.min(sling.x - 5, sb.x0 - 3);
    const wholeX1 = Math.max(sb.x1 + 3, sling.x + 22);
    const wholeY1 = Math.max(sb.y1 + 4, 15);
    const isPortrait = this.h > this.w;
    const [sMinLimit] = this._scaleLimits(game, false);
    const sWhole = Math.max(
      sMinLimit,
      isPortrait
        ? this.w / Math.max(14, wholeX1 - wholeX0)
        : Math.min(this.w / Math.max(14, wholeX1 - wholeX0), this.h / (wholeY1 - MIN_WORLD_Y))
    );
    const sMaxCarnage = isPortrait
      ? Math.max(sWhole, this.w / 10.0)
      : Math.max(sWhole, this.h / 10.0);

    const sRaw = Math.min(
      this.w / Math.max(4, bx1 - bx0),
      this.h / Math.max(4, by1 - by0)
    );
    const ts = clamp(sRaw, sWhole, sMaxCarnage);

    const tcx = (bx0 + bx1) / 2;
    // Keep ground nicely anchored near bottom when bbox touches near y <= 1
    let tcy = (by0 + by1) / 2;
    const halfH = (this.h / 2) / ts;
    if (by0 <= 0.5 && tcy - halfH < MIN_WORLD_Y) {
      tcy = this._groundAlignedCy(ts, by1);
    }

    // §5 smoothing: position tau = 0.25 s, zoom tau = 0.45 s
    const kp = 1 - Math.exp(-dt / 0.25);
    const kz = 1 - Math.exp(-dt / 0.45);
    this.cx += (tcx - this.cx) * kp;
    this.cy += (tcy - this.cy) * kp;
    this.s += (ts - this.s) * kz;
  }

  _clampPose(game, pose) {
    const saved = { cx: this.cx, cy: this.cy, s: this.s };
    this.cx = pose.cx; this.cy = pose.cy; this.s = pose.s;
    this._clamp(game);
    const out = { cx: this.cx, cy: this.cy, s: this.s };
    this.cx = saved.cx; this.cy = saved.cy; this.s = saved.s;
    return out;
  }

  _clamp(game) {
    if (!game || !game.level) return;
    const lb = this._levelBounds(game);
    const [sMin, sMax] = this._scaleLimits(game, this._freeTimer > 0);
    this.s = clamp(this.s, sMin, sMax);

    const halfW = (this.w / 2) / this.s;
    const halfH = (this.h / 2) / this.s;

    const minCx = (lb.x0 - BOUNDS_PAD_X) + halfW;
    const maxCx = (lb.x1 + BOUNDS_PAD_X) - halfW;
    if (minCx <= maxCx) {
      this.cx = clamp(this.cx, minCx, maxCx);
    } else {
      this.cx = (lb.x0 + lb.x1) / 2;
    }

    // Never show below y = -2.0 m
    const minCy = MIN_WORLD_Y + halfH;
    const maxTopY = Math.max(lb.y1 + 12, MIN_WORLD_Y + halfH * 2 + 2);
    const maxCy = maxTopY - halfH;
    this.cy = minCy <= maxCy ? clamp(this.cy, minCy, maxCy) : minCy;
  }

  _updateOffscreenPigs(game) {
    if (!game || !game.world || game.state !== STATE.AIM || this._introActive) {
      this.offscreenPigs = 0;
      this.offscreenPigsHint = false;
      return;
    }
    const rightEdge = this.cx + (this.w / 2) / this.s;
    let n = 0;
    const ents = game.world.ents;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.alive && e.kind === KIND.PIG) {
        if (e.body.getPosition().x > rightEdge + 0.25) n++;
      }
    }
    this.offscreenPigs = n;
    this.offscreenPigsHint = n > 0;
  }
}
