import type { MaterialReviewWarning } from "../lib/material-review-warning";

/** This notice is outside article/image output. It is not a quality pass. */
export function MaterialReviewWarnings({ warnings }: { warnings?: readonly MaterialReviewWarning[] }) {
  if (!warnings?.length) return null;
  const suspected = warnings.some(warning => warning.kind === "suspected-omission-uncorroborated");
  return <div role="note" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
    <p className="font-semibold">{suspected ? "인쇄 누락 의심·미확정" : "인쇄 미검증"} · {warnings.length}장</p>
    <ul className="mt-1 space-y-1">{warnings.map(warning => <li key={`${warning.nodeIndex}:${warning.assetSha256}`}>사진 {warning.nodeIndex + 1}: {warning.reason}</li>)}</ul>
  </div>;
}
