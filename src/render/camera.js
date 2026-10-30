// Camera (owner: render-art). Implements docs/DESIGN.md §5 + Fun Gate r1 (R1–R4):
//   - R1 Ground band: landscape ground line >= 18% from bottom AND >= HUD bottom-button height + 12 px;
//     portrait ground line at ~64% height (36% ground band). HUD bottom buttons always sit over ground.
//   - R2 AIM framing: maps [sling.x - 5, max(sling.x + 22, structure.x1 + 2)] into [0, w - 130 px]
//     when effective world height <= 24 m, else frames the sling area + exposes offscreenPigsHint.
//     Portrait fits width to [sling.x - 4, structure.x1 + 2] with ground at 64% height.
//   - R3 Fast return to AIM: on BIRD_READY whip-pans back so pouch is on-screen <= 0.3 s and
//     converged <= 0.45 s (<= 0.6 s gate).
//   - R4 CARNAGE bbox: frames active effects (origin only, never beam far-endpoints) + awake bodies +
//     live projectiles + bird within structure +- 8 m, padded 3 m; scale clamp [whole level, 10 m tall];
//     position tau = 0.25 s, zoom tau = 0.45 s.
//   - FREE: pan(dxPx, dyPx), zoomAt(px, py, factor), userActive(), auto-return 4 s after last gesture
//     or on next bird. Clamped against underground & bounds + margin.

import { STATE, KIND, EV } from '../contracts.js';
import { bus } from '../core/bus.js';

const INTRO_HOLD_S = 0.6;
const INTRO_EASE_S = 1.2;
const RETURN_DUR_S = 0.44;
const FREE_RETURN_S = 4.0;
const BOUNDS_PAD_X = 3.0;
const AIM_RIGHT_HUD_PX = 130;

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
    this._returnActive = false;
    this._returnT = 0;
    this._returnFrom = null;
    this._carnage = false;
    this._lastGame = null;
    this._cachedHudBottomPx = 0;
    this._hudCheckT = -1;

    bus.on(EV.LEVEL_START, () => {
      this._freeTimer = 0;
      this._carnage = false;
      this._returnActive = false;
    });
    bus.on(EV.BIRD_READY, () => {
      this._freeTimer = 0;
      this._carnage = false;
      if (!this._introActive) {
        this._returnActive = true;
        this._returnT = 0;
        this._returnFrom = { cx: this.cx, cy: this.cy, s: this.s };
      }
    });
    bus.on(EV.LAUNCH, () => {
      this._freeTimer = 0;
      this._introActive = false;
      this._returnActive = false;
      this._carnage = false;
    });
    bus.on(EV.ABILITY, () => {
      this._introActive = false;
      this._returnActive = false;
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
    this._hudCheckT = -1;
    if (this._lastGame && this._lastGame.level && this._lastGame.world) {
      const sb = this._structureBounds(this._lastGame);
      this._introPose = this._computeStructurePose(this._lastGame, sb);
      this._aimPose = this._computeAimPose(this._lastGame, sb);
      if (this._introActive && this._introT === 0) {
        this.cx = this._introPose.cx;
        this.cy = this._introPose.cy;
        this.s = this._introPose.s;
      } else if (this._lastGame.state === STATE.AIM && !this._introActive && !this._returnActive && this._freeTimer <= 0) {
        this.cx = this._aimPose.cx;
        this.cy = this._aimPose.cy;
        this.s = this._aimPose.s;
      }
      this._clamp(this._lastGame);
      this._updateOffscreenPigs(this._lastGame);
    }
  }

  /**
   * Rest ground-band thickness in CSS px from the bottom of the viewport (R1):
   *   - Portrait (h > w): 36% of height -> ground line at 64% height from top.
   *   - Landscape (w >= h): >= 19% of height AND >= FLIGHT HUD bottom-button height + 12 px.
   */
  groundBandPx() {
    if (this.h > this.w) {
      return Math.round(0.36 * this.h);
    }
    // Full-size FLIGHT #btn-ability clearance + 12 px margin:
    //   max-height <= 460 (844x390): bottom 10 + height 82 + 12 = 104 -> 106 px
    //   desktop/tablet (1280x800, 1024x768): bottom 16 + height 100 + 12 = 128 -> 132 px
    const cssFlightClearPx = this.h <= 460 ? 106 : 132;
    let domClearPx = this._cachedHudBottomPx;
    if (typeof document !== 'undefined') {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (this._hudCheckT < 0 || now - this._hudCheckT > 400) {
        this._hudCheckT = now;
        let maxClear = 0;
        const b1 = document.getElementById('btn-ability');
        const b2 = document.getElementById('btn-next');
        for (const el of [b1, b2]) {
          if (!el || el.hidden) continue;
          const r = el.getBoundingClientRect();
          if (r.height > 4 && r.top < this.h) {
            maxClear = Math.max(maxClear, this.h - r.top + 12);
          }
        }
        domClearPx = this._cachedHudBottomPx = Math.ceil(maxClear);
      }
    }
    const pctPx = Math.ceil(0.19 * this.h);
    return Math.min(Math.round(0.42 * this.h), Math.max(pctPx, cssFlightClearPx, domClearPx));
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
    this._returnActive = false;
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
    this._returnActive = false;
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
    this._returnActive = false;
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
    this._returnActive = false;
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
      this._returnActive = false;
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
      // AIM (including fast R3 BIRD_READY whip-pan), TITLE background, PAUSED, FAIL
      const sb = this._structureBounds(game);
      const aim = this._aimPose = this._computeAimPose(game, sb);
      if (this._returnActive && this._returnFrom) {
        this._returnT += stepDt;
        if (this._returnT >= RETURN_DUR_S) {
          this._returnActive = false;
          this.cx = aim.cx;
          this.cy = aim.cy;
          this.s = aim.s;
        } else {
          const r = clamp(this._returnT / RETURN_DUR_S, 0, 1);
          const uPos = 1 - Math.pow(1 - r, 3.8);
          const uZoom = 1 - Math.pow(1 - r, 4.6);
          const f = this._returnFrom;
          const invS0 = 1 / Math.max(1, f.s);
          const invS1 = 1 / Math.max(1, aim.s);
          this.s = 1 / (invS0 + (invS1 - invS0) * uZoom);
          this.cx = f.cx + (aim.cx - f.cx) * uPos;
          this.cy = f.cy + (aim.cy - f.cy) * uPos;
        }
      } else {
        const kp = 1 - Math.exp(-stepDt / 0.11);
        const kz = 1 - Math.exp(-stepDt / 0.13);
        this.cx += (aim.cx - this.cx) * kp;
        this.cy += (aim.cy - this.cy) * kp;
        this.s += (aim.s - this.s) * kz;
      }
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
    const isPortrait = this.h > this.w;
    const rightPadPx = isPortrait ? 0 : Math.min(AIM_RIGHT_HUD_PX, Math.round(this.w * 0.22));
    const availW = Math.max(140, this.w - rightPadPx);
    const availSkyPx = Math.max(100, this.h - this.groundBandPx());
    const maxSpanX = Math.max(20, (lb.x1 + BOUNDS_PAD_X) - (lb.x0 - BOUNDS_PAD_X));
    const maxSkyY = Math.max(14, lb.y1 + 8);
    const sMin = isPortrait
      ? this.w / maxSpanX
      : Math.min(this.w / maxSpanX, Math.max(availW / maxSpanX, availSkyPx / maxSkyY));
    // CARNAGE max zoom = 10 m tall; FREE allows closer inspection (~7.5 m tall).
    const minTall = isFree ? 7.5 : 10.0;
    const sMax = isPortrait
      ? Math.max(sMin, this.w / minTall)
      : Math.max(sMin, availSkyPx / minTall);
    return [sMin, sMax];
  }

  /** Place cy so ground (y = 0) sits exactly at `h - groundBandPx()` (R1). */
  _groundAlignedCy(s) {
    const gb = this.groundBandPx();
    return (this.h / 2 - gb) / Math.max(1, s);
  }

  _computeStructurePose(game, sb) {
    const [sMin] = this._scaleLimits(game, false);
    const isPortrait = this.h > this.w;
    const gb = this.groundBandPx();
    const topHudPx = isPortrait ? Math.min(168, this.h * 0.20) : (this.h <= 460 ? 52 : 76);
    const availSkyPx = Math.max(100, (this.h - gb) - topHudPx);
    const x0 = sb.x0 - 3.5;
    const x1 = Math.max(x0 + 14, sb.x1 + 3.5);
    const topY = Math.max(sb.y1 + 2.5, 9.5);
    let s;
    if (isPortrait) {
      s = clamp(Math.min(this.w / Math.max(14, x1 - x0), availSkyPx / topY), sMin, this.w / 11);
      const cx = (x0 + x1) / 2;
      const cy = this._groundAlignedCy(s);
      return this._clampPose(game, { cx, cy, s });
    }
    const rightPadPx = Math.min(AIM_RIGHT_HUD_PX, Math.round(this.w * 0.22));
    const availW = Math.max(160, this.w - rightPadPx);
    const sFit = Math.min(availW / (x1 - x0), availSkyPx / topY);
    s = clamp(sFit, sMin, availSkyPx / 13.5);
    const cx = (x0 + x1) / 2 + (rightPadPx / 2) / s;
    const cy = this._groundAlignedCy(s);
    return this._clampPose(game, { cx, cy, s });
  }

  _computeAimPose(game, sb) {
    const sling = game.level.sling || { x: 0, y: 0 };
    const pouch = game.pouch ? game.pouch() : { x: sling.x, y: sling.y + 2 };
    const [sMin] = this._scaleLimits(game, false);
    const isPortrait = this.h > this.w;
    const gb = this.groundBandPx();

    // Portrait (R1 + §5): fit width to [sling.x - 4, structure.x1 + 2], ground at ~64% height.
    if (isPortrait) {
      const x0 = sling.x - 4;
      const x1 = Math.max(sling.x + 18, sb.x1 + 2);
      const topHudPx = Math.min(168, this.h * 0.20);
      const availSkyPx = Math.max(120, (this.h - gb) - topHudPx);
      const topReq = Math.max(sb.y1 + 1.8, pouch.y + 2.2, 8.5);
      let s = Math.min(this.w / Math.max(12, x1 - x0), availSkyPx / topReq);
      s = Math.max(sMin, s);
      const cx = (x0 + x1) / 2;
      const cy = this._groundAlignedCy(s);
      return this._clampPose(game, { cx, cy, s });
    }

    // Landscape (R1 + R2): map [sling.x - 5, max(sling.x + 22, structure.x1 + 2)] into [0, w - 130 px].
    const rightPadPx = Math.min(AIM_RIGHT_HUD_PX, Math.round(this.w * 0.22));
    const availW = Math.max(160, this.w - rightPadPx);
    const topHudPx = this.h <= 460 ? 50 : 74;
    const availSkyPx = Math.max(100, (this.h - gb) - topHudPx);

    const x0 = sling.x - 5;
    const x1 = Math.max(sling.x + 22, sb.x1 + 2);
    const topReq = Math.max(sb.y1 + 1.8, pouch.y + 2.2, 8.5);
    const sX = availW / Math.max(12, x1 - x0);
    const sY = availSkyPx / topReq;
    const sFull = Math.min(sX, sY);
    const fitsSingleScreen = (x1 - x0) <= 38.5 && (this.h - gb) / sFull <= 26.0;

    if (fitsSingleScreen) {
      const s = Math.max(sMin, sFull);
      // Map [x0, x1] centered inside [0, w - rightPadPx]; if height-constrained, keep sling comfortable on left.
      const cxCenteredInSafe = (x0 + x1) / 2 + (rightPadPx / 2) / s;
      const halfW = (this.w / 2) / s;
      const cx = Math.min(cxCenteredInSafe, (sling.x - 4.5) + halfW);
      const cy = this._groundAlignedCy(s);
      return this._clampPose(game, { cx, cy, s });
    }

    // Wide level (> 24 m effective height): frame sling area cleanly + show offscreen pig hint.
    const s = Math.max(sMin, (this.h - gb) / 18.5);
    const halfW = (this.w / 2) / s;
    const cx = (sling.x - 5.0) + halfW;
    const cy = this._groundAlignedCy(s);
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

    const [sMin, sMax] = this._scaleLimits(game, false);
    const isPortrait = this.h > this.w;
    const gb = this.groundBandPx();
    const targetSpan = 14.5 + clamp(spd, 0, 32) * 0.30;
    const rawS = isPortrait ? this.w / (targetSpan * 0.95) : (this.h - gb) / (targetSpan * 0.85);
    const ts = clamp(rawS, sMin, sMax);
    const restCy = this._groundAlignedCy(ts);
    const tcy = Math.max(restCy, p.y + v.y * 0.25 - 1.5);

    const kp = 1 - Math.exp(-dt / 0.20);
    const kz = 1 - Math.exp(-dt / 0.32);
    this.cx += (tcx - this.cx) * kp;
    this.cy += (tcy - this.cy) * kp;
    this.s += (ts - this.s) * kz;
  }

  _updateCarnage(dt, game) {
    const w = game.world;
    const sb = this._structureBounds(game);
    const sling = game.level.sling || { x: 0, y: 0 };

    // R4: ignore beam far-endpoints and runaway bodies/projectiles beyond structure +- 8 m.
    const corrX0 = sb.x0 - 8.0;
    const corrX1 = sb.x1 + 8.0;
    const corrY0 = -1.0;
    const corrY1 = sb.y1 + 8.0;

    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    const include = (x, y, r = 0.5) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < corrX0 || x > corrX1 || y < corrY0 || y > corrY1) return;
      const rr = Math.max(0.3, Math.min(4.0, r || 0.5));
      const xLo = Math.max(corrX0 - 1.0, x - rr);
      const xHi = Math.min(corrX1 + 1.0, x + rr);
      const yLo = Math.max(corrY0, y - rr);
      const yHi = Math.min(corrY1 + 1.0, y + rr);
      if (xLo < bx0) bx0 = xLo;
      if (xHi > bx1) bx1 = xHi;
      if (yLo < by0) by0 = yLo;
      if (yHi > by1) by1 = yHi;
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
      // R4: never include beam/ray far-endpoints (ef.x2, ef.y2); skip pure beam lines.
      if (ef.type === 'beam' || (ef.x2 != null && ef.y2 != null)) continue;
      if (ef.x != null && ef.y != null) {
        const er = Math.min(4.0, ef.r || 1.2);
        include(ef.x, ef.y, er);
      }
    }

    if (!Number.isFinite(bx0)) {
      // Fallback if ability fired in mid-air before entering [sb.x0 - 8, sb.x1 + 8] or after debris settled
      if (game.bird && game.bird.alive) {
        const p = game.bird.body.getPosition();
        bx0 = clamp(p.x - 3, sling.x - 4, corrX1);
        bx1 = Math.max(bx0 + 10, Math.min(sb.x1, sb.x0 + 8));
        by0 = 0;
        by1 = clamp(Math.max(p.y + 2, sb.y1 + 2), 6, corrY1);
      } else {
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
    }

    // Pad bbox by 3 m per §5
    bx0 -= 3.0;
    bx1 += 3.0;
    by0 = Math.max(0, by0 - 3.0);
    by1 += 3.0;

    // Scale clamp: [whole level, 10 m tall above ground]
    const gb = this.groundBandPx();
    const availSkyPx = Math.max(100, this.h - gb);
    const wholeX0 = Math.min(sling.x - 5, sb.x0 - 3);
    const wholeX1 = Math.max(sb.x1 + 3, sling.x + 22);
    const wholeSkyY = Math.max(sb.y1 + 4, 13);
    const isPortrait = this.h > this.w;
    const [sMinLimit] = this._scaleLimits(game, false);
    const sWhole = Math.max(
      sMinLimit,
      isPortrait
        ? this.w / Math.max(14, wholeX1 - wholeX0)
        : Math.min(this.w / Math.max(14, wholeX1 - wholeX0), availSkyPx / wholeSkyY)
    );
    const sMaxCarnage = isPortrait
      ? Math.max(sWhole, this.w / 10.0)
      : Math.max(sWhole, availSkyPx / 10.0);

    const sRaw = Math.min(
      this.w / Math.max(4, bx1 - bx0),
      availSkyPx / Math.max(4, by1 - by0)
    );
    const ts = clamp(sRaw, sWhole, sMaxCarnage);

    const tcx = (bx0 + bx1) / 2;
    // Anchor thick ground band steadily unless action genuinely rises above availSkyPx / ts
    const restCy = this._groundAlignedCy(ts);
    const minCyForTop = by1 - (this.h / 2) / ts;
    const tcy = Math.max(restCy, minCyForTop);

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
    const rightHudM = this.h > this.w ? 0 : (AIM_RIGHT_HUD_PX / this.s);

    const minCx = (lb.x0 - BOUNDS_PAD_X) + halfW;
    const maxCx = (lb.x1 + BOUNDS_PAD_X + rightHudM) - halfW;
    if (minCx <= maxCx) {
      this.cx = clamp(this.cx, minCx, maxCx);
    } else {
      this.cx = (lb.x0 + lb.x1) / 2;
    }

    // Never pan deeper underground than the rest ground band (and >= 2 m world floor)
    const maxGroundM = Math.max(2.0, this.groundBandPx() / this.s);
    const minCy = -maxGroundM + halfH;
    const maxTopY = Math.max(lb.y1 + 12, -maxGroundM + halfH * 2 + 2);
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
