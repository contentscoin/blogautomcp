import {
  assessProductEditorialCoverage,
  assessProductReviewSubstance,
} from "./product-editorial-plan";
import { assessTravelReviewSubstance } from "./travel-content";
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

export interface BrandLinkContentReadiness {
  canPublish: boolean;
  code:
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
    | "non-generative-fallback"
    | "missing-representative-image"
    | "composition-quality";
  reason: string | null;
  score: number;
  sectionCount: number;
  hashtagCount: number;
  totalLength: number;
  coveredProductTokens: string[];
  missingProductTokens: string[];
  signals: BrandLinkContentReadinessSignal[];
  summary: string;
}

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

const UNSUPPORTED_EXPERIENCE_PATTERNS = [
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

const COMMISSION_RATE_PATTERNS = [
  /(?:수수료|커미션|commission)\s*\d/iu,
  /\d+(?:\.\d+)?\s*%\s*(?:수수료|커미션|commission)/iu,
  /(?:제휴율|정산\s*조건|내부\s*정산)/u,
] as const;

const INTERNAL_GUIDANCE_PATTERNS = [
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

function getProductTokens(productName: string): string[] {
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

function buildResult(input: {
  code: BrandLinkContentReadiness["code"];
  reason: string | null;
  score: number;
  sectionCount: number;
  hashtagCount: number;
  totalLength: number;
  coveredProductTokens: string[];
  missingProductTokens: string[];
  signals: BrandLinkContentReadinessSignal[];
}): BrandLinkContentReadiness {
  const canPublish = input.code === "ok";
  const passingSignals = input.signals.filter((signal) => signal.status === "pass").length;
  const summary = canPublish
    ? `커넥트 글 발행 게이트 통과 (${input.score}점, 신호 ${passingSignals}/${input.signals.length})`
    : `커넥트 글 발행 보류 (${input.score}점, ${input.reason || "게이트 미통과"})`;

  return {
    canPublish,
    code: input.code,
    reason: input.reason,
    score: input.score,
    sectionCount: input.sectionCount,
    hashtagCount: input.hashtagCount,
    totalLength: input.totalLength,
    coveredProductTokens: input.coveredProductTokens,
    missingProductTokens: input.missingProductTokens,
    signals: input.signals,
    summary,
  };
}

export function getBrandLinkContentReadiness(
  input: BrandLinkContentReadinessInput,
): BrandLinkContentReadiness {
  const title = normalizeText(input.title);
  const connectKind = input.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING";
  const isTravel = connectKind === "TRAVEL";
  const compositionContract = getPostCompositionContract(connectKind);
  const sectionMinimum = compositionContract.targetSections.min;
  const characterMinimum = compositionContract.targetCharacters.min;
  const sections = input.sections.map((section) => normalizeText(section)).filter(Boolean);
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
  const requireRepresentativeImage = input.requireRepresentativeImage !== false;
  const editorialCoverage = isTravel
    ? assessTravelEditorialCoverage(sections.slice(0, -1))
    : assessProductEditorialCoverage(sections.slice(0, -1));
  const reviewSubstance = isTravel
    ? assessTravelReviewSubstance({
        productName: input.productName,
        sections: sections.slice(0, -1),
        sourceText: [input.sourceDescription || "", ...(input.sourceFeatures || [])].join(" "),
      })
    : assessProductReviewSubstance({
        productName: input.productName,
        sections: sections.slice(0, -1),
        sourceDescription: input.sourceDescription,
        sourceFeatures: input.sourceFeatures,
      });
  const categoryMismatchTerms = "categoryMismatchTerms" in reviewSubstance
    ? reviewSubstance.categoryMismatchTerms
    : [];
  const sourceEvidenceCoveragePass = isTravel || (
    "coveredSignals" in reviewSubstance &&
    reviewSubstance.coveredSignals.length >= reviewSubstance.requiredSignalCount
  );
  const genericGuidanceRatio = reviewSubstance.genericGuidanceCount / Math.max(1, reviewSubstance.sentenceCount);
  const trustedGenerationSource =
    input.generationSource === "AI" || input.generationSource === "PREPARED_APPROVED";

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
      status: reviewSubstance.pass ? "pass" : "fail",
    },
    {
      key: "evidence-density",
      label: isTravel ? "여행지 근거-즐길 거리 연결" : "제품 기능-작동방식-사용 가치 연결",
      status:
        reviewSubstance.evidenceJudgementCount >= reviewSubstance.requiredEvidenceJudgementCount &&
        sourceEvidenceCoveragePass
          ? "pass"
          : "fail",
    },
    {
      key: "generic-guidance",
      label: "확인 안내 반복 비율",
      status: genericGuidanceRatio <= (isTravel ? 0.16 : 0.24) ? "pass" : "fail",
    },
    {
      key: "category-integrity",
      label: "상품 카테고리 문맥 일치",
      status: categoryMismatchTerms.length === 0 ? "pass" : "fail",
    },
    {
      key: "sentence-repetition",
      label: "본문 반복 문장",
      status: reviewSubstance.repeatedSentenceCount <= 2 ? "pass" : "fail",
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

  const signals = input.mode === "editorial"
    ? baseSignals.filter((signal) => !["representative-image", "thumbnail", "composition-quality"].includes(signal.key))
    : baseSignals;

  const failSignal = signals.find((signal) => signal.status === "fail");
  const warningCount = signals.filter((signal) => signal.status === "warn").length;
  const score = Math.max(
    0,
    100 - signals.filter((signal) => signal.status === "fail").length * 18 - warningCount * 5,
  );

  if (!trustedGenerationSource) {
    return buildResult({
      code: "non-generative-fallback",
      reason:
        "AI가 작성한 원고 또는 사용자가 승인한 준비 원고가 아닙니다. 하네스 문장으로 만든 로컬 폴백은 발행할 수 없습니다.",
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (!titleHasProductToken || !bodyHasProductToken) {
    return buildResult({
      code: "missing-product-name",
      reason: `상품명이 제목/본문에 충분히 반영되지 않았습니다. 확인 토큰: ${coveredProductTokens.join(", ") || "-"}`,
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (mainSectionCount < sectionMinimum) {
    return buildResult({
      code: "too-few-sections",
      reason: `본문 섹션이 부족합니다. 현재 ${mainSectionCount}개, 최소 ${sectionMinimum}개가 필요합니다.`,
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (totalLength < Math.round(characterMinimum * 0.8)) {
    return buildResult({
      code: "too-short-content",
      reason: `본문 분량이 너무 짧습니다. 현재 ${totalLength}자입니다.`,
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (input.hashtags.length < 3) {
    return buildResult({
      code: "too-few-hashtags",
      reason: `해시태그가 부족합니다. 현재 ${input.hashtags.length}개입니다. (권장 3~5개)`,
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (bodyContainsRawLink) {
    return buildResult({
      code: "link-in-body",
      reason: "본문에 쇼핑커넥트/상품 URL이 직접 노출되었습니다. 링크는 에디터 컴포넌트로만 삽입해야 합니다.",
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (!hasDisclosure) {
    return buildResult({
      code: "missing-disclosure",
      reason: "커넥트 활동 고지 문구가 없습니다.",
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (unsupportedExperienceCount > 0) {
    return buildResult({
      code: "unsupported-experience-claim",
      reason: "직접 구매/사용/체험을 단정하는 문장이 남아 있습니다.",
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (commissionRateCount > 0) {
    return buildResult({
      code: "commission-rate-exposed",
      reason: "수수료율/커미션율/내부 정산 정보가 본문에 노출되었습니다.",
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (internalGuidanceCount > 0) {
    return buildResult({
      code: "internal-guidance-leak",
      reason: "본문에 OpenCrab/프롬프트/작성 지침처럼 독자에게 보이면 안 되는 내부 문구가 섞였습니다.",
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (requireRepresentativeImage && !input.hasRepresentativeImage) {
    return buildResult({
      code: "missing-representative-image",
      reason: "판매페이지 대표 이미지를 확정하지 못했습니다.",
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (categoryMismatchTerms.length > 0) {
    return buildResult({
      code: "category-mismatch",
      reason: `상품 카테고리와 맞지 않는 문구가 섞였습니다: ${categoryMismatchTerms.join(", ")}`,
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (reviewSubstance.repeatedSentenceCount > 2) {
    return buildResult({
      code: "repetitive-content",
      reason: `같은 판단 문장이 반복됩니다 (${reviewSubstance.repeatedSentenceCount}회 중복).`,
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (genericGuidanceRatio > (isTravel ? 0.16 : 0.24)) {
    return buildResult({
      code: "generic-guidance-heavy",
      reason: `${isTravel ? "여행지 정보" : "제품 판단"}보다 확인 안내 문장이 많습니다 (${reviewSubstance.genericGuidanceCount}/${reviewSubstance.sentenceCount}문장).`,
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (
    reviewSubstance.evidenceJudgementCount < reviewSubstance.requiredEvidenceJudgementCount ||
    !sourceEvidenceCoveragePass
  ) {
    const sourceCoverageText = "coveredSignals" in reviewSubstance
      ? `, 근거 ${reviewSubstance.coveredSignals.length}/${reviewSubstance.requiredSignalCount}`
      : "";
    return buildResult({
      code: "low-evidence-density",
      reason: isTravel
        ? `여행지 사실을 풍경·활동·팁으로 연결한 내용이 부족합니다 (연결 ${reviewSubstance.evidenceJudgementCount}/${reviewSubstance.requiredEvidenceJudgementCount}).`
        : `제품 고유 기능·수치를 사용 장면의 이점·제약으로 해석한 근거가 부족합니다 (판단 ${reviewSubstance.evidenceJudgementCount}/${reviewSubstance.requiredEvidenceJudgementCount}${sourceCoverageText}).`,
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (!reviewSubstance.pass || editorialCoverage.missingCoreRoles.length > 1) {
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
    return buildResult({
      code: "missing-review-substance",
      reason: `${isTravel ? "여행지 콘텐츠" : "상품 고유 리뷰"} 요소가 부족합니다: ${Array.from(new Set(missing)).join(", ")}`,
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (
    input.compositionQualityReport?.preset === "PREMIUM" &&
    !input.compositionQualityReport.canAutoPublish
  ) {
    return buildResult({
      code: "composition-quality",
      reason: input.compositionQualityReport.blockers.join(" "),
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  return buildResult({
    code: "ok",
    reason: failSignal?.label ?? null,
    score,
    sectionCount: sections.length,
    hashtagCount: input.hashtags.length,
    totalLength,
    coveredProductTokens,
    missingProductTokens,
    signals: baseSignals,
  });
}
