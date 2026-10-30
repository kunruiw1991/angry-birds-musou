// 史黛拉「重力反转」 (owner: birds-b). STUB by opus-director — replace with the real 10x ability.
// Spec: docs/DESIGN.md §Birds/stella. Contract: src/birds/index.js header.

export default {
  id: 'stella',
  name: '史黛拉',
  ability: '重力反转',
  desc: '泡泡反转重力托起物体，再全部砸向点击位置',
  color: '#f49ac2',
  radius: 0.44,
  density: 5,
  dmgMul: 1,

  onLaunch(ctx, bird) {},

  // Placeholder so the skeleton is playable: one explosion at the bird.
  onTap(ctx, bird, target) {
    const p = ctx.pos(bird);
    ctx.explode(p.x, p.y, { r: 2.5, dmg: 200, impulse: 20, source: 'stella' });
  },

  onStep(ctx, bird, dt) {},

  drawBird(g, ent, t) {
    const r = ent.r;
    g.fillStyle = '#f49ac2';
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
