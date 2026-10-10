/** A current material is separate from the immutable outcome of an earlier job. */
export type CurrentMaterialDisplay = {
  productId: string; ready: boolean; status: string; blockers?: string[];
};

export function currentMaterialLabel(material?: CurrentMaterialDisplay): string | null {
  if (!material) return null;
  if (material.status === "PUBLISHED") return "현재 발행 완료";
  if (material.status === "SCHEDULED") return "현재 예약 등록 완료";
  if (material.status === "OUTCOME_UNKNOWN") return "현재 발행 결과 확인 필요";
  if (material.status === "PUBLISHING") return "현재 발행 중";
  if (material.status === "PREPARING") return "현재 소재 보완·검증 중";
  // Publish readiness, rather than a product's READY workflow flag, is authoritative.
  if (material.ready && material.status === "READY") return "현재 준비완료 · 검증·승인 완료";
  return "현재 보완 필요";
}

export function currentJobReadyCount(productIds: readonly string[], materials: readonly CurrentMaterialDisplay[]): number {
  const ready = new Set(materials.filter(material => material.ready && material.status === "READY").map(material => material.productId));
  return new Set(productIds.filter(id => ready.has(id))).size;
}
