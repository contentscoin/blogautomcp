/**
 * Batch write helpers: apply Naver toolbar styles once per section role,
 * then type the whole section body without re-clicking text options.
 */

export type EditorialImageLayout = "before-heading" | "before-body" | "after-lead" | "after-body";

export interface EditorialBodyStyleState {
  /** Section id whose body toolbar style is already active in the editor. */
  readySectionId: string | null;
}

export function createEditorialBodyStyleState(): EditorialBodyStyleState {
  return { readySectionId: null };
}

/** True when the next body block still needs a full toolbar pass. */
export function shouldApplyBodyStyle(
  state: EditorialBodyStyleState,
  sectionId: string | null | undefined,
): boolean {
  if (!sectionId) return true;
  return state.readySectionId !== sectionId;
}

export function markBodyStyleReady(
  state: EditorialBodyStyleState,
  sectionId: string | null | undefined,
): void {
  state.readySectionId = sectionId ?? null;
}

/** Call after image upload, divider, connect card, or any focus-breaking action. */
export function invalidateBodyStyle(state: EditorialBodyStyleState): void {
  state.readySectionId = null;
}

/**
 * Collapse sentence units into mobile paragraphs, then into at most two body
 * blocks so after-lead images can sit between the lead and the rest.
 */
export function batchSectionParagraphs(
  body: readonly string[],
  sentencesPerParagraph = 1,
  imageLayout: EditorialImageLayout = "after-lead",
): { lead: string | null; rest: string | null; blocks: string[] } {
  const step = Math.max(1, sentencesPerParagraph);
  const paragraphs: string[] = [];
  for (let i = 0; i < body.length; i += step) {
    const chunk = body.slice(i, i + step).map((line) => line.trim()).filter(Boolean);
    if (chunk.length) paragraphs.push(chunk.join(" "));
  }
  if (paragraphs.length === 0) {
    return { lead: null, rest: null, blocks: [] };
  }
  if (imageLayout === "after-lead" && paragraphs.length > 1) {
    const lead = paragraphs[0]!;
    const rest = paragraphs.slice(1).join("\n\n");
    return { lead, rest, blocks: [lead, rest] };
  }
  const all = paragraphs.join("\n\n");
  return { lead: all, rest: null, blocks: [all] };
}
