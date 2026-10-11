import { currentMaterialLabel, type CurrentMaterialDisplay } from "../lib/material-job-display";

export function MaterialJobItemResult({ item, title, current }: {
  item: { stage: string; error?: string; errorCode?: string; scheduledDate?: string };
  title: string;
  current?: CurrentMaterialDisplay;
}) {
  const currentLabel = currentMaterialLabel(current);
  return <div className="mt-2 break-words text-sm">
    <p>{title} — {currentLabel || item.stage}{!currentLabel && item.scheduledDate ? ` (${item.scheduledDate})` : ""}</p>
    {(item.error || (currentLabel && current?.status === "BLOCKED" && current.blockers?.length)) ? <details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer">실패 상세 보기{current?.ready ? " (이후 복구 완료)" : ""}</summary>
      {currentLabel && current?.status === "BLOCKED" && current.blockers?.map((reason, index) => <p key={index} className="mt-1 whitespace-pre-wrap text-amber-800">{reason}</p>)}
      {item.error && <p className="mt-1 whitespace-pre-wrap">이 작업 당시: {item.stage}{item.errorCode ? ` · ${item.errorCode}` : ""}: {item.error}</p>}
    </details>
      : currentLabel && <p className="mt-1 text-xs text-slate-500">이 작업 당시: {item.stage}{item.scheduledDate ? ` (${item.scheduledDate})` : ""}</p>}
  </div>;
}
