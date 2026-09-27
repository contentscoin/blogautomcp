import draftRuntimePolicy from "./draft-runtime-policy.json";

/**
 * Codex authenticated with a ChatGPT account must use the account-supported
 * default unless a separately verified Codex model is configured.
 */
export const CODEX_TEXT_MODEL = normalizeCodexTextModel(draftRuntimePolicy.CODEX_DRAFT_MODEL);

function normalizeCodexTextModel(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === "default") return undefined;
  return normalized;
}

/** Codex SDK model policy. Undefined intentionally omits the startThread model field. */
export function resolveCodexTextModel(requested?: string): string | undefined {
  const normalized = normalizeCodexTextModel(requested);
  if (!CODEX_TEXT_MODEL) {
    if (!normalized) return undefined;
    throw new Error("TEXT_MODEL_POLICY: ChatGPT 계정 Codex는 계정 기본 모델을 사용합니다.");
  }
  if (normalized && normalized !== CODEX_TEXT_MODEL) {
    throw new Error(`TEXT_MODEL_POLICY: Codex 자동 작성 모델은 ${CODEX_TEXT_MODEL}로 고정되어 있습니다.`);
  }
  return CODEX_TEXT_MODEL;
}

export type TextReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Fixed default effort for Codex writing, review and vision calls. */
export const TEXT_REASONING_EFFORT = draftRuntimePolicy.CODEX_DRAFT_REASONING_EFFORT as TextReasoningEffort;

export function resolveTextReasoningEffort(requested?: string): TextReasoningEffort {
  const effort = requested?.trim() || TEXT_REASONING_EFFORT;
  if (effort !== "low" && effort !== "medium" && effort !== "high" && effort !== "xhigh" && effort !== "max") {
    throw new Error("TEXT_MODEL_POLICY: 지원하지 않는 reasoning effort입니다.");
  }
  return effort;
}
