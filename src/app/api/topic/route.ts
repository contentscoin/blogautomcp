import { NextRequest, NextResponse } from "next/server";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { runTsNodeScript, ScriptExecutionError } from "@/lib/run-script";
import { executeScheduledPost } from "@/services/scheduler";
import {
  TopicCampaignStatus,
  TopicDraftStatus,
  TopicResearchPacket,
  TopicType,
  buildEmptyResearchPacket,
  buildResearchSignals,
  collectSourceSummaries,
  normalizeSubtopics,
  parseDateInput,
  parseKeywords,
  parseSourceJson,
  parseSourceUrls,
  parseTopicAgentOutput,
  planSubtopics,
} from "../../../lib/topic-workflow";

interface RawTopicRequest {
  action?: string;
  campaignId?: string;
  draftId?: string;
  draftIds?: string | string[];
  topic?: string;
  type?: TopicType;
  intent?: string;
  audience?: string;
  style?: string;
  keywords?: string;
  sourceUrls?: string | string[];
  category?: string;
  board?: string;
  count?: number;
  scheduleDate?: string;
  scheduledAt?: string;
  intervalDays?: number;
  intervalDaysPerDraft?: number;
  contentJson?: string;
}

type TopicApiAction =
  | "research"
  | "subtopics"
  | "draft"
  | "approve"
  | "queue"
  | "run-queue"
  | "publish-now"
  | "schedule"
  | "load";

interface ParsedTopicRequest {
  action: TopicApiAction;
  campaignId: string | null;
  draftId: string | null;
  draftIds: string[];
  topic: string | null;
  type: TopicType;
  intent: string | null;
  audience: string | null;
  style: string | null;
  category: string | null;
  board: string | null;
  scheduleDate: string | null;
  count: number;
  keywords: string[];
  sourceUrls: string[];
  contentJson: Record<string, unknown> | null;
  intervalDays: number;
}

interface TopicCampaignPayload {
  id: string;
  rootTopic: string;
  type: TopicType;
  intent: string | null;
  audience: string | null;
  style: string | null;
  sourceUrls: string[];
  researchPackJson: string;
  status: TopicCampaignStatus;
  createdAt: string;
}

interface TopicDraftPayload {
  id: string;
  campaignId: string;
  subTopic: string;
  reason: string | null;
  priority: number;
  status: TopicDraftStatus;
  titleCandidates: string[];
  contentJson: string | null;
  citations: string | null;
  thumbnailImageJson: string | null;
  sourceImagesJson: string | null;
  topicSeedJson: string | null;
  scheduledAt: string | null;
  postId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface TopicCampaignListItem extends TopicCampaignPayload {
  draftCount: number;
}

interface TopicCampaignWithDrafts {
  campaign: TopicCampaignPayload;
  drafts: TopicDraftPayload[];
  research?: TopicResearchPacket;
}

interface TopicScriptResult {
  stdout: string;
  parsed: ReturnType<typeof parseTopicAgentOutput>;
  fallbackReason?: string;
}

type TopicPublishMode = "now" | "schedule";

const TOPIC_SCRIPT_TIMEOUT_MS = 600_000;
const TOPIC_DRAFT_GENERATION_CONCURRENCY = 2;
const TOPIC_SCRIPT_TIMEOUT_BY_WORKER_MS = {
  draft: TOPIC_SCRIPT_TIMEOUT_MS,
  default: TOPIC_SCRIPT_TIMEOUT_MS,
};

function formatDateYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

interface TopicQueueRunResult {
  campaignId: string;
  requestedCount: number;
  queuedCount: number;
  started: boolean;
  deferredCount: number;
  dueCount: number;
  nextRunAt: string | null;
}

interface TopicQueueRunItem {
  draftId: string;
  postId: string;
  success: boolean;
}

interface TopicQueueExecutionResult {
  requestedCount: number;
  dueCount: number;
  deferredCount: number;
  executed: TopicQueueRunItem[];
  allQueuedIds: string[];
  nextRunAt: string | null;
}

interface TopicApiResponse {
  success: boolean;
  error?: string;
  stderr?: string;
  data?: unknown;
}

const DEFAULT_SUBTOPIC_COUNT = 5;
const DEFAULT_QUEUE_INTERVAL_DAYS = 1;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "콘텐츠 생성에 실패했습니다";
}

function getErrorStderr(error: unknown): string | undefined {
  if (error instanceof ScriptExecutionError) {
    return error.stderr.slice(-1000) || undefined;
  }
  if (typeof error !== "object" || error === null || !("stderr" in error)) {
    return undefined;
  }
  const stderr = (error as { stderr?: unknown }).stderr;
  return typeof stderr === "string" ? stderr.slice(-1000) : undefined;
}

function getErrorStatus(error: unknown): number {
  if (error instanceof PrismaClientKnownRequestError && error.code === "P2003") return 409;
  if (error instanceof PrismaClientKnownRequestError && error.code === "P2025") return 404;
  return 500;
}

function safeURLHost(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function safeJSONParse<T>(raw: unknown): T | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeType(raw?: string | null): TopicType {
  if (raw === "travel" || raw === "golf" || raw === "knowledge") return raw;
  return "knowledge";
}

function normalizeAction(raw?: string): TopicApiAction {
  if (
    raw === "research" ||
    raw === "subtopics" ||
    raw === "draft" ||
    raw === "approve" ||
    raw === "queue" ||
    raw === "run-queue" ||
    raw === "publish-now" ||
    raw === "schedule" ||
    raw === "load"
  ) {
    return raw;
  }
  return "research";
}

function parseDraftIds(input?: string | string[]): string[] {
  if (!input) return [];
  const ids = Array.isArray(input) ? input : input.split(",");
  return ids
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-zA-Z\-]{8,}$/.test(id));
}

function parseRequestBody(body: unknown): ParsedTopicRequest {
  const parsed = body as RawTopicRequest;
  return {
    action: normalizeAction(parsed?.action),
    campaignId: typeof parsed?.campaignId === "string" ? parsed.campaignId.trim() : null,
    draftId: typeof parsed?.draftId === "string" ? parsed.draftId.trim() : null,
    draftIds: parseDraftIds(
      typeof parsed?.draftIds === "string" || Array.isArray(parsed?.draftIds)
        ? parsed.draftIds
        : parsed?.draftId
          ? [parsed.draftId]
          : []
    ),
    topic: typeof parsed?.topic === "string" ? parsed.topic.trim() : null,
    type: normalizeType(parsed?.type),
    intent: typeof parsed?.intent === "string" ? parsed.intent.trim() : null,
    audience: typeof parsed?.audience === "string" ? parsed.audience.trim() : null,
    style: typeof parsed?.style === "string" ? parsed.style.trim() : null,
    category: typeof parsed?.category === "string" ? parsed.category.trim() : null,
    board: typeof parsed?.board === "string" ? parsed.board.trim() : null,
    scheduleDate:
      typeof parsed?.scheduledAt === "string" && parsed?.scheduledAt.trim()
        ? parsed.scheduledAt.trim()
        : typeof parsed?.scheduleDate === "string" && parsed?.scheduleDate.trim()
          ? parsed.scheduleDate.trim()
          : null,
    count: Number.isFinite(parsed?.count as number)
      ? Math.max(1, Math.min(Number(parsed.count), 10))
      : DEFAULT_SUBTOPIC_COUNT,
    keywords: parseKeywords(typeof parsed?.keywords === "string" ? parsed.keywords : ""),
    sourceUrls: parseSourceUrls(parsed?.sourceUrls),
    contentJson:
      typeof parsed?.contentJson === "string"
        ? safeJSONParse<Record<string, unknown>>(parsed.contentJson)
        : null,
    intervalDays:
      typeof parsed?.intervalDays === "number" && Number.isFinite(parsed.intervalDays)
        ? Math.max(1, Math.min(30, Math.floor(parsed.intervalDays)))
        : typeof parsed?.intervalDaysPerDraft === "number" &&
            Number.isFinite(parsed.intervalDaysPerDraft)
          ? Math.max(1, Math.min(30, Math.floor(parsed.intervalDaysPerDraft)))
          : DEFAULT_QUEUE_INTERVAL_DAYS,
  };
}

function toCampaignPayload(raw: {
  id: string;
  rootTopic: string;
  type: string;
  intent: string | null;
  audience: string | null;
  style: string | null;
  sourceUrls: string | null;
  researchPackJson: string;
  status: string;
  createdAt: Date;
}): TopicCampaignPayload {
  return {
    id: raw.id,
    rootTopic: raw.rootTopic,
    type: normalizeType(raw.type),
    intent: raw.intent,
    audience: raw.audience,
    style: raw.style,
    sourceUrls: parseSourceJson(raw.sourceUrls),
    researchPackJson: raw.researchPackJson,
    status: (raw.status as TopicCampaignStatus) || "RESEARCHING",
    createdAt: raw.createdAt.toISOString(),
  };
}

function toDraftPayload(raw: {
  id: string;
  campaignId: string;
  subTopic: string;
  reason: string | null;
  priority: number;
  titleCandidates: string | null;
  contentJson: string | null;
  citations: string | null;
  thumbnailImageJson: string | null;
  sourceImagesJson: string | null;
  topicSeedJson: string | null;
  status: string;
  scheduledAt: Date | null;
  postId: string | null;
  errorMessage: string | null;
  createdAt: Date;
}): TopicDraftPayload {
  return {
    id: raw.id,
    campaignId: raw.campaignId,
    subTopic: raw.subTopic,
    reason: raw.reason,
    priority: raw.priority,
    status: (raw.status as TopicDraftStatus) || "SUBTOPIC_READY",
    titleCandidates: safeJSONParse<string[]>(raw.titleCandidates) ?? [],
    contentJson: raw.contentJson,
    citations: raw.citations,
    thumbnailImageJson: raw.thumbnailImageJson,
    sourceImagesJson: raw.sourceImagesJson,
    topicSeedJson: raw.topicSeedJson,
    scheduledAt: raw.scheduledAt ? raw.scheduledAt.toISOString() : null,
    postId: raw.postId,
    errorMessage: raw.errorMessage,
    createdAt: raw.createdAt.toISOString(),
  };
}

function parseResearchPacket(campaign: {
  researchPackJson: string;
  rootTopic: string;
  type: string;
  intent: string | null;
  audience: string | null;
  style: string | null;
}): TopicResearchPacket {
  const packet = safeJSONParse<TopicResearchPacket>(campaign.researchPackJson);
  if (!packet?.topic || !Array.isArray(packet.trendSignals)) {
    return buildEmptyResearchPacket(campaign.rootTopic, normalizeType(campaign.type), [], {
      intent: campaign.intent,
      audience: campaign.audience,
      style: campaign.style,
    });
  }

  return {
    ...buildEmptyResearchPacket(packet.topic, normalizeType(packet.type), parseSourceJson(packet.sourceUrls), {
      intent: packet.intent ?? null,
      audience: packet.audience ?? null,
      style: packet.style ?? null,
    }),
    ...packet,
    trendSignals: packet.trendSignals ?? [],
    sourceUrls: parseSourceJson(packet.sourceUrls),
    sourceSummaries: packet.sourceSummaries ?? [],
  };
}

async function buildCampaignDetails(campaignId: string): Promise<TopicCampaignWithDrafts> {
  const campaign = await prisma.topicCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: {
      id: true,
      rootTopic: true,
      type: true,
      intent: true,
      audience: true,
      style: true,
      sourceUrls: true,
      researchPackJson: true,
      status: true,
      createdAt: true,
      drafts: {
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          campaignId: true,
          subTopic: true,
          reason: true,
          priority: true,
          titleCandidates: true,
          contentJson: true,
          citations: true,
          thumbnailImageJson: true,
          sourceImagesJson: true,
          topicSeedJson: true,
          status: true,
          scheduledAt: true,
          postId: true,
          errorMessage: true,
          createdAt: true,
        },
      },
    },
  });

  return {
    campaign: toCampaignPayload(campaign),
    drafts: campaign.drafts.map(toDraftPayload),
    research: parseResearchPacket(campaign),
  };
}

async function runTopicScript({
  type,
  topic,
  keywords,
  style,
  category,
  publishMode,
  scheduledDate,
}: {
  type: TopicType;
  topic: string;
  keywords: string[];
  style?: string | null;
  category?: string | null;
  publishMode?: TopicPublishMode;
  scheduledDate?: string;
}): Promise<TopicScriptResult> {
  const hasPublishMode = publishMode === "now" || publishMode === "schedule";
  const args = [`--type=${type}`, `--topic=${topic}`];
  if (keywords.length > 0) args.push(`--keywords=${keywords.join(",")}`);
  if (style) args.push(`--style=${style}`);
  if (category) args.push(`--category=${category}`);
  if (publishMode === "now") {
    args.push("--publish-mode=now");
  }
  if (publishMode === "schedule") {
    if (!scheduledDate) {
      throw new Error("예약 발행에는 --scheduled-date가 필요합니다.");
    }
    args.push("--publish-mode=schedule");
    args.push(`--scheduled-date=${scheduledDate}`);
  }

  try {
    const timeoutMs = hasPublishMode
      ? TOPIC_SCRIPT_TIMEOUT_MS
      : TOPIC_SCRIPT_TIMEOUT_BY_WORKER_MS.default;
    const result = await runTsNodeScript("scripts/topic-agent.ts", args, {
      timeoutMs,
      env: { ...process.env },
    });

    return {
      stdout: result.stdout,
      parsed: parseTopicAgentOutput(result.stdout),
    };
  } catch (error: unknown) {
    if (hasPublishMode) {
      throw error;
    }

    const reason = getErrorMessage(error);
    console.warn("topic-agent 실행 실패, 로컬 폴백 초안으로 전환합니다.", reason);
    return {
      stdout: "",
      parsed: {
        title: `${topic} 정리`,
        sections: ["초안 생성 규칙 기반 템플릿으로 작성합니다."],
        hashtags: [`#${type}`],
      },
      fallbackReason:
        `LLM 생성기를 사용할 수 없어 규칙 기반 초안으로 전환했습니다: ${reason}`,
    };
  }
}

function isDraftDue(draft: { scheduledAt: Date | null }, now: Date): boolean {
  if (!draft.scheduledAt) return true;
  return draft.scheduledAt.getTime() <= now.getTime();
}

function getNextScheduledTime(drafts: { scheduledAt: Date | null }[]): string | null {
  const futureDates = drafts
    .map((draft) => draft.scheduledAt)
    .filter((scheduledAt): scheduledAt is Date =>
      scheduledAt instanceof Date && !Number.isNaN(scheduledAt.getTime()))
    .filter((scheduledAt) => scheduledAt.getTime() > Date.now())
    .sort((a, b) => a.getTime() - b.getTime());

  return futureDates[0] ? futureDates[0].toISOString() : null;
}

async function processTopicQueueInBackground(
  campaignId: string,
  draftIds: string[],
  options: {
    forceRun?: boolean;
  } = {},
): Promise<TopicQueueExecutionResult> {
  const { forceRun = false } = options;
  try {
    const queueDrafts = await prisma.topicDraft.findMany({
      where: {
        campaignId,
        status: "QUEUED",
        id: { in: draftIds },
        postId: { not: null },
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

  const now = new Date();
  const dueDrafts = forceRun ? queueDrafts : queueDrafts.filter((draft) => isDraftDue(draft, now));
  const deferredDrafts = forceRun
    ? []
    : queueDrafts.filter((draft) => !isDraftDue(draft, now));
    const nextRunAt = getNextScheduledTime(deferredDrafts);

    if (dueDrafts.length === 0) {
      await prisma.topicCampaign.update({
        where: { id: campaignId },
        data: {
          status: deferredDrafts.length > 0 ? "QUEUED" : "FAILED",
        },
      });

      return {
        requestedCount: queueDrafts.length,
        dueCount: 0,
        deferredCount: deferredDrafts.length,
        executed: [],
        allQueuedIds: queueDrafts.map((draft) => draft.id),
        nextRunAt,
      };
    }

    let anyFailure = false;
    const executed: TopicQueueRunItem[] = [];

      for (const draft of dueDrafts) {
      if (!draft.postId) continue;

      const success = await executeScheduledPost(draft.postId, { forceRun });
      const post = await prisma.post.findUnique({
        where: { id: draft.postId },
        select: { errorMessage: true, status: true },
      });

      const deferredByScheduler =
        !success &&
        post?.status === "PENDING" &&
        (post.errorMessage == null || post.errorMessage.trim().length === 0);

      const finalStatus = deferredByScheduler ? "QUEUED" : success ? "PUBLISHED" : "FAILED";

      await prisma.topicDraft.update({
        where: { id: draft.id },
        data: {
          status: finalStatus,
          errorMessage: post?.errorMessage ?? undefined,
        },
      });

      if (deferredByScheduler) {
        continue;
      }

      executed.push({
        draftId: draft.id,
        postId: draft.postId,
        success,
      });

      if (!success) {
        anyFailure = true;
      }
    }

    const nextStatus =
      deferredDrafts.length > 0 ? "QUEUED" : anyFailure ? "FAILED" : "REVIEW";
    await prisma.topicCampaign.update({
      where: { id: campaignId },
      data: { status: nextStatus },
    });

    return {
      requestedCount: queueDrafts.length,
      dueCount: dueDrafts.length,
      deferredCount: deferredDrafts.length,
      executed,
      allQueuedIds: queueDrafts.map((draft) => draft.id),
      nextRunAt,
    };
  } catch (error: unknown) {
    await prisma.topicCampaign.update({
      where: { id: campaignId },
      data: { status: "FAILED" },
    });
    console.error("주제 큐 백그라운드 실행 중 오류:", error);

    return {
      requestedCount: 0,
      dueCount: 0,
      deferredCount: 0,
      executed: [],
      allQueuedIds: [],
      nextRunAt: null,
    };
  }
}

function buildTopicQueueRunResult(
  campaignId: string,
  requestedCount: number,
  queuedCount: number,
  deferredCount = 0,
  dueCount = 0,
  nextRunAt: string | null = null,
): TopicQueueRunResult {
  return {
    campaignId,
    requestedCount,
    queuedCount,
    started: queuedCount > 0,
    deferredCount,
    dueCount,
    nextRunAt,
  };
}

function buildFallbackDraft(seed: {
  rootTopic: string;
  topic: string;
  type: TopicType;
  subtopic: string;
  reason: string | null;
  priority: number;
  style?: string | null;
  parsed: ReturnType<typeof parseTopicAgentOutput>;
  keywords: string[];
}): {
  title: string;
  titleCandidates: string[];
  sections: string[];
  hashtags: string[];
} {
  const seedTitle = `${seed.subtopic}`.trim();
  const title =
    seed.parsed?.title?.trim() ||
    (seedTitle ? `${seedTitle} 정리` : `${seed.rootTopic} 가이드`);

  const sections =
    seed.parsed?.sections?.length
      ? seed.parsed.sections.filter(Boolean)
      : [
          `${seed.type === "travel" ? "여행" : seed.type === "golf" ? "골프" : "리뷰"} 핵심 포인트`,
          "각 항목을 경험 관점에서 정리했습니다.",
          "마무리로 실전에서 적용할 포인트를 정리했습니다.",
        ];

  const hashtags =
    seed.parsed?.hashtags?.length
      ? seed.parsed.hashtags.filter(Boolean)
      : [`#${seed.type}`];

  const titleCandidates = normalizeSubtopics(
    [
      title,
      `${seedTitle} 완전 정리`,
      `${seedTitle} 장단점`,
      `${seedTitle} 체크리스트`,
      `${seedTitle} 실전 가이드`,
      `${seedTitle} 추천 체크`,
      `2026년 ${seedTitle} 인사이트`,
    ],
    6,
  );

  return { title, titleCandidates, sections, hashtags };
}

type DraftContentInput = {
  title?: unknown;
  sections?: unknown;
  hashtags?: unknown;
};

function normalizeDraftSections(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    const sections: string[] = [];

    for (const entry of value) {
      if (typeof entry === "string") {
        const text = entry.trim();
        if (text) sections.push(text);
        continue;
      }

      if (!entry || typeof entry !== "object") {
        continue;
      }

      const block = entry as {
        heading?: unknown;
        sectionTitle?: unknown;
        body?: unknown;
        content?: unknown;
      };

      const heading =
        typeof block.heading === "string"
          ? block.heading.trim()
          : typeof block.sectionTitle === "string"
            ? block.sectionTitle.trim()
            : "";
      const body =
        typeof block.body === "string"
          ? block.body.trim()
          : typeof block.content === "string"
            ? block.content.trim()
            : "";

      const merged = [heading, body].filter(Boolean).join("\n\n");
      if (merged) sections.push(merged);
    }

    return sections;
  }

  if (typeof value === "string") {
    return value
      .split(/\n\n+/)
      .map((section) => section.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeDraftContent(raw: string | null): {
  title: string;
  sections: string[];
  hashtags: string[];
} {
  if (!raw) {
    return { title: "", sections: [], hashtags: [] };
  }

  const parsed = safeJSONParse<DraftContentInput>(raw);
  if (!parsed) {
    return { title: "", sections: [], hashtags: [] };
  }

  return {
    title: typeof parsed.title === "string" ? parsed.title.trim() : "",
    sections: normalizeDraftSections(parsed.sections),
    hashtags: Array.isArray(parsed.hashtags)
      ? parsed.hashtags
          .map((hashtag) => (typeof hashtag === "string" ? hashtag.trim() : ""))
          .filter(Boolean)
      : [],
  };
}

function buildSeedPayload(campaign: {
  id: string;
  rootTopic: string;
  type: TopicType;
  style: string | null;
  keywords: string[];
}, draft: { id: string; subTopic: string }, category?: string | null, publishMeta?: {
  publishMode?: TopicPublishMode;
  scheduledDate?: string;
}): string {
  return JSON.stringify({
    campaignId: campaign.id,
    draftId: draft.id,
    researchRef: {
      campaignId: campaign.id,
      subTopic: draft.subTopic,
    },
    type: campaign.type,
    topic: campaign.rootTopic,
    detailTopic: draft.subTopic,
    keywords: campaign.keywords,
    style: campaign.style,
    category,
    publishMode: publishMeta?.publishMode,
    scheduledDate: publishMeta?.scheduledDate,
  });
}

export async function GET(req: NextRequest) {
  try {
    const authError = requireAdminApiKey(req);
    if (authError) return authError;

    const searchParams = req.nextUrl.searchParams;
    const campaignId = searchParams.get("campaignId");

    if (campaignId) {
      const data = await buildCampaignDetails(campaignId);
      return NextResponse.json<TopicApiResponse>({ success: true, data });
    }

    const limit = Math.max(1, Math.min(50, Number.parseInt(searchParams.get("limit") ?? "20", 10)));
    const campaigns = await prisma.topicCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        rootTopic: true,
        type: true,
        intent: true,
        audience: true,
        style: true,
        sourceUrls: true,
        researchPackJson: true,
        status: true,
        createdAt: true,
        drafts: {
          select: { id: true },
        },
      },
    });

    const items: TopicCampaignListItem[] = campaigns.map((campaign) => ({
      ...toCampaignPayload(campaign),
      draftCount: campaign.drafts.length,
    }));

    return NextResponse.json<TopicApiResponse>({
      success: true,
      data: { campaigns: items },
    });
  } catch (error: unknown) {
    console.error("Topic API GET error:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: getErrorStatus(error) }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authError = requireAdminApiKey(req);
    if (authError) return authError;

    const request = await req.json().catch(() => null);
    const body = parseRequestBody(request);

    if (body.action === "load") {
      if (!body.campaignId) {
        return NextResponse.json(
          { success: false, error: "campaignId가 필요합니다." },
          { status: 400 }
        );
      }
      const data = await buildCampaignDetails(body.campaignId);
      return NextResponse.json({ success: true, data });
    }

    if (body.action === "research") {
      if (!body.topic) {
        return NextResponse.json(
          { success: false, error: "topic은 필수입니다." },
          { status: 400 }
        );
      }

      const packetBase = await buildResearchSignals(body.topic, body.type, body.keywords);
      const sourceSummaries =
        body.sourceUrls.length > 0
          ? await collectSourceSummaries(body.sourceUrls)
          : packetBase.sourceSummaries;
      const packet: TopicResearchPacket = {
        ...packetBase,
        sourceUrls: body.sourceUrls,
        sourceSummaries,
      };

      const campaign = await prisma.topicCampaign.create({
        data: {
          rootTopic: body.topic,
          type: body.type,
          intent: body.intent,
          audience: body.audience,
          style: body.style,
          sourceUrls: JSON.stringify(body.sourceUrls),
          researchPackJson: JSON.stringify(packet),
          status: "RESEARCH_DONE",
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          action: "research",
          campaign: toCampaignPayload(campaign),
          research: packet,
          keywordCount: packet.trendSignals.length,
          sourceCount: packet.sourceSummaries.length,
          combinedKeywords: [
            ...packet.trendSignals.map((entry) => entry.keyword),
            ...body.keywords,
          ],
          snippets: packet.sourceSummaries,
        },
      });
    }

    if (!body.campaignId) {
      return NextResponse.json(
        { success: false, error: "이 작업은 campaignId가 필요합니다." },
        { status: 400 }
      );
    }

    const campaign = await prisma.topicCampaign.findUnique({
      where: { id: body.campaignId },
      select: {
        id: true,
        rootTopic: true,
        type: true,
        intent: true,
        audience: true,
        style: true,
        sourceUrls: true,
        researchPackJson: true,
        status: true,
        createdAt: true,
      },
    });

    if (!campaign) {
      return NextResponse.json(
        { success: false, error: "campaignId를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const parsedPacket = parseResearchPacket(campaign);
    const category = body.board || body.category || null;

    if (body.action === "subtopics") {
      const plans = planSubtopics(
        parsedPacket.topic,
        normalizeType(parsedPacket.type),
        parsedPacket.trendSignals,
        Math.max(1, body.count),
        {
          intent: parsedPacket.intent,
          audience: parsedPacket.audience,
          style: parsedPacket.style,
        },
      ).slice(0, 8);

      if (plans.length === 0) {
        return NextResponse.json(
          { success: false, error: "파생 소주제를 생성하지 못했습니다." },
          { status: 500 }
        );
      }

      await prisma.topicDraft.deleteMany({
        where: {
          campaignId: campaign.id,
          status: { in: ["SUBTOPIC_READY", "DRAFTING", "DRAFT_READY", "FAILED", "APPROVED", "REVIEW", "QUEUED", "PUBLISHED"] },
        },
      });

      const created = await prisma.$transaction(
        plans.map((plan, index) =>
          prisma.topicDraft.create({
            data: {
              campaignId: campaign.id,
              subTopic: plan.subtopic,
              reason: plan.reason,
              priority: plan.priority || index + 1,
              status: "SUBTOPIC_READY",
              topicSeedJson: JSON.stringify({
                campaignId: campaign.id,
                subtopic: plan.subtopic,
                confidence: plan.confidence,
              }),
            },
          })
        ),
      );

      await prisma.topicCampaign.update({
        where: { id: campaign.id },
        data: { status: "SUBTOPIC_READY" },
      });

      return NextResponse.json({
        success: true,
        data: {
          action: "subtopics",
          campaign: toCampaignPayload(campaign),
          plans,
          drafts: created.map(toDraftPayload),
        },
      });
    }

    if (body.action === "draft") {
      const selected = body.draftIds.length
        ? body.draftIds
        : body.draftId
          ? [body.draftId]
          : [];
      const candidates = await prisma.topicDraft.findMany({
        where: {
          campaignId: campaign.id,
          status: { in: ["SUBTOPIC_READY", "DRAFT_READY", "FAILED", "REVIEW"] },
          ...(selected.length > 0 ? { id: { in: selected } } : {}),
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      });

      if (candidates.length === 0) {
        return NextResponse.json(
          { success: false, error: "초안 후보가 없습니다." },
          { status: 404 }
        );
      }

      const updated: TopicDraftPayload[] = [];
      const failed: string[] = [];
      const allKeywords = [
        ...body.keywords,
        ...parseSourceJson(parsedPacket.sourceUrls),
        campaign.type,
        campaign.rootTopic,
      ].filter(Boolean);

      const sourceUrls = parseSourceJson(campaign.sourceUrls);
      let cursor = 0;

      const processSingleDraft = async (draft: typeof candidates[number]) => {
        try {
          await prisma.topicDraft.update({
            where: { id: draft.id },
            data: { status: "DRAFTING" },
          });

          const result = await runTopicScript({
            type: normalizeType(campaign.type),
            topic: `${campaign.rootTopic} - ${draft.subTopic}`,
            keywords: Array.from(new Set(allKeywords)),
            style: body.style || campaign.style,
            category,
            publishMode: undefined,
          });

          const fallback = buildFallbackDraft({
            rootTopic: campaign.rootTopic,
            topic: draft.subTopic,
            type: normalizeType(campaign.type),
            subtopic: draft.subTopic,
            reason: draft.reason,
            priority: draft.priority,
            style: body.style || campaign.style,
            parsed: result.parsed,
            keywords: allKeywords,
          });

          const contentJson = {
            title: fallback.title,
            sections: fallback.sections,
            hashtags: fallback.hashtags,
          };

          await prisma.topicDraftImage.deleteMany({ where: { draftId: draft.id } });

          if (sourceUrls.length > 0) {
            await prisma.topicDraftImage.createMany({
              data: sourceUrls.map((sourceUrl, index) => ({
                draftId: draft.id,
                sourceUrl,
                localPath: null,
                creditName: safeURLHost(sourceUrl),
                creditUrl: sourceUrl,
                role: index === 0 ? "hero" : "inline",
              })),
            });
          }

          const updatedDraft = await prisma.topicDraft.update({
            where: { id: draft.id },
            data: {
              status: "DRAFT_READY",
              titleCandidates: JSON.stringify(fallback.titleCandidates),
              contentJson: JSON.stringify(contentJson),
              citations: JSON.stringify(parsedPacket.sourceSummaries),
              sourceImagesJson: sourceUrls.length > 0 ? JSON.stringify(sourceUrls) : null,
              topicSeedJson: buildSeedPayload(
                {
                  id: campaign.id,
                  rootTopic: campaign.rootTopic,
                  type: normalizeType(campaign.type),
                  style: campaign.style,
                  keywords: allKeywords,
                },
                { id: draft.id, subTopic: draft.subTopic },
                category,
              ),
              errorMessage: null,
            },
            select: {
              id: true,
              campaignId: true,
              subTopic: true,
              reason: true,
              priority: true,
              titleCandidates: true,
              contentJson: true,
              citations: true,
              thumbnailImageJson: true,
              sourceImagesJson: true,
              topicSeedJson: true,
              status: true,
              scheduledAt: true,
              postId: true,
              errorMessage: true,
              createdAt: true,
            },
          });
          updated.push(toDraftPayload(updatedDraft));
        } catch (error: unknown) {
          failed.push(draft.id);
          await prisma.topicDraft.update({
            where: { id: draft.id },
            data: {
              status: "FAILED",
              errorMessage: getErrorMessage(error),
            },
          });
        }
      };

      const workers = Array.from(
        { length: Math.min(TOPIC_DRAFT_GENERATION_CONCURRENCY, candidates.length) },
        () => async () => {
          while (cursor < candidates.length) {
            const currentIndex = cursor;
            cursor += 1;
            const draft = candidates[currentIndex];
            await processSingleDraft(draft);
          }
        },
      );

      await Promise.all(workers.map((worker) => worker()));

      const processedDrafts = await prisma.topicDraft.findMany({
        where: {
          campaignId: campaign.id,
          id: { in: candidates.map((draft) => draft.id) },
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          campaignId: true,
          subTopic: true,
          reason: true,
          priority: true,
          titleCandidates: true,
          contentJson: true,
          citations: true,
          thumbnailImageJson: true,
          sourceImagesJson: true,
          topicSeedJson: true,
          status: true,
          scheduledAt: true,
          postId: true,
          errorMessage: true,
          createdAt: true,
        },
      });

      await prisma.topicCampaign.update({
        where: { id: campaign.id },
        data: { status: updated.length > 0 ? "DRAFT_READY" : "FAILED" },
      });

      return NextResponse.json({
        success: true,
        data: {
          action: "draft",
          campaignId: campaign.id,
          drafts: processedDrafts.map(toDraftPayload),
          failedDraftIds: failed,
        },
      });
    }

    if (body.action === "approve") {
      const selected = body.draftIds.length
        ? body.draftIds
        : body.draftId
          ? [body.draftId]
          : [];
      if (!selected.length) {
        return NextResponse.json(
          { success: false, error: "승인할 draftId가 없습니다." },
          { status: 400 }
        );
      }

      const data: { status: TopicDraftStatus; contentJson?: string } = {
        status: "APPROVED",
      };

      if (body.contentJson) {
        data.contentJson = JSON.stringify(body.contentJson);
      }

      const result = await prisma.topicDraft.updateMany({
        where: {
          id: { in: selected },
          campaignId: campaign.id,
        },
        data,
      });

      await prisma.topicCampaign.update({
        where: { id: campaign.id },
        data: {
          status: result.count > 0 ? "REVIEW" : campaign.status,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          action: "approve",
          campaignId: campaign.id,
          approvedCount: result.count,
        },
      });
    }

    if (body.action === "queue") {
      const selected = body.draftIds.length
        ? body.draftIds
        : body.draftId
          ? [body.draftId]
          : [];
      if (!selected.length) {
        return NextResponse.json(
          { success: false, error: "발행 큐 등록할 draftId가 없습니다." },
          { status: 400 }
        );
      }

      const schedule = parseDateInput(body.scheduleDate || "", new Date());
      const drafts = await prisma.topicDraft.findMany({
        where: {
          campaignId: campaign.id,
          id: { in: selected },
          status: { in: ["DRAFT_READY", "APPROVED", "REVIEW"] },
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      });

      if (!drafts.length) {
        return NextResponse.json(
          { success: false, error: "발행 가능한 초안이 없습니다." },
          { status: 404 }
        );
      }

      const created = await prisma.$transaction(async (tx) => {
        const rows: { draftId: string; postId: string; scheduledAt: string }[] = [];
        let nextAt = new Date(schedule.effectiveDate);

        for (const draft of drafts) {
          const draftContent = normalizeDraftContent(draft.contentJson);
          const title = draftContent.title?.trim() || draft.subTopic || campaign.rootTopic;
          const contentHtml = JSON.stringify({
            title,
            sections: draftContent.sections,
            hashtags: draftContent.hashtags,
          });

          const post = await tx.post.create({
            data: {
              date: nextAt,
              scheduledAt: nextAt,
              status: "PENDING",
              topicSeed: buildSeedPayload(
                {
                  id: campaign.id,
                  rootTopic: campaign.rootTopic,
                  type: normalizeType(campaign.type),
                  style: campaign.style,
                  keywords: body.keywords,
                },
                { id: draft.id, subTopic: draft.subTopic },
                category,
                {
                  publishMode: "schedule",
                  scheduledDate: formatDateYmd(nextAt),
                },
              ),
              title,
              contentHtml,
              keywords: JSON.stringify(body.keywords),
              brandLinks: JSON.stringify(parseSourceJson(campaign.sourceUrls)),
              category,
              tone: campaign.style || body.style,
              tags:
                draftContent && Array.isArray(draftContent.hashtags)
                  ? JSON.stringify(draftContent.hashtags)
                  : null,
            },
          });

          await tx.topicDraft.update({
            where: { id: draft.id },
            data: {
              status: "QUEUED",
              postId: post.id,
              scheduledAt: nextAt,
            },
          });

          const next = new Date(nextAt);
          next.setDate(next.getDate() + body.intervalDays);
          nextAt = next;

          rows.push({ draftId: draft.id, postId: post.id, scheduledAt: post.scheduledAt.toISOString() });
        }

        await tx.topicCampaign.update({
          where: { id: campaign.id },
          data: { status: "QUEUED" },
        });

        return rows;
      });

      return NextResponse.json({
        success: true,
        data: {
          action: "queue",
          campaignId: campaign.id,
          created,
          requestedAt: schedule.requestedDate || schedule.effectiveDateInput,
          effectiveAt: schedule.effectiveDate.toISOString(),
          adjustedFromPast: schedule.adjustedFromPast,
        },
      });
    }

    if (body.action === "run-queue") {
      const selected = body.draftIds.length
        ? body.draftIds
        : body.draftId
          ? [body.draftId]
          : [];

      const queueDrafts = await prisma.topicDraft.findMany({
        where: {
          campaignId: campaign.id,
          status: "QUEUED",
          ...(selected.length > 0 ? { id: { in: selected } } : {}),
          postId: { not: null },
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      });

      if (!queueDrafts.length) {
        return NextResponse.json({
          success: true,
          data: {
            action: "run-queue",
            runQueue: buildTopicQueueRunResult(campaign.id, 0, 0, 0, 0, null),
          },
        });
      }

      const now = new Date();
      const dueDrafts = queueDrafts.filter((draft) => isDraftDue(draft, now));
      const deferredDrafts = queueDrafts.filter((draft) => !isDraftDue(draft, now));
      const nextRunAt = getNextScheduledTime(deferredDrafts);
      const queuedDraftIds = queueDrafts.map((draft) => draft.id);

      if (dueDrafts.length > 0) {
        void processTopicQueueInBackground(campaign.id, queuedDraftIds).catch((error: unknown) => {
          console.error("주제 큐 비동기 실행 실패:", getErrorMessage(error));
        });
      }

      return NextResponse.json({
        success: true,
        data: {
          action: "run-queue",
          runQueue: {
            campaignId: campaign.id,
            requestedCount: queuedDraftIds.length,
            queuedCount: dueDrafts.length,
            started: dueDrafts.length > 0,
            deferredCount: deferredDrafts.length,
            dueCount: dueDrafts.length,
            nextRunAt,
          },
        },
      });
    }

    if (body.action === "publish-now") {
      const result = await runTopicScript({
        type: normalizeType(campaign.type),
        topic: body.topic || campaign.rootTopic,
        keywords: Array.from(new Set([...body.keywords, campaign.rootTopic])),
        style: body.style || campaign.style,
        category,
        publishMode: "now",
      });
      return NextResponse.json({
        success: true,
        data: {
          action: "publish-now",
          output: result.stdout.slice(-2500),
          published: true,
        },
      });
    }

    if (body.action === "schedule") {
      const schedule = parseDateInput(body.scheduleDate || "", new Date());
      const result = await runTopicScript({
        type: normalizeType(campaign.type),
        topic: body.topic || campaign.rootTopic,
        keywords: body.keywords,
        style: body.style || campaign.style,
        category,
        publishMode: undefined,
      });

      const fallback = buildFallbackDraft({
        rootTopic: campaign.rootTopic,
        topic: body.topic || campaign.rootTopic,
        type: normalizeType(campaign.type),
        subtopic: body.topic || campaign.rootTopic,
        reason: "legacy schedule",
        priority: 1,
        style: body.style || campaign.style,
        parsed: result.parsed,
        keywords: body.keywords,
      });

      const post = await prisma.post.create({
        data: {
          date: schedule.effectiveDate,
          scheduledAt: schedule.effectiveDate,
          status: "PENDING",
          topicSeed: JSON.stringify({
            campaignId: campaign.id,
            type: normalizeType(campaign.type),
            topic: body.topic || campaign.rootTopic,
            keywords: body.keywords,
            style: body.style || campaign.style,
            category,
          }),
          title: fallback.title,
          contentHtml: JSON.stringify({
            title: fallback.title,
            sections: fallback.sections,
            hashtags: fallback.hashtags,
          }),
          keywords: JSON.stringify(body.keywords),
          brandLinks: JSON.stringify(parseSourceJson(campaign.sourceUrls)),
          category,
          tone: body.style || campaign.style,
          tags: JSON.stringify(fallback.hashtags),
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          action: "schedule",
          draftId: post.id,
          requestedAt: schedule.requestedDate || schedule.effectiveDateInput,
          scheduledAt: post.scheduledAt.toISOString(),
          adjustedFromPast: schedule.adjustedFromPast,
          status: post.status,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: "지원하지 않는 action입니다." },
      { status: 400 },
    );
  } catch (error: unknown) {
    console.error("Topic API POST error:", error);
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error),
        stderr: getErrorStderr(error),
      },
      { status: getErrorStatus(error) },
    );
  }
}
