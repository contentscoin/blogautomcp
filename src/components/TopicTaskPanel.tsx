"use client";

import { parsePreparedTopicContent, parseTopicVisualPlan } from "@/lib/topic-task-contract";
import { getTopicTaskContentReadiness } from "@/lib/topic-task-content-readiness";
import { getTopicTaskPublishReadiness } from "@/lib/topic-task-publish-readiness";

interface TopicTaskPanelTask {
  id: string;
  topic: string;
  keywords: string | null;
  type: string | null;
  topicCraftCategory: string | null;
  narrativeAngleBriefsJson?: string | null;
  contentReadinessReportJson?: string | null;
  contentReadinessScore?: number | null;
  contentReadinessPublishable?: boolean | null;
  selectedDraftId: string | null;
  pipelineStage: string;
  preparedTitle: string | null;
  preparedContentJson: string | null;
  imagePlanJson: string | null;
  preparedImages?: Array<{
    sourceUrl: string;
    localPath: string | null;
    creditName: string | null;
    creditUrl: string | null;
    role: string;
    query: string | null;
    provider: string | null;
    createdAt: string;
  }>;
  status: string;
  scheduledPublishAt: string | null;
  postUrl: string | null;
  errorMessage: string | null;
  memo: string | null;
  categoryNo: string | null;
}

interface TopicTaskPanelCategoryOption {
  categoryNo: string;
  displayName: string;
}

interface TopicTaskPanelProps<TTask extends TopicTaskPanelTask> {
  addingTopic: boolean;
  categoryLoading: boolean;
  categoryOptions: TopicTaskPanelCategoryOption[];
  defaultCategoryNo: string | null;
  getCategoryLabel: (categoryNo: string | null) => string;
  newTopic: string;
  newTopicCategoryNo: string;
  newTopicCraftCategory: string;
  newTopicKeywords: string;
  newTopicMemo: string;
  newTopicScheduledDate: string;
  newTopicType: string;
  onAddTopicTask: () => void;
  onDeleteTopicTask: (id: string) => void;
  onBulkSchedulePublish: () => void | Promise<void>;
  onPrepareTopicTask: (id: string) => void;
  onTopicPublish: (id: string) => void;
  onTopicSchedulePublish: (task: TTask) => void | Promise<void>;
  onUpdateTopicTask: (
    id: string,
    updates: {
      categoryNo?: string | null;
      scheduledPublishAt?: string | null;
    },
  ) => void;
  setNewTopic: (value: string) => void;
  setNewTopicCategoryNo: (value: string) => void;
  setNewTopicCraftCategory: (value: string) => void;
  setNewTopicKeywords: (value: string) => void;
  setNewTopicMemo: (value: string) => void;
  setNewTopicScheduledDate: (value: string) => void;
  setNewTopicType: (value: string) => void;
  tasks: TTask[];
  readyScheduledTopicCount: number;
  topicBulkScheduleRunning: boolean;
  topicLoading: boolean;
  topicPreparingId: string | null;
  topicPublishingId: string | null;
}

const TOPIC_CRAFT_CATEGORIES = [
  "기술 / IT",
  "비즈니스 / 경제",
  "라이프스타일",
  "디자인 / 크리에이티브",
  "마케팅 / 트렌드",
  "음식 / 요리",
  "여행 / 문화",
  "건강 / 운동",
  "교육 / 자기계발",
  "AI / 미래기술",
] as const;

const TITLE_WARNING_PATTERNS = [
  /체크리스트/i,
  /실전\s*정리/i,
  /적용\s*판단\s*프레임/i,
  /문제해결/i,
  /운영\s*방식/i,
] as const;

const BODY_WARNING_PATTERNS = [
  /요청 맥락 기반 확장/i,
  /실제 글 발행에 바로 쓸 수 있는 구조/i,
  /품질이 안정적입니다/i,
  /핵심 내용입니다/i,
  /바로 실행할 수 있게/i,
] as const;

const HEADING_WARNING_PATTERNS = [/^핵심 정리$/i, /^실전 포인트$/i, /^마무리$/i, /^포인트 \d+$/i] as const;
const PROVIDER_ORDER = ["source", "pexels", "unsplash", "daedal", "stock-generic", "ai", "unresolved", "unknown"] as const;
const ROLE_ORDER = ["hero", "inline"] as const;

type SignalTone = "neutral" | "info" | "success" | "warning" | "danger";

interface TaskSignalBadge {
  label: string;
  tone: SignalTone;
  title?: string;
}

interface TaskReadinessSummary {
  score: number;
  scoreTone: SignalTone;
  statusLabel: string;
  statusTone: SignalTone;
  detail: string;
}

interface NarrativePlanSummary {
  primary: string;
  secondary: string | null;
  beats: string[];
}

type UnknownRecord = Record<string, unknown>;

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function countPatternHits(value: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function truncateText(value: string, maxLength = 96): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

function parseUnknownJson(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function firstNonEmptyText(values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeText(typeof value === "string" ? value : null);
    if (normalized) return normalized;
  }
  return "";
}

function extractPlanStepLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => item !== null)
    .map((item) =>
      firstNonEmptyText([
        item.subtitle,
        item.heading,
        item.sectionTitle,
        item.title,
        item.summary,
        item.readerPromise,
      ]),
    )
    .filter(Boolean);
}

function getSignalBadgeColor(tone: SignalTone): string {
  switch (tone) {
    case "info":
      return "bg-sky-100 text-sky-800";
    case "success":
      return "bg-emerald-100 text-emerald-800";
    case "warning":
      return "bg-amber-100 text-amber-800";
    case "danger":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function getCompactReadinessSummary(
  task: TopicTaskPanelTask,
  contentReadiness: ReturnType<typeof getTopicTaskContentReadiness>,
  publishReadiness: ReturnType<typeof getTopicTaskPublishReadiness>,
): TaskReadinessSummary {
  const prepared = parsePreparedTopicContent(task.preparedContentJson);
  const persistedReport = asRecord(parseUnknownJson(task.contentReadinessReportJson));
  const persistedScore =
    typeof task.contentReadinessScore === "number"
      ? clampScore(task.contentReadinessScore)
      : typeof persistedReport?.score === "number"
        ? clampScore(persistedReport.score)
        : null;
  const persistedPublishable =
    typeof task.contentReadinessPublishable === "boolean"
      ? task.contentReadinessPublishable
      : typeof persistedReport?.canPublish === "boolean"
        ? Boolean(persistedReport.canPublish)
        : null;
  const lead = normalizeText(prepared?.lead);
  const highlights = prepared?.highlights ?? [];
  const sections = prepared?.sections ?? [];

  let score = 0;
  if (prepared) score += 15;
  if (lead) score += 10;
  score += highlights.length >= 2 ? 15 : Math.min(10, highlights.length * 5);
  score += sections.length >= 3 ? 20 : sections.length * 6;
  score += contentReadiness.canPublish ? 15 : prepared ? 5 : 0;
  score += publishReadiness.resolvedImageCount > 0 ? 10 : 0;
  score += publishReadiness.hasHero ? 10 : 0;
  score +=
    publishReadiness.resolvedImageCount > 0 &&
    !publishReadiness.heroIsGeneric &&
    !publishReadiness.allImagesAreGeneric
      ? 5
      : 0;

  const finalScore = persistedScore ?? clampScore(score);
  const publishable = (persistedPublishable ?? contentReadiness.canPublish) && publishReadiness.canPublish;
  const statusLabel = publishable
    ? "발행 가능"
    : prepared
      ? "보강 필요"
      : task.status === "PUBLISHING"
        ? "발행 중"
        : "준비 필요";
  const statusTone: SignalTone = publishable ? "success" : prepared ? "warning" : "neutral";
  const scoreTone: SignalTone =
    finalScore >= 85 ? "success" : finalScore >= 60 ? "info" : finalScore >= 35 ? "warning" : "neutral";

  return {
    score: finalScore,
    scoreTone,
    statusLabel,
    statusTone,
    detail:
      normalizeText(
        typeof persistedReport?.summary === "string"
          ? persistedReport.summary
          : `본문 ${contentReadiness.sectionCount}섹션 · 하이라이트 ${contentReadiness.highlightCount}개 · 이미지 ${publishReadiness.resolvedImageCount}장${
              publishReadiness.hasHero ? " · hero" : ""
            }`,
      ) ||
      `본문 ${contentReadiness.sectionCount}섹션 · 하이라이트 ${contentReadiness.highlightCount}개 · 이미지 ${publishReadiness.resolvedImageCount}장`,
  };
}

function extractNarrativePlanSummary(task: TopicTaskPanelTask): NarrativePlanSummary | null {
  const taskRecord = task as unknown as UnknownRecord;
  const narrativeCandidates: unknown[] = [
    task.narrativeAngleBriefsJson,
    taskRecord.topicSeedJson,
    taskRecord.selectedDraftTopicSeedJson,
    asRecord(taskRecord.selectedDraft)?.topicSeedJson,
    taskRecord.angleBriefJson,
    taskRecord.selectedAngleBriefJson,
    taskRecord.narrativeBriefJson,
    taskRecord.narrativePlanJson,
    taskRecord.persistedAngleBriefJson,
    taskRecord.angleBrief,
    taskRecord.selectedAngleBrief,
    taskRecord.narrativeBrief,
    taskRecord.narrativePlan,
    taskRecord.angleBriefs,
    taskRecord.narrativeBriefs,
  ];

  const readNarrativeRecord = (value: unknown): UnknownRecord | null => {
    const parsed = parseUnknownJson(value);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const record = readNarrativeRecord(item);
        if (record) return record;
      }
      return null;
    }

    const record = asRecord(parsed);
    if (!record) return null;

    if (Array.isArray(record.briefs)) {
      const nested = readNarrativeRecord(record.briefs);
      if (nested) return nested;
    }
    if (record.data) {
      const nested = readNarrativeRecord(record.data);
      if (nested) return nested;
    }

    const primary = firstNonEmptyText([record.headline, record.title, record.thesis, record.selectionReason]);
    const secondary = firstNonEmptyText([record.readerPromise, record.summary, record.reason]);
    const beats = extractPlanStepLabels(record.sectionPlan ?? record.subtopics);

    return primary || secondary || beats.length > 0 ? record : null;
  };

  for (const candidate of narrativeCandidates) {
    const record = readNarrativeRecord(candidate);
    if (record) {
      const primary = truncateText(
        firstNonEmptyText([record.headline, record.title, record.thesis, record.selectionReason]),
        88,
      );
      const secondary = truncateText(
        firstNonEmptyText([record.readerPromise, record.summary, record.reason]),
        96,
      );
      const beats = extractPlanStepLabels(record.sectionPlan ?? record.subtopics)
        .slice(0, 3)
        .map((step) => truncateText(step, 32));

      if (primary || secondary || beats.length > 0) {
        return {
          primary: primary || secondary || "서사 플랜 준비됨",
          secondary: secondary && secondary !== primary ? secondary : null,
          beats,
        };
      }
    }
  }

  const prepared = parsePreparedTopicContent(task.preparedContentJson);
  if (!prepared) return null;

  const primary = truncateText(
    firstNonEmptyText([
      prepared.meta?.selectedReason,
      prepared.meta?.summary,
      prepared.highlights?.[0],
      prepared.lead,
    ]),
    96,
  );
  const beats = prepared.sections
    .map((section) => truncateText(section.heading, 32))
    .filter(Boolean)
    .slice(0, 3);

  if (!primary && beats.length === 0) return null;

  return {
    primary: primary || "준비본 흐름 정리됨",
    secondary: null,
    beats,
  };
}

function normalizeProvider(provider: string | null | undefined): string {
  const normalized = normalizeText(provider).toLowerCase();
  switch (normalized) {
    case "source":
      return "source";
    case "pexels":
      return "pexels";
    case "unsplash":
      return "unsplash";
    case "stock":
      return "stock-generic";
    case "loremflickr":
    case "picsum":
    case "dummyimage":
      return "stock-generic";
    case "daedal":
      return "daedal";
    case "topic-craft-ai":
      return "ai";
    case "unresolved":
      return "unresolved";
    default:
      return normalized || "unknown";
  }
}

function getProviderLabel(provider: string): string {
  switch (provider) {
    case "source":
      return "source";
    case "pexels":
      return "pexels";
    case "unsplash":
      return "unsplash";
    case "daedal":
      return "daedal";
    case "stock-generic":
      return "generic";
    case "ai":
      return "ai";
    case "unresolved":
      return "미해결";
    default:
      return provider;
  }
}

function getRoleLabel(role: string): string {
  switch (role) {
    case "hero":
      return "hero";
    case "inline":
      return "inline";
    default:
      return role;
  }
}

function formatDateInputLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "READY":
      return "bg-blue-100 text-blue-800";
    case "RESEARCHING":
      return "bg-sky-100 text-sky-800";
    case "CANDIDATES_READY":
      return "bg-violet-100 text-violet-800";
    case "SELECTED":
      return "bg-fuchsia-100 text-fuchsia-800";
    case "POLISHING":
      return "bg-purple-100 text-purple-800";
    case "IMAGE_READY":
      return "bg-amber-100 text-amber-800";
    case "PREPARED":
      return "bg-emerald-100 text-emerald-800";
    case "PUBLISHING":
      return "bg-yellow-100 text-yellow-800";
    case "SCHEDULED":
      return "bg-indigo-100 text-indigo-800";
    case "PUBLISHED":
      return "bg-green-100 text-green-800";
    case "FAILED":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function getStatusText(status: string): string {
  switch (status) {
    case "READY":
      return "대기";
    case "RESEARCHING":
      return "리서치";
    case "CANDIDATES_READY":
      return "후보 확보";
    case "SELECTED":
      return "후보 선택";
    case "POLISHING":
      return "윤문중";
    case "IMAGE_READY":
      return "이미지 확보";
    case "PREPARED":
      return "준비완료";
    case "PUBLISHING":
      return "발행중";
    case "SCHEDULED":
      return "예약완료";
    case "PUBLISHED":
      return "발행완료";
    case "FAILED":
      return "실패";
    default:
      return status;
  }
}

function isTaskPrepared(task: TopicTaskPanelTask): boolean {
  return Boolean(task.selectedDraftId && task.preparedContentJson);
}

function isTaskPreparingStage(task: TopicTaskPanelTask): boolean {
  return [
    "RESEARCHING",
    "CANDIDATES_READY",
    "SELECTED",
    "POLISHING",
    "IMAGE_READY",
  ].includes(task.pipelineStage);
}

function getTaskPreparedPreview(task: TopicTaskPanelTask) {
  const parsed = parsePreparedTopicContent(task.preparedContentJson);
  if (!parsed) return null;
  return {
    title: parsed.title,
    sections: parsed.sections,
    hashtags: parsed.hashtags,
  };
}

function summarizePreparedContent(task: TopicTaskPanelTask): {
  title: string;
  titleTone: SignalTone;
  metricBadges: TaskSignalBadge[];
  warningBadges: TaskSignalBadge[];
} | null {
  const preview = getTaskPreparedPreview(task);
  const title = normalizeText(task.preparedTitle || preview?.title);

  if (!preview && !title) return null;

  const sections = preview?.sections ?? [];
  const hashtags = preview?.hashtags ?? [];
  const normalizedTopic = normalizeText(task.topic).toLowerCase();
  const normalizedTitle = title.toLowerCase();
  const titleLooksRepeated = Boolean(normalizedTitle && normalizedTitle === normalizedTopic);
  const titlePatternHits = countPatternHits(title, TITLE_WARNING_PATTERNS);
  const genericHeadingCount = sections.filter((section) =>
    HEADING_WARNING_PATTERNS.some((pattern) => pattern.test(section.heading)),
  ).length;
  const bodyPatternHits = sections.reduce(
    (count, section) => count + countPatternHits(section.body, BODY_WARNING_PATTERNS),
    0,
  );

  let titleBadge: TaskSignalBadge = { label: "제목 양호", tone: "success" };
  if (!title) {
    titleBadge = { label: "제목 없음", tone: "danger" };
  } else if (titleLooksRepeated || titlePatternHits > 0 || title.length > 52) {
    titleBadge = { label: "제목 주의", tone: "warning" };
  } else if (sections.length < 3 || title.length > 44) {
    titleBadge = { label: "제목 보통", tone: "neutral" };
  }

  const warningBadges: TaskSignalBadge[] = [];
  const fallbackSignals = [
    titleLooksRepeated || titlePatternHits > 0,
    sections.length >= 2 && genericHeadingCount >= Math.max(2, Math.ceil(sections.length / 2)),
    bodyPatternHits >= 2,
  ].filter(Boolean).length;

  if (sections.length === 0 && preview) {
    warningBadges.push({ label: "본문 비어 있음", tone: "danger" });
  }
  if (fallbackSignals >= 2) {
    warningBadges.push({
      label: "폴백 문안 의심",
      tone: "warning",
      title: "제목/섹션/본문 패턴이 반복적이라 재윤문 검토가 필요합니다.",
    });
  }

  return {
    title,
    titleTone: titleBadge.tone,
    metricBadges: [
      titleBadge,
      { label: `섹션 ${sections.length}`, tone: sections.length >= 3 ? "info" : "warning" },
      ...(hashtags.length > 0 ? [{ label: `태그 ${hashtags.length}`, tone: "neutral" as const }] : []),
    ],
    warningBadges,
  };
}

function summarizePreparedImages(task: TopicTaskPanelTask): {
  metricBadges: TaskSignalBadge[];
  warningBadges: TaskSignalBadge[];
} | null {
  const imagePlan = parseTopicVisualPlan(task.imagePlanJson);
  const images = task.preparedImages || [];
  if (!imagePlan && images.length === 0 && !task.preparedContentJson) return null;

  const providerCounts = images.reduce<Record<string, number>>((acc, image) => {
    const key = normalizeProvider(image.provider);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const roleCounts = images.reduce<Record<string, number>>((acc, image) => {
    const key = normalizeText(image.role).toLowerCase() || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const expectedCount = (imagePlan?.hero ? 1 : 0) + (imagePlan?.inline.length ?? 0);
  const unresolvedCount = providerCounts.unresolved || 0;
  const genericCount = providerCounts["stock-generic"] || 0;
  const plannedItems = [imagePlan?.hero, ...(imagePlan?.inline ?? [])].filter(Boolean);
  const plannedStrategyCounts = plannedItems.reduce<Record<string, number>>((acc, item) => {
    const key = normalizeText(item?.strategy).toLowerCase() || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const plannedIntentCounts = plannedItems.reduce<Record<string, number>>((acc, item) => {
    const key = normalizeText(item?.visualIntent).toLowerCase() || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const metricBadges: TaskSignalBadge[] = [];
  if (expectedCount > 0) {
    metricBadges.push({
      label: `이미지 ${images.length}/${expectedCount}`,
      tone: images.length >= expectedCount ? "info" : "warning",
      title: "준비된 이미지 수 / 계획된 이미지 수",
    });
  } else if (images.length > 0) {
    metricBadges.push({ label: `이미지 ${images.length}`, tone: "info" });
  }

  ROLE_ORDER.filter((role) => roleCounts[role]).forEach((role) => {
    metricBadges.push({ label: `${getRoleLabel(role)} ${roleCounts[role]}`, tone: "neutral" });
  });
  PROVIDER_ORDER.filter((provider) => providerCounts[provider]).forEach((provider) => {
    metricBadges.push({
      label: `${getProviderLabel(provider)} ${providerCounts[provider]}`,
      tone: provider === "unresolved" || provider === "stock-generic" ? "warning" : "neutral",
    });
  });
  ["source", "stock", "generate"].forEach((strategy) => {
    if (plannedStrategyCounts[strategy]) {
      metricBadges.push({
        label: `전략 ${strategy} ${plannedStrategyCounts[strategy]}`,
        tone: strategy === "generate" ? "info" : "neutral",
      });
    }
  });
  ["real-scene", "editorial", "comparison", "concept", "ui-screenshot"].forEach((intent) => {
    if (plannedIntentCounts[intent]) {
      metricBadges.push({
        label: `의도 ${intent} ${plannedIntentCounts[intent]}`,
        tone: "neutral",
      });
    }
  });

  const warningBadges: TaskSignalBadge[] = [];
  if (!imagePlan && task.preparedContentJson) {
    warningBadges.push({ label: "이미지 플랜 없음", tone: "warning" });
  }
  if (imagePlan && expectedCount > 0 && images.length === 0) {
    warningBadges.push({ label: "이미지 미준비", tone: "warning" });
  }
  if (unresolvedCount > 0) {
    warningBadges.push({
      label: `이미지 미해결 ${unresolvedCount}`,
      tone: "danger",
      title: "이미지 계획은 있었지만 소스/스톡/AI 생성까지 완료되지 않았습니다.",
    });
  }
  if (genericCount > 0) {
    warningBadges.push({
      label: `generic 사용 ${genericCount}`,
      tone: "warning",
      title: "LoremFlickr/Picsum/DummyImage 같은 임시 fallback 이미지가 포함되어 있어 발행 전 교체가 필요할 수 있습니다.",
    });
  }
  if (plannedStrategyCounts.generate && plannedItems.length > 0 && plannedStrategyCounts.generate === plannedItems.length) {
    warningBadges.push({
      label: "전부 생성 의존",
      tone: "warning",
      title: "이번 준비본은 모든 이미지 슬롯이 generated 전략으로 계획되어 있습니다. source/stock 보강이 있으면 글과 더 잘 어울립니다.",
    });
  }

  return {
    metricBadges,
    warningBadges,
  };
}

export default function TopicTaskPanel<TTask extends TopicTaskPanelTask>({
  addingTopic,
  categoryLoading,
  categoryOptions,
  defaultCategoryNo,
  getCategoryLabel,
  newTopic,
  newTopicCategoryNo,
  newTopicCraftCategory,
  newTopicKeywords,
  newTopicMemo,
  newTopicScheduledDate,
  newTopicType,
  onAddTopicTask,
  onDeleteTopicTask,
  onBulkSchedulePublish,
  onPrepareTopicTask,
  onTopicPublish,
  onTopicSchedulePublish,
  onUpdateTopicTask,
  setNewTopic,
  setNewTopicCategoryNo,
  setNewTopicCraftCategory,
  setNewTopicKeywords,
  setNewTopicMemo,
  setNewTopicScheduledDate,
  setNewTopicType,
  tasks,
  readyScheduledTopicCount,
  topicBulkScheduleRunning,
  topicLoading,
  topicPreparingId,
  topicPublishingId,
}: TopicTaskPanelProps<TTask>) {
  return (
    <>
      <div className="space-y-4 border-t pt-4 mt-4">
        <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-900">
          현재 운영 경로는 task 기반 prepare/publish 파이프라인입니다. 레거시 캠페인 플로우는
          화면에서 숨기고 호환용 API로만 유지합니다.
        </div>

        <h2 className="font-semibold text-slate-800">➕ 주제 포스팅 추가</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              placeholder="주제 (예: 2026년 제주도 여행 코스 추천)"
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <input
              type="text"
              value={newTopicKeywords}
              onChange={(e) => setNewTopicKeywords(e.target.value)}
              placeholder="키워드 (쉼표 구분)"
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <select
              value={newTopicType}
              onChange={(e) => setNewTopicType(e.target.value)}
              className="w-32 px-4 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="정보성">정보성</option>
              <option value="여행">여행</option>
              <option value="골프">골프</option>
            </select>
            <select
              value={newTopicCraftCategory}
              onChange={(e) => setNewTopicCraftCategory(e.target.value)}
              className="w-44 px-4 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {TOPIC_CRAFT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newTopicMemo}
              onChange={(e) => setNewTopicMemo(e.target.value)}
              placeholder="메모 (선택)"
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            {categoryOptions.length > 0 || categoryLoading ? (
              <select
                value={newTopicCategoryNo}
                onChange={(e) => setNewTopicCategoryNo(e.target.value)}
                className="w-48 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                disabled={categoryLoading || categoryOptions.length === 0}
              >
                {categoryLoading && categoryOptions.length === 0 ? (
                  <option value="">로딩 중...</option>
                ) : (
                  <>
                    <option value="">
                      {defaultCategoryNo
                        ? `기본 게시판 (${getCategoryLabel(defaultCategoryNo)})`
                        : "기본 게시판"}
                    </option>
                    {categoryOptions.map((category) => (
                      <option key={category.categoryNo} value={category.categoryNo}>
                        {category.displayName}
                      </option>
                    ))}
                  </>
                )}
              </select>
            ) : (
              <input
                type="text"
                value={newTopicCategoryNo}
                onChange={(e) => setNewTopicCategoryNo(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="게시판 번호"
                className="w-48 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            )}
            <input
              type="date"
              value={newTopicScheduledDate}
              onChange={(e) => setNewTopicScheduledDate(e.target.value)}
              className="w-40 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              title="예약 발행일 (선택)"
            />
            <button
              onClick={onAddTopicTask}
              disabled={addingTopic}
              className="px-6 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {addingTopic ? "추가 중..." : "추가"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">주제글 작성 목록</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              예약일이 있는 준비완료 글을 최대 10개씩 예약 포스팅합니다.
            </p>
          </div>
          <button
            onClick={() => onBulkSchedulePublish()}
            disabled={topicBulkScheduleRunning || readyScheduledTopicCount === 0}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {topicBulkScheduleRunning
              ? "예약배포 실행 중..."
              : `예약배포 일괄 실행 (${Math.min(10, readyScheduledTopicCount)}건)`}
          </button>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">주제</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">상태</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">유형/키워드/메모</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">게시판/예약일</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {topicLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  로딩 중...
                </td>
              </tr>
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  등록된 주제 태스크가 없습니다.
                </td>
              </tr>
            ) : (
              tasks.map((task) => {
                const prepared = isTaskPrepared(task);
                const preparedSummary = summarizePreparedContent(task);
                const imageSummary = summarizePreparedImages(task);
                const publishReadiness = getTopicTaskPublishReadiness({
                  status: task.status,
                  selectedDraftId: task.selectedDraftId,
                  preparedContentJson: task.preparedContentJson,
                  preparedImages: task.preparedImages,
                });
                const contentReadiness = getTopicTaskContentReadiness({
                  topic: task.topic,
                  keywords: task.keywords,
                  type: task.type,
                  topicCraftCategory: task.topicCraftCategory,
                  preparedContentJson: task.preparedContentJson,
                });
                const isPreparingStage = isTaskPreparingStage(task);
                const isPreparing = topicPreparingId === task.id;
                const isPublishing = topicPublishingId === task.id;
                const readinessSummary = getCompactReadinessSummary(task, contentReadiness, publishReadiness);
                const narrativePlanSummary = extractNarrativePlanSummary(task);
                const blockingReason = contentReadiness.reason || publishReadiness.reason;
                const needsPrepare = publishReadiness.needsPrepare || contentReadiness.needsPrepare;
                const shouldShowPrepare =
                  !prepared ||
                  task.status === "READY" ||
                  (task.status === "FAILED" && !task.preparedContentJson) ||
                  (prepared && needsPrepare);
                const canShowPublishActions =
                  prepared &&
                  (task.status === "PREPARED" || task.status === "FAILED") &&
                  publishReadiness.canPublish &&
                  contentReadiness.canPublish;
                const prepareLabel =
                  prepared && !contentReadiness.canPublish
                    ? "내용 보강"
                    : prepared && publishReadiness.needsPrepare
                      ? "이미지 보강"
                      : task.status === "FAILED"
                        ? "재준비"
                        : "준비";
                const signalBadges: TaskSignalBadge[] = [
                  ...(prepared && !contentReadiness.canPublish && contentReadiness.reason
                    ? [{ label: "콘텐츠 게이트", tone: "danger" as const, title: contentReadiness.reason }]
                    : []),
                  ...(preparedSummary?.warningBadges ?? []),
                  ...(imageSummary?.warningBadges ?? []),
                  ...(preparedSummary?.metricBadges ?? []),
                  ...(imageSummary?.metricBadges ?? []),
                ];

                return (
                  <tr key={task.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{task.topic}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getSignalBadgeColor(
                            readinessSummary.scoreTone,
                          )}`}
                        >
                          준비도 {readinessSummary.score}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getSignalBadgeColor(
                            readinessSummary.statusTone,
                          )}`}
                        >
                          {readinessSummary.statusLabel}
                        </span>
                        <span className="text-[11px] text-slate-500">{readinessSummary.detail}</span>
                      </div>
                      {narrativePlanSummary && (
                        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
                          <div>
                            <span className="font-medium text-slate-700">서사 플랜:</span>{" "}
                            {narrativePlanSummary.primary}
                          </div>
                          {narrativePlanSummary.secondary && (
                            <div className="mt-1 text-slate-500">{narrativePlanSummary.secondary}</div>
                          )}
                          {narrativePlanSummary.beats.length > 0 && (
                            <div className="mt-1 text-slate-500">
                              흐름: {narrativePlanSummary.beats.join(" → ")}
                            </div>
                          )}
                        </div>
                      )}
                      {!isPreparingStage && preparedSummary?.title && (
                        <div
                          className={`mt-1 text-xs ${
                            preparedSummary.titleTone === "warning"
                              ? "text-amber-700"
                              : preparedSummary.titleTone === "danger"
                                ? "text-rose-700"
                                : "text-slate-500"
                          }`}
                        >
                          준비 제목: {preparedSummary.title}
                        </div>
                      )}
                      {!isPreparingStage && signalBadges.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {signalBadges.map((badge, index) => (
                            <span
                              key={`${badge.label}-${index}`}
                              title={badge.title}
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getSignalBadgeColor(
                                badge.tone,
                              )}`}
                            >
                              {badge.label}
                            </span>
                          ))}
                        </div>
                      )}
                      {isPreparingStage && task.preparedContentJson && (
                        <div className="mt-1 text-xs text-amber-600">
                          기존 준비본을 유지한 채 새 prepare를 실행 중입니다...
                        </div>
                      )}
                      {task.postUrl && (
                        <div className="mt-1">
                          <a
                            href={task.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-600 hover:underline text-xs"
                          >
                            📄 발행된 글 보기
                          </a>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(task.status)}`}>
                        {getStatusText(task.status)}
                      </span>
                      <div className="mt-1 text-[11px] text-slate-400">{task.pipelineStage}</div>
                      {task.errorMessage && (
                        <div className="text-xs text-red-500 mt-1" title={task.errorMessage}>
                          ⚠️
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-slate-500">
                      <div>{task.type}</div>
                      {task.topicCraftCategory && (
                        <div className="text-xs mt-1">카테고리: {task.topicCraftCategory}</div>
                      )}
                      {task.keywords && <div className="text-xs mt-1">[{task.keywords}]</div>}
                      {task.memo && <div className="text-xs mt-1">메모: {task.memo}</div>}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-slate-500">
                      <div className="flex flex-col gap-2 items-center">
                        <select
                          value={task.categoryNo || ""}
                          onChange={(e) => onUpdateTopicTask(task.id, { categoryNo: e.target.value })}
                          className="w-32 px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                        >
                          <option value="">기본 게시판</option>
                          {categoryOptions.map((cat) => (
                            <option key={cat.categoryNo} value={cat.categoryNo}>
                              {cat.displayName}
                            </option>
                          ))}
                        </select>
                        <input
                          type="date"
                          value={task.scheduledPublishAt ? formatDateInputLocal(new Date(task.scheduledPublishAt)) : ""}
                          onChange={(e) =>
                            onUpdateTopicTask(task.id, { scheduledPublishAt: e.target.value })
                          }
                          className="w-32 px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                          title="예약 발행일 변경"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {shouldShowPrepare && (
                          <button
                            onClick={() => onPrepareTopicTask(task.id)}
                            disabled={isPreparing || isPublishing}
                            className="px-3 py-1 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 transition-colors"
                            title={needsPrepare ? blockingReason || "재준비가 필요합니다." : undefined}
                          >
                            🧠 {prepareLabel}
                          </button>
                        )}
                        {canShowPublishActions && (
                          <>
                            <button
                              onClick={() => onTopicPublish(task.id)}
                              disabled={isPublishing || isPreparing}
                              className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                              🚀 {task.status === "FAILED" ? "재발행" : "즉시"}
                            </button>
                            <button
                              onClick={() => onTopicSchedulePublish(task)}
                              disabled={isPublishing || isPreparing}
                              className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                            >
                              📅 예약배포
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => onDeleteTopicTask(task.id)}
                          className="px-3 py-1 text-sm bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors"
                          title="삭제"
                        >
                          🗑️
                        </button>
                      </div>
                      {isPreparing && (
                        <div className="mt-2 text-xs text-slate-500">prepare 실행 중...</div>
                      )}
                      {isPublishing && (
                        <div className="mt-2 text-xs text-slate-500">발행 중...</div>
                      )}
                      {prepared && !canShowPublishActions && blockingReason && !isPreparing && (
                        <div className="mt-2 max-w-[220px] text-xs text-rose-600 text-left mx-auto">
                          {blockingReason}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
