import path from "node:path";

type Failure = { nodeIndex: number; assetPath: string; code: string; rejectionScope?: string; regenerationHold?: string };
type Asset = { path: string; role: "hero" | "body"; creationMethod?: string; provenance?: string; remoteGenerated?: boolean };

/** 판매페이지에서 가져와 원본 검수를 통과한 실제 상품 사진인지. */
function isSellerOriginal(asset: Asset): boolean {
  return asset.role === "body" && asset.provenance === "ORIGINAL" && asset.creationMethod === "source" && asset.remoteGenerated !== true;
}
/** 판매자 사진 위에 문구만 얹은 대표 이미지인지(생성 장면이 아님). */
function isPhotoThumbnail(asset: Asset): boolean {
  return asset.role === "hero" && asset.remoteGenerated !== true &&
    ["PHOTO_TEXT_THUMBNAIL", "ORIGINAL", "LOCKED_PRODUCT"].includes(asset.provenance || "");
}

/**
 * 쇼핑 essential 프로필의 최종 이미지 검수 분류.
 * 발행을 막는 것: 다른 상품·잘못 생성된 사진, 파일 손상·변경, 생성 이미지의 모든 지적.
 * 권고로 남기는 것:
 *  - 판매자 원본 사진·사진 썸네일에서 검수 응답이 형식 오류로 판정을 내지 못한 경우(INVALID_REVIEW).
 *    결함이 발견된 것이 아니고, 사진 자체는 선택 상품의 판매페이지 원본이다.
 *  - 판매자 원본 사진과 본문 문장의 묘사 불일치(문단 범위 SEMANTIC_REJECTION). 사진은 실제 상품이다.
 * 한 사진에 막는 지적이 하나라도 있으면 그 사진의 지적은 모두 막는 쪽에 둔다.
 */
export function partitionEssentialImageAuditFailures<T extends Failure>(failures: readonly T[], assets: readonly Asset[]): { blocking: T[]; advisories: T[] } {
  const assetOf = (failure: Failure) => assets.filter(asset => path.resolve(asset.path) === path.resolve(failure.assetPath));
  const advisory = (failure: T): boolean => {
    if (failure.nodeIndex < 0 || failure.regenerationHold) return false;
    const matches = assetOf(failure);
    if (matches.length !== 1) return false;
    const asset = matches[0];
    if (failure.code === "INVALID_REVIEW") return isSellerOriginal(asset) || isPhotoThumbnail(asset);
    if (failure.code === "SEMANTIC_REJECTION") return failure.rejectionScope === "section" && isSellerOriginal(asset);
    return false;
  };
  const blockedNodes = new Set(failures.filter(failure => !advisory(failure)).map(failure => failure.nodeIndex));
  const blocking: T[] = [], advisories: T[] = [];
  for (const failure of failures) (blockedNodes.has(failure.nodeIndex) ? blocking : advisories).push(failure);
  return { blocking, advisories };
}
