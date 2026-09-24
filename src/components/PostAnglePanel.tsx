"use client";

import { useCallback, useEffect, useState } from "react";

interface AngleMember {
  id: string;
  angle: string;
  label: string;
  status: string;
  postUrl: string | null;
  isRoot: boolean;
}

interface AngleSuggestion {
  id: string;
  label: string;
  goal: string;
  available: boolean;
  reason: string;
  recommended: boolean;
  existing: boolean;
}

interface AngleFamilyView {
  rootId: string;
  connectKind: "SHOPPING" | "TRAVEL";
  members: AngleMember[];
  suggestions: AngleSuggestion[];
}

const STATUS_LABELS: Record<string, string> = {
  READY: "작성 전·초안",
  DRAFTING: "초안 작성중",
  PUBLISHING: "발행중",
  SCHEDULED: "예약됨",
  PUBLISHED: "발행됨",
  FAILED: "실패",
  OUTCOME_UNKNOWN: "결과 확인 필요",
};

/**
 * 한 상품의 포스팅 주제(전체 리뷰 + 주제 글)를 보여주고, 추천 주제로 새 글을 만든다.
 * 근거가 부족한 주제는 비활성으로 이유와 함께 보여준다.
 */
export default function PostAnglePanel({
  linkId,
  productName,
  onClose,
  onCreated,
}: {
  linkId: string;
  productName: string;
  onClose: () => void;
  onCreated: (newLinkId: string) => void | Promise<void>;
}) {
  const [view, setView] = useState<AngleFamilyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAngle, setBusyAngle] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/brandlinks/${linkId}/angles`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "포스팅 주제를 불러오지 못했습니다.");
      setView(payload.data as AngleFamilyView);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "포스팅 주제를 불러오지 못했습니다.");
    }
  }, [linkId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (angle: string) => {
    setBusyAngle(angle);
    setError(null);
    try {
      const response = await fetch(`/api/brandlinks/${linkId}/angles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ angle }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "주제 글을 만들지 못했습니다.");
      await onCreated(payload.data.id as string);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "주제 글을 만들지 못했습니다.");
    } finally {
      setBusyAngle(null);
    }
  };

  const topicSuggestions = view?.suggestions.filter((item) => item.id !== "full-review") ?? [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="post-angle-title">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 id="post-angle-title" className="text-lg font-bold text-slate-900">포스팅 주제</h2>
            <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">{productName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">닫기</button>
        </div>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4">
          <p className="text-sm text-slate-600">
            한 상품으로 전체 리뷰 1편과 특정 주제 글을 여러 편 쓸 수 있어요. 글마다 대표 검색어·소제목·이미지를 다르게 잡고,
            같은 상품 글끼리는 예약일을 이틀 이상 띄웁니다.
          </p>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {!view && !error && <p className="text-sm text-slate-500">불러오는 중…</p>}

          {view && (
            <>
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-800">작성된 글</h3>
                <ul className="space-y-1.5">
                  {view.members.map((member) => (
                    <li key={member.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-medium text-slate-800">{member.isRoot ? "전체 리뷰" : member.label}</span>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        {STATUS_LABELS[member.status] || member.status}
                        {member.postUrl && (
                          <a href={member.postUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">발행 글</a>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-800">주제 글 추가</h3>
                {topicSuggestions.length === 0 && <p className="text-sm text-slate-500">추가할 수 있는 주제가 없습니다.</p>}
                {topicSuggestions.length > 0 && topicSuggestions.every((item) => !item.available) && (
                  <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                    확인된 상품 정보가 부족해 주제 글을 만들 수 없습니다. 전체 리뷰 원고를 먼저 작성하면 상세페이지 정보가 수집되어 주제를 고를 수 있어요.
                  </p>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {topicSuggestions.map((item) => {
                    const disabled = !item.available || item.existing || busyAngle !== null;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => void create(item.id)}
                        title={item.available ? item.goal : `근거 부족: ${item.reason}`}
                        className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed ${
                          item.recommended
                            ? "border-indigo-300 bg-indigo-50 hover:bg-indigo-100"
                            : "border-slate-200 hover:bg-slate-50"
                        } ${!item.available || item.existing ? "opacity-50" : ""}`}
                      >
                        <span className="flex items-center gap-1.5 font-semibold text-slate-800">
                          {item.label}
                          {item.recommended && <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">추천</span>}
                          {item.existing && <span className="text-[11px] font-normal text-slate-500">작성됨</span>}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                          {busyAngle === item.id ? "주제 글을 만들고 원고 작성을 시작합니다…" : item.available ? item.goal : `근거 부족: ${item.reason}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
