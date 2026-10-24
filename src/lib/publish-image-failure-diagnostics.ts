import type { PublishImageAuditFailure } from "../../scripts/lib/publish-image-audit";
import type { ResolvedPostDocumentV1 } from "./post-composition-contract";

export type DiagnosticImageAuditFailure = PublishImageAuditFailure & { sectionId?: string | null };

/** Bind diagnostic sections to the exact audited image node, never to model text. */
export function imageAuditFailureSections(composition: Pick<ResolvedPostDocumentV1, "renderNodes">,
  failures: readonly PublishImageAuditFailure[]): DiagnosticImageAuditFailure[] {
  return failures.map((input) => {
    const { sectionId: _previousSection, ...failure } = input as DiagnosticImageAuditFailure;
    void _previousSection;
    const node = Number.isSafeInteger(failure.nodeIndex) && failure.nodeIndex >= 0
      ? composition.renderNodes[failure.nodeIndex] : undefined;
    return { ...failure, ...(node?.kind === "image" && node.assetPath === failure.assetPath
      ? { sectionId: node.sectionId } : {}) };
  });
}
