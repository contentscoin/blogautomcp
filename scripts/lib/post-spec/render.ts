/**
 * 섹션 텍스트 정규화·렌더 헬퍼. 검증(validate)과 조립(assemble)이 같은 규칙을 쓴다.
 */

import { CHECK_PREFIX, FACT_PREFIX } from "./section-library";
import type { GeneratedSection, SectionShape } from "./types";

const MAX_MOBILE_LINE = 58;

export function stripMarkdown(line: string): string {
  return line
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s+/, "")
    .trim();
}

function splitLongLine(line: string): string[] {
  if (line.length <= MAX_MOBILE_LINE) return [line];
  const chunks = line
    .split(/(?<=[,，])\s+|\s+(?=그리고|그래서|다만|특히|반대로|또한|참고로)/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (chunks.length <= 1) return [line];
  const lines: string[] = [];
  let current = "";
  for (const chunk of chunks) {
    const next = current ? `${current} ${chunk}` : chunk;
    if (next.length > MAX_MOBILE_LINE && current) {
      lines.push(current);
      current = chunk;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** 형식(shape)에 맞게 줄을 정리한다. 내용을 바꾸지 않고 접두사·줄바꿈만 다듬는다. */
export function normalizeLines(rawLines: string[], shape: SectionShape): string[] {
  const lines = rawLines
    .flatMap((line) => String(line ?? "").replace(/\r/g, "").split("\n"))
    .map((line) => stripMarkdown(line))
    .filter((line) => line.length > 0);
  if (shape === "facts-list") {
    return lines.map((line) => {
      const bare = line.replace(/^[-•·▸✔✓*]\s*/u, "");
      return `${FACT_PREFIX}${bare}`;
    });
  }
  if (shape === "checklist") {
    return lines.map((line) => {
      const bare = line.replace(/^[-•·▸✔✓*①②③④⑤]\s*/u, "").replace(/^\d+[.)]\s*/, "");
      return `${CHECK_PREFIX}${bare}`;
    });
  }
  if (shape === "qa-3") {
    return lines.map((line, index) => {
      const bare = line.replace(/^(?:Q|A|질문|답변)\s*[.:：)]\s*/iu, "");
      return `${index % 2 === 0 ? "Q." : "A."} ${bare}`;
    });
  }
  if (shape === "lines-3") return lines;
  return lines.flatMap((line) => splitLongLine(line));
}

export function countChars(lines: string[]): number {
  return lines.join("").replace(/\s+/g, "").length;
}

export function renderSectionText(section: Pick<GeneratedSection, "title" | "lines">, extraLines: string[] = []): string {
  return `${section.title}\n\n${[...section.lines, ...extraLines].join("\n")}\n`;
}

export function looseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
