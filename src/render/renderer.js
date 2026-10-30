// Renderer (owner: render-art). SKELETON by opus-director: flat shapes. Replace with the art spec
// in docs/DESIGN.md §Art (biome backgrounds, sprite cache, block/pig/slingshot art).
// Draw order: sky -> far parallax -> terrain/ground -> sling back -> ents -> sling front ->
//   effects -> particles -> popups -> trajectory preview.  Sprites draw in a LOCAL y-down meter
//   frame; effects draw in SCREEN px via cam.sx/sy/s (see src/birds/index.js header).

import { KIND, STATE, SLING } from '../contracts.js';
import { BIRDS, PROJ_SKINS, BIRD_EFFECTS } from '../birds/index.js';

const SKY = { grass: ['#4fa8e8', '#bfe6ff'], desert: ['#f3d98c', '#fbefc8'], city: ['#0b1030', '#2a2a5a'] };
const MAT_COLOR = { wood: '#c8822a', glass: '#9fe3ffcc', stone: '#9aa0a6', tnt: '#d33', terrain: '#5b3b22' };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.dpr = 1;
    this.fx = [];            // objects with draw(g, cam, t) called after effects (particles, popups)
  }
  resize(w, h) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
  }
  addLayer(obj) { this.fx.push(obj); }

  draw(game, cam, input) {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const biome = game.level ? game.level.biome : 'grass';
    const [c0, c1] = SKY[biome] || SKY.grass;
    const grad = g.createLinearGradient(0, 0, 0, cam.h);
    grad.addColorStop(0, c0); grad.addColorStop(1, c1);
    g.fillStyle = grad; g.fillRect(0, 0, cam.w, cam.h);
    if (!game.world) return;
    const w = game.world, t = w.time;

    // ground band
    g.fillStyle = '#3b7d2a'; g.fillRect(0, cam.sy(0), cam.w, Math.max(0, cam.h - cam.sy(0)));
    g.fillStyle = '#2c3e8f'; g.fillRect(0, cam.sy(-0.4), cam.w, Math.max(0, cam.h - cam.sy(-0.4)));

    // slingshot (back)
    const s = game.level.sling, pouch = game.pouch();
    g.strokeStyle = '#6b3f1d'; g.lineWidth = 0.22 * cam.s; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cam.sx(s.x), cam.sy(s.y)); g.lineTo(cam.sx(s.x), cam.sy(s.y + 1.2));
    g.lineTo(cam.sx(s.x - 0.35), cam.sy(pouch.y)); g.moveTo(cam.sx(s.x), cam.sy(s.y + 1.2)); g.lineTo(cam.sx(s.x + 0.35), cam.sy(pouch.y)); g.stroke();

    // ents
    for (const e of w.ents) {
      if (e.kind === KIND.GROUND) continue;
      const p = e.body.getPosition(), a = e.body.getAngle();
      g.save();
      g.translate(cam.sx(p.x), cam.sy(p.y));
      g.rotate(-a);
      g.scale(cam.s, cam.s);
      this.drawEnt(g, e, t);
      g.restore();
    }

    // bird waiting on the sling + queue
    if (game.state === STATE.AIM && game.currentBirdId) {
      const def = BIRDS[game.currentBirdId];
      const pull = input && input.pull ? input.pull : { x: 0, y: 0 };
      this.drawBirdAt(g, cam, def, pouch.x + pull.x, pouch.y + pull.y, t);
      g.strokeStyle = '#3a1f0e'; g.lineWidth = 0.12 * cam.s;
      g.beginPath(); g.moveTo(cam.sx(s.x - 0.35), cam.sy(pouch.y)); g.lineTo(cam.sx(pouch.x + pull.x), cam.sy(pouch.y + pull.y));
      g.lineTo(cam.sx(s.x + 0.35), cam.sy(pouch.y)); g.stroke();
    }
    if (game.queue) {
      let qx = s.x - 1.6;
      for (let i = game.birdIndex + (game.state === STATE.AIM ? 1 : 0); i < game.queue.length; i++) {
        const def = BIRDS[game.queue[i]];
        this.drawBirdAt(g, cam, def, qx, s.y + (def.radius ?? 0.45), t);
        qx -= (def.radius ?? 0.45) * 2 + 0.3;
      }
    }

    // effects
    for (const e of w.effects) {
      const fn = BIRD_EFFECTS[e.type] || GENERIC_EFFECTS[e.type];
      if (fn) { g.save(); try { fn(g, e, t, cam); } catch (err) { console.error('[effect]', e.type, err); } g.restore(); }
    }
    for (const layer of this.fx) { g.save(); try { layer.draw(g, cam, t); } catch (err) { console.error('[layer]', err); } g.restore(); }

    // trajectory preview
    if (input && input.preview && input.preview.length) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (const q of input.preview) { g.beginPath(); g.arc(cam.sx(q.x), cam.sy(q.y), 3, 0, Math.PI * 2); g.fill(); }
    }
  }

  drawBirdAt(g, cam, def, x, y, t) {
    g.save(); g.translate(cam.sx(x), cam.sy(y)); g.scale(cam.s, cam.s);
    def.drawBird(g, { r: def.radius ?? 0.45, data: {}, status: {}, skin: def.id }, t);
    g.restore();
  }

  drawEnt(g, e, t) {
    if (e.kind === KIND.BIRD) { const def = BIRDS[e.skin]; if (def) return def.drawBird(g, e, t); }
    if (e.kind === KIND.PROJ) {
      const fn = PROJ_SKINS[e.skin];
      if (fn) return fn(g, e, t);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, e.r || 0.2, 0, Math.PI * 2); g.fill(); return;
    }
    if (e.kind === KIND.PIG) {
      g.fillStyle = '#7bc043'; g.strokeStyle = '#2d5a17'; g.lineWidth = e.r * 0.1;
      g.beginPath(); g.arc(0, 0, e.r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#a5d86e'; g.beginPath(); g.ellipse(0, e.r * 0.1, e.r * 0.35, e.r * 0.25, 0, 0, Math.PI * 2); g.fill();
      return;
    }
    g.fillStyle = MAT_COLOR[e.mat] || '#888'; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.04;
    if (e.shape === 'circle') { g.beginPath(); g.arc(0, 0, e.r, 0, Math.PI * 2); g.fill(); g.stroke(); }
    else if (e.shape === 'poly') { g.beginPath(); e.verts.forEach((v, i) => (i ? g.lineTo(v.x, -v.y) : g.moveTo(v.x, -v.y))); g.closePath(); g.fill(); g.stroke(); }
    else { g.fillRect(-e.w / 2, -e.h / 2, e.w, e.h); g.strokeRect(-e.w / 2, -e.h / 2, e.w, e.h); }
  }
}

// Generic effects (render-art replaces with the video-style versions).
export const GENERIC_EFFECTS = {
  explosion(g, e, t, cam) {
    const k = (t - e.t0) / e.ttl;
    g.globalAlpha = Math.max(0, 1 - k);
    g.fillStyle = k < 0.25 ? '#fff2a0' : '#ff7a1a';
    g.beginPath(); g.arc(cam.sx(e.x), cam.sy(e.y), e.r * cam.s * (0.4 + 0.8 * k), 0, Math.PI * 2); g.fill();
  },
  shockwave(g, e, t, cam) {
    const k = (t - e.t0) / e.ttl;
    g.globalAlpha = Math.max(0, 1 - k); g.strokeStyle = e.color || '#fff'; g.lineWidth = 6;
    g.beginPath(); g.arc(cam.sx(e.x), cam.sy(e.y), e.r * cam.s * k, 0, Math.PI * 2); g.stroke();
  },
  flashring(g, e, t, cam) { GENERIC_EFFECTS.shockwave(g, e, t, cam); },
  beam(g, e, t, cam) {
    const k = (t - e.t0) / e.ttl;
    g.globalAlpha = Math.max(0, 1 - k); g.strokeStyle = e.color || '#ff0'; g.lineWidth = (e.width || 0.3) * cam.s;
    g.beginPath(); g.moveTo(cam.sx(e.x), cam.sy(e.y)); g.lineTo(cam.sx(e.x2), cam.sy(e.y2)); g.stroke();
  },
  text(g, e, t, cam) {
    g.fillStyle = e.color || '#fff'; g.font = `bold ${e.size || 24}px sans-serif`; g.textAlign = 'center';
    g.fillText(e.text, cam.sx(e.x), cam.sy(e.y));
  },
};
