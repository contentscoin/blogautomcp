import assert from "node:assert/strict";
import {
  LIST_SYNC_DIAGNOSIS_PREFIX,
  diagnoseListSync,
  extractListItemMedia,
  readListSyncDiagnosis,
  type ListSyncCounts,
} from "./lib/brandconnect-list-diagnosis";

const base: ListSyncCounts = {
  collected: 1200, matched: 40, selectable: 30, requested: 10, registered: 10, duplicates: 0, linkFailures: 0,
  scannedCategories: 36, filters: { brand: [], promotion: [], category: [] },
};
const code = (overrides: Partial<ListSyncCounts>) => diagnoseListSync({ ...base, ...overrides });

assert.equal(code({}).code, "OK");
// 목록을 하나도 못 받으면 로그인·권한 문제로 안내한다.
const empty = code({ collected: 0, matched: 0, selectable: 0, registered: 0, scannedCategories: 0 });
assert.equal(empty.code, "NO_PRODUCTS_COLLECTED");
assert.match(empty.message, /로그인/u);
// 검색어가 훑은 범위에 없으면 검색어와 범위를 알려준다.
const filtered = code({ matched: 0, selectable: 0, registered: 0, filters: { brand: ["아하바"], promotion: [], category: [] }, widened: true });
assert.equal(filtered.code, "FILTER_MATCHED_NONE");
assert.match(filtered.message, /아하바/u);
assert.match(filtered.message, /카테고리 36개에서 상품 1200개/u);
assert.match(filtered.message, /탐색 범위를 넓혀/u);
// 전부 이미 등록된 경우와 링크 발급 실패를 구분한다.
assert.equal(code({ registered: 0, duplicates: 10 }).code, "ALL_DUPLICATES");
const links = code({ registered: 0, linkFailures: 4 });
assert.equal(links.code, "LINK_ISSUE_FAILED");
assert.match(links.message, /4건/u);
const partial = code({ registered: 3, duplicates: 5, linkFailures: 2 });
assert.equal(partial.code, "PARTIAL");
assert.match(partial.message, /요청 10개 중 3개/u);

// 로그에서 마지막 진단 줄을 읽는다. 깨진 줄과 없는 경우는 null.
const log = [
  "🌐 BrandConnect 카테고리 페이지 접속...",
  `${LIST_SYNC_DIAGNOSIS_PREFIX}${JSON.stringify(code({ registered: 0, duplicates: 10 }))}`,
  "중간 로그",
  `[12:00:01] ${LIST_SYNC_DIAGNOSIS_PREFIX}${JSON.stringify(partial)}`,
  "✅ 완료",
].join("\r\n");
assert.equal(readListSyncDiagnosis(log)?.code, "PARTIAL");
assert.equal(readListSyncDiagnosis("아무 진단 없음"), null);
assert.equal(readListSyncDiagnosis(`${LIST_SYNC_DIAGNOSIS_PREFIX}{broken`), null);
assert.equal(readListSyncDiagnosis(`${LIST_SYNC_DIAGNOSIS_PREFIX}{"code":1}`), null);

// 목록 항목의 대표 이미지·상품 주소는 있을 때만 가져온다.
assert.deepEqual(extractListItemMedia({ representativeImageUrl: "//shop-phinf.pstatic.net/a.jpg", productUrl: "https://smartstore.naver.com/x/products/1" }),
  { imageUrl: "https://shop-phinf.pstatic.net/a.jpg", productUrl: "https://smartstore.naver.com/x/products/1" });
assert.deepEqual(extractListItemMedia({ image: { url: "https://shop-phinf.pstatic.net/b.jpg" } }), { imageUrl: "https://shop-phinf.pstatic.net/b.jpg", productUrl: "" });
assert.deepEqual(extractListItemMedia({ imageUrl: "javascript:alert(1)", url: "not a url", productName: "x" }), { imageUrl: "", productUrl: "" });
console.log("brandconnect list diagnosis ok");
