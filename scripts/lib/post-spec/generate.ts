/**
 * STAGE B — 스펙을 채우는 구조화 생성.
 * 섹션 제목은 스펙에서 고정하고, 모델은 각 섹션의 줄(lines)만 쓴다.
 */

import { buildHumanMobileStyleGuide, NAVER_SEO_TITLE_RULES } from "../blog-writing-style";
import { HUMANIZE_RULES } from "../humanize-korean";
import { formatOpenCrabSeoBriefForPrompt } from "../opencrab-seo-brief";
import { formatTravelFactsForPrompt } from "../travel-content";
import { formatWritingStructureGuide } from "../writing-structure-guide";
import { formatEditorialTemplate, selectEditorialTemplate } from "../editorial-templates";
import { otherSectionsEvidence } from "./evidence-ledger";
import { generateStructured } from "./llm-client";
import { buildDraftJsonSchema, sectionKey } from "./schema";
import { SHAPE_RULES } from "./section-library";
import type { GeneratedDraft, GeneratedSection, PostSpec, SectionSpec } from "./types";

export interface GenerateContext {
  /** 사용자 메모/지시 (MCP memo 등) */
  memo?: string | null;
  extraSystemRules?: string | null;
}

export function renderSystemPrompt(spec: PostSpec, ctx: GenerateContext): string {
  const briefBlock = formatOpenCrabSeoBriefForPrompt(spec.brief);
  const travelBlock = spec.facts.travel ? formatTravelFactsForPrompt(spec.facts.travel) : "";
  return [
    spec.connectKind === "TRAVEL"
      ? "당신은 확인된 상품 정보와 여행지 자료를 근거로 여행 판단을 돕는 네이버 블로거입니다. 제공되거나 실제 확인한 자료 안에서만 사실을 쓰고 직접 다녀온 경험을 만들지 마세요."
      : "당신은 상품 정보를 근거로 구매 판단을 돕는 글을 쓰는 인기 네이버 블로거입니다. 직접 써본 후기가 아니라 판매 페이지 정보를 바탕으로 쓰는 '검토형' 글입니다.",
    buildHumanMobileStyleGuide(),
    HUMANIZE_RULES,
    NAVER_SEO_TITLE_RULES,
    formatWritingStructureGuide(spec.connectKind),
    formatEditorialTemplate(spec.connectKind, spec.editorial?.id ?? selectEditorialTemplate(spec.connectKind, {
      name: spec.productName, features: spec.facts.lines,
    })),
    "- 위 구성 가이드는 지정된 섹션 안의 전개와 문장에 적용합니다. 섹션 ID·순서·제목과 JSON 스키마는 유지하고, 지정된 목록·접두사 형식은 해당 섹션에서만 지킵니다.",
    "- 각 섹션의 제목은 지시된 그대로 사용하고 바꾸지 마세요.",
    "- 섹션마다 지정된 형식(줄 수·글자 수·접두사)을 정확히 지키세요.",
    "- 본문은 자연스러운 존댓말로 쓰고 짧은 문장과 설명 문장을 섞습니다. 검토 의견은 확인 사실과 적용 조건으로 뒷받침하고, 실제 구매·사용·방문이나 자료를 찾아본 행동을 지어내지 마세요.",
    "- URL, 내부 지침, 역할 이름, JSON 키는 본문에 쓰지 마세요.",
    "- 섹션마다 '이 섹션 전용 근거'를 최소 1개 골라 수치·이름을 그대로 쓰고, 그 근거가 독자에게 무엇을 뜻하는지 설명합니다. 같은 문장 또는 같은 섹션·문단의 바로 다음 문장에서 근거와 이점을 연결할 수 있습니다. 다른 소제목의 근거를 끌어오거나 근거 없는 효과를 덧붙이지 마세요.",
    "- 다른 섹션 전용 근거와 앞 섹션에서 이미 쓴 문장·판단은 되풀이하지 않습니다. 같은 뜻을 어미만 바꿔 다시 쓰는 것도 반복입니다.",
    "- '확인해보세요', '살펴보는 게 좋아요', '상황에 따라 달라요' 같은 확인 안내·일반론 문장은 섹션당 1개까지만 씁니다. 근거가 없으면 문단을 짧게 끝내고 안내 문장으로 채우지 않습니다.",
    briefBlock,
    travelBlock,
    "[금지 주장]",
    ...spec.facts.blockedClaimRules.map((rule) => `- ${rule}`),
    ctx.extraSystemRules || "",
  ]
    .filter((block) => block && block.trim().length > 0)
    .join("\n\n");
}

export function renderFactsBlock(spec: PostSpec): string {
  return [
    "## 확인된 상품 정보 (이 범위 안에서만 사실을 씁니다)",
    ...(spec.facts.lines.length ? spec.facts.lines.map((line) => `- ${line}`) : [`- 상품명: ${spec.productName}`]),
  ].join("\n");
}

export function renderTitleRules(spec: PostSpec): string {
  const t = spec.seo.title;
  return [
    "## 제목 규칙",
    `- ${t.minChars}~${t.maxChars}자, 핵심 키워드 "${spec.seo.primaryKeyword}"를 제목 앞쪽에 배치`,
    t.mustIncludeTokens.length ? `- 제목에 반드시 포함: ${t.mustIncludeTokens.join(", ")}` : "",
    "- 이모지·특수기호·낚시성 문구(완벽 가이드/총정리/꿀팁) 금지",
    spec.connectKind === "TRAVEL"
      ? '- 예: "대만 3박4일 패키지 일정과 포함사항 정리" 처럼 검색어를 자연스럽게 나열'
      : '- 예: "아기비데 추천 | 해피달링 시그니처 워터탭 구성과 가격" 처럼 키워드 + 상품명',
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderSectionInstruction(section: SectionSpec, spec: PostSpec): string {
  const rule = SHAPE_RULES[section.shape];
  const mustUse = section.mustUseEvidence || [];
  const sharedEvidence = section.evidence.filter((line) => !mustUse.includes(line));
  const others = otherSectionsEvidence(spec.evidenceLedger || [], section.index, spec.sections.map((item) => item.title));
  const imageNote =
    section.imageSlotIds.length > 0
      ? `- 이 섹션 앞에 이미지 ${section.imageSlotIds.length}장이 옵니다: ${section.imageIntent}. 사진과 어긋나지 않게 쓰세요.`
      : section.index === 0
        ? "- 이 섹션 앞에 대표 이미지(썸네일)가 옵니다."
        : "- 이 섹션에는 이미지가 없습니다.";
  return [
    `### ${sectionKey(section.index)} · 제목: "${section.title}" (그대로 사용)`,
    `- 역할: ${section.purpose}`,
    `- 근거 규칙: ${section.evidenceRule}`,
    `- 형식: ${rule.formatHint}`,
    `- 분량: ${section.minLines}~${section.maxLines}줄, 공백 제외 ${section.minChars}~${section.maxChars}자`,
    section.requiredKeywords.length ? `- 반드시 포함: ${section.requiredKeywords.join(", ")}` : "",
    mustUse.length
      ? `- 이 섹션 전용 근거 (최소 1개는 수치·이름 그대로 사용, 다른 섹션에서는 쓰지 않음): ${mustUse.join(" / ")}`
      : "",
    sharedEvidence.length ? `- 함께 참조할 수 있는 공용 근거: ${sharedEvidence.join(" / ")}` : "",
    others.length ? `- 다른 섹션 전용 근거 (여기서는 쓰지 않기): ${others.slice(0, 6).join(" | ")}` : "",
    imageNote,
    ...section.hints.map((hint) => `- ${hint}`),
    spec.connectKind === "TRAVEL" && section.role === "day-course"
      ? "- 실제 방문 경험을 만들지 말고 '찾아보니 ~라고 해요' 식의 조사형으로 팁을 쓰세요."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderHashtagRules(spec: PostSpec): string {
  const h = spec.seo.hashtags;
  return [
    `## 해시태그 (${h.count}개)`,
    `- 반드시 포함: ${h.required.join(", ")}`,
    "- 검색 의도가 분명한 태그만. 개수를 채우기 위한 일반 태그(추천/후기/일상 등)는 넣지 마세요.",
    "- '#' 없이 단어만, 공백 없이.",
  ].join("\n");
}

function previousChunkSummary(sections: GeneratedSection[]): string {
  if (sections.length === 0) return "";
  return [
    "## 앞서 작성된 섹션 (같은 근거·같은 판단을 되풀이하지 마세요)",
    ...sections.map((section) => `- ${section.title}: ${section.lines.slice(0, 2).join(" ")}`),
  ].join("\n");
}

interface RawSection {
  role?: string;
  title?: string;
  lines?: unknown;
}

function toGeneratedSection(section: SectionSpec, raw: RawSection | undefined): GeneratedSection {
  const lines = Array.isArray(raw?.lines)
    ? raw!.lines.filter((line): line is string => typeof line === "string")
    : typeof raw?.lines === "string"
      ? String(raw.lines).split("\n")
      : [];
  return { index: section.index, role: section.role, title: section.title, lines };
}

export async function generateDraftWithOpenAi(spec: PostSpec, ctx: GenerateContext): Promise<GeneratedDraft> {
  const system = renderSystemPrompt(spec, ctx);
  const generated: GeneratedSection[] = [];
  let title = "";
  let hashtags: string[] = [];
  let model: string | null = null;
  let attempts = 0;

  for (let chunkIndex = 0; chunkIndex < spec.generation.chunks.length; chunkIndex += 1) {
    const indexes = spec.generation.chunks[chunkIndex];
    const includeMeta = chunkIndex === 0;
    const schema = buildDraftJsonSchema(spec, indexes, includeMeta);
    const user = [
      spec.connectKind === "TRAVEL"
        ? "다음 여행 상품을 예약 전에 검토하는 블로그 글을 작성해주세요."
        : "다음 상품의 구매 판단을 돕는 블로그 글을 작성해주세요.",
      renderFactsBlock(spec),
      ctx.memo ? `## 요청 메모\n${ctx.memo}` : "",
      includeMeta ? renderTitleRules(spec) : "",
      previousChunkSummary(generated),
      `## 섹션 작성 지시 (${indexes.length}개, 키 이름과 제목을 그대로 사용)`,
      ...indexes.map((index) => renderSectionInstruction(spec.sections[index], spec)),
      includeMeta ? renderHashtagRules(spec) : "",
      "## 출력",
      includeMeta
        ? `JSON 객체 하나만. 키: title, hashtags, sections. sections 는 ${indexes.map(sectionKey).join(", ")} 키를 가진 객체이며 각 값은 {role, title, lines[]} 입니다.`
        : `JSON 객체 하나만. 키: sections. sections 는 ${indexes.map(sectionKey).join(", ")} 키를 가진 객체이며 각 값은 {role, title, lines[]} 입니다.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await generateStructured<{ title?: string; hashtags?: unknown; sections?: Record<string, RawSection> }>({
      system,
      user,
      schema,
      schemaName: `blog_post_${spec.connectKind.toLowerCase()}_${chunkIndex}`,
      maxOutputTokens: spec.generation.maxOutputTokens,
      temperature: spec.generation.temperature,
    });
    attempts += 1;
    model = result.model;
    if (includeMeta) {
      title = typeof result.json.title === "string" ? result.json.title.trim() : "";
      hashtags = Array.isArray(result.json.hashtags)
        ? result.json.hashtags.filter((tag): tag is string => typeof tag === "string")
        : [];
    }
    const sectionsObject = result.json.sections || {};
    for (const index of indexes) {
      generated.push(toGeneratedSection(spec.sections[index], sectionsObject[sectionKey(index)]));
    }
  }

  return { title, sections: generated, hashtags, source: "openai", model, attempts };
}
