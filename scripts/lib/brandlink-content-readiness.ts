import {
  assessProductEditorialCoverage,
  assessProductReviewSubstance,
  normalizeProductSubstanceFeatures,
} from "./product-editorial-plan";
import {
  assessTravelFeatureCoverage,
  assessTravelReviewSubstance,
  type TravelSourceCoverage,
} from "./travel-content";
import { assessGenericLanguage, assessRepetition, sentenceTokens } from "./draft-quality-signals";
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
  /** 체험 모드에서 체험 문장이 메모에 근거하는지 경고용으로만 비교한다. */
  experienceNotes?: string | null;
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
  | "unsupported-option-claim"
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
  /** 상품 원고의 자동 승인에 사용한 저장 출처 근거. 거래 메타데이터는 제외한다. */
  sourceEvidence?: {
    level: "rich" | "usable" | "sparse" | "travel";
    sufficient: boolean;
    coveredCount: number;
    requiredCount: number;
    groundedCount: number;
    requiredGroundedCount: number;
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
  /** 안전·구조 하드 차단만 포함한다. 품질 실패는 qualityFailures를 참조한다. */
  blockers: BrandLinkReadinessBlocker[];
  /** 총점과 별개로 충족해야 하는 필수 품질 항목의 실패 목록. */
  qualityFailures?: BrandLinkQualityCategory[];
  quality: BrandLinkQualityReport;
}

/** 2026-09-24 보정: 과도한 재작성 루프를 줄이기 위해 70 → 62. 안전 차단은 그대로 유지한다. */
export const BRANDLINK_QUALITY_PASS_SCORE = 62;

/**
 * 총점이 기준 이상일 때도 발행을 막는 품질 카테고리. 상품/여행지 고유 근거가 없으면
 * 허위 정보 위험이 있으므로 필수로 남기고, 나머지 카테고리 실패는 권고(경고)로 낮춘다.
 */
export const BRANDLINK_MANDATORY_QUALITY_CATEGORIES: readonly BrandLinkQualityCategoryKey[] = ["productEvidence"];
/** 거의 같은 틀의 문장이 이만큼 반복되면 유사문서·저품질 위험이 커서 총점과 무관하게 막는다. */
export const BRANDLINK_SEVERE_REPETITION_COUNT = 5;

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

/**
 * 체험 모드에서, 체험 단정 문장 중 체험 메모와 겹치는 단어가 하나도 없는 문장 수.
 * 메모에 없는 체험을 지어냈을 가능성을 알리는 권고 신호에만 쓴다.
 */
export function countUngroundedExperienceSentences(body: string, notes: string): number {
  const noteTokens = new Set(sentenceTokens(notes));
  if (noteTokens.size === 0) return 0;
  const sentences = body.split(/(?<=[.!?。])\s+|\n+/u).map((sentence) => sentence.trim()).filter(Boolean);
  return sentences.filter((sentence) => detectUnsupportedExperience(sentence).length > 0)
    .filter((sentence) => !sentenceTokens(sentence).some((token) => noteTokens.has(token)))
    .length;
}

/** Return exact claim candidates; exemptions must attach to that candidate, not its sentence. */
export function detectUnsupportedExperience(text: string): string[] {
  const matches: string[] = [];
  for (const pattern of UNSUPPORTED_EXPERIENCE_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, "gu"))) {
      // Only a small, grammatical continuation is allowed. Never scan ahead for a denial:
      // "직접 사용해 봤어요. 구매 후기는 없습니다" still contains a claim.
      const tail = text.slice(match.index! + match[0].length, match.index! + match[0].length + 100).split(/[\n\r.!?;,]/u)[0];
      const denial = /^(?:\s*(?:나|와|과|및|또는)\s*(?:구매|사용|체험))?(?:\s*(?:후기|경험|기록)(?:는|가|이|을|은)?)?\s*(?:제공되지\s*않|없(?:습니다|어요|다|으)|하지\s*않|한\s*적(?:이|은)?\s*없|해\s*본\s*적(?:이|은)?\s*없)/u;
      const nonAssertion = /^\s*(?:(?:하|해|해\s*보|해\s*봤다|했다|다)?면|(?:하|해\s*보)?신다면|(?:하|해\s*보)?실\s*경우|하는\s*경우|하기\s*전|하세요|해\s*보세요|해\s*주세요|하지\s*마세요|하는\s*방식|후\s*(?:건조|세척|보관|관리))/u;
      // Recommendation policy is unchanged; these are not experience predicates.
      const recommendation = /강력|후회|무조건|재구매/u.test(match[0]);
      if (!recommendation && (denial.test(tail) || nonAssertion.test(tail))) continue;
      matches.push(match[0]);
    }
  }
  return [...new Set(matches)];
}

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
  /(?:이번|제공된|수집된)\s*자료(?:에는|에서|에|는)?\s*(?:구매\s*)?(?:후기|리뷰)(?:\s*원문)?(?:이|은|가|는)?\s*(?:제공되지|없(?:어|습|다|으|는))/u,
  /(?:제공된\s*)?(?:구매\s*)?후기\s*원문(?:이|은|을|는)?\s*(?:(?:현재|따로|별도로|아직)\s*)?(?:제공되지|없(?:어|습|다|으|는)|확인(?:되지|할\s*수\s*없))/u,
  /(?:후기|리뷰)[^.!?\n]{0,20}(?:수집|제공|확보)(?:하지|되지|하지는|되지는)\s*않/u,
  /(?:추천\s*문장|후기처럼).{0,30}(?:빼는\s*편|만들어\s*말|지어내)/u,
  /상위\s*노출\s*글에서/u,
  /제품명,\s*사용\s*장면,\s*구매\s*전\s*확인\s*포인트/u,
  /상세페이지의\s*주요\s*기능\s*같은\s*정보/u,
  /구매\s*전에\s*상품명과\s*옵션을\s*먼저\s*확인/u,
  /(?:opencrab|오픈크랩|seo\s*브리프|리서치\s*(?:팩|브리프)|워크플로우)/iu,
  /(?:작성\s*(?:규칙|지침|가이드|프로세스)|프롬프트|출력\s*형식|json\s*만|시스템\s*지시|사용자\s*요청)/iu,
  /(?:recommendedSectionTitles|sections\s*:|hashtags\s*:)/iu,
] as const;

/** Quantity alone is never evidence of a refill variant. Negation and questions
 * are evaluated per clause so an unrelated negative cannot license a claim. */
function affirmativeRefillClauses(value: string): string[] {
  return value.split(/[.!?。\n]|[,;]|(?:지만|그러나|반면)/u).filter(clause => {
    const match = /리필|\brefill\b/iu.exec(clause);
    if (!match) return false;
    const tail = clause.slice(match.index);
    if (/인가요|있나요|되나요|일까요|할까요|비교(?:해|하|할)|(?:인지|여부)를?\s*확인/u.test(tail)) return false;
    if (/(?:리필|refill)[^.!?\n]{0,35}(?:미포함|불포함|별도|제외|없(?:음|어|습|다|는)|아니|아님|아닙|않|불가|불명|미확인|확인되지|확인할\s*수\s*없|여부|인지|확인\s*(?:필요|하세요)|포함\s*안)/iu.test(tail)) return false;
    if (/\b(?:no|without)\s+(?:a\s+)?refill\b|\brefill\b.{0,25}\b(?:not|excluded|separately|unknown)\b/iu.test(clause)) return false;
    return true;
  });
}

export function hasUnsupportedRefillClaim(body: string, source: string): boolean {
  const claims = affirmativeRefillClauses(body).filter(clause =>
    /(?:본품\s*[+＋]|리필|refill)/iu.test(clause) &&
    /(?:포함|구성|제공|동봉|들어|세트|증정|사용|쓸|교체|채워|리필형|본품\s*[+＋]|\d+\s*(?:개|팩)|\bincluded\b)/iu.test(clause));
  if (!claims.length) return false;
  const evidence = affirmativeRefillClauses(source);
  if (!evidence.length) return true;
  const bundle = /본품\s*(?:[+＋]|과|및)\s*리필|리필\s*(?:[+＋]|과|및)\s*본품/u;
  if (claims.some(clause => bundle.test(clause)) && !evidence.some(clause => bundle.test(clause))) return true;
  const inclusion = /포함|구성|제공|동봉|들어|세트|증정|본품\s*[+＋]|\d+\s*(?:개|팩)|\bincluded\b/iu;
  // Refill compatibility does not establish that a refill is in the selected box.
  return claims.some(clause => inclusion.test(clause)) && !evidence.some(clause =>
    inclusion.test(clause) || !/사용|가능|호환|교체/iu.test(clause));
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeLoose(value: string): string {
  return normalizeText(value).normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Korean brand/model names keep their identity when an editor adds word spaces. */
export function containsProductToken(text: string, token: string): boolean {
  const identity = normalizeLoose(token).replace(/\s+/gu, "");
  return identity.length > 0 && normalizeLoose(text).replace(/\s+/gu, "").includes(identity);
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

export type TravelSourceEvidenceProfile = TravelSourceCoverage;

/** 여행 제목·가격은 일정 근거가 아니다. 수집기가 만든 명시적 방문지/일차별 일정만 인정한다. */
export function assessTravelSourceEvidence(sourceFeatures: string[] | undefined): TravelSourceEvidenceProfile {
  return assessTravelFeatureCoverage(sourceFeatures);
}

function buildQualityReport(input: {
  isTravel: boolean;
  bodySections: string[];
  reviewSubstance: ReturnType<typeof assessProductReviewSubstance> | ReturnType<typeof assessTravelReviewSubstance>;
  sourceEvidenceCoveragePass: boolean;
  editorialMissingCoreRoles: string[];
  evidenceTokens: string[];
  sourceEvidenceLevel?: "rich" | "usable" | "sparse";
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
          ? !input.sourceEvidenceCoveragePass
            ? "저장 출처의 핵심 방문지·일차별 일정 근거가 부족합니다. 원고 재작성 전에 여행상품 상세를 다시 수집해야 합니다."
            : `핵심 방문지 ${coveredEvidence}/${requiredEvidence}곳만 본문에 등장합니다.`
          : input.sourceEvidenceLevel === "sparse"
            ? "저장 출처의 상품 고유 기능·구조·규격이 부족합니다. 원고 재작성 전에 상세 정보를 다시 수집해야 합니다."
            : `확인된 기능·수치 ${coveredEvidence}/${requiredEvidence}개만 본문에 등장합니다.`]
      : "coveredSignals" in reviewSubstance && !reviewSubstance.signalEvidenceAvailable
        ? ["확인된 기능·수치 신호가 없어 상품 고유 근거를 요구하지 않았습니다. 상세정보 동기화 후 재검사를 권장합니다."]
        : [],
  };

  // 2. 사용 장면·여행 장면 연결
  const groundedSignalCount = "groundedSignalCount" in reviewSubstance
    ? reviewSubstance.groundedSignalCount
    : reviewSubstance.evidenceJudgementCount;
  const requiredGroundedSignalCount = "requiredGroundedSignalCount" in reviewSubstance
    ? reviewSubstance.requiredGroundedSignalCount
    : reviewSubstance.requiredEvidenceJudgementCount;
  const linkageUnavailable = !isTravel && input.sourceEvidenceLevel === "sparse" &&
    "signalEvidenceAvailable" in reviewSubstance && !reviewSubstance.signalEvidenceAvailable;
  const linkageFail = !linkageUnavailable && (reviewSubstance.evidenceJudgementCount < reviewSubstance.requiredEvidenceJudgementCount ||
    groundedSignalCount < requiredGroundedSignalCount);
  const sceneLinkage: BrandLinkQualityCategory = {
    key: "sceneLinkage",
    label: isTravel ? "여행지 사실-현장 장면 연결" : "기능-사용 장면 연결",
    maxScore: 20,
    score: linkageUnavailable
      ? 0
      : linkageFail
      ? Math.min(11, ratioScore(reviewSubstance.evidenceJudgementCount, reviewSubstance.requiredEvidenceJudgementCount, 20))
      : 20,
    status: linkageUnavailable ? "warn" : categoryStatus(linkageFail ? 0 : 20, 20, linkageFail),
    notes: linkageUnavailable
      ? ["상품 근거를 다시 수집한 뒤 기능과 사용 장면의 연결을 검사합니다."]
      : linkageFail
      ? [`근거를 장면·판단으로 연결한 문장 ${reviewSubstance.evidenceJudgementCount}/${reviewSubstance.requiredEvidenceJudgementCount}개, 서로 다른 근거 ${groundedSignalCount}/${requiredGroundedSignalCount}개`]
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
    if (!usageOk) specificityNotes.push("사용·조리·보관·관리 등 상품에 맞는 구체적인 활용 방법 문장이 2개 미만입니다.");
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
    // Stylistic quotas are advisory. A source-backed article must not invent
    // care/use instructions or travel history just to fill a sentence count.
    // Its score still falls; evidence/linkage, safety and total-score gates stay.
    status: specificityFail ? "warn" : "pass",
    notes: specificityNotes,
  };

  // 4. 문단 다양성 (반복)
  const repeatLimit = 3;
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

  const rawCategories = [productEvidence, sceneLinkage, specificity, diversity, usefulness, clarity];
  const score = Math.max(0, Math.min(100, rawCategories.reduce((sum, item) => sum + item.score, 0)));
  // 총점이 기준 이상이면 필수가 아닌 카테고리 실패는 권고로 낮춘다. 점수는 그대로 보고한다.
  const categories = score >= BRANDLINK_QUALITY_PASS_SCORE
    ? rawCategories.map((item): BrandLinkQualityCategory =>
      item.status === "fail"
        && !BRANDLINK_MANDATORY_QUALITY_CATEGORIES.includes(item.key)
        && !(item.key === "diversity" && repetition.nearDuplicateCount >= BRANDLINK_SEVERE_REPETITION_COUNT)
        ? { ...item, status: "warn", notes: [...item.notes, "총점 기준 충족으로 권고 사항으로 처리"] }
        : item)
    : rawCategories;
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
      sourceEvidence: {
        level: isTravel ? "travel" : input.sourceEvidenceLevel || "sparse",
        sufficient: input.sourceEvidenceCoveragePass,
        coveredCount: coveredEvidence,
        requiredCount: requiredEvidence,
        groundedCount: groundedSignalCount,
        requiredGroundedCount: requiredGroundedSignalCount,
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
  const qualityFailures = input.quality.categories.filter((category) => category.status === "fail");
  const summary = canPublish
    ? `커넥트 글 발행 게이트 통과 (품질 ${score}점, 신호 ${passingSignals}/${input.signals.length})`
    : input.verdict === "blocked"
      ? `커넥트 글 발행 차단 (품질 ${score}점, 차단 ${input.blockers.length}건: ${input.reason || input.blockers[0]?.reason || "게이트 미통과"})`
      : qualityFailures.length > 0
        ? `커넥트 글 필수 품질 조건 미충족 (품질 ${score}점, 기준 ${input.quality.passScore}점, 실패 ${qualityFailures.length}건: ${qualityFailures.map((category) => category.label).join(", ")}. ${input.reason || "필수 품질 조건 미충족"})`
        : `커넥트 글 품질 점수 미달 (품질 ${score}점/${input.quality.passScore}점, ${input.reason || "품질 기준 미달"})`;

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
    qualityFailures,
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
  // Paragraph boundaries constrain which fact can support an adjacent explanation.
  // Flattening them also lets section headings impersonate source-backed prose.
  const sections = input.sections.map((section) => section.replace(/\r\n?/gu, "\n").trim()).filter(Boolean);
  const bodySections = sections.slice(0, -1);
  const fullBody = sections.join("\n");
  const corpus = normalizeLoose([title, fullBody, input.hashtags.join(" ")].join(" "));
  const titleCorpus = normalizeLoose(title);
  const bodyCorpus = normalizeLoose(fullBody);
  const productTokens = getProductTokens(input.productName);
  const coveredProductTokens = productTokens.filter((token) => containsProductToken(corpus, token));
  const missingProductTokens = productTokens.filter((token) => !coveredProductTokens.includes(token));
  const titleHasProductToken =
    productTokens.length === 0 || productTokens.some((token) => containsProductToken(titleCorpus, token));
  const bodyHasProductToken =
    productTokens.length === 0 || productTokens.some((token) => containsProductToken(bodyCorpus, token));
  const totalLength = sections.reduce((sum, section) => sum + normalizeText(section).length, 0);
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
  const unsupportedExperienceMatches = detectUnsupportedExperience(fullBody);
  const unsupportedExperienceCount =
    experienceMode === "VERIFIED_EXPERIENCE"
      ? 0
      : unsupportedExperienceMatches.length +
        (UNSUPPORTED_EXPERIENCE_TITLE_PATTERN.test(title) ? 1 : 0);
  const ungroundedExperienceCount = experienceMode === "VERIFIED_EXPERIENCE"
    ? countUngroundedExperienceSentences(fullBody, input.experienceNotes || "")
    : 0;
  const commissionRateCount = countPatternHits(fullBody, COMMISSION_RATE_PATTERNS);
  const internalGuidanceCount = countPatternHits(fullBody, INTERNAL_GUIDANCE_PATTERNS);
  // 편집(초안) 단계에서는 이미지가 아직 확정되지 않았으므로 대표 이미지는 발행 단계에서만 요구한다.
  const requireRepresentativeImage = input.requireRepresentativeImage !== false && !editorialMode;
  const editorialCoverage = isTravel
    ? assessTravelEditorialCoverage(bodySections)
    : assessProductEditorialCoverage(bodySections, input.productName);
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
  const sourceEvidenceLevel = "sourceEvidenceLevel" in reviewSubstance
    ? reviewSubstance.sourceEvidenceLevel
    : undefined;
  const travelSourceEvidence = assessTravelSourceEvidence(input.sourceFeatures);
  const sourceEvidenceCoveragePass = isTravel
    ? travelSourceEvidence.sufficient
    : (
        "coveredSignals" in reviewSubstance &&
        sourceEvidenceLevel !== "sparse" &&
        reviewSubstance.coveredSignals.length >= reviewSubstance.requiredSignalCount
      );
  const evidenceTokens = [
    ...productTokens,
    ...("coveredSignals" in reviewSubstance ? reviewSubstance.coveredSignals : reviewSubstance.coveredPlaces),
    ...(isTravel ? (input.sourceFeatures || []) : normalizeProductSubstanceFeatures(input.sourceFeatures)),
  ];
  const { quality, failingCategories } = buildQualityReport({
    isTravel,
    bodySections,
    reviewSubstance,
    sourceEvidenceCoveragePass,
    editorialMissingCoreRoles: editorialCoverage.missingCoreRoles,
    evidenceTokens,
    sourceEvidenceLevel,
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
    ...(experienceMode === "VERIFIED_EXPERIENCE" ? [{
      key: "experience-grounding",
      label: ungroundedExperienceCount > 0
        ? `체험 메모에 없는 체험 표현 ${ungroundedExperienceCount}건 (확인 권장)`
        : "체험 표현이 메모에 근거",
      // 차단하지 않는 권고 신호. 메모와 겹치는 단어가 전혀 없는 체험 문장만 센다.
      status: ungroundedExperienceCount > 0 ? "warn" as const : "pass" as const,
    }] : []),
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
  const sourceCorpus = [input.productName, input.sourceDescription || "", ...(input.sourceFeatures || [])].join("\n");
  if (!isTravel && hasUnsupportedRefillClaim([title, fullBody].join("\n"), sourceCorpus)) {
    blockers.push({ code: "unsupported-option-claim", tier: "safety", reason: "선택 상품의 출처에 없는 리필 구성을 본문에서 주장합니다. 본품·리필과 수량은 현재 선택 옵션 근거로 다시 확인하세요." });
  }
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
  // 템플릿 범위의 80%까지 허용한다(최소 3개).
  const sectionFloor = Math.max(3, Math.ceil(sectionMinimum * 0.8));
  if (mainSectionCount < sectionFloor) {
    blockers.push({
      code: "too-few-sections",
      tier: "structure",
      reason: `본문 섹션이 부족합니다. 현재 ${mainSectionCount}개, 최소 ${sectionFloor}개가 필요합니다.`,
    });
  }
  if (totalLength < Math.round(characterMinimum * 0.8)) {
    blockers.push({
      code: "too-short-content",
      tier: "structure",
      reason: `본문 분량이 너무 짧습니다. 현재 ${totalLength}자입니다.`,
    });
  }
  // 해시태그 1~2개는 경고 신호로만 남기고, 하나도 없을 때만 차단한다.
  if (input.hashtags.length < 1) {
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
      reason: `직접 구매/사용/체험을 단정하는 문장이 남아 있습니다.${unsupportedExperienceMatches.length ? ` 감지: ${unsupportedExperienceMatches.join(", ")}` : ""}`,
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
        ? `, 본문 언급 근거 ${reviewSubstance.coveredSignals.length}/${reviewSubstance.requiredSignalCount}, 판단에 연결된 서로 다른 근거 ${reviewSubstance.groundedSignalCount}/${reviewSubstance.requiredGroundedSignalCount}`
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
        reason = sourceEvidenceLevel === "sparse" && evidence.status === "fail"
          ? evidence.notes.join(" ")
          : `제품 고유 기능·수치를 사용 장면의 이점·제약으로 해석한 근거가 부족합니다 (판단 ${reviewSubstance.evidenceJudgementCount}/${reviewSubstance.requiredEvidenceJudgementCount}${sourceCoverageText}).`;
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
    return buildResult({ ...common, code, verdict: "quality", reason: `필수 품질 조건 미충족: ${primary.label}. ${reason}` });
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
