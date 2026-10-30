// Offscreen sprite atlas cache + procedural cartoon sprites for blocks, pigs, balloons, poison,
// and slingshot (owner: render-art). Spec: docs/DESIGN.md §8.
// Zero shadowBlur in per-entity loops; sprites are shelf-packed into shared 1024x1024 offscreen
// atlas sheets keyed by (type, sizeBucket, damageStage, zoomBucket) so zero per-sprite <canvas>
// contexts are allocated during gameplay chaos!

const ZOOM_BUCKETS = [44, 88];
const ATLAS_SIZE = 1024;
const MAX_ATLAS_SHEETS = 6;
const _spriteCache = new Map();
const _sheets = [];

function pickZoomBucket(pxPerM) {
  return pxPerM <= 48 ? ZOOM_BUCKETS[0] : ZOOM_BUCKETS[1];
}

function qSize(v) {
  return Math.round((v || 0) * 50) / 50;
}

function allocAtlasSlot(pw, ph) {
  const w = Math.max(4, Math.ceil(pw));
  const h = Math.max(4, Math.ceil(ph));
  if (w > ATLAS_SIZE - 4 || h > ATLAS_SIZE - 4) {
    // Oversized sprite fallback canvas
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return { sheet: c, g: c.getContext('2d'), sx: 0, sy: 0, sw: w, sh: h };
  }
  let cur = _sheets[_sheets.length - 1];
  if (cur && cur.x + w + 2 > ATLAS_SIZE) {
    cur.x = 1;
    cur.y += cur.rowH + 2;
    cur.rowH = 0;
  }
  if (!cur || cur.y + h + 2 > ATLAS_SIZE) {
    if (_sheets.length >= MAX_ATLAS_SHEETS) {
      // Recycle all sheets cleanly if cap ever reached
      _sheets.length = 0;
      _spriteCache.clear();
    }
    const c = document.createElement('canvas');
    c.width = ATLAS_SIZE;
    c.height = ATLAS_SIZE;
    cur = { canvas: c, g: c.getContext('2d'), x: 1, y: 1, rowH: 0 };
    _sheets.push(cur);
  }
  const sx = cur.x, sy = cur.y;
  cur.x += w + 2;
  if (h > cur.rowH) cur.rowH = h;
  return { sheet: cur.canvas, g: cur.g, sx, sy, sw: w, sh: h };
}

function buildOnAtlas(wM, hM, oxM, oyM, zb, drawFn) {
  const slot = allocAtlasSlot(wM * zb, hM * zb);
  const g = slot.g;
  g.save();
  g.beginPath();
  g.rect(slot.sx, slot.sy, slot.sw, slot.sh);
  g.clip();
  g.translate(slot.sx + oxM * zb, slot.sy + oyM * zb);
  g.scale(zb, zb);
  drawFn(g);
  g.restore();
  return {
    sheet: slot.sheet,
    sx: slot.sx,
    sy: slot.sy,
    sw: slot.sw,
    sh: slot.sh,
    wM,
    hM,
    oxM,
    oyM,
  };
}

function getCached(key, buildFn) {
  let entry = _spriteCache.get(key);
  if (entry) return entry;
  entry = buildFn();
  _spriteCache.set(key, entry);
  return entry;
}

export function blockDamageStage(ent) {
  if (!(ent.maxHp < Infinity) || ent.maxHp <= 0) return 0;
  const ratio = ent.hp / ent.maxHp;
  if (ratio < 0.33) return 2;
  if (ratio < 0.66) return 1;
  return 0;
}

export function pigDamageStage(ent) {
  if (!(ent.maxHp < Infinity) || ent.maxHp <= 0) return 0;
  const ratio = ent.hp / ent.maxHp;
  if (ratio < 0.25) return 3;
  if (ratio < 0.50) return 2;
  if (ratio < 0.66) return 1;
  return 0;
}

// ---------------- BLOCK SPRITES ----------------

function drawBoxCracks(g, w, h, stage) {
  if (stage <= 0) return;
  const hw = w / 2, hh = h / 2;
  const lw = Math.max(0.025, Math.min(w, h) * 0.055);

  const strokeCrack = (pts) => {
    g.strokeStyle = 'rgba(255,255,255,0.38)';
    g.lineWidth = lw * 0.9;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x + lw * 0.35, y + lw * 0.35) : g.moveTo(x + lw * 0.35, y + lw * 0.35)));
    g.stroke();

    g.strokeStyle = '#1b1b1b';
    g.lineWidth = lw;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  };

  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Stage 1 (< 66% hp): primary fracture from top-left & bottom-right
  strokeCrack([
    [-hw * 0.62, -hh * 0.96],
    [-hw * 0.28, -hh * 0.32],
    [-hw * 0.04, -hh * 0.10],
    [hw * 0.18, hh * 0.22],
  ]);
  strokeCrack([
    [-hw * 0.28, -hh * 0.32],
    [-hw * 0.52, hh * 0.08],
  ]);

  if (stage >= 2) {
    // Stage 2 (< 33% hp): heavy branching web across entire block
    strokeCrack([
      [hw * 0.68, -hh * 0.95],
      [hw * 0.25, -hh * 0.25],
      [-hw * 0.08, hh * 0.14],
      [-hw * 0.45, hh * 0.94],
    ]);
    strokeCrack([
      [hw * 0.25, -hh * 0.25],
      [hw * 0.72, hh * 0.32],
    ]);
    strokeCrack([
      [hw * 0.95, hh * 0.55],
      [hw * 0.30, hh * 0.48],
      [hw * 0.06, hh * 0.95],
    ]);
  }
}

function drawWoodBox(g, w, h) {
  const hw = w / 2, hh = h / 2;
  const b = Math.min(0.055, Math.min(w, h) * 0.12);
  g.fillStyle = '#d48a38';
  g.fillRect(-hw, -hh, w, h);

  // Top/left light bevel & bottom/right shadow bevel
  g.fillStyle = '#eea856';
  g.fillRect(-hw, -hh, w, b * 1.3);
  g.fillRect(-hw, -hh, b * 1.1, h);
  g.fillStyle = '#ad681e';
  g.fillRect(-hw, hh - b * 1.3, w, b * 1.3);
  g.fillRect(hw - b * 1.1, -hh, b * 1.1, h);

  const ratio = w / h;
  const minD = Math.min(w, h);
  if (ratio >= 0.62 && ratio <= 1.62 && minD >= 0.42) {
    // Square wood frame look (like the video's hollow/inset wood cubes!)
    const ins = minD * 0.23;
    g.fillStyle = '#9e5c19';
    g.fillRect(-hw + ins, -hh + ins, w - ins * 2, h - ins * 2);
    g.strokeStyle = '#693a12';
    g.lineWidth = Math.max(0.03, b * 0.85);
    g.strokeRect(-hw + ins, -hh + ins, w - ins * 2, h - ins * 2);
    // Subtle diagonal plank strut inside
    g.strokeStyle = '#bc7327';
    g.lineWidth = ins * 0.55;
    g.beginPath();
    g.moveTo(-hw + ins * 1.15, hh - ins * 1.15);
    g.lineTo(hw - ins * 1.15, -hh + ins * 1.15);
    g.stroke();
  } else {
    // Plank grain lines along the long axis
    g.strokeStyle = 'rgba(110, 58, 16, 0.42)';
    g.lineWidth = Math.max(0.018, minD * 0.06);
    if (w >= h) {
      g.beginPath();
      g.moveTo(-hw + 0.08, -hh * 0.28);
      g.lineTo(hw - 0.08, -hh * 0.22);
      g.moveTo(-hw + 0.12, hh * 0.26);
      g.lineTo(hw - 0.06, hh * 0.30);
      g.stroke();
    } else {
      g.beginPath();
      g.moveTo(-hw * 0.28, -hh + 0.08);
      g.lineTo(-hw * 0.22, hh - 0.08);
      g.moveTo(hw * 0.26, -hh + 0.12);
      g.lineTo(hw * 0.30, hh - 0.06);
      g.stroke();
    }
  }

  g.strokeStyle = '#693a12';
  g.lineWidth = Math.max(0.038, b);
  g.strokeRect(-hw + b * 0.4, -hh + b * 0.4, w - b * 0.8, h - b * 0.8);
}

function drawGlassBox(g, w, h) {
  const hw = w / 2, hh = h / 2;
  const b = Math.min(0.05, Math.min(w, h) * 0.11);
  g.fillStyle = 'rgba(166, 232, 255, 0.78)';
  g.fillRect(-hw, -hh, w, h);

  // Frosty inner rim
  g.strokeStyle = 'rgba(238, 253, 255, 0.88)';
  g.lineWidth = b * 1.2;
  g.strokeRect(-hw + b * 1.1, -hh + b * 1.1, w - b * 2.2, h - b * 2.2);

  // Square glass blocks get a crisp icy inset square (video style)
  const ratio = w / h, minD = Math.min(w, h);
  if (ratio >= 0.6 && ratio <= 1.65 && minD >= 0.4) {
    const ins = minD * 0.24;
    g.fillStyle = 'rgba(125, 208, 245, 0.55)';
    g.fillRect(-hw + ins, -hh + ins, w - ins * 2, h - ins * 2);
    g.strokeStyle = '#53a8d4';
    g.lineWidth = Math.max(0.026, b * 0.75);
    g.strokeRect(-hw + ins, -hh + ins, w - ins * 2, h - ins * 2);
  }

  // Diagonal specular glints
  g.save();
  g.beginPath();
  g.rect(-hw + b, -hh + b, w - b * 2, h - b * 2);
  g.clip();
  g.fillStyle = 'rgba(255, 255, 255, 0.68)';
  g.beginPath();
  g.moveTo(-hw * 0.75, -hh);
  g.lineTo(-hw * 0.30, -hh);
  g.lineTo(-hw * 0.85, hh);
  g.lineTo(-hw * 1.25, hh);
  g.closePath();
  g.fill();

  g.beginPath();
  g.moveTo(-hw * 0.05, -hh);
  g.lineTo(hw * 0.14, -hh);
  g.lineTo(-hw * 0.40, hh);
  g.lineTo(-hw * 0.58, hh);
  g.closePath();
  g.fill();
  g.restore();

  g.strokeStyle = '#479ec9';
  g.lineWidth = Math.max(0.036, b);
  g.strokeRect(-hw + b * 0.4, -hh + b * 0.4, w - b * 0.8, h - b * 0.8);
}

function drawStoneInsetPanel(g, x, y, w, h, b) {
  const ins = Math.min(w, h) * 0.22;
  if (w - ins * 2 <= 0.06 || h - ins * 2 <= 0.06) return;
  // Recessed dark-grey square ring (iconic video hollow stone square look!)
  g.fillStyle = '#757c83';
  g.fillRect(x + ins, y + ins, w - ins * 2, h - ins * 2);
  g.strokeStyle = '#484e54';
  g.lineWidth = Math.max(0.028, b * 0.85);
  g.strokeRect(x + ins, y + ins, w - ins * 2, h - ins * 2);

  const ins2 = ins * 1.85;
  if (w - ins2 * 2 > 0.08 && h - ins2 * 2 > 0.08) {
    g.fillStyle = '#aeb4ba';
    g.fillRect(x + ins2, y + ins2, w - ins2 * 2, h - ins2 * 2);
    g.strokeStyle = '#555c63';
    g.lineWidth = Math.max(0.022, b * 0.65);
    g.strokeRect(x + ins2, y + ins2, w - ins2 * 2, h - ins2 * 2);
  }
}

function drawStoneBox(g, w, h) {
  const hw = w / 2, hh = h / 2;
  const b = Math.min(0.055, Math.min(w, h) * 0.12);
  g.fillStyle = '#a3a9ae';
  g.fillRect(-hw, -hh, w, h);

  // Bevels
  g.fillStyle = '#cbd1d6';
  g.fillRect(-hw, -hh, w, b * 1.25);
  g.fillRect(-hw, -hh, b * 1.15, h);
  g.fillStyle = '#7d8389';
  g.fillRect(-hw, hh - b * 1.25, w, b * 1.25);
  g.fillRect(hw - b * 1.15, -hh, b * 1.15, h);

  const ratio = w / h;
  if (ratio >= 0.58 && ratio <= 1.72) {
    drawStoneInsetPanel(g, -hw, -hh, w, h, b);
  } else if (w > h * 1.72) {
    // Segmented stone beam
    const segs = Math.max(2, Math.min(6, Math.round(w / Math.max(0.45, h * 1.35))));
    const sw = w / segs;
    for (let i = 0; i < segs; i++) {
      const sx = -hw + i * sw;
      if (i > 0) {
        g.strokeStyle = '#52585e';
        g.lineWidth = Math.max(0.025, b * 0.7);
        g.beginPath();
        g.moveTo(sx, -hh + b);
        g.lineTo(sx, hh - b);
        g.stroke();
      }
      drawStoneInsetPanel(g, sx, -hh, sw, h, b * 0.85);
    }
  } else {
    // Segmented vertical stone pillar
    const segs = Math.max(2, Math.min(6, Math.round(h / Math.max(0.45, w * 1.35))));
    const sh = h / segs;
    for (let i = 0; i < segs; i++) {
      const sy = -hh + i * sh;
      if (i > 0) {
        g.strokeStyle = '#52585e';
        g.lineWidth = Math.max(0.025, b * 0.7);
        g.beginPath();
        g.moveTo(-hw + b, sy);
        g.lineTo(hw - b, sy);
        g.stroke();
      }
      drawStoneInsetPanel(g, -hw, sy, w, sh, b * 0.85);
    }
  }

  g.strokeStyle = '#4c5257';
  g.lineWidth = Math.max(0.04, b);
  g.strokeRect(-hw + b * 0.4, -hh + b * 0.4, w - b * 0.8, h - b * 0.8);
}

function drawTntBox(g, w, h) {
  const hw = w / 2, hh = h / 2;
  const b = Math.min(0.055, Math.min(w, h) * 0.11);

  // Red crate core
  g.fillStyle = '#dc3127';
  g.fillRect(-hw, -hh, w, h);

  // Darker red horizontal plank seams
  g.fillStyle = '#b5221a';
  g.fillRect(-hw, -hh + h * 0.22, w, h * 0.06);
  g.fillRect(-hw, hh - h * 0.28, w, h * 0.06);

  // Warm wood outer rim slats
  const rim = Math.min(w, h) * 0.13;
  g.strokeStyle = '#c97e32';
  g.lineWidth = rim;
  g.strokeRect(-hw + rim * 0.5, -hh + rim * 0.5, w - rim, h - rim);

  // White TNT center band
  const bandH = h * 0.36;
  g.fillStyle = '#f8f3e6';
  g.fillRect(-hw + rim * 0.7, -bandH / 2, w - rim * 1.4, bandH);
  g.strokeStyle = '#4a1c14';
  g.lineWidth = Math.max(0.022, b * 0.55);
  g.strokeRect(-hw + rim * 0.7, -bandH / 2, w - rim * 1.4, bandH);

  // Bold "TNT" lettering
  const fontSize = Math.min(bandH * 0.82, w * 0.34);
  g.fillStyle = '#181210';
  g.font = `900 ${fontSize.toFixed(3)}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TNT', 0, bandH * 0.04);

  // Outer dark border
  g.strokeStyle = '#4d1b12';
  g.lineWidth = Math.max(0.04, b);
  g.strokeRect(-hw + b * 0.4, -hh + b * 0.4, w - b * 0.8, h - b * 0.8);
}

function drawCircleBlock(g, mat, r, stage) {
  const b = Math.max(0.038, r * 0.10);
  if (mat === 'wood') {
    g.fillStyle = '#d48a38';
    g.beginPath(); g.arc(0, 0, r - b * 0.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#9e5c19'; g.lineWidth = r * 0.09;
    g.beginPath(); g.arc(0, 0, r * 0.62, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, r * 0.28, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#693a12'; g.lineWidth = b;
    g.beginPath(); g.arc(0, 0, r - b * 0.5, 0, Math.PI * 2); g.stroke();
  } else if (mat === 'glass') {
    g.fillStyle = 'rgba(166, 232, 255, 0.78)';
    g.beginPath(); g.arc(0, 0, r - b * 0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.72)';
    g.beginPath(); g.ellipse(-r * 0.28, -r * 0.28, r * 0.32, r * 0.16, -0.7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#479ec9'; g.lineWidth = b;
    g.beginPath(); g.arc(0, 0, r - b * 0.5, 0, Math.PI * 2); g.stroke();
  } else if (mat === 'tnt') {
    drawTntBox(g, r * 1.8, r * 1.8);
  } else {
    // Stone boulder
    g.fillStyle = '#9ea4aa';
    g.beginPath(); g.arc(0, 0, r - b * 0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c4cacf';
    g.beginPath(); g.arc(-r * 0.18, -r * 0.20, r * 0.58, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7e848a';
    g.beginPath(); g.arc(r * 0.15, r * 0.18, r * 0.45, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#4c5257'; g.lineWidth = b;
    g.beginPath(); g.arc(0, 0, r - b * 0.5, 0, Math.PI * 2); g.stroke();
  }
  if (stage > 0) drawBoxCracks(g, r * 1.4, r * 1.4, stage);
}

function drawPolyBlock(g, mat, verts, stage) {
  const pal = mat === 'wood'
    ? { fill: '#d48a38', inFill: '#9e5c19', stroke: '#693a12' }
    : mat === 'glass'
    ? { fill: 'rgba(166,232,255,0.78)', inFill: 'rgba(120,205,245,0.55)', stroke: '#479ec9' }
    : { fill: '#a3a9ae', inFill: '#757c83', stroke: '#4c5257' };

  g.fillStyle = pal.fill;
  g.strokeStyle = pal.stroke;
  g.lineWidth = 0.05;
  g.lineJoin = 'round';
  g.beginPath();
  verts.forEach((v, i) => (i ? g.lineTo(v.x, -v.y) : g.moveTo(v.x, -v.y)));
  g.closePath();
  g.fill();
  g.stroke();

  // Inset hollow cutout around centroid (exact match to video's hollow wood/stone triangles!)
  let cx = 0, cy = 0;
  for (const v of verts) { cx += v.x; cy += -v.y; }
  cx /= verts.length; cy /= verts.length;
  g.fillStyle = pal.inFill;
  g.lineWidth = 0.036;
  g.beginPath();
  verts.forEach((v, i) => {
    const ix = cx + (v.x - cx) * 0.50;
    const iy = cy + (-v.y - cy) * 0.50;
    if (i) g.lineTo(ix, iy); else g.moveTo(ix, iy);
  });
  g.closePath();
  g.fill();
  g.stroke();

  if (stage > 0) drawBoxCracks(g, 0.7, 0.7, stage);
}

/** Return cached atlas sprite descriptor for a block entity. */
export function getBlockSprite(ent, pxPerM) {
  const zb = pickZoomBucket(pxPerM);
  const stage = blockDamageStage(ent);
  const mat = ent.mat || 'wood';

  if (ent.shape === 'circle') {
    const r = qSize(ent.r || 0.4);
    const key = `bc:${mat}:${r}:${stage}:${zb}`;
    return getCached(key, () => {
      const pad = 0.08;
      const wM = (r + pad) * 2, hM = (r + pad) * 2;
      return buildOnAtlas(wM, hM, wM / 2, hM / 2, zb, (g) => drawCircleBlock(g, mat, r, stage));
    });
  }

  if (ent.shape === 'poly' && ent.verts && ent.verts.length) {
    const vKey = ent.verts.map((v) => `${qSize(v.x)},${qSize(v.y)}`).join(';');
    const key = `bp:${mat}:${vKey}:${stage}:${zb}`;
    return getCached(key, () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const v of ent.verts) {
        const vx = v.x, vy = -v.y;
        if (vx < x0) x0 = vx; if (vx > x1) x1 = vx;
        if (vy < y0) y0 = vy; if (vy > y1) y1 = vy;
      }
      const pad = 0.08;
      const wM = (x1 - x0) + pad * 2;
      const hM = (y1 - y0) + pad * 2;
      const oxM = -x0 + pad;
      const oyM = -y0 + pad;
      return buildOnAtlas(wM, hM, oxM, oyM, zb, (g) => drawPolyBlock(g, mat, ent.verts, stage));
    });
  }

  const w = qSize(ent.w || 0.8);
  const h = qSize(ent.h || 0.4);
  const key = `bb:${mat}:${w}x${h}:${stage}:${zb}`;
  return getCached(key, () => {
    const pad = 0.06;
    const wM = w + pad * 2, hM = h + pad * 2;
    return buildOnAtlas(wM, hM, wM / 2, hM / 2, zb, (g) => {
      if (mat === 'glass') drawGlassBox(g, w, h);
      else if (mat === 'stone') drawStoneBox(g, w, h);
      else if (mat === 'tnt') drawTntBox(g, w, h);
      else drawWoodBox(g, w, h);
      drawBoxCracks(g, w, h, stage);
    });
  });
}

// ---------------- PIG SPRITES + TRACKING EYES ----------------

function drawStar5(g, cx, cy, outerR, innerR) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? outerR : innerR;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
}

function drawPigBase(g, variant, r, stage) {
  const lw = Math.max(0.04, r * 0.09);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // 0. Royal cape behind boss_king
  if (variant === 'boss_king') {
    g.fillStyle = '#c41e2e';
    g.strokeStyle = '#4a0810';
    g.lineWidth = lw;
    g.beginPath();
    g.moveTo(-r * 0.85, -r * 0.25);
    g.quadraticCurveTo(-r * 1.32, r * 0.55, -r * 1.15, r * 1.02);
    g.lineTo(r * 1.15, r * 1.02);
    g.quadraticCurveTo(r * 1.32, r * 0.55, r * 0.85, -r * 0.25);
    g.closePath();
    g.fill();
    g.stroke();

    // White ermine fur collar
    g.fillStyle = '#f8f8f5';
    g.beginPath();
    g.ellipse(0, -r * 0.35, r * 1.05, r * 0.28, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  // 1. Round pig ears (unless covered by helmet)
  if (variant !== 'helmet' && variant !== 'boss_helmet') {
    for (const sx of [-1, 1]) {
      g.fillStyle = '#7ac943';
      g.strokeStyle = '#2d5914';
      g.lineWidth = lw * 0.9;
      g.beginPath();
      g.ellipse(sx * r * 0.66, -r * 0.72, r * 0.20, r * 0.24, sx * 0.35, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#4c8c22';
      g.beginPath();
      g.ellipse(sx * r * 0.66, -r * 0.72, r * 0.10, r * 0.13, sx * 0.35, 0, Math.PI * 2);
      g.fill();
    }
  }

  // 2. Green cartoon body
  g.fillStyle = '#7ac943';
  g.strokeStyle = '#2d5914';
  g.lineWidth = lw;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();

  // Top-left bright highlight + bottom belly shade
  g.fillStyle = '#97df5f';
  g.beginPath();
  g.ellipse(-r * 0.22, -r * 0.34, r * 0.55, r * 0.36, -0.25, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#63ad30';
  g.beginPath();
  g.arc(0, r * 0.12, r * 0.86, 0.25, Math.PI - 0.25);
  g.fill();
  // Re-stroke body outline cleanly
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();

  // 3. Bruises & black eye when hurt (< 66% / < 50% hp per §8)
  if (stage >= 2) {
    // Black eye shiner around left eye
    g.fillStyle = 'rgba(92, 42, 130, 0.68)';
    g.beginPath();
    g.ellipse(-r * 0.44, -r * 0.08, r * 0.29, r * 0.26, -0.2, 0, Math.PI * 2);
    g.fill();
    // Cheek bruise
    g.fillStyle = 'rgba(115, 52, 145, 0.55)';
    g.beginPath();
    g.ellipse(r * 0.56, r * 0.28, r * 0.22, r * 0.15, 0.3, 0, Math.PI * 2);
    g.fill();
    // Adhesive bandage plaster
    g.save();
    g.translate(-r * 0.50, r * 0.44);
    g.rotate(0.45);
    g.fillStyle = '#f4d6a0';
    g.strokeStyle = '#7a5426';
    g.lineWidth = lw * 0.5;
    g.beginPath();
    g.roundRect(-r * 0.22, -r * 0.08, r * 0.44, r * 0.16, r * 0.05);
    g.fill();
    g.stroke();
    g.restore();
  }
  if (stage >= 3) {
    // Second black eye
    g.fillStyle = 'rgba(85, 36, 122, 0.65)';
    g.beginPath();
    g.ellipse(r * 0.44, -r * 0.08, r * 0.27, r * 0.25, 0.2, 0, Math.PI * 2);
    g.fill();
  }

  // 4. Eye whites (pupils are drawn dynamically on top so they track the bird!)
  for (const sx of [-1, 1]) {
    const ex = sx * r * 0.44, ey = -r * 0.08;
    const er = stage >= 2 && sx === -1 ? r * 0.19 : r * 0.22;
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#254a10';
    g.lineWidth = lw * 0.65;
    g.beginPath();
    g.arc(ex, ey, er, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  // Eyebrows
  g.strokeStyle = variant === 'boss_wizard' ? '#eef4ff' : '#254a10';
  g.lineWidth = variant === 'boss_wizard' ? lw * 1.15 : lw * 0.8;
  for (const sx of [-1, 1]) {
    g.beginPath();
    if (stage >= 1) {
      // Worried angled brows
      g.moveTo(sx * r * 0.26, -r * 0.38);
      g.lineTo(sx * r * 0.64, -r * 0.28);
    } else if (variant === 'boss_helmet' || variant === 'boss_king') {
      // Fierce boss brows
      g.moveTo(sx * r * 0.22, -r * 0.28);
      g.lineTo(sx * r * 0.66, -r * 0.40);
    } else {
      g.moveTo(sx * r * 0.28, -r * 0.34);
      g.quadraticCurveTo(sx * r * 0.45, -r * 0.42, sx * r * 0.62, -r * 0.33);
    }
    g.stroke();
  }

  // 5. Mouth (smug grin -> worried O when hurt)
  g.fillStyle = '#234210';
  if (stage >= 2) {
    g.beginPath();
    g.ellipse(0, r * 0.48, r * 0.22, r * 0.14, 0, 0, Math.PI * 2);
    g.fill();
    // Crooked white tooth
    g.fillStyle = '#ffffff';
    g.fillRect(-r * 0.08, r * 0.36, r * 0.11, r * 0.09);
  } else {
    g.strokeStyle = '#254a10';
    g.lineWidth = lw * 0.75;
    g.beginPath();
    g.arc(0, r * 0.30, r * 0.28, 0.25, Math.PI - 0.25);
    g.stroke();
  }

  // 6. Snout + nostrils (drawn slightly forward over upper mouth)
  g.fillStyle = '#a8e06c';
  g.strokeStyle = '#2d5914';
  g.lineWidth = lw * 0.8;
  g.beginPath();
  g.ellipse(0, r * 0.08, r * 0.36, r * 0.27, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  g.fillStyle = '#1e3d0c';
  g.beginPath();
  g.ellipse(-r * 0.13, r * 0.07, r * 0.075, r * 0.105, -0.15, 0, Math.PI * 2);
  g.ellipse(r * 0.13, r * 0.07, r * 0.075, r * 0.105, 0.15, 0, Math.PI * 2);
  g.fill();

  // Boss facial hair
  if (variant === 'boss_helmet') {
    // Bushy brown commander handlebar mustache
    g.fillStyle = '#753d16';
    g.strokeStyle = '#331806';
    g.lineWidth = lw * 0.65;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(0, r * 0.32);
      g.quadraticCurveTo(sx * r * 0.38, r * 0.24, sx * r * 0.66, r * 0.46);
      g.quadraticCurveTo(sx * r * 0.38, r * 0.56, 0, r * 0.42);
      g.closePath();
      g.fill();
      g.stroke();
    }
  } else if (variant === 'boss_wizard') {
    // Wispy white wizard beard tufts under chin
    g.fillStyle = '#eef4ff';
    g.strokeStyle = '#6d7ea3';
    g.lineWidth = lw * 0.55;
    g.beginPath();
    g.moveTo(-r * 0.38, r * 0.62);
    g.quadraticCurveTo(-r * 0.20, r * 1.05, 0, r * 1.18);
    g.quadraticCurveTo(r * 0.20, r * 1.05, r * 0.38, r * 0.62);
    g.quadraticCurveTo(0, r * 0.76, -r * 0.38, r * 0.62);
    g.fill();
    g.stroke();
  }

  // 7. Variant headgear
  if (variant === 'helmet' || variant === 'boss_helmet') {
    const isBoss = variant === 'boss_helmet';
    g.save();
    if (stage >= 3) g.rotate(0.14);
    g.fillStyle = isBoss ? '#6f7984' : '#8c969f';
    g.strokeStyle = '#32383e';
    g.lineWidth = lw;
    g.beginPath();
    g.arc(0, -r * 0.12, r * 1.05, Math.PI * 1.04, -Math.PI * 0.04);
    g.quadraticCurveTo(0, -r * 0.32, -r * 1.05, -r * 0.24);
    g.closePath();
    g.fill();
    g.stroke();

    // Metallic highlight arc
    g.fillStyle = isBoss ? '#99a4b0' : '#bdc6cf';
    g.beginPath();
    g.ellipse(-r * 0.28, -r * 0.68, r * 0.42, r * 0.18, -0.35, 0, Math.PI * 2);
    g.fill();

    // Helmet brim
    g.fillStyle = '#5c656e';
    g.beginPath();
    g.roundRect(-r * 1.10, -r * 0.36, r * 2.20, r * 0.18, r * 0.08);
    g.fill();
    g.stroke();

    if (isBoss) {
      // Top spike + gold commander star
      g.fillStyle = '#e8b923';
      g.beginPath();
      g.moveTo(-r * 0.14, -r * 1.14);
      g.lineTo(0, -r * 1.48);
      g.lineTo(r * 0.14, -r * 1.14);
      g.closePath();
      g.fill();
      g.stroke();
      drawStar5(g, 0, -r * 0.68, r * 0.24, r * 0.10);
    }
    g.restore();
  } else if (variant === 'king' || variant === 'boss_king') {
    const isBoss = variant === 'boss_king';
    const cw = isBoss ? r * 1.30 : r * 0.96;
    const ch = isBoss ? r * 0.78 : r * 0.62;
    const baseY = -r * 0.80;
    g.save();
    if (stage >= 3) g.rotate(-0.16);
    g.fillStyle = '#ffcb1a';
    g.strokeStyle = '#734900';
    g.lineWidth = lw * 0.9;
    g.beginPath();
    g.moveTo(-cw / 2, baseY);
    g.lineTo(-cw * 0.56, baseY - ch);
    g.lineTo(-cw * 0.24, baseY - ch * 0.48);
    g.lineTo(0, baseY - ch * 1.15);
    g.lineTo(cw * 0.24, baseY - ch * 0.48);
    g.lineTo(cw * 0.56, baseY - ch);
    g.lineTo(cw / 2, baseY);
    g.closePath();
    g.fill();
    g.stroke();

    // Crown jewels
    g.fillStyle = '#e62238';
    g.beginPath(); g.arc(0, baseY - ch * 0.34, r * 0.10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#25c2f7';
    g.beginPath();
    g.arc(-cw * 0.28, baseY - ch * 0.28, r * 0.075, 0, Math.PI * 2);
    g.arc(cw * 0.28, baseY - ch * 0.28, r * 0.075, 0, Math.PI * 2);
    g.fill();
    g.restore();
  } else if (variant === 'boss_wizard') {
    // Iconic blue pointed wizard hat with gold band & stars (matches video 巫师猪!)
    const brimY = -r * 0.72;
    g.save();
    if (stage >= 3) g.rotate(0.12);
    // Cone
    g.fillStyle = '#2856bd';
    g.strokeStyle = '#10255c';
    g.lineWidth = lw * 0.95;
    g.beginPath();
    g.moveTo(-r * 0.78, brimY);
    g.quadraticCurveTo(-r * 0.25, brimY - r * 0.85, r * 0.22, brimY - r * 1.38);
    g.quadraticCurveTo(r * 0.42, brimY - r * 0.65, r * 0.78, brimY);
    g.closePath();
    g.fill();
    g.stroke();

    // Gold hatband
    g.fillStyle = '#f7c528';
    g.beginPath();
    g.roundRect(-r * 0.80, brimY - r * 0.18, r * 1.60, r * 0.18, r * 0.06);
    g.fill();
    g.stroke();

    // Gold stars on hat
    g.fillStyle = '#ffe252';
    drawStar5(g, -r * 0.12, brimY - r * 0.56, r * 0.18, r * 0.08);
    drawStar5(g, r * 0.22, brimY - r * 0.88, r * 0.13, r * 0.06);

    // Wide curved brim
    g.fillStyle = '#2048a6';
    g.beginPath();
    g.ellipse(0, brimY, r * 1.18, r * 0.22, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }
}

export function getPigSprite(ent, pxPerM) {
  const zb = pickZoomBucket(pxPerM);
  const stage = pigDamageStage(ent);
  const variant = ent.skin || 'pig';
  const r = qSize(ent.r || 0.45);
  const key = `pig:${variant}:${r}:${stage}:${zb}`;

  return getCached(key, () => {
    const padTop = variant === 'boss_wizard' ? r * 2.25
      : (variant === 'king' || variant === 'boss_king' || variant === 'boss_helmet') ? r * 1.85
      : r * 1.20;
    const padBot = variant === 'boss_wizard' ? r * 1.30 : r * 1.15;
    const padSide = (variant === 'boss_king' || variant === 'boss_wizard') ? r * 1.40 : r * 1.20;
    const wM = padSide * 2;
    const hM = padTop + padBot;
    return buildOnAtlas(wM, hM, padSide, padTop, zb, (g) => drawPigBase(g, variant, r, stage));
  });
}

const BALLOON_COLORS = [
  ['#ff4757', '#ff8a95', '#8f1320'],
  ['#ffd32a', '#fff099', '#8c6b00'],
  ['#2ed573', '#8cf5b7', '#116934'],
  ['#34ace0', '#9be4ff', '#115370'],
  ['#ff6b9d', '#ffb5ce', '#821c40'],
];

/** Draw an upright colorful balloon above a floating pig (`ent.status.balloon`). */
export function drawPigBalloon(g, cam, px, py, r, id = 1, t = 0) {
  const [fill, hi, stroke] = BALLOON_COLORS[Math.abs(id) % BALLOON_COLORS.length];
  const sway = Math.sin(t * 2.2 + id * 1.3) * 0.14;
  const bx = px + sway;
  const by = py + r * 2.45;
  const brx = Math.max(0.42, r * 0.92);
  const bry = brx * 1.18;

  const sx = cam.sx(px), sy = cam.sy(py - r * 0.65);
  const bsx = cam.sx(bx), bsy = cam.sy(by);
  const knotY = bsy + bry * cam.s;

  // String
  g.strokeStyle = 'rgba(35, 35, 35, 0.85)';
  g.lineWidth = Math.max(1.5, 0.04 * cam.s);
  g.beginPath();
  g.moveTo(sx, sy - r * 1.45 * cam.s);
  g.quadraticCurveTo((sx + bsx) * 0.5 + sway * 10, (sy - r * 1.45 * cam.s + knotY) * 0.5, bsx, knotY);
  g.stroke();

  // Knot triangle
  g.fillStyle = fill;
  g.strokeStyle = stroke;
  g.lineWidth = Math.max(1.5, 0.05 * cam.s);
  const ks = 0.12 * cam.s;
  g.beginPath();
  g.moveTo(bsx, knotY - ks * 0.3);
  g.lineTo(bsx - ks, knotY + ks);
  g.lineTo(bsx + ks, knotY + ks);
  g.closePath();
  g.fill();
  g.stroke();

  // Balloon oval
  g.beginPath();
  g.ellipse(bsx, bsy, brx * cam.s, bry * cam.s, sway * 0.25, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  // Glossy specular shine
  g.fillStyle = hi;
  g.beginPath();
  g.ellipse(bsx - brx * 0.32 * cam.s, bsy - bry * 0.28 * cam.s, brx * 0.22 * cam.s, bry * 0.32 * cam.s, -0.4, 0, Math.PI * 2);
  g.fill();
}

/** Draw live pupils tracking `lookWorld` in local rotated meter space (1 unit = 1 m, y DOWN). */
export function drawPigPupils(g, ent, px, py, angle, lookWorld) {
  const r = ent.r || 0.45;
  let lx = 0, ly = 0;
  let panic = false;
  if (lookWorld) {
    const dxW = lookWorld.x - px;
    const dyW = lookWorld.y - py;
    const dist = Math.hypot(dxW, dyW);
    panic = dist < 5.0;
    if (dist > 0.05) {
      // Rotate world vector (x right, y up) into local y-down rotated frame:
      // world -> local y-up: rot(-angle); then y_local_down = -y_local_up
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const ux = (dxW * ca + dyW * sa) / dist;
      const uyUp = (-dxW * sa + dyW * ca) / dist;
      const maxOff = r * 0.085;
      lx = ux * maxOff;
      ly = -uyUp * maxOff;
    }
  }
  const pr = panic ? r * 0.072 : r * 0.095;
  for (const sx of [-1, 1]) {
    const ex = sx * r * 0.44 + lx;
    const ey = -r * 0.08 + ly;
    g.fillStyle = '#111111';
    g.beginPath();
    g.arc(ex, ey, pr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(ex - pr * 0.32, ey - pr * 0.32, pr * 0.34, 0, Math.PI * 2);
    g.fill();
  }
}

// ---------------- POISON TINT & BUBBLES ----------------

/** Draw local-space magenta poison tint (or custom `status.tint`) over an entity. */
export function drawStatusOverlay(g, ent, t) {
  const hasPoison = !!(ent.status && ent.status.poison);
  const customTint = ent.status && ent.status.tint;
  if (!hasPoison && !customTint) return;

  const pulse = 0.34 + 0.14 * Math.sin(t * 9.5 + ent.id * 1.7);
  g.fillStyle = hasPoison ? `rgba(236, 42, 224, ${pulse.toFixed(3)})` : customTint;
  g.strokeStyle = hasPoison ? '#ff73f7' : customTint;
  g.lineWidth = 0.055;

  if (ent.shape === 'circle') {
    const r = ent.r || 0.45;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill(); g.stroke();
  } else if (ent.shape === 'poly' && ent.verts && ent.verts.length) {
    g.beginPath();
    ent.verts.forEach((v, i) => (i ? g.lineTo(v.x, -v.y) : g.moveTo(v.x, -v.y)));
    g.closePath();
    g.fill(); g.stroke();
  } else {
    const w = ent.w || 0.8, h = ent.h || 0.4;
    g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeRect(-w / 2, -h / 2, w, h);
  }
}

/** Draw rising magenta poison bubbles in CSS screen coords above a poisoned entity. */
export function drawPoisonBubbles(g, cam, px, py, ext, id, t) {
  for (let i = 0; i < 3; i++) {
    const phase = (t * 1.35 + id * 0.37 + i * 0.33) % 1;
    const wx = px + Math.sin(id * 2.1 + i * 2.3 + phase * 5) * ext * 0.65;
    const wy = py + ext * 0.3 + phase * (ext + 0.95);
    const br = (0.07 + 0.05 * (1 - phase)) * cam.s;
    const sx = cam.sx(wx), sy = cam.sy(wy);
    g.globalAlpha = Math.max(0, 1 - phase * phase) * 0.88;
    g.fillStyle = i === 0 ? '#ffa6ff' : '#eb34df';
    g.beginPath(); g.arc(sx, sy, br, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(sx - br * 0.3, sy - br * 0.3, br * 0.32, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

// ---------------- SLINGSHOT (BACK + FRONT) ----------------

export function drawSlingshotBack(g, cam, sling, pouch, pull) {
  const s = cam.s;
  const baseX = cam.sx(sling.x), baseY = cam.sy(sling.y);
  const crotchX = cam.sx(sling.x), crotchY = cam.sy(sling.y + 1.15);
  const backTipX = cam.sx(sling.x + 0.30), backTipY = cam.sy(pouch.y + 0.06);

  // Back prong of wooden Y-fork (darker shade for 3D depth)
  g.strokeStyle = '#331a08';
  g.lineWidth = 0.30 * s;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(crotchX, crotchY);
  g.lineTo(backTipX, backTipY);
  g.stroke();

  g.strokeStyle = '#5c3415';
  g.lineWidth = 0.21 * s;
  g.beginPath();
  g.moveTo(crotchX, crotchY);
  g.lineTo(backTipX, backTipY);
  g.stroke();

  // Back elastic band
  const px = pouch.x + (pull ? pull.x : 0);
  const py = pouch.y + (pull ? pull.y : 0);
  const bandEndX = cam.sx(px), bandEndY = cam.sy(py);
  g.strokeStyle = '#291306';
  g.lineWidth = Math.max(2, 0.105 * s);
  g.beginPath();
  g.moveTo(backTipX, backTipY);
  g.lineTo(bandEndX, bandEndY);
  g.stroke();

  // Stake base collar on ground
  g.fillStyle = '#4f2c11';
  g.strokeStyle = '#261305';
  g.lineWidth = Math.max(1.5, 0.045 * s);
  g.beginPath();
  g.roundRect(baseX - 0.26 * s, baseY - 0.14 * s, 0.52 * s, 0.18 * s, 0.05 * s);
  g.fill();
  g.stroke();
}

export function drawSlingshotFront(g, cam, sling, pouch, pull, birdR = 0.45) {
  const s = cam.s;
  const baseX = cam.sx(sling.x), baseY = cam.sy(sling.y);
  const crotchX = cam.sx(sling.x), crotchY = cam.sy(sling.y + 1.15);
  const frontTipX = cam.sx(sling.x - 0.30), frontTipY = cam.sy(pouch.y - 0.03);

  const dx = pull ? pull.x : 0;
  const dy = pull ? pull.y : 0;
  const pullDist = Math.hypot(dx, dy);
  const ux = pullDist > 0.02 ? dx / pullDist : -1;
  const uy = pullDist > 0.02 ? dy / pullDist : 0;

  // Leather pouch wrapping behind the bird along the pull direction
  const pouchWorldX = pouch.x + dx + ux * (birdR * 0.72);
  const pouchWorldY = pouch.y + dy + uy * (birdR * 0.72);
  const psx = cam.sx(pouchWorldX), psy = cam.sy(pouchWorldY);

  if (pullDist > 0.01 || true) {
    g.save();
    g.translate(psx, psy);
    g.rotate(Math.atan2(-uy, ux));
    g.fillStyle = '#4a240e';
    g.strokeStyle = '#1f0d04';
    g.lineWidth = Math.max(1.5, 0.04 * s);
    g.beginPath();
    g.roundRect(-0.11 * s, -0.24 * s, 0.22 * s, 0.48 * s, 0.08 * s);
    g.fill();
    g.stroke();
    g.restore();
  }

  // Front elastic band (from front fork tip to leather pouch)
  g.strokeStyle = '#241005';
  g.lineWidth = Math.max(2.2, 0.125 * s);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(frontTipX, frontTipY);
  g.lineTo(psx, psy);
  g.stroke();

  g.strokeStyle = '#4d2711';
  g.lineWidth = Math.max(1.2, 0.065 * s);
  g.beginPath();
  g.moveTo(frontTipX, frontTipY);
  g.lineTo(psx, psy);
  g.stroke();

  // Main wooden Y-fork trunk + front prong
  g.strokeStyle = '#331a08';
  g.lineWidth = 0.33 * s;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(baseX, baseY - 0.04 * s);
  g.lineTo(crotchX, crotchY);
  g.lineTo(frontTipX, frontTipY);
  g.stroke();

  g.strokeStyle = '#7a4a22';
  g.lineWidth = 0.23 * s;
  g.beginPath();
  g.moveTo(baseX, baseY - 0.04 * s);
  g.lineTo(crotchX, crotchY);
  g.lineTo(frontTipX, frontTipY);
  g.stroke();

  // Wood grain highlight along left edge of trunk & front prong
  g.strokeStyle = '#9e6535';
  g.lineWidth = 0.065 * s;
  g.beginPath();
  g.moveTo(baseX - 0.05 * s, baseY - 0.12 * s);
  g.lineTo(crotchX - 0.05 * s, crotchY);
  g.lineTo(frontTipX - 0.04 * s, frontTipY + 0.05 * s);
  g.stroke();
}
