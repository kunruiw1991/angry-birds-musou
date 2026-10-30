// Input: slingshot drag/aim, trajectory preview, tap/hold ability, free-look pan/pinch/wheel,
// and keyboard shortcuts (owner: levels-hud). Spec: docs/DESIGN.md §6.

import { PHYS, SLING, STATE } from '../contracts.js';
import { uiBridge } from './ui_state.js';

export class Input {
  constructor(canvas, game, cam, audio) {
    this.canvas = canvas;
    this.game = game;
    this.cam = cam;
    this.audio = audio;

    this.pull = null;          // {x,y} world offset of the bird from the pouch while aiming
    this.preview = [];         // shrinking trajectory dots (~0.9 s) for the renderer
    this.dragging = false;     // active slingshot pull gesture
    this._aimPointerId = null;
    this._aimStartPx = 0;
    this._aimStartPy = 0;
    this._lastStretchStep = 0;

    this.panning = false;      // single-pointer free-look camera pan
    this._panPointerId = null;
    this._lastPanPx = 0;
    this._lastPanPy = 0;

    this._steeringId = null;   // pointer holding to steer 白公主 (game.pointer)
    this.pointers = new Map(); // pointerId -> { px, py } for 2-finger pinch zoom
    this._pinchDist = 0;
    this._pinchMid = null;

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.cancel(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.key(e));
  }

  _canvasPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      px: e.clientX - r.left,
      py: e.clientY - r.top,
      w: Math.max(1, r.width || this.cam.w || 800),
      h: Math.max(1, r.height || this.cam.h || 600),
    };
  }

  world(e) {
    const { px, py } = this._canvasPos(e);
    return this.cam.toWorld(px, py);
  }

  down(e) {
    if (e.button != null && e.button !== 0) return;
    this.audio && this.audio.unlock();
    if (!uiBridge.isPlayInteractive()) return;

    const g = this.game;
    const { px, py, w } = this._canvasPos(e);
    this.pointers.set(e.pointerId, { px, py });
    this.canvas.setPointerCapture?.(e.pointerId);

    // Two-finger pinch zoom overrides single-finger aim/pan
    if (this.pointers.size >= 2) {
      if (this.dragging) this._resetAim();
      this.panning = false;
      this._panPointerId = null;
      this._initPinch();
      return;
    }

    // Any tap during intro pan skips straight to AIM framing (§5)
    if (this.cam.introActive && this.cam.introActive()) {
      this.cam.skipIntro?.(g);
    }

    const p = this.cam.toWorld(px, py);

    if (g.state === STATE.AIM || g.state === STATE.INTRO) {
      const pouch = g.pouch();
      const pouchPx = this.cam.sx(pouch.x);
      const pouchPy = this.cam.sy(pouch.y);
      const pxDist = Math.hypot(px - pouchPx, py - pouchPy);
      const worldDist = Math.hypot(p.x - pouch.x, p.y - pouch.y);
      const nearPouch = pxDist <= 70 || worldDist <= 1.6;
      const inLeftZone = px <= w * 0.35;

      if (nearPouch || inLeftZone) {
        this.dragging = true;
        this._aimPointerId = e.pointerId;
        this._aimStartPx = px;
        this._aimStartPy = py;
        this._lastStretchStep = 0;
        this.pull = { x: 0, y: 0 };
        this.preview = [];
      } else {
        // Right 65% of screen in AIM = camera pan (§6)
        this.panning = true;
        this._panPointerId = e.pointerId;
        this._lastPanPx = px;
        this._lastPanPy = py;
      }
      return;
    }

    if (g.state === STATE.FLIGHT) {
      g.pointer.x = p.x;
      g.pointer.y = p.y;
      g.pointer.down = true;
      this._steeringId = e.pointerId;

      if (!g.abilityUsed) {
        g.useAbility(p);
      } else {
        // After ability: keep steering Matilda during her 4s shooting window, else free-look pan
        const isMatildaShooting =
          g.bird && g.bird.alive && g.bird.data.birdId === 'matilda' &&
          g.abilityT != null && (g.world.time - g.abilityT) < 4.05;
        if (!isMatildaShooting) {
          this.panning = true;
          this._panPointerId = e.pointerId;
          this._lastPanPx = px;
          this._lastPanPy = py;
        }
      }
      return;
    }

    if (g.state === STATE.SETTLE) {
      this.panning = true;
      this._panPointerId = e.pointerId;
      this._lastPanPx = px;
      this._lastPanPy = py;
    }
  }

  move(e) {
    const { px, py } = this._canvasPos(e);
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { px, py });
    }

    if (this.game.pointer.down && (this._steeringId == null || e.pointerId === this._steeringId)) {
      const q = this.cam.toWorld(px, py);
      this.game.pointer.x = q.x;
      this.game.pointer.y = q.y;
    }

    // 2-finger pinch zoom + pan
    if (this.pointers.size >= 2) {
      const pts = [...this.pointers.values()];
      const d = Math.hypot(pts[1].px - pts[0].px, pts[1].py - pts[0].py);
      const mid = { px: (pts[0].px + pts[1].px) / 2, py: (pts[0].py + pts[1].py) / 2 };
      if (this._pinchDist > 8 && d > 8) {
        const factor = d / this._pinchDist;
        if (Math.abs(factor - 1) > 0.002) {
          this.cam.zoomAt?.(mid.px, mid.py, factor);
        }
      }
      if (this._pinchMid) {
        const dx = mid.px - this._pinchMid.px;
        const dy = mid.py - this._pinchMid.py;
        if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
          this.cam.pan?.(dx, dy);
        }
      }
      this._pinchDist = d;
      this._pinchMid = mid;
      return;
    }

    // Slingshot relative drag aiming
    if (this.dragging && (this._aimPointerId == null || e.pointerId === this._aimPointerId)) {
      const g = this.game;
      if (g.state !== STATE.AIM) {
        this._resetAim();
        return;
      }
      const s = Math.max(1, this.cam.s || 30);
      let dx = (px - this._aimStartPx) / s;
      let dy = -(py - this._aimStartPy) / s;
      const d = Math.hypot(dx, dy);
      if (d > SLING.MAX_PULL) {
        dx *= SLING.MAX_PULL / d;
        dy *= SLING.MAX_PULL / d;
      }
      this.pull = { x: dx, y: dy };
      const { angle, power } = this.aim();
      const step = Math.floor(power * 5);
      if (step > this._lastStretchStep && power >= SLING.MIN_POWER) {
        this._lastStretchStep = step;
        this.audio?.play?.('stretch', { pitch: 0.85 + power * 0.45, vol: 0.35 });
      }
      const pouch = g.pouch();
      this.preview = power >= SLING.MIN_POWER ? trajectory(pouch, angle, power, 20, 0.045) : [];
      return;
    }

    // Single-pointer camera pan
    if (this.panning && (this._panPointerId == null || e.pointerId === this._panPointerId)) {
      const dxPx = px - this._lastPanPx;
      const dyPx = py - this._lastPanPy;
      this._lastPanPx = px;
      this._lastPanPy = py;
      if (Math.abs(dxPx) > 0.2 || Math.abs(dyPx) > 0.2) {
        this.cam.pan?.(dxPx, dyPx);
      }
    }
  }

  aim() {
    const { x, y } = this.pull || { x: 0, y: 0 };
    const d = Math.hypot(x, y);
    return {
      angle: Math.atan2(-y, -x) * 180 / Math.PI,
      power: Math.min(1, d / SLING.MAX_PULL),
    };
  }

  up(e) {
    if (e && e.pointerId != null) {
      this.pointers.delete(e.pointerId);
      if (e.pointerId === this._steeringId) {
        this.game.pointer.down = false;
        this._steeringId = null;
      }
      if (e.pointerId === this._panPointerId) {
        this.panning = false;
        this._panPointerId = null;
      }
    } else {
      this.pointers.clear();
      this.game.pointer.down = false;
      this._steeringId = null;
      this.panning = false;
      this._panPointerId = null;
    }

    if (this.pointers.size < 2) {
      this._pinchDist = 0;
      this._pinchMid = null;
    }

    if (!this.dragging) return;
    if (e && this._aimPointerId != null && e.pointerId !== this._aimPointerId) return;

    const { angle, power } = this.aim();
    this._resetAim();
    if (this.game.state === STATE.AIM && power >= SLING.MIN_POWER) {
      this.game.launch(angle, power);
    }
  }

  cancel(e) {
    if (e && e.pointerId != null) this.pointers.delete(e.pointerId);
    else this.pointers.clear();
    this.game.pointer.down = false;
    this._steeringId = null;
    this.panning = false;
    this._panPointerId = null;
    this._pinchDist = 0;
    this._pinchMid = null;
    this._resetAim();
  }

  _resetAim() {
    this.dragging = false;
    this._aimPointerId = null;
    this.pull = null;
    this.preview = [];
  }

  _initPinch() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    this._pinchDist = Math.hypot(pts[1].px - pts[0].px, pts[1].py - pts[0].py);
    this._pinchMid = { px: (pts[0].px + pts[1].px) / 2, py: (pts[0].py + pts[1].py) / 2 };
  }

  wheel(e) {
    if (!uiBridge.isPlayInteractive()) return;
    e.preventDefault();
    this.audio && this.audio.unlock();
    const { px, py } = this._canvasPos(e);
    const clamped = Math.max(-140, Math.min(140, e.deltaY));
    const factor = Math.exp(-clamped * 0.0018);
    this.cam.zoomAt?.(px, py, factor);
  }

  key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    this.audio && this.audio.unlock();
    if (uiBridge.handleKey(e)) {
      e.preventDefault();
    }
  }
}

/**
 * Ballistic preview matching Game.launch (first ~0.9 s = 20 * 0.045 s, shrinking dot radii).
 */
export function trajectory(pouch, angleDeg, power, n = 20, dtStep = 0.045, g = PHYS.GRAVITY) {
  const a = angleDeg * Math.PI / 180;
  const v = power * SLING.MAX_SPEED;
  const pull = power * SLING.MAX_PULL;
  const x0 = pouch.x - Math.cos(a) * pull;
  const y0 = Math.max(pouch.y - Math.sin(a) * pull, 0.6);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i * dtStep;
    const k = i / n;
    out.push({
      x: x0 + Math.cos(a) * v * t,
      y: y0 + Math.sin(a) * v * t - 0.5 * g * t * t,
      k,
      r: +(4.6 - 3.0 * k).toFixed(2),
    });
  }
  return out;
}
