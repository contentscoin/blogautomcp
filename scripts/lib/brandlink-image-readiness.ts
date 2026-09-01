import {
  getPostCompositionContract,
  type BrandConnectKind,
} from "../../src/lib/post-composition-contract";

const GUARANTEED_GENERATED_IMAGE_COUNT = 1;

export function minimumStoredSourceImageCount(connectKind: BrandConnectKind): number {
  const contract = getPostCompositionContract(connectKind);
  return Math.max(1, contract.targetImages.min - GUARANTEED_GENERATED_IMAGE_COUNT);
}

export function shouldRefreshStoredImages(
  connectKind: BrandConnectKind,
  storedImageCount: number,
): boolean {
  return storedImageCount < minimumStoredSourceImageCount(connectKind);
}

export function hasSufficientVisualDraftEvidence(input: {
  connectKind: BrandConnectKind;
  sourceImageCount: number;
  materializedImageCount: number;
  detailImageCount: number;
}): boolean {
  if (input.connectKind !== "SHOPPING") return false;
  if (input.detailImageCount > 0) return true;
  const minimumImages = minimumStoredSourceImageCount(input.connectKind);
  return (
    input.sourceImageCount >= minimumImages &&
    input.materializedImageCount >= minimumImages
  );
}

export function bodyImageCapacity(totalImageMax: number, hasThumbnail: boolean): number {
  return Math.max(1, totalImageMax - (hasThumbnail ? 1 : 0));
}
