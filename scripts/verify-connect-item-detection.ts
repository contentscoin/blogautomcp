/**
 * 커넥트 목록 응답 구조 추론 검증.
 *
 * 여행커넥트 계약은 실제 사이트 없이는 확인할 수 없지만, 이미 알고 있는
 * 쇼핑커넥트 계약(`data[]` / `productName` / `discountedSalePrice` ...)을
 * 추론기가 그대로 복원하는지는 확인할 수 있다. 그래서 아래 1번 시나리오가
 * 이 추론기의 핵심 근거다.
 *
 *   npm run test:connect-detection
 */

import { findItemArrays, detectFieldMap, normalizeConnectItems, readArrayAtPath } from "../src/lib/connect-item";
import { pickBestListResponse } from "../src/lib/travel-connect-adapter";
import fs from "fs";
import path from "path";

let failures = 0;

function check(label: string, condition: boolean, extra?: unknown) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`, condition ? "" : JSON.stringify(extra));
  if (!condition) failures += 1;
}

// 1. Shopping-shaped payload (the known contract) — detection must reproduce it.
const shopping = {
  data: Array.from({ length: 12 }, (_, i) => ({
    id: 1000 + i,
    productName: `테스트 상품 ${i}`,
    storeName: `스토어${i}`,
    salePrice: 19900 + i,
    discountedSalePrice: 15900 + i,
    representImageUrl: `https://shop-phinf.pstatic.net/img${i}.jpg`,
    badges: [{ text: "무료배송" }, { text: "쿠폰" }],
  })),
  totalCount: 12,
};
const shoppingBest = findItemArrays(shopping)[0];
check("shopping: items path is $.data", shoppingBest?.path === "$.data", shoppingBest?.path);
const shoppingMap = detectFieldMap(shoppingBest.rows)!;
check("shopping: name key", shoppingMap.name === "productName", shoppingMap);
check("shopping: id key", shoppingMap.id === "id", shoppingMap);
check("shopping: store key", shoppingMap.storeName === "storeName", shoppingMap);
check("shopping: price prefers discounted", shoppingMap.price === "discountedSalePrice", shoppingMap);
check("shopping: image key", shoppingMap.imageUrl === "representImageUrl", shoppingMap);
const shoppingItems = normalizeConnectItems(shoppingBest.rows, shoppingMap);
check("shopping: 12 items", shoppingItems.length === 12, shoppingItems.length);
check("shopping: id stringified", shoppingItems[0].externalItemId === "1000", shoppingItems[0]);

// 2. Travel-shaped payload with different key names, nested array, and decoy arrays.
const travel = {
  result: {
    filters: [{ code: "A", label: "국내" }, { code: "B", label: "해외" }],
    page: { number: 0, size: 20 },
    contents: Array.from({ length: 8 }, (_, i) => ({
      packageId: `PKG-${i}`,
      packageName: `제주 3박4일 자유여행 ${i}`,
      partnerName: `여행사${i}`,
      lowestPrice: 289000 + i * 1000,
      thumbnailUrl: `https://travel-phinf.pstatic.net/t${i}.jpg`,
      landingUrl: `https://brandconnect.naver.com/travel/${i}`,
      themeName: i % 2 === 0 ? "휴양" : "액티비티",
      benefitList: ["쿠폰 할인", "무료배송"],
    })),
  },
};
const travelCandidates = findItemArrays(travel);
const travelBest = travelCandidates[0];
check("travel: items path is $.result.contents", travelBest?.path === "$.result.contents", travelCandidates.map((c) => `${c.path}:${c.score}`));
const travelMap = detectFieldMap(travelBest.rows)!;
check("travel: name key", travelMap.name === "packageName", travelMap);
check("travel: id key", travelMap.id === "packageId", travelMap);
check("travel: store key", travelMap.storeName === "partnerName", travelMap);
check("travel: price key", travelMap.price === "lowestPrice", travelMap);
check("travel: image key", travelMap.imageUrl === "thumbnailUrl", travelMap);
check("travel: link key", travelMap.linkUrl === "landingUrl", travelMap);
const travelItems = normalizeConnectItems(travelBest.rows, travelMap);
check("travel: 8 items", travelItems.length === 8, travelItems.length);
check("travel: price parsed", travelItems[0].price === 289000, travelItems[0]);

// 3. Path round-trip: readArrayAtPath must find the same rows again.
const reread = readArrayAtPath(travel, "$.result.contents");
check("travel: readArrayAtPath round-trip", reread?.length === 8, reread?.length);
check("shopping: readArrayAtPath round-trip", readArrayAtPath(shopping, "$.data")?.length === 12);
check("readArrayAtPath: bad path returns null", readArrayAtPath(travel, "$.nope.here") === null);
check("readArrayAtPath: root array", readArrayAtPath([{ a: 1 }], "$")?.length === 1);

// 4. A payload with no item-like array must yield nothing usable.
const noItems = { ok: true, count: 0, messages: ["a", "b"] };
check("no-items payload yields no candidates", findItemArrays(noItems).length === 0, findItemArrays(noItems));

// 5. Unknown key names entirely — the name fallback should still find the title-ish column.
const exotic = {
  list: Array.from({ length: 6 }, (_, i) => ({
    zzz: `여행 상품 아주 긴 이름입니다 ${i}`,
    qq: i,
  })),
};
const exoticBest = findItemArrays(exotic)[0];
const exoticMap = exoticBest ? detectFieldMap(exoticBest.rows) : null;
check("exotic: falls back to longest string column", exoticMap?.name === "zzz", exoticMap);

// 6. 여행 화면은 쇼핑 추천과 여행 추천을 동시에 호출한다. 더 많은 행을 가진 쇼핑
// 응답이 있어도 여행 메타데이터와 connect 전용 엔드포인트가 있는 쪽을 골라야 한다.
const mixedCaptured = [
  {
    url: "https://gw-brandconnect.naver.com/affiliate/query/affiliate-products/recommend-by-display-category?limit=60",
    payload: {
      data: Array.from({ length: 60 }, (_, i) => ({
        id: 1000 + i,
        productName: `쇼핑 상품 ${i}`,
        storeName: "쇼핑몰",
        discountedSalePrice: 10000 + i,
        productUrl: `https://shopping.example/${i}`,
      })),
    },
  },
  {
    url: "https://gw-brandconnect.naver.com/affiliate/query/connect/recommend-products?limit=20",
    payload: {
      data: Array.from({ length: 20 }, (_, i) => ({
        productId: `TRAVEL-${i}`,
        name: `여행 상품 ${i}`,
        storeName: "여행사",
        discountedSalePrice: 200000 + i,
        representativeProductImageUrl: `https://travel.example/${i}.jpg`,
        url: `https://travel.example/product/${i}`,
        connectServiceType: "TRAVEL",
        extra: { countryNames: ["대한민국"], cityNames: ["제주"], duration: "2박 3일" },
      })),
    },
  },
];
const mixedTravelBest = pickBestListResponse(mixedCaptured, "travel");
check(
  "mixed response: travel contract wins over larger shopping response",
  mixedTravelBest?.endpoint.endsWith("/affiliate/query/connect/recommend-products") === true,
  mixedTravelBest
);
check("mixed response: travel name key", mixedTravelBest?.fieldMap.name === "name", mixedTravelBest?.fieldMap);
check(
  "mixed response: travel representative image key",
  mixedTravelBest?.fieldMap.imageUrl === "representativeProductImageUrl",
  mixedTravelBest?.fieldMap
);

// 7. 계약 확인 뒤에도 행 단위 버튼이 별도로 잠기면 일괄 버튼만 열리는 반쪽 수정이 된다.
const dashboardSource = fs.readFileSync(path.join(process.cwd(), "src", "app", "page.tsx"), "utf8");
check("travel row: legacy fixed lock removed", !dashboardSource.includes("🔒 여행 발행 준비중"));
check(
  "travel row: ready buttons follow contract availability",
  dashboardSource.includes('link.status === "READY" && (link.connectKind !== "TRAVEL" || !travelPublishingUnavailable)')
);
check(
  "travel row: retry buttons follow contract availability",
  dashboardSource.includes('link.status === "FAILED" && (link.connectKind !== "TRAVEL" || !travelPublishingUnavailable)')
);

if (failures > 0) {
  console.error(`\n${failures}개 검증 실패`);
  process.exit(1);
}
console.log("\n모든 검증 통과");
