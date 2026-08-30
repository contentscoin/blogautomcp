import assert from "node:assert/strict";
import { collapseBrandLinkProducts, type BrandLinkProductListRow } from "../src/lib/brandlink-product-list";

const at = (value: string) => new Date(value);
const base: Omit<BrandLinkProductListRow, "id" | "status" | "createdAt" | "updatedAt"> = {
  connectKind: "TRAVEL",
  externalItemId: "travel-16511",
  url: "https://naver.me/GXFzUrGl",
  errorMessage: null,
};

const rows: BrandLinkProductListRow[] = [
  {
    ...base,
    id: "failed-newer-created-row",
    status: "FAILED",
    errorMessage: "과거 썸네일 생성 실패",
    createdAt: at("2026-08-27T11:41:08.127Z"),
    updatedAt: at("2026-08-27T20:01:45.018Z"),
  },
  {
    ...base,
    id: "ready-recovered-row",
    status: "READY",
    createdAt: at("2026-08-27T08:02:19.105Z"),
    updatedAt: at("2026-08-30T11:22:36.234Z"),
  },
  {
    ...base,
    id: "retryable-failed-product",
    externalItemId: "travel-other",
    url: "https://pkgtour.naver.com/products/other",
    status: "FAILED",
    errorMessage: "이전 초안 실패",
    createdAt: at("2026-08-30T01:00:00.000Z"),
    updatedAt: at("2026-08-30T02:00:00.000Z"),
  },
  {
    ...base,
    id: "shopping-same-id",
    connectKind: "SHOPPING",
    status: "READY",
    createdAt: at("2026-08-30T03:00:00.000Z"),
    updatedAt: at("2026-08-30T03:00:00.000Z"),
  },
];

const collapsed = collapseBrandLinkProducts(rows);
assert.equal(collapsed.length, 3, "같은 커넥트 상품의 중복 행은 하나로 합쳐야 합니다.");

const recovered = collapsed.find((item) => item.externalItemId === "travel-16511");
assert.equal(recovered?.id, "ready-recovered-row", "과거 FAILED보다 현재 READY 행을 우선해야 합니다.");
assert.equal(recovered?.duplicateCount, 2);
assert.equal(recovered?.canCreateDraft, true);

const failed = collapsed.find((item) => item.id === "retryable-failed-product");
assert.equal(failed?.canCreateDraft, true, "FAILED는 초안 재시도가 가능한 상태여야 합니다.");
assert.match(failed?.statusMeaning || "", /다시 시도/u);

assert.ok(
  collapsed.some((item) => item.id === "shopping-same-id"),
  "쇼핑과 여행의 외부 ID가 같아도 서로 합치면 안 됩니다.",
);

console.log(JSON.stringify({ ok: true, collapsed: collapsed.length, failedRetryable: true }));
