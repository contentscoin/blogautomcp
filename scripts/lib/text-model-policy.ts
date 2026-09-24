import draftRuntimePolicy from "./draft-runtime-policy.json";

/** One policy for writing, reasoning and vision. Image generation is separate. */
export const TEXT_MODEL = draftRuntimePolicy.CODEX_DRAFT_MODEL;

/** Legacy environment defaults cannot silently select a different model. */
export function resolveTextModel(requested?: string): string {
  if (requested?.trim() && requested.trim() !== TEXT_MODEL) {
    throw new Error(`TEXT_MODEL_POLICY: 자동 작성·분석 모델은 ${TEXT_MODEL}로 고정되어 있습니다.`);
  }
  return TEXT_MODEL;
}

export type TextReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Fixed default effort for Codex writing, review and vision calls. */
export const TEXT_REASONING_EFFORT = draftRuntimePolicy.CODEX_DRAFT_REASONING_EFFORT as TextReasoningEffort;

export function resolveTextReasoningEffort(requested?: string): TextReasoningEffort {
  const effort = requested?.trim() || TEXT_REASONING_EFFORT;
  if (effort !== "low" && effort !== "medium" && effort !== "high" && effort !== "xhigh" && effort !== "max") {
    throw new Error(`TEXT_MODEL_POLICY: ${TEXT_MODEL}에서 지원하지 않는 reasoning effort입니다.`);
  }
  return effort;
}

/**
 * GPT-6 Luna supports low/medium/high/xhigh/max (Codex 0.156 model catalog;
 * there is no "none" level). Every API call uses the lowest level, low.
 * Because low still spends reasoning tokens, small classification/title budgets
 * get 1024 tokens of headroom and longer writing gets 4096. This is a total cap, not a guarantee
 * of visible output; callers still reject length.
 */
export function textCompletionParameters(maxOutputTokens: number, requested?: string) {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("출력 토큰 상한은 양의 정수여야 합니다.");
  }
  const shortOutput = maxOutputTokens <= 1024;
  return {
    model: resolveTextModel(requested),
    reasoning_effort: "low" as const,
    max_completion_tokens: Math.min(128_000, maxOutputTokens + (shortOutput ? 1024 : 4096)),
  };
}
