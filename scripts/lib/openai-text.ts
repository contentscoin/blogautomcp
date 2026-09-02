/**
 * OpenAI Chat Completions 공용 호출기 (텍스트 + 비전).
 *
 * 프로젝트의 모든 LLM 호출은 OpenAI 한 곳으로 통일한다. 예전에는 스타일 분석·리뷰
 * 생성·이미지 스토리보드·썸네일 QC가 각각 Gemini SDK를 직접 들고 있어서, 실제로는
 * OpenAI만 쓰는 사용자 환경에서 키가 없다는 이유로 조용히 건너뛰거나 실패했다.
 */

import fs from "fs";
import path from "path";

const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

export interface OpenAiImageInput {
  /** 로컬 파일 경로. base64 가 없을 때 읽어서 data URL 로 보낸다. */
  path?: string;
  base64?: string;
  mimeType?: string;
  detail?: "low" | "high" | "auto";
}

export interface OpenAiChatOptions {
  system?: string;
  user: string;
  images?: OpenAiImageInput[];
  /** true 면 response_format=json_object (프롬프트에 "JSON" 언급 필요). */
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
  timeoutMs?: number;
}

export function getOpenAiApiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() || "";
}

export function isOpenAiAvailable(): boolean {
  return Boolean(getOpenAiApiKey());
}

export function getOpenAiTextModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

export function getOpenAiVisionModel(): string {
  return process.env.OPENAI_VISION_MODEL?.trim() || getOpenAiTextModel();
}

function mimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function toImagePart(image: OpenAiImageInput) {
  const base64 = image.base64 || (image.path ? fs.readFileSync(image.path).toString("base64") : "");
  if (!base64) throw new Error("이미지 입력에 path 또는 base64 가 필요합니다.");
  const mimeType = image.mimeType || (image.path ? mimeTypeForPath(image.path) : "image/jpeg");
  return {
    type: "image_url" as const,
    image_url: { url: `data:${mimeType};base64,${base64}`, detail: image.detail || "auto" },
  };
}

/**
 * 텍스트(또는 텍스트+이미지) 프롬프트를 보내고 본문 문자열을 돌려준다.
 * 출력이 상한에서 잘리면(finish_reason=length) 예외를 던져 호출자가 알 수 있게 한다.
 */
export async function openaiChatText(options: OpenAiChatOptions): Promise<string> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY가 비어 있어 OpenAI API를 호출할 수 없습니다.");

  const hasImages = Boolean(options.images && options.images.length > 0);
  const model = options.model || (hasImages ? getOpenAiVisionModel() : getOpenAiTextModel());
  const userContent = hasImages
    ? [{ type: "text" as const, text: options.user }, ...(options.images || []).map(toImagePart)]
    : options.user;
  const messages: Array<{ role: "system" | "user"; content: unknown }> = [];
  if (options.system?.trim()) messages.push({ role: "system", content: options.system });
  messages.push({ role: "user", content: userContent });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await fetch(OPENAI_CHAT_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_completion_tokens: options.maxOutputTokens ?? 4096,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenAI API 호출 실패 (${response.status}): ${detail.slice(0, 400)}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
    };
    const choice = payload.choices?.[0];
    const text = choice?.message?.content?.trim() || "";
    if (!text) throw new Error("OpenAI API 응답에서 본문을 찾지 못했습니다.");
    if (choice?.finish_reason === "length") {
      throw new Error("OpenAI API 응답이 출력 토큰 상한에서 잘렸습니다.");
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
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

export async function openaiChatJson<T = Record<string, unknown>>(options: OpenAiChatOptions): Promise<T> {
  const text = await openaiChatText({ ...options, json: options.json ?? true });
  return extractJsonObject<T>(text);
}
