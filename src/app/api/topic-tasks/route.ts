import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { unstable_noStore as noStore } from "next/cache";
import { requireAdminApiKey } from "@/lib/api-auth";
import {
  prepareTopicTask,
  TopicPrepareConflictError,
  TOPIC_CRAFT_CATEGORIES,
} from "@/services/topic-task-pipeline";

export const dynamic = "force-dynamic";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

interface CreateTopicTaskRequest {
  topic?: string;
  keywords?: string;
  type?: string;
  topicCraftCategory?: string | null;
  categoryNo?: string | null;
  memo?: string;
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

// GET: 전체 주제 포스팅 태스크 조회
export async function GET() {
  try {
    noStore();
    const tasks = await prisma.topicPostTask.findMany({
      orderBy: { createdAt: "desc" },
    });

    const draftIds = Array.from(
      new Set(tasks.map((task) => task.selectedDraftId).filter((value): value is string => Boolean(value))),
    );
    const drafts =
      draftIds.length > 0
        ? await prisma.topicDraft.findMany({
            where: { id: { in: draftIds } },
            select: {
              id: true,
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
        : [];
    const draftImageMap = new Map(drafts.map((draft) => [draft.id, draft.images]));
    const hydratedTasks = tasks.map((task) => ({
      ...task,
      preparedImages: task.selectedDraftId ? draftImageMap.get(task.selectedDraftId) ?? [] : [],
    }));

    return NextResponse.json({ success: true, data: hydratedTasks });
  } catch (error: unknown) {
    console.error("주제 포스팅 태스크 조회 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// POST: 주제 포스팅 태스크 추가
export async function POST(request: NextRequest) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    const body = (await request.json()) as CreateTopicTaskRequest;
    const {
      topic,
      keywords,
      type,
      topicCraftCategory,
      categoryNo: rawCategoryNo,
      memo,
      scheduledPublishAt,
    } = body;
    const hasCategoryNo = Object.prototype.hasOwnProperty.call(body, "categoryNo");

    if (!topic?.trim()) {
      return NextResponse.json(
        { success: false, error: "주제가 필요합니다." },
        { status: 400 }
      );
    }

    const categoryNo = normalizeCategoryNo(rawCategoryNo);
    if (hasCategoryNo && categoryNo === undefined) {
      return NextResponse.json(
        { success: false, error: "게시판 번호(categoryNo)는 숫자 문자열이어야 합니다." },
        { status: 400 }
      );
    }

    const normalizedTopicCraftCategory =
      typeof topicCraftCategory === "string" && topicCraftCategory.trim().length > 0
        ? topicCraftCategory.trim()
        : null;
    if (
      normalizedTopicCraftCategory &&
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
    if (scheduledPublishAt && /^\d{4}-\d{2}-\d{2}$/.test(scheduledPublishAt.trim())) {
      parsedScheduledDate = new Date(`${scheduledPublishAt.trim()}T00:00:00.000Z`);
    }

    const task = await prisma.topicPostTask.create({
      data: {
        topic: topic.trim(),
        keywords: keywords?.trim() || null,
        type: type?.trim() || "정보성",
        topicCraftCategory: normalizedTopicCraftCategory,
        memo: memo || null,
        categoryNo: categoryNo ?? null,
        scheduledPublishAt: parsedScheduledDate,
        status: "READY",
        pipelineStage: "READY",
      },
    });

    try {
      await prepareTopicTask(task.id);
      const preparedTask = await prisma.topicPostTask.findUnique({
        where: { id: task.id },
      });

      return NextResponse.json({ success: true, data: preparedTask ?? task });
    } catch (prepareError: unknown) {
      const failedTask = await prisma.topicPostTask.findUnique({
        where: { id: task.id },
      });

      return NextResponse.json(
        {
          success: false,
          error: getErrorMessage(prepareError),
          data: failedTask ?? task,
        },
        { status: prepareError instanceof TopicPrepareConflictError ? 409 : 500 }
      );
    }
  } catch (error: unknown) {
    console.error("주제 포스팅 태스크 추가 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
