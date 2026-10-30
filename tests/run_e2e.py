#!/usr/bin/env python3
"""Comprehensive 48-test E2E verification suite for Angry Birds Musou (owner: qa-gates).

Covers all §1-§13 contracts and requirements:
- Page load with 0 console/runtime errors & 0 HTTP 4xx/5xx
- Repo hygiene: 0 speechSynthesis, 0 importmap/bare specifiers, 0 external CDN/media files
- Frozen window.__MUSOU__ seam & deep-cloned getState() immutability
- AudioContext strictly lazy-created ONLY after first real user gesture + mute toggle
- All 13 levels load & pass 600-frame idle stability (0 dead, 0 displaced, 0 damage)
- Real mouse drag on slingshot pouch (cancel on weak pull, preview + launch on pull >= 0.15)
- Left-35% relative drag aiming, canvas tap-to-ability, held pointer world tracking, keyboard shortcuts
- All 12 birds' 10x abilities (onLaunch/onStep/onTap/drawBird/projSkins/effects) with 0 exceptions
- Clear -> stars -> unused-bird bonus -> localStorage['musou_progress'] & 'qq_hall_progress' merge
- Fail flow, pause/resume/restart/next controls, Title/Codex, Level-Select biome rows & 3-5 lock
- Determinism (900 frames identical JSON), entity/particle/popup caps
- G10 multi-viewport layout_audit (1280x800, 1024x768, 844x390, 390x844)
- §13 sim_gates (--quick subset)

Exit code: 0 if fail == 0 (xfail allowed during parallel build unless --strict), 1 otherwise.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from typing import Any, Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from layout_audit import audit_viewport_on_session  # noqa: E402
from qa_helpers import (  # noqa: E402
    DESIGN_BIRDS,
    DESIGN_LEVELS,
    QA_TMP_DIR,
    QASession,
    REPO_ROOT,
    XFail,
    ensure_qa_dirs,
    is_bird_stubbed,
    is_hud_skeleton,
)
from sim_gates import run_sim_gates_on_session  # noqa: E402


# ---------------------------------------------------------------------------
# Group A: Boot, Hygiene, Seam & Audio Gesture Gate (T01 - T08)
# ---------------------------------------------------------------------------

def t01_page_load_zero_errors_zero_http_4xx(sess: QASession) -> None:
  sess.clear_diagnostics()
  assert sess.goto('index.html?level=1-1'), 'index.html?level=1-1 failed to load window.__MUSOU__'
  info = sess.eval_json(
      """(() => {
        const c = document.getElementById('game');
        const h = document.getElementById('hud');
        return {
          hasCanvas: Boolean(c),
          cw: c ? c.width : 0,
          ch: c ? c.height : 0,
          hasHud: Boolean(h),
          hasSeam: Boolean(window.__MUSOU__),
          hasApp: Boolean(window.__APP__),
        };
      })()"""
  )
  assert info['hasCanvas'] and info['cw'] > 0 and info['ch'] > 0, info
  assert info['hasHud'] and info['hasSeam'] and info['hasApp'], info
  sess.assert_clean('T01')


def t02_repo_hygiene_no_speech_synthesis_no_cdn(sess: QASession) -> None:
  del sess
  forbidden_speech: list[str] = []
  forbidden_importmap: list[str] = []
  bad_specifiers: list[str] = []
  external_urls: list[str] = []
  forbidden_assets: list[str] = []

  import_re = re.compile(r"""(?:import\s+(?:[^'"]+from\s+)?|export\s+[^'"]+from\s+|import\s*\()\s*['"]([^'"]+)['"]""")
  url_re = re.compile(r'https?://[^\s\'"`)]+')
  asset_exts = ('.mp3', '.wav', '.ogg', '.m4a', '.png', '.jpg', '.jpeg', '.webp', '.gif')

  scan_targets: list[str] = [os.path.join(REPO_ROOT, 'index.html')]
  for sub in ('src', 'styles'):
    base = os.path.join(REPO_ROOT, sub)
    for root, _, files in os.walk(base):
      for fn in files:
        full = os.path.join(root, fn)
        rel = os.path.relpath(full, REPO_ROOT)
        if fn.lower().endswith(asset_exts):
          forbidden_assets.append(rel)
        if fn.endswith(('.js', '.mjs', '.css', '.html')):
          scan_targets.append(full)

  for full in scan_targets:
    rel = os.path.relpath(full, REPO_ROOT)
    with open(full, 'r', encoding='utf-8') as f:
      raw = f.read()
    if 'speechSynthesis' in raw or 'SpeechSynthesisUtterance' in raw:
      forbidden_speech.append(rel)
    if rel.endswith('.html') and 'importmap' in raw.lower():
      forbidden_importmap.append(rel)
    # Strip line comments and block comments before checking external URLs / imports.
    stripped = re.sub(r'/\*[\s\S]*?\*/', '', raw)
    stripped = re.sub(r'(?m)^\s*//.*$', '', stripped)
    stripped = re.sub(r'(?<!:)//.*$', '', stripped)
    for u in url_re.findall(stripped):
      if 'w3.org/2000/svg' in u:
        continue
      external_urls.append(f'{rel}: {u}')
    if rel.startswith('src/') and rel.endswith(('.js', '.mjs')):
      for m in import_re.finditer(stripped):
        spec = m.group(1)
        if not (spec.startswith('./') or spec.startswith('../')) or not spec.endswith(('.js', '.mjs')):
          bad_specifiers.append(f'{rel}: {spec}')

  assert not forbidden_speech, f'Forbidden speechSynthesis found: {forbidden_speech}'
  assert not forbidden_importmap, f'Forbidden importmap found: {forbidden_importmap}'
  assert not bad_specifiers, f'Bare or extensionless module imports found: {bad_specifiers}'
  assert not external_urls, f'External runtime URLs found: {external_urls}'
  assert not forbidden_assets, f'External binary media assets found (must be procedural): {forbidden_assets}'


def t03_seam_frozen_and_contract_surface(sess: QASession) -> None:
  res = sess.eval_json(
      """(() => {
        const desc = Object.getOwnPropertyDescriptor(window, '__MUSOU__');
        const M = window.__MUSOU__;
        let mutateThrew = false;
        let overwriteThrew = false;
        try {
          (() => { 'use strict'; M.__injected = 123; })();
        } catch (_e) {
          mutateThrew = true;
        }
        try {
          (() => { 'use strict'; M.version = 999; })();
        } catch (_e) {
          overwriteThrew = true;
        }
        const required = [
          'version', 'listLevels', 'listBirds', 'startLevel', 'launch',
          'useAbility', 'skipTurn', 'stepFrames', 'getState', 'setPaused', 'perf',
        ];
        const missing = required.filter((k) => !(k in M));
        return {
          frozen: Object.isFrozen(M),
          writable: desc ? Boolean(desc.writable) : true,
          configurable: desc ? Boolean(desc.configurable) : true,
          mutateThrew,
          overwriteThrew,
          injectedPresent: '__injected' in M,
          missing,
        };
      })()"""
  )
  assert res['frozen'] is True, res
  assert res['writable'] is False and res['configurable'] is False, res
  assert res['mutateThrew'] is True and res['overwriteThrew'] is True, res
  assert res['injectedPresent'] is False, res
  assert res['missing'] == [], f'Missing seam properties: {res["missing"]}'


def t04_getstate_deep_clone_immutability(sess: QASession) -> None:
  res = sess.eval_json(
      """(() => {
        const M = window.__MUSOU__;
        const s1 = M.startLevel('1-1', { seed: 101 });
        const origPigs = s1.pigs.length;
        const origQueue = s1.birdQueue.length;
        s1.score = 999999;
        s1.state = 'corrupted';
        s1.pigs.length = 0;
        s1.birdQueue.push('corrupted_bird');
        if (s1.stats) s1.stats.damageDealt = 888888;
        s1.events.push({ type: 'fake_event' });

        const s2 = M.getState();
        return {
          score: s2.score,
          state: s2.state,
          pigsLen: s2.pigs.length,
          origPigs,
          queueLen: s2.birdQueue.length,
          origQueue,
          dmg: s2.stats ? s2.stats.damageDealt : -1,
          hasFakeEvent: s2.events.some((e) => e.type === 'fake_event'),
        };
      })()"""
  )
  assert res['score'] == 0, res
  assert res['state'] != 'corrupted', res
  assert res['pigsLen'] == res['origPigs'] and res['pigsLen'] > 0, res
  assert res['queueLen'] == res['origQueue'], res
  assert res['dmg'] == 0, res
  assert res['hasFakeEvent'] is False, res


def t05_contracts_and_12_bird_registry(sess: QASession) -> None:
  res = sess.eval_json(
      """(async () => {
        const C = await import('./src/contracts.js');
        const B = await import('./src/birds/index.js');
        const listed = window.__MUSOU__.listBirds();
        const details = C.BIRD_IDS.map((id) => {
          const m = B.BIRDS[id];
          return {
            id,
            exists: Boolean(m),
            name: m ? m.name : '',
            ability: m ? m.ability : '',
            desc: m ? m.desc : '',
            hasDraw: Boolean(m && typeof m.drawBird === 'function'),
            hasTap: Boolean(m && typeof m.onTap === 'function'),
          };
        });
        return {
          birdIds: Array.from(C.BIRD_IDS),
          listedIds: listed.map((b) => b.id),
          details,
        };
      })()"""
  )
  expected_ids = [b['id'] for b in DESIGN_BIRDS]
  assert res['birdIds'] == expected_ids, res
  assert res['listedIds'] == expected_ids, res
  for d in res['details']:
    assert d['exists'] and d['name'] and d['ability'] and d['desc'], d
    assert d['hasDraw'] and d['hasTap'], d


def t06_audio_context_only_after_user_gesture(sess: QASession) -> None:
  assert sess.b is not None
  # Inject an AudioContext creation spy before fresh navigation.
  script_res = sess.b.cmd(
      'Page.addScriptToEvaluateOnNewDocument',
      source="""
        window.__QA_AUDIO_CTXS__ = 0;
        const _OrigAC = window.AudioContext || window.webkitAudioContext;
        if (_OrigAC) {
          const WrappedAC = function(...args) {
            window.__QA_AUDIO_CTXS__++;
            return new _OrigAC(...args);
          };
          WrappedAC.prototype = _OrigAC.prototype;
          window.AudioContext = WrappedAC;
          if (window.webkitAudioContext) window.webkitAudioContext = WrappedAC;
        }
      """,
  )
  ident = script_res.get('identifier')
  try:
    assert sess.goto('index.html?level=1-1'), 'Reload for AudioContext test failed'
    before = sess.eval_json(
        """(() => {
          const M = window.__MUSOU__;
          M.startLevel('1-1', { seed: 3 });
          M.launch(40, 0.9);
          M.stepFrames(35);
          M.useAbility();
          M.stepFrames(30);
          const a = window.__APP__ && window.__APP__.audio;
          return {
            spyCount: window.__QA_AUDIO_CTXS__ || 0,
            hasCtx: Boolean(a && a.context),
          };
        })()"""
    )
    assert before['spyCount'] == 0 and before['hasCtx'] is False, (
        f'AudioContext created BEFORE user gesture: {before}'
    )

    # Real user pointer tap on canvas unlocks AudioContext.
    sess.pointer_tap(300, 300)
    after = sess.eval_json(
        """(() => {
          const a = window.__APP__.audio;
          a.setMuted(true);
          const m1 = a.isMuted();
          a.setMuted(false);
          const m2 = a.isMuted();
          return {
            spyCount: window.__QA_AUDIO_CTXS__ || 0,
            hasCtx: Boolean(a.context),
            m1,
            m2,
          };
        })()"""
    )
    assert after['spyCount'] >= 1 or after['hasCtx'] is True, (
        f'AudioContext was not created on real pointer gesture: {after}'
    )
    assert after['m1'] is True and after['m2'] is False, after
  finally:
    if ident:
      sess.b.cmd('Page.removeScriptToEvaluateOnNewDocument', identifier=ident)
  sess.assert_clean('T06')


def t07_canvas_procedural_rendering_non_blank(sess: QASession) -> None:
  res = sess.eval_json(
      """(async () => {
        const M = window.__MUSOU__;
        M.setPaused(false);
        M.startLevel('1-1', { seed: 1 });
        if (window.__APP__?.cam?.skipIntro) window.__APP__.cam.skipIntro();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const c = document.getElementById('game');
        const g = c.getContext('2d');
        const buckets = new Set();
        let opaque = 0;
        for (let gy = 0; gy < 8; gy++) {
          for (let gx = 0; gx < 12; gx++) {
            const px = Math.floor((gx + 0.5) * c.width / 12);
            const py = Math.floor((gy + 0.5) * c.height / 8);
            const d = g.getImageData(px, py, 1, 1).data;
            if (d[3] > 0) opaque++;
            buckets.add(`${d[0] >> 4}_${d[1] >> 4}_${d[2] >> 4}`);
          }
        }
        return { samples: 96, opaque, distinctBuckets: buckets.size };
      })()"""
  )
  assert res['opaque'] == 96, res
  assert res['distinctBuckets'] >= 3, f'Canvas appears blank/monochrome: {res}'


def t08_determinism_900_frames_identical_json(sess: QASession) -> None:
  res = sess.eval_json(
      """(() => {
        const M = window.__MUSOU__;
        const run900 = (lvId) => {
          M.startLevel(lvId, { seed: 2026 });
          M.setPaused(true);
          let f = 0;
          while (M.getState().state === 'intro' && f < 180) { M.stepFrames(6); f += 6; }
          M.launch(38, 0.91);
          M.stepFrames(36); f += 36;
          M.useAbility();
          M.stepFrames(900 - f);
          return M.getState();
        };
        const a = run900('1-1');
        const b = run900('1-1');
        const ja = JSON.stringify(a);
        const jb = JSON.stringify(b);
        return { identical: ja === jb, a, b };
      })()"""
  )
  sess.eval('window.__MUSOU__.setPaused(false)')
  assert res['identical'] is True, f"Non-deterministic getState() JSON: {res['a']} vs {res['b']}"


# ---------------------------------------------------------------------------
# Group B: 13-Level Schema & 600-Frame Idle Stability (T09 - T12)
# ---------------------------------------------------------------------------

def t09_level_roster_13_levels_3_biomes_schema(sess: QASession) -> None:
  res = sess.eval_json(
      """(() => {
        const M = window.__MUSOU__;
        const list = M.listLevels();
        const details = list.map((lv) => {
          const st = M.startLevel(lv.id, { seed: 1 });
          return {
            ...lv,
            pigsAtStart: st.pigsAtStart,
            blocksAtStart: st.blocksAtStart,
            pigVariants: st.pigs.map((p) => p.variant),
            pigMaxHps: st.pigs.map((p) => p.maxHp),
          };
        });
        return details;
      })()"""
  )
  by_id = {d['id']: d for d in res}
  missing = [spec['id'] for spec in DESIGN_LEVELS if spec['id'] not in by_id]

  # Validate every currently landed level strictly against contracts.
  schema_errors: list[str] = []
  under_count: list[str] = []
  for spec in DESIGN_LEVELS:
    lid = spec['id']
    if lid not in by_id:
      continue
    got = by_id[lid]
    if got['biome'] != spec['biome']:
      schema_errors.append(f"{lid}: biome={got['biome']} expected {spec['biome']}")
    if got['par'] != spec['par']:
      schema_errors.append(f"{lid}: par={got['par']} expected {spec['par']}")
    if not got['birds'] or got['birds'][0] != spec['birds'][0]:
      schema_errors.append(f"{lid}: featured bird={got['birds'][:2]} expected {spec['birds'][0]}")
    if lid == '3-5' and got['birds'] != spec['birds']:
      schema_errors.append(f"3-5: birds={got['birds']} expected all 12 in codex order")
    if got['pigsAtStart'] < spec['pigs']:
      under_count.append(f"{lid}: pigs={got['pigsAtStart']} < {spec['pigs']}")
    if got['blocksAtStart'] < spec['min_blocks']:
      under_count.append(f"{lid}: blocks={got['blocksAtStart']} < {spec['min_blocks']}")
    if spec['boss'] and spec['boss'] not in got['pigVariants']:
      under_count.append(f"{lid}: missing boss {spec['boss']} (got {got['pigVariants']})")

  assert not schema_errors, f'Level schema mismatches: {schema_errors}'
  if missing or (len(by_id) == 1 and under_count):
    raise XFail(f'waiting on @levels-hud: missing={missing}, under_count={under_count}')
  assert not under_count, f'Level entity/boss counts below §4 spec: {under_count}'


def _check_biome_levels_idle_stable(sess: QASession, level_ids: list[str], biome_label: str) -> None:
  live_ids = set(sess.eval_json('window.__MUSOU__.listLevels().map(l => l.id)'))
  present = [lid for lid in level_ids if lid in live_ids]
  missing = [lid for lid in level_ids if lid not in live_ids]

  failures: list[str] = []
  for lid in present:
    st = sess.eval_json(
        f"""(() => {{
          const M = window.__MUSOU__;
          M.setPaused(true);
          M.startLevel({json.dumps(lid)}, {{ seed: 1 }});
          while (M.getState().state === 'intro') M.stepFrames(6);
          M.stepFrames(600);
          const s = M.getState();
          M.setPaused(false);
          return {{
            id: s.levelId,
            pigsDead: s.pigsAtStart - s.pigsLeft,
            displaced: s.displaced,
            dmg: (s.stats && s.stats.damageDealt) || 0,
          }};
        }})()"""
    )
    if st['pigsDead'] != 0 or st['displaced'] != 0 or st['dmg'] != 0:
      failures.append(str(st))

  sess.assert_clean(f'idle_{biome_label}')
  assert not failures, f'G4 idle stability failed on {biome_label}: {failures}'
  if missing:
    raise XFail(f'waiting on @levels-hud: {biome_label} levels {missing} not yet landed')


def t10_grass_levels_idle_stability(sess: QASession) -> None:
  _check_biome_levels_idle_stable(sess, ['1-1', '1-2', '1-3', '1-4'], 'grass')


def t11_desert_levels_idle_stability(sess: QASession) -> None:
  _check_biome_levels_idle_stable(sess, ['2-1', '2-2', '2-3', '2-4'], 'desert')


def t12_city_levels_idle_stability(sess: QASession) -> None:
  _check_biome_levels_idle_stable(sess, ['3-1', '3-2', '3-3', '3-4', '3-5'], 'city')


# ---------------------------------------------------------------------------
# Group C: Real Slingshot Mouse Drag, Ability Tap & Keyboard Input (T13 - T18)
# ---------------------------------------------------------------------------

def _prepare_aim_and_get_pouch_px(sess: QASession, level_id: str = '1-1', birds: list[str] | None = None) -> dict[str, float]:
  sess.set_viewport(1280, 800, mobile=False)
  return sess.eval_json(
      f"""(async () => {{
        const M = window.__MUSOU__;
        const app = window.__APP__;
        M.setPaused(false);
        M.startLevel({json.dumps(level_id)}, {{ seed: 1, birds: {json.dumps(birds)} }});
        if (app.cam && app.cam.skipIntro) app.cam.skipIntro();
        let guard = 0;
        while (M.getState().state === 'intro' && guard < 180) {{
          M.stepFrames(6);
          guard += 6;
        }}
        app.cam.update(0.5, app.game);
        if (app.cam.skipIntro) app.cam.skipIntro();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const pouch = app.game.pouch();
        const rect = document.getElementById('game').getBoundingClientRect();
        return {{
          px: rect.left + app.cam.sx(pouch.x),
          py: rect.top + app.cam.sy(pouch.y),
          scale: app.cam.s,
          state: M.getState().state,
        }};
      }})()"""
  )


def t13_slingshot_weak_pull_cancels_shot(sess: QASession) -> None:
  info = _prepare_aim_and_get_pouch_px(sess, '1-1')
  assert info['state'] == 'aim', info
  # Drag only 2 px (< MIN_POWER = 0.15 * 2.4m) -> must cancel without launching.
  sess.pointer_drag(info['px'], info['py'], info['px'] - 2.0, info['py'] + 1.0, steps=4)
  st = sess.eval_json('window.__MUSOU__.getState()')
  assert st['state'] == 'aim' and st['birdsUsed'] == 0, f'Weak pull should cancel shot: {st}'


def t14_real_mouse_drag_on_pouch_launches_bird(sess: QASession) -> None:
  info = _prepare_aim_and_get_pouch_px(sess, '1-1')
  px, py, sc = info['px'], info['py'], max(15.0, info['scale'])
  dx = -2.0 * sc
  dy = 1.25 * sc

  assert sess.b is not None
  sess.b.cmd('Input.dispatchMouseEvent', type='mouseMoved', x=px, y=py, button='none', buttons=0)
  sess.b.cmd('Input.dispatchMouseEvent', type='mousePressed', x=px, y=py, button='left', buttons=1, clickCount=1)
  for i in range(1, 11):
    sess.b.cmd(
        'Input.dispatchMouseEvent',
        type='mouseMoved',
        x=px + dx * i / 10.0,
        y=py + dy * i / 10.0,
        button='left',
        buttons=1,
    )
  mid = sess.eval_json('({ previewLen: (window.__APP__.input.preview || []).length, dragging: Boolean(window.__APP__.input.dragging) })')
  sess.b.cmd('Input.dispatchMouseEvent', type='mouseReleased', x=px + dx, y=py + dy, button='left', buttons=0, clickCount=1)

  st = sess.eval_json('window.__MUSOU__.getState()')
  assert mid['previewLen'] > 0, f'Expected trajectory preview dots during pouch drag: {mid}'
  assert st['state'] == 'flight' and st['birdsUsed'] == 1, f'Real mouse drag did not launch bird: {st}'
  assert st['bird'] and st['bird']['vx'] > 8.0 and st['bird']['vy'] > 4.0, st
  sess.assert_clean('T14')


def t15_left_35pct_relative_drag_aiming(sess: QASession) -> None:
  info = _prepare_aim_and_get_pouch_px(sess, '1-1')
  sc = max(15.0, info['scale'])
  # Start in left 35% (x=180 < 0.35*1280=448), well above pouch y so we test relative left-35% drag (§6).
  start_x = 180.0
  start_y = max(140.0, min(260.0, info['py'] - 220.0))
  sess.pointer_drag(start_x, start_y, start_x - 2.0 * sc, start_y + 1.2 * sc, steps=10)
  st = sess.eval_json('window.__MUSOU__.getState()')
  if st['birdsUsed'] == 0:
    with open(os.path.join(REPO_ROOT, 'src', 'ui', 'input.js'), 'r', encoding='utf-8') as f:
      inp_src = f.read()
    if '0.35' not in inp_src:
      raise XFail('waiting on @levels-hud: §6 left-35% relative drag aiming in src/ui/input.js')
    raise AssertionError(f'Left-35% relative drag failed to launch: {st}')
  assert st['state'] == 'flight' and st['birdsUsed'] == 1, st


def t16_canvas_tap_triggers_ability_once(sess: QASession) -> None:
  _prepare_aim_and_get_pouch_px(sess, '1-1')
  # Keep game unpaused so hud.isPlayInteractive() accepts real canvas pointer gestures.
  sess.eval('window.__MUSOU__.setPaused(false); window.__MUSOU__.launch(40, 0.9); window.__MUSOU__.stepFrames(10);')
  sess.pointer_tap(640, 360)
  st1 = sess.eval_json('window.__MUSOU__.getState()')
  ab_events_1 = [e for e in st1['events'] if e.get('type') == 'ability']
  assert st1['abilityUsed'] is True and len(ab_events_1) == 1, st1

  # Second tap in same flight must NOT fire ability again.
  sess.pointer_tap(660, 350)
  st2 = sess.eval_json('window.__MUSOU__.getState()')
  ab_events_2 = [e for e in st2['events'] if e.get('type') == 'ability']
  assert len(ab_events_2) == 1, f'Ability fired more than once in single flight: {ab_events_2}'


def t17_flight_pointer_hold_tracks_world_coords(sess: QASession) -> None:
  _prepare_aim_and_get_pouch_px(sess, '1-1', birds=['matilda'])
  # Launch Matilda, trigger her 4s hover/shooting window, and settle camera/shake so pointer->world is stable.
  sess.eval(
      """(() => {
        const M = window.__MUSOU__;
        const app = window.__APP__;
        M.setPaused(false);
        M.launch(45, 0.85);
        M.stepFrames(14);
        M.useAbility();
        if (app.juice && app.juice.init) app.juice.init();
        for (let i = 0; i < 20; i++) app.cam.update(0.05, app.game);
        return true;
      })()"""
  )
  assert sess.b is not None
  sess.b.cmd('Input.dispatchMouseEvent', type='mousePressed', x=700, y=320, button='left', buttons=1, clickCount=1)
  sess.b.cmd('Input.dispatchMouseEvent', type='mouseMoved', x=780, y=280, button='left', buttons=1)
  held = sess.eval_json(
      """(() => {
        const g = window.__APP__.game;
        const c = document.getElementById('game').getBoundingClientRect();
        const exp = window.__APP__.cam.toWorld(780 - c.left, 280 - c.top);
        return { ptr: { ...g.pointer }, exp };
      })()"""
  )
  sess.b.cmd('Input.dispatchMouseEvent', type='mouseReleased', x=780, y=280, button='left', buttons=0, clickCount=1)
  up_down = sess.eval_json('window.__APP__.game.pointer.down')

  assert held['ptr']['down'] is True, held
  assert abs(held['ptr']['x'] - held['exp']['x']) < 1.2, held
  assert abs(held['ptr']['y'] - held['exp']['y']) < 1.2, held
  assert up_down is False, up_down


def t18_keyboard_shortcuts_space_n_r_esc(sess: QASession) -> None:
  if is_hud_skeleton():
    raise XFail('waiting on @levels-hud: keyboard shortcuts wired via uiBridge.hud in src/ui/hud.js')
  _prepare_aim_and_get_pouch_px(sess, '1-1', birds=['red', 'chuck'])
  sess.eval('window.__MUSOU__.setPaused(false); window.__MUSOU__.launch(40, 0.9); window.__MUSOU__.stepFrames(10);')
  sess.key_tap(' ', 'Space', 32)
  after_space = sess.eval_json('window.__MUSOU__.getState()')
  assert after_space['abilityUsed'] is True, f'Space key did not trigger ability in FLIGHT: {after_space}'

  # N -> next bird (skipTurn)
  sess.key_tap('n', 'KeyN', 78)
  after_n = sess.eval_json('window.__MUSOU__.getState()')
  assert after_n['birdIndex'] >= 1, f'KeyN did not skip turn to next bird: {after_n}'

  # R -> restart level
  sess.key_tap('r', 'KeyR', 82)
  after_r = sess.eval_json('window.__MUSOU__.getState()')
  assert after_r['birdsUsed'] == 0 and after_r['birdIndex'] == 0, f'KeyR did not restart level: {after_r}'

  # Esc -> pause toggle
  sess.key_tap('Escape', 'Escape', 27)
  paused_state = sess.eval_json('({ appPaused: Boolean(window.__APP__.paused), gameState: window.__MUSOU__.getState().state })')
  assert paused_state['appPaused'] is True or paused_state['gameState'] == 'paused', f'Esc did not pause: {paused_state}'
  sess.key_tap('Escape', 'Escape', 27)
  sess.eval('window.__MUSOU__.setPaused(false)')


# ---------------------------------------------------------------------------
# Group D: All 12 Bird 10x Abilities — Zero Exceptions & Spectacle (T19 - T30)
# ---------------------------------------------------------------------------

def _verify_single_bird_ability(sess: QASession, bird_spec: dict[str, Any]) -> None:
  bid = bird_spec['id']
  intro = bird_spec['intro']
  owner = bird_spec['owner']
  sess.clear_diagnostics()

  res = sess.eval_json(
      f"""(() => {{
        const M = window.__MUSOU__;
        const app = window.__APP__;
        const liveIds = M.listLevels().map((l) => l.id);
        const lvId = liveIds.includes({json.dumps(intro)}) ? {json.dumps(intro)} : liveIds[0];
        M.startLevel(lvId, {{ seed: 7, birds: [{json.dumps(bid)}, {json.dumps(bid)}] }});
        M.setPaused(true);
        if (app.cam && app.cam.skipIntro) app.cam.skipIntro();
        while (M.getState().state === 'intro') M.stepFrames(6);

        // Draw AIM frame (tests drawBird on sling + queue).
        app.cam.update(0.016, app.game);
        app.renderer.draw(app.game, app.cam, app.input);

        M.launch(36, 0.92);
        let peakProj = 0;
        let peakEff = 0;
        for (let i = 0; i < 30; i++) {{
          M.stepFrames(1);
          const st = M.getState();
          peakProj = Math.max(peakProj, st.projectiles || 0);
          peakEff = Math.max(peakEff, st.effects || 0);
        }}
        // Draw in-flight pre-tap (tests passive orbiters / drawBird in flight).
        app.cam.update(0.016, app.game);
        app.renderer.draw(app.game, app.cam, app.input);

        const preTap = M.getState();
        const tapped = M.useAbility();
        const post0 = M.getState();
        peakProj = Math.max(peakProj, post0.projectiles || 0);
        peakEff = Math.max(peakEff, post0.effects || 0);

        for (let f = 0; f < 150; f++) {{
          M.stepFrames(1);
          app.juice && app.juice.update && app.juice.update(1 / 60);
          app.particles && app.particles.update && app.particles.update(1 / 60);
          app.popups && app.popups.update && app.popups.update(1 / 60);
          if (f % 10 === 0) {{
            app.cam.update(0.16, app.game);
            app.renderer.draw(app.game, app.cam, app.input);
          }}
          const st = M.getState();
          peakProj = Math.max(peakProj, st.projectiles || 0);
          peakEff = Math.max(peakEff, st.effects || 0);
        }}
        const post = M.getState();
        M.setPaused(false);
        return {{
          levelId: lvId,
          tapped,
          abilityUsed: post.abilityUsed,
          peakProj,
          peakEff,
          dmg: (post.stats && post.stats.damageDealt) || 0,
          displaced: post.displaced,
          pigsKilled: post.pigsAtStart - post.pigsLeft,
          preVx: preTap.bird ? preTap.bird.vx : 0,
        }};
      }})()"""
  )
  # Zero exceptions / console.errors is ALWAYS strictly enforced even on stubs!
  sess.assert_clean(f'bird_{bid}')
  assert res['tapped'] is True and res['abilityUsed'] is True, res

  if is_bird_stubbed(bid):
    raise XFail(f'waiting on @{owner}: src/birds/{bid}.js still stubbed')

  assert (res['peakProj'] + res['peakEff']) >= 1, f'{bid} spawned 0 projectiles/effects: {res}'
  assert res['dmg'] >= 200 or res['displaced'] >= 5, f'{bid} 10x ability dealt minimal impact: {res}'


def _make_bird_test(idx: int) -> Callable[[QASession], None]:
  spec = DESIGN_BIRDS[idx]
  def _fn(sess: QASession) -> None:
    _verify_single_bird_ability(sess, spec)
  return _fn


t19_bird_01_red = _make_bird_test(0)
t20_bird_02_blues = _make_bird_test(1)
t21_bird_03_chuck = _make_bird_test(2)
t22_bird_04_bomb = _make_bird_test(3)
t23_bird_05_matilda = _make_bird_test(4)
t24_bird_06_hal = _make_bird_test(5)
t25_bird_07_terence = _make_bird_test(6)
t26_bird_08_bubbles = _make_bird_test(7)
t27_bird_09_silver = _make_bird_test(8)
t28_bird_10_poppy = _make_bird_test(9)
t29_bird_11_stella = _make_bird_test(10)
t30_bird_12_gale = _make_bird_test(11)


# ---------------------------------------------------------------------------
# Group E: Game Flow, Scoring, Progress, HUD, Menus & Caps (T31 - T42)
# ---------------------------------------------------------------------------

def t31_birds_override_and_skip_turn(sess: QASession) -> None:
  res = sess.eval_json(
      """(() => {
        const M = window.__MUSOU__;
        M.setPaused(true);
        const s0 = M.startLevel('1-1', { seed: 5, birds: ['chuck', 'bomb'] });
        M.launch(40, 0.85);
        M.stepFrames(10);
        const skipped = M.skipTurn();
        const s1 = M.getState();
        M.setPaused(false);
        return {
          queue0: s0.birdQueue,
          cur0: s0.currentBird,
          skipped,
          cur1: s1.currentBird,
          birdIndex1: s1.birdIndex,
          state1: s1.state,
        };
      })()"""
  )
  assert res['queue0'] == ['chuck', 'bomb'] and res['cur0'] == 'chuck', res
  assert res['skipped'] is True and res['cur1'] == 'bomb' and res['birdIndex1'] == 1, res


def t32_bomb_untapped_impact_auto_mega_blast(sess: QASession) -> None:
  res = sess.eval_json(
      """(() => {
        const M = window.__MUSOU__;
        M.setPaused(true);
        M.startLevel('1-1', { seed: 2, birds: ['bomb', 'red'] });
        while (M.getState().state === 'intro') M.stepFrames(6);
        M.launch(28, 0.92);
        // Do NOT call useAbility(); step 240 frames (4.0s) past impact + 1.5s fuse.
        let peakEff = 0;
        for (let i = 0; i < 40; i++) {
          M.stepFrames(6);
          peakEff = Math.max(peakEff, M.getState().effects || 0);
        }
        const s = M.getState();
        M.setPaused(false);
        return { dmg: (s.stats && s.stats.damageDealt) || 0, displaced: s.displaced, peakEff };
      })()"""
  )
  sess.assert_clean('T32')
  if is_bird_stubbed('bomb'):
    raise XFail('waiting on @birds-a: bomb.js passive 1.5s impact mega-blast still stubbed')
  assert res['dmg'] >= 250 and res['displaced'] >= 5, f'Untapped bomb did not auto-blast after impact: {res}'


def t33_physics_balloon_pig_and_tnt_chain(sess: QASession) -> None:
  res = sess.eval_json(
      """(() => {
        const M = window.__MUSOU__;
        const liveIds = M.listLevels().map((l) => l.id);
        M.setPaused(true);
        // Test balloon pig on 1-2 if present, else spawn via world on 1-1 for non-destructive read check.
        let balloonCheck = null;
        if (liveIds.includes('1-2')) {
          M.startLevel('1-2', { seed: 1 });
          while (M.getState().state === 'intro') M.stepFrames(6);
          const w = window.__APP__.game.world;
          const bp = w.ents.find((e) => e.kind === 'pig' && e.status && e.status.balloon);
          if (bp) {
            const g0 = bp.body.getGravityScale();
            const y0 = bp.body.getPosition().y;
            M.stepFrames(60);
            const yIdle = bp.body.getPosition().y;
            w.damage(bp, 10, { raw: true, cause: 'test' });
            const gAfter = bp.body.getGravityScale();
            M.stepFrames(30);
            const yAfter = bp.alive ? bp.body.getPosition().y : -99;
            balloonCheck = { found: true, g0, idleDrift: Math.abs(yIdle - y0), gAfter, dropped: yAfter < yIdle - 0.3 };
          } else {
            balloonCheck = { found: false };
          }
        }
        // Test TNT chain on 1-4 if present.
        let tntCheck = null;
        if (liveIds.includes('1-4')) {
          M.startLevel('1-4', { seed: 1 });
          while (M.getState().state === 'intro') M.stepFrames(6);
          const w = window.__APP__.game.world;
          const tnt = w.ents.find((e) => e.kind === 'block' && e.mat === 'tnt');
          if (tnt) {
            w.kill(tnt, 'test');
            M.stepFrames(10);
            const st = M.getState();
            tntCheck = { found: true, dmg: st.stats.damageDealt, displaced: st.displaced };
          } else {
            tntCheck = { found: false };
          }
        }
        M.setPaused(false);
        return { balloonCheck, tntCheck };
      })()"""
  )
  if res['balloonCheck'] is None or res['tntCheck'] is None:
    raise XFail('waiting on @levels-hud: 1-2 (balloon pigs) and/or 1-4 (TNT) not yet landed')
  assert res['balloonCheck']['found'] is True, f'1-2 missing balloon pigs (§4): {res}'
  assert res['balloonCheck']['g0'] == 0 and res['balloonCheck']['idleDrift'] < 0.25, res
  assert res['balloonCheck']['gAfter'] == 1 and res['balloonCheck']['dropped'] is True, res
  assert res['tntCheck']['found'] is True and res['tntCheck']['dmg'] > 0, f'1-4 TNT chain check failed: {res}'


def t34_physics_kill_y_out_of_bounds_culling(sess: QASession) -> None:
  res = sess.eval_json(
      """(async () => {
        const C = await import('./src/contracts.js');
        const M = window.__MUSOU__;
        M.setPaused(true);
        M.startLevel('1-1', { seed: 1 });
        while (M.getState().state === 'intro') M.stepFrames(6);
        const w = window.__APP__.game.world;
        const pigs0 = M.getState().pigsLeft;
        const pig = w.pigs()[0];
        pig.body.setPosition({ x: 20, y: C.PHYS.KILL_Y - 2 });
        M.stepFrames(3);
        const pigs1 = M.getState().pigsLeft;
        M.setPaused(false);
        return { killY: C.PHYS.KILL_Y, pigs0, pigs1 };
      })()"""
  )
  assert res['killY'] == -15, res
  assert res['pigs1'] == res['pigs0'] - 1, f'Pig below KILL_Y was not culled/killed: {res}'


def _clear_level_1_1_deterministically(sess: QASession) -> dict[str, Any]:
  return sess.eval_json(
      """(() => {
        const M = window.__MUSOU__;
        M.startLevel('1-1', { seed: 1 });
        M.setPaused(true);
        while (M.getState().state === 'intro') M.stepFrames(6);
        M.launch(35, 0.90);
        M.stepFrames(32);
        M.useAbility();
        for (let i = 0; i < 40 && M.getState().pigsLeft > 0; i++) {
          M.stepFrames(6);
        }
        if (M.getState().pigsLeft > 0) {
          const w = window.__APP__.game.world;
          for (const p of w.pigs().slice()) {
            const pos = p.body.getPosition();
            w.explode(pos.x, pos.y, { r: 3, dmg: 9999, impulse: 20 });
          }
        }
        let guard = 0;
        while (M.getState().state !== 'clear' && guard < 240) {
          M.stepFrames(6);
          guard += 6;
        }
        const st = M.getState();
        M.setPaused(false);
        return st;
      })()"""
  )


def t35_clear_flow_stars_and_unused_bird_bonus(sess: QASession) -> None:
  st = _clear_level_1_1_deterministically(sess)
  assert st['state'] == 'clear', f'Expected CLEAR state after all pigs popped: {st}'
  assert st['pigsLeft'] == 0, st
  assert st['birdsUsed'] == 1, st
  assert st['stars'] >= 2, f'Clearing 1-1 with 1 bird (<= par=1) must award >= 2 stars: {st}'
  assert st['score'] >= 25000, f'Expected pig kill + 10000 unused-bird bonus in score: {st}'
  # If full HUD Clear modal is present, also verify "下一关" advances 1-1 -> 1-2.
  next_lv = sess.eval_json(
      """(() => {
        const btn = document.getElementById('btn-clear-next');
        if (!btn) return null;
        btn.click();
        return window.__MUSOU__.getState().levelId;
      })()"""
  )
  if next_lv is not None:
    assert next_lv == '1-2', f'Expected #btn-clear-next to advance 1-1 -> 1-2, got {next_lv}'


def t36_localstorage_musou_and_qq_hall_progress(sess: QASession) -> None:
  sess.eval(
      """(() => {
        localStorage.removeItem('musou_progress');
        localStorage.setItem('qq_hall_progress', JSON.stringify({ watermelon: { stars: 3 } }));
      })()"""
  )
  assert sess.goto('index.html?level=1-1'), 'Reload for clean localStorage check failed'
  st = _clear_level_1_1_deterministically(sess)
  sess.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  saved = sess.eval_json(
      """(() => {
        const rawM = localStorage.getItem('musou_progress');
        const rawH = localStorage.getItem('qq_hall_progress');
        return {
          musou: rawM ? JSON.parse(rawM) : null,
          hall: rawH ? JSON.parse(rawH) : null,
        };
      })()"""
  )
  if saved['musou'] is None:
    raise XFail("waiting on @levels-hud: localStorage['musou_progress'] persistence (§7)")
  mp = saved['musou']
  assert mp.get('v') == 1 and isinstance(mp.get('levels'), dict), saved
  lv11 = mp['levels'].get('1-1')
  assert lv11 and lv11.get('stars', 0) >= st['stars'] and lv11.get('best', 0) >= st['score'], saved

  hall = saved['hall'] or {}
  assert hall.get('watermelon', {}).get('stars') == 3, f'qq_hall_progress clobbered sibling key: {hall}'
  assert isinstance(hall.get('musou'), dict) and hall['musou'].get('cleared', 0) >= 1, (
      f"qq_hall_progress missing merged musou summary (§7): {hall}"
  )


def t37_fail_flow_when_out_of_birds(sess: QASession) -> None:
  res = sess.eval_json(
      """(async () => {
        const M = window.__MUSOU__;
        M.setPaused(true);
        const s0 = M.startLevel('1-1', { seed: 4 });
        for (let i = 0; i < s0.birdQueue.length; i++) {
          while (M.getState().state === 'intro') M.stepFrames(6);
          if (M.getState().state !== 'aim') break;
          // Shoot backwards away from structure so 0 pigs die.
          M.launch(165, 0.35);
          M.stepFrames(12);
          M.skipTurn();
        }
        let guard = 0;
        while (M.getState().state !== 'fail' && guard < 300) {
          M.stepFrames(6);
          guard += 6;
        }
        const sf = M.getState();
        M.setPaused(false);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const hudTxt = (document.getElementById('hud')?.textContent || '').trim();
        return { state: sf.state, stars: sf.stars, pigsLeft: sf.pigsLeft, hudTxt };
      })()"""
  )
  assert res['state'] == 'fail' and res['stars'] == 0 and res['pigsLeft'] > 0, res
  assert ('猪' in res['hudTxt']) or ('重试' in res['hudTxt']) or ('失败' in res['hudTxt']), (
      f'HUD did not display fail prompt: {res}'
  )


def t38_hud_ability_next_and_restart_buttons(sess: QASession) -> None:
  _prepare_aim_and_get_pouch_px(sess, '1-1', birds=['red', 'chuck'])
  sess.eval('window.__MUSOU__.launch(42, 0.88); window.__MUSOU__.stepFrames(15);')
  sess.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')

  clicked_ab = sess.eval_json(
      """(() => {
        const hud = document.getElementById('hud');
        const btn = hud.querySelector('#btn-ability, [data-action="ability"], button.ability')
          || Array.from(hud.querySelectorAll('button')).find((b) => /风火轮|技能/.test(b.textContent || ''));
        if (!btn) return { found: false };
        btn.click();
        return { found: true, abilityUsed: window.__MUSOU__.getState().abilityUsed };
      })()"""
  )
  assert clicked_ab['found'] and clicked_ab['abilityUsed'] is True, f'HUD ability button failed: {clicked_ab}'

  clicked_restart = sess.eval_json(
      """(() => {
        const hud = document.getElementById('hud');
        const btn = hud.querySelector('#btn-restart, [data-action="restart"]')
          || Array.from(hud.querySelectorAll('button')).find((b) => /↻|重开|重新/.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
        if (!btn) return { found: false };
        btn.click();
        const st = window.__MUSOU__.getState();
        return { found: true, birdsUsed: st.birdsUsed, state: st.state };
      })()"""
  )
  assert clicked_restart['found'] and clicked_restart['birdsUsed'] == 0, f'HUD restart button failed: {clicked_restart}'


def t39_pause_menu_and_resume_flow(sess: QASession) -> None:
  _prepare_aim_and_get_pouch_px(sess, '1-1')
  # First verify programmatic seam pause stops RAF stepping.
  seam_pause = sess.eval_json(
      """(async () => {
        const M = window.__MUSOU__;
        M.setPaused(true);
        const f0 = M.getState().frame;
        await new Promise(r => setTimeout(r, 80));
        const f1 = M.getState().frame;
        M.setPaused(false);
        return { pausedHeldFrame: f0 === f1, retTrue: M.setPaused(true), retFalse: M.setPaused(false) };
      })()"""
  )
  assert seam_pause['pausedHeldFrame'] is True, seam_pause
  assert seam_pause['retTrue'] is True and seam_pause['retFalse'] is False, seam_pause

  # Now check DOM pause button & menu (§7: ⏸ -> 继续 / 重新开始 / 选关 / 音效).
  dom_pause = sess.eval_json(
      """(() => {
        const hud = document.getElementById('hud');
        const btn = hud.querySelector('#btn-pause, [data-action="pause"]')
          || Array.from(hud.querySelectorAll('button')).find((b) => /⏸|暂停/.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
        if (!btn) return { found: false };
        btn.click();
        const txt = hud.textContent || '';
        const resumeBtn = Array.from(hud.querySelectorAll('button')).find((b) => /继续/.test(b.textContent || ''));
        const hasResume = Boolean(resumeBtn);
        if (resumeBtn) resumeBtn.click();
        return { found: true, txt, hasResume };
      })()"""
  )
  if not dom_pause['found']:
    raise XFail('waiting on @levels-hud: HUD ⏸ pause button & overlay (§7)')
  assert dom_pause['hasResume'] is True, f'Pause overlay missing 继续 button: {dom_pause}'


def t40_title_screen_and_bird_codex(sess: QASession) -> None:
  assert sess.goto('index.html'), 'Failed to load index.html (root title view)'
  res = sess.eval_json(
      """(() => {
        const hud = document.getElementById('hud');
        const txt = hud ? (hud.textContent || '') : '';
        const hasTitle = txt.includes('无双') && (txt.includes('开始') || txt.includes('选关'));
        if (!hasTitle) return { hasTitle: false, txt: txt.slice(0, 120) };
        const codexBtn = Array.from(hud.querySelectorAll('button')).find((b) => /图鉴/.test(b.textContent || ''));
        if (!codexBtn) return { hasTitle: true, hasCodexBtn: false };
        codexBtn.click();
        const codexTxt = hud.textContent || '';
        return {
          hasTitle: true,
          hasCodexBtn: true,
          hasRed: codexTxt.includes('胖红'),
          hasGale: codexTxt.includes('盖雅'),
        };
      })()"""
  )
  # Restore level 1-1 for subsequent gameplay tests.
  sess.goto('index.html?level=1-1')
  if not res['hasTitle']:
    raise XFail('waiting on @levels-hud: Title screen & 鸟类图鉴 on bare index.html (§7)')
  assert res.get('hasCodexBtn') and res.get('hasRed') and res.get('hasGale'), (
      f'Codex missing expected 12 bird entries: {res}'
  )


def t41_level_select_biomes_and_3_5_unlock_gate(sess: QASession) -> None:
  # 1. Fresh progress (only 1-1 unlocked) -> 1-2 and 3-5 must be locked.
  sess.eval(
      """(() => {
        localStorage.setItem('musou_progress', JSON.stringify({
          v: 1, levels: {}, unlocked: ['1-1'], muted: false
        }));
      })()"""
  )
  assert sess.goto('index.html'), 'Failed to load index.html for level-select lock test'
  locked_check = sess.eval_json(
      """(() => {
        const hud = document.getElementById('hud');
        const selBtn = Array.from(hud.querySelectorAll('button')).find((b) => /选关/.test(b.textContent || ''));
        if (!selBtn) return { hasSelect: false };
        selBtn.click();
        const txt = hud.textContent || '';
        const findTile = (id) => hud.querySelector(`[data-level-id="${id}"], [data-level="${id}"]`)
          || Array.from(hud.querySelectorAll('button, .level-tile')).find((el) => (el.textContent || '').includes(id));
        const tile11 = findTile('1-1');
        const tile12 = findTile('1-2');
        const tile35 = findTile('3-5');
        if (!tile35) return { hasSelect: true, has35: false, txt: txt.slice(0, 160) };
        const isLocked = (el) => Boolean(
          el && (
            el.disabled ||
            el.classList.contains('locked') ||
            el.getAttribute('aria-disabled') === 'true' ||
            /🔒/.test(el.textContent || '')
          )
        );
        return {
          hasSelect: true,
          has35: true,
          hasBiomes: txt.includes('草原') && txt.includes('沙漠') && txt.includes('都市'),
          unlocked11: Boolean(tile11 && !isLocked(tile11)),
          locked12: isLocked(tile12),
          lockedBefore34: isLocked(tile35),
        };
      })()"""
  )
  if not locked_check.get('hasSelect'):
    sess.goto('index.html?level=1-1')
    raise XFail('waiting on @levels-hud: 选关 level-select screen & 3-5 unlock gate (§7)')

  assert locked_check.get('hasBiomes') is True, f'Level select missing 草原/沙漠/都市 biomes: {locked_check}'
  assert locked_check.get('unlocked11') is True and locked_check.get('locked12') is True, locked_check
  assert locked_check.get('has35') is True and locked_check.get('lockedBefore34') is True, (
      f'Bonus level 3-5 should be locked before 3-4 is cleared: {locked_check}'
  )

  # 2. Mark 3-4 cleared -> 3-5 must unlock!
  sess.eval(
      """(() => {
        localStorage.setItem('musou_progress', JSON.stringify({
          v: 1,
          levels: { '1-1': { stars: 3, best: 50000 }, '3-4': { stars: 2, best: 350000 } },
          unlocked: ['1-1', '1-2', '3-5'],
          muted: false,
        }));
      })()"""
  )
  assert sess.goto('index.html'), 'Failed reload after 3-4 clear'
  unlocked_check = sess.eval_json(
      """(() => {
        const hud = document.getElementById('hud');
        const selBtn = Array.from(hud.querySelectorAll('button')).find((b) => /选关/.test(b.textContent || ''));
        if (selBtn) selBtn.click();
        const tile35 = hud.querySelector('[data-level-id="3-5"], [data-level="3-5"]')
          || Array.from(hud.querySelectorAll('button, .level-tile')).find(
            (el) => /3-5|无双乱斗/.test(el.textContent || '')
          );
        if (!tile35) return { found: false };
        const locked = Boolean(
          tile35.disabled ||
          tile35.classList.contains('locked') ||
          tile35.getAttribute('aria-disabled') === 'true'
        );
        return { found: true, locked };
      })()"""
  )
  sess.goto('index.html?level=1-1')
  assert unlocked_check.get('found') and unlocked_check.get('locked') is False, (
      f'3-5 remained locked after 3-4 cleared in musou_progress: {unlocked_check}'
  )


def t42_entity_projectile_and_fx_caps(sess: QASession) -> None:
  res = sess.eval_json(
      """(async () => {
        const C = await import('./src/contracts.js');
        const M = window.__MUSOU__;
        const app = window.__APP__;
        M.setPaused(true);
        M.startLevel('1-1', { seed: 11 });
        while (M.getState().state === 'intro') M.stepFrames(6);
        const ctx = app.game.ctx;
        for (let i = 0; i < 165; i++) {
          ctx.spawnProjectile({ x: 5 + (i % 15) * 0.5, y: 8 + Math.floor(i / 15) * 0.5, vx: 4, vy: 0, r: 0.18 });
        }
        M.stepFrames(2);
        const st = M.getState();
        const ps = app.perfStats();
        M.setPaused(false);
        return {
          maxProjContract: C.PHYS.MAX_PROJECTILES,
          maxBodiesContract: C.PHYS.MAX_BODIES,
          liveProj: st.projectiles,
          particles: ps.particles,
          popups: ps.popups,
        };
      })()"""
  )
  assert res['maxProjContract'] == 120 and res['maxBodiesContract'] == 420, res
  assert res['liveProj'] <= 120, f'Projectile cap 120 exceeded: {res}'
  assert res['particles'] <= 900 and res['popups'] <= 45, f'FX caps exceeded: {res}'


# ---------------------------------------------------------------------------
# Group F: G10 Multi-Viewport Layout Audit & §13 Quick Sim Gates (T43 - T48)
# ---------------------------------------------------------------------------

def t43_boss_hp_bar_visibility_on_boss_levels(sess: QASession) -> None:
  live_ids = set(sess.eval_json('window.__MUSOU__.listLevels().map(l => l.id)'))
  if '1-4' not in live_ids:
    raise XFail('waiting on @levels-hud: boss level 1-4 not yet landed')
  res = sess.eval_json(
      """(async () => {
        const M = window.__MUSOU__;
        M.setPaused(false);
        const st = M.startLevel('1-4', { seed: 1 });
        if (window.__APP__?.cam?.skipIntro) window.__APP__.cam.skipIntro();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const hudTxt = document.getElementById('hud')?.textContent || '';
        const bossPig = st.pigs.find((p) => p.variant && p.variant.startsWith('boss_'));
        return {
          bossPig,
          hasBossTextOrBar: /1900|将军|boss/i.test(hudTxt) || Boolean(document.querySelector('[class*="boss"], #boss-bar, #hud-boss')),
        };
      })()"""
  )
  assert res['bossPig'] is not None and res['bossPig']['maxHp'] == 1900, f'1-4 missing 1900 HP boss_helmet: {res}'
  if not res['hasBossTextOrBar']:
    raise XFail('waiting on @levels-hud: HUD boss HP bar display (§7)')


def t44_layout_audit_1280x800(sess: QASession) -> None:
  r = audit_viewport_on_session(sess, 1280, 800, mobile=False, save_shots=True)
  assert r['passed'], f'1280x800 layout issues: {r["issues"]}'


def t45_layout_audit_1024x768(sess: QASession) -> None:
  r = audit_viewport_on_session(sess, 1024, 768, mobile=True, save_shots=True)
  assert r['passed'], f'1024x768 layout issues: {r["issues"]}'


def t46_layout_audit_844x390(sess: QASession) -> None:
  r = audit_viewport_on_session(sess, 844, 390, mobile=True, save_shots=True)
  assert r['passed'], f'844x390 layout issues: {r["issues"]}'


def t47_layout_audit_390x844(sess: QASession) -> None:
  r = audit_viewport_on_session(sess, 390, 844, mobile=True, save_shots=True)
  sess.set_viewport(1280, 800, mobile=False)
  assert r['passed'], f'390x844 layout issues: {r["issues"]}'


def t48_sim_gates_quick_subset(sess: QASession) -> None:
  # Run --quick subset across representative grass/desert/city/boss levels for fast E2E turnaround.
  live_ids = sess.eval_json('window.__MUSOU__.listLevels().map(l => l.id)')
  subset = [lid for lid in ('1-1', '1-4', '2-2', '3-4') if lid in live_ids] or live_ids[:1]
  report = run_sim_gates_on_session(sess, level_filter=subset, quick=True)
  sess.assert_clean('T48_sim_gates_quick')

  failed_gates = [f"{g['id']}({g['measured']})" for g in report['gates'] if not g['passed']]
  if not failed_gates:
    return

  stubbed_birds = [b['id'] for b in DESIGN_BIRDS if is_bird_stubbed(b['id'])]
  if len(live_ids) < 13 or stubbed_birds or is_hud_skeleton():
    raise XFail(
        f'waiting on parallel builders (stubs={len(stubbed_birds)}/12, levels={len(live_ids)}/13): '
        f'pending gates {failed_gates}'
    )
  raise AssertionError(f'Quick sim_gates failed: {failed_gates}')


def t49_scripted_13_level_playthrough_hygiene(sess: QASession) -> None:
  sess.clear_diagnostics()
  res = sess.eval_json(
      """(() => {
        const M = window.__MUSOU__;
        const app = window.__APP__;
        const levels = M.listLevels();
        const played = [];
        for (const lv of levels) {
          M.startLevel(lv.id, { seed: 3 });
          M.setPaused(true);
          while (M.getState().state === 'intro') M.stepFrames(6);
          M.launch(38, 0.92);
          M.stepFrames(28);
          M.useAbility();
          for (let i = 0; i < 6; i++) {
            M.stepFrames(15);
            app.juice?.update?.(0.25);
            app.particles?.update?.(0.25);
            app.popups?.update?.(0.25);
            app.cam.update(0.25, app.game);
            app.renderer.draw(app.game, app.cam, app.input);
          }
          played.push(lv.id);
        }
        M.setPaused(false);
        return { count: played.length, played };
      })()"""
  )
  sess.assert_clean('T49_13_level_playthrough')
  if res['count'] < 13:
    raise XFail(f'waiting on @levels-hud: {res["count"]}/13 levels present')
  assert res['count'] == 13, res


def t50_amendment_a1_local_reach_and_cluster_spans(sess: QASession) -> None:
  res = sess.eval_json(
      """(() => {
        const M = window.__MUSOU__;
        const app = window.__APP__;
        const liveIds = M.listLevels().map((l) => l.id);
        const wideId = liveIds.includes('3-5') ? '3-5' : liveIds[liveIds.length - 1];
        M.startLevel(wideId, { seed: 1 });
        M.setPaused(true);
        while (M.getState().state === 'intro') M.stepFrames(6);
        M.launch(40, 0.9);
        M.stepFrames(6);
        const ctx = app.game.ctx;
        const ar = ctx.actionRect();
        const arWidth = ar.x1 - ar.x0;
        const nearTargets = ctx.findTargets({ x: 0, y: 2 }).length;
        const allTargets = ctx.findTargets({ x: 0, y: 2, maxDist: Infinity }).length;

        const spans = {};
        for (const id of liveIds) {
          M.startLevel(id, { seed: 1 });
          M.setPaused(true);
          const sb = app.game.structureBounds;
          spans[id] = +(sb.x1 - sb.x0).toFixed(2);
        }
        M.setPaused(false);
        return { wideId, arWidth: +arWidth.toFixed(2), nearTargets, allTargets, spans };
      })()"""
  )
  assert res['arWidth'] <= 28.05, f'ctx.actionRect() is not local (<=28m) per A1 (#88): {res}'
  assert res['nearTargets'] < res['allTargets'], f'ctx.findTargets default maxDist=20m did not filter distant targets: {res}'

  span_issues: list[str] = []
  for lid, span in res['spans'].items():
    if lid.startswith('1-') and span > 14.5:
      span_issues.append(f'{lid}:span={span}m (>14m)')
    elif lid.startswith('2-') and not (15.5 <= span <= 26.5):
      span_issues.append(f'{lid}:span={span}m (expected 16..26m)')
    elif lid.startswith('3-') and span < 25.5:
      span_issues.append(f'{lid}:span={span}m (<26m)')
  if span_issues:
    raise XFail(f'waiting on @levels-hud: Amendment A1 (#88) level structure spans pending: {span_issues}')


def t51_settle_drift_zero_all_13_levels(sess: QASession) -> None:
  res = sess.eval_json(
      """(() => {
        const M = window.__MUSOU__;
        const out = {};
        for (const lv of M.listLevels()) {
          const st = M.startLevel(lv.id, { seed: 1 });
          M.setPaused(true);
          out[lv.id] = st.settle || { moved: 0, maxDrift: 0 };
        }
        M.setPaused(false);
        return out;
      })()"""
  )
  offenders = {lid: v for lid, v in res.items() if v.get('moved', 0) > 0}
  assert not offenders, f'settle.moved > 0 on levels: {offenders}'
  assert len(res) == 13, res


def t52_first_time_coach_and_tutorial_persistence(sess: QASession) -> None:
  # Clear saved progress so profile is completely fresh, then reload 1-1.
  sess.eval_json("(() => { localStorage.removeItem('musou_progress'); return true; })()")
  assert sess.goto('index.html?level=1-1'), 'Failed reload of index.html?level=1-1 for T52'
  aim_check = sess.eval_json(
      """(async () => {
        const app = window.__APP__;
        if (app?.cam?.skipIntro) app.cam.skipIntro();
        window.__MUSOU__.setPaused(false);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const coach = document.getElementById('hud-coach');
        const pill = document.getElementById('hud-coach-pill');
        const raw = JSON.parse(localStorage.getItem('musou_progress') || '{}');
        return {
          state: window.__MUSOU__.getState().state,
          coachFound: Boolean(coach),
          coachHidden: coach ? coach.hidden : true,
          pointerEvents: coach ? window.getComputedStyle(coach).pointerEvents : '',
          pillText: pill ? (pill.textContent || '').trim() : '',
          tutorialDone: Boolean(raw.tutorialDone),
        };
      })()"""
  )
  assert aim_check['coachFound'] and aim_check['coachHidden'] is False, (
      f'Fresh profile did not show #hud-coach on 1-1 AIM: {aim_check}'
  )
  assert aim_check['pointerEvents'] == 'none', f'#hud-coach must have pointer-events:none: {aim_check}'
  assert '按住小鸟往后拉' in aim_check['pillText'], f'Unexpected AIM coach text: {aim_check}'
  assert aim_check['tutorialDone'] is False, f'Fresh profile had tutorialDone=true before play: {aim_check}'

  # Launch bird 1 -> AIM coach disappears (switches to FLIGHT ability coach) -> useAbility -> #hud-coach hidden + tutorialDone persisted.
  post_launch = sess.eval_json(
      """(async () => {
        const M = window.__MUSOU__;
        M.setPaused(false);
        M.launch(32, 0.90);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const coach = document.getElementById('hud-coach');
        const pill = document.getElementById('hud-coach-pill');
        const flightAimMode = pill ? pill.classList.contains('aim-mode') : false;
        const flightText = pill ? (pill.textContent || '').trim() : '';

        M.useAbility();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const raw = JSON.parse(localStorage.getItem('musou_progress') || '{}');
        return {
          flightAimMode,
          flightText,
          coachHiddenAfterAbility: coach ? coach.hidden : true,
          tutorialDonePersisted: Boolean(raw.tutorialDone),
        };
      })()"""
  )
  assert post_launch['flightAimMode'] is False and '按住小鸟往后拉' not in post_launch['flightText'], (
      f'AIM coach did not disappear after first launch: {post_launch}'
  )
  assert post_launch['coachHiddenAfterAbility'] is True, (
      f'#hud-coach remained visible after first launch + ability: {post_launch}'
  )
  assert post_launch['tutorialDonePersisted'] is True, (
      f'tutorialDone was not persisted in musou_progress: {post_launch}'
  )

  # Reload onto 1-2 and verify tutorialDone stays persisted and #hud-coach stays hidden.
  assert sess.goto('index.html?level=1-2'), 'Failed reload onto index.html?level=1-2 for T52'
  reload_check = sess.eval_json(
      """(async () => {
        const app = window.__APP__;
        if (app?.cam?.skipIntro) app.cam.skipIntro();
        window.__MUSOU__.setPaused(false);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const coach = document.getElementById('hud-coach');
        const raw = JSON.parse(localStorage.getItem('musou_progress') || '{}');
        return {
          coachHidden: coach ? coach.hidden : true,
          tutorialDone: Boolean(raw.tutorialDone),
        };
      })()"""
  )
  sess.goto('index.html?level=1-1')
  sess.assert_clean('T52')
  assert reload_check['tutorialDone'] is True and reload_check['coachHidden'] is True, (
      f'Coach reappeared or tutorialDone lost after reload on 1-2: {reload_check}'
  )


def t53_boss_gravitas_survives_bird_1_on_3_4(sess: QASession) -> None:
  res = sess.eval_json(
      """(() => {
        const M = window.__MUSOU__;
        let rng = 77;
        const rnd = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
        const checkLevel = (lid, seeds) => {
          const rows = [];
          let aliveCount = 0;
          for (const s of seeds) {
            const s0 = M.startLevel(lid, { seed: s });
            M.setPaused(true);
            const boss0 = s0.pigs.filter((p) => p.variant && p.variant.startsWith('boss_'));
            const ang = 20 + rnd() * 35;
            const pw = 0.70 + rnd() * 0.30;
            const ta = 0.35 + rnd() * 0.55;
            M.launch(ang, pw);
            let f = 0;
            let tapped = false;
            while (f < 60 * 10) {
              const step = M.stepFrames(6);
              f += 6;
              if (!tapped && f / 60 >= ta) {
                M.useAbility();
                tapped = true;
              }
              if (step.state !== 'flight') break;
            }
            const st = M.getState();
            const bossAfter = st.pigs.filter((p) => p.variant && p.variant.startsWith('boss_') && p.hp > 0);
            if (bossAfter.length > 0) aliveCount++;
            rows.push({
              seed: s,
              initialBosses: boss0.length,
              aliveAfterBird1: bossAfter.length,
              hp: bossAfter.map((b) => `${b.hp}/${b.maxHp}`),
            });
          }
          return { aliveCount, total: seeds.length, rows };
        };
        const out = {
          '1-4': checkLevel('1-4', [1, 2, 3]),
          '2-4': checkLevel('2-4', [1, 2, 3]),
          '3-4': checkLevel('3-4', [1, 2, 3]),
          '3-5': checkLevel('3-5', [1, 2, 3]),
        };
        M.setPaused(false);
        return out;
      })()"""
  )
  sess.assert_clean('T53')
  for lid in ('1-4', '2-4', '3-4', '3-5'):
    assert all(r['initialBosses'] >= 1 for r in res[lid]['rows']), f'Missing boss pig on {lid}: {res[lid]}'
  assert res['3-4']['aliveCount'] >= 1, f'Boss on 3-4 died on Bird 1 across all 3 seeds: {res["3-4"]}'


ALL_TESTS: list[tuple[str, Callable[[QASession], None]]] = [
    ('T01_page_load_zero_errors_zero_http_4xx', t01_page_load_zero_errors_zero_http_4xx),
    ('T02_repo_hygiene_no_speech_synthesis_no_cdn', t02_repo_hygiene_no_speech_synthesis_no_cdn),
    ('T03_seam_frozen_and_contract_surface', t03_seam_frozen_and_contract_surface),
    ('T04_getstate_deep_clone_immutability', t04_getstate_deep_clone_immutability),
    ('T05_contracts_and_12_bird_registry', t05_contracts_and_12_bird_registry),
    ('T06_audio_context_only_after_user_gesture', t06_audio_context_only_after_user_gesture),
    ('T07_canvas_procedural_rendering_non_blank', t07_canvas_procedural_rendering_non_blank),
    ('T08_determinism_900_frames_identical_json', t08_determinism_900_frames_identical_json),
    ('T09_level_roster_13_levels_3_biomes_schema', t09_level_roster_13_levels_3_biomes_schema),
    ('T10_grass_levels_idle_stability', t10_grass_levels_idle_stability),
    ('T11_desert_levels_idle_stability', t11_desert_levels_idle_stability),
    ('T12_city_levels_idle_stability', t12_city_levels_idle_stability),
    ('T13_slingshot_weak_pull_cancels_shot', t13_slingshot_weak_pull_cancels_shot),
    ('T14_real_mouse_drag_on_pouch_launches_bird', t14_real_mouse_drag_on_pouch_launches_bird),
    ('T15_left_35pct_relative_drag_aiming', t15_left_35pct_relative_drag_aiming),
    ('T16_canvas_tap_triggers_ability_once', t16_canvas_tap_triggers_ability_once),
    ('T17_flight_pointer_hold_tracks_world_coords', t17_flight_pointer_hold_tracks_world_coords),
    ('T18_keyboard_shortcuts_space_n_r_esc', t18_keyboard_shortcuts_space_n_r_esc),
    ('T19_bird_01_red_whirlwind', t19_bird_01_red),
    ('T20_bird_02_blues_meteor_split', t20_bird_02_blues),
    ('T21_bird_03_chuck_laser_dash', t21_bird_03_chuck),
    ('T22_bird_04_bomb_fullscreen_blast', t22_bird_04_bomb),
    ('T23_bird_05_matilda_egg_barrage', t23_bird_05_matilda),
    ('T24_bird_06_hal_eagle_boomerang', t24_bird_06_hal),
    ('T25_bird_07_terence_giant_growth', t25_bird_07_terence),
    ('T26_bird_08_bubbles_balloon_storm', t26_bird_08_bubbles),
    ('T27_bird_09_silver_air_force', t27_bird_09_silver),
    ('T28_bird_10_poppy_tornado_swarm', t28_bird_10_poppy),
    ('T29_bird_11_stella_gravity_reversal', t29_bird_11_stella),
    ('T30_bird_12_gale_poison_slash', t30_bird_12_gale),
    ('T31_birds_override_and_skip_turn', t31_birds_override_and_skip_turn),
    ('T32_bomb_untapped_impact_auto_mega_blast', t32_bomb_untapped_impact_auto_mega_blast),
    ('T33_physics_balloon_pig_and_tnt_chain', t33_physics_balloon_pig_and_tnt_chain),
    ('T34_physics_kill_y_out_of_bounds_culling', t34_physics_kill_y_out_of_bounds_culling),
    ('T35_clear_flow_stars_and_unused_bird_bonus', t35_clear_flow_stars_and_unused_bird_bonus),
    ('T36_localstorage_musou_and_qq_hall_progress', t36_localstorage_musou_and_qq_hall_progress),
    ('T37_fail_flow_when_out_of_birds', t37_fail_flow_when_out_of_birds),
    ('T38_hud_ability_next_and_restart_buttons', t38_hud_ability_next_and_restart_buttons),
    ('T39_pause_menu_and_resume_flow', t39_pause_menu_and_resume_flow),
    ('T40_title_screen_and_bird_codex', t40_title_screen_and_bird_codex),
    ('T41_level_select_biomes_and_3_5_unlock_gate', t41_level_select_biomes_and_3_5_unlock_gate),
    ('T42_entity_projectile_and_fx_caps', t42_entity_projectile_and_fx_caps),
    ('T43_boss_hp_bar_visibility_on_boss_levels', t43_boss_hp_bar_visibility_on_boss_levels),
    ('T44_layout_audit_1280x800', t44_layout_audit_1280x800),
    ('T45_layout_audit_1024x768', t45_layout_audit_1024x768),
    ('T46_layout_audit_844x390', t46_layout_audit_844x390),
    ('T47_layout_audit_390x844', t47_layout_audit_390x844),
    ('T48_sim_gates_quick_subset', t48_sim_gates_quick_subset),
    ('T49_scripted_13_level_playthrough_hygiene', t49_scripted_13_level_playthrough_hygiene),
    ('T50_amendment_a1_local_reach_and_cluster_spans', t50_amendment_a1_local_reach_and_cluster_spans),
    ('T51_settle_drift_zero_all_13_levels', t51_settle_drift_zero_all_13_levels),
    ('T52_first_time_coach_and_tutorial_persistence', t52_first_time_coach_and_tutorial_persistence),
    ('T53_boss_gravitas_survives_bird_1_on_3_4', t53_boss_gravitas_survives_bird_1_on_3_4),
]


def main() -> int:
  ap = argparse.ArgumentParser(description='Run 53-test E2E suite for Angry Birds Musou')
  ap.add_argument('--filter', type=str, default='', help='Substring filter on test names')
  ap.add_argument('--strict', action='store_true', help='Treat XFAIL as FAIL (use when all builders READY)')
  args = ap.parse_args()

  ensure_qa_dirs()
  passed = 0
  xfailed = 0
  failed = 0
  results: list[dict[str, Any]] = []

  t_suite = time.time()
  with QASession(width=1280, height=800, mobile=False) as sess:
    if not sess.goto('index.html?level=1-1'):
      print('FATAL: initial navigation to index.html?level=1-1 failed')
      return 1

    for name, fn in ALL_TESTS:
      if args.filter and args.filter not in name:
        continue
      t0 = time.time()
      try:
        fn(sess)
        ms = round((time.time() - t0) * 1000.0, 1)
        passed += 1
        results.append({'name': name, 'status': 'PASS', 'ms': ms})
        print(f'[PASS]  {name} ({ms:.1f} ms)')
      except XFail as xf:
        ms = round((time.time() - t0) * 1000.0, 1)
        if args.strict:
          failed += 1
          results.append({'name': name, 'status': 'FAIL', 'ms': ms, 'reason': f'strict xfail: {xf}'})
          print(f'[FAIL]  {name} ({ms:.1f} ms) [strict xfail]: {xf}')
        else:
          xfailed += 1
          results.append({'name': name, 'status': 'XFAIL', 'ms': ms, 'reason': str(xf)})
          print(f'[XFAIL] {name} ({ms:.1f} ms): {xf}')
      except Exception as exc:  # noqa: BLE001
        ms = round((time.time() - t0) * 1000.0, 1)
        failed += 1
        results.append({'name': name, 'status': 'FAIL', 'ms': ms, 'error': str(exc)})
        print(f'[FAIL]  {name} ({ms:.1f} ms): {exc}')

  summary = {
      'total': passed + xfailed + failed,
      'pass': passed,
      'xfail': xfailed,
      'fail': failed,
      'elapsed_s': round(time.time() - t_suite, 2),
      'results': results,
  }
  out_path = os.path.join(QA_TMP_DIR, 'e2e_summary.json')
  with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)

  print(f"E2E_SUMMARY: {json.dumps({k: summary[k] for k in ('total', 'pass', 'xfail', 'fail', 'elapsed_s')})}")
  return 0 if failed == 0 else 1


if __name__ == '__main__':
  sys.exit(main())
