import assert from "node:assert/strict";
import {
  isUsableBodyUploadImageDimension,
} from "./lib/product-image-selection";
import {
  bodyImageCapacity,
  minimumStoredSourceImageCount,
  shouldRefreshStoredImages,
} from "./lib/brandlink-image-readiness";

assert.equal(
  isUsableBodyUploadImageDimension(640, 480, "TRAVEL"),
  true,
  "여행 판매페이지의 640x480 실사 사진을 본문 이미지로 허용해야 합니다.",
);
assert.equal(
  isUsableBodyUploadImageDimension(640, 480, "SHOPPING"),
  false,
  "쇼핑 본문 이미지의 기존 500px 최소변 기준은 유지해야 합니다.",
);
assert.equal(
  isUsableBodyUploadImageDimension(758, 365, "TRAVEL"),
  false,
  "지나치게 납작한 여행 배너는 계속 제외해야 합니다.",
);
assert.equal(minimumStoredSourceImageCount("TRAVEL"), 17);
assert.equal(minimumStoredSourceImageCount("SHOPPING"), 8);
assert.equal(shouldRefreshStoredImages("TRAVEL", 1), true);
assert.equal(shouldRefreshStoredImages("TRAVEL", 16), true);
assert.equal(shouldRefreshStoredImages("TRAVEL", 17), false);
assert.equal(shouldRefreshStoredImages("SHOPPING", 7), true);
assert.equal(shouldRefreshStoredImages("SHOPPING", 8), false);
assert.equal(bodyImageCapacity(39, true), 38);
assert.equal(bodyImageCapacity(39, false), 39);

console.log(JSON.stringify({
  ok: true,
  travel640x480: true,
  travelStoredMinimum: minimumStoredSourceImageCount("TRAVEL"),
  shoppingStoredMinimum: minimumStoredSourceImageCount("SHOPPING"),
  travelBodyCapacityWithThumbnail: bodyImageCapacity(39, true),
}));
