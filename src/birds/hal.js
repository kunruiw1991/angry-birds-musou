// 长嘴绿「神鹰回旋」 (owner: birds-a). STUB by opus-director — replace with the real 10x ability.
// Spec: docs/DESIGN.md §Birds/hal. Contract: src/birds/index.js header.

export default {
  id: 'hal',
  name: '长嘴绿',
  ability: '神鹰回旋',
  desc: '回旋镖掉头，旋转中召唤8只神鹰俯冲横扫全屏',
  color: '#5dbb3f',
  radius: 0.48,
  density: 5,
  dmgMul: 1,

  onLaunch(ctx, bird) {},

  // Placeholder so the skeleton is playable: one explosion at the bird.
  onTap(ctx, bird, target) {
    const p = ctx.pos(bird);
    ctx.explode(p.x, p.y, { r: 2.5, dmg: 200, impulse: 20, source: 'hal' });
  },

  onStep(ctx, bird, dt) {},

  drawBird(g, ent, t) {
    const r = ent.r;
    g.fillStyle = '#5dbb3f';
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = r * 0.12;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(r * 0.35, -r * 0.2, r * 0.22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000';
    g.beginPath(); g.arc(r * 0.42, -r * 0.2, r * 0.1, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2a50c';
    g.beginPath(); g.moveTo(r * 0.55, 0); g.lineTo(r * 1.05, r * 0.12); g.lineTo(r * 0.55, r * 0.3); g.closePath(); g.fill();
  },

  projSkins: {},
  effects: {},
};
