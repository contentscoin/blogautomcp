type DesktopActivity = {
  label: string;
  startedAt: number;
};

type DesktopActivityState = {
  sequence: number;
  cancellationEpoch?: number;
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

export function beginAutomaticPublishing(label: "automatic-post" | "bulk-schedule-publish" | "bulk-today-publish") {
  const labels = new Set(["automatic-post", "bulk-schedule-publish", "bulk-today-publish"]);
  if (Array.from(state.active.values()).some(activity => labels.has(activity.label))) {
    throw new Error("다른 자동 발행 작업이 진행 중입니다. 완료 후 다시 실행하세요.");
  }
  return beginDesktopActivity(label);
}

export function cancelAutomaticPublishing() {
  state.cancellationEpoch = (state.cancellationEpoch || 0) + 1;
}

export function automaticPublishingCancellationCheck() {
  const epoch = state.cancellationEpoch || 0;
  return () => {
    if (epoch !== (state.cancellationEpoch || 0)) throw new Error("사용자가 자동 발행을 중단했습니다.");
  };
}
