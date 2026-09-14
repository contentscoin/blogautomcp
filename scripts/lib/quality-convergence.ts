import type {
  BrandLinkContentReadiness,
  BrandLinkQualityCategory,
  BrandLinkReadinessCode,
} from "./brandlink-content-readiness";

export type QualityConvergenceAction =
  | "complete"
  | "repair-text"
  | "refresh-source"
  | "repair-composition"
  | "stop";

export interface QualityConvergenceTarget {
  key: string;
  kind: "text" | "source" | "composition" | "safety";
  instruction: string;
  evidence: string[];
}

export interface QualityConvergencePlan {
  action: QualityConvergenceAction;
  shouldGenerateText: boolean;
  failureSignature: string;
  reason: string;
  targets: QualityConvergenceTarget[];
}

const COMPOSITION_CODES = new Set<BrandLinkReadinessCode>([
  "missing-representative-image",
  "composition-quality",
]);

const NON_REPAIRABLE_CODES = new Set<BrandLinkReadinessCode>([
  "non-generative-fallback",
]);

const STRUCTURAL_REASSEMBLY_CODES = new Set<BrandLinkReadinessCode>([
  "too-few-sections",
  "too-few-hashtags",
  "missing-disclosure",
]);

const CATEGORY_INSTRUCTIONS: Record<string, string> = {
  productEvidence: "서로 다른 저장 출처 사실을 본문에 정확히 반영하고, 각 사실을 제품의 기능·구조·규격과 연결하세요.",
  sceneLinkage: "같은 문단 안에서 서로 다른 확인 사실을 각각 사용 장면의 이점 또는 제약으로 해석하세요.",
  specificity: "출처에 있는 규격과 구조를 사용·조리·보관·관리 방법으로 구체화하되 미확인 방법은 만들지 마세요.",
  diversity: "뜻이 겹치는 문장을 제거하고, 반복 자리에는 아직 쓰지 않은 출처 사실과 새로운 판단을 넣으세요.",
  usefulness: "구체적인 장점, 제품 자체의 제약, 추천·비추천 대상, 조건부 결론 중 누락된 항목을 근거와 함께 보강하세요.",
  clarity: "확인·비교 안내와 일반론을 줄이고, 저장 출처 사실과 그 사실이 독자 판단에 주는 의미를 직접 쓰세요.",
};

const BLOCKER_INSTRUCTIONS: Partial<Record<BrandLinkReadinessCode, string>> = {
  "missing-product-name": "저장된 정확한 상품명을 제목과 본문에 자연스럽게 반영하세요.",
  "too-few-sections": "필수 섹션 수를 채우되 같은 뜻을 나누지 말고 서로 다른 근거와 역할로 구성하세요.",
  "too-short-content": "새 사실을 만들지 말고 확인 근거의 의미, 사용 방법, 제약과 적합 대상을 구체화해 분량을 충족하세요.",
  "link-in-body": "본문의 원시 상품 URL을 제거하세요. 커넥트 링크는 시스템 컴포넌트가 붙입니다.",
  "missing-disclosure": "커넥트 고지는 시스템 조립 단계에서 추가하세요.",
  "unsupported-experience-claim": "검증되지 않은 직접 구매·사용·방문 경험 표현을 정보형 문장으로 고치세요.",
  "commission-rate-exposed": "수수료율과 내부 정산 정보를 본문에서 제거하세요.",
  "internal-guidance-leak": "프롬프트·워크플로우·작성 지침 같은 내부 문구를 제거하세요.",
  "category-mismatch": "다른 상품군이나 여행/쇼핑 문맥이 섞인 문장을 제거하고 현재 상품의 확인 근거만 남기세요.",
  "repetitive-content": CATEGORY_INSTRUCTIONS.diversity,
  "generic-guidance-heavy": CATEGORY_INSTRUCTIONS.clarity,
  "low-evidence-density": CATEGORY_INSTRUCTIONS.sceneLinkage,
  "missing-review-substance": CATEGORY_INSTRUCTIONS.usefulness,
  "quality-score-below-threshold": "점수가 낮은 품질 항목을 모두 보강하고 이미 통과한 사실·섹션·이미지 연결은 유지하세요.",
};

function failedCategories(readiness: BrandLinkContentReadiness): BrandLinkQualityCategory[] {
  return readiness.qualityFailures?.length
    ? readiness.qualityFailures
    : readiness.quality.categories.filter((category) => category.status === "fail");
}

function failureKeys(readiness: BrandLinkContentReadiness): string[] {
  return [
    ...readiness.blockers.map((blocker) => `blocker:${blocker.code}`),
    ...failedCategories(readiness).map((category) => `quality:${category.key}`),
    ...readiness.signals
      .filter((signal) => signal.status === "fail")
      .map((signal) => `signal:${signal.key}`),
  ].sort();
}

/** Stable across message wording changes so repeated ineffective rewrites stop. */
export function qualityFailureSignature(readiness: BrandLinkContentReadiness): string {
  return [...new Set(failureKeys(readiness))].join("|") || "none";
}

function categoryTarget(category: BrandLinkQualityCategory): QualityConvergenceTarget {
  return {
    key: category.key,
    kind: "text",
    instruction: CATEGORY_INSTRUCTIONS[category.key] || `품질 항목 '${category.label}'을 저장 출처 근거 안에서 보강하세요.`,
    evidence: category.notes,
  };
}

export function planQualityConvergence(input: {
  current: BrandLinkContentReadiness;
  previous?: BrandLinkContentReadiness | null;
  attempt: number;
  maximumAttempts: number;
}): QualityConvergencePlan {
  const { current, previous } = input;
  const failureSignature = qualityFailureSignature(current);
  if (current.canPublish) {
    return { action: "complete", shouldGenerateText: false, failureSignature, reason: "원고 품질 게이트를 통과했습니다.", targets: [] };
  }

  const categories = failedCategories(current);
  const evidence = current.quality.sourceEvidence;
  const sourceInsufficient = (evidence?.level === "sparse" || evidence?.level === "travel") && evidence.sufficient === false &&
    categories.some((category) => category.key === "productEvidence");
  if (sourceInsufficient) {
    const travelEvidenceMissing = evidence?.level === "travel";
    return {
      action: "refresh-source",
      shouldGenerateText: false,
      failureSignature,
      reason: travelEvidenceMissing
        ? "저장된 핵심 방문지·일차별 일정 근거가 부족해 원고를 다시 써도 품질이 수렴하지 않습니다. 여행상품 상세 정보를 먼저 다시 수집해야 합니다."
        : "저장된 상품 고유 근거가 부족해 원고를 다시 써도 품질이 수렴하지 않습니다. 상품 상세 정보를 먼저 다시 수집해야 합니다.",
      targets: [{
        key: "productEvidence",
        kind: "source",
        instruction: travelEvidenceMissing
          ? "여행상품 상세에서 핵심 방문지와 일차별 이동·활동 일정을 다시 수집한 뒤 같은 원고를 재검사하세요."
          : "상품 상세에서 서로 다른 기능·구조·규격과 필요한 사용 조건을 다시 수집한 뒤 같은 원고를 재검사하세요.",
        evidence: categories.find((category) => category.key === "productEvidence")?.notes || [],
      }],
    };
  }

  const compositionBlockers = current.blockers.filter((blocker) => COMPOSITION_CODES.has(blocker.code));
  const textBlockers = current.blockers.filter((blocker) => !COMPOSITION_CODES.has(blocker.code));
  if (compositionBlockers.length > 0 && textBlockers.length === 0 && categories.length === 0) {
    return {
      action: "repair-composition",
      shouldGenerateText: false,
      failureSignature,
      reason: "원고는 통과했고 이미지 또는 렌더 구성만 보강하면 됩니다.",
      targets: compositionBlockers.map((blocker) => ({
        key: blocker.code,
        kind: "composition",
        instruction: blocker.reason,
        evidence: [blocker.reason],
      })),
    };
  }

  if (current.blockers.some((blocker) => NON_REPAIRABLE_CODES.has(blocker.code))) {
    return {
      action: "stop",
      shouldGenerateText: false,
      failureSignature,
      reason: "현재 원고의 생성 출처를 신뢰할 수 없어 자동 보강을 중단합니다.",
      targets: current.blockers.map((blocker) => ({ key: blocker.code, kind: "safety", instruction: blocker.reason, evidence: [blocker.reason] })),
    };
  }

  const structuralBlockers = current.blockers.filter((blocker) => STRUCTURAL_REASSEMBLY_CODES.has(blocker.code));
  if (structuralBlockers.length > 0) {
    return {
      action: "stop",
      shouldGenerateText: false,
      failureSignature,
      reason: "섹션 수·해시태그·고지는 부분 문단 수정으로 복구할 수 없어 자동 재작성을 중단합니다. 원고 구조를 다시 조립해야 합니다.",
      targets: structuralBlockers.map((blocker) => ({
        key: blocker.code,
        kind: blocker.tier === "safety" ? "safety" : "text",
        instruction: blocker.reason,
        evidence: [blocker.reason],
      })),
    };
  }

  const noProgress = previous && qualityFailureSignature(previous) === failureSignature &&
    current.score <= previous.score;
  if (noProgress || input.attempt >= input.maximumAttempts) {
    return {
      action: "stop",
      shouldGenerateText: false,
      failureSignature,
      reason: noProgress
        ? "직전 보강과 실패 항목·점수가 같아 같은 방식의 재작성을 중단합니다."
        : `자동 보강 한도 ${input.maximumAttempts}회에 도달했습니다.`,
      targets: categories.map(categoryTarget),
    };
  }

  const blockerTargets: QualityConvergenceTarget[] = textBlockers.map((blocker) => ({
    key: blocker.code,
    kind: blocker.tier === "safety" ? "safety" : "text",
    instruction: BLOCKER_INSTRUCTIONS[blocker.code] || blocker.reason,
    evidence: [blocker.reason],
  }));
  const scoreTarget = current.code === "quality-score-below-threshold" && categories.length === 0
    ? [...current.quality.categories]
        .sort((a, b) => a.score / Math.max(1, a.maxScore) - b.score / Math.max(1, b.maxScore))
        .slice(0, 1)
        .map(categoryTarget)
    : [];
  const targets = [...blockerTargets, ...categories.map(categoryTarget), ...scoreTarget]
    .filter((target, index, all) => all.findIndex((candidate) => candidate.key === target.key) === index);
  return {
    action: "repair-text",
    shouldGenerateText: true,
    failureSignature,
    reason: "저장 출처는 유지하면서 실패한 원고 품질 항목만 자동 보강할 수 있습니다.",
    targets,
  };
}

const QUALITY_SECTION_PATTERNS: Record<string, RegExp[]> = {
  productEvidence: [/(?:핵심\s*)?(?:기능|구조|규격|스펙|수치|소재|배터리|용량|크기|무게|방문지|일정|코스|역사|문화)/u],
  sceneLinkage: [/(?:사용\s*장면|활용|사용\s*가치|장점|강점|이점|제약|현장|풍경|활동|즐길|동선)/u],
  specificity: [/(?:사용\s*(?:방법|순서)|설치|조작|충전|세척|관리|보관|조리|해동|이동|복장|시간대|실용\s*팁)/u],
  usefulness: [/(?:장점|강점|단점|한계|제약|주의|추천|비추천|대상|결론|판단|잘\s*맞|맞지\s*않)/u],
  clarity: [/(?:확인(?:해|하|해야|하세요)|살펴보|비교해보|보는\s*게\s*좋|상세\s*페이지|판매\s*페이지|일반적|보입니다|것\s*같)/u],
};

const BLOCKER_SECTION_PATTERNS: Partial<Record<BrandLinkReadinessCode, RegExp[]>> = {
  "link-in-body": [/https?:\/\/(?:naver\.me|brandconnect\.naver\.com|shopping\.naver\.com)\/\S+/iu],
  "unsupported-experience-claim": [/(?:제가|저도|직접).{0,24}(?:구매|주문|사용|체험|방문|다녀)|(?:구매|주문|사용|체험|먹어|방문).{0,12}(?:해?\s*봤|다녀왔)/u],
  "commission-rate-exposed": [/(?:수수료|커미션|commission).{0,12}\d|\d+(?:\.\d+)?\s*%.{0,12}(?:수수료|커미션|commission)|(?:제휴율|정산\s*조건|내부\s*정산)/iu],
  "internal-guidance-leak": [/(?:opencrab|오픈크랩|seo\s*브리프|워크플로우|작성\s*(?:규칙|지침|가이드|프로세스)|프롬프트|출력\s*형식|json\s*만|시스템\s*지시)/iu],
  "category-mismatch": [/(?:배송|교환|반품|구성품|제품\s*스펙)/u],
};

function patternMatches(pattern: RegExp, value: string): boolean {
  return new RegExp(pattern.source, pattern.flags.replace(/g/gu, "")).test(value);
}

function patternHitCount(pattern: RegExp, value: string): number {
  return Array.from(value.matchAll(new RegExp(pattern.source, `${pattern.flags.replace(/g/gu, "")}g`))).length;
}

function shortestSectionIndex(sections: string[]): number {
  return sections.reduce((selected, section, index) =>
    selected < 0 || section.length < sections[selected].length ? index : selected, -1);
}

function bestPatternSection(sections: string[], patterns: RegExp[]): number | null {
  let selected: { index: number; hits: number } | null = null;
  for (const [index, section] of sections.entries()) {
    const hits = patterns.reduce((sum, pattern) => sum + patternHitCount(pattern, section), 0);
    if (hits > 0 && (!selected || hits > selected.hits)) selected = { index, hits };
  }
  return selected?.index ?? null;
}

function repeatedSectionIndexes(readiness: BrandLinkContentReadiness, sections: string[]): number[] {
  const selected = new Set<number>();
  for (const sample of readiness.quality.repetition.samples) {
    const matching = sections.flatMap((section, index) =>
      section.includes(sample.b) || section.includes(sample.a) ? [index] : []);
    // Keep the first occurrence as the reference and edit only later copies.
    matching.slice(1).forEach((index) => selected.add(index));
    if (matching.length === 1) selected.add(matching[0]);
  }
  if (selected.size === 0 && readiness.quality.repetition.duplicateOpeningCount > 0) {
    const firstByOpening = new Map<string, number>();
    sections.forEach((section, index) => {
      const opening = section.split(/[.!?。\n]/u).map((item) => item.trim()).find(Boolean) || "";
      if (!opening) return;
      const prior = firstByOpening.get(opening);
      if (prior === undefined) firstByOpening.set(opening, index);
      else selected.add(index);
    });
  }
  return [...selected];
}

function usefulnessPatterns(notes: string[]): RegExp[] {
  const text = notes.join(" ");
  const patterns: RegExp[] = [];
  if (/장점|강점/u.test(text)) patterns.push(/장점|강점|선택\s*이유/u);
  if (/단점|제약|한계|주의/u.test(text)) patterns.push(/단점|제약|한계|주의|아쉬|반면/u);
  if (/추천|비추천|대상/u.test(text)) patterns.push(/추천|비추천|대상|잘\s*맞|맞지\s*않/u);
  if (/결론|판단/u.test(text)) patterns.push(/결론|최종|판단|선택\s*기준/u);
  if (/사용|설치|관리|조리|실용\s*팁/u.test(text)) patterns.push(QUALITY_SECTION_PATTERNS.specificity[0]);
  if (/후기|구매자/u.test(text)) patterns.push(/후기|구매자|사용자/u);
  if (/역사|문화|지리/u.test(text)) patterns.push(/역사|문화|지리|유래|전통/u);
  if (/풍경|분위기/u.test(text)) patterns.push(/풍경|분위기|전망|골목|거리/u);
  if (/즐길|활동/u.test(text)) patterns.push(/즐길|활동|관람|산책|촬영|체험/u);
  return patterns.length ? patterns : QUALITY_SECTION_PATTERNS.usefulness;
}

function blockerEvidenceTerms(reason: string): string[] {
  const suffix = reason.match(/(?:감지|섞였습니다)\s*[:：]\s*(.+)$/u)?.[1];
  if (!suffix) return [];
  return suffix.split(/\s*[,/]\s*/u)
    .map((value) => value.replace(/["'“”‘’.!?]+$/gu, "").trim())
    .filter((value) => value.length >= 2);
}

/**
 * Infer the smallest useful edit scope from the current gate failures. The
 * statutory disclosure is excluded. Callers may pass explicit indexes for a
 * user-directed edit; scheduled convergence normally omits them and uses this
 * evidence-derived scope instead of rewriting the whole draft.
 */
export function selectQualityRepairSectionIndexes(input: {
  current: BrandLinkContentReadiness;
  sections: string[];
  plan?: QualityConvergencePlan | null;
  requestedIndexes?: number[];
}): number[] {
  const bodySections = input.sections.slice(0, -1);
  if (bodySections.length === 0) return [];
  const validRequested = [...new Set(input.requestedIndexes || [])]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < bodySections.length)
    .sort((a, b) => a - b);
  if (validRequested.length > 0) return validRequested;

  const selected = new Set<number>();
  const addBest = (patterns: RegExp[]) => {
    const index = bestPatternSection(bodySections, patterns);
    if (index !== null) selected.add(index);
  };
  const addAllMatches = (patterns: RegExp[]) => bodySections.forEach((section, index) => {
    if (patterns.some((pattern) => patternMatches(pattern, section))) selected.add(index);
  });
  const targetKeys = input.plan?.targets.map((target) => target.key) || [
    ...input.current.blockers.map((blocker) => blocker.code),
    ...failedCategories(input.current).map((category) => category.key),
  ];

  for (const key of [...new Set(targetKeys)]) {
    const blockerCode = key as BrandLinkReadinessCode;
    const blockerPatterns = BLOCKER_SECTION_PATTERNS[blockerCode];
    if (blockerPatterns) {
      addAllMatches(blockerPatterns);
      const blocker = input.current.blockers.find((candidate) => candidate.code === blockerCode);
      const evidenceTerms = blocker ? blockerEvidenceTerms(blocker.reason) : [];
      bodySections.forEach((section, index) => {
        if (evidenceTerms.some((term) => section.includes(term))) selected.add(index);
      });
      continue;
    }
    if (key === "missing-product-name") {
      selected.add(0);
      continue;
    }
    if (key === "too-short-content") {
      selected.add(shortestSectionIndex(bodySections));
      continue;
    }
    if (key === "diversity" || key === "repetitive-content") {
      repeatedSectionIndexes(input.current, bodySections).forEach((index) => selected.add(index));
      continue;
    }
    if (key === "clarity" || key === "generic-guidance-heavy") {
      addBest(QUALITY_SECTION_PATTERNS.clarity);
      continue;
    }
    if (key === "usefulness" || key === "missing-review-substance") {
      const notes = input.current.quality.categories.find((category) => category.key === "usefulness")?.notes || [];
      addBest(usefulnessPatterns(notes));
      continue;
    }
    const patterns = QUALITY_SECTION_PATTERNS[key];
    if (patterns) addBest(patterns);
  }

  // A low aggregate score can have only warn categories. Target its weakest
  // measured category, never every section as an implicit fallback.
  if (selected.size === 0 && input.current.code === "quality-score-below-threshold") {
    const weakest = [...input.current.quality.categories]
      .sort((a, b) => a.score / Math.max(1, a.maxScore) - b.score / Math.max(1, b.maxScore))[0];
    if (weakest) {
      const patterns = weakest.key === "usefulness"
        ? usefulnessPatterns(weakest.notes)
        : QUALITY_SECTION_PATTERNS[weakest.key];
      if (patterns) addBest(patterns);
    }
  }
  if (selected.size === 0) selected.add(shortestSectionIndex(bodySections));
  return [...selected].filter((index) => index >= 0).sort((a, b) => a - b);
}

export function formatQualityConvergenceInstructions(plan: QualityConvergencePlan): string {
  return plan.targets.map((target, index) => [
    `${index + 1}. ${target.instruction}`,
    target.evidence.length ? `   검사 근거: ${target.evidence.join(" ")}` : "",
  ].filter(Boolean).join("\n")).join("\n");
}
