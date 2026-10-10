import { currentMaterialLabel, type CurrentMaterialDisplay } from "../lib/material-job-display";

export function MaterialJobItemResult({ item, title, current }: {
  item: { stage: string; error?: string; errorCode?: string; scheduledDate?: string };
  title: string;
  current?: CurrentMaterialDisplay;
}) {
  const currentLabel = currentMaterialLabel(current);
  return <div className="mt-2 break-words text-sm">
    <p>{title} — {currentLabel || item.stage}{!currentLabel && item.scheduledDate ? ` (${item.scheduledDate})` : ""}</p>
    {currentLabel && current?.status === "BLOCKED" && current.blockers?.map((reason, index) => <p key={index} className="mt-1 text-xs text-amber-800">{reason}</p>)}
    {item.error ? <details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer">이 작업 당시 실패 사유{item.errorCode ? ` · ${item.errorCode}` : ""}{current?.ready ? " (이후 복구 완료)" : ""}</summary><p className="mt-1 whitespace-pre-wrap">{item.stage}: {item.error}</p></details>
      : currentLabel && <p className="mt-1 text-xs text-slate-500">이 작업 당시: {item.stage}{item.scheduledDate ? ` (${item.scheduledDate})` : ""}</p>}
  </div>;
}
