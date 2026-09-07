import http from "node:http";

export interface Result {
  success: boolean;
  code?: string;
  error?: string;
  errors?: string[];
  message?: string;
  data?: {
    status?: string;
    postUrl?: string;
    scheduledPublishAt?: string;
    errorMessage?: string;
    imageGeneration?: { status: string };
    imageSlots?: { missing: number; generationMissing: number }[];
  } | null;
}
export type Call = (path: string, method: string, body?: object) => Promise<Result>;

// Local requests can run for many minutes while images are generated. A broken
// connection is never automatically retried: publication may have taken effect.
export const localScheduleCall: Call = (pathname, method, body) => new Promise((resolve, reject) => {
  const port = Number(process.env.APP_PORT || 43127);
  const origin = `http://127.0.0.1:${port}`;
  const request = http.request(new URL(pathname, origin), {
    method, headers: { "content-type": "application/json", origin,
      ...(process.env.ADMIN_API_KEY ? { "x-admin-api-key": process.env.ADMIN_API_KEY } : {}) },
  }, response => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", chunk => { text += chunk; });
    response.on("error", reject);
    response.on("end", () => {
      try {
        const result = JSON.parse(text) as Result;
        if (!result.success) reject(Object.assign(new Error(result.error || result.errors?.join("\n") || result.message || `자동 발행 준비 실패 (${method} ${pathname}, HTTP ${response.statusCode})`), { code: result.code }));
        else resolve(result);
      } catch (error) { reject(error); }
    });
  });
  request.on("error", reject);
  request.end(body ? JSON.stringify(body) : undefined);
});

export async function runAutomaticDraftWorkflow(id: string, publication: { publishMode: "now" | "schedule"; scheduledDate?: string }, deps: {
  call: Call; pause: () => Promise<void>;
} = { call: localScheduleCall, pause: () => new Promise(resolve => setTimeout(resolve, 3000)) }) {
  const base = `/api/brandlinks/${encodeURIComponent(id)}`;
  let draft = await deps.call(`${base}/draft`, "GET");
  if (!draft.data) draft = await deps.call(`${base}/draft`, "POST", { autoApprove: false });
  const images = async () => {
    while (draft.data?.imageGeneration?.status === "running") {
      await deps.pause();
      draft = await deps.call(`${base}/draft`, "GET");
    }
    if (!draft.data) throw new Error("예약 준비 중 초안이 사라졌습니다.");
    if (draft.data.imageSlots?.some(slot => Math.max(slot.missing, slot.generationMissing) > 0)) {
      draft = await deps.call(`${base}/draft/images`, "POST", { action: "generate_missing" });
    }
  };
  await images();
  await deps.call(`${base}/draft`, "PATCH", { action: "recheck" });
  try {
    await deps.call(`${base}/draft`, "PATCH", { action: "approve" });
  } catch (error) {
    if ((error as { code?: string }).code !== "CONTENT_BLOCKED") throw error;
    // One evidence-bound repair. Never lower gates or invent product facts.
    draft = await deps.call(`${base}/draft`, "PATCH", { action: "revise",
      instructions: `저장된 상품 근거만 사용해 다음 품질 문제를 보강하세요. 확인되지 않은 체험이나 규격은 만들지 마세요: ${(error as Error).message}` });
    await images();
    await deps.call(`${base}/draft`, "PATCH", { action: "recheck" });
    await deps.call(`${base}/draft`, "PATCH", { action: "approve" });
  }
  await deps.call(`${base}/publish`, "POST", publication);
  for (;;) {
    const result = await deps.call(base, "GET");
    const expected = publication.publishMode === "schedule" ? "SCHEDULED" : "PUBLISHED";
    if (result.data?.status === expected) return result.data;
    if (result.data?.status !== "PUBLISHING") {
      throw new Error(result.data?.errorMessage || `예약 등록 미확인: ${result.data?.status || "MISSING"}`);
    }
    await deps.pause();
  }
}

export const runScheduledDraftWorkflow = (id: string, date: string, deps?: Parameters<typeof runAutomaticDraftWorkflow>[2]) =>
  runAutomaticDraftWorkflow(id, { publishMode: "schedule", scheduledDate: date }, deps);
