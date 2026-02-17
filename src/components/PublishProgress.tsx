"use client";

import { useState, useEffect, useCallback } from "react";

interface PublishEvent {
    step: "init" | "scraping" | "generating" | "uploading" | "publishing" | "complete" | "error";
    progress: number;
    message: string;
    url?: string;
    scheduledDate?: string;
    error?: string;
}

interface PublishProgressProps {
    linkId: string;
    isPublishing: boolean;
    onComplete: (url?: string) => void;
    onError: (error: string) => void;
}

const STEP_ICONS: Record<string, string> = {
    init: "🔄",
    scraping: "📦",
    generating: "🤖",
    uploading: "🖼️",
    publishing: "📝",
    complete: "✅",
    error: "❌",
};

export default function PublishProgress({
    linkId,
    isPublishing,
    onComplete,
    onError,
}: PublishProgressProps) {
    const [currentEvent, setCurrentEvent] = useState<PublishEvent | null>(null);
    const [completedUrl, setCompletedUrl] = useState<string | null>(null);

    const startSSE = useCallback(() => {
        const eventSource = new EventSource(`/api/brandlinks/${linkId}/progress`);
        let finished = false;

        eventSource.onmessage = (event) => {
            try {
                const data: PublishEvent = JSON.parse(event.data);
                setCurrentEvent(data);

                if (data.step === "complete") {
                    finished = true;
                    setCompletedUrl(data.url || null);
                    onComplete(data.url);
                    eventSource.close();
                } else if (data.step === "error") {
                    finished = true;
                    onError(data.error || "알 수 없는 오류");
                    eventSource.close();
                }
            } catch (e) {
                console.error("SSE 파싱 오류:", e);
            }
        };

        eventSource.onerror = () => {
            if (finished) return;
            onError("연결이 끊어졌습니다");
            eventSource.close();
        };

        return eventSource;
    }, [linkId, onComplete, onError]);

    useEffect(() => {
        if (!isPublishing) {
            return;
        }

        const eventSource = startSSE();
        return () => eventSource.close();
    }, [isPublishing, startSSE]);

    if (!isPublishing && !completedUrl) {
        return null;
    }

    return (
        <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            {currentEvent && (
                <div className="flex items-center gap-3">
                    {/* 아이콘 */}
                    <span className="text-2xl">
                        {STEP_ICONS[currentEvent.step] || "🔄"}
                    </span>

                    {/* 상태 텍스트 */}
                    <div className="flex-1">
                        <div className="text-sm font-medium text-slate-700">
                            {currentEvent.message}
                        </div>

                        {/* 프로그레스바 */}
                        {currentEvent.step !== "complete" && currentEvent.step !== "error" && (
                            <div className="mt-1 w-full bg-slate-200 rounded-full h-2">
                                <div
                                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                                    style={{ width: `${currentEvent.progress}%` }}
                                />
                            </div>
                        )}

                        {/* 완료 시 URL */}
                        {currentEvent.step === "complete" && currentEvent.url && (
                            <a
                                href={currentEvent.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-block text-sm text-blue-600 hover:underline"
                            >
                                📎 발행된 글 보기 →
                            </a>
                        )}

                        {/* 에러 메시지 */}
                        {currentEvent.step === "error" && (
                            <div className="mt-1 text-sm text-red-600">
                                {currentEvent.error}
                            </div>
                        )}
                    </div>

                    {/* 진행률 표시 */}
                    {currentEvent.step !== "complete" && currentEvent.step !== "error" && (
                        <span className="text-sm text-slate-500">
                            {currentEvent.progress}%
                        </span>
                    )}
                </div>
            )}

            {/* 완료 후 URL 유지 */}
            {!currentEvent && completedUrl && (
                <div className="flex items-center gap-3">
                    <span className="text-2xl">✅</span>
                    <div className="flex-1">
                        <div className="text-sm font-medium text-green-700">발행 완료!</div>
                        <a
                            href={completedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-block text-sm text-blue-600 hover:underline"
                        >
                            📎 발행된 글 보기 →
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
}
