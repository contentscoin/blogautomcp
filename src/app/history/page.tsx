"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { MaterialJobProgress } from "@/components/MaterialJobProgress";

interface HistoryItem {
    id: string;
    title: string;
    status: "PUBLISHED" | "SCHEDULED" | "OUTCOME_UNKNOWN" | "FAILED";
    postUrl: string | null;
    errorMessage: string | null;
    publishedAt: string | null;
    updatedAt: string;
    memo: string | null;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

type StatusFilter = "ALL" | "SUCCESS" | "FAILED";

export default function HistoryPage() {
    const [items, setItems] = useState<HistoryItem[]>([]);
    const [pagination, setPagination] = useState<Pagination | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<StatusFilter>("ALL");
    const [page, setPage] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const requestSequence = useRef(0);

    const fetchHistory = useCallback(async () => {
        const requestId = ++requestSequence.current;
        setLoading(true);
        setItems([]);
        setPagination(null);
        setError(null);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: "10",
                status: filter,
            });

            const res = await fetch(`/api/history?${params}`);
            const data = await res.json();

            if (!res.ok || !data.success) throw new Error(data.error || "발행 기록을 읽지 못했습니다. 다시 시도하세요.");
            if (!Array.isArray(data.data?.items) || !data.data?.pagination) throw new Error("발행 기록 응답 형식이 올바르지 않습니다.");
            if (requestSequence.current === requestId) {
                setItems(data.data.items);
                setPagination(data.data.pagination);
            }
        } catch (error) {
            if (requestSequence.current === requestId) setError(error instanceof Error ? error.message : "발행 기록을 읽지 못했습니다.");
        } finally {
            if (requestSequence.current === requestId) setLoading(false);
        }
    }, [page, filter]);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return "-";
        return new Date(dateStr).toLocaleDateString("ko-KR", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            {/* 헤더 */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-xl font-bold text-slate-900">
                                📊 발행 히스토리
                            </h1>
                            <p className="text-sm text-slate-500">소재 작업 이력과 현재 발행·예약 결과</p>
                        </div>
                        <Link
                            href="/"
                            className="px-4 py-2 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                        >
                            ← 대시보드
                        </Link>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
                <MaterialJobProgress history />
                {/* 필터 */}
                <div className="flex gap-2">
                    {(["ALL", "SUCCESS", "FAILED"] as StatusFilter[]).map((status) => (
                        <button
                            key={status}
                            onClick={() => {
                                setFilter(status);
                                setPage(1);
                            }}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${filter === status
                                    ? "bg-blue-600 text-white"
                                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                                }`}
                        >
                            {status === "ALL" && "📋 전체"}
                            {status === "SUCCESS" && "✅ 성공"}
                            {status === "FAILED" && "❌ 실패"}
                        </button>
                    ))}

                    {pagination && (
                        <span className="ml-auto text-sm text-slate-500 self-center">
                            총 {pagination.total}건
                        </span>
                    )}
                </div>

                {/* 히스토리 목록 */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    {loading ? (
                        <div className="p-8 text-center text-slate-500">로딩 중...</div>
                    ) : error ? (
                        <div role="alert" className="p-8 text-center text-red-600">
                            <p>{error}</p>
                            <button type="button" onClick={() => void fetchHistory()} className="mt-3 rounded-lg border border-red-200 px-4 py-2 text-sm">다시 불러오기</button>
                        </div>
                    ) : items.length === 0 ? (
                        <div className="p-8 text-center text-slate-500">
                            발행 기록이 없습니다.
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {items.map((item) => (
                                <div
                                    key={item.id}
                                    className="p-4 hover:bg-slate-50 transition-colors"
                                >
                                    <div className="flex items-center gap-4">
                                        {/* 상태 아이콘 */}
                                        <div className="text-2xl">
                                            {item.status === "PUBLISHED" ? "✅" : item.status === "SCHEDULED" ? "📅" : item.status === "OUTCOME_UNKNOWN" ? "❔" : "❌"}
                                        </div>

                                        {/* 정보 */}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-slate-800 truncate">
                                                {item.title}
                                            </div>
                                            <div className="text-sm text-slate-500">
                                                {formatDate(item.publishedAt || item.updatedAt)}
                                                {item.memo && (
                                                    <span className="ml-2 text-slate-400">
                                                        • {item.memo}
                                                    </span>
                                                )}
                                            </div>
                                            {["FAILED", "OUTCOME_UNKNOWN"].includes(item.status) && item.errorMessage && (
                                                <div className="text-sm text-red-500 mt-1">
                                                    ⚠️ {item.errorMessage}
                                                </div>
                                            )}
                                        </div>

                                        {/* 액션 */}
                                        {item.status === "PUBLISHED" && item.postUrl && (
                                            <a
                                                href={item.postUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="px-4 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                                            >
                                                📎 글 보기
                                            </a>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 페이지네이션 */}
                {pagination && pagination.totalPages > 1 && (
                    <div className="flex justify-center gap-2">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="px-4 py-2 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            ← 이전
                        </button>
                        <span className="px-4 py-2 text-sm text-slate-600">
                            {page} / {pagination.totalPages}
                        </span>
                        <button
                            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                            disabled={page === pagination.totalPages}
                            className="px-4 py-2 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            다음 →
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
}
