/** Structured output through the signed-in ChatGPT Codex account. */

import { runCodexDraft } from "../codex-draft-provider";
import { extractJsonObject } from "../codex-text";

export interface StructuredRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs?: number;
}

export interface StructuredResult<T> {
  json: T;
  model: string;
  usedSchema: boolean;
}

export async function generateStructured<T>(request: StructuredRequest): Promise<StructuredResult<T>> {
  const text = await runCodexDraft({
    systemPrompt: request.system,
    userPrompt: request.user,
    outputSchema: request.schema,
    timeoutMs: request.timeoutMs ?? 180_000,
    researchMode: "disabled",
  });
  return {
    json: extractJsonObject<T>(text),
    model: "gpt-6-luna",
    usedSchema: true,
  };
}
