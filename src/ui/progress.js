// Progress persistence for 愤怒的小鸟 无双版 (owner: levels-hud).
// Persists localStorage['musou_progress'] = { v:1, levels:{id:{stars,best}}, unlocked, muted, lastLevel }
// and merges { musou: { stars, cleared, updated, plays, best, last } } into localStorage['qq_hall_progress'].

import { STORAGE_KEY } from '../contracts.js';

export const HALL_KEY = 'qq_hall_progress';

function getStore() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (_) {}
  return null;
}

export function defaultProgress() {
  return {
    v: 1,
    levels: {},
    unlocked: ['1-1'],
    muted: false,
    lastLevel: '1-1',
  };
}

export function loadProgress() {
  const base = defaultProgress();
  const st = getStore();
  if (!st) return base;
  try {
    const raw = st.getItem(STORAGE_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return base;
    const levels = {};
    if (p.levels && typeof p.levels === 'object') {
      for (const [k, v] of Object.entries(p.levels)) {
        if (v && typeof v === 'object') {
          levels[k] = {
            stars: Math.max(0, Math.min(3, Number(v.stars) || 0)),
            best: Math.max(0, Math.round(Number(v.best) || 0)),
          };
        }
      }
    }
    let unlocked = ['1-1'];
    if (Array.isArray(p.unlocked)) {
      unlocked = Array.from(new Set(['1-1', ...p.unlocked.filter((x) => typeof x === 'string')]));
    } else if (typeof p.unlocked === 'string' && p.unlocked) {
      unlocked = Array.from(new Set(['1-1', p.unlocked]));
    }
    return {
      v: 1,
      levels,
      unlocked,
      muted: !!p.muted,
      lastLevel: typeof p.lastLevel === 'string' ? p.lastLevel : '1-1',
    };
  } catch (_) {
    return base;
  }
}

export function saveProgress(prog) {
  const st = getStore();
  if (!st) return;
  try {
    st.setItem(STORAGE_KEY, JSON.stringify(prog));
  } catch (_) {}
}

/**
 * Determine whether level `id` is unlocked:
 * - '1-1' is always unlocked.
 * - '3-5' (bonus mega fortress) unlocks after '3-4' is cleared (or if explicitly in prog.unlocked).
 * - Any other level N unlocks if explicitly in prog.unlocked OR previous level N-1 has stars >= 1.
 */
export function isLevelUnlocked(prog, id, allLevels) {
  if (id === '1-1') return true;
  if (!prog) return false;
  const unlockedSet = new Set(prog.unlocked || []);
  if (id === '3-5') {
    return unlockedSet.has('3-5') || ((prog.levels?.['3-4']?.stars || 0) >= 1);
  }
  if (unlockedSet.has(id)) return true;
  const idx = allLevels.findIndex((l) => l.id === id);
  if (idx <= 0) return true;
  const prevId = allLevels[idx - 1].id;
  return (prog.levels?.[prevId]?.stars || 0) >= 1;
}

/** Record a level clear, unlock the next level, save musou_progress, and merge qq_hall_progress. */
export function recordLevelClear(prog, { levelId, score, stars }, allLevels) {
  const prev = prog.levels[levelId] || { stars: 0, best: 0 };
  const best = Math.max(prev.best || 0, Math.round(score || 0));
  const bestStars = Math.max(prev.stars || 0, Math.max(1, Math.min(3, stars || 1)));
  prog.levels[levelId] = { stars: bestStars, best };
  prog.lastLevel = levelId;

  const uSet = new Set(prog.unlocked || ['1-1']);
  uSet.add('1-1');
  uSet.add(levelId);
  const idx = allLevels.findIndex((l) => l.id === levelId);
  if (idx >= 0 && idx + 1 < allLevels.length) {
    const nextId = allLevels[idx + 1].id;
    if (nextId !== '3-5' || levelId === '3-4') {
      uSet.add(nextId);
    }
  }
  prog.unlocked = Array.from(uSet);
  saveProgress(prog);
  syncHallProgress(prog);
  return { best, stars: bestStars };
}

/** Merge { musou: { stars, cleared, updated, plays, best, last } } into localStorage['qq_hall_progress']. */
export function syncHallProgress(prog) {
  const st = getStore();
  if (!st) return;
  try {
    let hall = {};
    const raw = st.getItem(HALL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) hall = parsed;
    }
    let totalStars = 0;
    let cleared = 0;
    let maxBest = 0;
    for (const v of Object.values(prog.levels || {})) {
      if (!v) continue;
      const s = Math.max(0, Math.min(3, Number(v.stars) || 0));
      totalStars += s;
      if (s >= 1) cleared++;
      if ((v.best || 0) > maxBest) maxBest = v.best;
    }
    const prevPlays = Math.max(0, Number(hall.musou?.plays) || 0);
    const iso = new Date().toISOString();
    hall.musou = {
      stars: totalStars,
      cleared,
      updated: iso,
      plays: prevPlays + 1,
      best: maxBest,
      last: iso,
    };
    st.setItem(HALL_KEY, JSON.stringify(hall));
  } catch (_) {}
}
