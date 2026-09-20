import assert from "node:assert/strict";
import { mergeCurrentProductFeatures, mergeProductInfo, type MergeableProductInfo } from "./lib/product-info-merge";
import { getBrandLinkContentReadiness, hasUnsupportedRefillClaim } from "./lib/brandlink-content-readiness";

const name = "향좋은 아비노 고보습 민감피부 저자극 바디워시 스트레스릴리프(라벤더향), 532ml, 2개";
const fixture = (overrides: Partial<MergeableProductInfo> = {}): MergeableProductInfo => ({
  name, description: "", features: [], price: "", originalPrice: "", discountRate: "", couponInfo: "",
  deliveryInfo: "", reviewCount: "", rating: "", representativeImagePath: null, imagePaths: [],
  detailImagePaths: [], sourceImageUrls: [], finalUrl: "https://example.com/products/123", ...overrides,
});
const cached = fixture({ description: "오트 성분을 담았어요. 본품과 리필이 포함된 구성입니다.\n펌프형 용기예요.",
  features: ["구성: 본품+리필", "선택 옵션: 리필 2개", "리필을 사용할 수 있어요", "성분: 오트"] });
const live = fixture({ description: "아비노 스트레스릴리프 바디워시 라벤더향 532ml 2개", features: ["수량: 2개", "용량: 532ml"] });
const merged = mergeProductInfo(cached, live);
assert.doesNotMatch(merged.description + merged.features.join("\n"), /리필/);
assert.match(merged.description, /오트 성분/);
assert.match(merged.description, /펌프형/);
assert.ok(merged.features.includes("성분: 오트"));
assert.deepEqual(mergeCurrentProductFeatures(cached.features, [" "]), cached.features);
assert.match(mergeProductInfo(cached, fixture()).description, /리필/, "no new evidence must not erase cached data");
assert.doesNotMatch(mergeProductInfo(cached, { ...live, features: [] }).features.join(" "), /리필/);
assert.match(mergeProductInfo(cached, fixture({ features: ["구성: 본품+리필"] })).features.join(" "), /리필/);

const positive = ["본품+리필 구성입니다.", "리필을 사용할 수 있어요.", "리필이 포함되어 있어요.", "리필 2개가 들어 있어요.", "리필형입니다."];
for (const claim of positive) {
  for (const source of [name, `${name}\n리필 미포함`, `${name}\n리필은 포함되지 않습니다.`, `${name}\n리필 별도 구매`, `${name}\n리필 포함 여부 미확인`]) {
    assert.equal(hasUnsupportedRefillClaim(claim, source), true, `${claim} / ${source}`);
  }
}
for (const claim of ["리필 미포함입니다.", "리필은 포함되지 않습니다.", "리필 포함 여부를 확인하세요.", "리필이 들어 있는지는 확인되지 않았어요.", "리필을 사용할 수 없어요.", "본품+리필 구성이 아닙니다.", "리필 포함인가요?", "본품+리필을 비교해요."]) {
  assert.equal(hasUnsupportedRefillClaim(claim, name), false, claim);
}
assert.equal(hasUnsupportedRefillClaim("리필 포함입니다.", "리필 사용 가능"), true);
assert.equal(hasUnsupportedRefillClaim("리필 사용 가능해요.", "리필 사용 가능"), false);
assert.equal(hasUnsupportedRefillClaim("리필 포함입니다.", "구성: 본품+리필 1개"), false);
assert.equal(hasUnsupportedRefillClaim("본품+리필 구성입니다.", "리필 1개"), true);
assert.equal(hasUnsupportedRefillClaim("불편이 없어요. 리필 포함입니다.", name), true);
assert.equal(hasUnsupportedRefillClaim("리필이 없다고 생각했지만 리필 포함입니다.", name), true);

function codes(text: string, connectKind: "SHOPPING" | "TRAVEL" = "SHOPPING") {
  return getBrandLinkContentReadiness({ productName: name, title: name, sections: [text], hashtags: ["아비노", "바디워시", "라벤더향"],
    brandLink: "https://example.com", generationSource: "AI", hasRepresentativeImage: true, connectKind,
    sourceDescription: merged.description, sourceFeatures: merged.features }).blockers.map(blocker => blocker.code);
}
assert.ok(codes("본품+리필 구성입니다.").includes("unsupported-option-claim"));
assert.ok(!codes("본품+리필 구성입니다.", "TRAVEL").includes("unsupported-option-claim"));
for (const text of ["이번 자료에는 구매후기 원문이 없어 추천 문장을 빼는 편이 좋아요.", "후기 원문은 제공되지 않았어요.", "후기를 수집하지 않아 후기처럼 지어내지 않아요.", "후기 원문을 확인할 수 없어 사용감을 단정하지 않아요."]) {
  assert.ok(codes(text).includes("internal-guidance-leak"), text);
}
for (const text of ["후기 원문에서 끈적임이 없다는 의견을 확인했어요.", "수집된 후기에는 향이 없다는 의견이 있어요.", "후기 원문이 없지는 않아요.", "리필은 포함되지 않아요."]) {
  assert.ok(!codes(text).includes("internal-guidance-leak"), text);
}
console.log("shopping source safety regression passed");
