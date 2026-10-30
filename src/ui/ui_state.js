// Lightweight shared UI bridge between Hud and Input (owner: levels-hud).
// Keeps Input aware of modal overlays and routes keyboard shortcuts cleanly without editing main.js.

export const uiBridge = {
  hud: null,
  /** True when canvas gameplay gestures (aim/ability/pan/zoom) should be accepted. */
  isPlayInteractive() {
    if (!this.hud) return true;
    return this.hud.isPlayInteractive();
  },
  handleKey(e) {
    if (!this.hud) return false;
    return this.hud.handleKey(e);
  },
};
