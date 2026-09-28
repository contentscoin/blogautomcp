import draftRuntimePolicy from "./draft-runtime-policy.json";

const APPROVED_CODEX_TEXT_MODEL = "gpt-6-luna" as const;
const APPROVED_CHATGPT_BROWSER_MODEL = "default" as const;
const APPROVED_TEXT_REASONING_EFFORT = "low" as const;

if (draftRuntimePolicy.CODEX_DRAFT_MODEL !== APPROVED_CODEX_TEXT_MODEL) {
  throw new Error("TEXT_MODEL_POLICY: Codex 정책은 gpt-6-luna로 고정되어야 합니다.");
}
if (draftRuntimePolicy.CHATGPT_BROWSER_MODEL !== APPROVED_CHATGPT_BROWSER_MODEL) {
  throw new Error("TEXT_MODEL_POLICY: ChatGPT 브라우저 정책은 default로 고정되어야 합니다.");
}
if (draftRuntimePolicy.CODEX_DRAFT_REASONING_EFFORT !== APPROVED_TEXT_REASONING_EFFORT) {
  throw new Error("TEXT_MODEL_POLICY: reasoning effort 정책은 low로 고정되어야 합니다.");
}

export const CODEX_TEXT_MODEL = APPROVED_CODEX_TEXT_MODEL;
export const CHATGPT_BROWSER_MODEL = APPROVED_CHATGPT_BROWSER_MODEL;

function normalize(value?: string): string {
  return value?.trim().toLowerCase() || "";
}

/** Codex text, vision, review and image-controller work is pinned to GPT-6 Luna. */
export function resolveCodexTextModel(requested?: string): string {
  const normalized = normalize(requested);
  if (!normalized || normalized === "default" || normalized === CODEX_TEXT_MODEL) {
    return CODEX_TEXT_MODEL;
  }
  if (normalized === "gpt-6-astra") {
    throw new Error("TEXT_MODEL_POLICY: gpt-6-astra는 사용 금지 모델입니다. Codex는 gpt-6-luna만 사용합니다.");
  }
  throw new Error(`TEXT_MODEL_POLICY: Codex 자동 작업은 ${CODEX_TEXT_MODEL}만 사용할 수 있습니다.`);
}

/** ChatGPT browser automation always opens a normal chat and never selects a named model or custom GPT. */
export function resolveChatGptBrowserModel(requested?: string): "default" {
  const normalized = normalize(requested);
  if (!normalized || normalized === CHATGPT_BROWSER_MODEL) return "default";
  if (normalized === "gpt-6-astra") {
    throw new Error("TEXT_MODEL_POLICY: gpt-6-astra는 ChatGPT 브라우저에서도 사용할 수 없습니다.");
  }
  throw new Error("TEXT_MODEL_POLICY: ChatGPT 브라우저는 default 모델만 사용할 수 있습니다.");
}

export type TextReasoningEffort = "low";

/** Fixed default effort for Codex writing, review and vision calls. */
export const TEXT_REASONING_EFFORT: TextReasoningEffort = APPROVED_TEXT_REASONING_EFFORT;

export function resolveTextReasoningEffort(requested?: string): TextReasoningEffort {
  const effort = normalize(requested) || TEXT_REASONING_EFFORT;
  if (effort !== "low") throw new Error("TEXT_MODEL_POLICY: reasoning effort는 low만 사용할 수 있습니다.");
  return "low";
}
