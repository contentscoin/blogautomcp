import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import crypto from "node:crypto";
import { getWritingTimeoutPolicy, writingTimeoutMs } from "./writing-timeout-policy";
import { resolveCodexTextModel, resolveTextReasoningEffort } from "./text-model-policy";
import { isCodexStreamCompletionLoss, isCodexUsageLimitMessage } from "../../src/lib/local-automation-error";

type CodexSdkModule = typeof import("@openai/codex-sdk");

export type CodexDraftFailureKind =
  | "authentication"
  | "model-version"
  | "timeout"
  | "retryable-transient"
  | "usage-limit"
  | "non-retryable";

export type CodexDraftTerminalFailureCode =
  | "CODEX_OUTPUT_SCHEMA_INVALID"
  | "CODEX_AUTH_REQUIRED"
  | "CODEX_MODEL_INCOMPATIBLE"
  | "CODEX_TIMEOUT"
  | "CODEX_TRANSIENT_FAILURE"
  | "CODEX_USAGE_LIMIT_REACHED";

export interface CodexUsageLimitDetails {
  retryAfterSeconds?: number;
  resetAt?: string;
  /** Preserve a provider's local-date hint without guessing its year or time zone. */
  resetHint?: string;
}

interface CodexDraftRetryOptions {
  /** Test hook. Production retries use a short backoff. */
  retryDelayMs?: number;
  canRetry?: () => boolean;
  onRetry?: (error: unknown) => void;
}

export interface CodexDraftOptions {
  systemPrompt: string;
  userPrompt: string;
  imagePaths?: string[];
  /** Server-reviewed publication original. It is always attachment 1 and exact bytes are checked before every provider attempt. */
  publicationPhotoInput?: { path: string; sha256: string };
  /** Override the conservative writing default for bounded image-review batches. */
  maxImages?: number;
  /** Keep numbered image-review candidates in caller order. */
  preserveImageOrder?: boolean;
  timeoutMs?: number;
  /** A bounded independent observer must not start a second provider turn. */
  noTransientRetry?: boolean;
  model?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  researchMode?: "disabled" | "cached" | "live";
  /** 웹 리서치 대상. 기본은 여행(기존 동작). 쇼핑은 같은 모델의 공식 정보 확인에만 쓴다. */
  researchScope?: "TRAVEL" | "SHOPPING";
  /** JSON schema for the final answer (Codex structured output). The answer is still returned as text. */
  outputSchema?: unknown;
  onProgress?: (message: string) => void;
}
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<CodexSdkModule>;

function errorChain(error: unknown): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  while (pending.length > 0 && records.length < 12) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;
    records.push(record);
    pending.push(record.cause, record.error, record.response);
  }
  return records;
}

function codexFailureEvidence(error: unknown): { message: string; messages: string[]; statuses: number[]; codes: string[]; names: string[] } {
  const records = errorChain(error);
  const messages = [error instanceof Error ? error.message : String(error)];
  const statuses: number[] = [];
  const codes: string[] = [];
  const names: string[] = [];
  for (const record of records) {
    if (typeof record.message === "string") messages.push(record.message);
    for (const value of [record.status, record.statusCode]) {
      const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      if (Number.isInteger(numeric)) statuses.push(numeric);
    }
    if (typeof record.code === "string") codes.push(record.code.toUpperCase());
    if (typeof record.type === "string") codes.push(record.type.toUpperCase());
    if (typeof record.name === "string") names.push(record.name);
  }
  return {
    message: Array.from(new Set(messages)).join(" ").replace(/["']/gu, ""),
    messages,
    statuses,
    codes,
    names,
  };
}

/** Retain bounded provider timing data; a date without a time zone is never invented. */
export function codexUsageLimitDetails(error: unknown): CodexUsageLimitDetails {
  const details: CodexUsageLimitDetails = {};
  for (const record of errorChain(error)) {
    const headers = record.headers as { get?: (name: string) => unknown; [key: string]: unknown } | undefined;
    let retryHeader: unknown;
    try { retryHeader = typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"] ?? headers?.["Retry-After"]; } catch { /* Timing metadata cannot hide the provider error. */ }
    const retry = record.retryAfterSeconds ?? record.retry_after_seconds ?? record.retryAfter ?? record.retry_after ?? retryHeader;
    const seconds = typeof retry === "number" || typeof retry === "string" && /^\d+(?:\.\d+)?$/u.test(retry) ? Number(retry) : NaN;
    if (details.retryAfterSeconds === undefined && Number.isFinite(seconds) && seconds >= 0 && seconds <= 366 * 86400) details.retryAfterSeconds = seconds;
    const reset = record.resetAt ?? record.reset_at ?? record.resetsAt ?? record.resets_at;
    if (!details.resetAt && typeof reset === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(reset) && Number.isFinite(Date.parse(reset))) details.resetAt = new Date(reset).toISOString();
    const message = typeof record.message === "string" ? record.message : "";
    const hint = message.match(/\btry again at\s+([^\r\n]{1,160})/iu)?.[1]?.trim();
    if (!details.resetHint && hint) details.resetHint = hint;
  }
  return details;
}

function messageHttpStatuses(message: string): number[] {
  const statuses: number[] = [];
  const collect = (pattern: RegExp): void => {
    for (const match of message.matchAll(pattern)) statuses.push(Number(match[1]));
  };
  collect(/(?:^|[\s,{])(?:http(?:\s+status)?|status(?:code)?|"status")\s*[:=]?\s*(401|403|429|5\d{2})\b/giu);
  collect(/\b(5\d{2})\b[^\n]{0,80}\b(?:gateway\s+timeout|internal\s+server\s+error|service\s+unavailable|server\s+error)\b/giu);
  collect(/\b(?:gateway\s+timeout|internal\s+server\s+error|service\s+unavailable|server\s+error)\b[^\n]{0,80}?\(?\s*(5\d{2})\b/giu);
  collect(/\b(429)\b[^\n]{0,80}\b(?:too many requests|rate limit(?:ed|ing)?)\b/giu);
  return [...new Set(statuses.filter(Number.isInteger))];
}

/** Classifies only strong provider/runtime signals; arbitrary prompt text is never inspected here. */
export function classifyCodexDraftFailure(error: unknown): CodexDraftFailureKind {
  const evidence = codexFailureEvidence(error);
  const normalized = evidence.message.toLowerCase();
  const statuses = [...evidence.statuses, ...messageHttpStatuses(evidence.message)];

  // Explicit terminal codes from any cause outrank text in an outer wrapper.
  if (evidence.codes.includes("CODEX_TIMEOUT")) return "timeout";
  if (evidence.codes.includes("CODEX_MODEL_INCOMPATIBLE")) return "model-version";
  if (evidence.codes.includes("CODEX_AUTH_REQUIRED")) return "authentication";
  if (evidence.codes.some((code) => /^(?:CODEX_USAGE_LIMIT_REACHED|USAGE_LIMIT_REACHED|USAGE_LIMIT_EXCEEDED|INSUFFICIENT_QUOTA|QUOTA_EXCEEDED)$/u.test(code)) || evidence.messages.some(isCodexUsageLimitMessage)) return "usage-limit";

  if (
    evidence.names.some((name) => name === "AbortError")
    || evidence.codes.some((code) => code === "ETIMEDOUT" || code === "ABORT_ERR")
  ) return "timeout";

  if (
    /requires?\s+(?:a\s+)?newer\s+version\s+of\s+codex/iu.test(normalized)
    || /\b(?:unsupported|unavailable)\s+model\b|\bmodel\b[^.\n]{0,80}\b(?:not found|not supported|not available)\b/iu.test(normalized)
    || /invalid_request_error[^.\n]{0,160}\bmodel\b/iu.test(normalized)
  ) return "model-version";

  if (
    statuses.some((status) => status === 401 || status === 403)
    || evidence.codes.some((code) => /^(?:AUTH(?:ENTICATION)?_REQUIRED|UNAUTHORIZED|INVALID_API_KEY)$/u.test(code))
    || /\b(?:authentication required|login required|not logged in|unauthorized|invalid api key)\b/iu.test(normalized)
  ) return "authentication";

  if (
    statuses.some((status) => status === 429 || (status >= 500 && status <= 599))
    || evidence.codes.some((code) => code === "ECONNRESET")
    || /\beconnreset\b/iu.test(normalized)
    || evidence.codes.includes("CODEX_TRANSIENT_FAILURE")
    || evidence.messages.some(isCodexStreamCompletionLoss)
  ) return "retryable-transient";

  if (/\b(?:timed?\s*out|timeout)\b|시간[^.\n]{0,30}초과/iu.test(normalized)) return "timeout";

  return "non-retryable";
}

/** Stable public code for a terminal provider failure. */
export function codexDraftTerminalFailureCode(error: unknown): CodexDraftTerminalFailureCode | null {
  if (errorChain(error).some(record => record.code === "CODEX_OUTPUT_SCHEMA_INVALID")) return "CODEX_OUTPUT_SCHEMA_INVALID";
  // The classifier gives definitive nested codes precedence over a transient wrapper.
  const kind = classifyCodexDraftFailure(error);
  if (kind === "authentication") return "CODEX_AUTH_REQUIRED";
  if (kind === "model-version") return "CODEX_MODEL_INCOMPATIBLE";
  if (kind === "timeout") return "CODEX_TIMEOUT";
  if (kind === "retryable-transient") return "CODEX_TRANSIENT_FAILURE";
  if (kind === "usage-limit") return "CODEX_USAGE_LIMIT_REACHED";
  return null;
}

/** For mixed API error boundaries, do not infer a provider failure from arbitrary input text. */
export function codexDraftStructuredFailureCode(error: unknown): CodexDraftTerminalFailureCode | null {
  const hasProviderCode = errorChain(error).some((record) =>
    typeof record.code === "string"
    && /^(?:CODEX_OUTPUT_SCHEMA_INVALID|CODEX_AUTH_REQUIRED|CODEX_MODEL_INCOMPATIBLE|CODEX_TIMEOUT|CODEX_TRANSIENT_FAILURE|CODEX_USAGE_LIMIT_REACHED)$/u.test(record.code.toUpperCase()));
  return hasProviderCode ? codexDraftTerminalFailureCode(error) : null;
}

function terminalCodexDraftError(
  error: unknown,
  forcedCode?: CodexDraftTerminalFailureCode,
  forcedMessage?: string,
): Error {
  const code = forcedCode || codexDraftTerminalFailureCode(error);
  const original = error instanceof Error ? error : new Error(String(error));
  if (!code) return original;
  if (code === "CODEX_USAGE_LIMIT_REACHED") {
    const details = codexUsageLimitDetails(error);
    if ((original as Error & { code?: string }).code === code && !forcedMessage) return Object.assign(original, details);
    return Object.assign(new Error(forcedMessage || original.message, { cause: error }), { code, ...details });
  }
  if ((original as Error & { code?: string }).code === code && !forcedMessage) return original;
  return Object.assign(new Error(forcedMessage || original.message, { cause: error }), { code });
}

/** Run the same Codex operation at most twice. It never invokes a browser fallback. */
export async function runCodexDraftWithRetry<T>(
  operation: () => Promise<T>,
  options: CodexDraftRetryOptions = {},
): Promise<T> {
  const retryDelayMs = options.retryDelayMs === undefined
    ? 500
    : Math.max(0, Math.min(options.retryDelayMs, 5_000));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const failureKind = classifyCodexDraftFailure(error);
      const mayRetry = attempt === 0
        && failureKind === "retryable-transient"
        && options.canRetry?.() !== false;
      if (!mayRetry) throw terminalCodexDraftError(error);
      options.onRetry?.(error);
      if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error("Codex retry loop ended unexpectedly.");
}

/** These exact exec progress events describe the SAME still-running SDK turn.
 * Generic errors, terminal failures and an unknown stream end stay failures. */
function isCodexDraftReconnectProgress(message: string): boolean {
  const progress = /^Reconnecting\.\.\. ([1-9]\d*)\/([1-9]\d*) \(([^\r\n]+)\)$/u.exec(message);
  if (!progress) return false;
  const attempt = Number(progress[1]), maximum = Number(progress[2]);
  if (!Number.isSafeInteger(attempt) || !Number.isSafeInteger(maximum) || attempt > maximum) return false;
  return isCodexStreamCompletionLoss(message) || maximum === 5 &&
    /^We[’']re currently experiencing high demand, which may cause temporary errors\.$/u.test(progress[3]);
}

/** Exec may emit its internal reconnect progress as a top-level error while the turn still runs. */
export async function collectCodexDraftResponse(
  events: AsyncIterable<import("@openai/codex-sdk").ThreadEvent>,
  onProgress?: (message: string) => void,
): Promise<string> {
  let finalResponse = "";
  let completed = false;
  let reconnectError: Error | undefined;
  for await (const event of events) {
    if (event.type === "item.completed" && event.item.type === "agent_message") {
      finalResponse = event.item.text.trim() || finalResponse;
      onProgress?.("Codex 원고 응답 수신");
    } else if (event.type === "turn.completed") {
      completed = true;
    } else if (event.type === "turn.failed") {
      throw new Error(event.error.message || "Codex 원고 작성이 실패했습니다.");
    } else if (event.type === "error") {
      const message = event.message || "Codex 실행 중 오류가 발생했습니다.";
      if (isCodexDraftReconnectProgress(message)) {
        reconnectError = new Error(message);
        const notice = `Codex 내부 연결 복구 중 · 현재 요청의 완료를 기다립니다. ${message}`;
        if (onProgress) onProgress(notice);
        else console.warn(notice);
        continue;
      }
      throw new Error(message);
    }
  }
  if (!completed) throw reconnectError || new Error("Codex 스트림이 turn.completed 없이 종료되었습니다.");
  if (!finalResponse) throw new Error("Codex 응답에서 원고 본문을 찾지 못했습니다.");
  return finalResponse;
}

function readableImages(imagePaths: string[], requestedMaximum = 4, preserveOrder = false): string[] {
  const maximum = Math.max(1, Math.min(16, Math.floor(requestedMaximum) || 4));
  const readable = Array.from(new Set(imagePaths.map((item) => path.resolve(item))))
    .filter((item) => {
      try {
        return fs.statSync(item).isFile();
      } catch {
        return false;
      }
    });
  if (preserveOrder) return readable.slice(0, maximum);
  const detailImages = readable.filter((item) => /(?:^|[_-])detail(?:[_-]|$)/iu.test(path.basename(item)));
  const regularImages = readable.filter((item) => !detailImages.includes(item));
  return Array.from(new Set([
    ...detailImages.slice(0, 2),
    ...regularImages.slice(0, 2),
    ...detailImages.slice(2),
    ...regularImages.slice(2),
  ])).slice(0, maximum);
}

/** Keep the actual publication original distinct from seller artwork supplied only for source reading. */
export function resolveCodexWritingImages(options: Pick<CodexDraftOptions, "imagePaths" | "maxImages" | "preserveImageOrder" | "publicationPhotoInput">): string[] {
  const images = readableImages(options.imagePaths ?? [], options.maxImages, options.preserveImageOrder);
  const original = options.publicationPhotoInput;
  if (!original) return images;
  const file = path.resolve(original.path);
  let valid = false;
  try {
    const real = path.resolve(fs.realpathSync(file));
    const canonicalMatch = process.platform === "win32" ? real.toLowerCase() === file.toLowerCase() : real === file;
    valid = /^[a-f0-9]{64}$/u.test(original.sha256) && fs.statSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink() &&
      canonicalMatch && crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") === original.sha256;
  } catch { /* Missing, linked or changed originals cannot authorize a writer request. */ }
  if (!valid)
    throw new Error("PREWRITING_PHOTO_CHANGED: 작성에 전달할 검증 원본이 검사 후 바뀌었습니다. 원고 요청을 보내지 않았습니다.");
  const maximum = Math.max(1, Math.min(16, Math.floor(options.maxImages || 4)));
  return [file, ...images.filter(image => process.platform === "win32" ? image.toLowerCase() !== file.toLowerCase() : image !== file)].slice(0, maximum);
}

export function codexWritingImageRoles(images: string[], original?: CodexDraftOptions["publicationPhotoInput"]): string {
  if (!original) return "";
  return ["[실제 첨부 이미지 역할 · 서버가 이 순서로 전달한 파일]",
    ...images.map((file, index) => index === 0 && file === path.resolve(original.path)
      ? `첨부 ${index + 1}: 작성 전 검사한 실제 본문 원본 사진. SHA256=${original.sha256}. 눈에 보이는 외형만 묘사하고 숨겨진 기능·구성·수량은 사진으로 인증하지 마세요.`
      : `첨부 ${index + 1}: 판매자 상세 근거 읽기용 이미지. 본문에 게시할 사진이 아닙니다. 설명판의 배치·광고·콜라주를 최종 사진 모습이라고 서술하지 마세요.`),
    "아직 생성하지 않은 연출 사진은 첨부되지 않았습니다. 계획이나 imageIntent를 실제 촬영 장면처럼 묘사하지 마세요."]
    .join("\n");
}

function buildWritingPrompt(
  systemPrompt: string,
  userPrompt: string,
  researchMode: NonNullable<CodexDraftOptions["researchMode"]>,
  researchScope: NonNullable<CodexDraftOptions["researchScope"]> = "TRAVEL",
): string {
  const shopping = researchScope === "SHOPPING";
  return [
    "당신은 BlogAutoMCP의 한국어 블로그 원고 작성 엔진입니다.",
    "원고 작성에는 Opus-Fable 스킬과 개발·배포 검증 절차를 적용하지 마세요. 전역 AGENTS.md의 해당 지침 대신 아래 원고 작성 지시와 품질 기준만 따르세요.",
    researchMode === "disabled"
      ? "이 작업은 글쓰기 전용입니다. 명령 실행, 코드 수정, 파일 생성, MCP 호출, 웹 검색을 하지 마세요."
      : shopping
        ? "이 작업은 상품 리서치와 글쓰기 전용입니다. 명령 실행, 코드 수정, 파일 생성, MCP 호출은 하지 말고 웹 검색은 이 상품의 사실 확인에만 사용하세요."
        : "이 작업은 여행 리서치와 글쓰기 전용입니다. 명령 실행, 코드 수정, 파일 생성, MCP 호출은 하지 말고 웹 검색은 여행지 사실 확인에만 사용하세요.",
    researchMode === "disabled"
      ? "제공된 자료와 첨부 이미지 안에서만 사실을 판단하고, 지시에 지정된 최종 형식만 반환하세요."
      : shopping
        ? "같은 브랜드·같은 모델명의 공식몰·제조사 자료로 사양·구성·사용법·관리법을 교차 확인하세요. 모델명이 다르거나 불확실한 자료, 다른 옵션·다른 상품의 정보는 섞지 마세요. 가격·할인·재고·후기 수는 검색으로 바꾸지 마세요. 검색 출처나 URL은 원고에 노출하지 말고 확인된 사실만 반영하세요."
        : "상품 일정에 등장하는 여행지와 이 여행에 필요한 준비 정보(입국 서류, 공항↔시내 교통, 환전·결제, 유심·eSIM, 시기별 날씨)만 공식 관광청·공공기관·신뢰할 수 있는 여행 자료로 교차 확인하세요. 변동이 큰 요금·운영시간은 확인되지 않으면 쓰지 마세요. 검색 출처나 URL은 최종 원고에 노출하지 말고 확인된 사실만 반영하세요.",
    "첨부 이미지는 제품 또는 여행 상품의 시각적 근거로만 사용하며 보이지 않는 성능이나 체험을 추정하지 마세요.",
    "",
    "[시스템 지시사항]",
    systemPrompt,
    "",
    "[사용자 요청]",
    userPrompt,
  ].join("\n");
}

/** Reject the two observed API-incompatible constructs before any SDK call.
 * This is a portability check, not a replacement for response validation. */
export function assertCodexOutputSchemaCompatible(schema: unknown): void {
  const fail = (at: string, reason: string): never => {
    throw Object.assign(new Error(`CODEX_OUTPUT_SCHEMA_INVALID: ${at}: ${reason}`), { code: "CODEX_OUTPUT_SCHEMA_INVALID" });
  };
  const visit = (value: unknown, at: string): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const row = value as Record<string, unknown>;
    if (Array.isArray(row.enum) && row.enum.some(v => v !== null && typeof v === "object")) fail(at, "use scalar enum values; bind array coordinates in the response reader");
    if (typeof row.pattern === "string") {
      if (/\\[pP]\{/u.test(row.pattern)) fail(at, "Unicode property escapes are not portable to the remote regex validator");
      try { new RegExp(row.pattern); } catch { fail(at, "invalid portable regex"); }
    }
    for (const key of ["properties", "$defs", "definitions"]) {
      const children = row[key];
      if (children && typeof children === "object") for (const [name, child] of Object.entries(children)) visit(child, `${at}.${key}.${name}`);
    }
    if (row.items) visit(row.items, `${at}.items`);
    for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(row[key])) (row[key] as unknown[]).forEach((child, index) => visit(child, `${at}.${key}[${index}]`));
  };
  visit(schema, "schema");
}

export async function runCodexDraft(options: CodexDraftOptions): Promise<string> {
  if (options.outputSchema) assertCodexOutputSchemaCompatible(options.outputSchema);
  const images = resolveCodexWritingImages(options);
  const model = resolveCodexTextModel(options.model);
  const reasoningEffort = resolveTextReasoningEffort(options.reasoningEffort);
  const { Codex } = await nativeImport("@openai/codex-sdk");
  const timeoutMs = writingTimeoutMs(options.timeoutMs, getWritingTimeoutPolicy().codexMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const workingDirectory = path.join(os.tmpdir(), "blogautomcp-codex-drafts");
  fs.mkdirSync(workingDirectory, { recursive: true });

  const researchMode = options.researchMode ?? "disabled";
  const codex = new Codex({
    config: {
      project_doc_max_bytes: 0,
      skills: {
        config: [{
          path: path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills", "opus-fable", "SKILL.md"),
          enabled: false,
        }],
      },
    },
    configOverrides: ['plugins."opus-fable-performance@local-opencrab".enabled=false'],
  });
  const prompt = [buildWritingPrompt(options.systemPrompt, options.userPrompt, researchMode, options.researchScope),
    codexWritingImageRoles(images, options.publicationPhotoInput)].filter(Boolean).join("\n\n");
  const input = images.length > 0
    ? [
        { type: "text" as const, text: prompt },
        ...images.map((imagePath) => ({ type: "local_image" as const, path: imagePath })),
      ]
    : prompt;

  try {
    options.onProgress?.(`Codex 원고 작성 시작${images.length ? ` · 이미지 ${images.length}장` : ""}`);
    return await runCodexDraftWithRetry(async () => {
      resolveCodexWritingImages(options); // A provider reconnect must not carry an original changed after input preparation.
      const thread = codex.startThread({
        // Every Codex writer, reviewer and vision helper uses the same approved model.
        model,
        modelReasoningEffort: reasoningEffort,
        sandboxMode: "read-only",
        workingDirectory,
        skipGitRepoCheck: true,
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: researchMode,
        threadSource: "blogautomcp-draft",
      });
      const { events } = await thread.runStreamed(input, {
        signal: controller.signal,
        ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
      });
      return collectCodexDraftResponse(events, options.onProgress);
    }, {
      canRetry: () => options.noTransientRetry !== true && !controller.signal.aborted,
      onRetry: () => options.onProgress?.("Codex 일시 오류 감지 · 동일 Codex 경로로 1회 재시도"),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw terminalCodexDraftError(
        error,
        "CODEX_TIMEOUT",
        `Codex 원고 작성 시간이 ${Math.round(timeoutMs / 1000)}초를 초과했습니다.`,
      );
    }
    throw terminalCodexDraftError(error);
  } finally {
    clearTimeout(timeout);
  }
}
