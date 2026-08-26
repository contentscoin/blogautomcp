import { parsePreparedTopicContent } from "@/lib/topic-task-contract";

const STRONG_META_WRITING_PATTERNS = [
  /요청 맥락 기반 확장/i,
  /실제 글 발행에 바로 쓸 수 있는 구조/i,
  /품질이 안정적입니다/i,
  /입력 키워드와 리서치 시그널을 바탕으로/i,
  /본 포스팅에서는/i,
  /최적의 선택/i,
] as const;

const META_WRITING_PATTERNS = [
  ...STRONG_META_WRITING_PATTERNS,
  /핵심 내용입니다/i,
  /결론적으로/i,
  /종합적으로/i,
  /이번 글에서는/i,
  /체계적으로 정리/i,
  /완벽한 해결책/i,
  /적용 순서가 보이도록 재구성/i,
  /바로 실행할 수 있게 풀어/i,
  /도입에서는/i,
  /마무리에서는/i,
  /이 글은 .*구성/i,
  /독자는 .*궁금해합니다/i,
] as const;

const GENERIC_HEADING_PATTERNS = [
  /^핵심 정리$/i,
  /^실전 포인트$/i,
  /^마무리$/i,
  /^포인트 \d+$/i,
  /^정리 \d+$/i,
] as const;

const BROKEN_COPY_PATTERNS = [
  /문장가|장면가|방법가/u,
  /감이 온다 [가-힣]{4,}(?:는|은|이|가|를|을)\b/u,
  /[가-힣]{4,}에서는\s+[가-힣]{4,}(?:에서|는|은|이|가)\b/u,
  /사람 말처럼|사람 냄새|교과서처럼/u,
] as const;

export interface TopicTaskContentReadinessInput {
  topic?: string | null;
  keywords?: string | null;
  type?: string | null;
  topicCraftCategory?: string | null;
  preparedContentJson: string | null;
  /** Optional context. Older callers may omit these fields. */
  sourceUrls?: string[];
  affiliateDisclosureRequired?: boolean;
  mediaRequired?: boolean;
  maxRepairAttempts?: number;
}

export type TopicTaskReadinessCategoryKey =
  | "factsSources"
  | "searchIntentTitle"
  | "mobileReadability"
  | "differentiationExperience"
  | "disclosure"
  | "mediaLinkIntegrity"
  | "voiceMatch";

export interface TopicTaskReadinessCategory {
  key: TopicTaskReadinessCategoryKey;
  label: string;
  score: number;
  maxScore: number;
  notes: string[];
}

export interface TopicTaskRepairPlan {
  strategy: "targeted";
  maxAttempts: number;
  targets: Array<{
    category: TopicTaskReadinessCategoryKey;
    priority: "P0" | "P1" | "P2";
    instruction: string;
    sectionIndexes: number[];
  }>;
}

export interface TopicTaskContentReadiness {
  canPublish: boolean;
  code:
    | "ok"
    | "not-prepared"
    | "missing-lead"
    | "missing-highlights"
    | "too-few-sections"
    | "weak-keyword-coverage"
    | "meta-writing-contamination"
    | "broken-copy"
    | "repeated-structure"
    | "unsupported-factual-claim"
    | "missing-affiliate-disclosure"
    | "broken-critical-media"
    | "quality-score-below-threshold"
    | "manual-review-required";
  reason: string | null;
  needsPrepare: boolean;
  sectionCount: number;
  highlightCount: number;
  keywordCoverage: number;
  coveredKeywords: string[];
  missingKeywords: string[];
  score: number;
  summary: string;
  signals: Array<{
    key: string;
    label: string;
    status: "pass" | "warn" | "fail";
  }>;
  /** Additive v2 fields; existing consumers can continue using the legacy fields above. */
  rubric: TopicTaskReadinessCategory[];
  p0Blockers: Array<{ code: string; reason: string; sectionIndexes: number[] }>;
  repair: TopicTaskRepairPlan;
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function countPatternHits(value: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

function isWritingFocusedTopic(input: TopicTaskContentReadinessInput): boolean {
  const haystack = [input.topic, input.type, input.topicCraftCategory]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ");

  return /(글|문장|블로그|콘텐츠|카피|초안|독자|가독성|소주제|윤문|제목|후킹|writing|content|blog)/i.test(
    haystack,
  );
}

function countNormalizedOccurrences(haystack: string, needle: string): number {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedHaystack || !normalizedNeedle) return 0;

  let count = 0;
  let startIndex = 0;
  while (startIndex < normalizedHaystack.length) {
    const foundIndex = normalizedHaystack.indexOf(normalizedNeedle, startIndex);
    if (foundIndex === -1) break;
    count += 1;
    startIndex = foundIndex + normalizedNeedle.length;
  }

  return count;
}

function containsNonWritingMetaBody(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  return /(글이|글은|글을|문장이|문장은|읽는 사람|읽힙니다|독자가|본문이)/u.test(normalized);
}

function countDuplicateValues(values: string[]): number {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  let duplicates = 0;
  counts.forEach((count) => {
    if (count > 1) duplicates += count - 1;
  });
  return duplicates;
}

function getBodyOpening(sectionBody: string): string {
  const normalized = normalizeText(sectionBody);
  if (!normalized) return "";

  const firstSentence = normalized
    .split(/(?<=[.!?])\s+|(?<=다\.)\s+/u)
    .map((sentence) => normalizeText(sentence))
    .find(Boolean);

  return normalizeText((firstSentence || normalized).slice(0, 28));
}

function buildReadinessBase(input: {
  code: TopicTaskContentReadiness["code"];
  reason: string | null;
  needsPrepare: boolean;
  sectionCount: number;
  highlightCount: number;
  keywordCoverage?: number;
  coveredKeywords?: string[];
  missingKeywords?: string[];
  score: number;
  signals: TopicTaskContentReadiness["signals"];
  rubric?: TopicTaskReadinessCategory[];
  p0Blockers?: TopicTaskContentReadiness["p0Blockers"];
  repair?: TopicTaskRepairPlan;
}): TopicTaskContentReadiness {
  const passingSignals = input.signals.filter((signal) => signal.status === "pass").length;
  const summary =
    input.code === "ok"
      ? `콘텐츠 게이트 통과 (${input.score}점, 신호 ${passingSignals}/${input.signals.length})`
      : `콘텐츠 보강 필요 (${input.score}점, ${input.reason || "게이트 미통과"})`;

  return {
    canPublish: input.code === "ok",
    code: input.code,
    reason: input.reason,
    needsPrepare: input.needsPrepare,
    sectionCount: input.sectionCount,
    highlightCount: input.highlightCount,
    keywordCoverage: input.keywordCoverage ?? 1,
    coveredKeywords: input.coveredKeywords ?? [],
    missingKeywords: input.missingKeywords ?? [],
    score: input.score,
    summary,
    signals: input.signals,
    rubric: input.rubric ?? buildEmptyRubric(input.score),
    p0Blockers: input.p0Blockers ?? [],
    repair: input.repair ?? {
      strategy: "targeted",
      maxAttempts: 3,
      targets: [],
    },
  };
}

const RUBRIC_WEIGHTS: Array<[TopicTaskReadinessCategoryKey, string, number]> = [
  ["factsSources", "사실성·출처", 25],
  ["searchIntentTitle", "검색 의도·제목", 20],
  ["mobileReadability", "모바일 가독성", 15],
  ["differentiationExperience", "체험성·차별성", 15],
  ["disclosure", "광고·제휴 고지", 10],
  ["mediaLinkIntegrity", "이미지·링크 무결성", 10],
  ["voiceMatch", "문체 일치", 5],
];

function buildEmptyRubric(totalScore: number): TopicTaskReadinessCategory[] {
  let remaining = Math.max(0, Math.min(100, totalScore));
  return RUBRIC_WEIGHTS.map(([key, label, maxScore]) => {
    const score = Math.min(maxScore, remaining);
    remaining -= score;
    return { key, label, score, maxScore, notes: [] };
  });
}

const DISCLOSURE_PATTERN = /(광고|유료광고|제휴\s*링크|수수료를?\s*(?:받|제공)|경제적\s*대가|소정의\s*수수료)/iu;
const PLACEHOLDER_PATTERN = /(TODO|TBD|XXX|\[\s*(?:이미지|링크|사진|URL|출처)\s*(?:삽입|추가|필요)?\s*\]|<[^>]*(?:image|url|link)[^>]*>)/iu;
const CRITICAL_FACT_PATTERN = /(?:\d[\d,.]*\s*(?:원|만원|%|퍼센트|분|시간|km|㎞|m|명|개|회)|(?:가격|요금|할인율|운영시간|영업시간|소요시간|거리|예약률|만족도)\s*(?:은|는|이|가|:)?\s*\d)/iu;
const BROKEN_URL_PATTERN = /(?:https?:\/\/\s|https?:\/\/(?:example\.com|localhost|127\.0\.0\.1)|(?:href|src)=["']?["']?\s)/iu;

function looksAffiliate(input: TopicTaskContentReadinessInput): boolean {
  if (typeof input.affiliateDisclosureRequired === "boolean") return input.affiliateDisclosureRequired;
  return /(쇼핑|여행|브랜드)\s*커넥트|affiliate|제휴|파트너스/iu.test(
    [input.topic, input.type, input.topicCraftCategory].map(normalizeText).join(" "),
  );
}

function parseKeywords(raw: string | null | undefined): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const item of raw.split(/[\n,#,]/)) {
    const normalized = normalizeText(item.replace(/https?:\/\/\S+/gi, " "));
    if (!normalized || /^(source|url|link|출처)$/i.test(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(normalized);
    if (keywords.length >= 12) break;
  }

  return keywords;
}

function buildKeywordCoverage(
  input: TopicTaskContentReadinessInput,
  parsed: NonNullable<ReturnType<typeof parsePreparedTopicContent>>,
) {
  const targetKeywords = parseKeywords(input.keywords);
  if (targetKeywords.length === 0) {
    return {
      targetKeywords,
      coveredKeywords: [],
      missingKeywords: [],
      coverage: 1,
    };
  }

  const corpus = normalizeText(
    [
      parsed.title,
      parsed.lead,
      ...(parsed.highlights || []),
      ...(parsed.hashtags || []),
      parsed.meta?.summary,
      ...parsed.sections.flatMap((section) => [
        section.heading,
        section.summary,
        section.body,
        ...(section.bullets || []),
      ]),
    ]
      .filter(Boolean)
      .join(" "),
  ).toLowerCase();

  const coveredKeywords = targetKeywords.filter((keyword) => corpus.includes(keyword.toLowerCase()));
  const missingKeywords = targetKeywords.filter((keyword) => !coveredKeywords.includes(keyword));

  return {
    targetKeywords,
    coveredKeywords,
    missingKeywords,
    coverage: coveredKeywords.length / Math.max(1, targetKeywords.length),
  };
}

function assessNaverRubric(
  input: TopicTaskContentReadinessInput,
  parsed: NonNullable<ReturnType<typeof parsePreparedTopicContent>>,
  keywordCoverage: number,
): {
  rubric: TopicTaskReadinessCategory[];
  score: number;
  blockers: TopicTaskContentReadiness["p0Blockers"];
  repair: TopicTaskRepairPlan;
} {
  const title = normalizeText(parsed.title);
  const lead = normalizeText(parsed.lead);
  const sections = parsed.sections || [];
  const corpus = normalizeText([
    title,
    lead,
    ...(parsed.highlights || []),
    ...sections.flatMap((section) => [section.heading, section.summary, section.body]),
  ].filter(Boolean).join("\n"));
  const externalSourceCount = (input.sourceUrls || []).filter((url) => /^https?:\/\/\S+$/i.test(url)).length;
  const validSourceRefIds = new Set(
    Array.from({ length: externalSourceCount }, (_, index) => String(index + 1)),
  );
  const getValidSourceRefs = (sourceRefIds: string[] | undefined): string[] =>
    Array.from(
      new Set(
        (sourceRefIds || [])
          .map((value) => normalizeText(value))
          .filter((value) => validSourceRefIds.has(value)),
      ),
    );
  const citedSectionCount = sections.filter(
    (section) => getValidSourceRefs(section.sourceRefIds).length > 0,
  ).length;
  const unsupportedFactSections = sections
    .map((section, index) => ({ section, index }))
    .filter(
      ({ section }) =>
        CRITICAL_FACT_PATTERN.test(normalizeText(section.body)) &&
        getValidSourceRefs(section.sourceRefIds).length === 0,
    )
    .map(({ index }) => index);
  const disclosureRequired = looksAffiliate(input);
  const hasDisclosure = DISCLOSURE_PATTERN.test(corpus);
  const placeholderSections = sections
    .map((section, index) => ({ text: `${section.heading} ${section.body} ${section.stockQuery || ""}`, index }))
    .filter(({ text }) => PLACEHOLDER_PATTERN.test(text) || BROKEN_URL_PATTERN.test(text))
    .map(({ index }) => index);
  const titleIntent = title.length >= 12 && title.length <= 48;
  const averageBodyLength = sections.length
    ? sections.reduce((sum, section) => sum + normalizeText(section.body).length, 0) / sections.length
    : 0;
  const mobileOk = averageBodyLength >= 45 && averageBodyLength <= 260;
  const experientialCount = sections.filter((section) =>
    section.kind === "scene" || section.kind === "comparison" || section.kind === "proof" ||
    /(직접|실제로|써보|가보|먹어보|비교해|확인해|느꼈|경험)/u.test(section.body),
  ).length;
  const mediaPresent = sections.some((section) => Boolean(section.stockQuery || section.imageSlotId));

  const rubric: TopicTaskReadinessCategory[] = [
    {
      key: "factsSources", label: "사실성·출처", maxScore: 25,
      score: unsupportedFactSections.length > 0 ? 0 : citedSectionCount > 0 || externalSourceCount > 0 ? 25 : 16,
      notes: unsupportedFactSections.length ? ["검증 가능한 수치·조건에 연결된 출처가 없습니다."] : citedSectionCount || externalSourceCount ? [] : ["출처 연결이 없어 일반 서술 수준으로 평가했습니다."],
    },
    {
      key: "searchIntentTitle", label: "검색 의도·제목", maxScore: 20,
      score: Math.max(0, Math.min(20, (titleIntent ? 10 : title ? 6 : 0) + Math.round(keywordCoverage * 10))),
      notes: titleIntent ? [] : ["네이버 모바일에서 읽히는 12~48자 제목을 권장합니다."],
    },
    {
      key: "mobileReadability", label: "모바일 가독성", maxScore: 15,
      score: mobileOk ? 15 : averageBodyLength > 0 && averageBodyLength <= 340 ? 10 : 5,
      notes: mobileOk ? [] : ["문단 호흡을 45~260자 수준으로 조정하세요."],
    },
    {
      key: "differentiationExperience", label: "체험성·차별성", maxScore: 15,
      score: experientialCount >= 2 ? 15 : experientialCount === 1 ? 10 : 5,
      notes: experientialCount ? [] : ["직접 확인한 장면·비교·근거를 추가하세요."],
    },
    {
      key: "disclosure", label: "광고·제휴 고지", maxScore: 10,
      score: !disclosureRequired || hasDisclosure ? 10 : 0,
      notes: disclosureRequired && !hasDisclosure ? ["제휴 콘텐츠 고지문이 필요합니다."] : [],
    },
    {
      key: "mediaLinkIntegrity", label: "이미지·링크 무결성", maxScore: 10,
      score: placeholderSections.length ? 0 : input.mediaRequired && !mediaPresent ? 0 : 10,
      notes: placeholderSections.length ? ["미완성 이미지·링크 자리표시자 또는 잘못된 URL이 있습니다."] : input.mediaRequired && !mediaPresent ? ["필수 이미지 슬롯이 없습니다."] : [],
    },
    {
      key: "voiceMatch", label: "문체 일치", maxScore: 5,
      score: normalizeText(parsed.meta?.tone) ? 5 : 3,
      notes: normalizeText(parsed.meta?.tone) ? [] : ["목표 문체(tone) 메타데이터를 지정하세요."],
    },
  ];
  const blockers: TopicTaskContentReadiness["p0Blockers"] = [];
  if (unsupportedFactSections.length) blockers.push({ code: "unsupported-factual-claim", reason: "가격·할인율·시간·거리 등 검증 가능한 수치에 출처가 연결되지 않았습니다.", sectionIndexes: unsupportedFactSections });
  if (disclosureRequired && !hasDisclosure) blockers.push({ code: "missing-affiliate-disclosure", reason: "제휴성 콘텐츠에 필수 광고·수수료 고지문이 없습니다.", sectionIndexes: [] });
  if (placeholderSections.length || (input.mediaRequired && !mediaPresent)) blockers.push({ code: "broken-critical-media", reason: placeholderSections.length ? "미완성 미디어·링크 자리표시자 또는 잘못된 URL이 있습니다." : "필수 미디어 슬롯이 없습니다.", sectionIndexes: placeholderSections });
  const targets: TopicTaskRepairPlan["targets"] = rubric
    .filter((item) => item.score < item.maxScore)
    .map((item) => ({
      category: item.key,
      priority: blockers.some((blocker) =>
        (blocker.code === "unsupported-factual-claim" && item.key === "factsSources") ||
        (blocker.code === "missing-affiliate-disclosure" && item.key === "disclosure") ||
        (blocker.code === "broken-critical-media" && item.key === "mediaLinkIntegrity")) ? "P0" as const : item.score / item.maxScore < 0.6 ? "P1" as const : "P2" as const,
      instruction: item.notes[0] || `${item.label} 항목만 부분 보강하세요.`,
      sectionIndexes: item.key === "factsSources" ? unsupportedFactSections : item.key === "mediaLinkIntegrity" ? placeholderSections : [],
    }));
  return {
    rubric,
    score: rubric.reduce((sum, item) => sum + item.score, 0),
    blockers,
    repair: { strategy: "targeted", maxAttempts: Math.max(1, Math.min(3, input.maxRepairAttempts ?? 3)), targets },
  };
}

export function getTopicTaskContentReadiness(
  input: TopicTaskContentReadinessInput,
): TopicTaskContentReadiness {
  const parsed = parsePreparedTopicContent(input.preparedContentJson);
  if (!parsed) {
    return buildReadinessBase({
      code: "not-prepared",
      reason: "발행 전에 prepare 단계가 완료되어야 합니다. 먼저 주제글 준비를 다시 실행하세요.",
      needsPrepare: true,
      sectionCount: 0,
      highlightCount: 0,
      keywordCoverage: 0,
      score: 0,
      signals: [
        { key: "lead", label: "도입부", status: "fail" },
        { key: "highlights", label: "핵심 포인트", status: "fail" },
        { key: "sections", label: "본문 구조", status: "fail" },
      ],
    });
  }

  const lead = normalizeText(parsed.lead);
  const highlights = (parsed.highlights || []).map((value) => normalizeText(value)).filter(Boolean);
  const sections = parsed.sections || [];
  const keywordReport = buildKeywordCoverage(input, parsed);
  const normalizedHeadings = sections.map((section) => normalizeText(section.heading)).filter(Boolean);
  const genericHeadingCount = normalizedHeadings.filter((heading) =>
    GENERIC_HEADING_PATTERNS.some((pattern) => pattern.test(heading)),
  ).length;
  const duplicateHeadingCount = countDuplicateValues(normalizedHeadings);
  const duplicateBodyOpeningCount = countDuplicateValues(
    sections.map((section) => getBodyOpening(section.body)).filter(Boolean),
  );
  const averageBodyLength =
    sections.length > 0
      ? Math.round(
          sections.reduce((total, section) => total + normalizeText(section.body).length, 0) / sections.length,
        )
      : 0;
  const mobileCadenceOk = averageBodyLength > 0 && averageBodyLength <= 260;
  const quality = assessNaverRubric(input, parsed, keywordReport.coverage);

  if (quality.blockers.length > 0) {
    const blocker = quality.blockers[0];
    return buildReadinessBase({
      code: blocker.code as "unsupported-factual-claim" | "missing-affiliate-disclosure" | "broken-critical-media",
      reason: blocker.reason,
      needsPrepare: true,
      sectionCount: sections.length,
      highlightCount: highlights.length,
      keywordCoverage: keywordReport.coverage,
      coveredKeywords: keywordReport.coveredKeywords,
      missingKeywords: keywordReport.missingKeywords,
      score: quality.score,
      signals: quality.rubric.map((item) => ({ key: item.key, label: item.label, status: item.score === item.maxScore ? "pass" : item.score === 0 ? "fail" : "warn" })),
      rubric: quality.rubric,
      p0Blockers: quality.blockers,
      repair: quality.repair,
    });
  }

  if (!lead) {
    return buildReadinessBase({
      code: "missing-lead",
      reason: "준비본 도입부가 비어 있습니다. lead가 포함되도록 다시 prepare 해주세요.",
      needsPrepare: true,
      sectionCount: sections.length,
      highlightCount: highlights.length,
      keywordCoverage: keywordReport.coverage,
      coveredKeywords: keywordReport.coveredKeywords,
      missingKeywords: keywordReport.missingKeywords,
      score: 18,
      signals: [
        { key: "lead", label: "도입부", status: "fail" },
        { key: "highlights", label: "핵심 포인트", status: highlights.length >= 2 ? "pass" : "warn" },
        { key: "sections", label: "본문 구조", status: sections.length >= 3 ? "pass" : "warn" },
      ],
    });
  }

  if (highlights.length < 2) {
    return buildReadinessBase({
      code: "missing-highlights",
      reason: "준비본 핵심 하이라이트가 부족합니다. highlights를 보강해 다시 prepare 해주세요.",
      needsPrepare: true,
      sectionCount: sections.length,
      highlightCount: highlights.length,
      keywordCoverage: keywordReport.coverage,
      coveredKeywords: keywordReport.coveredKeywords,
      missingKeywords: keywordReport.missingKeywords,
      score: 32,
      signals: [
        { key: "lead", label: "도입부", status: "pass" },
        { key: "highlights", label: "핵심 포인트", status: "fail" },
        { key: "sections", label: "본문 구조", status: sections.length >= 3 ? "pass" : "warn" },
      ],
    });
  }

  if (sections.length < 3) {
    return buildReadinessBase({
      code: "too-few-sections",
      reason: "준비본 본문 섹션 수가 부족합니다. 최소 3개 이상 섹션으로 다시 prepare 해주세요.",
      needsPrepare: true,
      sectionCount: sections.length,
      highlightCount: highlights.length,
      keywordCoverage: keywordReport.coverage,
      coveredKeywords: keywordReport.coveredKeywords,
      missingKeywords: keywordReport.missingKeywords,
      score: 40,
      signals: [
        { key: "lead", label: "도입부", status: "pass" },
        { key: "highlights", label: "핵심 포인트", status: "pass" },
        { key: "sections", label: "본문 구조", status: "fail" },
      ],
    });
  }

  const weakKeywordCoverage =
    keywordReport.targetKeywords.length > 0 &&
    (keywordReport.coverage < 0.5 ||
      (keywordReport.targetKeywords.length === 1 && keywordReport.coveredKeywords.length === 0));

  if (weakKeywordCoverage) {
    return buildReadinessBase({
      code: "weak-keyword-coverage",
      reason: `타깃 키워드 반영이 부족합니다. 누락: ${keywordReport.missingKeywords.slice(0, 4).join(", ")}`,
      needsPrepare: true,
      sectionCount: sections.length,
      highlightCount: highlights.length,
      keywordCoverage: keywordReport.coverage,
      coveredKeywords: keywordReport.coveredKeywords,
      missingKeywords: keywordReport.missingKeywords,
      score: 46,
      signals: [
        { key: "lead", label: "도입부", status: "pass" },
        { key: "highlights", label: "핵심 포인트", status: "pass" },
        { key: "sections", label: "본문 구조", status: "pass" },
        { key: "seo", label: "키워드 반영", status: "fail" },
      ],
    });
  }

  const writingTopic = isWritingFocusedTopic(input);
  if (!writingTopic) {
    const metaCorpus = [
      parsed.title,
      lead,
      ...highlights,
      parsed.meta?.summary,
      ...sections.flatMap((section) => [section.heading, section.summary, section.body]),
    ]
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .join("\n");

    const strongMetaHits = countPatternHits(metaCorpus, STRONG_META_WRITING_PATTERNS);
    const metaHits = countPatternHits(metaCorpus, META_WRITING_PATTERNS);

    if (strongMetaHits > 0 || metaHits >= 2) {
      return buildReadinessBase({
        code: "meta-writing-contamination",
        reason: "준비본에 글쓰기 메타 문구가 섞여 있습니다. 독자용 본문으로 다시 prepare 해주세요.",
        needsPrepare: true,
        sectionCount: sections.length,
        highlightCount: highlights.length,
        keywordCoverage: keywordReport.coverage,
        coveredKeywords: keywordReport.coveredKeywords,
        missingKeywords: keywordReport.missingKeywords,
        score: 45,
        signals: [
          { key: "lead", label: "도입부", status: "pass" },
          { key: "highlights", label: "핵심 포인트", status: "pass" },
          { key: "meta", label: "메타 오염", status: "fail" },
          { key: "mobile", label: "모바일 호흡", status: mobileCadenceOk ? "pass" : "warn" },
        ],
      });
    }
  }

  const brokenCopyDetected = sections.some((section) => {
    const body = normalizeText(section.body);
    if (!body) return true;
    if (countPatternHits(body, BROKEN_COPY_PATTERNS) > 0) return true;
    if (!writingTopic && containsNonWritingMetaBody(body)) return true;
    const topic = normalizeText(input.topic);
    return topic.length >= 12 && countNormalizedOccurrences(body, topic) >= 1;
  });

  if (brokenCopyDetected) {
    return buildReadinessBase({
      code: "broken-copy",
      reason: "준비본 본문에 어색하거나 기계적인 문장이 섞여 있습니다. 본문을 다시 prepare 해주세요.",
      needsPrepare: true,
      sectionCount: sections.length,
      highlightCount: highlights.length,
      keywordCoverage: keywordReport.coverage,
      coveredKeywords: keywordReport.coveredKeywords,
      missingKeywords: keywordReport.missingKeywords,
      score: 52,
      signals: [
        { key: "lead", label: "도입부", status: "pass" },
        { key: "highlights", label: "핵심 포인트", status: "pass" },
        { key: "copy", label: "본문 자연스러움", status: "fail" },
        { key: "mobile", label: "모바일 호흡", status: mobileCadenceOk ? "pass" : "warn" },
      ],
    });
  }

  if (
    genericHeadingCount >= Math.max(3, sections.length - 1) ||
    duplicateHeadingCount >= Math.max(1, Math.floor(sections.length / 2)) ||
    duplicateBodyOpeningCount >= Math.max(2, sections.length - 2)
  ) {
    return buildReadinessBase({
      code: "repeated-structure",
      reason: "준비본 섹션 구조가 지나치게 반복적입니다. 소제목과 본문을 다시 prepare 해주세요.",
      needsPrepare: true,
      sectionCount: sections.length,
      highlightCount: highlights.length,
      keywordCoverage: keywordReport.coverage,
      coveredKeywords: keywordReport.coveredKeywords,
      missingKeywords: keywordReport.missingKeywords,
      score: 58,
      signals: [
        { key: "lead", label: "도입부", status: "pass" },
        { key: "highlights", label: "핵심 포인트", status: "pass" },
        { key: "sections", label: "본문 구조", status: "fail" },
        { key: "mobile", label: "모바일 호흡", status: mobileCadenceOk ? "pass" : "warn" },
      ],
    });
  }

  const score = quality.score;

  if (score < 80) {
    return buildReadinessBase({
      code: "quality-score-below-threshold",
      reason: `네이버 콘텐츠 품질 점수가 ${score}점으로 검토 기준(80점)에 미달합니다.`,
      needsPrepare: true,
      sectionCount: sections.length,
      highlightCount: highlights.length,
      keywordCoverage: keywordReport.coverage,
      coveredKeywords: keywordReport.coveredKeywords,
      missingKeywords: keywordReport.missingKeywords,
      score,
      signals: quality.rubric.map((item) => ({ key: item.key, label: item.label, status: item.score === item.maxScore ? "pass" : item.score / item.maxScore < 0.6 ? "fail" : "warn" })),
      rubric: quality.rubric,
      repair: quality.repair,
    });
  }

  if (score < 90) {
    return buildReadinessBase({
      code: "manual-review-required",
      reason: `네이버 콘텐츠 품질 점수가 ${score}점입니다. 90점 미만 콘텐츠는 자동 발행하지 않고 수동 검토가 필요합니다.`,
      needsPrepare: false,
      sectionCount: sections.length,
      highlightCount: highlights.length,
      keywordCoverage: keywordReport.coverage,
      coveredKeywords: keywordReport.coveredKeywords,
      missingKeywords: keywordReport.missingKeywords,
      score,
      signals: quality.rubric.map((item) => ({
        key: item.key,
        label: item.label,
        status: item.score === item.maxScore ? "pass" : item.score / item.maxScore < 0.6 ? "fail" : "warn",
      })),
      rubric: quality.rubric,
      repair: quality.repair,
    });
  }

  return buildReadinessBase({
    code: "ok",
    reason: null,
    needsPrepare: false,
    sectionCount: sections.length,
    highlightCount: highlights.length,
    keywordCoverage: keywordReport.coverage,
    coveredKeywords: keywordReport.coveredKeywords,
    missingKeywords: keywordReport.missingKeywords,
    score,
    rubric: quality.rubric,
    repair: quality.repair,
    signals: [
      { key: "lead", label: "도입부", status: "pass" },
      { key: "highlights", label: "핵심 포인트", status: "pass" },
      { key: "sections", label: "본문 구조", status: sections.length === 4 ? "pass" : "warn" },
      {
        key: "seo",
        label: "키워드 반영",
        status:
          keywordReport.targetKeywords.length === 0 || keywordReport.coverage >= 0.75
            ? "pass"
            : "warn",
      },
      { key: "mobile", label: "모바일 호흡", status: mobileCadenceOk ? "pass" : "warn" },
      { key: "meta", label: "메타 오염", status: "pass" },
    ],
  });
}
