import assert from "node:assert/strict";
import { chooseProductName, isPromotionOnlyProductName } from "./lib/product-name-identity";

assert.equal(isPromotionOnlyProductName("국내생산 100% 3년연속 브랜드 대상 수상"), true);
assert.equal(chooseProductName(["국내생산 100% 3년연속 브랜드 대상 수상", "유토렉스 칫솔살균기 UTC-100"]), "유토렉스 칫솔살균기 UTC-100");
assert.equal(chooseProductName(["지티스 GT-037KR", "무료배송"]), "지티스 GT-037KR");
assert.equal(chooseProductName(["국내생산 100% 유토렉스 칫솔살균기"]), "국내생산 100% 유토렉스 칫솔살균기");
assert.equal(chooseProductName(["무료배송", "네이버", ""]), "");
assert.equal(chooseProductName(["구조화된 상품명 AB-123", "홍보 제목"]), "구조화된 상품명 AB-123");
console.log("PASS product name precedence, promotion rejection, model preservation");
