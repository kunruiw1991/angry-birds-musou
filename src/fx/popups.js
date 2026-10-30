// Floating damage numbers, pig kill "+5000", and top-centre Musou combo text (owner: juice-audio).
// Pure bus listener + Canvas 2D layer; never mutates physics world. Spec: docs/DESIGN.md §9 + #97.
// Readability (#97):
//   - Spatial merge: same 0.9 m cell within 0.15 s -> one summed number (bigger tier)
//   - Drop < 10 unless it's the only live damage popup
//   - Cap 45 live total; '+5000' pig pops cap 6 live (coinciding kills merge to '+10000' / '+15000'...)
//   - Random x-jitter ±0.3 m + slight horizontal fan-out on rise
//   - Combo text strictly inside the 12–30 % vertical screen band across all viewports

import { bus } from '../core/bus.js';
import { EV } from '../contracts.js';

const MAX_POPUPS = 45;
const MAX_PIG_POPUPS = 6;
const CELL_SIZE_M = 0.9;
const MERGE_WINDOW_S = 0.15;
const PIG_COINCIDE_WINDOW_S = 0.38;
const PIG_COINCIDE_DIST_M = 4.2;
const DMG_LIFE_S = 1.0;      // tuned from 0.8s (+25%, within ±30% allowance)
const PIG_LIFE_S = 1.15;
const RISE_METERS = 1.2;
const FONT_STACK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

const pops = [];
let initialized = false;
let spawnSeq = 0;

const combo = {
  active: false,
  count: 0,
  age: 0,
  popAge: 0,
  life: 1.6,
  milestonePop: 0,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function tierForDamage(val) {
  if (val >= 500) return { color: '#ff2b2b', stroke: '#2a0000', size: 34, layer: 3 };
  if (val >= 200) return { color: '#ff961a', stroke: '#2b1200', size: 28, layer: 2 };
  if (val >= 50) return { color: '#ffe14a', stroke: '#2b2000', size: 22, layer: 1 };
  return { color: '#ffffff', stroke: '#121822', size: 18, layer: 0 };
}

function pigSizeForPoints(pts) {
  if (pts >= 20000) return 36;
  if (pts >= 15000) return 34;
  if (pts >= 10000) return 32;
  return 30;
}

function countByKind(kind) {
  let n = 0;
  for (let i = 0; i < pops.length; i++) {
    if (pops[i].kind === kind) n++;
  }
  return n;
}

function findWeakestDamageIdx() {
  let minIdx = -1;
  let minVal = Infinity;
  let maxAgeAtMin = -1;
  for (let i = 0; i < pops.length; i++) {
    const q = pops[i];
    if (q.kind !== 'dmg') continue;
    if (q.val < minVal || (q.val === minVal && q.age > maxAgeAtMin)) {
      minIdx = i;
      minVal = q.val;
      maxAgeAtMin = q.age;
    }
  }
  return minIdx;
}

function insertDamagePopup(item) {
  if (pops.length < MAX_POPUPS) {
    pops.push(item);
    return;
  }
  // Cap 45 live: drop smallest damage popup (ties broken by oldest age).
  const minIdx = findWeakestDamageIdx();
  if (minIdx < 0) return;
  const victim = pops[minIdx];
  if (item.val > victim.val || (item.val === victim.val && victim.age > 0.25) || victim.age > 0.55) {
    pops.splice(minIdx, 1);
    pops.push(item);
  }
}

function mergeIntoPigPopup(q, pts, rx, ry) {
  q.val += pts;
  q.merges += 1;
  q.text = `+${q.val}`;
  q.size = pigSizeForPoints(q.val);
  q.rawX = q.rawX * 0.65 + rx * 0.35;
  q.rawY = Math.max(q.rawY, ry);
  q.x0 = q.x0 * 0.72 + rx * 0.28;
  q.y0 = Math.max(q.y0, ry + 0.25);
  q.popAge = 0;
  q.life = Math.max(q.life, Math.min(PIG_LIFE_S + 0.35, q.age + 0.85));
}

function onDamage(p) {
  if (!p || !(p.amount >= 5)) return;
  const amt = Math.round(p.amount);
  const rx = p.x ?? 0;
  const ry = p.y ?? 0;
  const cx = Math.floor(rx / CELL_SIZE_M);
  const cy = Math.floor(ry / CELL_SIZE_M);
  const entId = p.id;

  // Spatial merge: same 0.9 m cell / 0.9 m box (or same nearby entity) within 0.15 s -> one summed number
  for (let i = pops.length - 1; i >= 0; i--) {
    const q = pops[i];
    if (q.kind !== 'dmg' || q.age > MERGE_WINDOW_S) continue;
    const sameCell = (q.cellX === cx && q.cellY === cy) ||
      (Math.abs(rx - q.rawX) < CELL_SIZE_M && Math.abs(ry - q.rawY) < CELL_SIZE_M);
    const sameEntNear = entId != null && q.entId === entId &&
      Math.abs(rx - q.rawX) <= CELL_SIZE_M * 1.5 && Math.abs(ry - q.rawY) <= CELL_SIZE_M * 1.5;
    if (sameCell || sameEntNear) {
      q.val += amt;
      q.merges += 1;
      q.text = String(q.val);
      const tier = tierForDamage(q.val);
      q.color = tier.color;
      q.stroke = tier.stroke;
      q.size = tier.size;
      q.layer = tier.layer;
      q.rawX = q.rawX * 0.7 + rx * 0.3;
      q.rawY = Math.max(q.rawY, ry);
      q.y0 = Math.max(q.y0, ry + 0.04);
      q.popAge = 0;
      return;
    }
  }

  // Drop < 10 unless it's the only live damage popup on screen
  if (amt < 10 && countByKind('dmg') > 0) return;

  const seq = spawnSeq++;
  const tier = tierForDamage(amt);
  const jx = (Math.random() * 2 - 1) * 0.30; // random x-jitter ±0.3 m
  const jy = (Math.random() * 2 - 1) * 0.14;
  let x0 = rx + jx;
  let y0 = ry + jy;
  const slot = (seq % 7) - 3;                // -3..+3 alternating fan slot
  let fanDx = clamp(jx * 0.9 + slot * 0.13, -0.58, 0.58);

  // Soft anti-overlap nudge so adjacent cells fan away instead of crossing over each other
  for (let i = pops.length - 1; i >= 0; i--) {
    const q = pops[i];
    if (q.age > 0.42) continue;
    const dx = x0 - q.x0;
    const dy = y0 - q.y0;
    if (Math.abs(dx) < 0.92 && Math.abs(dy) < 0.52) {
      const pushDir = dx >= 0 ? 1 : -1;
      x0 += pushDir * 0.24;
      y0 += dy >= 0 ? 0.28 : -0.22;
      fanDx = clamp(fanDx + pushDir * 0.18, -0.65, 0.65);
      break;
    }
  }
  const riseM = RISE_METERS * (0.94 + (seq % 3) * 0.08);

  insertDamagePopup({
    kind: 'dmg',
    layer: tier.layer,
    entId,
    cellX: cx,
    cellY: cy,
    rawX: rx,
    rawY: ry,
    val: amt,
    text: String(amt),
    color: tier.color,
    stroke: tier.stroke,
    size: tier.size,
    x0,
    y0,
    fanDx,
    riseM,
    age: 0,
    popAge: 0,
    life: DMG_LIFE_S,
    merges: 1,
  });
}

function onPigPop(p) {
  if (!p) return;
  const isBoss = !!p.boss;
  const pts = isBoss ? 20000 : 5000;
  const rx = p.x ?? 0;
  const ry = p.y ?? 0;

  // Nudge any fresh damage popup on the same pig slightly lower so '+5000' floats cleanly above it
  for (let i = pops.length - 1; i >= 0; i--) {
    const q = pops[i];
    if (q.kind === 'dmg' && q.age < 0.12 && Math.abs(q.rawX - rx) < 0.8 && Math.abs(q.rawY - ry) < 0.8) {
      q.y0 -= 0.16;
    }
  }

  // Coinciding pig kills merge to '+10000' / '+15000'...
  let coincideTarget = null;
  let coincideBestDist = PIG_COINCIDE_DIST_M;
  for (let i = pops.length - 1; i >= 0; i--) {
    const q = pops[i];
    if (q.kind !== 'pig' || q.age > PIG_COINCIDE_WINDOW_S) continue;
    const d = Math.hypot(rx - q.rawX, ry - q.rawY);
    if (d <= coincideBestDist) {
      coincideBestDist = d;
      coincideTarget = q;
    }
  }
  if (coincideTarget) {
    mergeIntoPigPopup(coincideTarget, pts, rx, ry);
    return;
  }

  // Cap 6 live '+5000' pig popups: if already at 6, merge into nearest live pig popup
  let pigCount = 0;
  let nearestPig = null;
  let nearestDist = Infinity;
  for (let i = 0; i < pops.length; i++) {
    const q = pops[i];
    if (q.kind !== 'pig') continue;
    pigCount++;
    const d = Math.hypot(rx - q.rawX, ry - q.rawY);
    if (d < nearestDist) {
      nearestDist = d;
      nearestPig = q;
    }
  }
  if (pigCount >= MAX_PIG_POPUPS && nearestPig) {
    mergeIntoPigPopup(nearestPig, pts, rx, ry);
    return;
  }

  if (pops.length >= MAX_POPUPS) {
    const dropIdx = findWeakestDamageIdx();
    if (dropIdx >= 0) {
      pops.splice(dropIdx, 1);
    } else {
      return;
    }
  }

  const seq = spawnSeq++;
  const jx = (Math.random() * 2 - 1) * 0.26;
  const fanDx = clamp(jx * 0.8 + ((seq % 5) - 2) * 0.14, -0.52, 0.52);
  pops.push({
    kind: 'pig',
    layer: 4,
    entId: null,
    cellX: Math.floor(rx / CELL_SIZE_M),
    cellY: Math.floor(ry / CELL_SIZE_M),
    rawX: rx,
    rawY: ry,
    val: pts,
    text: `+${pts}`,
    color: '#66ff38',
    stroke: '#0c2e04',
    size: isBoss ? 36 : pigSizeForPoints(pts),
    x0: rx + jx,
    y0: ry + Math.max(0.78, (p.r || 0.45) + 0.35),
    fanDx,
    riseM: RISE_METERS * 1.22,
    age: 0,
    popAge: 0,
    life: PIG_LIFE_S,
    merges: 1,
  });
}

function onCombo(p) {
  if (!p || !(p.count >= 5)) return;
  const prev = combo.active ? combo.count : 0;
  combo.active = true;
  combo.count = p.count;
  combo.age = 0;
  combo.popAge = 0;
  combo.life = p.count >= 40 ? 2.2 : p.count >= 20 ? 1.9 : 1.5;
  if ((prev < 40 && p.count >= 40) || (prev < 20 && p.count >= 20)) {
    combo.milestonePop = 1;
  }
}

function drawComboBanner(g, cam) {
  if (!combo.active || combo.age >= combo.life) return;
  const n = combo.count;
  const k = combo.age / combo.life;
  const alpha = k < 0.72 ? 1 : Math.max(0, (1 - k) / 0.28);
  if (alpha <= 0.01) return;

  // Hard band invariant (#97): entire combo graphic stays strictly inside [12%, 30%] of cam.h,
  // and clears top HUD pill / Boss HP bar cleanly across 1280x800, 1024x768, 844x390, 390x844.
  const compactH = cam.h < 500;
  const portrait = cam.w <= 600 && cam.h >= 650;
  const bandTop = cam.h * 0.122;
  const bandBot = cam.h * 0.296;
  let safeTop = bandTop;
  if (portrait) {
    safeTop = Math.max(bandTop, Math.min(144, bandBot - 84));
  } else if (!compactH) {
    safeTop = Math.max(bandTop, Math.min(109, bandBot - 96));
  }
  const availH = Math.max(44, bandBot - safeTop);

  const isMusou = n >= 40;
  const isMega = n >= 20 && n < 40;

  let baseWord = `连击 ×${n}`;
  let bangCount = 0;
  let mainPx = compactH
    ? Math.min(30, 20 + (n - 5) * 0.65)
    : Math.min(44, 28 + (n - 5) * 0.9);
  let subText = '';
  let subPx = compactH ? 15 : 24;

  if (isMusou) {
    baseWord = '无双';
    bangCount = 2;
    mainPx = compactH ? 34 : 56;
    subText = `连击 ×${n}`;
  } else if (isMega) {
    baseWord = '大破坏';
    bangCount = 1;
    mainPx = compactH ? 30 : 48;
    subText = `连击 ×${n}`;
  }

  // Center 2-line layout around local y=0 so top & bottom bounds stay symmetric
  const mainY = subText ? -subPx * 0.50 : 0;
  const subY = subText ? mainPx * 0.46 + subPx * 0.22 : 0;
  const estHalfW = mainPx * (baseWord.length * 0.55 + bangCount * 0.22);
  const tiltPad = estHalfW * 0.055;
  const rOut = (isMusou ? 96 : 76) * (compactH ? 0.58 : 1);
  const rayHalfH = (isMusou || isMega) ? rOut * 0.40 : 0;

  const localTop = Math.min(mainY - mainPx * 0.58 - tiltPad, -rayHalfH);
  const localBot = Math.max(
    subText ? subY + subPx * 0.62 + tiltPad : mainY + mainPx * 0.58 + tiltPad,
    rayHalfH,
  );
  const localSpan = Math.max(1, localBot - localTop);

  const pk = Math.min(1, combo.popAge / 0.18);
  const popScale = pk < 0.7
    ? 1.44 - 0.48 * (pk / 0.7)
    : 0.96 + 0.04 * ((pk - 0.7) / 0.3);
  const milestoneBoost = combo.milestonePop > 0 ? 1 + 0.14 * combo.milestonePop : 1;
  const scale = Math.min(popScale * milestoneBoost, availH / localSpan);

  const cx = cam.w * 0.5;
  const idealCy = safeTop + availH * 0.48 - (localTop + localBot) * 0.5 * scale;
  const cy = clamp(idealCy, safeTop - localTop * scale, bandBot - localBot * scale);

  g.save();
  g.globalAlpha = alpha;
  g.translate(cx, cy);
  g.rotate(-0.052); // Cover-art heroic comic tilt (~-3 deg)
  g.scale(scale, scale);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.miterLimit = 2;

  // Radial comic burst spikes behind 大破坏！ and 无双！！
  if (isMusou || isMega) {
    const rays = isMusou ? 16 : 12;
    const rIn = compactH ? 20 : 32;
    g.save();
    g.globalAlpha = alpha * (isMusou ? 0.55 : 0.4);
    g.strokeStyle = isMusou ? '#ffe14a' : '#ff9a1a';
    g.lineWidth = isMusou ? 3.5 : 2.8;
    g.beginPath();
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + combo.age * 1.4;
      const len = i % 2 === 0 ? rOut : rOut * 0.72;
      g.moveTo(Math.cos(a) * rIn, Math.sin(a) * rIn * 0.40);
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len * 0.40);
    }
    g.stroke();
    g.restore();
  }

  // Cover-style orange gradient + thick dark cartoon border (with tight optical exclamation kerning)
  g.font = `900 ${Math.round(mainPx)}px ${FONT_STACK}`;
  const grad = g.createLinearGradient(0, mainY - mainPx * 0.55, 0, mainY + mainPx * 0.55);
  if (isMusou) {
    grad.addColorStop(0, '#fff066');
    grad.addColorStop(0.45, '#ff6a1a');
    grad.addColorStop(1, '#ff2a00');
  } else {
    grad.addColorStop(0, '#ffd447');
    grad.addColorStop(0.55, '#ff6a1a');
    grad.addColorStop(1, '#e63e00');
  }

  const drawStyledGlyphs = (strokeW, strokeCol, yOff = 0, doFill = false) => {
    const yy = mainY + yOff;
    if (bangCount === 0) {
      if (strokeCol) {
        g.lineWidth = strokeW;
        g.strokeStyle = strokeCol;
        g.strokeText(baseWord, 0, yy);
      }
      if (doFill) {
        g.fillStyle = grad;
        g.fillText(baseWord, 0, yy);
      }
      return;
    }
    const baseW = g.measureText(baseWord).width;
    const bangStep = mainPx * 0.36;
    const totalW = baseW + bangCount * bangStep;
    const leftX = -totalW * 0.5;
    const baseCenterX = leftX + baseW * 0.5;
    if (strokeCol) {
      g.lineWidth = strokeW;
      g.strokeStyle = strokeCol;
      g.strokeText(baseWord, baseCenterX, yy);
      for (let b = 0; b < bangCount; b++) {
        const bx = leftX + baseW + (b + 0.55) * bangStep;
        g.strokeText('!', bx, yy);
      }
    }
    if (doFill) {
      g.fillStyle = grad;
      g.fillText(baseWord, baseCenterX, yy);
      for (let b = 0; b < bangCount; b++) {
        const bx = leftX + baseW + (b + 0.55) * bangStep;
        g.fillText('!', bx, yy);
      }
    }
  };

  drawStyledGlyphs(Math.max(5.5, mainPx * 0.17), '#1a0900', 0, false);
  drawStyledGlyphs(Math.max(1.8, mainPx * 0.05), '#ffe885', -1, false);
  drawStyledGlyphs(0, null, 0, true);

  if (subText) {
    g.font = `900 ${subPx}px ${FONT_STACK}`;
    g.lineWidth = Math.max(4.5, subPx * 0.2);
    g.strokeStyle = '#1a0900';
    g.strokeText(subText, 0, subY);
    g.fillStyle = '#ffd23f';
    g.fillText(subText, 0, subY);
  }

  g.restore();
}

export const popups = {
  init() {
    if (initialized) return;
    initialized = true;
    bus.on(EV.DAMAGE, onDamage);
    bus.on(EV.PIG_POP, onPigPop);
    bus.on(EV.COMBO, onCombo);
    bus.on(EV.LEVEL_START, () => this.clear());
  },

  update(dt) {
    if (!(dt > 0)) return;
    for (let i = pops.length - 1; i >= 0; i--) {
      const q = pops[i];
      q.age += dt;
      q.popAge += dt;
      if (q.age >= q.life) {
        pops.splice(i, 1);
      }
    }
    if (combo.active) {
      combo.age += dt;
      combo.popAge += dt;
      combo.milestonePop = Math.max(0, combo.milestonePop - dt * 3.5);
      if (combo.age >= combo.life) {
        combo.active = false;
      }
    }
  },

  draw(g, cam) {
    if (!g || !cam) return;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.miterLimit = 2;

    // Draw smaller tiers behind bigger crits & '+5000/+15000' pig kills for crisp readability
    for (let layer = 0; layer <= 4; layer++) {
      for (let i = 0; i < pops.length; i++) {
        const q = pops[i];
        if (q.layer !== layer) continue;
        const k = Math.min(1, q.age / q.life);
        const riseFrac = 1 - (1 - k) * (1 - k);
        const sx = cam.sx(q.x0 + q.fanDx * riseFrac);
        const sy = cam.sy(q.y0 + q.riseM * riseFrac);
        if (sx < -90 || sx > cam.w + 90 || sy < -90 || sy > cam.h + 90) continue;

        // Fade last 40%
        const alpha = k < 0.6 ? 1 : Math.max(0, (1 - k) / 0.4);
        if (alpha <= 0.01) continue;

        // Scale pop 1.4 -> 1.0
        const pk = Math.min(1, q.popAge / 0.16);
        const scale = 1 + 0.4 * (1 - pk) * (1 - pk);
        const px = Math.max(12, Math.round(q.size * scale));

        g.globalAlpha = alpha;
        g.font = `900 ${px}px ${FONT_STACK}`;
        g.lineWidth = Math.max(3.5, px * 0.19);
        g.strokeStyle = q.stroke;
        g.strokeText(q.text, sx, sy);
        g.fillStyle = q.color;
        g.fillText(q.text, sx, sy);
      }
    }

    g.globalAlpha = 1;
    drawComboBanner(g, cam);
    g.restore();
  },

  count() {
    return pops.length;
  },

  clear() {
    pops.length = 0;
    combo.active = false;
    combo.count = 0;
    combo.age = 0;
    combo.popAge = 0;
    combo.milestonePop = 0;
  },

  comboState() {
    return { active: combo.active, count: combo.count, age: combo.age, life: combo.life };
  },
};
