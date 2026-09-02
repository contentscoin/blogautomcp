/**
 * 로컬 자동화(데스크톱) 실패 분류.
 *
 * 예전에는 MCP 작업 실패가 전부 LOCAL_AUTOMATION_FAILED 한 가지로 올라가서 ChatGPT가
 * "네이버 로그인을 다시 하세요"와 "상품이 없습니다"를 구분해 안내할 수 없었다.
 * 로컬 API 응답(HTTP 상태·코드·메시지)을 아래 코드로 정규화해 사이트에 전달한다.
 */

export const LOCAL_AUTOMATION_ERROR_CODES = [
  "NAVER_SESSION_EXPIRED",
  "PRODUCT_NOT_FOUND",
  "CONNECT_KIND_MISMATCH",
  "CONTENT_BLOCKED",
  "IMAGE_SHORTFALL",
  "LLM_UNAVAILABLE",
  "EDITOR_FAILED",
  "UPDATE_PENDING",
  "TRAVEL_CONTRACT_LOCKED",
  "DRAFT_NOT_FOUND",
  "DRAFT_NOT_APPROVED",
  "ALREADY_PUBLISHING",
  "INVALID_INPUT",
  "USER_CANCELLED",
  "TIMEOUT",
  "LOCAL_API_MISSING",
  "LOCAL_AUTOMATION_FAILED",
] as const;

export type LocalAutomationErrorCode = (typeof LOCAL_AUTOMATION_ERROR_CODES)[number];

const CODE_SET = new Set<string>(LOCAL_AUTOMATION_ERROR_CODES);

export function isLocalAutomationErrorCode(value: unknown): value is LocalAutomationErrorCode {
  return typeof value === "string" && CODE_SET.has(value);
}

export class LocalAutomationError extends Error {
  readonly code: LocalAutomationErrorCode;
  readonly httpStatus: number | null;
  readonly detail: unknown;

  constructor(code: LocalAutomationErrorCode, message: string, options: { httpStatus?: number | null; detail?: unknown } = {}) {
    super(message);
    this.name = "LocalAutomationError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.detail = options.detail;
  }
}

/** 사용자에게 보여줄 코드별 기본 안내. 메시지가 비어 있을 때만 쓴다. */
export const LOCAL_AUTOMATION_ERROR_HINTS: Record<LocalAutomationErrorCode, string> = {
  NAVER_SESSION_EXPIRED: "네이버 로그인 세션이 만료되었습니다. PC 앱에서 네이버 로그인을 다시 진행하세요.",
  PRODUCT_NOT_FOUND: "상품(초안 대상)을 찾을 수 없습니다. brandconnect_list_products 로 ID를 다시 확인하세요.",
  CONNECT_KIND_MISMATCH: "상품의 커넥트 종류(쇼핑/여행)가 요청과 다릅니다.",
  CONTENT_BLOCKED: "생성된 글이 발행 기준(네이버 정책·근거 규칙)을 통과하지 못해 발행을 보류했습니다.",
  IMAGE_SHORTFALL: "본문에 넣을 이미지가 부족합니다. 상품 이미지를 다시 동기화하거나 다른 상품을 선택하세요.",
  LLM_UNAVAILABLE: "OpenAI API 키가 없거나 호출에 실패했습니다. PC 앱 설정에서 키를 확인하세요.",
  EDITOR_FAILED: "네이버 에디터 자동화 단계에서 실패했습니다. PC 앱 로그를 확인하세요.",
  UPDATE_PENDING: "PC 앱이 업데이트 설치를 앞두고 있어 새 작업을 시작할 수 없습니다. 재시작 후 다시 시도하세요.",
  TRAVEL_CONTRACT_LOCKED: "여행커넥트 목록 계약이 아직 캡처되지 않았습니다. travel_capture_contract 를 먼저 실행하세요.",
  DRAFT_NOT_FOUND: "초안이 없습니다. post_create_draft 로 먼저 초안을 만드세요.",
  DRAFT_NOT_APPROVED: "초안이 아직 승인되지 않았습니다. post_get_draft 로 검토한 뒤 post_approve_draft 를 호출하세요.",
  ALREADY_PUBLISHING: "이미 발행이 진행 중입니다. 완료 후 다시 시도하세요.",
  INVALID_INPUT: "요청 인자가 올바르지 않습니다.",
  USER_CANCELLED: "사용자 요청으로 작업을 취소했습니다.",
  TIMEOUT: "작업이 제한 시간 안에 끝나지 않았습니다.",
  LOCAL_API_MISSING: "이 PC 앱 버전에는 해당 기능이 없습니다. 최신 버전으로 업데이트하세요.",
  LOCAL_AUTOMATION_FAILED: "로컬 자동화 작업이 실패했습니다.",
};

/** 로컬 API 응답 페이로드에서 오류 코드/메시지를 뽑는다. */
export function extractLocalApiError(payload: unknown): { code: string | null; message: string | null } {
  if (!payload || typeof payload !== "object") return { code: null, message: null };
  const record = payload as Record<string, unknown>;
  const topCode = typeof record.code === "string" ? record.code : null;
  const error = record.error;
  if (typeof error === "string") return { code: topCode, message: error };
  if (error && typeof error === "object") {
    const nested = error as Record<string, unknown>;
    return {
      code: typeof nested.code === "string" ? nested.code : topCode,
      message: typeof nested.message === "string" ? nested.message : typeof nested.error === "string" ? nested.error : JSON.stringify(nested),
    };
  }
  return { code: topCode, message: typeof record.message === "string" ? record.message : null };
}

/**
 * HTTP 상태·코드·메시지를 표준 코드로 분류한다. 로컬 라우트가 코드를 직접 주면 그대로 쓰고,
 * 아니면 상태 코드와 메시지 패턴으로 추정한다.
 */
export function classifyLocalFailure(input: { status?: number | null; code?: string | null; message?: string | null; path?: string }): LocalAutomationErrorCode {
  const code = input.code || "";
  const message = input.message || "";
  const status = input.status ?? null;
  if (isLocalAutomationErrorCode(code)) return code;
  if (code === "DESKTOP_UPDATE_PENDING") return "UPDATE_PENDING";
  if (code === "CONNECT_CONTRACT_CAPTURE_REQUIRED") return "TRAVEL_CONTRACT_LOCKED";
  if (/DRAFT_NOT_APPROVED|승인해 주세요|승인되지 않/u.test(message)) return "DRAFT_NOT_APPROVED";
  if (/초안이 없|초안을 먼저|수정할 초안/u.test(message)) return "DRAFT_NOT_FOUND";
  if (/발행이 진행 중|발행 중인 상품/u.test(message)) return "ALREADY_PUBLISHING";
  if (/커넥트 종류/u.test(message)) return "CONNECT_KIND_MISMATCH";
  if (/여행커넥트.*(계약|캡처)|CAPTURE_REQUIRED/u.test(message)) return "TRAVEL_CONTRACT_LOCKED";
  if (status === 401 || /세션.*(만료|없)|로그인을 다시|로그인 세션/u.test(message)) return "NAVER_SESSION_EXPIRED";
  if (/OPENAI_API_KEY|OpenAI API/u.test(message)) return "LLM_UNAVAILABLE";
  if (/이미지 부족|본문 이미지|IMAGE_SHORTFALL/u.test(message)) return "IMAGE_SHORTFALL";
  if (/발행 보류|BLOCKED|게이트|정책/u.test(message)) return "CONTENT_BLOCKED";
  if (status === 404 || /찾을 수 없|상품 정보를 확보/u.test(message)) return "PRODUCT_NOT_FOUND";
  if (status === 503 || /업데이트 설치/u.test(message)) return "UPDATE_PENDING";
  if (status === 400 || status === 422) return "INVALID_INPUT";
  if (/에디터|SmartEditor|업로드 실패|발행 프로세스/u.test(message)) return "EDITOR_FAILED";
  return "LOCAL_AUTOMATION_FAILED";
}

export function toLocalAutomationError(error: unknown, fallback: LocalAutomationErrorCode = "LOCAL_AUTOMATION_FAILED"): LocalAutomationError {
  if (error instanceof LocalAutomationError) return error;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "로컬 작업 실행 실패";
  const code = classifyLocalFailure({ message });
  return new LocalAutomationError(code === "LOCAL_AUTOMATION_FAILED" ? fallback : code, message);
}
