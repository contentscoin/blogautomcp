/**
 * 모델이 돌려준 원고 JSON의 sections 모양을 계약 형식("소제목\n\n본문" 문자열 배열)으로 맞춘다.
 * 모델은 가끔 섹션을 객체({title, body})로 주거나, 여러 섹션을 문자열 하나에 몰아 넣는다.
 * 내용은 바꾸지 않고 모양만 고친다. 새 문장을 만들지 않는다.
 */

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("\n\n");
  return "";
}

/** {title|heading|subtitle, body|content|text|paragraphs} 객체를 "소제목\n\n본문" 문자열로. */
export function sectionEntryToString(entry: unknown): string {
  if (typeof entry === "string") return entry.trim();
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return text(entry);
  const record = entry as Record<string, unknown>;
  const title = text(record.title ?? record.heading ?? record.subtitle ?? record.sectionTitle ?? record.name);
  const body = text(record.body ?? record.content ?? record.text ?? record.paragraphs ?? record.lines ?? record.sentences);
  if (title && body) return `${title}\n\n${body}`;
  return body || title;
}

const HEADING_LINE = /^(?!.*[.!?。…]$)(?![-*•·▸💡#]).{2,42}$/u;

/**
 * 문자열 하나에 여러 섹션이 들어 있으면 "짧은 소제목 줄 + 빈 줄 + 본문" 경계로 나눈다.
 * 경계가 분명하지 않으면 그대로 둔다.
 */
/** 본문과 붙어 있어도 제목으로 보는 줄: 마크다운 제목, 한 줄 굵게, "N일차 …", 기호로 시작하는 짧은 줄. */
const EXPLICIT_HEADING_LINE = /^(?:#{1,6}\s+\S.{0,60}|\*\*[^*\n]{2,60}\*\*|\d{1,2}\s*일차(?:\s.{0,40})?|[■▶◆●◇□▣【].{1,40})$/u;

/** 문장부호로 끝나는 줄은 본문 문장이다(마크다운·굵게 제목은 예외). */
function isExplicitHeading(line: string): boolean {
  return EXPLICIT_HEADING_LINE.test(line) && (/^(?:#|\*\*)/u.test(line) || !/[.!?。…]$/u.test(line));
}

/** 제목 줄 앞뒤에 빈 줄을 넣어, 제목 바로 아래 본문이 붙은 형태도 블록 경계가 생기게 한다. */
function isolateExplicitHeadings(section: string): string {
  return section.replace(/\r\n?/gu, "\n").split("\n")
    .map((line) => isExplicitHeading(line.trim()) ? `\n${line.trim().replace(/^[■▶◆●◇□▣]\s*/u, "")}\n` : line)
    .join("\n");
}

export function splitMergedSection(section: string): string[] {
  const blocks = isolateExplicitHeadings(section).split(/\n\s*\n/u).map((block) => block.trim()).filter(Boolean);
  if (blocks.length < 4) return [section];
  const parts: string[] = [];
  let current: string[] = [];
  for (const block of blocks) {
    const singleLine = !block.includes("\n");
    const cleaned = block.replace(/^#{1,6}\s*/u, "").replace(/^\*\*(.+)\*\*$/u, "$1").replace(/^【(.+)】$/u, "$1").trim();
    if (singleLine && HEADING_LINE.test(cleaned) && current.length > 0) {
      parts.push(current.join("\n\n"));
      current = [cleaned];
    } else {
      current.push(current.length === 0 && singleLine ? cleaned : block);
    }
  }
  if (current.length) parts.push(current.join("\n\n"));
  // 소제목만 있고 본문이 없는 조각이 생기면 경계 판단이 틀린 것이다.
  return parts.length > 1 && parts.every((part) => part.includes("\n\n")) ? parts : [section];
}

export function normalizeDraftSections(value: unknown, minimum = 0): string[] {
  if (!Array.isArray(value)) return typeof value === "string" && value.trim() ? splitMergedSection(value.trim()) : [];
  const sections = value.map(sectionEntryToString).filter(Boolean);
  if (sections.length >= minimum) return sections;
  const split = sections.flatMap(splitMergedSection);
  return split.length > sections.length ? split : sections;
}
