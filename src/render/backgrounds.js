// Biome backgrounds, cached parallax layers, world-locked ground band, and static terrain
// (owner: render-art). Spec: docs/DESIGN.md §8. Zero runtime network/images; 100% procedural
// offscreen canvases cached on first use.

const PARALLAX_W = 960;
const PARALLAX_H = 380;
const GROUND_WORLD_W = 8.0;   // meters per seamless ground tile
const GROUND_PX_PER_M = 64;   // 512 px wide offscreen tile
const GROUND_WORLD_H = 4.0;   // 4 m deep (covers down to y = -4, clamped at y = -2)

// Deterministic PRNG for procedural art tiles (never touches sim RNG)
function artRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const SKY_STOPS = {
  grass: [[0, '#278ae0'], [0.58, '#6bc0f8'], [1, '#bce6ff']],
  desert: [[0, '#f2d684'], [0.58, '#fae7b0'], [1, '#fff6dc']],
  city: [[0, '#04081f'], [0.55, '#151a47'], [1, '#2a245e']],
};

const _biomeCache = new Map();
let _earthPatternCanvas = null;
let _stars = null;

function getStars() {
  if (_stars) return _stars;
  const rnd = artRng(0xC17957A2);
  _stars = [];
  for (let i = 0; i < 85; i++) {
    _stars.push({
      u: rnd(),
      v: rnd() * 0.68,
      r: 0.8 + rnd() * 1.6,
      phase: rnd() * Math.PI * 2,
      sparkle: i < 12,
    });
  }
  return _stars;
}

function drawPuffyCloud(g, cx, baseY, w, h, bodyCol = '#ffffff', shadeCol = '#d6ecff') {
  // Draw at cx, cx - PARALLAX_W, cx + PARALLAX_W if near seam for seamless horizontal wrap
  for (const ox of [0, -PARALLAX_W, PARALLAX_W]) {
    const x = cx + ox;
    if (x + w < -20 || x - w > PARALLAX_W + 20) continue;
    g.fillStyle = shadeCol;
    g.beginPath();
    g.roundRect(x - w * 0.48, baseY - h * 0.28, w * 0.96, h * 0.28, h * 0.14);
    g.fill();

    g.fillStyle = bodyCol;
    const lobes = [
      [-0.32, -0.24, 0.24],
      [-0.12, -0.44, 0.30],
      [0.14, -0.38, 0.27],
      [0.33, -0.22, 0.21],
    ];
    g.beginPath();
    for (const [lx, ly, lr] of lobes) {
      g.moveTo(x + lx * w + lr * w, baseY + ly * h);
      g.arc(x + lx * w, baseY + ly * h, lr * w, 0, Math.PI * 2);
    }
    g.roundRect(x - w * 0.46, baseY - h * 0.30, w * 0.92, h * 0.24, h * 0.11);
    g.fill();
  }
}

function buildGrassLayers() {
  // Far layer (parallax 0.2): billowy horizon cloud bank + floating flat-bottomed clouds
  const far = makeCanvas(PARALLAX_W, PARALLAX_H);
  const fg = far.getContext('2d');
  const rnd = artRng(101);

  // Horizon cumulus bank (anchored near bottom of PARALLAX_H)
  fg.fillStyle = '#e7f5ff';
  fg.fillRect(0, PARALLAX_H - 65, PARALLAX_W, 65);
  for (let i = 0; i < 11; i++) {
    const cx = (i / 11) * PARALLAX_W + (rnd() - 0.5) * 35;
    const r = 46 + rnd() * 38;
    const cy = PARALLAX_H - 55 - rnd() * 36;
    for (const ox of [0, -PARALLAX_W, PARALLAX_W]) {
      fg.fillStyle = '#d9eeff';
      fg.beginPath();
      fg.arc(cx + ox + 4, cy + 8, r, 0, Math.PI * 2);
      fg.fill();
      fg.fillStyle = '#ffffff';
      fg.beginPath();
      fg.arc(cx + ox, cy, r, 0, Math.PI * 2);
      fg.fill();
    }
  }
  // Floating upper clouds (video style)
  drawPuffyCloud(fg, 140, 130, 150, 62);
  drawPuffyCloud(fg, 430, 92, 120, 50);
  drawPuffyCloud(fg, 740, 148, 168, 66);

  // Mid layer (parallax 0.4): rolling pale-green hills + dark-teal foliage & fern tufts
  const mid = makeCanvas(PARALLAX_W, PARALLAX_H);
  const mg = mid.getContext('2d');
  const rndM = artRng(202);

  // Soft distant green hills
  mg.fillStyle = '#87cf64';
  mg.beginPath();
  mg.moveTo(0, PARALLAX_H);
  for (let x = 0; x <= PARALLAX_W; x += 16) {
    const u = (x / PARALLAX_W) * Math.PI * 2;
    const y = PARALLAX_H - 64 - Math.sin(u * 2 + 0.5) * 24 - Math.cos(u * 3) * 12;
    mg.lineTo(x, y);
  }
  mg.lineTo(PARALLAX_W, PARALLAX_H);
  mg.closePath();
  mg.fill();

  mg.fillStyle = '#6cbc4a';
  mg.beginPath();
  mg.moveTo(0, PARALLAX_H);
  for (let x = 0; x <= PARALLAX_W; x += 16) {
    const u = (x / PARALLAX_W) * Math.PI * 2;
    const y = PARALLAX_H - 42 - Math.cos(u * 2 - 0.8) * 18 - Math.sin(u * 4) * 8;
    mg.lineTo(x, y);
  }
  mg.lineTo(PARALLAX_W, PARALLAX_H);
  mg.closePath();
  mg.fill();

  // Dark teal bush & spiky palm/fern silhouettes along the base (exact video look)
  mg.fillStyle = '#1f6c52';
  mg.fillRect(0, PARALLAX_H - 22, PARALLAX_W, 22);
  for (let i = 0; i < 28; i++) {
    const bx = (i / 28) * PARALLAX_W + (rndM() - 0.5) * 14;
    const br = 16 + rndM() * 16;
    const by = PARALLAX_H - 16 - rndM() * 10;
    for (const ox of [0, -PARALLAX_W, PARALLAX_W]) {
      const x = bx + ox;
      if (x + br < -10 || x - br > PARALLAX_W + 10) continue;
      mg.fillStyle = i % 2 ? '#1d664d' : '#267a5d';
      mg.beginPath();
      mg.arc(x, by, br, 0, Math.PI * 2);
      mg.fill();
      if (i % 4 === 0) {
        // Spiky fern tuft
        mg.strokeStyle = '#1a5c45';
        mg.lineWidth = 3.5;
        mg.lineCap = 'round';
        for (let k = -2; k <= 2; k++) {
          const ang = -Math.PI / 2 + k * 0.34;
          const len = 18 + Math.abs(k) * 3;
          mg.beginPath();
          mg.moveTo(x, by - br * 0.4);
          mg.quadraticCurveTo(
            x + Math.cos(ang) * len * 0.6,
            by - br * 0.4 + Math.sin(ang) * len * 0.8,
            x + Math.cos(ang * 1.12) * len * 1.15,
            by - br * 0.4 + Math.sin(ang) * len * 0.65 + 4
          );
          mg.stroke();
        }
      }
    }
  }

  return { far, mid, ground: buildCobbleGround('#5fb336', '#82de50', '#254f12', '#1e3a78', '#294e9c', '#0e1d42', true) };
}

function buildDesertLayers() {
  const far = makeCanvas(PARALLAX_W, PARALLAX_H);
  const fg = far.getContext('2d');

  // Warm wispy desert clouds
  drawPuffyCloud(fg, 210, 120, 165, 52, 'rgba(255,251,238,0.82)', 'rgba(243,222,172,0.65)');
  drawPuffyCloud(fg, 690, 98, 140, 46, 'rgba(255,251,238,0.82)', 'rgba(243,222,172,0.65)');

  // Distant flat-top sandstone mesas
  const mesas = [
    { x: 60, w: 190, h: 115 },
    { x: 390, w: 230, h: 140 },
    { x: 740, w: 180, h: 105 },
  ];
  for (const m of mesas) {
    for (const ox of [0, -PARALLAX_W, PARALLAX_W]) {
      const x = m.x + ox;
      if (x + m.w < -20 || x > PARALLAX_W + 20) continue;
      const topY = PARALLAX_H - m.h;
      fg.fillStyle = '#e0ba6c';
      fg.beginPath();
      fg.moveTo(x, PARALLAX_H);
      fg.lineTo(x + 26, topY + 22);
      fg.lineTo(x + 36, topY);
      fg.lineTo(x + m.w - 38, topY);
      fg.lineTo(x + m.w - 24, topY + 24);
      fg.lineTo(x + m.w, PARALLAX_H);
      fg.closePath();
      fg.fill();

      // Shadow cliff side
      fg.fillStyle = '#cca252';
      fg.beginPath();
      fg.moveTo(x + m.w * 0.62, topY);
      fg.lineTo(x + m.w - 38, topY);
      fg.lineTo(x + m.w - 24, topY + 24);
      fg.lineTo(x + m.w, PARALLAX_H);
      fg.lineTo(x + m.w * 0.56, PARALLAX_H);
      fg.closePath();
      fg.fill();

      // Horizontal strata bands
      fg.strokeStyle = 'rgba(165, 118, 42, 0.35)';
      fg.lineWidth = 2;
      for (let sy = topY + 26; sy < PARALLAX_H - 18; sy += 22) {
        fg.beginPath();
        fg.moveTo(x + 28, sy);
        fg.lineTo(x + m.w - 28, sy);
        fg.stroke();
      }
    }
  }

  // Mid layer: sweeping dunes + cacti
  const mid = makeCanvas(PARALLAX_W, PARALLAX_H);
  const mg = mid.getContext('2d');

  // Back dune
  mg.fillStyle = '#e8c77a';
  mg.beginPath();
  mg.moveTo(0, PARALLAX_H);
  for (let x = 0; x <= PARALLAX_W; x += 12) {
    const u = (x / PARALLAX_W) * Math.PI * 2;
    const y = PARALLAX_H - 68 - Math.sin(u * 2) * 26 - Math.cos(u * 3 + 1.1) * 10;
    mg.lineTo(x, y);
  }
  mg.lineTo(PARALLAX_W, PARALLAX_H);
  mg.closePath();
  mg.fill();

  // Front dune
  mg.fillStyle = '#d9b25e';
  mg.beginPath();
  mg.moveTo(0, PARALLAX_H);
  for (let x = 0; x <= PARALLAX_W; x += 12) {
    const u = (x / PARALLAX_W) * Math.PI * 2;
    const y = PARALLAX_H - 38 - Math.cos(u * 2 - 0.7) * 20 - Math.sin(u * 4) * 6;
    mg.lineTo(x, y);
  }
  mg.lineTo(PARALLAX_W, PARALLAX_H);
  mg.closePath();
  mg.fill();

  // Saguaro cactus silhouettes
  const cacti = [110, 310, 560, 830];
  mg.fillStyle = '#a97f34';
  for (const cx of cacti) {
    const cy = PARALLAX_H - 36;
    const h = 38 + (cx % 17);
    mg.beginPath();
    mg.roundRect(cx - 4, cy - h, 8, h + 14, 4);
    mg.roundRect(cx - 15, cy - h * 0.72, 13, 6, 3);
    mg.roundRect(cx - 15, cy - h * 0.90, 6, h * 0.22, 3);
    mg.roundRect(cx + 2, cy - h * 0.56, 13, 6, 3);
    mg.roundRect(cx + 9, cy - h * 0.80, 6, h * 0.28, 3);
    mg.fill();
  }

  return { far, mid, ground: buildDesertGround() };
}

function buildCityLayers() {
  // Far purple skyline (parallax 0.28)
  const far = makeCanvas(PARALLAX_W, PARALLAX_H);
  const fg = far.getContext('2d');
  const rndF = artRng(303);
  let x = 0;
  while (x < PARALLAX_W) {
    const bw = 46 + Math.floor(rndF() * 44);
    const bh = 95 + Math.floor(rndF() * 145);
    const w = Math.min(bw, PARALLAX_W - x);
    const topY = PARALLAX_H - bh;
    fg.fillStyle = rndF() > 0.5 ? '#1b1742' : '#211c4f';
    fg.fillRect(x, topY, w - 2, bh);
    if (w > 28 && rndF() > 0.55) {
      // Stepped roof + spire
      fg.fillRect(x + 8, topY - 14, w - 18, 14);
      fg.fillRect(x + Math.floor(w / 2) - 1, topY - 32, 3, 20);
    }
    fg.fillStyle = 'rgba(205, 195, 255, 0.20)';
    for (let wy = topY + 12; wy < PARALLAX_H - 22; wy += 16) {
      for (let wx = x + 7; wx < x + w - 10; wx += 11) {
        if (rndF() > 0.45) fg.fillRect(wx, wy, 5, 7);
      }
    }
    x += w;
  }

  // Near skyline (parallax 0.48) — bold purple buildings + warm yellow/cyan windows (video look)
  const mid = makeCanvas(PARALLAX_W, PARALLAX_H);
  const mg = mid.getContext('2d');
  const rndM = artRng(404);
  let mx = 0;
  let idx = 0;
  while (mx < PARALLAX_W) {
    const bw = 58 + Math.floor(rndM() * 52);
    const bh = 72 + Math.floor(rndM() * 115);
    const w = Math.min(bw, PARALLAX_W - mx);
    const topY = PARALLAX_H - bh;
    const bodyColors = ['#2e2466', '#362a75', '#271e59'];
    mg.fillStyle = bodyColors[idx % bodyColors.length];
    mg.fillRect(mx, topY, w - 3, bh);
    mg.strokeStyle = '#140f36';
    mg.lineWidth = 2;
    mg.strokeRect(mx + 1, topY + 1, w - 5, bh);

    // Occasional clock tower / pitched roof (nod to 3-4 clock tower)
    if (idx % 5 === 2 && w >= 48) {
      mg.fillStyle = '#3b2e7e';
      mg.beginPath();
      mg.moveTo(mx + 4, topY);
      mg.lineTo(mx + (w - 3) / 2, topY - 26);
      mg.lineTo(mx + w - 7, topY);
      mg.closePath();
      mg.fill();
      mg.fillStyle = '#ffe680';
      mg.beginPath();
      mg.arc(mx + (w - 3) / 2, topY + 18, 8, 0, Math.PI * 2);
      mg.fill();
      mg.strokeStyle = '#3b2e7e';
      mg.lineWidth = 1.8;
      mg.beginPath();
      mg.moveTo(mx + (w - 3) / 2, topY + 18);
      mg.lineTo(mx + (w - 3) / 2, topY + 12);
      mg.moveTo(mx + (w - 3) / 2, topY + 18);
      mg.lineTo(mx + (w - 3) / 2 + 5, topY + 18);
      mg.stroke();
    }

    // Lit apartment windows
    const winStart = (idx % 5 === 2 && w >= 48) ? topY + 34 : topY + 12;
    for (let wy = winStart; wy < PARALLAX_H - 18; wy += 18) {
      for (let wx = mx + 9; wx < mx + w - 14; wx += 14) {
        const r = rndM();
        if (r < 0.35) continue;
        mg.fillStyle = r > 0.78 ? '#ffd95e' : r > 0.56 ? '#9be8ff' : '#9688e8';
        mg.fillRect(wx, wy, 6, 9);
        mg.fillStyle = 'rgba(20,15,55,0.45)';
        mg.fillRect(wx + 2.5, wy, 1, 9);
      }
    }
    mx += w;
    idx++;
  }

  return { far, mid, ground: buildCobbleGround('#4ba330', '#6fd149', '#1c3f10', '#192f66', '#24428a', '#0a1430', true) };
}

function buildCobbleGround(grassCol, grassHi, grassBorder, stoneCol, stoneHi, mortarCol, withMoss) {
  const W = Math.round(GROUND_WORLD_W * GROUND_PX_PER_M); // 512
  const H = Math.round(GROUND_WORLD_H * GROUND_PX_PER_M); // 256
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const rnd = artRng(0x900D5011);

  const grassH = Math.round(0.32 * GROUND_PX_PER_M); // ~20 px

  // Deep dark-blue mortar background
  g.fillStyle = mortarCol;
  g.fillRect(0, grassH - 4, W, H - grassH + 4);

  // Packed rounded dark-blue cobblestones (seamless across x = 0 / W)
  const rows = 6;
  const rowH = (H - grassH) / rows;
  for (let ry = 0; ry < rows; ry++) {
    const cols = ry % 2 === 0 ? 8 : 9;
    const colW = W / cols;
    const rowOff = (ry % 2) * (colW * 0.48);
    for (let cxIdx = 0; cxIdx < cols; cxIdx++) {
      const cx = (cxIdx + 0.5) * colW + rowOff + (rnd() - 0.5) * 8;
      const cy = grassH + (ry + 0.52) * rowH + (rnd() - 0.5) * 5;
      const rw = colW * (0.42 + rnd() * 0.08);
      const rh = rowH * (0.40 + rnd() * 0.08);
      const tilt = (rnd() - 0.5) * 0.25;

      // Green moss wedges tucked between top-row cobblestones (exact video look!)
      if (withMoss && ry === 0) {
        for (const ox of [0, -W, W]) {
          g.fillStyle = '#3c8f25';
          g.beginPath();
          g.moveTo(cx + ox - rw * 0.9, grassH - 2);
          g.lineTo(cx + ox - rw * 0.3, grassH + rh * 0.95);
          g.lineTo(cx + ox + rw * 0.2, grassH - 2);
          g.closePath();
          g.fill();
        }
      }

      for (const ox of [0, -W, W]) {
        const sx = cx + ox;
        if (sx + rw < -10 || sx - rw > W + 10) continue;
        g.save();
        g.translate(sx, cy);
        g.rotate(tilt);

        // Stone base
        g.fillStyle = stoneCol;
        g.strokeStyle = '#081129';
        g.lineWidth = 2.5;
        g.beginPath();
        g.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();

        // Top-left bevel highlight
        g.fillStyle = stoneHi;
        g.beginPath();
        g.ellipse(-rw * 0.14, -rh * 0.18, rw * 0.68, rh * 0.54, -0.1, 0, Math.PI * 2);
        g.fill();

        g.restore();
      }
    }
  }

  // Lush cartoon grass strip along y = 0..grassH
  g.fillStyle = grassCol;
  g.fillRect(0, 2, W, grassH - 3);
  g.fillStyle = grassHi;
  g.fillRect(0, 2, W, 6);

  // Scalloped grass fringe hanging over the cobblestones
  g.fillStyle = grassCol;
  g.strokeStyle = grassBorder;
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(-10, 2);
  g.lineTo(W + 10, 2);
  g.lineTo(W + 10, grassH - 2);
  const teeth = 24;
  for (let i = teeth; i >= 0; i--) {
    const tx = (i / teeth) * W;
    const dip = (i % 2 === 0) ? grassH + 5 : grassH - 3;
    g.lineTo(tx, dip);
  }
  g.closePath();
  g.fill();
  g.stroke();

  // Crisp top grass surface line
  g.strokeStyle = grassBorder;
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(0, 1.5);
  g.lineTo(W, 1.5);
  g.stroke();

  return c;
}

function buildDesertGround() {
  const W = Math.round(GROUND_WORLD_W * GROUND_PX_PER_M);
  const H = Math.round(GROUND_WORLD_H * GROUND_PX_PER_M);
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const rnd = artRng(0xDE5E2701);

  const sandH = Math.round(0.34 * GROUND_PX_PER_M);

  // Rich dark-brown desert earth
  g.fillStyle = '#472b16';
  g.fillRect(0, sandH - 4, W, H - sandH + 4);

  // Sandstone blocks & pebbles
  const rows = 5;
  const rowH = (H - sandH) / rows;
  for (let ry = 0; ry < rows; ry++) {
    const cols = 7 + (ry % 2);
    const colW = W / cols;
    const off = (ry % 2) * colW * 0.45;
    for (let i = 0; i < cols; i++) {
      const cx = (i + 0.5) * colW + off + (rnd() - 0.5) * 8;
      const cy = sandH + (ry + 0.5) * rowH + (rnd() - 0.5) * 4;
      const rw = colW * 0.43;
      const rh = rowH * 0.39;
      for (const ox of [0, -W, W]) {
        const sx = cx + ox;
        if (sx + rw < -10 || sx - rw > W + 10) continue;
        g.fillStyle = '#6b4526';
        g.strokeStyle = '#2e1a0c';
        g.lineWidth = 2.2;
        g.beginPath();
        g.roundRect(sx - rw, cy - rh, rw * 2, rh * 2, 9);
        g.fill();
        g.stroke();
        g.fillStyle = '#875a35';
        g.beginPath();
        g.roundRect(sx - rw * 0.78, cy - rh * 0.72, rw * 1.4, rh * 0.9, 6);
        g.fill();
      }
    }
  }

  // Golden sand crust top strip
  g.fillStyle = '#e6be65';
  g.strokeStyle = '#78501c';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(-10, 2);
  g.lineTo(W + 10, 2);
  g.lineTo(W + 10, sandH);
  for (let i = 16; i >= 0; i--) {
    const tx = (i / 16) * W;
    const ty = sandH + Math.sin((i / 16) * Math.PI * 4) * 4;
    g.lineTo(tx, ty);
  }
  g.closePath();
  g.fill();
  g.stroke();

  g.fillStyle = '#f8df9b';
  g.fillRect(0, 3, W, 5);

  return c;
}

function getBiomeAssets(biome) {
  const key = SKY_STOPS[biome] ? biome : 'grass';
  let hit = _biomeCache.get(key);
  if (!hit) {
    hit = key === 'desert' ? buildDesertLayers()
      : key === 'city' ? buildCityLayers()
      : buildGrassLayers();
    _biomeCache.set(key, hit);
  }
  return hit;
}

function getEarthCanvas() {
  if (_earthPatternCanvas) return _earthPatternCanvas;
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const rnd = artRng(0xEA27401);
  g.fillStyle = '#5b3b22';
  g.fillRect(0, 0, S, S);
  const cols = ['#452b17', '#734c2e', '#865b39', '#382110'];
  for (let i = 0; i < 56; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const rx = 2.5 + rnd() * 6.5;
    const ry = 2.0 + rnd() * 4.5;
    const col = cols[i % cols.length];
    for (const ox of [0, -S, S]) {
      for (const oy of [0, -S, S]) {
        if (x + ox + rx < 0 || x + ox - rx > S || y + oy + ry < 0 || y + oy - ry > S) continue;
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(x + ox, y + oy, rx, ry, rnd() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  _earthPatternCanvas = c;
  return c;
}

function drawTiledParallax(g, canvas, scrollPx, bottomY, scale = 1) {
  const tw = PARALLAX_W * scale;
  const th = PARALLAX_H * scale;
  const topY = bottomY - th;
  if (bottomY < 0 || topY > g.canvas.height) return;
  let startX = -(((scrollPx % tw) + tw) % tw);
  for (let x = startX; x < g.canvas.width + tw; x += tw) {
    g.drawImage(canvas, x, topY, tw + 0.8, th);
    if (x > 4096) break;
  }
}

/**
 * Draw sky, celestial body, cached parallax layers, and world-locked ground band.
 * Assumes `g` currently has transform `(dpr, 0, 0, dpr, 0, 0)` (CSS px coords).
 */
export function drawBackground(g, cam, biome = 'grass', t = 0) {
  const key = SKY_STOPS[biome] ? biome : 'grass';
  const w = cam.w, h = cam.h;

  // 1. Sky gradient
  const grad = g.createLinearGradient(0, 0, 0, h);
  for (const [stop, col] of SKY_STOPS[key]) grad.addColorStop(stop, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  // 2. Celestial bodies (sun in desert, twinkling stars + glowing moon in night city)
  const celScale = Math.max(0.55, Math.min(1.15, cam.s / 32));
  if (key === 'desert') {
    const sx = w * 0.78, sy = h * 0.18, sr = Math.max(18, 38 * celScale);
    g.fillStyle = 'rgba(255, 248, 200, 0.24)';
    g.beginPath(); g.arc(sx, sy, sr * 2.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255, 245, 185, 0.45)';
    g.beginPath(); g.arc(sx, sy, sr * 1.45, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff9d2';
    g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
  } else if (key === 'city') {
    const stars = getStars();
    for (let i = 0; i < stars.length; i++) {
      const st = stars[i];
      const tw = 0.48 + 0.52 * Math.sin(t * 2.4 + st.phase);
      g.globalAlpha = tw;
      g.fillStyle = '#ffffff';
      const x = st.u * w, y = st.v * h * 0.88;
      if (st.sparkle) {
        const r = st.r * 1.8;
        g.fillRect(x - r, y - 0.7, r * 2, 1.4);
        g.fillRect(x - 0.7, y - r, 1.4, r * 2);
      } else {
        g.fillRect(x, y, st.r, st.r);
      }
    }
    g.globalAlpha = 1;
    // Moon with glow
    const mx = w * 0.80, my = h * 0.18, mr = Math.max(15, 32 * celScale);
    g.fillStyle = 'rgba(200, 215, 255, 0.10)';
    g.beginPath(); g.arc(mx, my, mr * 2.8, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(230, 240, 255, 0.22)';
    g.beginPath(); g.arc(mx, my, mr * 1.65, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fffce6';
    g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
  }

  // 3. Cached parallax layers (scaled harmoniously with world scale, flush with R1 ground at rest)
  const assets = getBiomeAssets(key);
  const groundY = cam.sy(0);
  const gbPx = typeof cam.groundBandPx === 'function'
    ? cam.groundBandPx()
    : (h > w ? Math.round(0.36 * h) : Math.max(Math.ceil(0.19 * h), h <= 460 ? 106 : 132));
  const restGroundY = h - gbPx;
  const skyLift = Math.max(0, groundY - restGroundY);
  const pScale = Math.max(0.45, Math.min(1.38, cam.s / 33));

  const farParallax = key === 'city' ? 0.28 : 0.20;
  const midParallax = key === 'city' ? 0.48 : 0.40;
  const baseHorizonY = Math.min(groundY, restGroundY);
  const farBottom = Math.min(h + 140, baseHorizonY + skyLift * farParallax + 6);
  const midBottom = Math.min(h + 140, baseHorizonY + skyLift * midParallax + 6);

  const worldScrollPx = cam.cx * cam.s;
  drawTiledParallax(g, assets.far, worldScrollPx * farParallax, farBottom, pScale);
  drawTiledParallax(g, assets.mid, worldScrollPx * midParallax, midBottom, pScale);

  // Seamless horizon skirt between midBottom and groundY when camera is high in the sky
  const groundTopFillY = Math.min(h, groundY + 2);
  if (midBottom < groundTopFillY) {
    g.fillStyle = key === 'desert' ? '#d9b25e' : key === 'city' ? '#271e59' : '#1f6c52';
    g.fillRect(0, midBottom - 2, w, groundTopFillY - midBottom + 4);
  }

  // 4. World-locked thick ground band (y <= 0, tiled vertically with cobblestones/sandstone to bottom)
  if (groundY < h + 4) {
    const gScale = Math.max(cam.s, 18);
    const tileScreenW = GROUND_WORLD_W * gScale;
    const tileScreenH = GROUND_WORLD_H * gScale;
    let startScreenX;
    if (gScale === cam.s) {
      const viewLeftWorld = cam.cx - (w / 2 + Math.abs(cam.shakeX) + 8) / cam.s;
      const firstTileIdx = Math.floor(viewLeftWorld / GROUND_WORLD_W);
      startScreenX = cam.sx(firstTileIdx * GROUND_WORLD_W);
    } else {
      const scrollPx = cam.cx * cam.s - cam.shakeX;
      startScreenX = -(((scrollPx % tileScreenW) + tileScreenW) % tileScreenW);
    }

    const srcW = assets.ground.width;
    const srcH = assets.ground.height;
    const subSrcY = key === 'desert' ? Math.round(0.48 * GROUND_PX_PER_M) : 60; // skip top moss/sand fringe
    const subSrcH = srcH - subSrcY;
    const subScreenH = (subSrcH / srcH) * tileScreenH;

    for (let sx = startScreenX; sx < w + tileScreenW; sx += tileScreenW) {
      g.drawImage(assets.ground, sx, groundY - 2, tileScreenW + 0.75, tileScreenH + 2);
      if (subScreenH >= 8) {
        for (let ry = groundY + tileScreenH - 2; ry < h + 2; ry += subScreenH - 1) {
          g.drawImage(
            assets.ground,
            0, subSrcY, srcW, subSrcH,
            sx, ry, tileScreenW + 0.75, subScreenH + 1.5
          );
        }
      }
      if (tileScreenW < 4) break;
    }
  }
}

/**
 * Draw a static KIND.TERRAIN entity in its local meter frame (1 unit = 1 m, y DOWN).
 */
export function drawTerrainEnt(g, ent, biome = 'grass') {
  const earth = getEarthCanvas();
  let pat = earth._pat;
  if (!pat) {
    pat = earth._pat = g.createPattern(earth, 'repeat');
  }
  const topCol = biome === 'desert' ? '#dfB55c' : '#5fb336';
  const topHi = biome === 'desert' ? '#f7de96' : '#82de50';
  const borderCol = '#2d1a0b';

  g.save();
  // Pattern is 128 px; scale pattern matrix to ~3.2 m repeat so speckles stay crisp in meter space
  if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') {
    const s = 3.2 / 128;
    pat.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
  }
  g.fillStyle = pat || '#5b3b22';
  g.strokeStyle = borderCol;
  g.lineWidth = 0.06;
  g.lineJoin = 'round';

  if (ent.shape === 'poly' && ent.verts && ent.verts.length) {
    g.beginPath();
    for (let i = 0; i < ent.verts.length; i++) {
      const v = ent.verts[i];
      if (i === 0) g.moveTo(v.x, -v.y);
      else g.lineTo(v.x, -v.y);
    }
    g.closePath();
    g.fill();
    g.stroke();

    // Draw grass/sand cap along upward-facing polygon edges (CCW in world y-up => vNext.x < vCurr.x or check normal)
    let signedArea = 0;
    for (let i = 0; i < ent.verts.length; i++) {
      const a = ent.verts[i], b = ent.verts[(i + 1) % ent.verts.length];
      signedArea += a.x * b.y - b.x * a.y;
    }
    const sign = signedArea >= 0 ? 1 : -1; // +1 if CCW in world y-up
    for (let i = 0; i < ent.verts.length; i++) {
      const a = ent.verts[i], b = ent.verts[(i + 1) % ent.verts.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.25) continue;
      // Outward normal in world y-up for CCW polygon is (dy/len, -dx/len) * sign
      const nyWorld = (-dx / len) * sign;
      if (nyWorld > 0.45) {
        g.strokeStyle = topCol;
        g.lineWidth = 0.22;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(a.x, -a.y + 0.06);
        g.lineTo(b.x, -b.y + 0.06);
        g.stroke();

        g.strokeStyle = topHi;
        g.lineWidth = 0.07;
        g.beginPath();
        g.moveTo(a.x, -a.y + 0.01);
        g.lineTo(b.x, -b.y + 0.01);
        g.stroke();
      }
    }
  } else {
    const w = ent.w || 2, h = ent.h || 2;
    g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeRect(-w / 2, -h / 2, w, h);

    // Biome top cap along y_local = -h/2
    const capH = Math.min(0.28, h * 0.28);
    g.fillStyle = topCol;
    g.fillRect(-w / 2 - 0.04, -h / 2 - 0.02, w + 0.08, capH);
    g.fillStyle = topHi;
    g.fillRect(-w / 2 - 0.02, -h / 2 - 0.02, w + 0.04, capH * 0.34);
    g.strokeStyle = borderCol;
    g.lineWidth = 0.055;
    g.strokeRect(-w / 2 - 0.04, -h / 2 - 0.02, w + 0.08, capH);
  }
  g.restore();
}
