// HUD + menus (owner: levels-hud). SKELETON by opus-director: minimal DOM HUD.
// Spec: docs/DESIGN.md §HUD (关卡/分数/星级/剩余鸟/技能按钮/下一只/暂停/重开, title, level select,
// results with 3 stars, localStorage 'musou_progress'). All controls >= 68x68 CSS px, <= 5 visible
// interactive controls during AIM/FLIGHT.

import { STATE, EV } from '../contracts.js';
import { bus } from '../core/bus.js';
import { BIRDS } from '../birds/index.js';

export class Hud {
  constructor(root, game, actions) {
    this.root = root; this.game = game; this.actions = actions;
    root.innerHTML = `
      <div class="hud-top"><span id="hud-level"></span><span id="hud-score"></span></div>
      <button id="btn-restart" class="hud-btn" aria-label="重新开始">↻</button>
      <button id="btn-ability" class="hud-btn ability" aria-label="技能">技能</button>
      <button id="btn-next" class="hud-btn" aria-label="下一只">→</button>
      <div id="hud-msg" class="hud-msg"></div>`;
    root.querySelector('#btn-restart').addEventListener('click', () => actions.restart());
    root.querySelector('#btn-ability').addEventListener('click', () => actions.ability());
    root.querySelector('#btn-next').addEventListener('click', () => actions.next());
    bus.on(EV.LEVEL_CLEAR, (p) => this.msg(`过关！ ${'★'.repeat(p.stars)}  ${p.score}`));
    bus.on(EV.LEVEL_FAIL, () => this.msg('猪猪还在！点 ↻ 重试'));
    bus.on(EV.LEVEL_START, () => this.msg(''));
  }
  msg(t) { this.root.querySelector('#hud-msg').textContent = t; }
  update() {
    const g = this.game;
    if (!g.level) return;
    this.root.querySelector('#hud-level').textContent = `关卡 ${g.level.id}`;
    this.root.querySelector('#hud-score').textContent = `分数 ${g.score}`;
    const ab = this.root.querySelector('#btn-ability');
    const ready = g.state === STATE.FLIGHT && !g.abilityUsed;
    ab.classList.toggle('ready', ready);
    const id = g.state === STATE.FLIGHT && g.bird ? g.bird.data.birdId : g.currentBirdId;
    ab.textContent = id && BIRDS[id] ? BIRDS[id].ability : '技能';
  }
}
