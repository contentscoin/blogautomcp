import { startMaterialPolling } from "./material-polling";

/** Progress reads contain no photos. Read the full preview once after running work ends. */
export function startDraftImageProgressPolling<T extends { imageGeneration?: { status?: string } | null }>(options: {
  productId: string;
  wasRunning: boolean;
  waitForOwningRequest?: boolean;
  fetch: typeof fetch;
  visibility: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  desktopVisibility?: Pick<Window, "addEventListener" | "removeEventListener"> & { __brandconnectMaterialUiVisible?: boolean };
  requireDesktopVisibility?: boolean;
  onPreview: (preview: T) => void;
  onProgress?: (progress: NonNullable<T["imageGeneration"]>) => void;
}) {
  let sawRunning = options.wasRunning;
  let completed = false;
  return startMaterialPolling({ ...options, activeIntervalMs: 3000, idleIntervalMs: 3000,
    poll: async signal => {
      if (completed) return false;
      const url = `/api/brandlinks/${encodeURIComponent(options.productId)}/draft`;
      const response = await options.fetch(`${url}?progressOnly=1`, { cache: "no-store", signal });
      const result = await response.json();
      if (signal.aborted) return false;
      if (!response.ok || !result.success || !result.data?.progressOnly) throw new Error(result.error || "이미지 진행 상태를 읽지 못했습니다.");
      const progress = result.data.imageGeneration as T["imageGeneration"];
      if (progress?.status === "running") {
        sawRunning = true; options.onProgress?.(progress);
        return true;
      }
      // An in-flight image action returns its own final preview. If that request
      // loses its response, the caller clears the action and starts a fresh read.
      if (sawRunning && !options.waitForOwningRequest) {
        const previewResponse = await options.fetch(url, { cache: "no-store", signal });
        const preview = await previewResponse.json();
        if (signal.aborted) return false;
        if (!previewResponse.ok || !preview.success || !preview.data) throw new Error(preview.error || "완료된 이미지 결과를 읽지 못했습니다.");
        completed = true;
        options.onPreview(preview.data as T);
      } else if (sawRunning) {
        completed = true;
      }
      return false;
    } });
}
