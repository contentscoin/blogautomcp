/** Final-publication comparison roles; never an image approval or OCR oracle. */
import { INTRINSIC_IDENTIFIER_RULE_EN, INTRINSIC_IDENTIFIER_SCHEMA, intrinsicIdentifierComparisonIssue } from "./intrinsic-identifier-comparison";
export const REFERENCE_PLANE_POLICY_VERSION = "publication-reference-plane/v3";
export const REFERENCE_PLANE_IDENTITY_QUESTION = "For this disclosed reference-guided illustration, do the candidate's sufficiently observed visible cut, seams, neckline, material, colour, construction, physical components and confirmed visible option match this exact selected primary reference without a concrete contradiction? This is visible reference fidelity, not market uniqueness, authenticity or exact-SKU certification. Title, provenance, category or missing intrinsic brand/size printing cannot answer this question by themselves. Reject actual conflicting or genuinely insufficient visible identifying structure, and judge any authenticity/size/photo-proof claim separately from the exact published text.";
export const REFERENCE_PLANE_RULE_EN = `${REFERENCE_PLANE_POLICY_VERSION} PHYSICAL REFERENCE PLANES: ${REFERENCE_PLANE_IDENTITY_QUESTION} For a reference-guided final slot, its exact mapped primaryReference is the appearance and visible-face anchor. Inspect and describe THAT numbered primary before using supplemental gallery evidence; a previous passed review is not approval. Gallery attachments remain supplemental contradiction evidence, never substitute for the mapped primary or another slot's identity reference. A shared attachment can be primary for one slot and supplemental for another; use this slot's roles only. Match the same actual physical component and surface before alleging missing intrinsic print. An inner indicator/button face, an outer branding face, an opposite housing or another colour is not the same print surface. Do not move a logo from another visible plane onto a blank primary-matching face. missing-print requires actual source-present printing on the same selected visible option/component/surface and a clearly exposed corresponding blank candidate face. A legitimate same-surface gallery detail may supply that evidence only when its selected option/component/face correspondence is established against the primary. Mere unseen, reverse, occluded or unreadable printing is not proof of absence. Distinguish present-unreadable from exposed blank: an actual small/faint mark at the corresponding source-print location is present-unreadable only when its physical part/surface and selected visible option match, identifying geometry is sufficient, the published text does not claim to read its words and no conflicting evidence remains. This does not certify the word or excuse genuinely missing ink, readable wrong branding, a changed product or unresolved visible structure. A readable conflicting candidate brand, distinguishable wrong shape or confirmed option, genuinely unresolved identity, severe defect or forbidden layout still rejects. Do not infer exact model or hidden facts from a familiar brand. The structured comparison records actual attachment indices, primary/candidate observations, the evidence observation, surface correspondence and print states; filenames, descriptions and provenance never certify those pixels. If the correspondence cannot be established, report unresolved identity honestly rather than fabricate a missing-print comparison. Never change an adverse boolean or grant acceptance from these roles.`;
export const REFERENCE_PLANE_RULE_KO = "최종 사진의 면 대응: 해당 슬롯의 정확한 주참조를 먼저 관찰하고, 갤러리는 보조 모순 근거로만 사용합니다. 공개된 연출사진의 식별 검사는 관찰 가능한 선택 원본과의 외형 충실성 검사이며, 시장의 유일성·정품·정확한 SKU를 사진으로 인증하는 검사가 아닙니다. 무지 제품도 목선·재단·봉제선·재질·색·구조·확인되는 옵션이 충분히 관찰되어 실제 일치해야 합니다. 상품명·출처·일반적인 종류만으로 통과시키지 않으며 V넥·추가 주머니·다른 조직이나 색 등 실제 차이와 식별 구조 부족은 거절합니다. 정품·사이즈를 사진이 증명한다는 본문 주장은 별도로 검수합니다. 안쪽 버튼·표시등 면과 바깥 로고 면, 반대 하우징·다른 색 옵션을 같은 인쇄 면으로 바꾸지 마세요. 표기 누락은 같은 선택 옵션·물리 부품·면에 참조 표기가 실제 있고 후보의 대응 면이 분명히 노출된 빈면일 때만 근거가 됩니다. 같은 위치에 실제 작은 표기가 있으나 읽히지 않는 상태는 빈면과 다릅니다. 형상·옵션과 표기의 위치가 일치하고 본문이 그 글자 판독을 주장하지 않으며 다른 모순이 없을 때만 이 관찰 한계를 허용하며 글자 내용은 인증하지 않습니다. 갤러리의 정당한 같은 면 상세도 주참조와의 대응을 확인한 경우만 사용합니다. 실제 다른 브랜드·형상·확정 옵션·식별 불가와 형식 결함은 계속 거절하며 불리한 판정을 바꾸지 않습니다.";

export interface ReferencePlaneContext {
  primaryReferenceImageIndex: number;
  primaryReferenceSha256: string;
  supplementalReferences: Array<{ imageIndex: number; sha256: string }>;
}
const OBJECTIONS = ["none", "missing-print", "conflicting-print", "shape", "option", "unresolved"] as const;
const REFERENCE_PRINT = ["present", "absent", "not-observed"] as const;
const CANDIDATE_PRINT = ["present", "present-unreadable", "absent-on-exposed-face", "not-observed"] as const;
const KEYS = ["primaryReferenceImageIndex", "primaryReferenceSha256", "primaryObservation", "candidateObservation", "objectionKind", "candidateIdentifierVisibility", "identifierComparisons",
  "evidenceImageIndex", "samePhysicalPart", "samePhysicalSurface", "sameSelectedVisibleOption", "referencePrintState", "candidatePrintState", "evidenceObservation", "basis"] as const;
export const REFERENCE_PLANE_COMPARISON_SCHEMA = {
  type: "object", properties: {
    candidateIdentifierVisibility: { type: "string", enum: ["legible", "unreadable", "no-intrinsic-identifiers-observed"] },
    identifierComparisons: { ...INTRINSIC_IDENTIFIER_SCHEMA, description: INTRINSIC_IDENTIFIER_RULE_EN },
    primaryReferenceImageIndex: { type: "integer", minimum: 1 }, primaryReferenceSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    primaryObservation: { type: "string", minLength: 1 }, candidateObservation: { type: "string", minLength: 1 },
    objectionKind: { type: "string", enum: OBJECTIONS }, evidenceImageIndex: { type: ["integer", "null"] },
    samePhysicalPart: { type: ["boolean", "null"] }, samePhysicalSurface: { type: ["boolean", "null"] }, sameSelectedVisibleOption: { type: ["boolean", "null"] },
    referencePrintState: { type: "string", enum: REFERENCE_PRINT }, candidatePrintState: { type: "string", enum: CANDIDATE_PRINT,
      description: "present-unreadable means an actual mark is visible at the corresponding source-print location on the same selected part/face; it never means blank or certifies any word. Use absent-on-exposed-face for a genuinely exposed blank corresponding face, not small/faint/unreadable ink." },
    evidenceObservation: { type: "string", minLength: 1 }, basis: { type: "string", minLength: 1 },
  }, required: KEYS, additionalProperties: false,
} as const;

/** Validate server-owned attachment roles and the review's own consistency.
 * This cannot determine physical surfaces from text; actual pixel QA still must.
 * Invalid grounding is a hold, never a favorable override or reroll authority. */
export function referencePlaneComparisonIssue(row: Record<string, unknown>, context: ReferencePlaneContext | null): string | null {
  if (!context) return row.referenceComparison == null ? null : "unmapped slot cannot claim a mapped reference comparison";
  const value = row.referenceComparison;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "mapped slot requires referenceComparison";
  const c = value as Record<string, unknown>;
  if (Object.keys(c).sort().join("|") !== [...KEYS].sort().join("|")) return "referenceComparison fields are missing or unexpected";
  if (c.primaryReferenceImageIndex !== context.primaryReferenceImageIndex || c.primaryReferenceSha256 !== context.primaryReferenceSha256)
    return "primary reference index/SHA does not match this exact slot";
  if (!["primaryObservation", "candidateObservation", "evidenceObservation", "basis"].every(key => typeof c[key] === "string" && String(c[key]).trim()))
    return "reference/candidate observations and comparison basis must be nonempty";
  if (!OBJECTIONS.includes(c.objectionKind as typeof OBJECTIONS[number]) || !REFERENCE_PRINT.includes(c.referencePrintState as typeof REFERENCE_PRINT[number]) ||
      !CANDIDATE_PRINT.includes(c.candidatePrintState as typeof CANDIDATE_PRINT[number]) ||
      !["samePhysicalPart", "samePhysicalSurface", "sameSelectedVisibleOption"].every(key => c[key] === null || typeof c[key] === "boolean"))
    return "referenceComparison has an invalid objection, print state or correspondence flag";
  const evidence = c.evidenceImageIndex;
  const validEvidence = Number.isInteger(evidence) && (evidence === context.primaryReferenceImageIndex ||
    context.supplementalReferences.some(reference => reference.imageIndex === evidence));
  if (evidence !== null && !validEvidence) return "evidence index is not a reference attachment for this slot";
  const identifierIssue = intrinsicIdentifierComparisonIssue(c, context);
  if (identifierIssue) return identifierIssue;
  if (c.candidatePrintState === "present-unreadable" && (c.referencePrintState !== "present" ||
      c.samePhysicalPart !== true || c.samePhysicalSurface !== true || c.sameSelectedVisibleOption !== true))
    return "present-unreadable requires an actual corresponding source mark on the same selected part/surface";
  if (c.objectionKind === "none") {
    if (row.identityMatches !== true) return "adverse identity requires its actual structured objection";
    if (c.referencePrintState === "present" && c.candidatePrintState === "absent-on-exposed-face" &&
        c.samePhysicalPart === true && c.samePhysicalSurface === true && c.sameSelectedVisibleOption === true)
      return "source-present/exposed-blank comparison cannot claim no objection";
  } else {
    if (row.identityMatches !== false) return "structured identity objection conflicts with favorable identityMatches";
    if (!validEvidence) return "identity objection must name this slot's actual reference evidence";
    if (c.objectionKind === "missing-print" && (c.samePhysicalPart !== true || c.samePhysicalSurface !== true || c.sameSelectedVisibleOption !== true ||
        c.referencePrintState !== "present" || c.candidatePrintState !== "absent-on-exposed-face"))
      return "missing-print requires the same selected physical part/surface and actual present-versus-exposed-blank evidence";
    if (c.objectionKind === "conflicting-print" && (c.referencePrintState !== "present" || c.candidatePrintState !== "present"))
      return "conflicting-print requires actual visible printing in both compared evidence and candidate";
  }
  return null;
}
