import {
  refreshPostDocumentQuality,
  type PostRenderNode,
  type ResolvedPostDocumentV1,
} from "../../src/lib/post-composition-contract";

const compact = (text: string) => text.replace(/\s/gu, "");
const refuse = (): never => {
  throw new Error("REVISION_RENDER_SCOPE_AMBIGUOUS: 기존 문단과 게시 배치의 대응을 확인하지 못해 원고·사진·링크 배치를 보존했습니다.");
};

function revisedLiteral(previous: string, next: string): string {
  if (previous === next) return previous;
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
  const removed = previous.slice(prefix, previous.length - suffix), inserted = next.slice(prefix, next.length - suffix);
  // Parsing trims the remaining body after a literal deletion. Keep the old
  // adjacent whitespace in the render block rather than rewriting its spacing.
  return !inserted && removed.trim()
    ? previous.slice(0, prefix) + (removed.match(/^\s*/u)?.[0] || "") + (removed.match(/\s*$/u)?.[0] || "") + previous.slice(previous.length - suffix)
    : next;
}

function replaceBlockText(text: string, previous: string[], next: string[]): string {
  let cursor = 0, output = "";
  previous.forEach((part, index) => {
    const literal = part.trim(), start = text.indexOf(literal, cursor);
    if (!literal || start < cursor || text.slice(cursor, start).trim()) return refuse();
    output += text.slice(cursor, start) + revisedLiteral(literal, next[index].trim());
    cursor = start + literal.length;
  });
  if (text.slice(cursor).trim()) return refuse();
  return output + text.slice(cursor);
}

/** Text revision cannot silently become a new layout plan. The saved section
 * metadata and actual render nodes own image placement/captions, card positions
 * and disclosures. Only matching section text is taken from the candidate.
 * Pure: also usable to restore a saved layout around an already corrected text. */
export function preservePreparedRevisionRenderPlan(
  previous: ResolvedPostDocumentV1,
  candidate: ResolvedPostDocumentV1,
): ResolvedPostDocumentV1 {
  if (previous.version !== candidate.version || previous.connectKind !== candidate.connectKind ||
      previous.sections.length !== candidate.sections.length ||
      new Set(previous.sections.map(section => section.id)).size !== previous.sections.length ||
      previous.sections.some((section, index) => section.id !== candidate.sections[index].id)) return refuse();

  const replacements = new Map<number, PostRenderNode>();
  const sections = previous.sections.map((section, sectionIndex) => {
    const updated = candidate.sections[sectionIndex];
    const sameTitle = section.title === updated.title;
    const sameBody = section.body.length === updated.body.length && section.body.every((text, index) => text === updated.body[index]);
    if (sameTitle && sameBody) return section;
    if (!updated.title.trim() || !updated.body.length || updated.body.some(text => !text.trim())) return refuse();

    const paragraphs = previous.renderNodes.flatMap((node, index) =>
      node.kind === "paragraph" && node.sectionId === section.id ? [{ node, index }] : []);
    if (!paragraphs.length || compact(paragraphs.map(item => item.node.text).join("\n")) !== compact(section.body.join("\n"))) return refuse();

    if (!sameBody) {
      if (section.body.length !== updated.body.length) return refuse();
      if (paragraphs.length === 1) {
        replacements.set(paragraphs[0].index, { ...paragraphs[0].node,
          text: replaceBlockText(paragraphs[0].node.text, section.body, updated.body) });
      } else {
        // Each saved block may batch several body paragraphs. Retain those
        // exact boundaries and any images/cards between them. A changed body
        // cardinality has no safe mapping across several saved render blocks.
        let cursor = 0;
        for (const { node, index } of paragraphs) {
          const start = cursor;
          let expected = "";
          while (cursor < section.body.length && compact(expected) !== compact(node.text)) {
            expected += section.body[cursor++];
            if (!compact(node.text).startsWith(compact(expected))) return refuse();
          }
          if (cursor === start || compact(expected) !== compact(node.text)) return refuse();
          if (section.body.slice(start, cursor).every((text, offset) => text === updated.body[start + offset])) continue;
          replacements.set(index, { ...node, text: replaceBlockText(node.text, section.body.slice(start, cursor), updated.body.slice(start, cursor)) });
        }
        if (cursor !== section.body.length) return refuse();
      }
    }
    if (!sameTitle) previous.renderNodes.forEach((node, index) => {
      if ((node.kind === "heading" || node.kind === "quotation") && node.sectionId === section.id) {
        if (node.text !== section.title) return refuse();
        replacements.set(index, { ...node, text: updated.title });
      }
    });
    return { ...section, title: updated.title, body: [...updated.body], characterCount: updated.body.join("").length };
  });
  return refreshPostDocumentQuality({ ...previous, title: candidate.title, sections,
    renderNodes: previous.renderNodes.map((node, index) => replacements.get(index) || node) });
}
