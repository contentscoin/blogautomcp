import type { ResolvedPostDocumentV1 } from "../../src/lib/post-composition-contract";

const compact = (value: string) => value.normalize("NFKC").replace(/[\s\u200b-\u200d\ufeff]+/gu, "");

/** Readiness consumes body sections followed by the disclosure as its final row. */
export function publishedReadinessSections(document: ResolvedPostDocumentV1): string[] {
  return [
    ...document.sections.map(section => document.renderNodes.flatMap(node =>
      (node.kind === "paragraph" || node.kind === "heading" || node.kind === "quotation") && node.sectionId === section.id
        ? [node.text] : []).join("\n")),
    document.renderNodes.flatMap(node => node.kind === "disclosure" ? [node.text] : []).join("\n"),
  ];
}

/** Compare actual editor text, not just the draft that was intended for upload. */
export function assertPublishedEditorText(document: ResolvedPostDocumentV1, actualText: string): void {
  const actual = compact(actualText);
  if (!actual) throw new Error("EDITOR_CONTENT_MISSING: 발행 전 편집기 본문을 확인할 수 없습니다.");
  let cursor = 0;
  for (const node of document.renderNodes) {
    if (node.kind !== "paragraph" && node.kind !== "disclosure" && node.kind !== "heading" && node.kind !== "quotation") continue;
    const expected = compact(node.text);
    if (!expected) continue;
    const found = actual.indexOf(expected, cursor);
    if (found < 0) throw new Error(`EDITOR_CONTENT_MISMATCH: 본문 누락 또는 순서 변경 (${node.kind})`);
    cursor = found + expected.length;
  }
  const expectedTags = document.renderNodes.flatMap(node => node.kind === "hashtags" ? node.values : [])
    .map(tag => tag.replace(/^#+/u, "").replace(/\s+/gu, ""));
  const actualTags = [...actualText.matchAll(/#([\p{L}\p{N}_]+)/gu)].map(match => match[1]);
  for (const tag of expectedTags) {
    if (actualTags.filter(value => value === tag).length !== 1) {
      throw new Error(`EDITOR_HASHTAG_MISMATCH: 해시태그 중복·누락·고지문 붙음 (${tag})`);
    }
  }
}
