import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 발행 이벤트 타입 정의
export interface PublishEvent {
    step: "init" | "scraping" | "generating" | "uploading" | "publishing" | "complete" | "error";
    progress: number;
    message: string;
    url?: string;
    error?: string;
}

// SSE 인코더
function encodeSSE(event: PublishEvent): string {
    return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    // SSE 헤더 설정
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            // 진행률 이벤트 전송 함수
            const sendEvent = (event: PublishEvent) => {
                controller.enqueue(encoder.encode(encodeSSE(event)));
            };

            try {
                // 1단계: 초기화
                sendEvent({ step: "init", progress: 0, message: "발행 준비 중..." });
                await sleep(500);

                // 2단계: 스크래핑
                sendEvent({ step: "scraping", progress: 20, message: "상품 정보 수집 중..." });
                await sleep(1500);

                // 3단계: 콘텐츠 생성
                sendEvent({ step: "generating", progress: 50, message: "AI가 리뷰 작성 중..." });
                await sleep(2000);

                // 4단계: 이미지 업로드
                sendEvent({ step: "uploading", progress: 70, message: "이미지 업로드 중..." });
                await sleep(1000);

                // 5단계: 발행
                sendEvent({ step: "publishing", progress: 90, message: "블로그에 발행 중..." });

                // 실제 발행 API 호출
                const publishRes = await fetch(`${request.nextUrl.origin}/api/brandlinks/${id}/publish`, {
                    method: "POST",
                });

                const publishData = await publishRes.json();

                if (publishData.success) {
                    sendEvent({
                        step: "complete",
                        progress: 100,
                        message: "발행 완료!",
                        url: publishData.data?.postUrl || "#"
                    });
                } else {
                    sendEvent({
                        step: "error",
                        progress: 0,
                        message: "발행 실패",
                        error: publishData.error || "알 수 없는 오류"
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
