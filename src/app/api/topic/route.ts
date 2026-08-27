import { NextRequest, NextResponse } from "next/server";
import { PrismaClientKnownRequestError } from "@/generated/prisma/runtime/library";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { prepareTopicTask, TopicPrepareConflictError } from "@/services/topic-task-pipeline";
import {
  TopicCampaignStatus,
  TopicDraftStatus,
  TopicResearchPacket,
  TopicType,
  buildEmptyResearchPacket,
  parseKeywords,
  parseSourceJson,
  parseSourceUrls,
} from "@/lib/topic-workflow";

interface RawTopicRequest {
  action?: string;
  taskId?: string;
  campaignId?: string;
  topic?: string;
  type?: string | null;
  intent?: string | null;
  audience?: string | null;
  style?: string | null;
  keywords?: string | null;
  sourceUrls?: string | string[];
  category?: string | null;
  board?: string | null;
  topicCraftCategory?: string | null;
}

interface ParsedTopicRequest {
  action: string;
  taskId: string | null;
  campaignId: string | null;
  topic: string | null;
  type: TopicType;
  intent: string | null;
  audience: string | null;
  style: string | null;
  keywords: string[];
  sourceUrls: string[];
  category: string | null;
  board: string | null;
  topicCraftCategory: string | null;
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
  research: TopicResearchPacket;
}

interface TopicApiResponse {
  success: boolean;
  error?: string;
  data?: unknown;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "주제 API 처리에 실패했습니다.";
}

function getErrorStatus(error: unknown): number {
  if (error instanceof PrismaClientKnownRequestError && error.code === "P2003") return 409;
  if (error instanceof PrismaClientKnownRequestError && error.code === "P2025") return 404;
  if (error instanceof TopicPrepareConflictError) return 409;
  return 500;
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
  if (raw === "travel" || raw === "골프") return raw === "travel" ? "travel" : "golf";
  if (raw === "golf" || raw === "여행") return raw === "golf" ? "golf" : "travel";
  return "knowledge";
}

function mapTaskTypeLabel(type: TopicType): string {
  if (type === "travel") return "여행";
  if (type === "golf") return "골프";
  return "정보성";
}

function parseRequestBody(body: unknown): ParsedTopicRequest {
  const parsed = (body ?? {}) as RawTopicRequest;

  return {
    action: typeof parsed.action === "string" ? parsed.action.trim() : "",
    taskId: typeof parsed.taskId === "string" ? parsed.taskId.trim() : null,
    campaignId: typeof parsed.campaignId === "string" ? parsed.campaignId.trim() : null,
    topic: typeof parsed.topic === "string" ? parsed.topic.trim() : null,
    type: normalizeType(parsed.type),
    intent: typeof parsed.intent === "string" ? parsed.intent.trim() : null,
    audience: typeof parsed.audience === "string" ? parsed.audience.trim() : null,
    style: typeof parsed.style === "string" ? parsed.style.trim() : null,
    keywords: parseKeywords(typeof parsed.keywords === "string" ? parsed.keywords : ""),
    sourceUrls: parseSourceUrls(parsed.sourceUrls),
    category: typeof parsed.category === "string" ? parsed.category.trim() : null,
    board: typeof parsed.board === "string" ? parsed.board.trim() : null,
    topicCraftCategory:
      typeof parsed.topicCraftCategory === "string" ? parsed.topicCraftCategory.trim() : null,
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
  sourceUrls: string | null;
}): TopicResearchPacket {
  const packet = safeJSONParse<TopicResearchPacket>(campaign.researchPackJson);
  if (!packet?.topic || !Array.isArray(packet.trendSignals)) {
    return buildEmptyResearchPacket(
      campaign.rootTopic,
      normalizeType(campaign.type),
      parseSourceJson(campaign.sourceUrls),
      {
        intent: campaign.intent,
        audience: campaign.audience,
        style: campaign.style,
      },
    );
  }

  return {
    ...buildEmptyResearchPacket(
      packet.topic,
      normalizeType(packet.type),
      parseSourceJson(packet.sourceUrls),
      {
        intent: packet.intent ?? null,
        audience: packet.audience ?? null,
        style: packet.style ?? null,
      },
    ),
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

function buildLegacyActionError(action: string) {
  return NextResponse.json<TopicApiResponse>(
    {
      success: false,
      error: `action=${action || "unknown"} 는 더 이상 운영 경로가 아닙니다. /api/topic-tasks 또는 action=prepare 를 사용하세요.`,
    },
    { status: 410 },
  );
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
      data: {
        mode: "debug",
        campaigns: items,
      },
    });
  } catch (error: unknown) {
    console.error("Topic API GET error:", error);
    return NextResponse.json<TopicApiResponse>(
      { success: false, error: getErrorMessage(error) },
      { status: getErrorStatus(error) },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authError = requireAdminApiKey(req);
    if (authError) return authError;

    const request = await req.json().catch(() => null);
    const body = parseRequestBody(request);

    if (body.action === "prepare") {
      let taskId = body.taskId;

      if (!taskId) {
        if (!body.topic) {
          return NextResponse.json<TopicApiResponse>(
            { success: false, error: "prepare에는 taskId 또는 topic이 필요합니다." },
            { status: 400 },
          );
        }

        const task = await prisma.topicPostTask.create({
          data: {
            topic: body.topic,
            keywords: body.keywords.join(", ") || null,
            type: mapTaskTypeLabel(body.type),
            topicCraftCategory: body.topicCraftCategory || null,
            memo: body.intent || body.style || null,
            categoryNo: body.board || body.category || null,
            status: "READY",
            pipelineStage: "READY",
          },
          select: { id: true },
        });

        taskId = task.id;
      }

      await prepareTopicTask(taskId);
      const preparedTask = await prisma.topicPostTask.findUnique({
        where: { id: taskId },
      });

      return NextResponse.json<TopicApiResponse>({
        success: true,
        data: {
          action: "prepare",
          task: preparedTask,
        },
      });
    }

    if (body.action === "load") {
      if (!body.campaignId) {
        return NextResponse.json<TopicApiResponse>(
          { success: false, error: "campaignId가 필요합니다." },
          { status: 400 },
        );
      }

      const data = await buildCampaignDetails(body.campaignId);
      return NextResponse.json<TopicApiResponse>({ success: true, data });
    }

    return buildLegacyActionError(body.action);
  } catch (error: unknown) {
    console.error("Topic API POST error:", error);
    return NextResponse.json<TopicApiResponse>(
      { success: false, error: getErrorMessage(error) },
      { status: getErrorStatus(error) },
    );
  }
}
