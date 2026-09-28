import { runCodexDraft } from "./codex-draft-provider";

export interface CodexTextOptions {
  system?: string;
  user: string;
  imagePaths?: string[];
  outputSchema?: unknown;
  timeoutMs?: number;
}

/** All Codex text and vision work uses the signed-in account with GPT-6 Luna/low. */
export async function codexText(options: CodexTextOptions): Promise<string> {
  return runCodexDraft({
    systemPrompt: options.system || "요청을 정확히 수행하세요.",
    userPrompt: options.user,
    imagePaths: options.imagePaths,
    maxImages: options.imagePaths?.length,
    preserveImageOrder: true,
    outputSchema: options.outputSchema,
    timeoutMs: options.timeoutMs,
    researchMode: "disabled",
  });
}

/** 응답 본문에서 첫 JSON 객체를 찾아 파싱한다. */
export function extractJsonObject<T = Record<string, unknown>>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("응답에서 JSON 객체를 찾지 못했습니다.");
    return JSON.parse(match[0]) as T;
  }
}

export async function codexJson<T = Record<string, unknown>>(options: CodexTextOptions): Promise<T> {
  const text = await codexText({
    ...options,
    system: options.system || "요청된 JSON 객체만 반환하세요.",
  });
  return extractJsonObject<T>(text);
}
