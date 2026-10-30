// Input: slingshot drag/aim, tap-to-ability, free-look gestures (owner: levels-hud).
// SKELETON by opus-director: press near the pouch, drag back, release to launch; tap during
// flight = ability at the tapped world point. Spec: docs/DESIGN.md §Input.

import { SLING, STATE } from '../contracts.js';

export class Input {
  constructor(canvas, game, cam, audio) {
    this.canvas = canvas; this.game = game; this.cam = cam; this.audio = audio;
    this.pull = null;      // {x,y} world offset of the bird from the pouch while aiming
    this.preview = [];     // trajectory dots (world points) for the renderer
    this.dragging = false;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', () => this.cancel());
  }

  world(e) { const r = this.canvas.getBoundingClientRect(); return this.cam.toWorld(e.clientX - r.left, e.clientY - r.top); }

  down(e) {
    this.audio && this.audio.unlock();
    const g = this.game;
    const p = this.world(e);
    if (g.state === STATE.AIM) {
      const pouch = g.pouch();
      const hitR = Math.max(1.6, 60 / this.cam.s);  // >= 60 px screen radius around the pouch
      if (Math.hypot(p.x - pouch.x, p.y - pouch.y) <= hitR) { this.dragging = true; this.canvas.setPointerCapture?.(e.pointerId); this.move(e); }
    } else if (g.state === STATE.FLIGHT) {
      g.pointer.x = p.x; g.pointer.y = p.y; g.pointer.down = true;
      if (!g.abilityUsed) g.useAbility(p);
    }
  }

  move(e) {
    if (this.game.pointer.down) { const q = this.world(e); this.game.pointer.x = q.x; this.game.pointer.y = q.y; }
    if (!this.dragging) return;
    const g = this.game, pouch = g.pouch(), p = this.world(e);
    let dx = p.x - pouch.x, dy = p.y - pouch.y;
    const d = Math.hypot(dx, dy);
    if (d > SLING.MAX_PULL) { dx *= SLING.MAX_PULL / d; dy *= SLING.MAX_PULL / d; }
    this.pull = { x: dx, y: dy };
    const { angle, power } = this.aim();
    this.preview = power >= SLING.MIN_POWER ? trajectory(pouch, angle, power, 40, 0.045) : [];
  }

  aim() {
    const { x, y } = this.pull || { x: 0, y: 0 };
    const d = Math.hypot(x, y);
    return { angle: Math.atan2(-y, -x) * 180 / Math.PI, power: Math.min(1, d / SLING.MAX_PULL) };
  }

  up() {
    this.game.pointer.down = false;
    if (!this.dragging) return;
    this.dragging = false;
    const { angle, power } = this.aim();
    this.pull = null; this.preview = [];
    this.game.launch(angle, power);
  }

  cancel() { this.dragging = false; this.pull = null; this.preview = []; }
}

/** Ballistic preview matching the sim (no drag): returns world points. */
export function trajectory(pouch, angleDeg, power, n = 40, dtStep = 0.05, g = 10) {
  const a = angleDeg * Math.PI / 180, v = power * SLING.MAX_SPEED;
  const pull = power * SLING.MAX_PULL;
  const x0 = pouch.x - Math.cos(a) * pull, y0 = pouch.y - Math.sin(a) * pull;
  const out = [];
  for (let i = 1; i <= n; i++) { const t = i * dtStep; out.push({ x: x0 + Math.cos(a) * v * t, y: y0 + Math.sin(a) * v * t - 0.5 * g * t * t }); }
  return out;
}
