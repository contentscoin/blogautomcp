import { startMaterialPolling } from "./material-polling";

export type MaterialSummaryVerification = {
  mode: "saved-summary";
  strict: false;
  observedAt?: string;
  contentCheckedAt?: string | null;
  requiresFullVerification: true;
};
export type MaterialSummary = {
  productId: string; revision: string; title: string; productName?: string;
  connectKind: string; status: string; ready: boolean; blockers: string[];
  score: number | null; imageCount: number; approvedAt: string | null;
  verification?: MaterialSummaryVerification;
  preparationDiagnostics?: { nextAction?: { instruction: string }; missingBodyImages?: number; thumbnailRequired?: boolean };
};
export type MaterialSummaryJob = {
  jobId: string; kind: string; status: string; startedAt: string;
  sourceJobId?: string; connectKind?: string;
  items: Array<{ productId: string; status: string; stage: string; error?: string; errorCode?: string; scheduledDate?: string }>;
};
export type MaterialSummaryCandidate = {
  productId: string; productName: string | null; reason: string; errorCode?: string; connectKind?: string;
};
export type MaterialSummarySnapshot = {
  materials: MaterialSummary[]; jobs: MaterialSummaryJob[];
  failedCandidates?: MaterialSummaryCandidate[]; failedCandidateCount?: number;
  repairCandidates?: MaterialSummaryCandidate[]; repairCandidateCount?: number;
  readinessObservedAt?: string;
};
type Subscriber = { onData: (data: MaterialSummarySnapshot) => void; onError?: (error: unknown) => void };

/** One renderer-wide, metadata-only feed. Approval/publication never use this store. */
export function createMaterialSummaryStore(options: {
  fetch: typeof fetch;
  visibility: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  desktopVisibility?: Pick<Window, "addEventListener" | "removeEventListener"> & { __brandconnectMaterialUiVisible?: boolean };
  requireDesktopVisibility?: boolean;
}) {
  const subscribers = new Set<Subscriber>();
  let current: MaterialSummarySnapshot | undefined;
  let signature = "";
  let polling: ReturnType<typeof startMaterialPolling> | undefined;
  const poll = async (signal: AbortSignal) => {
    const response = await options.fetch("/api/materials?summary=1", { cache: "no-store", signal });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "소재 목록을 읽지 못했습니다.");
    if (signal.aborted) return false;
    const data = result.data as MaterialSummarySnapshot;
    // Observation time changes on each GET; unchanged content must not rerender every row.
    const nextSignature = JSON.stringify({ ...data, readinessObservedAt: undefined,
      materials: data.materials.map(material => ({ ...material, verification: material.verification
        ? { ...material.verification, observedAt: undefined } : undefined })) });
    current = data;
    if (signature !== nextSignature) {
      signature = nextSignature;
      for (const subscriber of subscribers) subscriber.onData(data);
    }
    return data.jobs.some(job => ["running", "queued"].includes(job.status)) ||
      data.materials.some(material => ["PREPARING", "PUBLISHING"].includes(material.status));
  };
  return {
    subscribe(subscriber: Subscriber) {
      subscribers.add(subscriber);
      if (current) {
        const snapshot = current;
        void Promise.resolve().then(() => { if (subscribers.has(subscriber)) subscriber.onData(snapshot); });
      }
      polling ??= startMaterialPolling({ ...options, poll, activeIntervalMs: 5000, idleIntervalMs: 60_000,
        onError: error => { for (const listener of subscribers) listener.onError?.(error); } });
      return () => {
        subscribers.delete(subscriber);
        if (!subscribers.size) { polling?.stop(); polling = undefined; }
      };
    },
    refresh() { return polling?.refresh() ?? Promise.resolve(); },
  };
}

let rendererStore: ReturnType<typeof createMaterialSummaryStore> | undefined;
export function getMaterialSummaryStore() {
  return rendererStore ??= createMaterialSummaryStore({ fetch: (...args) => fetch(...args), visibility: document,
    desktopVisibility: window, requireDesktopVisibility: /Electron\//u.test(navigator.userAgent) });
}
