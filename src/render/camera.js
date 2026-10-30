// Camera (owner: render-art). SKELETON by opus-director: fit + follow. Replace with the spec in
// docs/DESIGN.md §Camera (intro pan, follow lookahead, carnage framing, pinch/drag free look).
// World meters (y up) -> screen CSS px (y down).

import { STATE, KIND } from '../contracts.js';

export class Camera {
  constructor() {
    this.cx = 15; this.cy = 8;   // world point at screen center
    this.s = 30;                 // CSS px per meter
    this.w = 800; this.h = 600;  // viewport CSS px
    this.shakeX = 0; this.shakeY = 0; this.rot = 0;
  }
  resize(w, h) { this.w = w; this.h = h; }
  sx(x) { return (x - this.cx) * this.s + this.w / 2 + this.shakeX; }
  sy(y) { return (this.cy - y) * this.s + this.h / 2 + this.shakeY; }
  toWorld(px, py) { return { x: (px - this.w / 2 - this.shakeX) / this.s + this.cx, y: this.cy - (py - this.h / 2 - this.shakeY) / this.s }; }
  /** Visible world rect. */
  view() { const a = this.toWorld(0, this.h), b = this.toWorld(this.w, 0); return { x0: a.x, y0: a.y, x1: b.x, y1: b.y }; }

  /** Frame a world rect (x0..x1, y0..y1) into the viewport. */
  fit(x0, x1, y0, y1, k = 1) {
    const s = Math.min(this.w / Math.max(1, x1 - x0), this.h / Math.max(1, y1 - y0));
    const tcx = (x0 + x1) / 2, tcy = (y0 + y1) / 2;
    this.s += (s - this.s) * k; this.cx += (tcx - this.cx) * k; this.cy += (tcy - this.cy) * k;
  }

  update(dt, game) {
    if (!game.world || !game.level) return;
    const L = game.level, sb = game.structureBounds;
    const k = 1 - Math.exp(-dt * 3);
    const pouch = game.pouch();
    if (game.state === STATE.FLIGHT && game.bird && game.bird.alive) {
      const p = game.bird.body.getPosition();
      const x0 = Math.min(pouch.x - 3, p.x - 8), x1 = Math.max(sb.x1 + 3, p.x + 8);
      this.fit(x0, x1, -1, Math.max(sb.y1 + 4, p.y + 4, 12), k);
    } else {
      this.fit(pouch.x - 5, sb.x1 + 3, -1, Math.max(sb.y1 + 4, 12), k);
    }
  }
}
