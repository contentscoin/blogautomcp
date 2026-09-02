import {
  assessProductEditorialCoverage,
  assessProductReviewSubstance,
} from "./product-editorial-plan";
import { assessTravelReviewSubstance } from "./travel-content";
import { assessGenericLanguage, assessRepetition } from "./draft-quality-signals";
import type {
  BrandConnectKind,
  PostExperienceMode,
  PostQualityReportV1,
} from "../../src/lib/post-composition-contract";
import { getPostCompositionContract } from "../../src/lib/post-composition-contract";

export type PostGenerationSource =
  | "AI"
  | "PREPARED_APPROVED"
  | "LOCAL_FALLBACK"
  | "UNKNOWN";

export interface BrandLinkContentReadinessInput {
  productName: string;
  title: string;
  sections: string[];
  hashtags: string[];
  brandLink: string;
  generationSource: PostGenerationSource;
  hasRepresentativeImage: boolean;
  requireRepresentativeImage?: boolean;
  thumbnailGenerated?: boolean;
  connectKind?: BrandConnectKind;
  experienceMode?: PostExperienceMode;
  compositionQualityReport?: PostQualityReportV1 | null;
  sourceDescription?: string | null;
  sourceFeatures?: string[];
  mode?: "publish" | "editorial";
}

export interface BrandLinkContentReadinessSignal {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
}

export type BrandLinkReadinessCode =
  | "ok"
  | "missing-product-name"
  | "too-few-sections"
  | "too-short-content"
  | "too-few-hashtags"
  | "link-in-body"
  | "missing-disclosure"
  | "unsupported-experience-claim"
  | "commission-rate-exposed"
  | "internal-guidance-leak"
  | "missing-review-substance"
  | "low-evidence-density"
  | "generic-guidance-heavy"
  | "category-mismatch"
  | "repetitive-content"
  | "quality-score-below-threshold"
  | "non-generative-fallback"
  | "missing-representative-image"
  | "composition-quality";

/**
 * 하드 차단: 점수와 무관하게 발행을 막는다.
 *  - safety: 허위 체험, 미확인 상품 사실(카테고리 혼입), 내부 지침 노출, 필수 고지 누락, URL 노출, 수수료율 노출
 *  - structure: 상품명 누락, 섹션·분량·해시태그 부족, 대표 이미지 없음, 렌더 계약 실패
 */
export interface BrandLinkReadinessBlocker {
  code: Exclude<BrandLinkReadinessCode, "ok" | "missing-review-substance" | "low-evidence-density" | "generic-guidance-heavy" | "repetitive-content" | "quality-score-below-threshold">;
  tier: "safety" | "structure";
  reason: string;
}

export type BrandLinkQualityCategoryKey =
  | "productEvidence"
  | "sceneLinkage"
  | "specificity"
  | "diversity"
  | "usefulness"
  | "clarity";

export interface BrandLinkQualityCategory {
  key: BrandLinkQualityCategoryKey;
  label: string;
  score: number;
  maxScore: number;
  status: "pass" | "warn" | "fail";
  notes: string[];
}

export interface BrandLinkQualityReport {
  /** 0~100. 하드 차단과 무관한 순수 품질 점수. */
  score: number;
  /** 이 점수 이상이고 fail 카테고리가 없어야 통과 */
  passScore: number;
  categories: BrandLinkQualityCategory[];
  repetition: {
    nearDuplicateCount: number;
    exactDuplicateCount: number;
    duplicateOpeningCount: number;
    samples: Array<{ a: string; b: string; similarity: number }>;
  };
  generic: {
    sentenceCount: number;
    guidanceCount: number;
    generalStatementCount: number;
    guidanceRatio: number;
    generalRatio: number;
    threshold: number;
  };
}

export interface BrandLinkContentReadiness {
  canPublish: boolean;
  /** pass: 발행 가능 / blocked: 하드 차단 / quality: 품질 미달 */
  verdict: "pass" | "blocked" | "quality";
  code: BrandLinkReadinessCode;
  reason: string | null;
  /** quality.score 와 같다. 하드 차단이 있어도 품질 점수는 그대로 보고한다. */
  score: number;
  sectionCount: number;
  hashtagCount: number;
  totalLength: number;
  coveredProductTokens: string[];
  missingProductTokens: string[];
  signals: BrandLinkContentReadinessSignal[];
  summary: string;
  blockers: BrandLinkReadinessBlocker[];
  quality: BrandLinkQualityReport;
}

export const BRANDLINK_QUALITY_PASS_SCORE = 70;

const GENERIC_PRODUCT_TOKENS = new Set([
  "추천",
  "후기",
  "리뷰",
  "가격",
  "구매",
  "상품",
  "제품",
  "정품",
  "무료",
  "무료배송",
  "할인",
  "쿠폰",
  "공식",
  "옵션",
  "세트",
]);

export const UNSUPPORTED_EXPERIENCE_PATTERNS = [
  /(?:제가|저도|직접)\s*(?:구매|주문|사용|써|받아|개봉|체험|먹어|발라|입어|신어)/u,
  /(?:구매|주문|사용|써|받아|개봉|체험|먹어|발라|입어|신어)\s*해?\s*봤/u,
  /택배\s*(?:도착|받아|열어|뜯어)/u,
  /재구매\s*(?:의사|하고|할|각)/u,
  /(?:강력\s*추천|후회\s*없는\s*선택|무조건\s*추천)/u,
  /(?:직접\s*)?(?:다녀왔|방문했|묵어봤|먹어봤|걸어봤|찍어봤|탑승했)/u,
  /(?:공항|숙소|호텔|여행지)에\s*도착하니/u,
] as const;

const UNSUPPORTED_EXPERIENCE_TITLE_PATTERN = /(?:내돈내산|실사용|직접\s*(?:써본|다녀온)|솔직\s*후기|체험\s*후기)/u;

function assessTravelEditorialCoverage(sections: string[]): {
  coveredRoles: string[];
  missingCoreRoles: string[];
} {
  const corpus = sections.join("\n");
  const rolePatterns: Record<string, RegExp> = {
    background: /역사|문화|유래|전통|건축|지형|유산/u,
    atmosphere: /분위기|풍경|골목|거리|강변|해안|노을|야경|전망/u,
    experience: /즐기|걷|산책|관람|사진|촬영|먹|맛보|체험|시장|카페/u,
    preparation: /교통|이동|준비물|복장|신발|시간대|동선|예절/u,
    route: /일정|하루|코스|동선|이동|방문지/u,
  };
  const coveredRoles = Object.entries(rolePatterns)
    .filter(([, pattern]) => pattern.test(corpus))
    .map(([role]) => role);
  // 상품 검토 항목이 아니라 여행지를 이해하고 즐기는 데 필요한 핵심 역할을 본다.
  const coreRoles = ["background", "atmosphere", "experience", "preparation"];
  return {
    coveredRoles,
    missingCoreRoles: coreRoles.filter((role) => !coveredRoles.includes(role)),
  };
}

export const COMMISSION_RATE_PATTERNS = [
  /(?:수수료|커미션|commission)\s*\d/iu,
  /\d+(?:\.\d+)?\s*%\s*(?:수수료|커미션|commission)/iu,
  /(?:제휴율|정산\s*조건|내부\s*정산)/u,
] as const;

export const INTERNAL_GUIDANCE_PATTERNS = [
  /상위\s*노출\s*글에서/u,
  /제품명,\s*사용\s*장면,\s*구매\s*전\s*확인\s*포인트/u,
  /상세페이지의\s*주요\s*기능\s*같은\s*정보/u,
  /구매\s*전에\s*상품명과\s*옵션을\s*먼저\s*확인/u,
  /(?:opencrab|오픈크랩|seo\s*브리프|리서치\s*(?:팩|브리프)|워크플로우)/iu,
  /(?:작성\s*(?:규칙|지침|가이드|프로세스)|프롬프트|출력\s*형식|json\s*만|시스템\s*지시|사용자\s*요청)/iu,
  /(?:recommendedSectionTitles|sections\s*:|hashtags\s*:)/iu,
] as const;

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeLoose(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getProductTokens(productName: string): string[] {
  const normalized = normalizeLoose(productName);
  if (!normalized) return [];

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of normalized.split(/\s+/)) {
    if (token.length < 2) continue;
    if (GENERIC_PRODUCT_TOKENS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= 6) break;
  }
  return tokens;
}

function countPatternHits(value: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

const TRAVEL_SHOPPING_INTRUSION_PATTERN = /(?:배송|교환|반품|구성품|제품\s*스펙|무료배송|정품)/u;

interface QualityComputation {
  quality: BrandLinkQualityReport;
  failingCategories: BrandLinkQualityCategory[];
}

function categoryStatus(score: number, maxScore: number, hardFail: boolean): BrandLinkQualityCategory["status"] {
  if (hardFail) return "fail";
  return score >= maxScore ? "pass" : "warn";
}

function ratioScore(actual: number, required: number, maxScore: number): number {
  if (required <= 0) return maxScore;
  return Math.round(Math.min(1, actual / required) * maxScore);
}

function buildQualityReport(input: {
  isTravel: boolean;
  bodySections: string[];
  reviewSubstance: ReturnType<typeof assessProductReviewSubstance> | ReturnType<typeof assessTravelReviewSubstance>;
  sourceEvidenceCoveragePass: boolean;
  editorialMissingCoreRoles: string[];
  evidenceTokens: string[];
}): QualityComputation {
  const { isTravel, reviewSubstance } = input;
  const body = input.bodySections.join("\n");
  const repetition = assessRepetition(input.bodySections);
  const generic = assessGenericLanguage(body, { evidenceTokens: input.evidenceTokens });
  const guidanceThreshold = isTravel ? 0.16 : 0.24;
  const generalThreshold = 0.4;

  // 1. 상품·여행지 고유 근거
  const coveredEvidence = "coveredSignals" in reviewSubstance ? reviewSubstance.coveredSignals.length : reviewSubstance.coveredPlaces.length;
  const requiredEvidence = "coveredSignals" in reviewSubstance ? reviewSubstance.requiredSignalCount : reviewSubstance.requiredPlaceCount;
  const evidenceFail = coveredEvidence < requiredEvidence || !input.sourceEvidenceCoveragePass;
  const productEvidence: BrandLinkQualityCategory = {
    key: "productEvidence",
    label: isTravel ? "여행지 고유 근거" : "상품 고유 근거",
    maxScore: 25,
    score: evidenceFail ? Math.min(14, ratioScore(coveredEvidence, requiredEvidence, 25)) : 25,
    status: categoryStatus(evidenceFail ? 0 : 25, 25, evidenceFail),
    notes: evidenceFail
      ? [isTravel
          ? `핵심 방문지 ${coveredEvidence}/${requiredEvidence}곳만 본문에 등장합니다.`
          : `확인된 기능·수치 ${coveredEvidence}/${requiredEvidence}개만 본문에 등장합니다.`]
      : [],
  };

  // 2. 사용 장면·여행 장면 연결
  const linkageFail = reviewSubstance.evidenceJudgementCount < reviewSubstance.requiredEvidenceJudgementCount;
  const sceneLinkage: BrandLinkQualityCategory = {
    key: "sceneLinkage",
    label: isTravel ? "여행지 사실-현장 장면 연결" : "기능-사용 장면 연결",
    maxScore: 20,
    score: linkageFail
      ? Math.min(11, ratioScore(reviewSubstance.evidenceJudgementCount, reviewSubstance.requiredEvidenceJudgementCount, 20))
      : 20,
    status: categoryStatus(linkageFail ? 0 : 20, 20, linkageFail),
    notes: linkageFail
      ? [`근거를 장면·판단으로 연결한 문장 ${reviewSubstance.evidenceJudgementCount}/${reviewSubstance.requiredEvidenceJudgementCount}개`]
      : [],
  };

  // 3. 정보의 구체성
  let specificityScore = 0;
  const specificityNotes: string[] = [];
  let specificityFail = false;
  if ("usageInstructionCount" in reviewSubstance) {
    const usageOk = reviewSubstance.usageInstructionCount >= 2;
    const readingRatio = reviewSubstance.detailReadingCount / Math.max(1, reviewSubstance.sentenceCount);
    const readingOk = readingRatio <= 0.15;
    specificityScore = (usageOk ? 7 : Math.min(4, reviewSubstance.usageInstructionCount * 3)) + (readingOk ? 8 : readingRatio <= 0.25 ? 4 : 0);
    specificityFail = !usageOk || !readingOk;
    if (!usageOk) specificityNotes.push("설치·조작·관리 같은 구체적인 사용 방법 문장이 2개 미만입니다.");
    if (!readingOk) specificityNotes.push("상세페이지를 읽어주는 문장 비율이 높습니다.");
  } else {
    const parts: Array<[number, number, string]> = [
      [reviewSubstance.backgroundFactCount, 2, "역사·문화·지리 배경"],
      [reviewSubstance.atmosphereCount, 3, "현장 풍경·분위기"],
      [reviewSubstance.activityCount, 4, "실제 즐길 거리"],
      [reviewSubstance.practicalTipCount, 2, "이동·복장·시간대 팁"],
    ];
    for (const [count, required, label] of parts) {
      const ok = count >= required;
      specificityScore += ok ? 4 : Math.min(2, Math.round((count / required) * 4));
      if (!ok) {
        specificityFail = true;
        specificityNotes.push(`${label} 문장 ${count}/${required}개`);
      }
    }
    specificityScore = Math.min(15, specificityScore);
  }
  const specificity: BrandLinkQualityCategory = {
    key: "specificity",
    label: "정보의 구체성",
    maxScore: 15,
    score: Math.min(15, specificityScore),
    status: categoryStatus(specificityFail ? 0 : 15, 15, specificityFail),
    notes: specificityNotes,
  };

  // 4. 문단 다양성 (반복)
  const repeatLimit = 2;
  const diversityFail = repetition.nearDuplicateCount > repeatLimit;
  const diversity: BrandLinkQualityCategory = {
    key: "diversity",
    label: "문단 다양성·문장 반복",
    maxScore: 15,
    score: Math.max(0, 15 - Math.max(0, repetition.nearDuplicateCount - repeatLimit) * 3 - repetition.duplicateOpeningCount * 2),
    status: categoryStatus(diversityFail ? 0 : 15, 15, diversityFail),
    notes: diversityFail
      ? [`뜻이 겹치는 문장 ${repetition.nearDuplicateCount}개${repetition.samples[0] ? ` (예: "${repetition.samples[0].b.slice(0, 40)}")` : ""}`]
      : repetition.duplicateOpeningCount > 0
        ? [`같은 문장으로 시작하는 문단 ${repetition.duplicateOpeningCount}개`]
        : [],
  };

  // 5. 독자에게 실제 도움이 되는 정도
  const substanceMissing = reviewSubstance.missingElements.filter((label) =>
    !/(?:반복 문장|확인 안내|카테고리|쇼핑 문구|고유 구조|고유 정보|근거와 사용 가치|현장 경험의 연결|사용·설치·관리|낭독형|배경|풍경|즐길 거리|실용 팁|핵심 여행지별)/u.test(label),
  );
  const roleMissing = input.editorialMissingCoreRoles.length > 1;
  const usefulnessFail = substanceMissing.length > 0 || roleMissing;
  const usefulness: BrandLinkQualityCategory = {
    key: "usefulness",
    label: isTravel ? "여행자 판단에 필요한 요소" : "구매 판단에 필요한 요소",
    maxScore: 15,
    score: Math.max(0, 15 - substanceMissing.length * 4 - Math.max(0, input.editorialMissingCoreRoles.length - 1) * 3),
    status: categoryStatus(usefulnessFail ? 0 : 15, 15, usefulnessFail),
    notes: [...substanceMissing, ...(roleMissing ? ["필수 흐름(배경·장면·장단점·대상·결론) 중 2개 이상이 비어 있습니다."] : [])],
  };

  // 6. 문장 반복·일반론 비율 (확인 안내)
  const guidanceOver = generic.guidanceRatio > guidanceThreshold;
  const generalOver = generic.generalRatio > generalThreshold;
  const clarityFail = guidanceOver || generalOver;
  const guidanceScore = guidanceOver
    ? Math.max(0, Math.round(10 * (1 - (generic.guidanceRatio - guidanceThreshold) / guidanceThreshold)))
    : 10;
  const clarity: BrandLinkQualityCategory = {
    key: "clarity",
    label: "확인 안내·일반론 비율",
    maxScore: 10,
    score: Math.max(0, Math.min(10, guidanceScore - (generalOver ? 4 : generic.generalRatio > generalThreshold / 2 ? 2 : 0))),
    status: categoryStatus(clarityFail ? 0 : 10, 10, clarityFail),
    notes: [
      ...(guidanceOver ? [`확인 안내 문장 ${generic.guidanceCount}/${generic.sentenceCount}개`] : []),
      ...(generalOver ? [`근거 없는 일반론 문장 ${generic.generalStatementCount}/${generic.sentenceCount}개`] : []),
    ],
  };

  const categories = [productEvidence, sceneLinkage, specificity, diversity, usefulness, clarity];
  const score = Math.max(0, Math.min(100, categories.reduce((sum, item) => sum + item.score, 0)));
  return {
    quality: {
      score,
      passScore: BRANDLINK_QUALITY_PASS_SCORE,
      categories,
      repetition: {
        nearDuplicateCount: repetition.nearDuplicateCount,
        exactDuplicateCount: repetition.exactDuplicateCount,
        duplicateOpeningCount: repetition.duplicateOpeningCount,
        samples: repetition.samples,
      },
      generic: {
        sentenceCount: generic.sentenceCount,
        guidanceCount: generic.guidanceCount,
        generalStatementCount: generic.generalStatementCount,
        guidanceRatio: Number(generic.guidanceRatio.toFixed(3)),
        generalRatio: Number(generic.generalRatio.toFixed(3)),
        threshold: guidanceThreshold,
      },
    },
    failingCategories: categories.filter((item) => item.status === "fail"),
  };
}

function qualityCodeFor(category: BrandLinkQualityCategory): BrandLinkReadinessCode {
  switch (category.key) {
    case "diversity":
      return "repetitive-content";
    case "clarity":
      return "generic-guidance-heavy";
    case "productEvidence":
    case "sceneLinkage":
      return "low-evidence-density";
    default:
      return "missing-review-substance";
  }
}

/** 품질 카테고리가 여럿 실패하면 이 순서로 대표 코드를 고른다 (반복 → 일반론 → 근거 → 판단 요소). */
const QUALITY_CODE_PRIORITY: BrandLinkQualityCategoryKey[] = ["diversity", "clarity", "productEvidence", "sceneLinkage", "specificity", "usefulness"];

function buildResult(input: {
  code: BrandLinkReadinessCode;
  verdict: BrandLinkContentReadiness["verdict"];
  reason: string | null;
  sectionCount: number;
  hashtagCount: number;
  totalLength: number;
  coveredProductTokens: string[];
  missingProductTokens: string[];
  signals: BrandLinkContentReadinessSignal[];
  blockers: BrandLinkReadinessBlocker[];
  quality: BrandLinkQualityReport;
}): BrandLinkContentReadiness {
  const canPublish = input.verdict === "pass";
  const passingSignals = input.signals.filter((signal) => signal.status === "pass").length;
  const score = input.quality.score;
  const summary = canPublish
    ? `커넥트 글 발행 게이트 통과 (품질 ${score}점, 신호 ${passingSignals}/${input.signals.length})`
    : input.verdict === "blocked"
      ? `커넥트 글 발행 차단 (품질 ${score}점, 차단 ${input.blockers.length}건: ${input.reason || input.blockers[0]?.reason || "게이트 미통과"})`
      : `커넥트 글 품질 미달 (품질 ${score}점/${input.quality.passScore}점, ${input.reason || "품질 기준 미달"})`;

  return {
    canPublish,
    verdict: input.verdict,
    code: input.code,
    reason: input.reason,
    score,
    sectionCount: input.sectionCount,
    hashtagCount: input.hashtagCount,
    totalLength: input.totalLength,
    coveredProductTokens: input.coveredProductTokens,
    missingProductTokens: input.missingProductTokens,
    signals: input.signals,
    summary,
    blockers: input.blockers,
    quality: input.quality,
  };
}

export function getBrandLinkContentReadiness(
  input: BrandLinkContentReadinessInput,
): BrandLinkContentReadiness {
  const title = normalizeText(input.title);
  const connectKind = input.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING";
  const isTravel = connectKind === "TRAVEL";
  const editorialMode = input.mode === "editorial";
  const compositionContract = getPostCompositionContract(connectKind);
  const sectionMinimum = compositionContract.targetSections.min;
  const characterMinimum = compositionContract.targetCharacters.min;
  const sections = input.sections.map((section) => normalizeText(section)).filter(Boolean);
  const bodySections = sections.slice(0, -1);
  const fullBody = sections.join("\n");
  const corpus = normalizeLoose([title, fullBody, input.hashtags.join(" ")].join(" "));
  const titleCorpus = normalizeLoose(title);
  const bodyCorpus = normalizeLoose(fullBody);
  const productTokens = getProductTokens(input.productName);
  const coveredProductTokens = productTokens.filter((token) => corpus.includes(token));
  const missingProductTokens = productTokens.filter((token) => !coveredProductTokens.includes(token));
  const titleHasProductToken =
    productTokens.length === 0 || productTokens.some((token) => titleCorpus.includes(token));
  const bodyHasProductToken =
    productTokens.length === 0 || productTokens.some((token) => bodyCorpus.includes(token));
  const totalLength = sections.reduce((sum, section) => sum + section.length, 0);
  const mainSectionCount = Math.max(0, sections.length - 1);
  const disclosureText = sections[sections.length - 1] || "";
  // 쇼핑커넥트/여행커넥트 모두 인정한다. 여행 글의 고지 문구는 "여행 커넥트"라서
  // 쇼핑만 검사하면 여행 발행이 전부 게이트에서 막힌다.
  const hasDisclosure =
    /(?:쇼핑|여행)\s*커넥트/u.test(disclosureText) &&
    /수수료/u.test(disclosureText) &&
    /제공/u.test(disclosureText);
  const normalizedBrandLink = normalizeText(input.brandLink);
  const bodyContainsRawLink =
    Boolean(normalizedBrandLink && fullBody.includes(normalizedBrandLink)) ||
    /https?:\/\/(?:naver\.me|brandconnect\.naver\.com|shopping\.naver\.com)\/\S+/iu.test(fullBody);
  const experienceMode = input.experienceMode || "AI_ASSISTED_INFORMATION";
  const unsupportedExperienceCount =
    experienceMode === "VERIFIED_EXPERIENCE"
      ? 0
      : countPatternHits(fullBody, UNSUPPORTED_EXPERIENCE_PATTERNS) +
        (UNSUPPORTED_EXPERIENCE_TITLE_PATTERN.test(title) ? 1 : 0);
  const commissionRateCount = countPatternHits(fullBody, COMMISSION_RATE_PATTERNS);
  const internalGuidanceCount = countPatternHits(fullBody, INTERNAL_GUIDANCE_PATTERNS);
  // 편집(초안) 단계에서는 이미지가 아직 확정되지 않았으므로 대표 이미지는 발행 단계에서만 요구한다.
  const requireRepresentativeImage = input.requireRepresentativeImage !== false && !editorialMode;
  const editorialCoverage = isTravel
    ? assessTravelEditorialCoverage(bodySections)
    : assessProductEditorialCoverage(bodySections);
  const reviewSubstance = isTravel
    ? assessTravelReviewSubstance({
        productName: input.productName,
        sections: bodySections,
        sourceText: [input.sourceDescription || "", ...(input.sourceFeatures || [])].join(" "),
      })
    : assessProductReviewSubstance({
        productName: input.productName,
        sections: bodySections,
        sourceDescription: input.sourceDescription,
        sourceFeatures: input.sourceFeatures,
      });
  // 카테고리 혼입: 쇼핑은 다른 상품군 용어, 여행은 쇼핑 문구(배송·교환·구성품)가 섞인 경우.
  const categoryMismatchTerms = "categoryMismatchTerms" in reviewSubstance
    ? reviewSubstance.categoryMismatchTerms
    : Array.from(new Set((bodySections.join("\n").match(new RegExp(TRAVEL_SHOPPING_INTRUSION_PATTERN.source, "gu")) || []).map(normalizeText)));
  const sourceEvidenceCoveragePass = isTravel || (
    "coveredSignals" in reviewSubstance &&
    reviewSubstance.coveredSignals.length >= reviewSubstance.requiredSignalCount
  );
  const evidenceTokens = [
    ...productTokens,
    ...("coveredSignals" in reviewSubstance ? reviewSubstance.coveredSignals : reviewSubstance.coveredPlaces),
    ...(input.sourceFeatures || []),
  ];
  const { quality, failingCategories } = buildQualityReport({
    isTravel,
    bodySections,
    reviewSubstance,
    sourceEvidenceCoveragePass,
    editorialMissingCoreRoles: editorialCoverage.missingCoreRoles,
    evidenceTokens,
  });
  const categoryByKey = new Map(quality.categories.map((item) => [item.key, item] as const));
  const statusOf = (key: BrandLinkQualityCategoryKey): BrandLinkContentReadinessSignal["status"] =>
    categoryByKey.get(key)?.status || "warn";
  const trustedGenerationSource =
    input.generationSource === "AI" || input.generationSource === "PREPARED_APPROVED";
  const compositionBlocked =
    input.compositionQualityReport?.preset === "PREMIUM" && !input.compositionQualityReport.canAutoPublish;

  const baseSignals: BrandLinkContentReadinessSignal[] = [
    {
      key: "generation-source",
      label: "AI 생성 또는 승인 원고",
      status: trustedGenerationSource ? "pass" : "fail",
    },
    {
      key: "product-title",
      label: "제목 상품명 반영",
      status: titleHasProductToken ? "pass" : "fail",
    },
    {
      key: "product-body",
      label: "본문 상품명 반영",
      status: bodyHasProductToken ? "pass" : "fail",
    },
    {
      key: "sections",
      label: "본문 섹션",
      status: mainSectionCount >= sectionMinimum ? "pass" : "fail",
    },
    {
      key: "editorial-flow",
      label: isTravel ? "여행지 배경-장면-체험-팁 흐름" : "제품정체-기능원리-사용법-장단점-결론 흐름",
      status: editorialCoverage.missingCoreRoles.length <= 1 ? "pass" : "fail",
    },
    {
      key: "review-substance",
      label: isTravel ? "여행지 고유 정보와 현장감" : "제품 특장점·활용법·후기 근거 리뷰",
      status: reviewSubstance.pass ? "pass" : statusOf("usefulness") === "fail" || statusOf("specificity") === "fail" ? "fail" : "warn",
    },
    {
      key: "evidence-density",
      label: isTravel ? "여행지 근거-즐길 거리 연결" : "제품 기능-작동방식-사용 가치 연결",
      status: statusOf("productEvidence") === "fail" || statusOf("sceneLinkage") === "fail" ? "fail" : "pass",
    },
    {
      key: "generic-guidance",
      label: "확인 안내·일반론 비율",
      status: statusOf("clarity"),
    },
    {
      key: "category-integrity",
      label: isTravel ? "여행 글에 쇼핑 문구 미혼입" : "상품 카테고리 문맥 일치",
      status: categoryMismatchTerms.length === 0 ? "pass" : "fail",
    },
    {
      key: "sentence-repetition",
      label: "본문 반복 문장",
      status: statusOf("diversity"),
    },
    {
      key: "length",
      label: "본문 분량",
      status:
        totalLength >= characterMinimum
          ? "pass"
          : totalLength >= Math.round(characterMinimum * 0.8)
            ? "warn"
            : "fail",
    },
    {
      key: "hashtags",
      label: "해시태그",
      // 상위 노출 글 실측 기준 태그 3~5개. 과다 태그는 키워드 남용(스팸)으로 읽힐
      // 수 있어 10개 초과도 경고로 본다.
      status:
        input.hashtags.length >= 3 && input.hashtags.length <= 10
          ? "pass"
          : input.hashtags.length >= 2
            ? "warn"
            : "fail",
    },
    {
      key: "raw-link",
      label: "본문 URL 직접 노출",
      status: bodyContainsRawLink ? "fail" : "pass",
    },
    {
      key: "disclosure",
      label: "커넥트 활동 고지",
      status: hasDisclosure ? "pass" : "fail",
    },
    {
      key: "experience",
      label: "허위 체험 단정",
      status: unsupportedExperienceCount > 0 ? "fail" : "pass",
    },
    {
      key: "commission-rate",
      label: "수수료율/커미션 노출",
      status: commissionRateCount > 0 ? "fail" : "pass",
    },
    {
      key: "internal-guidance",
      label: "내부 지침 문구 유출",
      status: internalGuidanceCount > 0 ? "fail" : "pass",
    },
    {
      key: "representative-image",
      label: "판매페이지 대표 이미지",
      status: input.hasRepresentativeImage ? "pass" : requireRepresentativeImage ? "fail" : "warn",
    },
    {
      key: "thumbnail",
      label: "생성형 썸네일",
      status: input.thumbnailGenerated ? "pass" : "warn",
    },
    {
      key: "composition-quality",
      label: "포스트 계약 품질",
      status: input.compositionQualityReport
        ? input.compositionQualityReport.canAutoPublish
          ? "pass"
          : input.compositionQualityReport.preset === "PREMIUM"
            ? "fail"
            : "warn"
        : "warn",
    },
  ];

  const signals = editorialMode
    ? baseSignals.filter((signal) => !["representative-image", "thumbnail", "composition-quality"].includes(signal.key))
    : baseSignals;

  // ---- 하드 차단 (점수와 무관) ----
  const blockers: BrandLinkReadinessBlocker[] = [];
  if (!trustedGenerationSource) {
    blockers.push({
      code: "non-generative-fallback",
      tier: "structure",
      reason: "AI가 작성한 원고 또는 사용자가 승인한 준비 원고가 아닙니다. 하네스 문장으로 만든 로컬 폴백은 발행할 수 없습니다.",
    });
  }
  if (!titleHasProductToken || !bodyHasProductToken) {
    blockers.push({
      code: "missing-product-name",
      tier: "structure",
      reason: `상품명이 제목/본문에 충분히 반영되지 않았습니다. 확인 토큰: ${coveredProductTokens.join(", ") || "-"}`,
    });
  }
  if (mainSectionCount < sectionMinimum) {
    blockers.push({
      code: "too-few-sections",
      tier: "structure",
      reason: `본문 섹션이 부족합니다. 현재 ${mainSectionCount}개, 최소 ${sectionMinimum}개가 필요합니다.`,
    });
  }
  if (totalLength < Math.round(characterMinimum * 0.8)) {
    blockers.push({
      code: "too-short-content",
      tier: "structure",
      reason: `본문 분량이 너무 짧습니다. 현재 ${totalLength}자입니다.`,
    });
  }
  if (input.hashtags.length < 3) {
    blockers.push({
      code: "too-few-hashtags",
      tier: "structure",
      reason: `해시태그가 부족합니다. 현재 ${input.hashtags.length}개입니다. (권장 3~5개)`,
    });
  }
  if (bodyContainsRawLink) {
    blockers.push({
      code: "link-in-body",
      tier: "safety",
      reason: "본문에 쇼핑커넥트/상품 URL이 직접 노출되었습니다. 링크는 에디터 컴포넌트로만 삽입해야 합니다.",
    });
  }
  if (!hasDisclosure) {
    blockers.push({ code: "missing-disclosure", tier: "safety", reason: "커넥트 활동 고지 문구가 없습니다." });
  }
  if (unsupportedExperienceCount > 0) {
    blockers.push({
      code: "unsupported-experience-claim",
      tier: "safety",
      reason: "직접 구매/사용/체험을 단정하는 문장이 남아 있습니다.",
    });
  }
  if (commissionRateCount > 0) {
    blockers.push({
      code: "commission-rate-exposed",
      tier: "safety",
      reason: "수수료율/커미션율/내부 정산 정보가 본문에 노출되었습니다.",
    });
  }
  if (internalGuidanceCount > 0) {
    blockers.push({
      code: "internal-guidance-leak",
      tier: "safety",
      reason: "본문에 OpenCrab/프롬프트/작성 지침처럼 독자에게 보이면 안 되는 내부 문구가 섞였습니다.",
    });
  }
  if (requireRepresentativeImage && !input.hasRepresentativeImage) {
    blockers.push({
      code: "missing-representative-image",
      tier: "structure",
      reason: "판매페이지 대표 이미지를 확정하지 못했습니다.",
    });
  }
  if (categoryMismatchTerms.length > 0) {
    blockers.push({
      code: "category-mismatch",
      tier: "safety",
      reason: isTravel
        ? `여행 글에 쇼핑 상품 문구가 섞였습니다: ${categoryMismatchTerms.join(", ")}`
        : `상품 카테고리와 맞지 않는 문구가 섞였습니다: ${categoryMismatchTerms.join(", ")}`,
    });
  }
  if (!editorialMode && compositionBlocked) {
    blockers.push({
      code: "composition-quality",
      tier: "structure",
      reason: input.compositionQualityReport?.blockers.join(" ") || "렌더 계약 품질 게이트 미통과",
    });
  }

  const common = {
    sectionCount: sections.length,
    hashtagCount: input.hashtags.length,
    totalLength,
    coveredProductTokens,
    missingProductTokens,
    signals,
    blockers,
    quality,
  };

  if (blockers.length > 0) {
    // 안전 차단을 구조 차단보다 먼저 보고한다.
    const primary = blockers.find((item) => item.tier === "safety") || blockers[0];
    return buildResult({ ...common, code: primary.code, verdict: "blocked", reason: primary.reason });
  }

  // ---- 품질 판정 (차단이 없을 때만 의미가 있다) ----
  if (failingCategories.length > 0) {
    const primary = QUALITY_CODE_PRIORITY
      .map((key) => failingCategories.find((item) => item.key === key))
      .find((item): item is BrandLinkQualityCategory => Boolean(item)) || failingCategories[0];
    const code = qualityCodeFor(primary);
    let reason: string;
    if (code === "repetitive-content") {
      reason = `같은 뜻의 문장이 반복됩니다 (${quality.repetition.nearDuplicateCount}개 중복). ${primary.notes[0] || ""}`.trim();
    } else if (code === "generic-guidance-heavy") {
      reason = `${isTravel ? "여행지 정보" : "제품 판단"}보다 확인 안내·일반론 문장이 많습니다 (${primary.notes.join(", ")}).`;
    } else if (code === "low-evidence-density") {
      const linkage = categoryByKey.get("sceneLinkage")!;
      const evidence = categoryByKey.get("productEvidence")!;
      const sourceCoverageText = "coveredSignals" in reviewSubstance
        ? `, 근거 ${reviewSubstance.coveredSignals.length}/${reviewSubstance.requiredSignalCount}`
        : "";
      if (isTravel && "coveredPlaces" in reviewSubstance) {
        const deficits = [
          evidence.status === "fail" ? evidence.notes.join(" ") : "",
          linkage.status === "fail"
            ? `여행지 사실을 풍경·활동·팁으로 연결한 문장이 부족합니다 (연결 ${reviewSubstance.evidenceJudgementCount}/${reviewSubstance.requiredEvidenceJudgementCount}).`
            : "",
        ].filter(Boolean);
        reason = deficits.join(" ").trim();
      } else {
        reason = `제품 고유 기능·수치를 사용 장면의 이점·제약으로 해석한 근거가 부족합니다 (판단 ${reviewSubstance.evidenceJudgementCount}/${reviewSubstance.requiredEvidenceJudgementCount}${sourceCoverageText}).`;
      }
    } else {
      const travelRoleLabels: Record<string, string> = {
        background: "여행지 역사·문화 배경",
        atmosphere: "현장 풍경과 분위기",
        experience: "보고 먹고 즐길 거리",
        preparation: "교통·동선·복장 등 실용 팁",
        route: "하루의 여행 흐름",
      };
      const shoppingRoleLabels: Record<string, string> = {
        "product-identity": "제품의 정체와 핵심 용도",
        "source-evidence": "핵심 기능의 작동 방식과 사용 가치",
        "primary-strength": "구체적인 핵심 장점",
        "use-case": "구체적인 사용·설치·관리 방법",
        "review-evidence": "실제 구매후기 근거의 공통 장점",
        limitations: "제품 자체의 단점·제약",
        fit: "추천·비추천 대상",
        verdict: "조건부 최종 결론",
      };
      const roleLabels = isTravel ? travelRoleLabels : shoppingRoleLabels;
      const missing = [
        ...reviewSubstance.missingElements,
        ...editorialCoverage.missingCoreRoles.map(
          (role) => roleLabels[role] || (isTravel ? "여행 리뷰 흐름" : "제품 리뷰 흐름"),
        ),
      ];
      reason = `${isTravel ? "여행지 콘텐츠" : "상품 고유 리뷰"} 요소가 부족합니다: ${Array.from(new Set(missing)).join(", ")}`;
    }
    return buildResult({ ...common, code, verdict: "quality", reason });
  }

  if (quality.score < quality.passScore) {
    const weakest = [...quality.categories].sort((a, b) => a.score / a.maxScore - b.score / b.maxScore)[0];
    return buildResult({
      ...common,
      code: "quality-score-below-threshold",
      verdict: "quality",
      reason: `품질 점수 ${quality.score}점이 기준 ${quality.passScore}점에 미달합니다. 가장 약한 항목: ${weakest.label}${weakest.notes[0] ? ` (${weakest.notes[0]})` : ""}`,
    });
  }

  const warnSignal = signals.find((signal) => signal.status === "warn");
  return buildResult({ ...common, code: "ok", verdict: "pass", reason: warnSignal?.label ?? null });
}
