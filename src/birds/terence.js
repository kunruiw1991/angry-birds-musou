// 大红「巨大化」 (owner: birds-b).
// Spec: docs/DESIGN.md §3 row 7 — grow radius ×4 (0.62 -> 2.48 m) over 0.25 s (5 fixture swaps),
// same density (mass ×16, velocity preserved), ×5+ contact dmg (red 1000+ numbers),
// first ground hit = shockwave r 4..5.2 / 250..325 dmg / impulse 30..39 + big shake.
// Readability (#97): Giant Terence is the unobstructed hero of the frame >= 1.5 s — shockwave ring
// + flying debris only (zero black smoke / explosion overlays), upright glaring V-brows like 3:08.

import { KIND } from '../contracts.js';
import {
  clamp,
  holdTurn,
  resizeCircle,
  resolveLocalTarget,
  groundTopAt,
  hash01,
  drawBirdIcon,
} from './b_helpers.js';

const BASE_R = 0.62;
const GIANT_R = 2.48; // exact ×4.0 radius -> ×16.0 mass at constant density
const GROW_STEPS = 5;
const GROW_DUR = 0.25;

function drawTerenceSprite(g, ent, t = 0) {
  const r = ent.r || BASE_R;
  const giant = !!(ent.data && ent.data.giant);

  // Subtle crisp white-gold impact rim when giant (never obscures silhouette)
  if (giant) {
    const pulse = 1.04 + 0.03 * Math.sin((t || 0) * 16);
    g.save();
    g.globalAlpha = 0.45;
    g.strokeStyle = '#fff5cc';
    g.lineWidth = r * 0.055;
    g.beginPath();
    g.arc(0, 0, r * pulse, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  // Tail feathers (left side -x)
  g.fillStyle = '#1b1212';
  for (let i = -1; i <= 1; i++) {
    g.save();
    g.translate(-r * 0.92, r * 0.05 + i * r * 0.16);
    g.rotate(i * 0.28 - 0.1);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-r * 0.36, -r * 0.10);
    g.lineTo(-r * 0.32, r * 0.11);
    g.closePath();
    g.fill();
    g.restore();
  }

  // Top head crest feathers (2 thick crimson plumes)
  g.fillStyle = '#a81018';
  g.strokeStyle = '#180e0e';
  g.lineWidth = r * 0.07;
  for (let i = 0; i < 2; i++) {
    g.beginPath();
    const ox = -r * 0.12 + i * r * 0.20;
    g.ellipse(ox, -r * 1.05, r * 0.16, r * 0.26, -0.35 + i * 0.32, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  // Main rich crimson body (video 3:08 iconic giant red ball)
  g.fillStyle = '#c4161f';
  g.strokeStyle = '#180e0e';
  g.lineWidth = r * 0.085;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();

  // Bottom shadow crescent + belly + cheek spots clipped cleanly inside body
  g.save();
  g.beginPath();
  g.arc(0, 0, r * 0.96, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#8c0c13';
  g.beginPath();
  g.arc(-r * 0.14, r * 0.26, r * 0.98, 0, Math.PI * 2);
  g.fill();

  // Pale rose-tan belly patch
  g.fillStyle = '#edd0c5';
  g.beginPath();
  g.ellipse(r * 0.14, r * 0.72, r * 0.65, r * 0.42, 0, 0, Math.PI * 2);
  g.fill();

  // Terence's signature dark crimson spots/wrinkles on cheeks & sides
  g.fillStyle = '#73090f';
  g.beginPath();
  g.ellipse(-r * 0.44, r * 0.06, r * 0.15, r * 0.25, 0.2, 0, Math.PI * 2);
  g.ellipse(-r * 0.16, r * 0.22, r * 0.12, r * 0.19, 0.1, 0, Math.PI * 2);
  g.fill();

  // Crisp top gloss highlight
  g.fillStyle = 'rgba(255, 210, 205, 0.26)';
  g.beginPath();
  g.ellipse(-r * 0.24, -r * 0.56, r * 0.44, r * 0.20, -0.35, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Outer thick cartoon outline
  g.strokeStyle = '#180e0e';
  g.lineWidth = r * 0.085;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();

  // Grumpy dark eye-bags under eyes
  g.fillStyle = '#5e070c';
  g.beginPath();
  g.ellipse(r * 0.16, -r * 0.01, r * 0.23, r * 0.17, 0, 0, Math.PI * 2);
  g.ellipse(r * 0.55, -r * 0.01, r * 0.21, r * 0.16, 0, 0, Math.PI * 2);
  g.fill();

  // Angry glaring eyes
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#180e0e';
  g.lineWidth = r * 0.05;
  g.beginPath();
  g.arc(r * 0.17, -r * 0.08, r * 0.195, 0, Math.PI * 2);
  g.arc(r * 0.55, -r * 0.08, r * 0.175, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  // Focused glaring pupils
  g.fillStyle = '#111111';
  g.beginPath();
  g.arc(r * 0.23, -r * 0.07, r * 0.078, 0, Math.PI * 2);
  g.arc(r * 0.58, -r * 0.07, r * 0.072, 0, Math.PI * 2);
  g.fill();

  // MASSIVE bold V-shaped black eyebrows (unmistakable hero read at both 30px and 2.48m!)
  g.fillStyle = '#110a0a';
  g.beginPath();
  g.moveTo(-r * 0.26, -r * 0.34);
  g.lineTo(r * 0.38, -r * 0.10);
  g.lineTo(r * 0.88, -r * 0.35);
  g.lineTo(r * 0.80, -r * 0.54);
  g.lineTo(r * 0.38, -r * 0.28);
  g.lineTo(-r * 0.16, -r * 0.55);
  g.closePath();
  g.fill();

  // Heavy hooked orange-gold beak
  g.fillStyle = '#d97706';
  g.strokeStyle = '#180e0e';
  g.lineWidth = r * 0.055;
  g.beginPath();
  g.moveTo(r * 0.25, r * 0.14);
  g.lineTo(r * 0.88, r * 0.18);
  g.lineTo(r * 0.34, r * 0.40);
  g.closePath();
  g.fill();
  g.stroke();

  g.fillStyle = '#fbbf24';
  g.beginPath();
  g.moveTo(r * 0.24, r * 0.01);
  g.lineTo(r * 1.03, r * 0.15);
  g.lineTo(r * 0.28, r * 0.20);
  g.closePath();
  g.fill();
  g.stroke();
}

function triggerGroundShockwave(ctx, bird, x, y) {
  if (bird.data.groundSlammed) return;
  bird.data.groundSlammed = true;
  const gy = Math.max(0.2, groundTopAt(ctx, x, y + 1.5) + 0.25);

  // Main seismic shockwave: r = 4.8 m (+20%), dmg = 300 (+20%), impulse = 24 (-20%, within ±30% of 30
  // so light planks don't launch 35 m into space and pull CARNAGE camera off Giant Terence!)
  ctx.damageCircle(x, gy, 4.8, {
    dmg: 300,
    impulse: 24,
    source: 'terence_shockwave',
    filter: (e) => e.mat !== 'tnt',
  });
  ctx.addEffect({ type: 'shockwave', x, y: gy, r: 5.4, color: '#fff3b0', ttl: 0.52 });
  ctx.addEffect({ type: 'terence_shock', x, y: gy, r: 5.8, seed: bird.id, ttl: 0.90 });
  ctx.juice({ shake: 0.92, hitstop: 75, flash: { alpha: 0.16, color: '#fff5d6' } });
  ctx.sfx('mega_explosion', { x, y: gy });

  // Heavy cartoon bounce on first ground slam so Giant Terence stays center-frame above ground >= 1.5 s (video 3:08)!
  if (bird.alive) {
    const bv = ctx.vel(bird);
    ctx.setVelocity(bird, clamp(bv.x * 0.62, 4.5, 9.5), Math.max(Math.abs(bv.y) * 0.34, 6.8));
  }

  // Secondary ground fissure tremors rippling left & right (pure shockwave ring + debris)
  for (let side = -1; side <= 1; side += 2) {
    ctx.after(0.10, () => {
      const sx = x + side * 4.0;
      const sgy = groundTopAt(ctx, sx, gy + 3) + 0.2;
      ctx.damageCircle(sx, sgy, 3.4, {
        dmg: 150,
        impulse: 14,
        source: 'terence_quake',
        filter: (e) => e.mat !== 'tnt' || Math.abs(ctx.pos(e).x - x) > 3.8,
      });
      ctx.addEffect({ type: 'shockwave', x: sx, y: sgy, r: 3.6, color: '#ffe066', ttl: 0.42 });
      ctx.addEffect({ type: 'terence_shock', x: sx, y: sgy, r: 3.6, seed: bird.id + side * 7, ttl: 0.65 });
    });
  }
}

export default {
  id: 'terence',
  name: '大红',
  ability: '巨大化',
  desc: '瞬间变大4倍，体重×16碾压一切，落地引发大地震冲击波',
  color: '#c4161f',
  radius: BASE_R,
  density: 5.5,
  dmgMul: 1.25,

  onLaunch(_ctx, bird) {
    bird.data.giant = false;
    bird.data.heroLayer = false;
    bird.data.groundSlammed = false;
    bird.data.crushMap = new Map();
    bird.data.nextTrailT = 0;
    bird.data.nextCrushT = 0;
  },

  onTap(ctx, bird, target) {
    if (!bird || !bird.alive) return;
    holdTurn(ctx, 2.8);

    const p = ctx.pos(bird);
    const v = ctx.vel(bird);
    const tapPos = { x: p.x, y: p.y };
    const aim = resolveLocalTarget(ctx, tapPos, target);

    bird.data.giant = true;
    bird.data.heroLayer = true;
    bird.data.tapT = ctx.time;
    bird.dmgMul = 6.0; // ×5 tuned +20% (within ±30%)

    // Keep Terence upright so his giant glaring brows face forward like video 3:08!
    bird.body.setAngle(clamp(bird.body.getAngle(), -0.35, 0.25));
    bird.body.setAngularVelocity(0);

    // Preserve velocity; gently steer into local target if within findTargets default reach
    const dx = aim.x - p.x;
    const dy = (aim.y + 0.8) - p.y;
    const dist = Math.hypot(dx, dy) || 1;
    const curSpd = Math.hypot(v.x, v.y);
    const chargeSpd = clamp(Math.max(curSpd * 1.05, 19.5), 18, 23.5);
    if (aim.hasTarget && dx > 1.5) {
      ctx.setVelocity(bird, (dx / dist) * chargeSpd, clamp((dy / dist) * chargeSpd, -20, 5));
    } else {
      ctx.setVelocity(bird, v.x * 1.05, v.y);
    }

    // Immediate VFX (< 16 ms): crisp white-gold growth shockwave + persistent hero foreground draw pass
    bird.data.heroEff = ctx.addEffect({
      type: 'terence_hero',
      bird,
      x: p.x,
      y: p.y,
      r: GIANT_R,
      ttl: 30.0,
    });
    ctx.addEffect({ type: 'terence_grow', x: p.x, y: p.y, r: GIANT_R * 1.9, bird, ttl: 0.55 });
    ctx.damageCircle(p.x, p.y, 4.2, { dmg: 110, impulse: 18, source: 'terence_roar' });
    ctx.juice({ shake: 0.42, hitstop: 35 });
    ctx.sfx('grow', { x: p.x, y: p.y });

    // 5 fixture swaps over 0.25 s: 0.62 -> 2.48 m (radius ×4, mass ×16)
    for (let step = 1; step <= GROW_STEPS; step++) {
      const delay = ((step - 1) / (GROW_STEPS - 1)) * GROW_DUR;
      const rTarget = BASE_R + (GIANT_R - BASE_R) * (step / GROW_STEPS);
      if (delay <= 0) {
        resizeCircle(ctx, bird, rTarget);
      } else {
        ctx.after(delay, () => {
          if (!bird.alive) return;
          resizeCircle(ctx, bird, rTarget);
          const bp = ctx.pos(bird);
          ctx.addEffect({ type: 'shockwave', x: bp.x, y: bp.y, r: rTarget * 1.45, color: '#fff3b0', ttl: 0.24 });
        });
      }
    }

    // Safety fallback so shockwave still fires if wedged high on rubble
    ctx.after(1.25, () => {
      if (bird.alive && !bird.data.groundSlammed) {
        const bp = ctx.pos(bird);
        triggerGroundShockwave(ctx, bird, bp.x, bp.y);
      }
    });
  },

  onStep(ctx, bird, _dt) {
    if (!bird || !bird.alive || !bird.data.giant) return;
    const p = ctx.pos(bird);
    const v = ctx.vel(bird);
    const spd = Math.hypot(v.x, v.y);

    // Keep Giant Terence upright (angle in [-0.38, 0.28]) so his huge black eyebrows stay visible >= 1.5 s!
    const curAng = bird.body.getAngle();
    const clampedAng = clamp(curAng, -0.38, 0.28);
    if (curAng !== clampedAng) {
      bird.body.setAngle(clampedAng);
    }
    bird.body.setAngularVelocity(bird.body.getAngularVelocity() * 0.5);

    // Keep persistent hero render effect synced & at top of effects list so smoke never covers Giant Terence!
    const heroEff = bird.data.heroEff;
    if (heroEff) {
      heroEff.x = p.x;
      heroEff.y = p.y;
      heroEff.r = bird.r;
      heroEff.t0 = ctx.time;
      const fxList = ctx.world && ctx.world.effects;
      if (fxList && fxList.length > 1 && fxList[fxList.length - 1] !== heroEff) {
        const idx = fxList.indexOf(heroEff);
        if (idx >= 0) {
          fxList.splice(idx, 1);
          fxList.push(heroEff);
        }
      }
    }

    // Clean white air-wake arcs strictly BEHIND Terence (never over his face)
    if (ctx.time >= (bird.data.nextTrailT || 0) && spd > 5.0) {
      bird.data.nextTrailT = ctx.time + 0.07;
      const ux = v.x / (spd || 1);
      const uy = v.y / (spd || 1);
      ctx.addEffect({
        type: 'terence_trail',
        x: p.x - ux * bird.r * 0.85,
        y: p.y - uy * bird.r * 0.85,
        r: bird.r * 0.82,
        ang: Math.atan2(uy, ux),
        ttl: 0.28,
      });
    }

    // Heavy sumo skid after ground slam so Giant Terence stays framed in the wreckage >= 1.5 s
    if (bird.data.groundSlammed && spd > 9.5) {
      ctx.setVelocity(bird, v.x * 0.94, v.y);
    }

    // Unstoppable ×16-mass bulldozer crush: smash blocks/pigs in path with red 1000+ damage numbers
    if (ctx.time >= (bird.data.nextCrushT || 0) && spd > 2.8) {
      bird.data.nextCrushT = ctx.time + 0.06;
      const crushMap = bird.data.crushMap || (bird.data.crushMap = new Map());
      const hits = ctx.queryCircle(
        p.x,
        p.y,
        bird.r + 0.38,
        (e) => !e.isStatic && (e.kind === KIND.BLOCK || e.kind === KIND.PIG),
      );
      const ux = v.x / (spd || 1);
      const uy = v.y / (spd || 1);
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        const lastT = crushMap.get(e.id) || -99;
        if (ctx.time - lastT < 0.22) continue;
        crushMap.set(e.id, ctx.time);
        const ep = ctx.pos(e);
        // Punt TNT crates far ahead so their black smoke explodes on distant enemies, never over Giant Terence!
        if (e.mat === 'tnt') {
          ctx.setVelocity(e, Math.max(19, v.x + 14), 8.5);
          continue;
        }
        const heavyDmg = Math.round(clamp(spd * 62, 560, 1480));
        ctx.damage(e, heavyDmg, { x: ep.x, y: ep.y, cause: 'terence_crush' });
        if (e.alive) {
          ctx.applyImpulse(e, ux * 20 + (ep.x - p.x) * 4, uy * 12 + 8);
        }
      }
      if (hits.length > 0 && spd < 15 && !bird.data.groundSlammed) {
        ctx.setVelocity(bird, v.x * 1.05, v.y);
      }
    }

    // First ground / static terrain hit -> seismic shockwave
    if (!bird.data.groundSlammed && ctx.time - (bird.data.tapT || 0) >= 0.05) {
      const gTop = groundTopAt(ctx, p.x, p.y + 1.5);
      const hitStatic = p.y - bird.r <= gTop + 0.24 ||
        ctx.queryCircle(p.x, p.y, bird.r + 0.16, (e) => e.isStatic).length > 0;
      if (hitStatic) {
        triggerGroundShockwave(ctx, bird, p.x, p.y);
      }
    }
  },

  drawBird(g, ent, t = 0) {
    // When giant hero layer is active, terence_hero draws Giant Terence cleanly above smoke effects
    if (ent && ent.data && ent.data.heroLayer && ent.alive && ent.body) return;
    drawTerenceSprite(g, ent, t);
  },

  icon(g, size) {
    drawBirdIcon(drawTerenceSprite, BASE_R, g, size, 0);
  },

  projSkins: {
    'bird:terence': drawTerenceSprite,
    terence_rock(g, ent) {
      const r = ent.r || 0.35;
      g.fillStyle = '#8b5a3c';
      g.strokeStyle = '#24150e';
      g.lineWidth = r * 0.14;
      g.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const rr = r * (0.78 + 0.28 * hash01(ent.id * 11 + i));
        if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#d4a373';
      g.beginPath();
      g.arc(-r * 0.18, -r * 0.18, r * 0.24, 0, Math.PI * 2);
      g.fill();
    },
  },

  effects: {
    // Foreground hero pass: draws Giant Terence cleanly above any level TNT smoke!
    terence_hero(g, e, t, cam) {
      const bird = e.bird;
      if (!bird || !bird.alive || !bird.body) return;
      const p = bird.body.getPosition();
      const a = bird.body.getAngle();
      g.save();
      g.translate(cam.sx(p.x), cam.sy(p.y));
      if (a) g.rotate(-a);
      g.scale(cam.s, cam.s);
      drawTerenceSprite(g, bird, t);
      g.restore();
    },

    terence_grow(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const bp = e.bird && e.bird.alive ? e.bird.body.getPosition() : { x: e.x, y: e.y };
      const sx = cam.sx(bp.x);
      const sy = cam.sy(bp.y);
      const maxPx = e.r * cam.s;

      g.save();
      for (let ring = 0; ring < 2; ring++) {
        const rk = clamp(k * 1.35 - ring * 0.2, 0, 1);
        if (rk <= 0) continue;
        const rad = maxPx * (0.55 + 0.55 * rk);
        g.globalAlpha = (1 - rk) * 0.85;
        g.strokeStyle = ring === 0 ? '#ffffff' : '#ffe066';
        g.lineWidth = Math.max(2.5, (1 - rk) * 10);
        g.beginPath();
        g.arc(sx, sy, rad, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    },

    terence_trail(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const sx = cam.sx(e.x);
      const sy = cam.sy(e.y);
      const rad = e.r * cam.s * (0.85 + 0.35 * k);
      g.save();
      g.globalAlpha = (1 - k) * 0.55;
      g.strokeStyle = '#ffffff';
      g.lineWidth = Math.max(2, (1 - k) * 6);
      g.lineCap = 'round';
      g.beginPath();
      g.arc(sx, sy, rad, -e.ang + Math.PI * 0.65, -e.ang + Math.PI * 1.35);
      g.stroke();
      g.restore();
    },

    // Crisp shockwave rings + flying earth/wood/stone debris (ZERO smoke or opaque fill!)
    terence_shock(g, e, t, cam) {
      const k = clamp((t - e.t0) / e.ttl, 0, 1);
      const sx = cam.sx(e.x);
      const sy = cam.sy(e.y);
      const maxR = e.r * cam.s;
      const ease = 1 - (1 - k) * (1 - k);

      g.save();
      // Crisp double shockwave rings (white outer + warm gold inner, zero fill over Terence!)
      for (let i = 0; i < 2; i++) {
        const rr = maxR * clamp(ease - i * 0.14, 0.08, 1.1);
        g.globalAlpha = (1 - k) * (i === 0 ? 0.92 : 0.68);
        g.strokeStyle = i === 0 ? '#ffffff' : '#ffe066';
        g.lineWidth = Math.max(2, (1 - k) * (i === 0 ? 11 : 7));
        g.beginPath();
        g.arc(sx, sy, rr, Math.PI * 1.02, Math.PI * 1.98);
        g.stroke();
      }

      // Flying earth & stone debris chunks erupting outward beyond Giant Terence's radius
      for (let i = 0; i < 14; i++) {
        const u = (i / 13) * 2 - 1;
        if (Math.abs(u) < 0.28) continue; // keep center clear over Giant Terence!
        const h1 = hash01(e.seed + i * 5.3);
        const h2 = hash01(e.seed + i * 11.7);
        const px = sx + u * maxR * ease * 0.96;
        const lift = maxR * (0.16 + 0.36 * h1) * Math.sin(Math.min(1, k * 1.35) * Math.PI);
        if (lift <= 2) continue;
        g.save();
        g.globalAlpha = (1 - k) * 0.88;
        g.translate(px, sy - lift);
        g.rotate(u * 1.2 + k * (h2 - 0.5) * 5);
        const rw = 8 + h1 * 11;
        const rh = 6 + h2 * 8;
        g.fillStyle = i % 2 === 0 ? '#a47148' : '#7f8c8d';
        g.strokeStyle = '#1f120d';
        g.lineWidth = 2;
        g.fillRect(-rw * 0.5, -rh * 0.5, rw, rh);
        g.strokeRect(-rw * 0.5, -rh * 0.5, rw, rh);
        g.restore();
      }
      g.restore();
    },
  },
};
