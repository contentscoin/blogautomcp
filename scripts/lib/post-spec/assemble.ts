/**
 * STAGE D — 조립. 스펙과 초안을 에디터 입력 계약(composition)과 기존 preview 형식으로 바꾼다.
 */

import path from "path";
import { normalizeLines, renderSectionText } from "./render";
import type { AssembledPost, CompositionSectionPlan, GeneratedDraft, HeaderFormat, PostCompositionContract, PostSpec, SectionSlot, ValidationReport } from "./types";

export interface AssembleOptions {
  /** 인용구 헤더를 실제로 쓸지. 에디터 셀렉터 실측 전까지는 false → sectionTitle 로 강등 */
  quotationHeaders: boolean;
  /** hero 슬롯 대신 쓸 생성 썸네일 경로 (있으면 업로드 첫 장을 교체) */
  heroOverridePath?: string | null;
}

/** 제목을 스펙으로 고정하고 형식별로 줄을 정리한다. 내용은 바꾸지 않는다. */
export function normalizeDraft(spec: PostSpec, draft: GeneratedDraft): GeneratedDraft {
  const sections = spec.sections.map((section) => {
    const found = draft.sections.find((candidate) => candidate.index === section.index);
    return {
      index: section.index,
      role: section.role,
      title: section.title,
      lines: normalizeLines(found?.lines || [], section.shape),
    };
  });
  return { ...draft, sections };
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#+/, "").replace(/\s+/g, "").trim();
}

export function buildHashtags(spec: PostSpec, draft: GeneratedDraft): string[] {
  const banned = new Set(spec.seo.hashtags.banned.map(normalizeTag));
  const output: string[] = [];
  const add = (tag: string) => {
    const normalized = normalizeTag(tag);
    if (!normalized || banned.has(normalized) || output.includes(normalized)) return;
    output.push(normalized);
  };
  spec.seo.hashtags.required.forEach(add);
  draft.hashtags.forEach(add);
  return output.slice(0, spec.seo.hashtags.count);
}

function slotPathsBySection(spec: PostSpec): Map<number, string[]> {
  const slotsBySection = new Map<number, string[]>();
  for (const slot of spec.imagePlan.slots) {
    slotsBySection.set(slot.sectionIndex, [...(slotsBySection.get(slot.sectionIndex) || []), slot.path]);
  }
  return slotsBySection;
}

/**
 * 렌더 계약이 따를 섹션별 이미지 플랜. 스펙이 확정한 슬롯·의도·하한/상한을 그대로 옮기고,
 * 첫 커넥트 카드는 일정 흐름(여행) 또는 핵심 사실(쇼핑) 섹션 뒤에 둔다.
 */
export function buildCompositionSectionPlan(spec: PostSpec, options: Pick<AssembleOptions, "quotationHeaders">): CompositionSectionPlan[] {
  const slotsBySection = slotPathsBySection(spec);
  const earlyRole = spec.connectKind === "TRAVEL" ? "itinerary-overview" : "key-facts";
  return spec.sections.map((section) => {
    const imagePaths = slotsBySection.get(section.index) || [];
    const [minCount, maxCount] = section.imageCount || [imagePaths.length, Math.max(1, imagePaths.length)];
    const headingStyle = section.headerFormat === "quotation" && options.quotationHeaders ? "quotation" : section.headerFormat === "none" ? "plain" : "sectionTitle";
    return {
      role: section.role,
      imagePaths,
      imageIntent: section.imageIntent,
      // 확보된 장수가 하한보다 적어도 플랜은 하한을 그대로 알려 준다(품질 리포트가 부족을 표시하도록).
      imageMin: Math.max(0, minCount),
      imageMax: Math.max(minCount, maxCount, imagePaths.length),
      headingStyle,
      earlyConnectCard: section.role === earlyRole,
    };
  });
}

export function assemblePost(spec: PostSpec, draft: GeneratedDraft, validation: ValidationReport, options: AssembleOptions): AssembledPost {
  const slotsBySection = slotPathsBySection(spec);
  const composition: PostCompositionContract = {
    version: "post-composition/v1",
    kind: spec.connectKind,
    sections: spec.sections.map((section): SectionSlot => {
      const headerFormat: HeaderFormat =
        section.headerFormat === "quotation" && !options.quotationHeaders ? "sectionTitle" : section.headerFormat;
      return {
        index: section.index,
        role: section.role,
        headerFormat,
        headerText: section.title,
        imagePaths: slotsBySection.get(section.index) || [],
        dividerBefore: section.index > 0 && headerFormat !== "none",
      };
    }),
    connectCard: spec.connectKind === "TRAVEL" ? "EXTERNAL_LINK" : "SHOPPING_CONNECT",
  };

  const sections = draft.sections.map((section) => {
    const spec$ = spec.sections[section.index];
    const extra = spec$?.role === "fit-checklist" ? [spec.geo.sourceLine] : [];
    return renderSectionText(section, extra);
  });
  sections.push(spec.disclosure);

  const heroImagePath = options.heroOverridePath || spec.imagePlan.hero?.path || null;
  const bodyImagePaths = spec.imagePlan.slots.map((slot) => slot.path);
  const seen = new Set<string>();
  const uploadImagePaths = [heroImagePath, ...bodyImagePaths].filter((value): value is string => {
    if (!value) return false;
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });

  return {
    title: draft.title,
    sections,
    hashtags: buildHashtags(spec, draft),
    spec,
    draft,
    validation,
    composition,
    sectionPlan: buildCompositionSectionPlan(spec, options),
    heroImagePath,
    bodyImagePaths,
    uploadImagePaths,
    attempts: draft.attempts,
    generationSource: draft.source,
  };
}
