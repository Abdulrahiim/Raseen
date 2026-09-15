/** Single client-side store shared by every page. Plain pub/sub, no framework. */
export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const changed = Object.keys(patch).filter((k) => state[k] !== patch[k]);
      if (!changed.length) return;
      state = { ...state, ...patch };
      for (const fn of listeners) fn(state, changed);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    currentFrame() {
      const s = state.scenario;
      if (!s || !s.frames?.length) return null;
      return s.frames[Math.min(state.frameIndex, s.frames.length - 1)];
    },
  };
}

export const store = createStore({
  status: null, site: null, blocks: null, scenario: null, frameIndex: 240,
  controller: "bgc", mode: "output", selectedBlock: null, activePlant: "najm-3000",
  plants: null, grid: null, theme: "dark", presentation: false, whatsReal: false, playing: false,
});
