import { assessProductEditorialCoverage } from "./product-editorial-plan";

export interface BrandLinkContentReadinessInput {
  productName: string;
  title: string;
  sections: string[];
  hashtags: string[];
  brandLink: string;
  hasRepresentativeImage: boolean;
  requireRepresentativeImage?: boolean;
  thumbnailGenerated?: boolean;
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
    | "missing-representative-image";
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
] as const;

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
    ? `상품글 발행 게이트 통과 (${input.score}점, 신호 ${passingSignals}/${input.signals.length})`
    : `상품글 발행 보류 (${input.score}점, ${input.reason || "게이트 미통과"})`;

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
  const unsupportedExperienceCount = countPatternHits(fullBody, UNSUPPORTED_EXPERIENCE_PATTERNS);
  const commissionRateCount = countPatternHits(fullBody, COMMISSION_RATE_PATTERNS);
  const internalGuidanceCount = countPatternHits(fullBody, INTERNAL_GUIDANCE_PATTERNS);
  const requireRepresentativeImage = input.requireRepresentativeImage !== false;
  const editorialCoverage = assessProductEditorialCoverage(sections.slice(0, -1));

  const baseSignals: BrandLinkContentReadinessSignal[] = [
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
      status: mainSectionCount >= 4 ? "pass" : "fail",
    },
    {
      key: "editorial-flow",
      label: "문제-효익-근거-사용-주의 흐름",
      status: editorialCoverage.missingCoreRoles.length <= 1 ? "pass" : "warn",
    },
    {
      key: "length",
      label: "본문 분량",
      status: totalLength >= 1000 ? "pass" : totalLength >= 750 ? "warn" : "fail",
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
  ];

  const failSignal = baseSignals.find((signal) => signal.status === "fail");
  const warningCount = baseSignals.filter((signal) => signal.status === "warn").length;
  const score = Math.max(
    0,
    100 - baseSignals.filter((signal) => signal.status === "fail").length * 18 - warningCount * 5,
  );

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

  if (mainSectionCount < 4) {
    return buildResult({
      code: "too-few-sections",
      reason: `본문 섹션이 부족합니다. 현재 ${mainSectionCount}개, 최소 4개가 필요합니다.`,
      score,
      sectionCount: sections.length,
      hashtagCount: input.hashtags.length,
      totalLength,
      coveredProductTokens,
      missingProductTokens,
      signals: baseSignals,
    });
  }

  if (totalLength < 750) {
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
