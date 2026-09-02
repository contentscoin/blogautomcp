/**
 * API 키가 없을 때 스펙과 섹션 라이브러리의 폴백 문장으로 만드는 로컬 초안.
 * 구조·형식은 생성형 초안과 완전히 같다(같은 스펙에서 파생).
 */

import { getProductTokens } from "../brandlink-content-readiness";
import type { SectionTemplate } from "./section-library";
import type { GeneratedDraft, PostSpec } from "./types";

export function buildLocalTitle(spec: PostSpec, shortName: string): string {
  const keyword = spec.seo.primaryKeyword;
  const base = spec.connectKind === "TRAVEL" ? `${keyword} ${shortName} 일정과 포함사항` : `${keyword} ${shortName} 구성과 가격 확인`;
  const cleaned = base.replace(/\s+/g, " ").trim();
  if (cleaned.length <= spec.seo.title.maxChars) return cleaned;
  return cleaned.slice(0, spec.seo.title.maxChars).trim();
}

export function buildLocalDraft(spec: PostSpec, templates: SectionTemplate[], shortName: string): GeneratedDraft {
  return {
    title: buildLocalTitle(spec, shortName),
    sections: templates.map((template, index) => ({
      index,
      role: template.role,
      title: spec.sections[index]?.title || template.title,
      lines: template.fallbackLines.filter(Boolean),
    })),
    hashtags: [
      ...spec.seo.hashtags.required,
      ...getProductTokens(spec.productName).slice(0, 3),
      ...(spec.facts.travel?.destinations.slice(0, 2) || []),
      spec.seo.primaryKeyword.replace(/\s+/g, ""),
    ],
    source: "local-template",
    model: null,
    attempts: 0,
  };
}
