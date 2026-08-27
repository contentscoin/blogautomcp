type DesktopActivity = {
  label: string;
  startedAt: number;
};

type DesktopActivityState = {
  sequence: number;
  active: Map<number, DesktopActivity>;
};

const shared = globalThis as typeof globalThis & { __desktopActivityState?: DesktopActivityState };
const state = shared.__desktopActivityState ?? (shared.__desktopActivityState = {
  sequence: 0,
  active: new Map<number, DesktopActivity>(),
});

export function beginDesktopActivity(label: string): () => void {
  state.sequence += 1;
  const id = state.sequence;
  state.active.set(id, { label, startedAt: Date.now() });
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    state.active.delete(id);
  };
}

export function getDesktopActivitySnapshot() {
  const now = Date.now();
  const activities = Array.from(state.active.values()).map((item) => ({
    label: item.label,
    runningForMs: Math.max(0, now - item.startedAt),
  }));
  return { count: activities.length, activities };
}
