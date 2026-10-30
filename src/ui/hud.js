// HUD + menus + codex + banners + progress (owner: levels-hud).
// Spec: docs/DESIGN.md §7. All interactive controls >= 68x68 CSS px, <= 5 visible in AIM/FLIGHT,
// 0 scrollbars and 0 overlaps across 1280x800, 1024x768, 844x390, 390x844.

import { STATE, EV, PIGS, BIRD_IDS, SLING } from '../contracts.js';
import { bus } from '../core/bus.js';
import { BIRDS } from '../birds/index.js';
import { LEVELS } from '../levels/levels.js';
import { uiBridge } from './ui_state.js';
import {
  loadProgress, saveProgress, isLevelUnlocked, recordLevelClear,
} from './progress.js';

const BIOME_ROWS = [
  { key: 'grass', label: '草原', badge: '🌿' },
  { key: 'desert', label: '沙漠', badge: '🏜️' },
  { key: 'city', label: '都市', badge: '🌃' },
];

export class Hud {
  constructor(root, game, app) {
    this.root = root;
    this.game = game;
    this.app = app;
    uiBridge.hud = this;

    this.progress = loadProgress();
    if (this.progress.muted && this.app.audio) {
      this.app.audio.setMuted(true);
    }

    const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    const directPlay = params.has('level') || params.has('smoke');
    this._swallowBootStart = !directPlay;

    // Active screen: 'title' | 'select' | 'codex' | 'play' | 'pause' | 'clear' | 'fail'
    this.screen = directPlay ? 'play' : 'title';
    this._prevMenuScreen = 'title';

    this.displayScore = 0;
    this._resultScore = 0;
    this._resultTargetScore = 0;
    this._resultElapsed = 0;
    this._resultStars = 0;
    this._resultStarsPopped = 0;
    this._lastIconBirdId = null;

    this._bannerTimer = 0;
    this._bannerKind = null; // 'bird' (~36% height, AIM only) | 'event' (~44% height, 全灭！ etc.)
    this._portraitTipTimer = 0;
    this._wasPortrait = false;

    // C1 (#109): first-time kids coach state (persists tutorialDone in musou_progress; also shows AIM on 1-1 until first launch)
    this._coachT = 0.55;
    this._coachMode = null; // null | 'aim' | 'flight'
    this._coachDraggedThisRun = false;
    this._coachLaunchedThisRun = false;
    this._coachAbilityThisRun = false;
    this._sessionDragDone = false;
    this._sessionAbilityDone = false;

    this._buildDom();
    this._bindEvents();
    this._checkOrientation(true);
    this._syncScreens();
  }

  isPlayInteractive() {
    return this.screen === 'play' && !this.app.paused;
  }

  // ---------------- DOM construction ----------------
  _buildDom() {
    this.root.innerHTML = `
      <!-- In-play HUD overlay -->
      <div id="hud-play" class="hud-layer">
        <button id="btn-pause" class="hud-btn hud-icon-btn" type="button" aria-label="暂停">⏸</button>
        <button id="btn-restart" class="hud-btn hud-icon-btn" type="button" aria-label="重新开始">↻</button>

        <div id="hud-top-pill" class="hud-pill" aria-live="polite">
          <div class="hud-pill-main">
            <span id="hud-level">关卡 1-1</span>
            <span class="hud-sep">·</span>
            <span id="hud-score">分数 0</span>
            <span class="hud-sep">·</span>
            <span id="hud-stars" class="hud-stars"><span class="st">★</span><span class="st">★</span><span class="st">★</span></span>
          </div>
          <div id="hud-goals" class="hud-pill-sub">★分数≥42000 · ★用鸟≤1</div>
        </div>

        <div id="hud-pigs" class="hud-pigs">🐷 × <span id="hud-pigs-count">0</span></div>

        <div id="hud-boss" class="hud-boss" hidden>
          <span id="hud-boss-name" class="hud-boss-name">猪王</span>
          <div class="hud-boss-track">
            <div id="hud-boss-fill" class="hud-boss-fill"></div>
            <span id="hud-boss-hp" class="hud-boss-hp">11578</span>
          </div>
        </div>

        <div id="hud-banner" class="hud-banner" hidden>
          <div id="hud-banner-main" class="hud-banner-main"></div>
          <div id="hud-banner-sub" class="hud-banner-sub"></div>
        </div>

        <div id="hud-portrait-tip" class="hud-portrait-tip" hidden>📱 横屏更好玩</div>

        <div id="hud-coach" class="hud-layer hud-coach" hidden>
          <canvas id="hud-coach-canvas" class="hud-coach-canvas"></canvas>
          <div id="hud-coach-pill" class="hud-coach-pill" hidden></div>
        </div>

        <button id="btn-next" class="hud-btn hud-next-btn" type="button" aria-label="下一只" hidden>
          <span class="next-label">下一只</span>
          <span class="next-arrow">→</span>
        </button>

        <button id="btn-ability" class="hud-btn hud-ability-btn aim-chip" type="button" aria-label="技能">
          <canvas id="ability-icon" width="44" height="44"></canvas>
          <span id="ability-label" class="ability-label">技能</span>
        </button>
      </div>

      <!-- Title Screen (live level rendered behind) -->
      <div id="screen-title" class="modal-backdrop title-backdrop" hidden>
        <div class="title-wrap">
          <div class="title-sub-badge">10倍强化 · 全屏狂飙</div>
          <h1 class="title-main">愤怒的小鸟</h1>
          <div class="title-musou" aria-label="无双版">无双版</div>
          <div class="title-actions">
            <button id="btn-title-play" class="menu-btn primary" type="button">▶ 开始游戏</button>
            <button id="btn-title-select" class="menu-btn" type="button">🗺️ 选关</button>
            <button id="btn-title-codex" class="menu-btn" type="button">📖 鸟类图鉴</button>
          </div>
        </div>
      </div>

      <!-- Level Select Screen (3 biome rows, >= 96px tiles, stars, locks) -->
      <div id="screen-select" class="modal-backdrop panel-backdrop" hidden>
        <div class="select-shell">
          <div class="panel-rail">
            <button id="btn-select-back" class="hud-btn back-btn" type="button" aria-label="返回">←</button>
            <div class="panel-heading">
              <div class="panel-title">选择关卡</div>
              <div id="select-total-stars" class="panel-stars-summary">★ 0 / 39</div>
            </div>
          </div>
          <div id="select-rows" class="select-rows"></div>
        </div>
      </div>

      <!-- Bird Codex Screen (12 birds from BIRDS) -->
      <div id="screen-codex" class="modal-backdrop panel-backdrop" hidden>
        <div class="codex-shell">
          <div class="panel-rail">
            <button id="btn-codex-back" class="hud-btn back-btn" type="button" aria-label="返回">←</button>
            <div class="panel-heading">
              <div class="panel-title">鸟类图鉴</div>
              <div class="panel-stars-summary">12只无双神鸟</div>
            </div>
          </div>
          <div id="codex-grid" class="codex-grid"></div>
        </div>
      </div>

      <!-- Pause Modal -->
      <div id="screen-pause" class="modal-backdrop" hidden>
        <div class="dialog-card pause-card" role="dialog" aria-label="已暂停">
          <div class="dialog-title">游戏暂停</div>
          <div class="pause-grid">
            <button id="btn-pause-resume" class="menu-btn primary" type="button">▶ 继续</button>
            <button id="btn-pause-restart" class="menu-btn" type="button">↻ 重新开始</button>
            <button id="btn-pause-select" class="menu-btn" type="button">🗺️ 选关</button>
            <button id="btn-pause-mute" class="menu-btn" type="button">🔊 音效：开</button>
          </div>
        </div>
      </div>

      <!-- Clear / Results Modal -->
      <div id="screen-clear" class="modal-backdrop" hidden>
        <div class="dialog-card result-card" role="dialog" aria-label="过关">
          <div class="dialog-title clear-title">过关！</div>
          <div id="clear-level-name" class="dialog-sub">关卡 1-1 · 风火轮</div>
          <div class="result-stars" id="clear-stars">
            <span class="res-star" data-idx="1">★</span>
            <span class="res-star" data-idx="2">★</span>
            <span class="res-star" data-idx="3">★</span>
          </div>
          <div class="result-scores">
            <div class="result-score-big">分数 <span id="clear-score">0</span></div>
            <div class="result-score-meta">
              <span id="clear-best">最高 0</span> · <span id="clear-birds">用鸟 1</span>
            </div>
          </div>
          <div class="dialog-actions">
            <button id="btn-clear-retry" class="menu-btn" type="button">↻ 重玩</button>
            <button id="btn-clear-select" class="menu-btn" type="button">🗺️ 选关</button>
            <button id="btn-clear-next" class="menu-btn primary" type="button">下一关 ▶</button>
          </div>
        </div>
      </div>

      <!-- Fail Modal -->
      <div id="screen-fail" class="modal-backdrop" hidden>
        <div class="dialog-card result-card" role="dialog" aria-label="挑战失败">
          <div class="dialog-title fail-title">猪猪还在！</div>
          <div id="fail-sub" class="dialog-sub">剩余 🐷 × 1 · 分数 0</div>
          <div class="dialog-actions">
            <button id="btn-fail-select" class="menu-btn" type="button">🗺️ 选关</button>
            <button id="btn-fail-retry" class="menu-btn primary" type="button">↻ 重试</button>
          </div>
        </div>
      </div>
    `;

    this.$ = (sel) => this.root.querySelector(sel);
    this._els = {
      play: this.$('#hud-play'),
      title: this.$('#screen-title'),
      select: this.$('#screen-select'),
      codex: this.$('#screen-codex'),
      pause: this.$('#screen-pause'),
      clear: this.$('#screen-clear'),
      fail: this.$('#screen-fail'),

      btnPause: this.$('#btn-pause'),
      btnRestart: this.$('#btn-restart'),
      btnAbility: this.$('#btn-ability'),
      abilityIcon: this.$('#ability-icon'),
      abilityLabel: this.$('#ability-label'),
      btnNext: this.$('#btn-next'),

      level: this.$('#hud-level'),
      score: this.$('#hud-score'),
      stars: this.$('#hud-stars').querySelectorAll('.st'),
      goals: this.$('#hud-goals'),
      pigsCount: this.$('#hud-pigs-count'),

      boss: this.$('#hud-boss'),
      bossName: this.$('#hud-boss-name'),
      bossFill: this.$('#hud-boss-fill'),
      bossHp: this.$('#hud-boss-hp'),

      banner: this.$('#hud-banner'),
      bannerMain: this.$('#hud-banner-main'),
      bannerSub: this.$('#hud-banner-sub'),
      portraitTip: this.$('#hud-portrait-tip'),
      coach: this.$('#hud-coach'),
      coachCanvas: this.$('#hud-coach-canvas'),
      coachPill: this.$('#hud-coach-pill'),

      selectRows: this.$('#select-rows'),
      selectStars: this.$('#select-total-stars'),
      codexGrid: this.$('#codex-grid'),
      muteBtn: this.$('#btn-pause-mute'),

      clearLevelName: this.$('#clear-level-name'),
      clearStars: this.$('#clear-stars').querySelectorAll('.res-star'),
      clearScore: this.$('#clear-score'),
      clearBest: this.$('#clear-best'),
      clearBirds: this.$('#clear-birds'),
      btnClearNext: this.$('#btn-clear-next'),

      failSub: this.$('#fail-sub'),
    };

    this._renderSelectRows();
    this._renderCodex();
    this._syncMuteLabel();
  }

  _bindEvents() {
    const click = (sel, fn) => {
      const el = this.$(sel);
      if (!el) return;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.audio?.unlock?.();
        this.app.audio?.play?.('ui_click');
        fn();
      });
    };

    // Play HUD controls
    click('#btn-pause', () => this.openPause());
    click('#btn-restart', () => this.doRestart());
    click('#btn-ability', () => {
      if (this.game.state === STATE.FLIGHT && !this.game.abilityUsed) {
        this.app.ability();
      }
    });
    click('#btn-next', () => {
      if (this.game.state === STATE.FLIGHT) {
        this.app.next();
      }
    });

    // Title buttons
    click('#btn-title-play', () => this._startFromTitle());
    click('#btn-title-select', () => this.openSelect('title'));
    click('#btn-title-codex', () => this.openCodex('title'));

    // Select & Codex back buttons
    click('#btn-select-back', () => this._closeSubMenu());
    click('#btn-codex-back', () => this._closeSubMenu());

    // Pause buttons
    click('#btn-pause-resume', () => this.resumePause());
    click('#btn-pause-restart', () => this.doRestart());
    click('#btn-pause-select', () => this.openSelect('pause'));
    click('#btn-pause-mute', () => this.toggleMute());

    // Clear buttons
    click('#btn-clear-retry', () => this.doRestart());
    click('#btn-clear-select', () => this.openSelect('title'));
    click('#btn-clear-next', () => this.goNextLevel());

    // Fail buttons
    click('#btn-fail-retry', () => this.doRestart());
    click('#btn-fail-select', () => this.openSelect('title'));

    window.addEventListener('resize', () => this._checkOrientation(false));

    // Bus listeners
    bus.on(EV.LEVEL_START, ({ levelId }) => {
      this.displayScore = 0;
      this._hideBanner();
      this._lastIconBirdId = null;
      this._coachDraggedThisRun = false;
      this._coachLaunchedThisRun = false;
      this._coachAbilityThisRun = false;
      this._coachT = 0.55;

      if (this._swallowBootStart) {
        this._swallowBootStart = false;
        this._syncScreens();
        return;
      }
      this.progress = loadProgress();
      this.progress.lastLevel = levelId;
      saveProgress(this.progress);
      this.app.paused = false;
      this.setScreen('play');
      const lv = LEVELS.find((l) => l.id === levelId);
      if (lv) this.app.audio?.music?.(lv.biome);
      // Show opening BIRD_READY banner during AIM (~36% height) now that screen === 'play'
      if (this.game.state === STATE.AIM || this.game.state === STATE.INTRO) {
        const bId = this.game.currentBirdId;
        const def = bId && BIRDS[bId];
        if (def) this.showBanner(`${def.name} · ${def.ability}`, '', '#fff7d6', false, 1.2, 'bird');
      }
      this._syncPlayControls();
      this._syncCoach(0);
    });

    bus.on(EV.BIRD_READY, ({ birdId }) => {
      this._syncPlayControls();
      if (this._swallowBootStart || this.screen !== 'play') return;
      if (this.game.state !== STATE.AIM && this.game.state !== STATE.INTRO) return;
      const def = birdId && BIRDS[birdId];
      if (def) {
        this.showBanner(`${def.name} · ${def.ability}`, '', '#fff7d6', false, 1.2, 'bird');
        this.app.audio?.play?.('ability_ready');
      }
      this._syncCoach(0);
    });

    bus.on(EV.LAUNCH, () => {
      this._coachDraggedThisRun = true;
      this._coachLaunchedThisRun = true;
      this._sessionDragDone = true;
      this._coachT = 0;
      if (this._bannerKind === 'bird') {
        this._fadeOutBirdBanner();
      }
      this._syncPlayControls();
      this._syncCoach(0);
    });

    bus.on(EV.ABILITY, () => {
      this._coachAbilityThisRun = true;
      this._sessionAbilityDone = true;
      if (!this.progress.tutorialDone) {
        this.progress.tutorialDone = true;
        saveProgress(this.progress);
      }
      // Never leave or re-show bird·ability banner during ABILITY (#97)
      if (this._bannerKind === 'bird') {
        this._hideBanner();
      }
      this._syncPlayControls();
      this._syncCoach(0);
    });

    bus.on(EV.BANNER, (p) => {
      if (!p || !p.text || this.screen !== 'play') return;
      // Suppress any bird·技能 text emitted during flight/ability; EV.BANNER at ~44% is for 全灭！ etc.
      const isBirdTitle = Object.values(BIRDS).some(
        (b) => b && (p.text.includes(b.ability) || (p.text.includes(b.name) && p.text.includes('·')))
      );
      if (isBirdTitle && this.game.state !== STATE.AIM) return;
      this.showBanner(p.text, p.sub || '', p.color || '#ffcc00', !!p.big, p.big ? 1.35 : 1.2, 'event');
    });

    bus.on(EV.LEVEL_CLEAR, (p) => {
      const rec = recordLevelClear(this.progress, p, LEVELS);
      this._openClearModal(p, rec.best);
      this.app.audio?.play?.('clear');
    });

    bus.on(EV.LEVEL_FAIL, (p) => {
      this._openFailModal(p);
      this.app.audio?.play?.('fail');
    });
  }

  // ---------------- Screen & Action management ----------------
  setScreen(s) {
    this.screen = s;
    this._syncScreens();
  }

  _syncScreens() {
    const s = this.screen;
    this._els.play.hidden = s !== 'play';
    this._els.title.hidden = s !== 'title';
    this._els.select.hidden = s !== 'select';
    this._els.codex.hidden = s !== 'codex';
    this._els.pause.hidden = s !== 'pause';
    this._els.clear.hidden = s !== 'clear';
    this._els.fail.hidden = s !== 'fail';
  }

  _startFromTitle() {
    // Pick first unlocked & uncleared level, else '1-1'
    let targetId = '1-1';
    for (const lv of LEVELS) {
      if (isLevelUnlocked(this.progress, lv.id, LEVELS) && !(this.progress.levels[lv.id]?.stars >= 1)) {
        targetId = lv.id;
        break;
      }
    }
    this.app.startLevel(targetId, { seed: 1 });
  }

  openSelect(from = 'title') {
    this._prevMenuScreen = from;
    if (from === 'play' || from === 'pause') this.app.paused = true;
    this._renderSelectRows();
    this.setScreen('select');
  }

  openCodex(from = 'title') {
    this._prevMenuScreen = from;
    this._renderCodex();
    this.setScreen('codex');
  }

  _closeSubMenu() {
    if (this._prevMenuScreen === 'pause') {
      this.setScreen('pause');
    } else {
      this.app.paused = false;
      this.setScreen('title');
    }
  }

  openPause() {
    if (this.screen !== 'play') return;
    this.app.paused = true;
    this._syncMuteLabel();
    this.setScreen('pause');
  }

  resumePause() {
    if (this.screen !== 'pause') return;
    this.app.paused = false;
    this.setScreen('play');
  }

  togglePause() {
    if (this.screen === 'play') this.openPause();
    else if (this.screen === 'pause') this.resumePause();
  }

  doRestart() {
    this.app.paused = false;
    if (this.game.level) {
      this.app.restart();
    } else {
      this.app.startLevel('1-1', { seed: 1 });
    }
  }

  goNextLevel() {
    const curId = this.game.level ? this.game.level.id : '1-1';
    const idx = LEVELS.findIndex((l) => l.id === curId);
    if (idx >= 0 && idx + 1 < LEVELS.length) {
      const nextLv = LEVELS[idx + 1];
      if (isLevelUnlocked(this.progress, nextLv.id, LEVELS)) {
        this.app.startLevel(nextLv.id, { seed: 1 });
        return;
      }
    }
    this.openSelect('title');
  }

  toggleMute() {
    const next = !(this.app.audio ? this.app.audio.isMuted() : this.progress.muted);
    this.app.audio?.setMuted?.(next);
    this.progress.muted = next;
    saveProgress(this.progress);
    this._syncMuteLabel();
  }

  _syncMuteLabel() {
    const muted = this.app.audio ? this.app.audio.isMuted() : this.progress.muted;
    this._els.muteBtn.textContent = muted ? '🔇 音效：关' : '🔊 音效：开';
  }

  handleKey(e) {
    const code = e.code;
    if (code === 'Escape') {
      if (this.screen === 'play') { this.openPause(); return true; }
      if (this.screen === 'pause') { this.resumePause(); return true; }
      if (this.screen === 'select' || this.screen === 'codex') { this._closeSubMenu(); return true; }
      return false;
    }
    if (code === 'Space') {
      if (this.screen === 'play' && this.game.state === STATE.FLIGHT && !this.game.abilityUsed) {
        this.app.ability();
        return true;
      }
      return false;
    }
    if (code === 'KeyR') {
      if (this.screen === 'play' || this.screen === 'pause' || this.screen === 'clear' || this.screen === 'fail') {
        this.doRestart();
        return true;
      }
      return false;
    }
    if (code === 'KeyN') {
      if (this.screen === 'play' && this.game.state === STATE.FLIGHT) {
        this.app.next();
        return true;
      }
      return false;
    }
    return false;
  }

  // ---------------- Level Select & Codex Rendering ----------------
  _renderSelectRows() {
    this.progress = loadProgress();
    let totalStars = 0;
    for (const lv of LEVELS) {
      totalStars += Math.min(3, this.progress.levels[lv.id]?.stars || 0);
    }
    this._els.selectStars.textContent = `★ ${totalStars} / ${LEVELS.length * 3}`;

    const frag = document.createDocumentFragment();
    for (const row of BIOME_ROWS) {
      const rowEl = document.createElement('div');
      rowEl.className = `biome-row biome-${row.key}`;

      const labelEl = document.createElement('div');
      labelEl.className = 'biome-label';
      labelEl.innerHTML = `<span class="biome-emoji">${row.badge}</span><span class="biome-name">${row.label}</span>`;
      rowEl.appendChild(labelEl);

      const tilesWrap = document.createElement('div');
      tilesWrap.className = 'biome-tiles';
      const rowLevels = LEVELS.filter((l) => l.biome === row.key);
      for (const lv of rowLevels) {
        const unlocked = isLevelUnlocked(this.progress, lv.id, LEVELS);
        const st = this.progress.levels[lv.id]?.stars || 0;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-tile' + (unlocked ? '' : ' locked') + (lv.id === '3-5' ? ' bonus-tile' : '');
        btn.dataset.level = lv.id;
        btn.dataset.levelId = lv.id;
        btn.setAttribute('aria-label', unlocked ? `关卡 ${lv.id} ${lv.name}` : `关卡 ${lv.id} 未解锁`);
        if (!unlocked) btn.disabled = true;

        if (unlocked) {
          const starsHtml = [1, 2, 3]
            .map((i) => `<span class="tile-star ${i <= st ? 'lit' : ''}">★</span>`)
            .join('');
          btn.innerHTML = `
            <span class="tile-id">${lv.id}</span>
            <span class="tile-name">${lv.name}</span>
            <span class="tile-stars">${starsHtml}</span>
          `;
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.app.audio?.unlock?.();
            this.app.audio?.play?.('ui_click');
            this.app.startLevel(lv.id, { seed: 1 });
          });
        } else {
          const lockNote = lv.id === '3-5' ? '通关3-4解锁' : '未解锁';
          btn.innerHTML = `
            <span class="tile-id">${lv.id}</span>
            <span class="tile-lock">🔒</span>
            <span class="tile-lock-sub">${lockNote}</span>
          `;
        }
        tilesWrap.appendChild(btn);
      }
      rowEl.appendChild(tilesWrap);
      frag.appendChild(rowEl);
    }
    this._els.selectRows.innerHTML = '';
    this._els.selectRows.appendChild(frag);
  }

  _renderCodex() {
    const frag = document.createDocumentFragment();
    for (const id of BIRD_IDS) {
      const b = BIRDS[id];
      if (!b) continue;
      const card = document.createElement('div');
      card.className = 'codex-card';
      card.innerHTML = `
        <div class="codex-card-top">
          <canvas class="codex-icon" width="42" height="42"></canvas>
          <div class="codex-meta">
            <div class="codex-name">${b.name}</div>
            <div class="codex-ability">${b.ability}</div>
          </div>
        </div>
        <div class="codex-desc">${b.desc}</div>
      `;
      const cvs = card.querySelector('canvas');
      drawBirdToCanvas(cvs, b, 42);
      frag.appendChild(card);
    }
    this._els.codexGrid.innerHTML = '';
    this._els.codexGrid.appendChild(frag);
  }

  // ---------------- Results & Fail Modals ----------------
  _openClearModal(p, bestScore) {
    const lv = LEVELS.find((l) => l.id === p.levelId) || this.game.level;
    this._els.clearLevelName.textContent = lv ? `关卡 ${lv.id} · ${lv.name}` : `关卡 ${p.levelId}`;
    this._resultScore = 0;
    this._resultTargetScore = Math.round(p.score || 0);
    this._resultElapsed = 0;
    this._resultStars = Math.max(1, Math.min(3, p.stars || 1));
    this._resultStarsPopped = 0;

    this._els.clearScore.textContent = '0';
    this._els.clearBest.textContent = `最高 ${bestScore}`;
    this._els.clearBirds.textContent = lv
      ? `用鸟 ${p.birdsUsed}/${lv.birds.length} (★≤${lv.par})`
      : `用鸟 ${p.birdsUsed}`;

    this._els.clearStars.forEach((el) => {
      el.classList.remove('pop', 'earned');
    });

    const idx = LEVELS.findIndex((l) => l.id === p.levelId);
    const hasNext = idx >= 0 && idx + 1 < LEVELS.length;
    this._els.btnClearNext.textContent = hasNext ? '下一关 ▶' : '选关 ▶';

    this.setScreen('clear');
  }

  _openFailModal(p) {
    this._els.failSub.textContent = `剩余 🐷 × ${p.pigsLeft} · 分数 ${Math.round(p.score || 0)}`;
    this.setScreen('fail');
  }

  // ---------------- Banners & Portrait Hint ----------------
  showBanner(mainText, subText = '', color = '#fff7d6', big = false, dur = 1.2, kind = 'event') {
    this._bannerKind = kind;
    this._els.bannerMain.textContent = mainText;
    this._els.bannerMain.style.color = color;
    this._els.bannerMain.classList.toggle('big', !!big);
    this._els.bannerSub.textContent = subText;
    this._els.bannerSub.hidden = !subText;
    this._els.banner.classList.toggle('bird-banner', kind === 'bird');
    this._els.banner.classList.toggle('event-banner', kind !== 'bird');
    this._els.banner.classList.remove('fading', 'anim');
    this._els.banner.hidden = false;
    void this._els.banner.offsetWidth;
    this._els.banner.classList.add('anim');
    this._bannerTimer = dur;
  }

  _fadeOutBirdBanner() {
    if (this._els.banner.hidden) return;
    this._els.banner.classList.remove('anim');
    this._els.banner.classList.add('fading');
    this._bannerTimer = Math.min(this._bannerTimer, 0.18);
  }

  _hideBanner() {
    this._bannerTimer = 0;
    this._bannerKind = null;
    this._els.banner.classList.remove('anim', 'fading', 'bird-banner', 'event-banner');
    this._els.banner.hidden = true;
  }

  _checkOrientation(initial = false) {
    if (typeof window === 'undefined') return;
    const isPortrait = window.innerHeight > window.innerWidth;
    if (isPortrait && (initial || !this._wasPortrait)) {
      this._portraitTipTimer = 3.0;
      if (this._els?.portraitTip) this._els.portraitTip.hidden = false;
    } else if (!isPortrait && this._els?.portraitTip) {
      this._portraitTipTimer = 0;
      this._els.portraitTip.hidden = true;
    }
    this._wasPortrait = isPortrait;
  }

  // ---------------- Frame Update ----------------
  update(dt = 1 / 60) {
    const stepDt = Math.min(0.1, Math.max(0, dt || 1 / 60));

    // Portrait 3s non-blocking tip
    if (this._portraitTipTimer > 0) {
      this._portraitTipTimer -= stepDt;
      if (this._portraitTipTimer <= 0) {
        this._els.portraitTip.hidden = true;
      }
    }

    // Results screen star pop sequence (0.35 s apart) + score count-up
    if (this.screen === 'clear') {
      this._resultElapsed += stepDt;
      while (
        this._resultStarsPopped < this._resultStars &&
        this._resultElapsed >= 0.12 + this._resultStarsPopped * 0.35
      ) {
        const idx = this._resultStarsPopped;
        this._resultStarsPopped++;
        const starEl = this._els.clearStars[idx];
        if (starEl) starEl.classList.add('earned', 'pop');
        this.app.audio?.play?.(`star${this._resultStarsPopped}`);
      }
      if (this._resultScore < this._resultTargetScore) {
        const diff = this._resultTargetScore - this._resultScore;
        const inc = Math.max(120, Math.ceil(diff * Math.min(1, stepDt * 10)));
        this._resultScore = Math.min(this._resultTargetScore, this._resultScore + inc);
        this._els.clearScore.textContent = String(this._resultScore);
      }
      return;
    }

    if (this.screen !== 'play') return;

    const g = this.game;
    if (!g.level || !g.world) return;

    // Banner timer (and enforce BIRD_READY banner is AIM-only)
    if (this._bannerKind === 'bird' && g.state !== STATE.AIM && g.state !== STATE.INTRO) {
      if (!this._els.banner.classList.contains('fading')) this._fadeOutBirdBanner();
    }
    if (this._bannerTimer > 0) {
      this._bannerTimer -= stepDt;
      if (this._bannerTimer <= 0) {
        this._hideBanner();
      }
    }

    // Smooth count-up score in top pill
    if (this.displayScore !== g.score) {
      if (g.score < this.displayScore) this.displayScore = g.score;
      else {
        const diff = g.score - this.displayScore;
        this.displayScore = Math.min(g.score, this.displayScore + Math.max(25, Math.ceil(diff * Math.min(1, stepDt * 14))));
      }
    }

    this._els.level.textContent = `关卡 ${g.level.id}`;
    this._els.score.textContent = `分数 ${this.displayScore}`;
    this._els.goals.textContent = `★分数≥${g.level.star2 || 0} · ★用鸟≤${g.level.par || 1}`;

    // Live star lighting
    const pigsAlive = g.world.pigs();
    const allDead = g.pigsAtStart > 0 && pigsAlive.length === 0;
    const s1 = allDead;
    const s2 = g.score >= (g.level.star2 || 0);
    const s3 = allDead && g.birdsUsed <= (g.level.par || 1);
    const litCount = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (s3 ? 1 : 0);
    this._els.stars.forEach((stEl, idx) => stEl.classList.toggle('lit', idx < litCount));

    // Pigs remaining counter (offscreen "→ 🐷" hint is drawn in-canvas by Renderer §5/§8)
    this._els.pigsCount.textContent = String(pigsAlive.length);

    // Boss HP bar (video style: red bar + exact HP integer when any boss pig is alive)
    let bossEnt = null;
    for (const p of pigsAlive) {
      if (PIGS[p.skin]?.boss) {
        if (!bossEnt || p.maxHp > bossEnt.maxHp) bossEnt = p;
      }
    }
    if (bossEnt) {
      this._els.boss.hidden = false;
      const def = PIGS[bossEnt.skin];
      this._els.bossName.textContent = def.label;
      const hpNow = Math.max(0, Math.ceil(bossEnt.hp));
      const pct = Math.max(0, Math.min(100, (bossEnt.hp / bossEnt.maxHp) * 100));
      this._els.bossFill.style.width = `${pct.toFixed(1)}%`;
      this._els.bossHp.textContent = String(hpNow);
    } else {
      this._els.boss.hidden = true;
    }

    // Ability button (H1: compact 72x72 70% opacity info chip in AIM; full size + pulse only in FLIGHT) & FLIGHT-only Next-bird button
    this._syncPlayControls();
    this._syncCoach(stepDt);
  }

  _syncPlayControls() {
    const g = this.game;
    if (!g.level || !g.world) return;
    const inFlight = g.state === STATE.FLIGHT;
    const activeId = inFlight && g.bird ? g.bird.data.birdId : g.currentBirdId;
    const def = activeId ? BIRDS[activeId] : null;
    const isAimChip = !inFlight;
    const ready = inFlight && !g.abilityUsed && !!def;
    const used = inFlight && g.abilityUsed;

    this._els.btnAbility.classList.toggle('aim-chip', isAimChip);
    this._els.btnAbility.classList.toggle('ready', ready);
    this._els.btnAbility.classList.toggle('used', used);
    this._els.abilityLabel.textContent = def ? def.ability : '技能';

    const isCompact = typeof window !== 'undefined' && window.innerHeight <= 460;
    const iconPx = isAimChip ? 32 : (isCompact ? 34 : 44);
    if (def && (this._lastIconBirdId !== `${def.id}:${iconPx}`)) {
      this._lastIconBirdId = `${def.id}:${iconPx}`;
      drawBirdToCanvas(this._els.abilityIcon, def, iconPx);
    }

    // 下一只 → visible ONLY in FLIGHT after ability used OR 2.5 s (§7 + H1)
    const showNext = inFlight && (g.abilityUsed || g.flightT >= 2.5);
    this._els.btnNext.hidden = !showNext;
  }

  // ---------------- C1 (#109) First-Time Kids Coach ----------------
  _computeCoachMode() {
    if (this.screen !== 'play' || this.app.paused) return null;
    const g = this.game;
    if (!g.level || !g.world) return null;

    // Detect real pull-back drag -> hide AIM coach immediately ("gone after the first drag")
    const inp = this.app.input;
    if (inp && inp.dragging && inp.aim && inp.aim().power >= SLING.MIN_POWER) {
      this._coachDraggedThisRun = true;
      this._sessionDragDone = true;
    }

    if (g.state === STATE.AIM && !(this.app.cam?.introActive?.())) {
      const freshAim = !this.progress.tutorialDone && !this._sessionDragDone;
      const lv11Aim = g.level.id === '1-1';
      if ((freshAim || lv11Aim) && g.birdsUsed === 0 && !this._coachDraggedThisRun && !this._coachLaunchedThisRun) {
        return 'aim';
      }
    }

    if (g.state === STATE.FLIGHT && !g.abilityUsed) {
      const freshFlight = !this.progress.tutorialDone && !this._sessionAbilityDone;
      if (freshFlight && !this._coachAbilityThisRun) {
        return 'flight';
      }
    }

    return null;
  }

  _syncCoach(dt = 0) {
    const mode = this._computeCoachMode();
    this._coachMode = mode;
    this._els.btnAbility.classList.toggle('coach-glow', mode === 'flight');

    if (!mode) {
      if (!this._els.coach.hidden) {
        this._els.coach.hidden = true;
        this._els.coachPill.hidden = true;
      }
      return;
    }

    this._coachT += Math.max(0, dt || 0);
    this._els.coach.hidden = false;
    this._els.coachPill.hidden = false;
    this._els.coachPill.classList.toggle('aim-mode', mode === 'aim');
    this._els.coachPill.classList.toggle('flight-mode', mode === 'flight');
    const wantedTxt = mode === 'aim' ? '按住小鸟往后拉，松手发射！' : '点屏幕放大招！';
    if (this._els.coachPill.textContent !== wantedTxt) {
      this._els.coachPill.textContent = wantedTxt;
    }
    this._drawCoachCanvas(mode);
  }

  _drawCoachCanvas(mode) {
    const cvs = this._els.coachCanvas;
    if (!cvs || typeof window === 'undefined') return;
    const vw = Math.max(1, window.innerWidth || 800);
    const vh = Math.max(1, window.innerHeight || 600);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const tw = Math.round(vw * dpr);
    const th = Math.round(vh * dpr);
    if (cvs.width !== tw || cvs.height !== th) {
      cvs.width = tw;
      cvs.height = th;
    }
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    if (mode === 'aim') {
      const pouch = this.game.pouch();
      const cam = this.app.cam;
      const px0 = cam ? cam.sx(pouch.x) : vw * 0.16;
      const py0 = cam ? cam.sy(pouch.y) : vh * 0.72;
      const sc = Math.max(20, Math.min(72, cam?.s || 42));
      const ang = 36 * Math.PI / 180;
      const pullDist = Math.max(46, Math.min(106, sc * 2.05));
      const px1 = Math.max(24, px0 - Math.cos(ang) * pullDist);
      const py1 = Math.min(vh - 24, py0 + Math.sin(ang) * pullDist);
      const cpx = (px0 + px1) * 0.5 - 14;
      const cpy = (py0 + py1) * 0.5 - 20;

      const u = (this._coachT % 1.75) / 1.75;
      let dragK = 0;
      let pressed = false;
      let alpha = 1;
      if (u < 0.18) {
        dragK = 0;
        pressed = u >= 0.07;
        alpha = Math.min(1, u / 0.08);
      } else if (u < 0.74) {
        const k = (u - 0.18) / 0.56;
        dragK = k * k * (3 - 2 * k);
        pressed = true;
      } else if (u < 0.90) {
        dragK = 1;
        pressed = false;
        alpha = 1 - (u - 0.74) / 0.16;
      } else {
        dragK = 0;
        pressed = false;
        alpha = (u - 0.90) / 0.10 * 0.4;
      }

      const qx = (1 - dragK) * (1 - dragK) * px0 + 2 * (1 - dragK) * dragK * cpx + dragK * dragK * px1;
      const qy = (1 - dragK) * (1 - dragK) * py0 + 2 * (1 - dragK) * dragK * cpy + dragK * dragK * py1;

      ctx.save();
      // 1. Soft pulse ring on the bird in the pouch
      const ringR = 20 + 6 * Math.sin(this._coachT * 5);
      ctx.beginPath();
      ctx.arc(px0, py0, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 224, 92, 0.78)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // 2. Curved dashed pull-back arc + arrowhead (pouch -> back-left)
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(px0, py0);
      ctx.quadraticCurveTo(cpx, cpy, px1, py1);
      ctx.strokeStyle = 'rgba(43, 21, 6, 0.75)';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.setLineDash([10, 8]);
      ctx.stroke();
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.restore();

      // Arrowhead at (px1, py1) along tangent from (cpx, cpy) -> (px1, py1)
      const tang = Math.atan2(py1 - cpy, px1 - cpx);
      ctx.save();
      ctx.translate(px1, py1);
      ctx.rotate(tang);
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-10, -8);
      ctx.lineTo(-10, 8);
      ctx.closePath();
      ctx.fillStyle = '#ffd54a';
      ctx.strokeStyle = '#2b1506';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fill();
      ctx.restore();

      // 3. Elastic stretch line + forward preview arc dots while dragging
      if (pressed && dragK > 0.04) {
        ctx.beginPath();
        ctx.moveTo(px0, py0);
        ctx.lineTo(qx, qy);
        ctx.strokeStyle = 'rgba(255, 138, 36, 0.88)';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Forward launch preview dots (up-and-right) showing where the bird will fly
        const reach = pullDist * (0.9 + 1.5 * dragK);
        for (let i = 1; i <= 6; i++) {
          const f = i / 6;
          const fx = px0 + Math.cos(ang) * reach * f;
          const fy = py0 - Math.sin(ang) * reach * f + 28 * f * f;
          ctx.beginPath();
          ctx.arc(fx, fy, Math.max(2.5, 5.5 - f * 2.5), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 248, 196, ${(0.85 - f * 0.45).toFixed(2)})`;
          ctx.strokeStyle = 'rgba(43, 21, 6, 0.7)';
          ctx.lineWidth = 1.6;
          ctx.fill();
          ctx.stroke();
        }
      }

      // 4. Animated cartoon hand pressing & dragging along the arc
      ctx.globalAlpha = Math.max(0.25, Math.min(1, alpha));
      drawCoachHand(ctx, qx, qy, pressed, vh <= 460 ? 0.84 : 1.0);
      ctx.restore();
      return;
    }

    if (mode === 'flight') {
      // Double golden spotlight rings around #btn-ability
      const ab = this._els.btnAbility;
      if (ab && !ab.hidden) {
        const r = ab.getBoundingClientRect();
        const cx = r.left + r.width * 0.5;
        const cy = r.top + r.height * 0.5;
        const pulse = 0.5 + 0.5 * Math.sin(this._coachT * 7);
        const rad = Math.max(r.width, r.height) * 0.58 + pulse * 12;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 224, 82, ${(0.88 - pulse * 0.35).toFixed(2)})`;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

/** Cute white-gloved cartoon pointer hand with fingertip anchored at (x, y). */
function drawCoachHand(ctx, x, y, pressed, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  const s = scale * (pressed ? 0.92 : 1.0);
  ctx.scale(s, s);

  if (pressed) {
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 214, 58, 0.42)';
    ctx.fill();
    ctx.strokeStyle = '#ffd54a';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  ctx.rotate(-0.38);
  ctx.fillStyle = '#fffdf5';
  ctx.strokeStyle = '#2b1506';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Index finger + rounded cartoon glove palm + thumb
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.quadraticCurveTo(-5, -6, 0, -6);
  ctx.quadraticCurveTo(5, -6, 5, 0);
  ctx.lineTo(5, 15);
  // Curled middle/ring/pinky knuckles
  ctx.quadraticCurveTo(12, 13, 13, 20);
  ctx.quadraticCurveTo(19, 19, 19, 26);
  ctx.quadraticCurveTo(23, 27, 21, 35);
  // Palm bottom
  ctx.quadraticCurveTo(18, 46, 4, 46);
  ctx.quadraticCurveTo(-9, 46, -12, 35);
  // Thumb sticking out left
  ctx.quadraticCurveTo(-21, 29, -18, 22);
  ctx.quadraticCurveTo(-15, 17, -6, 22);
  ctx.lineTo(-5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Golden wristband cuff
  ctx.fillStyle = '#ffb824';
  ctx.beginPath();
  ctx.roundRect(-9, 43, 24, 7, 3.5);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/** Draw a bird sprite cleanly onto a HUD/Codex 2D canvas using BIRDS[id].drawBird (or .icon). */
export function drawBirdToCanvas(canvas, def, sizePx = 44) {
  if (!canvas || !def) return;
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  canvas.width = Math.round(sizePx * dpr);
  canvas.height = Math.round(sizePx * dpr);
  canvas.style.width = `${sizePx}px`;
  canvas.style.height = `${sizePx}px`;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, sizePx, sizePx);
  if (typeof def.icon === 'function') {
    try { def.icon(g, sizePx); return; } catch (_) {}
  }
  const r = def.radius ?? 0.45;
  const scale = (sizePx * 0.34) / r;
  g.save();
  g.translate(sizePx * 0.46, sizePx * 0.55);
  g.scale(scale, scale);
  try {
    def.drawBird(g, { r, data: {}, status: {}, skin: def.id }, 0);
  } catch (_) {}
  g.restore();
}
