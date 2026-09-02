/**
 * Spec-first 파이프라인 진입점.
 *
 *   A. 이미지 풀 준비(보강 포함) → 섹션 수 파생 → PostSpec 확정 (LLM 없음)
 *   B. 구조화 생성 (OpenAI json_schema) 또는 로컬 템플릿
 *   C. 검증(전체 신호) → 타깃 수리 ≤ N 회
 *   D. 조립 (composition + 기존 preview 형식)
 */

import { buildProductEditorialPlan } from "../product-editorial-plan";
import type { OpenCrabSeoBrief } from "../opencrab-seo-brief";
import { getProductTokens } from "../brandlink-content-readiness";
import { isOpenAiAvailable } from "../openai-text";
import { extractTravelProductFacts, type TravelProductFacts } from "../travel-content";
import { assemblePost, normalizeDraft } from "./assemble";
import { generateDraftWithOpenAi, type GenerateContext } from "./generate";
import { assignImageSlots, prepareImagePool } from "./image-plan";
import { buildLocalDraft } from "./local-template";
import { repairableTargets, repairDraft } from "./repair";
import { buildSectionTemplates, SHAPE_RULES, type LibraryContext, type SectionTemplate } from "./section-library";
import { validateDraft } from "./validate";
import type { AssembledPost, ConnectKind, GeneratedDraft, ImageCandidateInput, PostSpec, SectionSpec } from "./types";

export * from "./types";
export { validateDraft } from "./validate";
export { assemblePost, normalizeDraft } from "./assemble";

export interface SpecFirstProductInput {
  name: string;
  description: string;
  features: string[];
  price: string;
  originalPrice?: string;
  discountRate?: string;
  couponInfo?: string;
  deliveryInfo?: string;
  reviewCount?: string;
  rating?: string;
  storeName?: string | null;
}

export interface SpecFirstPipelineInput {
  kind: ConnectKind;
  productId: string | null;
  product: SpecFirstProductInput;
  brief: OpenCrabSeoBrief | null;
  imageCandidates: ImageCandidateInput[];
  tempDir: string;
  brandLink: string;
  memo?: string | null;
  extraSystemRules?: string | null;
  options?: {
    maxRepairRounds?: number;
    allowLocalFallback?: boolean;
    quotationHeaders?: boolean;
    requireRepresentativeImage?: boolean;
    thumbnailGenerated?: boolean;
    forceLocal?: boolean;
  };
}

const GENERIC_HASHTAGS = [
  "추천", "후기", "리뷰", "비교", "순위", "가격", "장단점", "일상", "가성비", "생활용품", "쇼핑", "쇼핑추천",
  "구매전확인", "상품정보", "옵션확인", "구성확인", "가격비교", "할인정보", "실속쇼핑", "네이버쇼핑", "여행", "여행스타그램",
];

const SHOPPING_DISCLOSURE = `

이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.

자세한 상품 정보는 아래 쇼핑커넥트에서 확인해보세요.`;
const TRAVEL_DISCLOSURE = `

이 포스팅은 네이버 여행 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.

자세한 일정과 예약 정보는 아래 여행커넥트에서 확인해보세요.`;

export function shortProductName(name: string): string {
  const cleaned = name
    .replace(/\[[^\]]*\]|[<〈][^>〉]*[>〉]|\([^)]*\)/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(" ").filter(Boolean);
  let output = "";
  for (const token of tokens) {
    const next = output ? `${output} ${token}` : token;
    if (next.length > 24 && output) break;
    output = next;
    if (output.split(" ").length >= 5) break;
  }
  return output || cleaned.slice(0, 24) || name;
}

function todayLabel(): string {
  return new Date().toISOString().slice(0, 10);
}

function choosePrimaryKeyword(kind: ConnectKind, product: SpecFirstProductInput, brief: OpenCrabSeoBrief | null, travel: TravelProductFacts | null): string {
  if (kind === "TRAVEL") {
    const destination = travel?.destinations.slice(0, 1).join("") || "";
    if (destination) return `${destination} 패키지`;
  }
  const fromBrief = brief?.searchQueries?.[0]?.trim() || brief?.categoryLabel?.trim() || "";
  if (fromBrief) return fromBrief;
  const tokens = getProductTokens(product.name);
  return tokens[0] || shortProductName(product.name);
}

function sectionSpecFromTemplate(template: SectionTemplate, index: number, evidence: string[]): SectionSpec {
  const rule = SHAPE_RULES[template.shape];
  return {
    index,
    role: template.role,
    title: template.title,
    headerFormat: template.headerFormat,
    shape: template.shape,
    purpose: template.purpose,
    evidenceRule: template.evidenceRule,
    evidence,
    requiredKeywords: template.requiredKeywords,
    minChars: rule.minChars,
    maxChars: rule.maxChars,
    minLines: rule.minLines,
    maxLines: rule.maxLines,
    imageSlotIds: [],
    imageIntent: template.imageIntent,
    hints: template.hints,
  };
}

export interface BuiltSpec {
  spec: PostSpec;
  templates: SectionTemplate[];
  shortName: string;
}

export async function buildPostSpec(input: SpecFirstPipelineInput): Promise<BuiltSpec> {
  const { kind, product } = input;
  const editorial = buildProductEditorialPlan({
    productName: product.name,
    description: product.description,
    features: product.features,
    price: product.price,
    originalPrice: product.originalPrice,
    discountRate: product.discountRate,
    couponInfo: product.couponInfo,
    deliveryInfo: product.deliveryInfo,
    reviewCount: product.reviewCount,
    rating: product.rating,
    targetSectionCount: 9,
  });
  const travel = kind === "TRAVEL" ? extractTravelProductFacts(product.name, product.description, product.features) : null;
  const shortName = shortProductName(product.name);
  const primaryKeyword = choosePrimaryKeyword(kind, product, input.brief, travel);
  const destination = travel?.destinations.slice(0, 2).join("·") || "";

  // A′. 이미지 풀을 먼저 확정한다.
  const minBody = kind === "TRAVEL" ? 5 : 4;
  const targetBody = kind === "TRAVEL" ? 10 : 8;
  const pool = await prepareImagePool({
    kind,
    candidates: input.imageCandidates,
    minBody,
    targetBody,
    tempDir: input.tempDir,
    stockKeywords: travel ? [...travel.highlights.slice(0, 3), ...travel.destinations.slice(0, 2)].map((value) => `${value} travel`) : [],
  });
  const resolved = pool.body.length;

  // A. 확보된 이미지 수에서 섹션 수를 파생한다 (이미지를 못 채우는 섹션을 만들지 않는다).
  let sectionCount: number;
  if (kind === "SHOPPING") {
    sectionCount = resolved >= 7 ? 10 : resolved >= 5 ? 9 : 8;
  } else {
    const highlightCount = travel?.highlights.length || 0;
    let dayCourses = Math.max(1, Math.min(3, highlightCount || 1));
    dayCourses = Math.min(dayCourses, Math.max(1, resolved - 3));
    sectionCount = Math.max(10, Math.min(12, 9 + dayCourses));
  }

  const ctx: LibraryContext = {
    kind,
    productName: product.name,
    shortName,
    price: product.price,
    factLines: editorial.verifiedFactLines,
    travel,
    primaryKeyword,
    destination,
    duration: travel?.duration || "",
    highlights: travel?.highlights || [],
    hasReviewProof: Boolean(product.reviewCount || product.rating),
    collectedAt: todayLabel(),
  };
  const templates = buildSectionTemplates(ctx, sectionCount);
  const sections = templates.map((template, index) =>
    sectionSpecFromTemplate(template, index, template.role === "key-facts" || template.role === "offer-check" || template.role === "inclusions" ? editorial.verifiedFactLines : []),
  );
  const imagePlan = assignImageSlots(
    pool,
    templates.map((template, index) => ({ index, imageCount: template.imageCount, imageIntent: template.imageIntent })),
    kind,
    minBody,
    targetBody,
  );
  for (const slot of imagePlan.slots) {
    const section = sections[slot.sectionIndex];
    if (section) section.imageSlotIds.push(slot.id);
  }

  const productTokens = getProductTokens(product.name);
  const requiredHashtags =
    kind === "TRAVEL"
      ? [destination.replace(/·/g, ""), `${(travel?.destinations[0] || "").replace(/\s+/g, "")}패키지`, "패키지여행", ...(input.brief?.hashtags || []).slice(0, 2)]
      : [primaryKeyword.replace(/\s+/g, ""), ...(input.brief?.hashtags || []).slice(0, 3), ...productTokens.slice(0, 1)];
  const chunkIndexes = sections.map((section) => section.index);
  const chunks = kind === "TRAVEL" ? [chunkIndexes.slice(0, Math.ceil(chunkIndexes.length / 2)), chunkIndexes.slice(Math.ceil(chunkIndexes.length / 2))] : [chunkIndexes];

  const spec: PostSpec = {
    version: "post-spec/v1",
    connectKind: kind,
    productId: input.productId,
    productName: product.name,
    facts: { lines: editorial.verifiedFactLines, travel, blockedClaimRules: editorial.blockedClaimRules },
    brief: input.brief,
    sections,
    imagePlan,
    seo: {
      primaryKeyword,
      secondaryKeywords: (input.brief?.searchQueries || []).slice(1, 4),
      title: { minChars: 25, maxChars: 35, keywordFirst: true, mustIncludeTokens: kind === "TRAVEL" ? [travel?.destinations[0] || shortName].filter(Boolean) : productTokens.slice(0, 1) },
      firstSentenceMustInclude: kind === "TRAVEL" ? travel?.destinations[0] || shortName : shortName.split(" ")[0] || shortName,
      keywordMentionsPer1000: [1, 8],
      hashtags: { count: 5, required: requiredHashtags.filter((tag) => tag && tag.length >= 2), banned: GENERIC_HASHTAGS },
    },
    geo: {
      summaryLines: 3,
      factsMinLines: 4,
      faqCount: 3,
      checklistMin: 3,
      sourceLine: kind === "TRAVEL" ? `※ 상품 페이지 정보 기준 (${ctx.collectedAt} 확인), 가격·일정은 예약 시점에 따라 달라질 수 있어요.` : `※ 판매 페이지 정보 기준 (${ctx.collectedAt} 확인), 가격·구성은 변동될 수 있어요.`,
    },
    totalChars: kind === "TRAVEL" ? [2200, 3600] : [1300, 2400],
    disclosure: kind === "TRAVEL" ? TRAVEL_DISCLOSURE : SHOPPING_DISCLOSURE,
    generation: { mode: kind === "TRAVEL" ? "chunked" : "single", chunks, maxOutputTokens: 8192, temperature: 0.7 },
  };
  return { spec, templates, shortName };
}

export interface RunResult extends AssembledPost {
  notes: string[];
}

export async function runSpecFirstPipeline(input: SpecFirstPipelineInput): Promise<RunResult> {
  const notes: string[] = [];
  const built = await buildPostSpec(input);
  const { spec, templates, shortName } = built;
  notes.push(...spec.imagePlan.notes);
  const ctx: GenerateContext = { memo: input.memo, extraSystemRules: input.extraSystemRules };
  const validateOptions = {
    brandLink: input.brandLink,
    hasRepresentativeImage: Boolean(spec.imagePlan.hero),
    requireRepresentativeImage: input.options?.requireRepresentativeImage ?? true,
    thumbnailGenerated: input.options?.thumbnailGenerated ?? true,
    maxRepairAttempts: input.options?.maxRepairRounds ?? 2,
  };

  let draft: GeneratedDraft;
  const useOpenAi = !input.options?.forceLocal && isOpenAiAvailable();
  if (useOpenAi) {
    try {
      draft = normalizeDraft(spec, await generateDraftWithOpenAi(spec, ctx));
    } catch (error) {
      if (!(input.options?.allowLocalFallback ?? true)) throw error;
      notes.push(`OpenAI 생성 실패, 로컬 템플릿으로 대체: ${error instanceof Error ? error.message : String(error)}`);
      draft = normalizeDraft(spec, buildLocalDraft(spec, templates, shortName));
    }
  } else {
    if (!(input.options?.allowLocalFallback ?? true)) throw new Error("OPENAI_API_KEY가 없어 글을 생성할 수 없습니다.");
    notes.push("OPENAI_API_KEY 없음 — 로컬 템플릿 초안");
    draft = normalizeDraft(spec, buildLocalDraft(spec, templates, shortName));
  }

  let report = validateDraft(spec, draft, validateOptions);
  const maxRounds = validateOptions.maxRepairAttempts;
  for (let round = 0; round < maxRounds && draft.source === "openai"; round += 1) {
    if (repairableTargets(report).length === 0) break;
    notes.push(`수리 라운드 ${round + 1}: ${repairableTargets(report).map((t) => `${t.sectionIndex ?? "title"}:${t.code}`).join(", ")}`);
    const repaired = normalizeDraft(spec, await repairDraft(spec, draft, report, ctx));
    const nextReport = validateDraft(spec, repaired, validateOptions);
    if (nextReport.score >= report.score) {
      draft = repaired;
      report = nextReport;
    } else {
      notes.push(`수리 라운드 ${round + 1} 결과가 더 나빠 원본 유지 (${nextReport.score} < ${report.score})`);
      break;
    }
  }

  const assembled = assemblePost(spec, draft, report, { quotationHeaders: input.options?.quotationHeaders ?? false });
  return { ...assembled, notes };
}

export interface ReviseInput {
  spec: PostSpec;
  draft: GeneratedDraft;
  instructions: string;
  sectionIndexes?: number[];
  brandLink: string;
  options?: { quotationHeaders?: boolean; thumbnailGenerated?: boolean };
}

/** 저장된 스펙/초안에 사용자 지시를 반영해 지정 섹션(없으면 검증 타깃)만 다시 쓴다. */
export async function reviseAssembledPost(input: ReviseInput): Promise<RunResult> {
  const { spec } = input;
  const ctx: GenerateContext = { memo: input.instructions };
  const validateOptions = {
    brandLink: input.brandLink,
    hasRepresentativeImage: Boolean(spec.imagePlan.hero),
    requireRepresentativeImage: true,
    thumbnailGenerated: input.options?.thumbnailGenerated ?? true,
    maxRepairAttempts: 1,
  };
  let draft = normalizeDraft(spec, input.draft);
  const base = validateDraft(spec, draft, validateOptions);
  const explicit = (input.sectionIndexes || []).filter((index) => spec.sections[index]);
  const targets = explicit.length
    ? explicit.map((index) => ({ sectionIndex: index, code: "USER_REVISION", priority: "P1" as const, reason: "사용자 수정 요청", instruction: input.instructions }))
    : repairableTargets(base).length
      ? repairableTargets(base)
      : spec.sections.map((section) => ({ sectionIndex: section.index, code: "USER_REVISION", priority: "P1" as const, reason: "사용자 수정 요청", instruction: input.instructions }));
  const report = { ...base, repair: { ...base.repair, targets } };
  draft = normalizeDraft(spec, await repairDraft(spec, draft, report, ctx));
  const finalReport = validateDraft(spec, draft, validateOptions);
  const assembled = assemblePost(spec, draft, finalReport, { quotationHeaders: input.options?.quotationHeaders ?? false });
  return { ...assembled, notes: [`수정 요청 반영: ${targets.map((t) => t.sectionIndex).join(", ")}`] };
}
