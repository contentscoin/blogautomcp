import type { Page, Request, Response } from "playwright";
import { inspectNaverScheduleSubmissionSignal, isNaverPublishingEndpoint } from "../../src/lib/naver-schedule-submission";

export interface ScheduleSubmissionTracker {
  stop: () => void;
  hasAnyPublishRequest: () => boolean;
  hasConfirmedScheduleRequest: () => boolean;
  getReservationId: () => string | null;
  getRecentEvents: () => string[];
  getPendingResponseCount: () => number;
}

// Only known protocol keys and primitive *types* are retained. Never include response values,
// arbitrary field names, article text, identifiers, cookies, request bodies or URL queries.
const SHAPE_KEYS = ["success", "isSuccess", "result", "data", "error", "errorCode", "code", "message", "reservationId", "reserveId", "logNo", "postId", "status"];
function responseShape(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (typeof value === "boolean") return value;
  if (typeof value !== "object") return typeof value;
  if (Array.isArray(value)) return { type: "array", length: Math.min(value.length, 1000) };
  if (depth >= 3) return "object";
  const record = value as Record<string, unknown>;
  const recognized = SHAPE_KEYS.filter((key) => Object.hasOwn(record, key));
  return {
    type: "object",
    otherKeys: Math.max(0, Object.keys(record).length - recognized.length),
    fields: Object.fromEntries(recognized.map((key) => [key, responseShape(record[key], depth + 1)])),
  };
}

function endpointKind(url: string): string {
  // The operation family is sufficient for triage; the full path may contain a blog ID.
  try {
    return new URL(url).pathname.match(/reservation|reserve|schedule|publish|write|post|save|rabbit/i)?.[0].toLowerCase() || "unknown";
  } catch { return "unknown"; }
}

function safeResponseReadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  // Playwright errors may include a full request URL or response payload. Keep
  // only a bounded, single-line diagnostic so logs remain safe to persist.
  return message.replace(/https?:\/\/[^\s)]+/gi, "<url>").replace(/[\r\n]+/g, " ").slice(0, 240);
}

export function createScheduleSubmissionTracker(
  page: Pick<Page, "on" | "off">,
  targetYmd: string,
  options: { responseBodyTimeoutMs?: number; maxResponseBytes?: number } = {}
): ScheduleSubmissionTracker {
  const responseBodyTimeoutMs = options.responseBodyTimeoutMs ?? 15_000;
  const maxResponseBytes = options.maxResponseBytes ?? 262_144;
  const recentEvents: string[] = [];
  const observedRequests = new WeakSet<Request>();
  const responsesSeen = new WeakSet<Request>();
  const cancelPending = new Set<() => void>();
  let stopped = false;
  let hasRequest = false;
  let reservationId: string | null = null;
  const pushEvent = (entry: Record<string, unknown>) => {
    if (stopped) return;
    const serialized = JSON.stringify(entry);
    recentEvents.push(serialized.length > 1600 ? `${serialized.slice(0, 1600)}[truncated]` : serialized);
    if (recentEvents.length > 20) recentEvents.shift();
  };

  const requestListener = (request: Request) => {
    if (stopped || request.method().toUpperCase() !== "POST" || !isNaverPublishingEndpoint(request.url())) return;
    observedRequests.add(request);
    hasRequest = true;
    const signal = inspectNaverScheduleSubmissionSignal({ url: request.url(), postData: request.postData() || "", status: 0, targetYmd });
    pushEvent({ event: "request", operation: endpointKind(request.url()), schedule: signal.hasScheduleMode, targetDate: signal.hasTargetDate });
  };
  const failedListener = (request: Request) => {
    if (observedRequests.has(request)) pushEvent({ event: "request_failed", operation: endpointKind(request.url()) });
  };

  const responseListener = (response: Response) => {
    const request = response.request();
    // A response whose request started before tracking is not evidence for this submission.
    if (stopped || !observedRequests.has(request) || responsesSeen.has(request)) return;
    responsesSeen.add(request);
    const input = { url: response.url(), postData: request.postData() || "", status: response.status(), targetYmd };
    const base = { event: "response", operation: endpointKind(input.url), http: input.status };
    pushEvent({ ...base, body: "pending" });
    if (cancelPending.size >= 8) {
      pushEvent({ ...base, body: "concurrency_limit" });
      return;
    }
    const declaredLength = Number(response.headers()["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
      pushEvent({ ...base, body: "too_large" });
      return;
    }
    let settled = false;
    const complete = (bodyState: string, body?: unknown, bodyError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cancelPending.delete(cancel);
      if (stopped) return;
      const signal = inspectNaverScheduleSubmissionSignal({ ...input, responseBody: body });
      if (signal.confirmed) reservationId = signal.reservationId;
      pushEvent({
        ...base, body: bodyState,
        schedule: signal.hasScheduleMode, targetDate: signal.hasTargetDate,
        accepted: signal.responseAccepted, idPresent: Boolean(signal.reservationId), confirmed: signal.confirmed,
        shape: bodyState === "json" ? responseShape(body) : undefined,
        ...(bodyError ? { bodyError } : {}),
      });
    };
    const cancel = () => complete("stopped");
    const timer = setTimeout(() => complete("timeout"), responseBodyTimeoutMs);
    cancelPending.add(cancel);
    // Playwright emits response at headers, before the body is complete. Track the pending
    // read explicitly so navigation cannot race an otherwise valid reservation receipt.
    // Start the body read synchronously from the response event. Naver's
    // RabbitWrite response can trigger a navigation immediately; deferring the
    // first CDP read by even one microtask makes Network.getResponseBody lose
    // the resource before Playwright can consume it.
    void (async () => {
      try {
        return await response.text();
      } catch (textError) {
        // Some Chromium responses expose a readable buffer even when the text
        // convenience method rejects (for example after a navigation). Keep a
        // second bounded read before classifying the receipt as unavailable.
        const bodyReader = (response as Response & { body?: () => Promise<Buffer> }).body;
        if (typeof bodyReader !== "function") throw textError;
        const bytes = await bodyReader.call(response);
        return Buffer.from(bytes).toString("utf8");
      }
    })().then((text: string) => {
      if (Buffer.byteLength(text, "utf8") > maxResponseBytes) { complete("too_large"); return; }
      const trimmed = text.trim();
      if (!trimmed) { complete("empty"); return; }
      let body: unknown;
      try { body = JSON.parse(trimmed); }
      catch { complete(trimmed.startsWith("<") ? "html" : "non_json"); return; }
      complete("json", body);
    }, (error: unknown) => complete("unavailable", undefined, safeResponseReadError(error)));
  };

  page.on("request", requestListener);
  page.on("response", responseListener);
  page.on("requestfailed", failedListener);
  return {
    stop: () => {
      stopped = true;
      page.off("request", requestListener);
      page.off("response", responseListener);
      page.off("requestfailed", failedListener);
      for (const cancel of cancelPending) cancel();
    },
    hasAnyPublishRequest: () => hasRequest,
    hasConfirmedScheduleRequest: () => Boolean(reservationId),
    getReservationId: () => reservationId,
    getRecentEvents: () => [...recentEvents],
    getPendingResponseCount: () => cancelPending.size,
  };
}

export async function waitForConfirmedScheduleSubmission(tracker: ScheduleSubmissionTracker | undefined, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!tracker?.hasConfirmedScheduleRequest() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, Math.max(1, deadline - Date.now()))));
  }
  return tracker?.hasConfirmedScheduleRequest() ?? false;
}
