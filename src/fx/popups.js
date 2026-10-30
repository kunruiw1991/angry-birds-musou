// Floating damage numbers, pig kill "+5000", and top-centre Musou combo text (owner: juice-audio).
// Pure bus listener + Canvas 2D layer; never mutates physics world. Spec: docs/DESIGN.md §9.
// Note: Damage popup life tuned +25% (0.8s -> 1.0s, within ±30% rule) for readability & G12 peak density.

import { bus } from '../core/bus.js';
import { EV } from '../contracts.js';

const MAX_POPUPS = 80;
const MERGE_WINDOW_S = 0.12;
const MAX_SYNC_MERGES = 3;   // caps merges when stepFrames runs synchronously without update(dt)
const DMG_LIFE_S = 1.0;      // tuned from 0.8s (+25%, within ±30% allowance)
const PIG_LIFE_S = 1.15;
const RISE_METERS = 1.2;
const FONT_STACK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

const pops = [];
let initialized = false;

const combo = {
  active: false,
  count: 0,
  age: 0,
  popAge: 0,
  life: 1.6,
  milestonePop: 0,
};

function tierForDamage(val) {
  if (val >= 500) return { color: '#ff2b2b', stroke: '#2a0000', size: 34 };
  if (val >= 200) return { color: '#ff961a', stroke: '#2b1200', size: 28 };
  if (val >= 50) return { color: '#ffe14a', stroke: '#2b2000', size: 22 };
  return { color: '#ffffff', stroke: '#121822', size: 18 };
}

function insertPopup(item) {
  if (pops.length < MAX_POPUPS) {
    pops.push(item);
    return;
  }
  // Cap 80: drop smallest value (ties broken by oldest age).
  let minIdx = 0;
  let minVal = pops[0].val;
  let maxAgeAtMin = pops[0].age;
  for (let i = 1; i < pops.length; i++) {
    const q = pops[i];
    if (q.val < minVal || (q.val === minVal && q.age > maxAgeAtMin)) {
      minIdx = i;
      minVal = q.val;
      maxAgeAtMin = q.age;
    }
  }
  if (item.val >= minVal || maxAgeAtMin > 0.35) {
    pops.splice(minIdx, 1);
    pops.push(item);
  }
}

function onDamage(p) {
  if (!p || !(p.amount >= 5)) return;
  const amt = Math.round(p.amount);
  const entId = p.id;

  if (entId != null) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const q = pops[i];
      if (q.kind === 'dmg' && q.entId === entId && q.age <= MERGE_WINDOW_S && q.merges < MAX_SYNC_MERGES) {
        q.val += amt;
        q.text = String(q.val);
        const tier = tierForDamage(q.val);
        q.color = tier.color;
        q.stroke = tier.stroke;
        q.size = tier.size;
        q.x = q.x * 0.65 + (p.x ?? q.x) * 0.35;
        q.y0 = Math.max(q.y0, p.y ?? q.y0);
        q.popAge = 0;
        q.merges++;
        return;
      }
    }
  }

  const tier = tierForDamage(amt);
  const jx = (Math.random() - 0.5) * 0.42;
  const jy = (Math.random() - 0.25) * 0.22;
  insertPopup({
    kind: 'dmg',
    entId,
    val: amt,
    text: String(amt),
    color: tier.color,
    stroke: tier.stroke,
    size: tier.size,
    x: (p.x ?? 0) + jx,
    y0: (p.y ?? 0) + jy,
    riseM: RISE_METERS,
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
  insertPopup({
    kind: 'pig',
    entId: null,
    val: pts,
    text: `+${pts}`,
    color: '#66ff38',
    stroke: '#0c2e04',
    size: isBoss ? 34 : 30,
    x: (p.x ?? 0) + (Math.random() - 0.5) * 0.2,
    y0: (p.y ?? 0) + (p.r || 0.45) * 0.55,
    riseM: RISE_METERS * 1.15,
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

  const compact = cam.h < 500 || cam.w < 600;
  const cx = cam.w * 0.5;
  const cy = compact ? Math.max(76, cam.h * 0.21) : Math.max(118, Math.min(162, cam.h * 0.185));

  const pk = Math.min(1, combo.popAge / 0.18);
  // Punchy overshoot scale pop: 1.52 -> 0.96 -> 1.0
  const popScale = pk < 0.7
    ? 1.52 - 0.56 * (pk / 0.7)
    : 0.96 + 0.04 * ((pk - 0.7) / 0.3);
  const milestoneBoost = combo.milestonePop > 0 ? 1 + 0.18 * combo.milestonePop : 1;

  g.save();
  g.globalAlpha = alpha;
  g.translate(cx, cy);
  g.rotate(-0.052); // Cover-art heroic comic tilt (~-3 deg)
  g.scale(popScale * milestoneBoost, popScale * milestoneBoost);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.miterLimit = 2;

  const isMusou = n >= 40;
  const isMega = n >= 20 && n < 40;

  // Radial comic burst spikes behind 大破坏！ and 无双！！
  if (isMusou || isMega) {
    const rays = isMusou ? 16 : 12;
    const rIn = compact ? 26 : 36;
    const rOut = (isMusou ? 118 : 88) * (compact ? 0.72 : 1);
    g.save();
    g.globalAlpha = alpha * (isMusou ? 0.55 : 0.4);
    g.strokeStyle = isMusou ? '#ffe14a' : '#ff9a1a';
    g.lineWidth = isMusou ? 4 : 3;
    g.beginPath();
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + combo.age * 1.4;
      const len = i % 2 === 0 ? rOut : rOut * 0.72;
      g.moveTo(Math.cos(a) * rIn, Math.sin(a) * rIn * 0.55);
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len * 0.55);
    }
    g.stroke();
    g.restore();
  }

  let baseWord = `连击 ×${n}`;
  let bangCount = 0;
  let mainPx = Math.min(compact ? 36 : 48, (compact ? 24 : 30) + (n - 5) * 0.95);
  let subText = '';
  if (isMusou) {
    baseWord = '无双';
    bangCount = 2;
    mainPx = compact ? 48 : 66;
    subText = `连击 ×${n}`;
  } else if (isMega) {
    baseWord = '大破坏';
    bangCount = 1;
    mainPx = compact ? 40 : 54;
    subText = `连击 ×${n}`;
  }

  // Cover-style orange gradient + thick dark cartoon border (with tight optical exclamation kerning)
  g.font = `900 ${Math.round(mainPx)}px ${FONT_STACK}`;
  const grad = g.createLinearGradient(0, -mainPx * 0.55, 0, mainPx * 0.55);
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
    if (bangCount === 0) {
      if (strokeCol) {
        g.lineWidth = strokeW;
        g.strokeStyle = strokeCol;
        g.strokeText(baseWord, 0, yOff);
      }
      if (doFill) {
        g.fillStyle = grad;
        g.fillText(baseWord, 0, yOff);
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
      g.strokeText(baseWord, baseCenterX, yOff);
      for (let b = 0; b < bangCount; b++) {
        const bx = leftX + baseW + (b + 0.55) * bangStep;
        g.strokeText('!', bx, yOff);
      }
    }
    if (doFill) {
      g.fillStyle = grad;
      g.fillText(baseWord, baseCenterX, yOff);
      for (let b = 0; b < bangCount; b++) {
        const bx = leftX + baseW + (b + 0.55) * bangStep;
        g.fillText('!', bx, yOff);
      }
    }
  };

  drawStyledGlyphs(Math.max(6, mainPx * 0.17), '#1a0900', 0, false);
  drawStyledGlyphs(Math.max(2, mainPx * 0.05), '#ffe885', -1, false);
  drawStyledGlyphs(0, null, 0, true);

  if (subText) {
    const subPx = compact ? 22 : 28;
    const subY = mainPx * 0.62 + subPx * 0.42;
    g.font = `900 ${subPx}px ${FONT_STACK}`;
    g.lineWidth = Math.max(5, subPx * 0.2);
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

    for (let i = 0; i < pops.length; i++) {
      const q = pops[i];
      const k = Math.min(1, q.age / q.life);
      const rise = q.riseM * (1 - (1 - k) * (1 - k));
      const sx = cam.sx(q.x);
      const sy = cam.sy(q.y0 + rise);
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
