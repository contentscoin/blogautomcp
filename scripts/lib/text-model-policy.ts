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

export function resolveTextReasoningEffort(requested?: string): "low" | "medium" | "high" | "xhigh" {
  const effort = requested?.trim() || "medium";
  if (effort !== "low" && effort !== "medium" && effort !== "high" && effort !== "xhigh") {
    throw new Error(`TEXT_MODEL_POLICY: ${TEXT_MODEL}에서 지원하지 않는 reasoning effort입니다.`);
  }
  return effort;
}

/**
 * GPT-5.5 supports none/low/medium/high/xhigh (official model guide).
 * Small classification/title budgets must not be spent on default reasoning.
 * Longer writing gets low effort and 4096 tokens of reasoning headroom. This is
 * a total cap, not a guarantee of visible output; callers still reject length.
 * https://developers.openai.com/api/docs/models/gpt-5.5
 */
export function textCompletionParameters(maxOutputTokens: number, requested?: string) {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("출력 토큰 상한은 양의 정수여야 합니다.");
  }
  const shortOutput = maxOutputTokens <= 1024;
  return {
    model: resolveTextModel(requested),
    reasoning_effort: shortOutput ? "none" as const : "low" as const,
    max_completion_tokens: Math.min(128_000, maxOutputTokens + (shortOutput ? 0 : 4096)),
  };
}
