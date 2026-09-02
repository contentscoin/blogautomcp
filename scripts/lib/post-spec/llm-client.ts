/**
 * OpenAI structured output 호출기.
 * json_schema(strict) 를 1순위로 쓰고, 계정/모델이 거부하면 json_object 로 내려간다.
 * 출력이 상한에서 잘리면(finish_reason=length) 예외로 알린다 — 조용한 파싱 폴백 금지.
 */

import { extractJsonObject, getOpenAiApiKey, getOpenAiTextModel } from "../openai-text";

const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

export interface StructuredRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens: number;
  temperature: number;
  model?: string;
  timeoutMs?: number;
}

export interface StructuredResult<T> {
  json: T;
  model: string;
  usedSchema: boolean;
}

class OutputTruncatedError extends Error {}

async function call<T>(request: StructuredRequest, useSchema: boolean): Promise<StructuredResult<T>> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY가 비어 있어 글을 생성할 수 없습니다.");
  const model = request.model || getOpenAiTextModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 180_000);
  try {
    const response = await fetch(OPENAI_CHAT_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        temperature: request.temperature,
        max_completion_tokens: request.maxOutputTokens,
        response_format: useSchema
          ? { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: request.schema } }
          : { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const error = new Error(`OpenAI API 호출 실패 (${response.status}): ${detail.slice(0, 400)}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }>;
    };
    const choice = payload.choices?.[0];
    if (choice?.message?.refusal) throw new Error(`모델이 생성을 거부했습니다: ${choice.message.refusal.slice(0, 200)}`);
    const text = choice?.message?.content?.trim() || "";
    if (!text) throw new Error("OpenAI API 응답에서 본문을 찾지 못했습니다.");
    if (choice?.finish_reason === "length") {
      throw new OutputTruncatedError(`OpenAI 응답이 출력 토큰 상한(${request.maxOutputTokens})에서 잘렸습니다.`);
    }
    return { json: extractJsonObject<T>(text), model, usedSchema: useSchema };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateStructured<T>(request: StructuredRequest): Promise<StructuredResult<T>> {
  try {
    return await call<T>(request, true);
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof OutputTruncatedError) {
      // 한 번만 더 간결하게 요청한다.
      return call<T>(
        {
          ...request,
          system: `${request.system}\n\n[출력 길이 주의] 직전 응답이 출력 한도에서 잘렸습니다. 섹션 수와 구조는 유지하되 각 줄을 더 간결하게 써서 JSON을 반드시 완결하세요.`,
        },
        true,
      );
    }
    if (status === 400 && /schema|response_format|json_schema/i.test(message)) {
      return call<T>(request, false);
    }
    throw error;
  }
}
