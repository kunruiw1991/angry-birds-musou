// 炸弹黑「全屏爆破」 (owner: birds-a).
// Spec: docs/DESIGN.md §3 row 4 — Tap: 24 random explosions across actionRect, then mega-blast at bird
// (hitstop 90, slowmo 0.35/0.5, flash 0.55, shake 1.0) flinging a ring of 16 exploding TNT crates.
// No tap -> mega-blast + TNT ring 1.5 s after first big impact.

import { KIND } from '../contracts.js';
import {
  TAU, clamp, hash01, holdTurn, setSensor, guardExplosiveProj,
  distributeTargets, emitBirdHit, makeHudIcon,
  drawCartoonEyes, drawAngryBrows, drawCartoonBeak,
} from './a_helpers.js';

export const BOMB_TUNE = Object.freeze({
  randomCount: 24,          // spec 24
  randomWindow: 0.72,       // spec 1.0 s (-28%)
  randomR: 1.95,            // spec 1.6 m (+21.9%)
  randomDmg: 165,           // spec 140 (+17.9%)
  randomImpulse: 15,        // spec 12 (+25%)
  megaDelay: 0.74,          // spec 1.05 s (-29.5%)
  megaR: 6.8,               // spec 5.5 m (+23.6%)
  megaDmg: 720,             // spec 600 (+20%)
  megaImpulse: 85,          // spec 70 (+21.4%)
  tntCount: 16,            // spec 16
  tntSpeed: 17,             // spec 16 m/s (+6.3%)
  tntBlastR: 2.2,           // spec 1.8 m (+22.2%)
  tntBlastDmg: 240,         // spec 200 (+20%)
  tntBlastImpulse: 22,      // spec 18 (+22.2%)
  noTapImpactDelay: 1.50,   // spec 1.5 s
});

function drawBombSprite(g, ent, t) {
  const r = ent.r || 0.55;
  const charging = !!(ent.data && ent.data.charging);
  const pulse = charging ? 0.5 + 0.5 * Math.sin((t || 0) * 32) : 0;

  if (charging) {
    g.fillStyle = `rgba(255, 70, 20, ${(0.25 + 0.25 * pulse).toFixed(3)})`;
    g.beginPath();
    g.arc(0, 0, r * (1.28 + 0.14 * pulse), 0, TAU);
    g.fill();
  }

  // Fuse stem + metal cap on top (-y is UP)
  g.fillStyle = '#52565e';
  g.strokeStyle = '#111216';
  g.lineWidth = r * 0.075;
  g.beginPath();
  g.roundRect ? g.roundRect(-r * 0.20, -r * 1.12, r * 0.40, r * 0.22, r * 0.06)
    : g.rect(-r * 0.20, -r * 1.12, r * 0.40, r * 0.22);
  g.fill();
  g.stroke();

  // Curved rope fuse
  g.strokeStyle = '#c89b54';
  g.lineWidth = r * 0.12;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0, -r * 1.10);
  g.quadraticCurveTo(r * 0.06, -r * 1.42, r * 0.24, -r * 1.54);
  g.stroke();

  // Flickering yellow-orange-white spark at fuse tip!
  const sx = r * 0.25;
  const sy = -r * 1.56;
  const spR = r * (0.24 + 0.08 * Math.sin((t || 0) * 40 + 1.3));
  g.fillStyle = '#ff6a00';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * TAU) / 10 + (t || 0) * 6;
    const rad = i % 2 === 0 ? spR * 1.35 : spR * 0.52;
    const px = sx + Math.cos(a) * rad;
    const py = sy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();

  g.fillStyle = '#fff59d';
  g.beginPath();
  g.arc(sx, sy, spR * 0.55, 0, TAU);
  g.fill();

  // Round Bomb body (charcoal black, glowing molten red when charging)
  g.save();
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fillStyle = charging ? (pulse > 0.5 ? '#c6281c' : '#5c1914') : '#24262c';
  g.fill();
  g.clip();

  // Upper-left slate sheen & lighter belly patch
  g.fillStyle = charging ? '#ff5722' : '#404550';
  g.beginPath();
  g.arc(-r * 0.28, -r * 0.30, r * 0.55, 0, TAU);
  g.fill();

  g.fillStyle = charging ? '#ffab91' : '#585d68';
  g.beginPath();
  g.ellipse(r * 0.06, r * 0.84, r * 0.68, r * 0.42, 0, 0, TAU);
  g.fill();

  // Signature pale grey forehead spot
  g.fillStyle = charging ? '#ffe082' : '#8a909e';
  g.beginPath();
  g.ellipse(r * 0.24, -r * 0.48, r * 0.16, r * 0.22, -0.2, 0, TAU);
  g.fill();
  g.restore();

  // Thick dark outline
  g.strokeStyle = '#0d0e11';
  g.lineWidth = r * 0.09;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.stroke();

  // Eyes, tan/orange angry brows, sturdy golden beak
  drawCartoonEyes(g, r, { x1: 0.10, x2: 0.48, y: -0.06, rx: 0.20, ry: 0.22, pupil: 0.085 });
  drawAngryBrows(g, r, {
    color: '#c4682b', yOuter: -0.36, yInner: -0.16, xLeft: -0.14, xMid: 0.30, xRight: 0.72, thick: 0.13,
  });
  drawCartoonBeak(g, r, { x0: 0.34, tipX: 1.04, yMid: 0.18, topH: 0.21, botH: 0.17 });
}

function drawTntCrate(g, ent, t) {
  const w = ent.w || (ent.r ? ent.r * 2 : 0.62);
  const h = ent.h || w;
  const hw = w * 0.5;
  const hh = h * 0.5;

  // Red TNT crate body + wood border frame (video iconic look!)
  g.fillStyle = '#d62f26';
  g.fillRect(-hw, -hh, w, h);

  g.strokeStyle = '#8b4e19';
  g.lineWidth = w * 0.14;
  g.strokeRect(-hw + w * 0.07, -hh + h * 0.07, w * 0.86, h * 0.86);

  // Outer crisp dark border
  g.strokeStyle = '#1b110b';
  g.lineWidth = w * 0.07;
  g.strokeRect(-hw, -hh, w, h);

  // White center label band + bold TNT text
  g.fillStyle = '#fff8eb';
  g.fillRect(-hw * 0.82, -hh * 0.34, w * 0.82, h * 0.34);
  g.fillStyle = '#18110d';
  g.font = `900 ${(h * 0.30).toFixed(3)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TNT', 0, 0);

  // Tiny sizzling fuse spark at corner
  const sp = w * (0.14 + 0.05 * Math.sin((t || 0) * 35));
  g.fillStyle = '#ffe54c';
  g.beginPath();
  g.arc(hw * 0.75, -hh * 0.85, sp, 0, TAU);
  g.fill();
}

function triggerMegaBlast(ctx, bird) {
  if (bird.data.megaDone) return;
  bird.data.megaDone = true;
  bird.data.charging = false;

  const p = bird.alive ? ctx.pos(bird) : (bird.data.lastPos || { x: 20, y: 3 });
  const mx = p.x;
  const my = Math.max(0.9, p.y);

  // Center Mega-Blast + exact spec juice
  ctx.explode(mx, my, {
    r: BOMB_TUNE.megaR,
    dmg: BOMB_TUNE.megaDmg,
    impulse: BOMB_TUNE.megaImpulse,
    power: 'mega',
    source: 'bomb_mega',
  });
  ctx.addEffect({
    type: 'bomb_mega_wave',
    x: mx,
    y: my,
    r: BOMB_TUNE.megaR * 1.45,
    ttl: 1.05,
  });
  ctx.juice({
    hitstop: 90,
    slowmo: { scale: 0.35, dur: 0.5 },
    flash: { alpha: 0.55, color: '#ffffff' },
    shake: 1.0,
  });
  ctx.sfx('mega_explosion', { vol: 1.0 });
  emitBirdHit(ctx, 'bomb', mx, my, 32);

  // Fling ring of 16 exploding TNT crates radially at 17 m/s
  const n = BOMB_TUNE.tntCount;
  const highInAir = my > 3.2;
  const crates = [];
  for (let i = 0; i < n; i++) {
    const ang = highInAir
      ? (i * TAU) / n
      : (-0.06 + (i / (n - 1)) * (Math.PI + 0.12));
    const sx = mx + Math.cos(ang) * 0.85;
    const sy = Math.max(0.55, my + Math.sin(ang) * 0.85);
    const vx = Math.cos(ang) * BOMB_TUNE.tntSpeed;
    const vy = Math.sin(ang) * BOMB_TUNE.tntSpeed + (highInAir ? 1.5 : 2.2);

    const trail = ctx.addEffect({
      type: 'bomb_tnt_trail',
      x: sx,
      y: sy,
      pts: [{ x: sx, y: sy, t: ctx.time }],
      ttl: 2.0,
    });

    const crate = ctx.spawnProjectile({
      shape: 'box',
      w: 0.78,
      h: 0.78,
      r: 0.42,
      x: sx,
      y: sy,
      vx,
      vy,
      angle: ang,
      angularVelocity: (i % 2 === 0 ? 1 : -1) * 9,
      skin: 'bomb_tnt',
      owner: 'bomb',
      density: 2.6,
      gravityScale: 0.85,
      sensor: true,
      ttl: 3.4,
      bullet: true,
      explode: null,
      onHit: (ent) => {
        const cp = ctx.pos(ent);
        ctx.addEffect({ type: 'bomb_blast_ring', x: cp.x, y: cp.y, r: BOMB_TUNE.tntBlastR, ttl: 0.45 });
      },
    });
    crates.push({ crate, trail, armed: false });
  }

  // Track TNT crate trails + arm contact detonation at 0.14 s once the iconic 16-TNT ring expands!
  ctx.addTask((_dt, age) => {
    const now = ctx.time;
    let aliveCount = 0;
    for (const item of crates) {
      const c = item.crate;
      if (!c || !c.alive) continue;
      if (!item.armed && age >= 0.14) {
        item.armed = true;
        c.data.hits = 0;
        c.data.explode = {
          r: BOMB_TUNE.tntBlastR,
          dmg: BOMB_TUNE.tntBlastDmg,
          impulse: BOMB_TUNE.tntBlastImpulse,
          power: 'normal',
        };
        setSensor(ctx, c, false);
      }
      if (item.armed && guardExplosiveProj(ctx, c, 0.05)) continue;
      aliveCount++;
      const cp = ctx.pos(c);
      item.trail.x = cp.x;
      item.trail.y = cp.y;
      item.trail.pts.push({ x: cp.x, y: cp.y, t: now });
      if (item.trail.pts.length > 18) item.trail.pts.shift();
    }
    return aliveCount > 0 && age < 3.4;
  });
}

const bomb = {
  id: 'bomb',
  name: '炸弹黑',
  ability: '全屏爆破',
  desc: '引发24处全屏连环轰炸，随后中心超级大爆炸并向四周抛射16箱TNT',
  color: '#2b2b2b',
  radius: 0.55,
  density: 5.5,
  dmgMul: 1.15,

  onLaunch(ctx, bird) {
    const p = ctx.pos(bird);
    const v = ctx.vel(bird);
    bird.data.lastPos = { x: p.x, y: p.y };
    bird.data.prevVel = { x: v.x, y: v.y };
    bird.data.age = 0;
    bird.data.tapped = false;
    bird.data.megaScheduled = false;
    bird.data.megaDone = false;
    bird.data.charging = false;
  },

  onStep(ctx, bird, dt) {
    if (!bird.alive) return;
    const p = ctx.pos(bird);
    const v = ctx.vel(bird);
    bird.data.lastPos = { x: p.x, y: p.y };
    bird.data.age = (bird.data.age || 0) + dt;

    if (bird.data.chargeFx) {
      bird.data.chargeFx.x = p.x;
      bird.data.chargeFx.y = p.y;
    }

    // Passive fallback: No tap -> mega-blast 1.5 s after first big impact
    if (!bird.data.tapped && !bird.data.megaScheduled && !bird.data.megaDone && bird.data.age > 0.12) {
      const pv = bird.data.prevVel || v;
      const dv = Math.hypot(v.x - pv.x, v.y - pv.y);
      const nearHit = dv > 4.2 || (
        p.y <= bird.r + 0.12 ||
        ctx.queryCircle(p.x, p.y, bird.r + 0.16, (e) => e.kind === KIND.BLOCK || e.kind === KIND.PIG).length > 0
      );
      if (nearHit) {
        bird.data.megaScheduled = true;
        bird.data.charging = true;
        bird.data.chargeFx = ctx.addEffect({
          type: 'bomb_charge',
          x: p.x,
          y: p.y,
          r: BOMB_TUNE.megaR * 0.65,
          ttl: BOMB_TUNE.noTapImpactDelay,
        });
        holdTurn(ctx, BOMB_TUNE.noTapImpactDelay + 2.2);
        ctx.after(BOMB_TUNE.noTapImpactDelay, () => {
          if (!bird.data.tapped && !bird.data.megaDone) {
            triggerMegaBlast(ctx, bird);
          }
        });
      }
    }
    bird.data.prevVel = { x: v.x, y: v.y };
  },

  onTap(ctx, bird, target) {
    const p = ctx.pos(bird);
    bird.data.tapped = true;
    bird.data.charging = true;
    bird.data.lastPos = { x: p.x, y: p.y };

    // Pulsing blast-warning sphere around Bomb (matches bomb_b.jpg!)
    bird.data.chargeFx = ctx.addEffect({
      type: 'bomb_charge',
      x: p.x,
      y: p.y,
      r: BOMB_TUNE.megaR * 0.72,
      ttl: BOMB_TUNE.megaDelay + 0.08,
    });

    holdTurn(ctx, BOMB_TUNE.megaDelay + 2.6);

    // 24 random explosions across actionRect over 0.0 .. 0.74 s (blast #0 fires immediately at t=0!)
    const nBlasts = BOMB_TUNE.randomCount;
    for (let i = 0; i < nBlasts; i++) {
      const delay = i === 0 ? 0 : (i / (nBlasts - 1)) * BOMB_TUNE.randomWindow;
      const fireBlast = () => {
        const rect = ctx.actionRect();
        let bx, by;
        // Blend full-screen random explosions with structure-targeted blasts for guaranteed chaos + G5
        if (i === 0 && target && Number.isFinite(target.x)) {
          bx = target.x;
          by = Math.max(0.8, target.y);
        } else if (i % 3 !== 2) {
          const tgts = distributeTargets(ctx, p.x, p.y, nBlasts, { aheadOnly: false });
          const tgt = tgts[i % tgts.length];
          bx = tgt.x + ctx.range(-2.2, 2.2);
          by = Math.max(0.7, tgt.y + ctx.range(-1.4, 2.4));
        } else {
          bx = ctx.range(rect.x0 + 1.5, rect.x1 - 1.5);
          by = ctx.range(0.9, Math.max(5.5, rect.y1 - 2.0));
        }

        ctx.explode(bx, by, {
          r: BOMB_TUNE.randomR,
          dmg: BOMB_TUNE.randomDmg,
          impulse: BOMB_TUNE.randomImpulse,
          power: 'normal',
          source: 'bomb_carpet',
        });
        ctx.addEffect({
          type: 'bomb_blast_ring',
          x: bx,
          y: by,
          r: BOMB_TUNE.randomR * 1.25,
          ttl: 0.55,
        });
        ctx.sfx('explosion', { vol: 0.55, pitch: 0.85 + (i % 6) * 0.07 });
        ctx.juice({ shake: 0.16 });
      };
      if (delay === 0) fireBlast();
      else ctx.after(delay, fireBlast);
    }

    // Center Mega-Blast + 16 TNT crate ring at megaDelay (0.76 s)
    ctx.after(BOMB_TUNE.megaDelay, () => {
      triggerMegaBlast(ctx, bird);
    });
  },

  drawBird: drawBombSprite,

  projSkins: {
    'bird:bomb': drawBombSprite,
    bomb_tnt: drawTntCrate,
  },

  effects: {
    /** Translucent pulsing blast-radius sphere around Bomb before mega-detonation (bomb_b.jpg). */
    bomb_charge(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const cx = cam.sx(e.x), cy = cam.sy(e.y);
      const rr = (e.r || 4.2) * cam.s * (0.75 + 0.30 * k);
      const pulse = 0.5 + 0.5 * Math.sin(t * 34);

      g.save();
      g.fillStyle = `rgba(255, 95, 25, ${(0.10 + 0.12 * k * pulse).toFixed(3)})`;
      g.strokeStyle = `rgba(255, 175, 65, ${(0.45 + 0.35 * pulse).toFixed(3)})`;
      g.lineWidth = Math.max(2, 0.09 * cam.s);
      g.beginPath();
      g.arc(cx, cy, rr, 0, TAU);
      g.fill();
      g.stroke();
      g.restore();
    },

    /** Fiery shockwave ring + dark soot puffs for carpet explosions & TNT hits. */
    bomb_blast_ring(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const alpha = 1 - k;
      const cx = cam.sx(e.x), cy = cam.sy(e.y);
      const rr = (e.r || 2.0) * cam.s * (0.35 + 0.85 * Math.pow(k, 0.55));

      g.save();
      // Expanding dark smoke puffs (video's iconic black smoke border!)
      g.fillStyle = `rgba(24, 20, 22, ${(0.55 * alpha).toFixed(3)})`;
      for (let i = 0; i < 7; i++) {
        const a = (i * TAU) / 7 + hash01(e.t0 * 53 + i) * 0.7;
        const pr = rr * (0.65 + 0.25 * hash01(i * 19));
        g.beginPath();
        g.arc(cx + Math.cos(a) * pr, cy + Math.sin(a) * pr, rr * 0.34 * (0.6 + 0.5 * k), 0, TAU);
        g.fill();
      }

      // Bright orange-yellow inner blast flash + shockwave
      g.globalCompositeOperation = 'lighter';
      if (k < 0.55) {
        const fa = 1 - k / 0.55;
        g.fillStyle = `rgba(255, 145, 25, ${(0.72 * fa).toFixed(3)})`;
        g.beginPath();
        g.arc(cx, cy, rr * 0.68, 0, TAU);
        g.fill();

        g.fillStyle = `rgba(255, 248, 175, ${(0.88 * fa).toFixed(3)})`;
        g.beginPath();
        g.arc(cx, cy, rr * 0.36, 0, TAU);
        g.fill();
      }

      g.strokeStyle = `rgba(255, 195, 60, ${(0.8 * alpha).toFixed(3)})`;
      g.lineWidth = Math.max(2, 0.16 * cam.s * alpha);
      g.beginPath();
      g.arc(cx, cy, rr, 0, TAU);
      g.stroke();
      g.restore();
    },

    /** Screen-filling golden sun-ray dome + twin shockwaves on Bomb's Mega-Blast (white.jpg / bomb_a.jpg). */
    bomb_mega_wave(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const alpha = 1 - k;
      const cx = cam.sx(e.x), cy = cam.sy(e.y);
      const maxR = (e.r || 9.5) * cam.s;
      const rr = maxR * (0.20 + 0.92 * Math.pow(k, 0.52));

      g.save();
      // Massive dark billowing smoke crown
      g.fillStyle = `rgba(18, 15, 18, ${(0.62 * alpha).toFixed(3)})`;
      for (let i = 0; i < 14; i++) {
        const a = (i * TAU) / 14 + k * 0.25;
        const d = rr * (0.62 + 0.18 * (i % 2));
        g.beginPath();
        g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr * 0.28, 0, TAU);
        g.fill();
      }

      g.globalCompositeOperation = 'lighter';
      // 20 radial golden speed-rays (iconic Bilibili mega-blast visual!)
      for (let i = 0; i < 20; i++) {
        const a = (i * TAU) / 20 + 0.08;
        const r0 = rr * 0.25;
        const r1 = rr * (1.08 + 0.22 * (i % 2));
        g.strokeStyle = `rgba(255, 210, 75, ${(0.68 * alpha).toFixed(3)})`;
        g.lineWidth = Math.max(4, 0.36 * cam.s * alpha);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.stroke();
      }

      // Twin golden-white shockwave rings
      g.strokeStyle = `rgba(255, 160, 30, ${(0.88 * alpha).toFixed(3)})`;
      g.lineWidth = Math.max(5, 0.55 * cam.s * alpha);
      g.beginPath();
      g.arc(cx, cy, rr, 0, TAU);
      g.stroke();

      g.strokeStyle = `rgba(255, 250, 210, ${(0.95 * alpha).toFixed(3)})`;
      g.lineWidth = Math.max(2.5, 0.22 * cam.s * alpha);
      g.beginPath();
      g.arc(cx, cy, rr * 0.82, 0, TAU);
      g.stroke();
      g.restore();
    },

    /** Orange-gold spark arcs trailing each radially flung TNT crate. */
    bomb_tnt_trail(g, e, t, cam) {
      const pts = e.pts;
      if (!pts || pts.length < 2) return;
      const win = 0.45;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const a = clamp(1 - (t - p1.t) / win, 0, 1);
        if (a <= 0.02) continue;
        g.strokeStyle = `rgba(255, 145, 30, ${(0.62 * a).toFixed(3)})`;
        g.lineWidth = Math.max(2.5, 0.36 * cam.s * a);
        g.beginPath();
        g.moveTo(cam.sx(p0.x), cam.sy(p0.y));
        g.lineTo(cam.sx(p1.x), cam.sy(p1.y));
        g.stroke();
      }
      g.restore();
    },
  },
};

bomb.icon = makeHudIcon(bomb, 0.31, 0.48, 0.62);

export default bomb;
