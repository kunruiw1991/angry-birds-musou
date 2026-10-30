#!/usr/bin/env python3
"""Gate G10 multi-viewport layout & HUD audit for Angry Birds Musou (owner: qa-gates).

Audits 1280x800, 1024x768, 844x390, and 390x844 across gameplay HUD states:
- 0 horizontal or vertical scrollbars
- 0 overlapping interactive / HUD rects
- Every visible interactive control >= 68x68 CSS px
- <= 5 visible interactive controls in AIM and FLIGHT
- 0 clipped text elements (neither off-viewport nor overflow-clipped)
- Saves verification screenshots to /tmp/ab_musou/shots/qa/
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_helpers import QA_SHOTS_DIR, QA_TMP_DIR, QASession, VIEWPORTS, ensure_qa_dirs  # noqa: E402

AUDIT_DOM_JS = r"""
((phase) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const docEl = document.documentElement;
  const body = document.body;

  const isVisible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    let cur = el;
    while (cur && cur !== docEl) {
      const cs = window.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') <= 0.05) {
        return false;
      }
      cur = cur.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };

  const describeEl = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    return `${el.tagName.toLowerCase()}${id}${cls}${txt ? `("${txt}")` : ''}`;
  };

  const roundRect = (r) => ({
    left: Math.round(r.left * 10) / 10,
    top: Math.round(r.top * 10) / 10,
    right: Math.round(r.right * 10) / 10,
    bottom: Math.round(r.bottom * 10) / 10,
    width: Math.round(r.width * 10) / 10,
    height: Math.round(r.height * 10) / 10,
  });

  // 1. Scrollbars / document overflow.
  const scrollbars = {
    innerWidth: vw,
    innerHeight: vh,
    docScrollWidth: docEl.scrollWidth,
    docScrollHeight: docEl.scrollHeight,
    bodyScrollWidth: body ? body.scrollWidth : vw,
    bodyScrollHeight: body ? body.scrollHeight : vh,
  };
  const hasScrollbar = (
    scrollbars.docScrollWidth > vw + 1 ||
    scrollbars.docScrollHeight > vh + 1 ||
    scrollbars.bodyScrollWidth > vw + 1 ||
    scrollbars.bodyScrollHeight > vh + 1
  );

  // 2. Visible interactive controls.
  const hud = document.getElementById('hud') || body;
  const rawControls = Array.from(
    hud.querySelectorAll('button, [role="button"], a[href], input, select, textarea')
  ).filter(isVisible);

  const controls = rawControls.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      el,
      desc: describeEl(el),
      rect: roundRect(r),
    };
  });

  const undersizedControls = controls
    .filter((c) => Math.round(c.rect.width) < 68 || Math.round(c.rect.height) < 68)
    .map((c) => ({ desc: c.desc, width: c.rect.width, height: c.rect.height }));

  const offscreenControls = controls
    .filter((c) => (
      c.rect.left < -1 || c.rect.top < -1 ||
      c.rect.right > vw + 1 || c.rect.bottom > vh + 1
    ))
    .map((c) => ({ desc: c.desc, rect: c.rect }));

  // 3. Distinct HUD boxes (interactive controls + non-fullscreen HUD info widgets) for overlap check.
  const isFullWrapper = (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= vw * 0.85 && r.height >= vh * 0.85;
  };

  const hudBoxes = [];
  const seenEls = new Set();
  const collectHudBoxes = (container) => {
    if (!container) return;
    for (const child of Array.from(container.children)) {
      if (!isVisible(child)) continue;
      if (isFullWrapper(child)) {
        collectHudBoxes(child);
      } else if (!seenEls.has(child)) {
        seenEls.add(child);
        hudBoxes.push({ el: child, desc: describeEl(child), rect: roundRect(child.getBoundingClientRect()) });
      }
    }
  };
  collectHudBoxes(hud);
  for (const c of controls) {
    if (!seenEls.has(c.el)) {
      seenEls.add(c.el);
      hudBoxes.push(c);
    }
  }

  const overlaps = [];
  for (let i = 0; i < hudBoxes.length; i++) {
    for (let j = i + 1; j < hudBoxes.length; j++) {
      const a = hudBoxes[i], b = hudBoxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const oy = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (ox > 2 && oy > 2) {
        overlaps.push({
          a: a.desc,
          b: b.desc,
          ox: Math.round(ox * 10) / 10,
          oy: Math.round(oy * 10) / 10,
        });
      }
    }
  }

  // 4. Clipped text check across all visible HUD descendants with direct text nodes.
  const clippedText = [];
  const allHudEls = Array.from(hud.querySelectorAll('*')).filter(isVisible);
  for (const el of allHudEls) {
    let directText = '';
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) directText += n.textContent || '';
    }
    directText = directText.trim();
    if (!directText) continue;
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const outViewport = (r.left < -1.5 || r.top < -1.5 || r.right > vw + 1.5 || r.bottom > vh + 1.5);
    const clipX = (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && (el.scrollWidth > el.clientWidth + 2);
    const clipY = (cs.overflowY === 'hidden' || cs.overflowY === 'clip') && (el.scrollHeight > el.clientHeight + 2);
    if (outViewport || clipX || clipY) {
      clippedText.push({
        desc: describeEl(el),
        outViewport,
        clipX,
        clipY,
        rect: roundRect(r),
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
      });
    }
  }

  const isPlayPhase = (phase === 'aim' || phase === 'flight_ready' || phase === 'flight_used');
  const maxControlsOk = !isPlayPhase || (controls.length >= 1 && controls.length <= 5);

  return {
    phase,
    viewport: `${vw}x${vh}`,
    hasScrollbar,
    scrollbars,
    controlCount: controls.length,
    maxControlsOk,
    controls: controls.map((c) => ({ desc: c.desc, rect: c.rect })),
    undersizedControls,
    offscreenControls,
    overlaps,
    clippedText,
    passed: (
      !hasScrollbar &&
      maxControlsOk &&
      undersizedControls.length === 0 &&
      offscreenControls.length === 0 &&
      overlaps.length === 0 &&
      clippedText.length === 0
    ),
  };
})
"""


def audit_viewport_on_session(
    sess: QASession,
    width: int,
    height: int,
    mobile: bool,
    save_shots: bool = True,
) -> dict[str, Any]:
  """Runs G10 layout checks at (width, height) across AIM and FLIGHT states."""
  dims = sess.set_viewport(width, height, mobile=mobile)
  vp_tag = f'{width}x{height}'
  phases: list[dict[str, Any]] = []
  shots: list[str] = []

  # 1. Start level 1-1 and settle into AIM (clear any transient intro pan).
  sess.eval_json(
      """(async () => {
        const M = window.__MUSOU__;
        M.setPaused(false);
        M.startLevel('1-1', { seed: 1 });
        if (window.__APP__ && window.__APP__.cam && window.__APP__.cam.skipIntro) {
          window.__APP__.cam.skipIntro();
        }
        let guard = 0;
        while (M.getState().state === 'intro' && guard < 180) {
          M.stepFrames(6);
          guard += 6;
        }
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return M.getState();
      })()"""
  )
  aim_audit = sess.eval_json(f'({AUDIT_DOM_JS})("aim")')
  phases.append(aim_audit)
  if save_shots:
    shots.append(sess.screenshot(f'layout_{vp_tag}_aim.png'))

  # 2. Launch into FLIGHT (ability ready).
  sess.eval_json(
      """(async () => {
        const M = window.__MUSOU__;
        M.launch(42, 0.88);
        M.stepFrames(18);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return M.getState();
      })()"""
  )
  flight_ready_audit = sess.eval_json(f'({AUDIT_DOM_JS})("flight_ready")')
  phases.append(flight_ready_audit)

  # 3. Trigger ability in FLIGHT (post-ability / next-bird button visible).
  sess.eval_json(
      """(async () => {
        const M = window.__MUSOU__;
        M.useAbility();
        M.stepFrames(12);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return M.getState();
      })()"""
  )
  flight_used_audit = sess.eval_json(f'({AUDIT_DOM_JS})("flight_used")')
  phases.append(flight_used_audit)
  if save_shots:
    shots.append(sess.screenshot(f'layout_{vp_tag}_flight.png'))

  issues: list[str] = []
  if dims['innerWidth'] != width or dims['innerHeight'] != height:
    issues.append(f'viewport mismatch got {dims}')
  for ph in phases:
    p_name = ph['phase']
    if ph['hasScrollbar']:
      issues.append(f'{p_name}: scrollbar {ph["scrollbars"]}')
    if not ph['maxControlsOk']:
      issues.append(f'{p_name}: controlCount={ph["controlCount"]} (expected 1..5)')
    if ph['undersizedControls']:
      issues.append(f'{p_name}: undersized (<68px) {ph["undersizedControls"]}')
    if ph['offscreenControls']:
      issues.append(f'{p_name}: offscreen controls {ph["offscreenControls"]}')
    if ph['overlaps']:
      issues.append(f'{p_name}: overlaps {ph["overlaps"]}')
    if ph['clippedText']:
      issues.append(f'{p_name}: clippedText {ph["clippedText"]}')

  return {
      'viewport': vp_tag,
      'width': width,
      'height': height,
      'mobile': mobile,
      'passed': len(issues) == 0,
      'issues': issues,
      'phases': phases,
      'screenshots': shots,
  }


def run_layout_audit(viewports: list[tuple[int, int, bool]] | None = None, save_shots: bool = True) -> dict[str, Any]:
  ensure_qa_dirs()
  vps = viewports or VIEWPORTS
  results: list[dict[str, Any]] = []
  with QASession(width=1280, height=800, mobile=False) as sess:
    if not sess.goto('index.html?level=1-1'):
      raise RuntimeError('Failed to load index.html?level=1-1 for layout audit')
    for w, h, mob in vps:
      results.append(audit_viewport_on_session(sess, w, h, mob, save_shots=save_shots))
    sess.assert_clean('layout_audit')

  all_passed = all(r['passed'] for r in results)
  out = {
      'gate': 'G10',
      'passed': all_passed,
      'viewports': results,
      'shots_dir': QA_SHOTS_DIR,
  }
  out_path = os.path.join(QA_TMP_DIR, 'layout_audit.json')
  with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
  return out


def format_layout_markdown(report: dict[str, Any]) -> str:
  lines = [
      '| Viewport | Scrollbars | Controls (AIM / FLIGHT) | Min Control >= 68px | Overlaps | Clipped Text | Result |',
      '|---|---|---|---|---|---|---|',
  ]
  for vp in report['viewports']:
    phs = vp['phases']
    has_sb = any(p['hasScrollbar'] for p in phs)
    counts = '/'.join(str(p['controlCount']) for p in phs)
    under = sum(len(p['undersizedControls']) for p in phs)
    ov = sum(len(p['overlaps']) for p in phs)
    clip = sum(len(p['clippedText']) for p in phs)
    status = 'PASS' if vp['passed'] else 'FAIL'
    lines.append(
        f"| {vp['viewport']} | {'YES' if has_sb else '0'} | {counts} | "
        f"{'OK' if under == 0 else f'{under} fail'} | {ov} | {clip} | **{status}** |"
    )
  return '\n'.join(lines)


def main() -> int:
  ap = argparse.ArgumentParser(description='Run G10 multi-viewport layout audit')
  ap.add_argument('--viewport', type=str, default='', help='Optional single WxH filter, e.g. 844x390')
  ap.add_argument('--no-shots', action='store_true', help='Skip writing PNG screenshots')
  args = ap.parse_args()

  vps = VIEWPORTS
  if args.viewport:
    parts = args.viewport.lower().split('x')
    w, h = int(parts[0]), int(parts[1])
    vps = [(w, h, (w, h) != (1280, 800))]

  report = run_layout_audit(viewports=vps, save_shots=not args.no_shots)
  print(format_layout_markdown(report))
  for vp in report['viewports']:
    if not vp['passed']:
      for issue in vp['issues']:
        print(f"  [ISSUE {vp['viewport']}] {issue}")
  print(f"G10_LAYOUT_{'PASS' if report['passed'] else 'FAIL'} shots={QA_SHOTS_DIR}")
  return 0 if report['passed'] else 1


if __name__ == '__main__':
  sys.exit(main())
