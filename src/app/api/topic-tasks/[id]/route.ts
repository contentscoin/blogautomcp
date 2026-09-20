import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { TOPIC_CRAFT_CATEGORIES, TopicPrepareConflictError } from "@/services/topic-task-pipeline";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

interface UpdateTopicTaskRequest {
  topic?: string;
  keywords?: string | null;
  type?: string | null;
  topicCraftCategory?: string | null;
  memo?: string | null;
  categoryNo?: string | null;
  scheduledPublishAt?: string | null;
}

function normalizeCategoryNo(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{1,6}$/.test(trimmed)) return undefined;
  return trimmed;
}

// GET: 단일 태스크 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const task = await prisma.topicPostTask.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: "태스크를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const selectedDraft =
      task.selectedDraftId
        ? await prisma.topicDraft.findUnique({
            where: { id: task.selectedDraftId },
            select: {
              images: {
                select: {
                  sourceUrl: true,
                  localPath: true,
                  creditName: true,
                  creditUrl: true,
                  role: true,
                  query: true,
                  provider: true,
                  createdAt: true,
                },
                orderBy: [{ role: "asc" }, { createdAt: "asc" }],
              },
            },
          })
        : null;

    return NextResponse.json({
      success: true,
      data: {
        ...task,
        preparedImages: selectedDraft?.images ?? [],
      },
    });
  } catch (error: unknown) {
    console.error("태스크 조회 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// DELETE: 태스크 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    const { id } = await params;

    const existing = await prisma.topicPostTask.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "태스크를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    await prisma.topicPostTask.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("태스크 삭제 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// PATCH: 태스크 수정
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    const { id } = await params;
    const body = (await request.json()) as UpdateTopicTaskRequest;

    const hasTopic = Object.prototype.hasOwnProperty.call(body, "topic");
    const hasKeywords = Object.prototype.hasOwnProperty.call(body, "keywords");
    const hasType = Object.prototype.hasOwnProperty.call(body, "type");
    const hasTopicCraftCategory = Object.prototype.hasOwnProperty.call(body, "topicCraftCategory");
    const hasMemo = Object.prototype.hasOwnProperty.call(body, "memo");
    const hasCategoryNo = Object.prototype.hasOwnProperty.call(body, "categoryNo");
    const hasScheduledPublishAt = Object.prototype.hasOwnProperty.call(body, "scheduledPublishAt");

    if (
      !hasTopic &&
      !hasKeywords &&
      !hasType &&
      !hasTopicCraftCategory &&
      !hasMemo &&
      !hasCategoryNo &&
      !hasScheduledPublishAt
    ) {
      return NextResponse.json(
        { success: false, error: "수정할 필드가 없습니다." },
        { status: 400 }
      );
    }

    const categoryNo = hasCategoryNo ? normalizeCategoryNo(body.categoryNo) : undefined;
    if (hasCategoryNo && categoryNo === undefined) {
      return NextResponse.json(
        { success: false, error: "categoryNo는 숫자 문자열 또는 null이어야 합니다." },
        { status: 400 }
      );
    }

    const normalizedTopicCraftCategory =
      typeof body.topicCraftCategory === "string" && body.topicCraftCategory.trim().length > 0
        ? body.topicCraftCategory.trim()
        : body.topicCraftCategory === null
          ? null
          : undefined;
    if (
      hasTopicCraftCategory &&
      normalizedTopicCraftCategory !== null &&
      normalizedTopicCraftCategory !== undefined &&
      !TOPIC_CRAFT_CATEGORIES.includes(
        normalizedTopicCraftCategory as (typeof TOPIC_CRAFT_CATEGORIES)[number],
      )
    ) {
      return NextResponse.json(
        { success: false, error: "유효하지 않은 topicCraftCategory 입니다." },
        { status: 400 }
      );
    }

    let parsedScheduledDate: Date | null = null;
    if (hasScheduledPublishAt && body.scheduledPublishAt && /^\d{4}-\d{2}-\d{2}$/.test(body.scheduledPublishAt.trim())) {
      parsedScheduledDate = new Date(`${body.scheduledPublishAt.trim()}T00:00:00.000Z`);
    }

    const existing = await prisma.topicPostTask.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "태스크를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const state = await prisma.topicPostTask.findUnique({
      where: { id }, select: { pipelineStage: true, status: true, updatedAt: true },
    });
    if (!state || state.pipelineStage === "OUTCOME_UNKNOWN" || state.status === "PUBLISHING") {
      throw new TopicPrepareConflictError("실제 발행/예약 결과를 확인하고 수동 복구하기 전에는 수정하거나 재준비할 수 없습니다.");
    }
    const updated = await prisma.topicPostTask.updateMany({
      where: { id, updatedAt: state.updatedAt, pipelineStage: { not: "OUTCOME_UNKNOWN" }, status: { not: "PUBLISHING" } },
      data: {
        ...(hasTopic && body.topic ? { topic: body.topic.trim() } : {}),
        ...(hasKeywords ? { keywords: body.keywords?.trim() || null } : {}),
        ...(hasType ? { type: body.type?.trim() || null } : {}),
        ...(hasTopicCraftCategory ? { topicCraftCategory: normalizedTopicCraftCategory ?? null } : {}),
        ...(hasMemo ? { memo: body.memo?.trim() || null } : {}),
        ...(hasCategoryNo ? { categoryNo } : {}),
        ...(hasScheduledPublishAt ? { scheduledPublishAt: parsedScheduledDate } : {}),
        ...(hasTopic || hasKeywords || hasType || hasTopicCraftCategory || hasMemo
          ? {
              status: "READY",
              pipelineStage: "READY",
              selectedDraftId: null,
              preparedTitle: null,
              preparedContentJson: null,
              preparedContentHtml: null,
              preparedHashtags: null,
              narrativeAngleBriefsJson: null,
              imagePlanJson: null,
              contentReadinessReportJson: null,
              contentReadinessScore: null,
              contentReadinessPublishable: false,
              errorMessage: null,
              postUrl: null,
              publishedAt: null,
            }
          : {}),
      },
    });

    if (updated.count !== 1) throw new TopicPrepareConflictError("작업 상태가 변경되었습니다. 실제 제출 결과를 먼저 확인하세요.");
    const task = await prisma.topicPostTask.findUnique({ where: { id } });
    return NextResponse.json({ success: true, data: task });
  } catch (error: unknown) {
    console.error("태스크 수정 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: error instanceof TopicPrepareConflictError ? 409 : 500 }
    );
  }
}
