import { auditPublishImages, type PublishImageAuditOptions } from "./publish-image-audit";
import type { PostRenderNode, ResolvedPostSectionV1 } from "../../src/lib/post-composition-contract";

export interface SectionProposal { targetIndex: number; path: string; sourceSha256: string }
export interface SectionProposalTarget { sectionTitle: string; sectionBody?: string[]; imageIntent: string; sectionId?: string }

/** Bounded selection/verification: only selected pairs are audited, using exactly
 * the final publication rules. Rejected pairs cannot re-enter subsequent rounds. */
export async function auditSectionProposals<T extends SectionProposal>(options: {
  productName: string; selectedProduct?: string; targets: SectionProposalTarget[]; proposals: T[];
  select: (proposals: T[]) => T[];
  onRejected: (proposal: T, reason: string) => void;
  audit?: (options: PublishImageAuditOptions) => ReturnType<typeof auditPublishImages>;
}): Promise<T[]> {
  let remaining = options.proposals;
  const accepted = new Set<string>();
  const key = (row: T) => `${row.targetIndex}:${row.sourceSha256}`;
  for (let round = 0; round < 3; round++) {
    const selected = options.select(remaining);
    const pending = selected.filter(row => !accepted.has(key(row)));
    if (!pending.length) return selected;
    const sections: ResolvedPostSectionV1[] = [];
    const renderNodes: PostRenderNode[] = [];
    const byNode = new Map<number, T>();
    for (const row of pending) {
      const target = options.targets[row.targetIndex];
      const id = target.sectionId || `source-proposal-${row.targetIndex}`;
      sections.push({ id, title: target.sectionTitle, body: target.sectionBody || [], imageIntent: target.imageIntent,
        imagePaths: [row.path], characterCount: 0, headingStyle: "sectionTitle" });
      renderNodes.push({ kind: "heading", sectionId: id, text: target.sectionTitle });
      for (const text of target.sectionBody || []) renderNodes.push({ kind: "paragraph", sectionId: id, text });
      byNode.set(renderNodes.length, row);
      renderNodes.push({ kind: "image", sectionId: id, assetPath: row.path, role: "detail",
        altText: target.imageIntent, layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" });
    }
    const result = await (options.audit || auditPublishImages)({ productName: options.productName,
      selectedProduct: options.selectedProduct || options.productName, composition: { sections, renderNodes } });
    // 이미지 한 장의 문제(판정 형식 오류, 디코딩 불가, 누락, 과도한 세로 비율)는 그 제안만 탈락시킨다.
    // 다른 제안과 전체 재배치는 계속한다. 문맥 오류·검사 중 파일 변경만 전체를 멈춘다.
    const PER_IMAGE = new Set(["SEMANTIC_REJECTION", "INVALID_REVIEW", "INVALID_IMAGE", "MISSING_IMAGE", "LONG_IMAGE"]);
    const fatal = result.failures.find(failure => !PER_IMAGE.has(failure.code));
    if (fatal) throw new Error(`SOURCE_PROPOSAL_AUDIT_FAILED: ${fatal.code}: ${fatal.reason}`);
    for (const [nodeIndex, row] of byNode) {
      const snapshot = result.images.find(image => image.nodeIndex === nodeIndex);
      // An image rejected before hashing (undecodable/missing) has no snapshot; it is handled as a rejection below.
      if (!snapshot && result.failures.some(failure => failure.nodeIndex === nodeIndex && PER_IMAGE.has(failure.code))) continue;
      if (!snapshot || snapshot.sha256 !== row.sourceSha256)
        throw new Error("SOURCE_PROPOSAL_AUDIT_FAILED: IMAGE_CHANGED: Proposal bytes changed before final-rule audit");
    }
    const rejected = new Set<string>();
    for (const failure of result.failures) {
      const row = byNode.get(failure.nodeIndex);
      if (!row) throw new Error("SOURCE_PROPOSAL_AUDIT_FAILED: INVALID_CONTEXT: Unknown verdict target");
      rejected.add(key(row)); options.onRejected(row, failure.reason);
    }
    for (const row of pending) if (!rejected.has(key(row))) accepted.add(key(row));
    remaining = remaining.filter(row => !rejected.has(key(row)));
    if (!rejected.size) return selected;
  }
  // Exhaustion retains only previously audited assignments, never fresh proposals.
  return options.select(remaining.filter(row => accepted.has(key(row))));
}
