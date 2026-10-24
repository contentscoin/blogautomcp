import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "./app-paths";

export type CodexUsageStage = "writing" | "product-analysis" | "image-review" | "source-reading" | "other";
export interface CodexDraftUsage {
  input_tokens: number | null;
  cached_input_tokens: number | null;
  cache_write_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
}
const tokenCount = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Unknown/missing usage is never reported as zero or converted to money. */
export function normalizeCodexDraftUsage(value: unknown): CodexDraftUsage {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { input_tokens: tokenCount(row.input_tokens), cached_input_tokens: tokenCount(row.cached_input_tokens),
    cache_write_input_tokens: tokenCount(row.cache_write_input_tokens), output_tokens: tokenCount(row.output_tokens),
    reasoning_output_tokens: tokenCount(row.reasoning_output_tokens) };
}

export interface CodexUsageRecord {
  version: "codex-draft-usage/v1";
  at: string;
  requestId: string;
  attempt: number;
  stage: CodexUsageStage;
  model: string;
  promptSha256: string;
  imageCount: number;
  elapsedMs: number;
  status: "completed" | "failed";
  failureKind?: string;
  usage: CodexDraftUsage;
}

/** Only aggregate counters and an opaque prompt hash; no prompts, images,
 * file paths, authentication or response text are retained. */
export function recordCodexDraftUsage(record: CodexUsageRecord): void {
  try {
    const directory = path.join(getAppDataDir(), "metrics");
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, `codex-usage-${record.at.slice(0, 10)}.jsonl`), JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 });
  } catch { console.warn("Codex 사용량 기록을 저장하지 못했습니다. 생성 결과는 유지합니다."); }
}

/** Fallback labels only. Callers can provide an explicit bounded stage. */
export function inferCodexUsageStage(systemPrompt: string): CodexUsageStage {
  if (/publication-image|image[- ]audit|image[- ]review|reference[- ]scene|intrinsic[- ]identifier|시각.*검수/iu.test(systemPrompt)) return "image-review";
  if (/source[- ]reading|seller[- ]facts|product[- ]source|원본.*판독/iu.test(systemPrompt)) return "source-reading";
  if (/product[- ]analysis|product[- ]understanding|상품.*분석/iu.test(systemPrompt)) return "product-analysis";
  if (/writing|writer|원고|블로그.*작성/iu.test(systemPrompt)) return "writing";
  return "other";
}
