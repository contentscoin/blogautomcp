/**
 * 커넥트 계약 저장소 + 게이트 동작 검증.
 *
 * "여행 계약 자동 캡처를 성공했는데도 여행커넥트가 계속 막혀 있던" 버그를
 * 그대로 재현해 막는다: 계약을 저장하면 목록·등록 게이트가 함께 풀려야 하고,
 * 캡처 전에는 둘 다 닫혀 있어야 한다.
 *
 *   npm run test:connect-store
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "connect-store-"));
process.env.DESKTOP_USER_DATA = tempRoot;

import { resolveConnectContract, readStoredConnectContract, writeStoredConnectContract, hasStoredConnectContract, clearStoredConnectContract } from "../src/lib/connect-contract-store";

let failures = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`, ok ? "" : JSON.stringify(extra));
  if (!ok) failures += 1;
}

// Before capture: travel is gated, shopping is not. This is the state the user was stuck in.
const travelBefore = resolveConnectContract("travel");
check("travel before capture: captureRequired", travelBefore.captureRequired === true, travelBefore);
check("travel before capture: listAvailable false", travelBefore.listAvailable === false, travelBefore);
check("travel before capture: registration gated", travelBefore.registrationAvailable === false, travelBefore);
const shopping = resolveConnectContract("shopping");
check("shopping: never captureRequired", shopping.captureRequired === false, shopping);
check("shopping: registration allowed", shopping.registrationAvailable === true, shopping);

// Capture writes a contract.
writeStoredConnectContract({
  kind: "travel",
  capturedAt: new Date().toISOString(),
  listEndpoint: "https://gw-brandconnect.naver.com/travel/query/products",
  listQuery: { displayCategoryId: "77", limit: "20" },
  itemsPath: "$.result.contents",
  fieldMap: { id: "packageId", name: "packageName", storeName: "partnerName", price: "lowestPrice", imageUrl: "thumbnailUrl", linkUrl: "landingUrl" },
  sourceUrl: "https://brandconnect.naver.com/916297527319296/travel",
  sampleCount: 8,
});

// After capture: the gate must lift. This is the bug — it never used to.
const travelAfter = resolveConnectContract("travel");
check("travel after capture: captureRequired false", travelAfter.captureRequired === false, travelAfter);
check("travel after capture: listAvailable true", travelAfter.listAvailable === true, travelAfter);
check("travel after capture: registration opens", travelAfter.registrationAvailable === true, travelAfter);

const roundTrip = readStoredConnectContract("travel");
check("contract round-trips", roundTrip?.listEndpoint === "https://gw-brandconnect.naver.com/travel/query/products", roundTrip);
check("field map round-trips", roundTrip?.fieldMap.name === "packageName", roundTrip?.fieldMap);
check("stored under userData", fs.existsSync(path.join(tempRoot, "data", "connect-contracts", "travel.json")));

// Corrupt / mismatched files must be rejected rather than half-used.
fs.writeFileSync(path.join(tempRoot, "data", "connect-contracts", "travel.json"), "{ not json", "utf8");
check("corrupt contract rejected", readStoredConnectContract("travel") === null);
check("corrupt contract re-gates travel", resolveConnectContract("travel").captureRequired === true);

fs.writeFileSync(path.join(tempRoot, "data", "connect-contracts", "travel.json"), JSON.stringify({ kind: "shopping", listEndpoint: "x", itemsPath: "$", fieldMap: { name: "n", id: null, storeName: null, price: null, imageUrl: null, linkUrl: null } }), "utf8");
check("kind-mismatched contract rejected", readStoredConnectContract("travel") === null);

clearStoredConnectContract("travel");
check("clear removes contract", hasStoredConnectContract("travel") === false);
check("clear is idempotent", (() => { clearStoredConnectContract("travel"); return true; })());

fs.rmSync(tempRoot, { recursive: true, force: true });
if (failures > 0) { console.error(`\n${failures}개 실패`); process.exit(1); }
console.log("\n모든 검증 통과");
