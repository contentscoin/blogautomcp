"use client";

import { useEffect, useState } from "react";
import { createSavedDraftReviewQueue } from "../lib/saved-draft-review-queue";
import { getDraftApprovalBlockers } from "../app/draft-approval-ui";

const queue = createSavedDraftReviewQueue();

export default function SavedDraftAutoReview({ id, revision, enabled }: {
  id: string; revision: string; enabled: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; text: string; error?: boolean }>();
  const key = `${id}:${revision}`;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void queue.run(key, async () => {
      const response = await fetch(`/api/brandlinks/${encodeURIComponent(id)}/draft`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recheck" }),
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success || !payload.rechecked || !payload.data?.approval) {
        throw new Error(payload.error || "재검수 결과를 확인하지 못했습니다.");
      }
      const blockers = getDraftApprovalBlockers(payload.data);
      return payload.data.approval.canApprove
        ? "검수 완료 · 승인 가능"
        : `검수 완료 · 보완 필요: ${blockers.join(" / ") || "승인 조건 미충족"}`;
    }).then(text => { if (active) setResult({ key, text }); })
      .catch(error => { if (active) setResult({ key, text: `검수 실패: ${error.message}`, error: true }); });
    return () => { active = false; };
  }, [id, key, enabled, attempt]);
  const current = result?.key === key ? result : undefined;
  return <div className="mt-1 max-w-xs whitespace-normal text-[11px] font-semibold text-amber-700" role="status">
    {current?.text || (enabled ? "자동 검수 처리 중" : "저장 원고 · 현재 상태에서 검수 보류")}
    {current?.error && enabled && <button className="ml-1 underline" onClick={() => {
      queue.retry(key); setResult(undefined); setAttempt(value => value + 1);
    }}>재검수</button>}
  </div>;
}
