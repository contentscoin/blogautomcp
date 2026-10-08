import { SHOPPING_POST_STRATEGY } from "../../src/lib/shopping-post-strategy";

export type DraftSectionKind = "SHOPPING" | "TRAVEL";
export type DraftSectionCountStage = "submitted" | "expanded" | "normalized";

export interface DraftSectionEntry {
  text: string;
  /** Index in the submitted array, before heading expansion. */
  sourceSectionIndex: number;
}

export interface DraftSectionCountDetails {
  connectKind: DraftSectionKind;
  stage: DraftSectionCountStage;
  minimum: number;
  maximum: number;
  sectionCount: number;
  /** Original zero-based array indexes; never indexes into a silently clipped draft. */
  sourceSectionIndexes: number[];
  expandedSectionCounts: number[];
}

export function getDraftSectionBounds(kind: DraftSectionKind): { min: number; max: number } {
  return kind === "SHOPPING"
    ? { min: SHOPPING_POST_STRATEGY.sections.min, max: SHOPPING_POST_STRATEGY.sections.max }
    : { min: 7, max: 12 };
}

export class DraftSectionCountError extends Error {
  readonly code = "DRAFT_SECTION_COUNT_OUT_OF_RANGE";
  readonly nextAction = "처음 제출할 원고의 섹션을 합치거나 보강한 뒤 같은 contextJobId와 새 idempotencyKey로 post_submit_draft에 다시 제출하세요. post_revise_draft는 저장된 섹션 수를 변경하지 않습니다. 기존 저장 원고와 승인 상태는 유지됩니다.";

  constructor(readonly details: DraftSectionCountDetails) {
    const label = details.connectKind === "TRAVEL" ? "여행" : "쇼핑";
    const phase = details.stage === "submitted" ? "제출" : details.stage === "expanded" ? "소제목 분리 후" : "정규화 후";
    const sources = details.sourceSectionIndexes.map(index => index + 1).join(", ");
    super(`${label} 원고는 ${details.minimum}~${details.maximum}개 본문 섹션이어야 합니다. ${phase} ${details.sectionCount}개입니다.${sources ? ` 원래 배열의 ${sources}번 섹션을 확인하세요.` : ""} 본문을 자르지 않고 거절했습니다. 섹션 구조를 고친 원고를 다시 제출하세요.`);
    this.name = "DraftSectionCountError";
  }
}

// Keep the writer's existing heading recognition. Ordinary short body lines are
// not new section boundaries merely because they lack sentence punctuation.
const KNOWN_SECTION_TITLE = /^(?:구매하게 된 계기|구매 전 확인 포인트|택배 도착\s*&\s*개봉기|구성 및 패키지 확인|첫인상\s*\/\s*디자인|크기\s*&\s*스펙 정보|주요 기능\s*[①1]|주요 기능\s*[②2]|실제 사용 후기|사용 장면별 체크|장점 정리|장점으로 보이는 부분|아쉬운 점|확인하면 좋을 아쉬운 점|이런 분께 추천해요|이런 분께 잘 맞아요)\s*$/i;

export function isDraftSectionTitleLine(value: string): boolean {
  const title = value.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/^[\s\-*#>]+/u, "")
    .replace(/^[\d]+\.\s*/u, "")
    .trim();
  return KNOWN_SECTION_TITLE.test(title);
}

/** Preserve every candidate and its original array index; no count-based slice. */
export function expandDraftSectionEntries(sections: readonly string[]): DraftSectionEntry[] {
  return sections.flatMap((value, sourceSectionIndex) => {
    const normalized = value.replace(/\r/g, "").trim();
    if (!normalized) return [];
    const entries: DraftSectionEntry[] = [];
    let current: string[] = [];
    for (const line of normalized.split("\n")) {
      if (isDraftSectionTitleLine(line) && current.length > 0) {
        entries.push({ text: current.join("\n").trim(), sourceSectionIndex });
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) entries.push({ text: current.join("\n").trim(), sourceSectionIndex });
    return entries;
  });
}

export function assertDraftSectionCount(
  entries: readonly DraftSectionEntry[],
  connectKind: DraftSectionKind,
  stage: DraftSectionCountStage,
  bounds = getDraftSectionBounds(connectKind),
): void {
  if (entries.length >= bounds.min && entries.length <= bounds.max) return;
  const expandedSectionCounts: number[] = [];
  for (const entry of entries) {
    expandedSectionCounts[entry.sourceSectionIndex] = (expandedSectionCounts[entry.sourceSectionIndex] || 0) + 1;
  }
  // Diagnostics locate overflow in the original request, even when an earlier
  // array element produced two headings. The per-source counts explain that split.
  const affected = entries.length > bounds.max ? entries.slice(bounds.max) : entries;
  throw new DraftSectionCountError({
    connectKind, stage, minimum: bounds.min, maximum: bounds.max, sectionCount: entries.length,
    sourceSectionIndexes: [...new Set(affected.map(entry => entry.sourceSectionIndex))],
    expandedSectionCounts: Array.from({ length: expandedSectionCounts.length }, (_, index) => expandedSectionCounts[index] || 0),
  });
}

/** Run at the request boundary, before draft claims, file writes, or PC work. */
export function validateSubmittedDraftSectionCount(sections: readonly string[], kind: DraftSectionKind): void {
  const raw = sections.map((text, sourceSectionIndex) => ({ text, sourceSectionIndex }));
  assertDraftSectionCount(raw, kind, "submitted");
  assertDraftSectionCount(expandDraftSectionEntries(sections), kind, "expanded");
}
