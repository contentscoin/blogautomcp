/**
 * STAGE B — 스펙을 채우는 구조화 생성.
 * 섹션 제목은 스펙에서 고정하고, 모델은 각 섹션의 줄(lines)만 쓴다.
 */

import { buildHumanMobileStyleGuide, NAVER_SEO_TITLE_RULES } from "../blog-writing-style";
import { HUMANIZE_RULES } from "../humanize-korean";
import { formatOpenCrabSeoBriefForPrompt } from "../opencrab-seo-brief";
import { formatTravelFactsForPrompt } from "../travel-content";
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
      ? "당신은 여행 상품을 예약 전에 꼼꼼히 검토해 정리하는 인기 네이버 블로거입니다. 직접 다녀온 후기가 아니라 상품 정보와 널리 알려진 여행지 정보를 바탕으로 쓰는 '검토형' 글입니다."
      : "당신은 상품 정보를 근거로 구매 판단을 돕는 글을 쓰는 인기 네이버 블로거입니다. 직접 써본 후기가 아니라 판매 페이지 정보를 바탕으로 쓰는 '검토형' 글입니다.",
    buildHumanMobileStyleGuide(),
    HUMANIZE_RULES,
    NAVER_SEO_TITLE_RULES,
    "- 각 섹션의 제목은 지시된 그대로 사용하고 바꾸지 마세요.",
    "- 섹션마다 지정된 형식(줄 수·글자 수·접두사)을 정확히 지키세요.",
    "- 본문 문장은 부드러운 ~요체로, 개인 검토 소감(~더라고요, ~마음에 들었어요, 찾아보니 ~라고 해요)은 허용하되 실제 구매·사용·방문 사실은 단정하지 마세요.",
    "- URL, 내부 지침, 역할 이름, JSON 키는 본문에 쓰지 마세요.",
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
    section.evidence.length ? `- 이 섹션에서 쓸 수 있는 근거: ${section.evidence.join(" / ")}` : "",
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
    "## 앞서 작성된 섹션 (반복하지 마세요)",
    ...sections.map((section) => `- ${section.title}: ${section.lines[0] || ""}`),
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
