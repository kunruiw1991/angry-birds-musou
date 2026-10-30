// Floating damage numbers / score popups / combo text (owner: juice-audio).
// SKELETON by opus-director. Render-only. Spec: docs/DESIGN.md §Juice (popup colors/sizes/caps).

import { bus } from '../core/bus.js';
import { EV } from '../contracts.js';

const MAX = 70;
const pops = [];

function add(x, y, text, color, size) {
  if (pops.length >= MAX) pops.shift();
  pops.push({ x, y, text, color, size, age: 0, life: 0.9 });
}

export const popups = {
  init() {
    bus.on(EV.DAMAGE, (p) => { if (p.amount >= 5) add(p.x, p.y, String(p.amount), p.amount >= 500 ? '#ff3030' : p.amount >= 200 ? '#ff9a1a' : p.amount >= 50 ? '#ffe14a' : '#ffffff', p.amount >= 200 ? 30 : 20); });
    bus.on(EV.SCORE, (p) => { if (p.reason === 'pig') add(p.x, p.y + 0.8, '+' + p.delta, '#7CFC00', 28); });
  },
  update(dt) {
    for (let i = pops.length - 1; i >= 0; i--) { const q = pops[i]; q.age += dt; if (q.age > q.life) pops.splice(i, 1); }
  },
  draw(g, cam) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const q of pops) {
      const k = q.age / q.life;
      g.globalAlpha = Math.max(0, 1 - k * k);
      g.font = `900 ${q.size}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
      g.lineWidth = 4; g.strokeStyle = '#000';
      const x = cam.sx(q.x), y = cam.sy(q.y) - 40 * k;
      g.strokeText(q.text, x, y); g.fillStyle = q.color; g.fillText(q.text, x, y);
    }
    g.globalAlpha = 1;
  },
  count() { return pops.length; },
  clear() { pops.length = 0; },
};
