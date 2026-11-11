import { currentMaterialLabel, type CurrentMaterialDisplay } from "../lib/material-job-display";

export function MaterialJobItemResult({ item, title, current, jobKind }: {
  item: { stage: string; status?: string; error?: string; errorCode?: string; scheduledDate?: string };
  title: string;
  current?: CurrentMaterialDisplay;
  jobKind?: string;
}) {
  const publicationFailure = jobKind === "publish" || item.errorCode === "PUBLISH_FAILED" ||
    `${item.errorCode || ""} ${item.error || ""} ${item.stage}`.includes("EDITOR_BODY_SCOPE");
  const publicationConfirmed = current?.status === "PUBLISHED" || current?.status === "SCHEDULED";
  const publicationUncertain = current?.status === "OUTCOME_UNKNOWN" ||
    (!publicationConfirmed && (item.status === "outcome_unknown" || item.errorCode === "OUTCOME_UNKNOWN"));
  const retryPublication = publicationFailure && !publicationUncertain && current?.ready && current.status === "READY";
  const currentLabel = publicationUncertain ? "현재 발행 결과 확인 필요" : retryPublication
    ? `${current.verification?.mode === "saved-summary" ? "저장된 검사 기준 " : ""}소재 준비완료 · 발행 재시도 필요`
    : currentMaterialLabel(current);
  const recovered = publicationUncertain ? false : publicationFailure ? publicationConfirmed : current?.ready;
  return <div className="mt-2 break-words text-sm">
    <p>{title} — {currentLabel || item.stage}{!currentLabel && item.scheduledDate ? ` (${item.scheduledDate})` : ""}</p>
    {(item.error || item.errorCode || (currentLabel && current?.status === "BLOCKED" && current.blockers?.length)) ? <details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer">실패 상세 보기{recovered ? " (이후 복구 완료)" : ""}</summary>
      {current?.status === "BLOCKED" && current.preparationDiagnostics?.nextAction?.instruction && <p className="mt-1 whitespace-pre-wrap">다음 조치: {current.preparationDiagnostics.nextAction.instruction}</p>}
      {currentLabel && current?.status === "BLOCKED" && current.blockers?.map((reason, index) => <p key={index} className="mt-1 whitespace-pre-wrap text-amber-800">{reason}</p>)}
      {(item.error || item.errorCode) && <p className="mt-1 whitespace-pre-wrap">이 작업 당시: {item.stage}{item.errorCode ? ` · ${item.errorCode}` : ""}{item.error ? `: ${item.error}` : ""}</p>}
    </details>
      : currentLabel && <p className="mt-1 text-xs text-slate-500">이 작업 당시: {item.stage}{item.scheduledDate ? ` (${item.scheduledDate})` : ""}</p>}
  </div>;
}
