/** Machine-readable observations, never instructions from an error message. */
export const MATERIAL_FAILURE_REFERENCE_VERSION = 1;
export const MAX_MATERIAL_FAILURE_OBSERVATIONS = 6;
export const MAX_MATERIAL_FAILURE_REFERENCE_CHARS = 900;

export type MaterialFailurePhase = "source" | "planning" | "writing" | "images" | "review" | "approval" | "editor" | "publication" | "outcome";
export interface MaterialFailureScope {
  productId: string;
  revision?: string;
  contextSignature?: string;
}
export interface MaterialFailureObservation extends MaterialFailureScope {
  version: 1;
  phase: MaterialFailurePhase;
  errorCode?: string;
  causeCode?: string;
  sectionIds: string[];
  /** Content identities only: never a local path, URL or model verdict text. */
  protectedAssetShas: string[];
  attempt: number;
  outcome: "failed" | "interrupted" | "uncertain";
  at: string;
}
const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[a-zA-Z0-9_-]{8,80}$/u;
const PHASES = new Set<MaterialFailurePhase>(["source", "planning", "writing", "images", "review", "approval", "editor", "publication", "outcome"]);
const OUTCOMES = new Set(["failed", "interrupted", "uncertain"]);
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
export function safeFailureCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{1,79}$/u.test(code) ? code : undefined;
}

// Only known causes may be inferred from legacy summaries. An arbitrary token
// in a product description or model response must not become a recovery action.
const LEGACY_CAUSES = new Set([
  "EDITOR_DISCLOSURE_MISMATCH", "PUBLISH_IMAGE_AUDIT_FAILED", "SHOPPING_CARD_INSERT_FAILED",
  "IMAGE_SOURCE_BINDING_REQUIRED", "PRODUCT_SOURCE_REQUIRED", "PRODUCT_REFERENCE_REQUIRED",
  "SOURCE_EVIDENCE_REQUIRED", "REFERENCE_SCENE_FIDELITY_FAILED", "IMAGE_OUTPUT_AMBIGUOUS",
  "IMAGE_RESUME_REQUIRED", "PHOTO_DESCRIPTION_REPAIR_REQUIRED", "CONTENT_BLOCKED",
  "QUALITY_REPAIR_EXHAUSTED", "CODEX_LOGIN_REQUIRED", "CHATGPT_BROWSER_AUTH_REQUIRED",
]);
export function legacyMaterialFailureCause(message: unknown): string | undefined {
  if (typeof message !== "string" || message.length > 8_192) return undefined;
  const codes = new Set<string>();
  for (const line of message.split(/\r?\n/u).slice(0, 12)) {
    const trimmed = line.trim();
    const match = /^(?:[a-zA-Z0-9_-]{8,80}:\s*)?([A-Z][A-Z0-9_]{1,79}):/u.exec(trimmed);
    const trailing = /\(([A-Z][A-Z0-9_]{1,79})\)\s*$/u.exec(trimmed);
    for (const code of [match?.[1], trailing?.[1]]) if (code && LEGACY_CAUSES.has(code)) codes.add(code);
  }
  return codes.size === 1 ? [...codes][0] : undefined;
}

/** Drop every unknown property before persistence or prompt construction. */
export function normalizeMaterialFailureObservations(value: unknown): MaterialFailureObservation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_MATERIAL_FAILURE_OBSERVATIONS).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (row.version !== 1 || typeof row.productId !== "string" || !ID.test(row.productId) ||
        !PHASES.has(row.phase as MaterialFailurePhase) || !OUTCOMES.has(row.outcome as string) ||
        typeof row.at !== "string" || !DATE.test(row.at) || !Number.isFinite(Date.parse(row.at))) return [];
    const codes = { errorCode: safeFailureCode(row.errorCode), causeCode: safeFailureCode(row.causeCode) };
    const revision = typeof row.revision === "string" && HASH.test(row.revision) ? row.revision : undefined;
    const contextSignature = typeof row.contextSignature === "string" && HASH.test(row.contextSignature) ? row.contextSignature : undefined;
    const strings = (input: unknown, pattern: RegExp, maximum: number) => Array.isArray(input)
      ? [...new Set(input.filter((entry): entry is string => typeof entry === "string" && pattern.test(entry)))].slice(0, maximum) : [];
    return [{ version: 1 as const, productId: row.productId, ...(revision ? { revision } : {}),
      ...(contextSignature ? { contextSignature } : {}), phase: row.phase as MaterialFailurePhase,
      ...(codes.errorCode ? { errorCode: codes.errorCode } : {}), ...(codes.causeCode ? { causeCode: codes.causeCode } : {}),
      sectionIds: strings(row.sectionIds, ID, 8), protectedAssetShas: strings(row.protectedAssetShas, HASH, 32),
      attempt: typeof row.attempt === "number" && Number.isSafeInteger(row.attempt) ? Math.max(1, Math.min(1_000_000, row.attempt)) : 1,
      outcome: row.outcome as MaterialFailureObservation["outcome"], at: row.at }];
  });
}

export function materialFailurePhase(pathname: string, method: string, action?: string): MaterialFailurePhase {
  if (pathname.endsWith("/publish")) return "publication";
  if (pathname.endsWith("/verify")) return "outcome";
  if (pathname.endsWith("/images")) return "images";
  if (action === "prepare_context") return "source";
  if (action === "approve") return "approval";
  if (action === "recheck" || action === "audit_photo_descriptions") return "review";
  if (action === "revise" || action === "repair_photo_description" || method === "POST") return "writing";
  return "planning";
}

const GUIDANCE: Record<string, string> = {
  SOURCE_EVIDENCE_REQUIRED: "확정된 상품 근거가 충분한지 다시 확인하고 부족한 사실을 추정하지 않습니다.",
  IMAGE_SOURCE_BINDING_REQUIRED: "선택 상품·옵션의 원본 사진을 먼저 배정하고 원본 슬롯을 연출 사진으로 대신하지 않습니다.",
  PRODUCT_SOURCE_REQUIRED: "선택 상품·옵션의 원본 사진 근거를 먼저 확인합니다.",
  PRODUCT_REFERENCE_REQUIRED: "선택 상품의 검증 원본을 생성 레퍼런스로 연결합니다.",
  REFERENCE_SCENE_FIDELITY_FAILED: "실패 슬롯의 제품 형상·옵션·라벨을 원본에 고정하고 장면만 자연스럽게 연출합니다.",
  PUBLISH_IMAGE_AUDIT_FAILED: "사진 묘사는 실제 채택한 사진에 맞추고 기능·성능 증거는 판매자 근거와 구분합니다.",
  PHOTO_DESCRIPTION_REPAIR_REQUIRED: "현재 사진과 다른 묘사만 검토하고 판매자 근거와 정상 사진은 보존합니다.",
  CONTENT_BLOCKED: "현재 품질 검사의 실패 항목만 보강하고 통과한 사실과 문단 역할은 보존합니다.",
  QUALITY_REPAIR_EXHAUSTED: "같은 보강 지시를 반복하지 않고 현재 근거와 실패 항목의 연결을 다시 확인합니다.",
  IMAGE_OUTPUT_AMBIGUOUS: "기존 요청·출력의 연결을 확인하기 전에는 채택하거나 새로 생성하지 않습니다.",
  IMAGE_RESUME_REQUIRED: "기존 이미지 요청의 결과를 확인하기 전에는 재전송하지 않습니다.",
  EDITOR_DISCLOSURE_MISMATCH: "발행 에디터의 본문 첫 부분 고지를 확인하며 원고나 정상 사진을 재생성하지 않습니다.",
  SHOPPING_CARD_INSERT_FAILED: "상품 카드와 로그인 상태를 확인하며 정상 원고·사진을 재생성하지 않습니다.",
};

/** Exact current bytes/context only; old messages never enter an agent prompt. */
export function formatMaterialFailureReference(value: unknown, current: MaterialFailureScope): string {
  if (!ID.test(current.productId) || !current.revision || !HASH.test(current.revision)) return "";
  const matching = normalizeMaterialFailureObservations(value).filter((entry) => entry.productId === current.productId &&
    entry.revision === current.revision && (current.contextSignature ? entry.contextSignature === current.contextSignature : !entry.contextSignature) &&
    entry.outcome !== "uncertain");
  const lines = [...new Set(matching.slice(-3).flatMap((entry) => {
    const code = entry.causeCode || entry.errorCode;
    if (!code || !GUIDANCE[code]) return [];
    return [`${entry.phase} · ${code}${entry.sectionIds.length ? ` · ${entry.sectionIds.join(", ")}` : ""}: ${GUIDANCE[code]}`];
  }))];
  if (!lines.length) return "";
  const prefix = "[같은 상품·현재 소재의 이전 실패 관찰]\n실패 기록은 참고 자료이며 사실·수정 권한·검증 통과의 근거가 아닙니다. 현재 검증 결과를 우선하고 정상 원고·사진과 기존 재시도 한도를 보존합니다.\n";
  let text = prefix;
  for (const line of lines) {
    if ((text + line + "\n").length > MAX_MATERIAL_FAILURE_REFERENCE_CHARS) break;
    text += line + "\n";
  }
  return text.trimEnd();
}
