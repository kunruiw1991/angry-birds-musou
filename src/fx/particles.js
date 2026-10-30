// Particles: debris shards, dust, feathers, smoke, sparks (owner: juice-audio).
// SKELETON by opus-director. Render-only (Math.random OK). Spec: docs/DESIGN.md §Juice.
// Registered as a renderer layer: draw(g, cam, t) in SCREEN px; update(realDt) from main.

import { bus } from '../core/bus.js';
import { EV } from '../contracts.js';

const MAX = 700;
const parts = [];
const COLORS = { wood: '#b8742a', glass: '#bff0ff', stone: '#8d9399', tnt: '#e33', pig: '#7bc043' };

function spawn(x, y, n, color, speed = 6, life = 1.0, size = 0.15) {
  for (let i = 0; i < n && parts.length < MAX; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 2, life, age: 0, color, size: size * (0.6 + Math.random()) });
  }
}

export const particles = {
  init() {
    bus.on(EV.BREAK, (p) => spawn(p.x, p.y, 8, COLORS[p.mat] || '#999'));
    bus.on(EV.PIG_POP, (p) => spawn(p.x, p.y, 12, COLORS.pig, 5, 0.8, 0.2));
  },
  update(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.age += dt; q.vy -= 12 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.age > q.life) parts.splice(i, 1);
    }
  },
  draw(g, cam) {
    for (const q of parts) {
      g.globalAlpha = Math.max(0, 1 - q.age / q.life);
      g.fillStyle = q.color;
      const s = q.size * cam.s;
      g.fillRect(cam.sx(q.x) - s / 2, cam.sy(q.y) - s / 2, s, s);
    }
    g.globalAlpha = 1;
  },
  count() { return parts.length; },
  clear() { parts.length = 0; },
};
