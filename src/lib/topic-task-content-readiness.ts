import { parsePreparedTopicContent } from "@/lib/topic-task-contract";
import { scanAiTells } from "../../scripts/lib/humanize-korean";

const STRONG_META_WRITING_PATTERNS = [
  /요청 맥락 기반 확장/i,
  /실제 글 발행에 바로 쓸 수 있는 구조/i,
  /품질이 안정적입니다/i,
  /입력 키워드와 리서치 시그널을 바탕으로/i,
] as const;

const META_WRITING_PATTERNS = [
  ...STRONG_META_WRITING_PATTERNS,
  /핵심 내용입니다/i,
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
    | "repeated-structure";
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
  };
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
  let metaWritingDetected = false;
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
      metaWritingDetected = true;
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

  const structureScore = sections.length === 4 ? 25 : sections.length === 5 ? 20 : 16;
  const highlightScore = Math.min(20, highlights.length * 8);
  const cadenceScore = mobileCadenceOk ? 15 : averageBodyLength <= 320 ? 9 : 4;
  const headingScore = genericHeadingCount === 0 && duplicateHeadingCount === 0 ? 15 : 8;
  const cleanlinessScore = metaWritingDetected ? 0 : 25;

  // AI 티(번역투·상투구·기계적 구조 등) 스캔 — 발행은 막지 않고(비차단) 자연스러움을
  // 점수에 소폭 반영하고 신호로 노출한다. (참고: im-not-ai taxonomy)
  const aiTell = scanAiTells(sections.map((section) => section.body).join("\n"));
  const aiTellPenalty = Math.min(12, Math.floor(aiTell.score / 6));
  const aiTellStatus: "pass" | "warn" = aiTell.score >= 20 ? "warn" : "pass";

  const score = Math.max(
    0,
    Math.min(100, 25 + highlightScore + structureScore + cadenceScore + headingScore + cleanlinessScore - 25) -
      aiTellPenalty
  );

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
      { key: "aiTell", label: "AI 티(자연스러움)", status: aiTellStatus },
    ],
  });
}
