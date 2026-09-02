export const CHATGPT_DIRECT_PRIMARY_PROMPT_MAX_CHARS = 8_500;
export const CHATGPT_DIRECT_RECOVERY_PROMPT_MAX_CHARS = 5_500;

function normalizeLines(value: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const rawLine of String(value || "").replace(/\r\n?/gu, "\n").split("\n")) {
    const line = rawLine.replace(/[ \t]+/gu, " ").trim();
    if (!line) continue;
    const key = line.toLocaleLowerCase("ko-KR");
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }

  return lines;
}

export function compactChatGptEvidence(value: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  const lines = normalizeLines(value);
  const selected: string[] = [];
  let length = 0;

  for (const line of lines) {
    const remaining = maxChars - length - (selected.length > 0 ? 1 : 0);
    if (remaining <= 0) break;
    if (line.length <= remaining) {
      selected.push(line);
      length += line.length + (selected.length > 1 ? 1 : 0);
      continue;
    }
    if (remaining >= 40) selected.push(`${line.slice(0, remaining - 1).trimEnd()}…`);
    break;
  }

  return selected.join("\n");
}

export function composeBudgetedChatGptPrompt(input: {
  prefix: string;
  evidence: string;
  suffix: string;
  maxChars: number;
}): string {
  const prefix = input.prefix.trim();
  const suffix = input.suffix.trim();
  const fixedLength = prefix.length + suffix.length + 4;
  if (fixedLength > input.maxChars) {
    throw new Error(`ChatGPT 고정 프롬프트가 예산을 초과했습니다: ${fixedLength}/${input.maxChars}`);
  }
  const evidence = compactChatGptEvidence(input.evidence, input.maxChars - fixedLength);
  return [prefix, evidence, suffix].filter(Boolean).join("\n\n");
}
