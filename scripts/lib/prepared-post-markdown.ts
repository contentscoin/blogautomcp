import type { ResolvedPostDocumentV1 } from "../../src/lib/post-composition-contract";

/** Restore the words that v2 actually publishes; Markdown is only an export. */
export function readPreparedCompositionSections(composition: ResolvedPostDocumentV1): string[] {
  if (!Array.isArray(composition.sections) || !Array.isArray(composition.renderNodes)) {
    throw new Error("준비된 원고의 렌더 섹션 구조가 올바르지 않습니다.");
  }
  const ids = new Set(composition.sections.map(section => section.id));
  if (ids.size !== composition.sections.length || ids.has("")) {
    throw new Error("준비된 원고의 렌더 섹션 식별자가 올바르지 않습니다.");
  }
  const grouped = new Map<string, string[]>();
  const bodyIds = new Set<string>();
  for (const node of composition.renderNodes) {
    if (node.kind !== "heading" && node.kind !== "quotation" && node.kind !== "paragraph") continue;
    if (typeof node.sectionId !== "string" || !ids.has(node.sectionId) || typeof node.text !== "string") {
      throw new Error("준비된 원고의 본문과 렌더 섹션 연결이 올바르지 않습니다.");
    }
    if (!node.text.trim()) continue;
    if (node.kind === "paragraph") bodyIds.add(node.sectionId);
    const lines = grouped.get(node.sectionId) || [];
    lines.push(node.text);
    grouped.set(node.sectionId, lines);
  }
  if (grouped.size !== ids.size || bodyIds.size !== ids.size) {
    throw new Error("준비된 원고의 렌더 본문이 누락되었습니다.");
  }
  // Disclosure cannot inflate the existing five-editorial-section gate.
  if (grouped.size < 5) throw new Error(`준비된 원고의 본문 섹션이 부족합니다: ${grouped.size}개`);
  return [...grouped.values()].map(lines => lines.join("\n\n")).concat(
    composition.renderNodes.flatMap(node => node.kind === "disclosure" ? [node.text] : []),
  );
}

export function parsePreparedBrandPostSections(markdown: string): string[] {
  const visibleMarkdown = markdown
    .split(/^##\s+Sources\s*$/m)[0]
    .replace(/<!--[\s\S]*?-->/g, "")
    // 해시태그는 매니페스트에서 별도로 복원한다. 마지막 본문에 합쳐지면
    // 발행 직전 품질검사가 마지막 결론 문단을 고지 문구로 오인한다.
    .replace(/\n+(?:#[^\r\n#]+(?:\s+|$))+$/u, "")
    .trim();
  const withoutTitle = visibleMarkdown.replace(/^#\s+.+\r?\n+/, "");
  const chunks = withoutTitle.split(/^##\s+/m);
  const intro = chunks.shift()?.replace(/!\[[^\]]*\]\([^\)]+\)/g, "").trim() || "";
  const parsedSections = chunks.map((chunk) => {
    const [heading = "", ...bodyLines] = chunk.split(/\r?\n/);
    const body = bodyLines
      .join("\n")
      .replace(/!\[[^\]]*\]\([^\)]+\)/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return [heading.trim(), body].filter(Boolean).join("\n\n");
  }).filter(Boolean);

  const sections = [...(intro ? [`여행 전 확인\n\n${intro}`] : [])];
  for (const section of parsedSections) {
    const disclosureMatch = section.match(/(?:^|\n)(이 포스팅은 네이버 (?:쇼핑|여행) 커넥트 활동의 일환으로[\s\S]*)$/u);
    if (!disclosureMatch || disclosureMatch.index === undefined) {
      sections.push(section);
      continue;
    }
    const editorialBody = section.slice(0, disclosureMatch.index).trim();
    const disclosure = disclosureMatch[1].trim();
    if (editorialBody) sections.push(editorialBody);
    if (disclosure) sections.push(disclosure);
  }
  return sections;
}
