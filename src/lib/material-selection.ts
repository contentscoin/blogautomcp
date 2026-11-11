import type { MaterialSummary } from "./material-summary-store";

export type MaterialSelection = Record<string, { revision: string; summaryRevision: string }>;

/** An explicit selection checks only its products. A saved list can never authorize publication. */
export async function verifyMaterialSelection(
  products: readonly MaterialSummary[], request: typeof fetch, signal?: AbortSignal,
): Promise<MaterialSelection> {
  if (!products.length || products.length > 50) throw new Error("준비된 소재를 1~50개 선택하세요.");
  const ids = [...new Set(products.map(product => product.productId))];
  if (ids.length !== products.length) throw new Error("중복된 소재 선택입니다.");
  const response = await request(`/api/materials?productIds=${encodeURIComponent(ids.join(","))}`, { cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "선택한 소재를 확인하지 못했습니다.");
  if (signal?.aborted) throw new Error("소재 선택 확인이 취소되었습니다.");
  const fresh = new Map<string, { ready?: boolean; revision?: string; summaryRevision?: string; status?: string }>(
    (result.data?.materials || []).map((material: MaterialSummary & { summaryRevision?: string }) => [material.productId, material]),
  );
  return Object.fromEntries(products.map(product => {
    const material = fresh.get(product.productId);
    if (!material?.ready || material.status !== "READY" || !/^[a-f0-9]{64}$/u.test(material.revision || "") ||
        material.summaryRevision !== product.revision) {
      throw new Error("선택하려는 소재가 변경됐거나 현재 검사에 통과하지 못했습니다. 목록을 새로고침한 뒤 다시 선택하세요.");
    }
    return [product.productId, { revision: material.revision!, summaryRevision: material.summaryRevision }];
  }));
}

export function materialSelectionMatches(selection: MaterialSelection, material: Pick<MaterialSummary, "productId" | "revision" | "ready">) {
  return Boolean(material.ready && selection[material.productId]?.summaryRevision === material.revision);
}
