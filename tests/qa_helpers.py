#!/usr/bin/env python3
"""Shared QA helper utilities for Angry Birds Musou (owner: qa-gates).

Wraps tests/cdp.py `Browser` without modifying cdp.py or game code.
All temporary artifacts and screenshots live strictly under /tmp/ab_musou/.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any

from cdp import Browser

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QA_TMP_DIR = '/tmp/ab_musou/qa'
QA_SHOTS_DIR = '/tmp/ab_musou/shots/qa'
GATES_JSON_PATH = '/tmp/ab_musou/gates.json'

# Canonical 12 bird IDs in codex order (docs/DESIGN.md §3, src/contracts.js).
DESIGN_BIRDS: list[dict[str, Any]] = [
    {'id': 'red', 'name': '胖红', 'ability': '风火轮', 'intro': '1-1', 'owner': 'birds-a'},
    {'id': 'blues', 'name': '蓝弟弟', 'ability': '流星分裂', 'intro': '1-2', 'owner': 'birds-a'},
    {'id': 'chuck', 'name': '飞镖黄', 'ability': '激光冲刺', 'intro': '1-3', 'owner': 'birds-a'},
    {'id': 'bomb', 'name': '炸弹黑', 'ability': '全屏爆破', 'intro': '1-4', 'owner': 'birds-a'},
    {'id': 'matilda', 'name': '白公主', 'ability': '投蛋射击', 'intro': '2-1', 'owner': 'birds-a'},
    {'id': 'hal', 'name': '长嘴绿', 'ability': '神鹰回旋', 'intro': '2-2', 'owner': 'birds-a'},
    {'id': 'terence', 'name': '大红', 'ability': '巨大化', 'intro': '2-3', 'owner': 'birds-b'},
    {'id': 'bubbles', 'name': '泡泡橙', 'ability': '气球风暴', 'intro': '2-4', 'owner': 'birds-b'},
    {'id': 'silver', 'name': '炫舞银', 'ability': '空军出击', 'intro': '3-1', 'owner': 'birds-b'},
    {'id': 'poppy', 'name': '波比', 'ability': '旋风来袭', 'intro': '3-2', 'owner': 'birds-b'},
    {'id': 'stella', 'name': '史黛拉', 'ability': '重力反转', 'intro': '3-3', 'owner': 'birds-b'},
    {'id': 'gale', 'name': '盖雅', 'ability': '剧毒斩', 'intro': '3-4', 'owner': 'birds-b'},
]

BIRD_BY_ID = {b['id']: b for b in DESIGN_BIRDS}

# Canonical 13 levels (docs/DESIGN.md §4).
DESIGN_LEVELS: list[dict[str, Any]] = [
    {'id': '1-1', 'name': '风火轮', 'biome': 'grass', 'birds': ['red', 'red'], 'par': 1, 'pigs': 3, 'min_blocks': 30, 'boss': None},
    {'id': '1-2', 'name': '流星分裂', 'biome': 'grass', 'birds': ['blues', 'red'], 'par': 1, 'pigs': 5, 'min_blocks': 40, 'boss': None},
    {'id': '1-3', 'name': '激光冲刺', 'biome': 'grass', 'birds': ['chuck', 'blues', 'red'], 'par': 1, 'pigs': 7, 'min_blocks': 50, 'boss': None},
    {'id': '1-4', 'name': '全屏爆破', 'biome': 'grass', 'birds': ['bomb', 'chuck', 'blues'], 'par': 1, 'pigs': 6, 'min_blocks': 70, 'boss': 'boss_helmet'},
    {'id': '2-1', 'name': '投蛋射击', 'biome': 'desert', 'birds': ['matilda', 'bomb', 'red'], 'par': 1, 'pigs': 6, 'min_blocks': 60, 'boss': None},
    {'id': '2-2', 'name': '神鹰回旋', 'biome': 'desert', 'birds': ['hal', 'matilda', 'chuck'], 'par': 1, 'pigs': 7, 'min_blocks': 70, 'boss': None},
    {'id': '2-3', 'name': '巨大化', 'biome': 'desert', 'birds': ['terence', 'hal', 'bomb'], 'par': 1, 'pigs': 8, 'min_blocks': 80, 'boss': None},
    {'id': '2-4', 'name': '气球风暴', 'biome': 'desert', 'birds': ['bubbles', 'terence', 'matilda', 'bomb'], 'par': 2, 'pigs': 9, 'min_blocks': 110, 'boss': 'boss_wizard'},
    {'id': '3-1', 'name': '空军出击', 'biome': 'city', 'birds': ['silver', 'bubbles', 'hal'], 'par': 1, 'pigs': 10, 'min_blocks': 110, 'boss': None},
    {'id': '3-2', 'name': '旋风来袭', 'biome': 'city', 'birds': ['poppy', 'silver', 'terence'], 'par': 1, 'pigs': 12, 'min_blocks': 130, 'boss': None},
    {'id': '3-3', 'name': '重力反转', 'biome': 'city', 'birds': ['stella', 'poppy', 'bomb'], 'par': 1, 'pigs': 10, 'min_blocks': 150, 'boss': None},
    {'id': '3-4', 'name': '猪王城堡', 'biome': 'city', 'birds': ['gale', 'stella', 'silver', 'bomb', 'bubbles'], 'par': 2, 'pigs': 13, 'min_blocks': 220, 'boss': 'boss_king'},
    {'id': '3-5', 'name': '无双乱斗', 'biome': 'city', 'birds': [b['id'] for b in DESIGN_BIRDS], 'par': 6, 'pigs': 20, 'min_blocks': 300, 'boss': None},
]

LEVEL_BY_ID = {lv['id']: lv for lv in DESIGN_LEVELS}

VIEWPORTS: list[tuple[int, int, bool]] = [
    (1280, 800, False),
    (1024, 768, True),
    (844, 390, True),
    (390, 844, True),
]


class XFail(Exception):
  """Raised when a test depends on an in-flight feature owned by another builder."""


def ensure_qa_dirs() -> None:
  os.makedirs(QA_TMP_DIR, exist_ok=True)
  os.makedirs(QA_SHOTS_DIR, exist_ok=True)


def is_bird_stubbed(bird_id: str) -> bool:
  path = os.path.join(REPO_ROOT, 'src', 'birds', f'{bird_id}.js')
  if not os.path.exists(path):
    return True
  with open(path, 'r', encoding='utf-8') as f:
    txt = f.read()
  return 'STUB by opus-director' in txt


class QASession:
  """Context-managed wrapper over tests/cdp.py Browser with input & error helpers."""

  def __init__(self, width: int = 1280, height: int = 800, mobile: bool = False):
    ensure_qa_dirs()
    self._browser = Browser(width=width, height=height, root=REPO_ROOT, mobile=mobile)
    self.b: Browser | None = None

  def __enter__(self) -> 'QASession':
    self.b = self._browser.__enter__()
    return self

  def __exit__(self, *exc: Any) -> None:
    self._browser.__exit__(*exc)

  def goto(self, path: str = 'index.html?level=1-1', wait_expr: str = 'window.__MUSOU__ !== undefined', timeout: float = 20.0) -> bool:
    assert self.b is not None
    ok = self.b.goto(path, wait_expr=wait_expr, timeout=timeout)
    return ok

  def eval_json(self, expr: str) -> Any:
    assert self.b is not None
    raw = self.b.eval(f'(async () => JSON.stringify(await (\n{expr}\n)))()', await_promise=True)
    return json.loads(raw) if raw is not None else None

  def eval(self, expr: str, await_promise: bool = True) -> Any:
    assert self.b is not None
    return self.b.eval(expr, await_promise=await_promise)

  def clear_diagnostics(self) -> None:
    assert self.b is not None
    self.b.console.clear()
    self.b.exceptions.clear()
    self.b.requests.clear()
    try:
      self.b.eval('if (window.__ERRORS__) window.__ERRORS__.length = 0; true')
    except Exception:
      pass

  def collect_diagnostics(self) -> dict[str, list[Any]]:
    assert self.b is not None
    win_errs: list[str] = []
    try:
      raw = self.b.eval('JSON.stringify(window.__ERRORS__ || [])')
      if raw:
        win_errs = json.loads(raw)
    except Exception as exc:
      win_errs = [f'eval_window_errors_failed: {exc}']
    console_errs = [msg for typ, msg in self.b.console if typ in ('error', 'assert')]
    http_errs = [
        f'{cmd} {path} -> {code}'
        for cmd, path, code in self.b.requests
        if str(code).startswith(('4', '5'))
    ]
    return {
        'window_errors': win_errs,
        'exceptions': [str(x) for x in self.b.exceptions],
        'console_errors': console_errs,
        'http_errors': http_errs,
    }

  def assert_clean(self, label: str = '') -> None:
    diag = self.collect_diagnostics()
    problems = (
        diag['window_errors']
        + diag['exceptions']
        + diag['console_errors']
        + diag['http_errors']
    )
    if problems:
      prefix = f'[{label}] ' if label else ''
      raise AssertionError(f'{prefix}unexpected runtime/HTTP errors: {json.dumps(diag, ensure_ascii=False)}')

  def set_viewport(self, width: int, height: int, mobile: bool = False) -> dict[str, int]:
    assert self.b is not None
    self.b.width = width
    self.b.height = height
    self.b.mobile = mobile
    self.b.cmd(
        'Emulation.setDeviceMetricsOverride',
        width=width,
        height=height,
        deviceScaleFactor=1,
        mobile=mobile,
    )
    self.b.cmd(
        'Emulation.setTouchEmulationEnabled',
        enabled=bool(mobile),
        maxTouchPoints=5 if mobile else 1,
    )
    return self.eval_json(
        """(async () => {
          window.dispatchEvent(new Event('resize'));
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { innerWidth: window.innerWidth, innerHeight: window.innerHeight };
        })()"""
    )

  def pointer_tap(self, x: float, y: float) -> None:
    assert self.b is not None
    xf, yf = float(x), float(y)
    self.b.cmd('Input.dispatchMouseEvent', type='mouseMoved', x=xf, y=yf, button='none', buttons=0)
    self.b.cmd('Input.dispatchMouseEvent', type='mousePressed', x=xf, y=yf, button='left', buttons=1, clickCount=1)
    self.b.cmd('Input.dispatchMouseEvent', type='mouseReleased', x=xf, y=yf, button='left', buttons=0, clickCount=1)

  def pointer_drag(self, x0: float, y0: float, x1: float, y1: float, steps: int = 14, hold_end_s: float = 0.0) -> None:
    assert self.b is not None
    self.b.cmd('Input.dispatchMouseEvent', type='mouseMoved', x=float(x0), y=float(y0), button='none', buttons=0)
    self.b.cmd('Input.dispatchMouseEvent', type='mousePressed', x=float(x0), y=float(y0), button='left', buttons=1, clickCount=1)
    for i in range(1, steps + 1):
      xi = x0 + (x1 - x0) * i / steps
      yi = y0 + (y1 - y0) * i / steps
      self.b.cmd('Input.dispatchMouseEvent', type='mouseMoved', x=float(xi), y=float(yi), button='left', buttons=1)
    if hold_end_s > 0:
      time.sleep(hold_end_s)
    self.b.cmd('Input.dispatchMouseEvent', type='mouseReleased', x=float(x1), y=float(y1), button='left', buttons=0, clickCount=1)

  def key_tap(self, key: str, code: str, vk: int = 0) -> None:
    assert self.b is not None
    self.b.cmd('Input.dispatchKeyEvent', type='keyDown', key=key, code=code, windowsVirtualKeyCode=vk, nativeVirtualKeyCode=vk)
    self.b.cmd('Input.dispatchKeyEvent', type='keyUp', key=key, code=code, windowsVirtualKeyCode=vk, nativeVirtualKeyCode=vk)

  def screenshot(self, filename: str) -> str:
    assert self.b is not None
    path = filename if os.path.isabs(filename) else os.path.join(QA_SHOTS_DIR, filename)
    return self.b.screenshot(path)
