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
  // A late request may have passed its route's guard before restart began.
  // Existing activities can finish their nested work; they make restart fail
  // busy. Polls must still deliver persisted results and renew their leases.
  if (process.env.DESKTOP_RESTART_PENDING === "1" && state.active.size === 0 && label !== "remote-agent-poll") {
    const error = new Error("프로그램 재시작 준비 중에는 새 자동화 작업을 시작할 수 없습니다.");
    Object.assign(error, { code: "DESKTOP_RESTART_PENDING" });
    throw error;
  }
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
