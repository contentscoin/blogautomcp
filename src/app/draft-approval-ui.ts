import { isDraftEditorialQualityPassed } from "../lib/brand-post-quality-display";

export function getDraftRecheckError(payload: { code?: string; error?: string }, productId: string): string {
  const reason = payload.error || "품질 재검사 실패";
  if (payload.code !== "QC_SOURCE_REQUIRED") return reason;
  return `${reason} 연결된 ChatGPT 또는 작업 담당자에게 상품 ID ${productId}의 원본 상품 URL과 상품 신원을 확인하고 저장 출처 컨텍스트를 복구해 달라고 요청하세요. 복구 후 ‘최신 기준 재검사’를 다시 누르세요. 초안 본문을 출처로 대체하지 마세요. 출처 수집이나 원고 재생성은 자동 실행되지 않습니다.`;
}

type DraftStatus = {
  contentQuality?: { canPublish: boolean; reason: string | null; score?: number; quality?: { score: number; passScore?: number; categories?: Array<{ key: string; label: string; status: string; notes?: string[] }> }; blockers?: Array<{ code: string; tier: string; reason: string }>; signals: Array<{ key: string; label: string; status: string }> } | null;
  composition?: { qualityReport: { preset: string; canAutoPublish: boolean; blockers: string[] } };
  imageSlots?: Array<{ title: string; generationMissing: number }>;
  imageGeneration?: { status: string; remaining: number };
};

// Presentation only: the approval endpoint remains the authority.
export function getDraftApprovalBlockers(draft: DraftStatus): string[] {
  const blockers: string[] = [];
  if (draft.imageGeneration?.status === "running") blockers.push("이미지 생성 작업이 진행 중입니다.");
  for (const slot of draft.imageSlots || []) {
    if (slot.generationMissing > 0) blockers.push(`이미지 · ${slot.title}: 생성 이미지 ${slot.generationMissing}장 필요`);
  }
  if (draft.imageGeneration && draft.imageGeneration.remaining > 0 && !draft.imageSlots?.some((slot) => slot.generationMissing > 0)) {
    blockers.push(`이미지 · ${draft.imageGeneration.remaining}장 남음`);
  }
  const report = draft.composition?.qualityReport;
  if (report?.preset === "PREMIUM") {
    if (!isDraftEditorialQualityPassed(draft.contentQuality)) {
      const failures = draft.contentQuality?.signals.filter((signal) => signal.status === "fail" && signal.key !== "composition-quality") || [];
      blockers.push(...(failures.length ? failures.map((signal) => `원고 · ${signal.label}`) : [draft.contentQuality?.reason || "원고 품질검사 결과가 없거나 통과하지 못했습니다."]));
    }
    if (!report.canAutoPublish) blockers.push(...(report.blockers.length ? report.blockers : ["구성·이미지 검사를 통과하지 못했습니다."]));
  }
  return [...new Set(blockers)];
}

export function getRepairStatus(repair?: { attempted: boolean; applied: boolean; beforeScore: number; afterScore: number } | null): string {
  if (!repair?.attempted) return "자동 보강 미시도";
  if (!repair.applied) return "보강을 시도했으나 변경이 반영되지 않았습니다";
  return `보강 반영 · ${repair.beforeScore} → ${repair.afterScore}점 · 승인 조건은 별도 확인`;
}
