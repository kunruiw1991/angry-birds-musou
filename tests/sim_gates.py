#!/usr/bin/env python3
"""Section 13 Fun Gates (G1-G9 + G12) simulation runner (owner: qa-gates).

Drives RANDOM and AIMED policies strictly via `window.__MUSOU__`
(startLevel / launch / useAbility / stepFrames / getState / setPaused / perf)
and reads `window.__APP__.perfStats()` for G12 particle/popup chaos peaks.

Usage:
  python3 tests/sim_gates.py
  python3 tests/sim_gates.py --quick
  python3 tests/sim_gates.py --levels 1-1,1-2 --seeds 10
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
import time
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_helpers import (  # noqa: E402
    DESIGN_BIRDS,
    DESIGN_LEVELS,
    GATES_JSON_PATH,
    QA_TMP_DIR,
    QASession,
    ensure_qa_dirs,
)

INSTALL_SIM_HARNESS_JS = r"""
(() => {
  const mulberry32 = (seed) => {
    let a = (seed >>> 0) || 0x9e3779b9;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const hashStr = (s) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };

  const AIMED_GRID = [
    [22, 0.92, 0.45],
    [28, 0.85, 0.50],
    [32, 0.95, 0.60],
    [38, 0.95, 0.55],
    [42, 1.00, 0.75],
    [48, 1.00, 0.90],
    [53, 1.00, 1.05],
    [25, 0.75, 0.40],
  ];

  const ensureAim = (M) => {
    let s = M.getState();
    let guard = 0;
    while (s.state === 'intro' && guard < 240) {
      M.stepFrames(6);
      s = M.getState();
      guard += 6;
    }
    return s;
  };

  const finishIfTerminal = (M) => {
    let s = M.getState();
    let guard = 0;
    while (
      guard < 300 &&
      s.state !== 'clear' &&
      s.state !== 'fail' &&
      (s.state === 'settle' || (s.pigsAtStart > 0 && s.pigsLeft === 0))
    ) {
      M.stepFrames(6);
      s = M.getState();
      guard += 6;
    }
    return s;
  };

  const runOneTurn = (M, angle, power, tAbilitySec) => {
    const s0 = ensureAim(M);
    if (s0.state !== 'aim') {
      return { launched: false, endState: s0 };
    }
    const turnBirdIdx = s0.birdIndex;
    const launched = M.launch(angle, power);
    if (!launched) {
      return { launched: false, endState: M.getState() };
    }
    const abFrames = Math.max(1, Math.round(tAbilitySec * 60));
    let stepped = 0;
    while (stepped < abFrames) {
      const chunk = Math.min(6, abFrames - stepped);
      const r = M.stepFrames(chunk);
      stepped += chunk;
      if (r.state !== 'flight') break;
    }
    const preTap = M.getState();
    let tapped = false;
    if (preTap.state === 'flight' && !preTap.abilityUsed) {
      tapped = !!M.useAbility();
    }
    const tapState = M.getState();
    const launchT = tapState.launchT;
    const abilityT = tapState.abilityT;

    let guard = 0;
    while (guard < 960) {
      const cur = M.getState();
      if (cur.state !== 'flight' || cur.birdIndex !== turnBirdIdx) break;
      M.stepFrames(6);
      guard += 6;
    }
    let endState = M.getState();
    if (endState.state === 'settle' || (endState.pigsAtStart > 0 && endState.pigsLeft === 0)) {
      endState = finishIfTerminal(M);
    }
    return {
      launched: true,
      tapped,
      launchT,
      abilityT,
      firstPigKillT: endState.firstPigKillT,
      pigsAtStart: endState.pigsAtStart,
      pigsLeft: endState.pigsLeft,
      pigsKilledRatio: (endState.pigsAtStart - endState.pigsLeft) / Math.max(1, endState.pigsAtStart),
      blocksAtStart: endState.blocksAtStart,
      displaced: endState.displaced,
      displacedRatio: endState.displaced / Math.max(1, endState.blocksAtStart),
      endState,
    };
  };

  window.__QA_SIM__ = {
    runStabilityBatch(levelId, seeds) {
      const M = window.__MUSOU__;
      M.setPaused(true);
      const out = [];
      for (const seed of seeds) {
        M.startLevel(levelId, { seed });
        ensureAim(M);
        M.stepFrames(600);
        const s = M.getState();
        out.push({
          seed,
          pigsDead: s.pigsAtStart - s.pigsLeft,
          displaced: s.displaced,
          damageDealt: (s.stats && s.stats.damageDealt) || 0,
          awake: s.awake,
        });
      }
      return out;
    },

    runRandomBatch(levelId, seeds) {
      const M = window.__MUSOU__;
      M.setPaused(true);
      const lvHash = hashStr(levelId);
      const out = [];
      for (const seed of seeds) {
        M.startLevel(levelId, { seed });
        const prng = mulberry32(((seed * 2654435761) >>> 0) ^ lvHash);
        let firstTurn = null;
        let epLaunchT = null;
        let epAbilityT = null;
        let epFirstKillT = null;
        for (let turn = 0; turn < 24; turn++) {
          const s = ensureAim(M);
          if (s.state === 'clear' || s.state === 'fail') break;
          if (s.state !== 'aim') {
            finishIfTerminal(M);
            break;
          }
          const angle = 20 + prng() * 35;
          const power = 0.70 + prng() * 0.30;
          const tAb = 0.35 + prng() * 0.55;
          const tr = runOneTurn(M, angle, power, tAb);
          if (turn === 0) {
            firstTurn = tr;
            epLaunchT = tr.launchT;
            epAbilityT = tr.abilityT;
          }
          if (epFirstKillT == null && tr.endState.firstPigKillT != null) {
            epFirstKillT = tr.endState.firstPigKillT;
          }
          if (tr.endState.state === 'clear' || tr.endState.state === 'fail' || !tr.launched) break;
        }
        const fin = finishIfTerminal(M);
        if (epFirstKillT == null && fin.firstPigKillT != null) {
          epFirstKillT = fin.firstPigKillT;
        }
        out.push({
          seed,
          cleared: fin.state === 'clear',
          state: fin.state,
          score: fin.score,
          stars: fin.stars || 0,
          birdsUsed: fin.birdsUsed,
          pigsAtStart: fin.pigsAtStart,
          blocksAtStart: fin.blocksAtStart,
          firstShotPigKillRatio: firstTurn ? firstTurn.pigsKilledRatio : 0,
          firstShotDisplaced: firstTurn ? firstTurn.displaced : 0,
          firstShotDisplacedRatio: firstTurn ? firstTurn.displacedRatio : 0,
          killAfterAbilityS: (epFirstKillT != null && epAbilityT != null) ? (epFirstKillT - epAbilityT) : null,
          killAfterLaunchS: (epFirstKillT != null && epLaunchT != null) ? (epFirstKillT - epLaunchT) : null,
        });
      }
      return out;
    },

    runAimedCandidates(levelId, seed, chosen, candIndices) {
      const M = window.__MUSOU__;
      M.setPaused(true);
      let best = null;
      for (const ci of candIndices) {
        const cand = AIMED_GRID[ci];
        M.startLevel(levelId, { seed });
        let replayOk = true;
        for (const prev of chosen) {
          const rPrev = runOneTurn(M, prev[0], prev[1], prev[2]);
          if (!rPrev.launched) { replayOk = false; break; }
        }
        const preCand = ensureAim(M);
        if (!replayOk || preCand.state !== 'aim') continue;
        runOneTurn(M, cand[0], cand[1], cand[2]);
        const st = finishIfTerminal(M);
        const pigsKilled = st.pigsAtStart - st.pigsLeft;
        const cleared = st.state === 'clear' ? 1 : 0;
        const stars = st.stars || 0;
        const key = [pigsKilled, cleared, stars, st.score];
        if (!best ||
            key[0] > best.key[0] ||
            (key[0] === best.key[0] && key[1] > best.key[1]) ||
            (key[0] === best.key[0] && key[1] === best.key[1] && key[2] > best.key[2]) ||
            (key[0] === best.key[0] && key[1] === best.key[1] && key[2] === best.key[2] && key[3] > best.key[3])) {
          best = {
            cand,
            key,
            summary: {
              state: st.state,
              cleared: st.state === 'clear',
              stars: st.stars || 0,
              score: st.score,
              birdsUsed: st.birdsUsed,
            },
          };
        }
      }
      return best;
    },

    finishAimedTail(levelId, seed, chosen, maxBirds) {
      const M = window.__MUSOU__;
      M.setPaused(true);
      M.startLevel(levelId, { seed });
      let finalState = M.getState();
      for (const prev of chosen) {
        runOneTurn(M, prev[0], prev[1], prev[2]);
        finalState = finishIfTerminal(M);
      }
      for (let bIdx = chosen.length; bIdx < maxBirds; bIdx++) {
        if (finalState.state === 'clear' || finalState.state === 'fail') break;
        const cur = ensureAim(M);
        if (cur.state !== 'aim') break;
        const c = AIMED_GRID[bIdx % AIMED_GRID.length];
        runOneTurn(M, c[0], c[1], c[2]);
        finalState = finishIfTerminal(M);
      }
      return {
        state: finalState.state,
        cleared: finalState.state === 'clear',
        stars: finalState.stars || 0,
        score: finalState.score,
        birdsUsed: finalState.birdsUsed,
      };
    },

    runBirdAbilityBatch(birdId, levelId, forceOverride, seeds) {
      const M = window.__MUSOU__;
      const app = window.__APP__;
      M.setPaused(true);
      const bHash = hashStr(birdId);
      const out = [];

      for (const seed of seeds) {
        const opts = forceOverride ? { seed, birds: [birdId, birdId] } : { seed };
        M.startLevel(levelId, opts);
        if (app && app.particles && app.particles.clear) app.particles.clear();
        if (app && app.popups && app.popups.clear) app.popups.clear();
        ensureAim(M);
        const prng = mulberry32(((seed * 2246822519) >>> 0) ^ bHash);
        const angle = 22 + prng() * 30;
        const power = 0.75 + prng() * 0.25;
        const tAb = 0.35 + prng() * 0.45;
        M.launch(angle, power);
        const abFrames = Math.max(1, Math.round(tAb * 60));
        for (let i = 0; i < abFrames; i++) {
          const r = M.stepFrames(1);
          if (app) {
            app.juice && app.juice.update && app.juice.update(1 / 60);
            app.particles && app.particles.update && app.particles.update(1 / 60);
            app.popups && app.popups.update && app.popups.update(1 / 60);
          }
          if (r.state !== 'flight') break;
        }
        const sPre = M.getState();
        let prevEff = sPre.effects || 0;
        let prevProj = sPre.projectiles || 0;
        const tapped = M.useAbility();
        const s0 = M.getState();
        let vfx01 = (s0.effects > prevEff) || (s0.projectiles > prevProj);
        prevEff = s0.effects || 0;
        prevProj = s0.projectiles || 0;

        const ps0 = app && app.perfStats ? app.perfStats() : M.perf();
        let peakParticles = ps0.particles || 0;
        let peakPopups = ps0.popups || 0;

        for (let f = 1; f <= 150; f++) {
          M.stepFrames(1);
          if (app) {
            app.juice && app.juice.update && app.juice.update(1 / 60);
            app.particles && app.particles.update && app.particles.update(1 / 60);
            app.popups && app.popups.update && app.popups.update(1 / 60);
          }
          if (f <= 6 && !vfx01) {
            const sf = M.getState();
            if ((sf.effects > prevEff) || (sf.projectiles > prevProj)) vfx01 = true;
            prevEff = sf.effects || 0;
            prevProj = sf.projectiles || 0;
          }
          if (f <= 120) {
            const ps = app && app.perfStats ? app.perfStats() : M.perf();
            if ((ps.particles || 0) > peakParticles) peakParticles = ps.particles;
            if ((ps.popups || 0) > peakPopups) peakPopups = ps.popups;
          }
        }
        const sPost = M.getState();
        const dmgAfterTap = ((sPost.stats && sPost.stats.damageDealt) || 0) - ((sPre.stats && sPre.stats.damageDealt) || 0);
        const totalDmg = (sPost.stats && sPost.stats.damageDealt) || 0;
        const dmgUsed = Math.max(dmgAfterTap, birdId === 'red' ? totalDmg : dmgAfterTap);
        const bodiesAffected = sPost.displaced + (sPost.pigsAtStart - sPost.pigsLeft);
        out.push({
          seed,
          tapped,
          vfx01,
          dmg25: Math.round(dmgUsed),
          bodies25: bodiesAffected,
          peakParticles2s: peakParticles,
          peakPopups2s: peakPopups,
          g5Pass: Boolean(tapped && vfx01 && dmgUsed >= 400 && bodiesAffected >= 12),
        });
      }
      return out;
    },

    runDeterminism(levelIds) {
      const M = window.__MUSOU__;
      M.setPaused(true);
      const out = [];
      const diffPaths = (a, b, prefix = '') => {
        const diffs = [];
        if (a === b) return diffs;
        if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
          diffs.push(`${prefix || '<root>'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
          return diffs;
        }
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of keys) {
          const p = prefix ? `${prefix}.${k}` : k;
          diffs.push(...diffPaths(a[k], b[k], p));
          if (diffs.length >= 8) break;
        }
        return diffs;
      };

      const runFixed900 = (lvId) => {
        M.startLevel(lvId, { seed: 2026 });
        let frames = 0;
        while (M.getState().state === 'intro' && frames < 180) {
          M.stepFrames(6);
          frames += 6;
        }
        if (M.getState().state === 'aim') {
          M.launch(37, 0.92);
          M.stepFrames(36);
          frames += 36;
          M.useAbility();
        }
        while (frames < 900) {
          const s = M.getState();
          if (s.state === 'aim' && frames + 60 <= 900) {
            M.launch(43, 0.88);
            M.stepFrames(36);
            frames += 36;
            M.useAbility();
            continue;
          }
          const step = Math.min(30, 900 - frames);
          M.stepFrames(step);
          frames += step;
        }
        return M.getState();
      };

      for (const lvId of levelIds) {
        const st1 = runFixed900(lvId);
        const st2 = runFixed900(lvId);
        const j1 = JSON.stringify(st1);
        const j2 = JSON.stringify(st2);
        out.push({
          levelId: lvId,
          identical: j1 === j2,
          frame: st1.frame,
          diffs: j1 === j2 ? [] : diffPaths(st1, st2),
        });
      }
      return out;
    },

    async runPerfChaos(levelId, durationMs) {
      const M = window.__MUSOU__;
      const app = window.__APP__;
      M.setPaused(false);
      M.startLevel(levelId, { seed: 7, birds: ['bomb', 'bomb', 'blues'] });
      if (app && app.cam && app.cam.skipIntro) app.cam.skipIntro();
      let guard = 0;
      while (M.getState().state === 'intro' && guard < 180) {
        M.stepFrames(6);
        guard += 6;
      }
      M.launch(38, 0.95);
      M.stepFrames(32);
      M.useAbility();

      const rafDeltas = [];
      const syncSteps = [];
      await new Promise((resolve) => {
        const tStart = performance.now();
        let prev = tStart;
        const tick = (now) => {
          rafDeltas.push(now - prev);
          prev = now;
          if (now - tStart >= durationMs) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      // Also sample 120 synchronous stepFrames(1) timings on a fresh bomb chaos burst as backup
      // in case RAF is throttled by the environment.
      M.setPaused(true);
      M.startLevel(levelId, { seed: 9, birds: ['bomb'] });
      while (M.getState().state === 'intro') M.stepFrames(6);
      M.launch(38, 0.95);
      M.stepFrames(32);
      M.useAbility();
      for (let i = 0; i < 120; i++) {
        syncSteps.push(M.stepFrames(1).ms);
      }
      M.setPaused(false);

      const pct95 = (arr) => {
        if (!arr.length) return 0;
        const s = arr.slice().sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))];
      };
      const perf = M.perf();
      return {
        levelId,
        rafFrames: rafDeltas.length,
        perfStepP95: +(perf.stepP95 || 0).toFixed(3),
        syncStepP95: +pct95(syncSteps).toFixed(3),
        perfFrameP95: +(perf.frameP95 || 0).toFixed(3),
        bodies: perf.bodies || 0,
      };
    },
  };
  return true;
})()
"""


def _median(vals: list[float]) -> float:
  return float(statistics.median(vals)) if vals else 0.0


def run_sim_gates_on_session(
    sess: QASession,
    level_filter: list[str] | None = None,
    seeds_override: int = 0,
    quick: bool = False,
) -> dict[str, Any]:
  """Executes §13 G1-G9 + G12 inside an active QASession."""
  ensure_qa_dirs()
  sess.set_viewport(1280, 800, mobile=False)
  sess.eval(INSTALL_SIM_HARNESS_JS)

  live_levels_meta = sess.eval_json('window.__MUSOU__.listLevels()')
  live_ids = [lv['id'] for lv in live_levels_meta]
  live_set = set(live_ids)

  expected_ids = [lv['id'] for lv in DESIGN_LEVELS]
  target_ids = level_filter if level_filter else expected_ids
  missing_levels = [lid for lid in target_ids if lid not in live_set]
  active_ids = [lid for lid in target_ids if lid in live_set]

  if seeds_override > 0:
    n_random = seeds_override
    n_g4 = min(3, max(1, seeds_override))
    n_g5 = seeds_override
    n_aimed = min(5, max(1, seeds_override))
  elif quick:
    n_random = 5
    n_g4 = 1
    n_g5 = 3
    n_aimed = 2
  else:
    n_random = 20
    n_g4 = 3
    n_g5 = 10
    n_aimed = 5

  random_seeds = list(range(1, n_random + 1))
  g4_seeds = list(range(1, n_g4 + 1))
  g5_seeds = list(range(1, n_g5 + 1))
  aimed_seeds = list(range(1, n_aimed + 1))

  # 1. G4: Stability (600 idle frames per level x seed).
  stability_by_level: dict[str, Any] = {}
  for lid in active_ids:
    stability_by_level[lid] = sess.eval_json(
        f'window.__QA_SIM__.runStabilityBatch({json.dumps(lid)}, {json.dumps(g4_seeds)})'
    )

  lv_meta_by_id = {lv['id']: lv for lv in live_levels_meta}

  # 2. RANDOM episodes per level (feeds G1, G2, G3, G6, G7-random). Chunked so each eval < 15s.
  random_by_level: dict[str, list[dict[str, Any]]] = {}
  for lid in active_ids:
    chunk_sz = 5 if lid == '3-5' else 10
    runs: list[dict[str, Any]] = []
    for i in range(0, len(random_seeds), chunk_sz):
      chunk = random_seeds[i : i + chunk_sz]
      runs.extend(
          sess.eval_json(
              f'window.__QA_SIM__.runRandomBatch({json.dumps(lid)}, {json.dumps(chunk)})'
          )
      )
    random_by_level[lid] = runs

  # 3. AIMED episodes per level (feeds G7-aimed). Split per bird/candidate slice so every eval < 12s.
  aimed_by_level: dict[str, list[dict[str, Any]]] = {}
  for lid in active_ids:
    aimed_by_level[lid] = []
    meta = lv_meta_by_id.get(lid, {})
    max_birds = len(meta.get('birds') or []) or 1
    par = int(meta.get('par') or 1)
    search_birds = min(max_birds, par)
    cand_slices = [[0, 1, 2, 3], [4, 5, 6, 7]] if lid == '3-5' else [[0, 1, 2, 3, 4, 5, 6, 7]]

    for sd in aimed_seeds:
      if quick and lid == '3-5' and any(r['stars'] >= 3 for r in aimed_by_level[lid]):
        break
      chosen: list[list[float]] = []
      final_summary: dict[str, Any] = {'cleared': False, 'stars': 0, 'score': 0, 'birdsUsed': 0, 'state': 'aim'}
      for _b_idx in range(search_birds):
        best_step: dict[str, Any] | None = None
        for c_slice in cand_slices:
          part = sess.eval_json(
              f'window.__QA_SIM__.runAimedCandidates({json.dumps(lid)}, {sd}, '
              f'{json.dumps(chosen)}, {json.dumps(c_slice)})'
          )
          if part and (best_step is None or part['key'] > best_step['key']):
            best_step = part
        if not best_step:
          break
        chosen.append(best_step['cand'])
        final_summary = best_step['summary']
        if final_summary['state'] in ('clear', 'fail'):
          break
      if final_summary['state'] not in ('clear', 'fail') and len(chosen) < max_birds:
        final_summary = sess.eval_json(
            f'window.__QA_SIM__.finishAimedTail({json.dumps(lid)}, {sd}, '
            f'{json.dumps(chosen)}, {max_birds})'
        )
      aimed_by_level[lid].append({'seed': sd, **final_summary})

  # 4. G5 & G12: Bird ability chaos & no-dud check (1 eval per bird).
  birds_To_run = DESIGN_BIRDS
  if level_filter:
    # Still test all 12 birds unless user explicitly scoped --levels; use available intro or fallback.
    birds_To_run = DESIGN_BIRDS
  bird_results: dict[str, Any] = {}
  missing_intro_birds: list[str] = []
  fallback_lv = active_ids[0] if active_ids else '1-1'
  for b in birds_To_run:
    bid = b['id']
    intro = b['intro']
    has_intro = intro in live_set
    if not has_intro and not level_filter:
      missing_intro_birds.append(f'{bid}({intro})')
    use_lv = intro if has_intro else fallback_lv
    force_override = not has_intro
    runs = sess.eval_json(
        f'window.__QA_SIM__.runBirdAbilityBatch({json.dumps(bid)}, {json.dumps(use_lv)}, '
        f'{json.dumps(force_override)}, {json.dumps(g5_seeds)})'
    )
    bird_results[bid] = {
        'level': use_lv,
        'has_intro_level': has_intro,
        'runs': runs,
    }

  # 5. G8: Determinism (up to 3 spread levels x 2 runs x 900 frames).
  det_levels: list[str] = []
  if active_ids:
    idxs = sorted({0, len(active_ids) // 2, len(active_ids) - 1})
    det_levels = [active_ids[i] for i in idxs]
  det_results = sess.eval_json(f'window.__QA_SIM__.runDeterminism({json.dumps(det_levels)})') if det_levels else []

  # 6. G9: Perf on 3-5 + bomb chaos at 1280x800.
  has_3_5 = '3-5' in live_set
  perf_lv = '3-5' if has_3_5 else (active_ids[-1] if active_ids else '1-1')
  perf_dur_ms = 1600 if quick else 3600
  perf_res = sess.eval_json(f'window.__QA_SIM__.runPerfChaos({json.dumps(perf_lv)}, {perf_dur_ms})')

  # ---------------- Evaluate G1 - G9 + G12 ----------------
  gates: list[dict[str, Any]] = []

  # G1: 1-1..1-4 RANDOM: first bird kills >= 60% of pigs in >= 70% of seeds.
  g1_target_lvs = [x for x in ('1-1', '1-2', '1-3', '1-4') if x in target_ids]
  g1_missing = [x for x in g1_target_lvs if x not in live_set]
  g1_runs = [r for x in g1_target_lvs if x in random_by_level for r in random_by_level[x]]
  g1_per_lv = {
      x: sum(1 for r in random_by_level[x] if r['firstShotPigKillRatio'] >= 0.60 - 1e-9) / max(1, len(random_by_level[x]))
      for x in g1_target_lvs if x in random_by_level
  }
  g1_rate = sum(1 for r in g1_runs if r['firstShotPigKillRatio'] >= 0.60 - 1e-9) / max(1, len(g1_runs)) if g1_runs else 0.0
  g1_pass = bool(g1_runs) and not g1_missing and (g1_rate >= 0.70 - 1e-9)
  g1_meas = f'{g1_rate * 100:.1f}% ({len(g1_per_lv)}/{len(g1_target_lvs)} 1-x levels)'
  if g1_missing:
    g1_meas += f' [missing {",".join(g1_missing)}]'
  gates.append({
      'gate': 'G1 power fantasy',
      'id': 'G1',
      'target': '1-1..1-4 1st bird >=60% pigs in >=70% seeds',
      'measured': g1_meas,
      'passed': g1_pass,
      'details': {'pooled_rate': round(g1_rate, 4), 'per_level': g1_per_lv, 'missing': g1_missing},
  })

  # G2: median blocks displaced+destroyed by 1st shot >= 40% (all levels) and >= 25 abs on >=60-block levels.
  g2_per_lv: dict[str, Any] = {}
  g2_fail_lvs: list[str] = []
  for lid in active_ids:
    runs = random_by_level[lid]
    med_pct = _median([r['firstShotDisplacedRatio'] for r in runs])
    med_abs = _median([r['firstShotDisplaced'] for r in runs])
    b_start = runs[0]['blocksAtStart'] if runs else 0
    ok = (med_pct >= 0.40 - 1e-9) and (b_start < 60 or med_abs >= 25 - 1e-9)
    if not ok:
      g2_fail_lvs.append(lid)
    g2_per_lv[lid] = {'median_pct': round(med_pct, 4), 'median_abs': med_abs, 'blocks': b_start, 'ok': ok}
  min_med_pct = min((v['median_pct'] for v in g2_per_lv.values()), default=0.0)
  big_abs = [v['median_abs'] for v in g2_per_lv.values() if v['blocks'] >= 60]
  g2_pass = bool(active_ids) and not missing_levels and not g2_fail_lvs
  g2_meas = f'min med {min_med_pct * 100:.1f}%'
  if big_abs:
    g2_meas += f', min >=60b abs {min(big_abs):.0f}'
  if missing_levels:
    g2_meas += f' [missing {len(missing_levels)} lvs]'
  gates.append({
      'gate': 'G2 spectacle volume',
      'id': 'G2',
      'target': '1st shot med >=40% blocks & >=25 abs (>=60b)',
      'measured': g2_meas,
      'passed': g2_pass,
      'details': {'per_level': g2_per_lv, 'failed_levels': g2_fail_lvs, 'missing': missing_levels},
  })

  # G3: 1-1..2-4 RANDOM: median (firstPigKill - ability) <= 1.2s, (firstPigKill - launch) <= 2.2s.
  g3_target_lvs = [x for x in ('1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4') if x in target_ids]
  g3_missing = [x for x in g3_target_lvs if x not in live_set]
  g3_runs = [r for x in g3_target_lvs if x in random_by_level for r in random_by_level[x]]
  ab_lat = [r['killAfterAbilityS'] if r['killAfterAbilityS'] is not None else 999.0 for r in g3_runs]
  ln_lat = [r['killAfterLaunchS'] if r['killAfterLaunchS'] is not None else 999.0 for r in g3_runs]
  med_ab = _median(ab_lat) if ab_lat else 999.0
  med_ln = _median(ln_lat) if ln_lat else 999.0
  g3_pass = bool(g3_runs) and not g3_missing and (med_ab <= 1.2 + 1e-9) and (med_ln <= 2.2 + 1e-9)
  ab_str = f'{med_ab:.2f}s' if med_ab < 900 else 'no-kill'
  ln_str = f'{med_ln:.2f}s' if med_ln < 900 else 'no-kill'
  g3_meas = f'ab->{ab_str}, launch->{ln_str}'
  if g3_missing:
    g3_meas += f' [missing {len(g3_missing)} lvs]'
  gates.append({
      'gate': 'G3 latency',
      'id': 'G3',
      'target': '1-1..2-4 med kill-ability <=1.2s, kill-launch <=2.2s',
      'measured': g3_meas,
      'passed': g3_pass,
      'details': {'median_after_ability_s': round(med_ab, 3), 'median_after_launch_s': round(med_ln, 3), 'missing': g3_missing},
  })

  # G4: idle 600 frames: 0 pigs dead, 0 displaced, 0 damage.
  all_stab = [s for lv_runs in stability_by_level.values() for s in lv_runs]
  max_dead = max((s['pigsDead'] for s in all_stab), default=0)
  max_disp = max((s['displaced'] for s in all_stab), default=0)
  max_dmg = max((s['damageDealt'] for s in all_stab), default=0)
  g4_pass = bool(all_stab) and not missing_levels and max_dead == 0 and max_disp == 0 and max_dmg == 0
  g4_meas = f'dead={max_dead}, disp={max_disp}, dmg={max_dmg:.0f} ({len(active_ids)}/{len(target_ids)} lvs)'
  gates.append({
      'gate': 'G4 stability',
      'id': 'G4',
      'target': '600 idle frames: 0 dead, 0 disp, 0 dmg (13 lvs)',
      'measured': g4_meas,
      'passed': g4_pass,
      'details': {'by_level': stability_by_level, 'missing': missing_levels},
  })

  # G5: each bird on intro level: >=400 dmg, >=12 bodies in 2.5s, >=1 VFX/proj in 0.1s in >=9/10 seeds.
  req_g5_passes = math.ceil(0.9 * n_g5) if n_g5 >= 5 else max(1, n_g5 - 1)
  g5_bird_summary: dict[str, Any] = {}
  g5_passing_birds = 0
  for b in DESIGN_BIRDS:
    bid = b['id']
    runs = bird_results[bid]['runs']
    passes = sum(1 for r in runs if r['g5Pass'])
    med_dmg = _median([r['dmg25'] for r in runs])
    med_bod = _median([r['bodies25'] for r in runs])
    vfx_ok = sum(1 for r in runs if r['vfx01'])
    ok = (passes >= req_g5_passes) and (bird_results[bid]['has_intro_level'] or bool(level_filter))
    if ok:
      g5_passing_birds += 1
    g5_bird_summary[bid] = {
        'level': bird_results[bid]['level'],
        'has_intro': bird_results[bid]['has_intro_level'],
        'passes': f'{passes}/{n_g5}',
        'median_dmg': med_dmg,
        'median_bodies': med_bod,
        'vfx_passes': f'{vfx_ok}/{n_g5}',
        'ok': ok,
    }
  g5_pass = (g5_passing_birds == len(DESIGN_BIRDS)) and (not missing_intro_birds or bool(level_filter))
  g5_meas = f'{g5_passing_birds}/12 birds pass (>={req_g5_passes}/{n_g5} seeds)'
  if missing_intro_birds and not level_filter:
    g5_meas += f' [missing {len(missing_intro_birds)} intros]'
  gates.append({
      'gate': 'G5 no dud ability',
      'id': 'G5',
      'target': '12 birds: >=400 dmg & >=12 bodies (2.5s), VFX <=0.1s (>=9/10)',
      'measured': g5_meas,
      'passed': g5_pass,
      'details': {'per_bird': g5_bird_summary, 'missing_intros': missing_intro_birds},
  })

  # G6: RANDOM full run clear rate >= 70% on every level (>= 90% on 1-x).
  g6_per_lv: dict[str, Any] = {}
  g6_fails: list[str] = []
  for lid in active_ids:
    runs = random_by_level[lid]
    rate = sum(1 for r in runs if r['cleared']) / max(1, len(runs))
    thresh = 0.90 if lid.startswith('1-') else 0.70
    ok = rate >= thresh - 1e-9
    if not ok:
      g6_fails.append(f'{lid}:{rate * 100:.0f}%')
    g6_per_lv[lid] = {'clear_rate': round(rate, 4), 'target': thresh, 'ok': ok}
  min_1x = min((v['clear_rate'] for k, v in g6_per_lv.items() if k.startswith('1-')), default=0.0)
  min_all = min((v['clear_rate'] for v in g6_per_lv.values()), default=0.0)
  g6_pass = bool(active_ids) and not missing_levels and not g6_fails
  g6_meas = f'min 1-x {min_1x * 100:.0f}%, min all {min_all * 100:.0f}% ({len(active_ids)}/{len(target_ids)} lvs)'
  gates.append({
      'gate': 'G6 clearable',
      'id': 'G6',
      'target': 'RANDOM clear >=70% all levels (>=90% on 1-x)',
      'measured': g6_meas,
      'passed': g6_pass,
      'details': {'per_level': g6_per_lv, 'failed': g6_fails, 'missing': missing_levels},
  })

  # G7: 3-star rate under RANDOM <= 60% on 2-x/3-x; AIMED reaches 3-star in >= 1/5 seeds on every level.
  g7_rand_23: dict[str, float] = {}
  g7_rand_fails: list[str] = []
  for lid in active_ids:
    if lid.startswith(('2-', '3-')):
      runs = random_by_level[lid]
      r3 = sum(1 for r in runs if r['stars'] >= 3) / max(1, len(runs))
      g7_rand_23[lid] = round(r3, 4)
      if r3 > 0.60 + 1e-9:
        g7_rand_fails.append(f'{lid}:{r3 * 100:.0f}%')
  g7_aimed_rates: dict[str, float] = {}
  g7_aimed_fails: list[str] = []
  for lid in active_ids:
    aruns = aimed_by_level[lid]
    a3 = sum(1 for r in aruns if r['stars'] >= 3) / max(1, len(aruns))
    g7_aimed_rates[lid] = round(a3, 4)
    if a3 < 0.20 - 1e-9:
      g7_aimed_fails.append(f'{lid}:{a3 * 100:.0f}%')
  has_23_targets = any(lid.startswith(('2-', '3-')) for lid in target_ids)
  has_23_live = bool(g7_rand_23) or not has_23_targets
  max_r3_23 = max(g7_rand_23.values(), default=0.0)
  min_a3 = min(g7_aimed_rates.values(), default=0.0)
  g7_pass = (
      bool(active_ids)
      and not missing_levels
      and has_23_live
      and not g7_rand_fails
      and not g7_aimed_fails
  )
  g7_meas = f'max 2/3-x rand 3* {max_r3_23 * 100:.0f}%, min aimed 3* {min_a3 * 100:.0f}%'
  if missing_levels:
    g7_meas += f' [missing {len(missing_levels)} lvs]'
  gates.append({
      'gate': 'G7 stars meaningful',
      'id': 'G7',
      'target': 'RAND 3* <=60% (2-x/3-x); AIMED 3* >=20% all lvs',
      'measured': g7_meas,
      'passed': g7_pass,
      'details': {
          'random_3star_2x3x': g7_rand_23,
          'aimed_3star_all': g7_aimed_rates,
          'rand_fails': g7_rand_fails,
          'aimed_fails': g7_aimed_fails,
          'missing': missing_levels,
      },
  })

  # G8: Determinism (3 levels x 2 runs x 900 frames).
  det_ok = all(d['identical'] for d in det_results) and bool(det_results)
  need_3_det = (not level_filter) and len(det_results) < 3
  g8_pass = det_ok and not need_3_det
  det_pass_n = sum(1 for d in det_results if d['identical'])
  g8_meas = f'{det_pass_n}/{len(det_results)} identical'
  if not det_ok:
    first_diff = next((d['diffs'][0] for d in det_results if d['diffs']), 'mismatch')
    g8_meas += f' (diff: {first_diff})'
  elif need_3_det:
    g8_meas += ' [need >=3 levels]'
  gates.append({
      'gate': 'G8 determinism',
      'id': 'G8',
      'target': 'same seed+inputs -> identical JSON @ 900f (3 lvs)',
      'measured': g8_meas,
      'passed': g8_pass,
      'details': {'runs': det_results},
  })

  # G9: Perf on 3-5 + bomb chaos.
  step_p95 = max(perf_res['perfStepP95'], perf_res['syncStepP95'])
  frame_p95 = perf_res['perfFrameP95']
  require_3_5 = ('3-5' in target_ids)
  g9_pass = (
      (has_3_5 or not require_3_5)
      and perf_res['rafFrames'] >= 15
      and step_p95 <= 8.0
      and frame_p95 <= 25.0
  )
  g9_meas = f"step p95={step_p95:.2f}ms, frame p95={frame_p95:.2f}ms ({perf_res['levelId']}, bodies={perf_res['bodies']})"
  if require_3_5 and not has_3_5:
    g9_meas += ' [missing 3-5]'
  gates.append({
      'gate': 'G9 perf',
      'id': 'G9',
      'target': '3-5 + bomb: step p95 <=8ms, frame p95 <=25ms',
      'measured': g9_meas,
      'passed': g9_pass,
      'details': perf_res,
  })

  # G12: Peak chaos within 2s of each ability: peak particles >= 120 and popups >= 15.
  g12_per_bird: dict[str, Any] = {}
  g12_pass_n = 0
  for b in DESIGN_BIRDS:
    bid = b['id']
    runs = bird_results[bid]['runs']
    med_part = _median([r['peakParticles2s'] for r in runs])
    med_pop = _median([r['peakPopups2s'] for r in runs])
    max_part = max((r['peakParticles2s'] for r in runs), default=0)
    max_pop = max((r['peakPopups2s'] for r in runs), default=0)
    ok = (med_part >= 120 - 1e-9) and (med_pop >= 15 - 1e-9)
    if ok:
      g12_pass_n += 1
    g12_per_bird[bid] = {
        'median_particles': med_part,
        'max_particles': max_part,
        'median_popups': med_pop,
        'max_popups': max_pop,
        'ok': ok,
    }
  min_part = min((v['median_particles'] for v in g12_per_bird.values()), default=0.0)
  min_pop = min((v['median_popups'] for v in g12_per_bird.values()), default=0.0)
  g12_pass = g12_pass_n == len(DESIGN_BIRDS)
  g12_meas = f'{g12_pass_n}/12 birds (min med part={min_part:.0f}, pop={min_pop:.0f})'
  gates.append({
      'gate': 'G12 peak chaos',
      'id': 'G12',
      'target': 'within 2s of ability: particles >=120, popups >=15',
      'measured': g12_meas,
      'passed': g12_pass,
      'details': {'per_bird': g12_per_bird},
  })

  diag = sess.collect_diagnostics()
  report = {
      'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
      'quick': quick,
      'seeds': {'random': n_random, 'g4': n_g4, 'g5': n_g5, 'aimed': n_aimed},
      'live_levels': live_ids,
      'missing_levels': missing_levels,
      'all_passed': all(g['passed'] for g in gates) and not any(diag.values()),
      'gates': gates,
      'diagnostics': diag,
  }
  os.makedirs(os.path.dirname(GATES_JSON_PATH), exist_ok=True)
  with open(GATES_JSON_PATH, 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
  with open(os.path.join(QA_TMP_DIR, 'gates_latest.json'), 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
  return report


def run_sim_gates(
    level_filter: list[str] | None = None,
    seeds_override: int = 0,
    quick: bool = False,
) -> dict[str, Any]:
  with QASession(width=1280, height=800, mobile=False) as sess:
    if not sess.goto('index.html?level=1-1'):
      raise RuntimeError('Failed to load index.html?level=1-1 for sim_gates')
    return run_sim_gates_on_session(
        sess,
        level_filter=level_filter,
        seeds_override=seeds_override,
        quick=quick,
    )


def format_gates_markdown(report: dict[str, Any]) -> str:
  lines = [
      '| Gate | Target | Measured | Result |',
      '|---|---|---|---|',
  ]
  for g in report['gates']:
    st = 'PASS' if g['passed'] else 'FAIL'
    lines.append(f"| {g['gate']} | {g['target']} | {g['measured']} | **{st}** |")
  return '\n'.join(lines)


def main() -> int:
  ap = argparse.ArgumentParser(description='Run §13 simulation fun gates (G1-G9 + G12)')
  ap.add_argument('--levels', type=str, default='', help='Comma-separated level IDs (default: all 13)')
  ap.add_argument('--seeds', type=int, default=0, help='Override number of seeds per batch')
  ap.add_argument('--quick', action='store_true', help='Fast subset mode for E2E smoke/CI')
  args = ap.parse_args()

  lv_filter = [x.strip() for x in args.levels.split(',') if x.strip()] if args.levels else None
  t0 = time.time()
  report = run_sim_gates(level_filter=lv_filter, seeds_override=args.seeds, quick=args.quick)
  dt = time.time() - t0
  print(format_gates_markdown(report))
  passed_n = sum(1 for g in report['gates'] if g['passed'])
  print(f"\nSIM_GATES {'PASS' if report['all_passed'] else 'FAIL'} ({passed_n}/{len(report['gates'])} gates, {dt:.1f}s) -> {GATES_JSON_PATH}")
  return 0 if report['all_passed'] else 1


if __name__ == '__main__':
  sys.exit(main())
