import path from "node:path";
import { readProductPhotoSource } from "./product-photo-provenance";
import { isShoppingFactCardPath } from "./shopping-fact-card-rule";

/** Stored layout receipts cannot bypass the current natural-photo policy. */
export function shoppingImageFormatIssue(asset: {
  path: string;
  provenance?: string;
  creationMethod?: string;
}, thumbnail: boolean): string | null {
  const source = readProductPhotoSource(asset.path);
  if (asset.provenance === "EDITORIAL_CARD" || source?.provenance === "EDITORIAL_CARD" || isShoppingFactCardPath(asset.path)) {
    return "설명 카드·프레임 합성은 사용할 수 없습니다. 상품이 자연스럽게 보이는 사진으로 다시 준비하세요.";
  }
  if (thumbnail) return null;
  if (/^collage[_-]/iu.test(path.basename(asset.path))) {
    return "본문에는 콜라주 대신 한 파일에 한 장면이 담긴 사진을 사용하세요.";
  }
  if (asset.provenance === "PHOTO_TEXT_THUMBNAIL" || source?.provenance === "PHOTO_TEXT_THUMBNAIL" || asset.creationMethod === "local-composite") {
    return "본문 사진에는 제목·설명·프레임을 합성할 수 없습니다. 큰 제목은 대표 썸네일에만 사용하세요.";
  }
  if (asset.creationMethod === "source-with-generated-background" || asset.provenance === "GENERATED_BACKGROUND" || asset.creationMethod === "remote-generated") {
    return "이전 합성·생성 방식의 본문 이미지입니다. 상품 원본을 첨부한 자연스러운 단일 사진 생성과 새 검수가 필요합니다.";
  }
  return null;
}
