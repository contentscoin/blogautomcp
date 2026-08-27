import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRemoteActivation } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 발행 이벤트 타입 정의
export interface PublishEvent {
    step: "init" | "scraping" | "generating" | "uploading" | "publishing" | "complete" | "error";
    progress: number;
    message: string;
    url?: string;
    scheduledDate?: string;
    error?: string;
}

const POLL_INTERVAL_MS = 1500;
const MAX_STREAM_MS = 15 * 60 * 1000;

// SSE 인코더
function encodeSSE(event: PublishEvent): string {
    return `data: ${JSON.stringify(event)}\n\n`;
}

function formatScheduledDateText(raw: Date | string): string {
    if (typeof raw === "string") {
        const normalized = raw.trim();
        const plainDate = normalized.match(/^(\d{4}-\d{2}-\d{2})$/);
        if (plainDate) return plainDate[1];

        const isoDate = normalized.match(/^(\d{4}-\d{2}-\d{2})T/);
        if (isoDate) return isoDate[1];

        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) return "";
        return parsed.toISOString().slice(0, 10);
    }

    if (Number.isNaN(raw.getTime())) return "";
    return raw.toISOString().slice(0, 10);
}

function mapStatusToEvent(
    status: string,
    url?: string | null,
    errorMessage?: string | null,
    scheduledPublishAt?: Date | string | null
): PublishEvent {
    switch (status) {
        case "PUBLISHING":
            return {
                step: "publishing",
                progress: 75,
                message: "자동 발행 진행 중...",
            };
        case "SCHEDULED": {
            const scheduledDate = scheduledPublishAt
                ? formatScheduledDateText(scheduledPublishAt)
                : "";
            return {
                step: "complete",
                progress: 100,
                message: scheduledDate
                    ? `예약 발행 등록 완료 (${scheduledDate})`
                    : "예약 발행 등록 완료!",
                ...(scheduledDate ? { scheduledDate } : {}),
            };
        }
        case "PUBLISHED":
            return {
                step: "complete",
                progress: 100,
                message: "발행 완료!",
                url: url || "#",
            };
        case "FAILED":
            return {
                step: "error",
                progress: 0,
                message: "발행 실패",
                error: errorMessage || "알 수 없는 오류",
            };
        case "READY":
        default:
            return {
                step: "init",
                progress: 5,
                message: "발행 대기 중...",
            };
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const activationError = requireRemoteActivation(request);
    if (activationError) return activationError;
    const { id } = await params;

    // SSE 헤더 설정
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            let closed = false;
            // 진행률 이벤트 전송 함수
            const sendEvent = (event: PublishEvent) => {
                if (closed) return;
                controller.enqueue(encoder.encode(encodeSSE(event)));
            };

            try {
                const startedAt = Date.now();
                let lastFingerprint = "";

                while (Date.now() - startedAt < MAX_STREAM_MS) {
                    if (request.signal.aborted) {
                        break;
                    }

                    const link = await prisma.brandLink.findUnique({
                        where: { id },
                        select: { status: true, postUrl: true, errorMessage: true, scheduledPublishAt: true },
                    });

                    if (!link) {
                        sendEvent({
                            step: "error",
                            progress: 0,
                            message: "발행 대상을 찾을 수 없습니다.",
                            error: "링크가 삭제되었거나 존재하지 않습니다.",
                        });
                        break;
                    }

                    const fingerprint = [
                        link.status,
                        link.postUrl ?? "",
                        link.scheduledPublishAt?.toISOString() ?? "",
                        link.errorMessage ?? "",
                    ].join("|");

                    if (fingerprint !== lastFingerprint) {
                        sendEvent(
                            mapStatusToEvent(
                                link.status,
                                link.postUrl,
                                link.errorMessage,
                                link.scheduledPublishAt
                            )
                        );
                        lastFingerprint = fingerprint;
                    }

                    if (link.status === "PUBLISHED" || link.status === "SCHEDULED" || link.status === "FAILED") {
                        break;
                    }

                    await sleep(POLL_INTERVAL_MS);
                }

                if (Date.now() - startedAt >= MAX_STREAM_MS) {
                    sendEvent({
                        step: "error",
                        progress: 0,
                        message: "발행 대기 시간 초과",
                        error: "진행 상태 확인 시간이 초과되었습니다.",
                    });
                }
            } catch (error) {
                sendEvent({
                    step: "error",
                    progress: 0,
                    message: "발행 중 오류 발생",
                    error: error instanceof Error ? error.message : "알 수 없는 오류"
                });
            } finally {
                closed = true;
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
        },
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
