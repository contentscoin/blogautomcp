import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { prepareTopicTask, TopicPrepareConflictError } from "@/services/topic-task-pipeline";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    const { id } = await params;
    const task = await prisma.topicPostTask.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: "태스크를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    await prepareTopicTask(id);

    const preparedTask = await prisma.topicPostTask.findUnique({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      data: preparedTask,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: error instanceof TopicPrepareConflictError ? 409 : 500 },
    );
  }
}
