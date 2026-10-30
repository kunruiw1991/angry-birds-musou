// Tiny synchronous event bus (owner: opus-director). Sim emits; juice/audio/hud/camera listen.
// Listeners must never mutate the physics world (determinism): they are render/audio/UI only.

const listeners = new Map();
let muted = false;  // the seam mutes the bus during headless fast-forward if asked

export const bus = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  },
  off(type, fn) { listeners.get(type)?.delete(fn); },
  emit(type, payload = {}) {
    if (muted) return;
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload, type); } catch (err) { console.error(`[bus:${type}]`, err); }
    }
    const any = listeners.get('*');
    if (any) for (const fn of any) { try { fn(payload, type); } catch (err) { console.error('[bus:*]', err); } }
  },
  setMuted(b) { muted = !!b; },
  isMuted() { return muted; },
};
