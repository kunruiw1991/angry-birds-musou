// Main Canvas 2D Renderer (owner: render-art). Spec: docs/DESIGN.md §8 & §11.
// Draw order:
//   sky/celestial -> cached parallax -> ground band -> static terrain -> bird queue ->
//   slingshot back -> dynamic ents (culled + offscreen sprite cache) -> poison bubbles ->
//   waiting bird -> slingshot front -> trajectory preview -> effects -> fx layers -> pig hint.
//
// Keeps exact Renderer API used by src/main.js:
//   new Renderer(canvas), .resize(w, h), .addLayer(obj), .draw(game, cam, input), .g, .dpr.

import { KIND, STATE } from '../contracts.js';
import { BIRDS, PROJ_SKINS, BIRD_EFFECTS } from '../birds/index.js';
import { drawBackground, drawTerrainEnt } from './backgrounds.js';
import {
  getBlockSprite,
  getPigSprite,
  drawPigBalloon,
  drawPigPupils,
  drawStatusOverlay,
  drawPoisonBubbles,
  drawSlingshotBack,
  drawSlingshotFront,
} from './sprites.js';
import { GENERIC_EFFECTS } from './effects.js';

export { GENERIC_EFFECTS };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this._w = 1280;
    this._h = 800;
    this._dprCap = 2.0;          // adapts down to 1.25 if frame p95 > 22 ms for 2 s
    this.dpr = 1;
    this.fx = [];                // layers with draw(g, cam, t): particles, popups

    this._drawRing = new Float32Array(120);
    this._drawIdx = 0;
    this._drawCount = 0;
    this._highP95Since = 0;
    this._lastAdaptCheck = 0;
    this.culledCount = 0;
    this.drawnCount = 0;
  }

  resize(w, h) {
    this._w = Math.max(1, w || 800);
    this._h = Math.max(1, h || 600);
    const rawDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.dpr = Math.min(this._dprCap, rawDpr);
    const cw = Math.round(this._w * this.dpr);
    const ch = Math.round(this._h * this.dpr);
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;
    this.canvas.style.width = this._w + 'px';
    this.canvas.style.height = this._h + 'px';
  }

  addLayer(obj) {
    this.fx.push(obj);
  }

  _checkAdaptiveDpr(now, elapsedMs) {
    this._drawRing[this._drawIdx] = elapsedMs;
    this._drawIdx = (this._drawIdx + 1) % this._drawRing.length;
    if (this._drawCount < this._drawRing.length) this._drawCount++;

    if (this._dprCap <= 1.25 || this.dpr <= 1.25) return;
    if (now - this._lastAdaptCheck < 500) return;
    const dtSec = this._lastAdaptCheck > 0 ? Math.min(1, (now - this._lastAdaptCheck) / 1000) : 0.5;
    this._lastAdaptCheck = now;

    let p95 = 0;
    const app = typeof window !== 'undefined' ? window.__APP__ : null;
    if (app && typeof app.perfStats === 'function') {
      p95 = app.perfStats().frameP95 || 0;
    } else if (this._drawCount >= 30) {
      const arr = Array.from(this._drawRing.subarray(0, this._drawCount)).sort((a, b) => a - b);
      p95 = arr[Math.floor(arr.length * 0.95)] || 0;
    }

    if (p95 > 22.0) {
      this._highP95Since += dtSec;
      if (this._highP95Since >= 2.0) {
        this._dprCap = 1.25;
        this.resize(this._w, this._h);
      }
    } else {
      this._highP95Since = Math.max(0, this._highP95Since - dtSec * 0.5);
    }
  }

  draw(game, cam, input) {
    const tStart = typeof performance !== 'undefined' ? performance.now() : 0;
    const g = this.g;
    const dpr = this.dpr;

    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const biome = (game && game.level && game.level.biome) || 'grass';
    const w = game ? game.world : null;
    const t = w ? w.time : 0;

    // 1. Sky + celestial + cached parallax + ground band
    drawBackground(g, cam, biome, t);
    if (!w || !game.level) return;

    // Optional subtle trauma camera tilt around screen center
    const rawRot = cam.rot || 0;
    const camRot = Math.abs(rawRot) > 0.2 ? (rawRot * Math.PI) / 180 : rawRot;
    const applyBaseTransform = () => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (Math.abs(camRot) > 1e-4) {
        g.translate(cam.w * 0.5, cam.h * 0.5);
        g.rotate(camRot);
        g.translate(-cam.w * 0.5, -cam.h * 0.5);
      }
    };
    applyBaseTransform();

    const view = cam.view();
    const cullX0 = view.x0 - 1.8, cullX1 = view.x1 + 1.8;
    const cullY0 = view.y0 - 2.2, cullY1 = view.y1 + 2.8;
    const pxPerM = cam.s * dpr;

    const sling = game.level.sling || { x: 0, y: 0 };
    const pouch = game.pouch();
    const isAiming = game.state === STATE.AIM && !!game.currentBirdId;
    const pull = isAiming && input && input.pull ? input.pull : null;

    // Determine world point that pig eyes track
    let pigLook = { x: pouch.x + (pull ? pull.x : 0), y: pouch.y + (pull ? pull.y : 0) };
    if (game.state === STATE.FLIGHT) {
      if (game.bird && game.bird.alive) {
        const bp = game.bird.body.getPosition();
        pigLook = { x: bp.x, y: bp.y };
      } else {
        for (let i = 0; i < w.ents.length; i++) {
          const e = w.ents[i];
          if (e.alive && e.kind === KIND.PROJ) {
            const pp = e.body.getPosition();
            pigLook = { x: pp.x, y: pp.y };
            break;
          }
        }
      }
    }

    // 2. Static terrain (mesas / dirt walls)
    const terrains = [];
    for (let i = 0; i < w.ents.length; i++) {
      const e = w.ents[i];
      if (!e.alive || e.kind !== KIND.TERRAIN) continue;
      terrains.push(e);
      const p = e.body.getPosition();
      const ext = e.shape === 'poly' ? 12 : Math.hypot(e.w || 2, e.h || 2) * 0.55;
      if (p.x + ext < cullX0 || p.x - ext > cullX1 || p.y + ext < cullY0 || p.y - ext > cullY1) continue;
      const a = e.body.getAngle();
      g.save();
      g.translate(cam.sx(p.x), cam.sy(p.y));
      if (a) g.rotate(-a);
      g.scale(cam.s, cam.s);
      drawTerrainEnt(g, e, biome);
      g.restore();
    }

    // 3. Bird queue behind the slingshot (sits cleanly on mesa or ground under qx)
    if (game.queue && game.queue.length) {
      let qx = sling.x - 1.35;
      const startIdx = game.birdIndex + (game.state === STATE.AIM ? 1 : 0);
      for (let i = startIdx; i < game.queue.length; i++) {
        const def = BIRDS[game.queue[i]];
        if (!def) continue;
        const r = def.radius ?? 0.45;
        if (qx - r > cullX0 && qx + r < cullX1) {
          const surfaceY = findSurfaceY(qx, sling.y, terrains);
          const hop = i === startIdx ? Math.abs(Math.sin(t * 2.8)) * 0.06 : 0;
          this._drawBirdAt(g, cam, def, qx, surfaceY + r + hop, 0, t);
        }
        qx -= r * 2 + 0.26;
      }
    }

    // 4. Slingshot back prong + back rubber band
    drawSlingshotBack(g, cam, sling, pouch, pull);

    // 5. Dynamic entities (blocks, pigs, active bird, projectiles) with frustum culling + sprite cache
    let culled = 0, drawn = 0;
    const poisonedList = [];

    for (let i = 0; i < w.ents.length; i++) {
      const e = w.ents[i];
      if (!e.alive || e.kind === KIND.GROUND || e.kind === KIND.TERRAIN) continue;

      const p = e.body.getPosition();
      const hasBalloon = !!(e.status && e.status.balloon);
      const ext = (e.r || Math.max(e.w || 0.5, e.h || 0.5) * 0.72) + (hasBalloon ? 2.4 : 0.25);

      if (p.x + ext < cullX0 || p.x - ext > cullX1 || p.y + ext < cullY0 || p.y - (e.r || 1.2) > cullY1) {
        culled++;
        continue;
      }
      drawn++;

      if (hasBalloon && e.kind === KIND.PIG) {
        drawPigBalloon(g, cam, p.x, p.y, e.r || 0.45, e.id, t);
      }

      const sx = cam.sx(p.x);
      const sy = cam.sy(p.y);
      const a = e.body.getAngle();

      g.save();
      g.translate(sx, sy);
      if (a) g.rotate(-a);
      g.scale(cam.s, cam.s);

      if (e.kind === KIND.BLOCK) {
        const sp = getBlockSprite(e, pxPerM);
        g.drawImage(sp.canvas, -sp.oxM, -sp.oyM, sp.wM, sp.hM);
        if (e.status && (e.status.poison || e.status.tint)) {
          drawStatusOverlay(g, e, t);
          if (e.status.poison) poisonedList.push({ x: p.x, y: p.y, ext: Math.max(e.w || 0.5, e.h || 0.5) * 0.5, id: e.id });
        }
      } else if (e.kind === KIND.PIG) {
        const sp = getPigSprite(e, pxPerM);
        g.drawImage(sp.canvas, -sp.oxM, -sp.oyM, sp.wM, sp.hM);
        drawPigPupils(g, e, p.x, p.y, a, pigLook);
        if (e.status && (e.status.poison || e.status.tint)) {
          drawStatusOverlay(g, e, t);
          if (e.status.poison) poisonedList.push({ x: p.x, y: p.y, ext: e.r || 0.5, id: e.id });
        }
      } else if (e.kind === KIND.BIRD) {
        const def = BIRDS[e.skin];
        if (def && def.drawBird) def.drawBird(g, e, t);
      } else if (e.kind === KIND.PROJ) {
        this._drawProjectile(g, e, t, pxPerM);
      }

      g.restore();
    }
    this.culledCount = culled;
    this.drawnCount = drawn;

    // 6. Rising magenta poison bubbles above poisoned ents
    for (let i = 0; i < poisonedList.length; i++) {
      const po = poisonedList[i];
      drawPoisonBubbles(g, cam, po.x, po.y, po.ext, po.id, t);
    }

    // 7. Waiting bird in slingshot pouch + Slingshot front fork & front band
    let waitingR = 0.45;
    if (isAiming) {
      const def = BIRDS[game.currentBirdId];
      if (def) {
        waitingR = def.radius ?? 0.45;
        const bx = pouch.x + (pull ? pull.x : 0);
        const by = pouch.y + (pull ? pull.y : 0);
        const aimAngle = pull && (pull.x || pull.y) ? Math.atan2(-pull.y, -pull.x) : 0;
        this._drawBirdAt(g, cam, def, bx, by, aimAngle, t);
      }
    }
    drawSlingshotFront(g, cam, sling, pouch, pull, waitingR);

    // 8. Trajectory preview arc (~0.9 s shrinking white dots with dark stroke)
    if (input && input.preview && input.preview.length) {
      const pts = input.preview;
      const n = pts.length;
      g.strokeStyle = 'rgba(15, 25, 42, 0.65)';
      g.lineWidth = 1.6;
      for (let i = 0; i < n; i++) {
        const q = pts[i];
        const k = q.k != null ? q.k : i / Math.max(1, n - 1);
        const rPx = q.r != null ? q.r : (5.0 - 3.0 * k);
        const sx = cam.sx(q.x), sy = cam.sy(q.y);
        if (sx < -10 || sx > cam.w + 10 || sy < -10 || sy > cam.h + 10) continue;
        g.globalAlpha = 0.92 - 0.54 * k;
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(sx, sy, Math.max(1.4, rPx), 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    // 9. Transient visual effects (bird-specific + generic video-style explosions/beams/shockwaves)
    for (let i = 0; i < w.effects.length; i++) {
      const e = w.effects[i];
      const fn = BIRD_EFFECTS[e.type] || GENERIC_EFFECTS[e.type];
      if (!fn) continue;
      g.save();
      try {
        fn(g, e, t, cam);
      } catch (err) {
        console.error('[effect]', e.type, err);
      }
      g.restore();
    }

    // 10. Registered overlay layers (particles, popups)
    for (let i = 0; i < this.fx.length; i++) {
      const layer = this.fx[i];
      g.save();
      try {
        layer.draw(g, cam, t);
      } catch (err) {
        console.error('[layer]', err);
      }
      g.restore();
    }

    // Reset unrotated CSS px transform for HUD-like hints and main.js's juice.drawOverlay
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // 11. Small non-interactive "→ 🐷" hint when wide-level AIM frames the sling area (§5)
    if (cam.offscreenPigsHint && cam.offscreenPigs > 0) {
      this._drawOffscreenPigHint(g, cam, cam.offscreenPigs, t);
    }

    if (tStart > 0) {
      const now = performance.now();
      this._checkAdaptiveDpr(now, now - tStart);
    }
  }

  _drawBirdAt(g, cam, def, x, y, angleWorldRad, t) {
    const r = def.radius ?? 0.45;
    g.save();
    g.translate(cam.sx(x), cam.sy(y));
    if (angleWorldRad) g.rotate(-angleWorldRad);
    g.scale(cam.s, cam.s);
    def.drawBird(g, { r, data: {}, status: {}, skin: def.id }, t);
    g.restore();
  }

  _drawProjectile(g, e, t, pxPerM) {
    const skin = e.skin || '';
    if (typeof skin === 'string' && skin.startsWith('bird:')) {
      const def = BIRDS[skin.slice(5)];
      if (def && def.drawBird) {
        def.drawBird(g, e, t);
        return;
      }
    }
    const fn = PROJ_SKINS[skin];
    if (fn) {
      fn(g, e, t);
      return;
    }
    if (BIRDS[skin] && BIRDS[skin].drawBird) {
      BIRDS[skin].drawBird(g, e, t);
      return;
    }
    if (skin === 'tnt' || e.mat === 'tnt') {
      const side = (e.r || 0.38) * 1.85;
      const sp = getBlockSprite({ mat: 'tnt', shape: 'box', w: side, h: side, hp: 20, maxHp: 20 }, pxPerM);
      g.drawImage(sp.canvas, -sp.oxM, -sp.oyM, sp.wM, sp.hM);
      return;
    }

    // Crisp cartoon fallback projectile
    const r = e.r || 0.22;
    g.fillStyle = (e.data && e.data.color) || '#fff3a0';
    g.strokeStyle = '#1e1e1e';
    g.lineWidth = Math.max(0.03, r * 0.14);
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(-r * 0.28, -r * 0.28, r * 0.30, 0, Math.PI * 2);
    g.fill();
  }

  _drawOffscreenPigHint(g, cam, count, t) {
    const bob = Math.sin(t * 5) * 4;
    const x = cam.w - 14 + bob * 0.5;
    const y = Math.round(cam.h * 0.44);
    const label = `🐷×${count} →`;
    g.save();
    g.font = '800 15px "PingFang SC","Microsoft YaHei",sans-serif';
    const tw = g.measureText(label).width;
    const pw = tw + 20, ph = 32;
    g.fillStyle = 'rgba(15, 25, 45, 0.80)';
    g.strokeStyle = '#7ac943';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(x - pw, y - ph / 2, pw, ph, 16);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x - pw / 2, y + 1);
    g.restore();
  }
}

function findSurfaceY(x, slingY, terrains) {
  if (slingY <= 0.05) return 0;
  let bestY = 0;
  for (let i = 0; i < terrains.length; i++) {
    const tr = terrains[i];
    if (tr.shape === 'box') {
      const p = tr.body.getPosition();
      const hw = (tr.w || 0) * 0.5;
      const hh = (tr.h || 0) * 0.5;
      if (x >= p.x - hw + 0.15 && x <= p.x + hw - 0.15) {
        const top = p.y + hh;
        if (top <= slingY + 0.5 && top > bestY) bestY = top;
      }
    }
  }
  return bestY;
}
