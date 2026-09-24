/** Offline regressions for post angles (one product → full review + topic posts). */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { familySafeScheduleDate } from "../src/lib/bulk-schedule-plan";
import {
  assessSiblingOverlap,
  formatPostAngleForPrompt,
  formatPostAngleSummary,
  isTitleTooSimilarToSiblings,
  suggestPostAngles,
} from "./lib/topic-templates/angles";
import { composeBudgetedWritingPrompt, createWritingPromptContract, formatWritingPromptContract } from "./lib/writing-prompt-contract";

// 1. Suggestions: evidence gates hide angles; full review + two topic posts are recommended.
const vest = suggestPostAngles({
  kind: "SHOPPING",
  productName: "RNRN 러닝조끼",
  features: ["메쉬 소재 남녀공용", "세탁망 사용 찬물 세탁", "무게 120g", "사이즈 S/M/L 중 선택", "가슴둘레 90cm"],
});
const byId = new Map(vest.map((item) => [item.id, item]));
assert.equal(byId.get("full-review")?.recommended, true);
assert.equal(byId.get("care-longterm")?.available, false, "long-term care needs experience notes");
assert.equal(byId.get("compare")?.available, true, byId.get("compare")?.reason);
assert.equal(vest.filter((item) => item.recommended && item.id !== "full-review").length, 2);
assert.ok(vest.filter((item) => item.recommended).every((item) => item.available));
const sparse = suggestPostAngles({ kind: "SHOPPING", productName: "무지 상품", features: [] });
assert.deepEqual(sparse.filter((item) => item.available).map((item) => item.id), ["full-review"],
  "no evidence, no invented topic posts");
const withExisting = suggestPostAngles({ kind: "SHOPPING", productName: "RNRN 러닝조끼", features: ["세탁망 사용 찬물 세탁", "메쉬 소재"] }, [null as unknown as string, "how-to"]);
assert.equal(withExisting.find((item) => item.id === "full-review")?.existing, true, "a null angle is the full review");
assert.equal(withExisting.find((item) => item.id === "how-to")?.recommended, false, "existing angles are not recommended again");

const tour = suggestPostAngles({
  kind: "TRAVEL",
  productName: "출발확정 대마도 2일 패키지",
  description: "히타카츠 이즈하라 시내숙박 티아라몰 쇼핑",
  features: ["핵심 방문지: 히타카츠, 미우다 해변, 와타즈미 신사", "1일차 일정: 히타카츠 → 미우다 해변", "2일차 일정: 와타즈미 신사 → 이즈하라", "석식 포함"],
});
const tourIds = tour.filter((item) => item.recommended).map((item) => item.id);
assert.deepEqual(tourIds, ["full-review", "prep-tips", "food-spot"], "travel default: full review + tips + spots");
assert.equal(tour.find((item) => item.id === "season")?.available, false, "no departure season evidence");

// 2. Prompt blocks.
assert.equal(formatPostAngleForPrompt("SHOPPING", "full-review", []), "", "default posts carry no extra block");
const howTo = formatPostAngleForPrompt("SHOPPING", "how-to", [{ angle: "full-review", title: "러닝조끼 RNRN 후기", headings: ["한눈에 보기", "착용감"] }]);
assert.match(howTo, /포스팅 각도: 사용법·루틴/u);
assert.match(howTo, /러닝조끼 RNRN 후기/u);
assert.match(howTo, /겹치지 않게/u);
assert.equal(formatPostAngleSummary("SHOPPING", "full-review"), "");
const contract = createWritingPromptContract({
  kind: "TRAVEL", product: { name: "대마도 2일 패키지" }, minimumSections: 7, maximumSections: 12,
  targetCharacters: { min: 1750, max: 3600 }, hashtagCount: 4,
  postAngleBlock: formatPostAngleForPrompt("TRAVEL", "prep-tips", [{ angle: "full-review", title: "대마도 패키지 여행 꿀팁" }]),
  postAngleSummary: formatPostAngleSummary("TRAVEL", "prep-tips"),
});
assert.match(formatWritingPromptContract(contract), /포스팅 각도: 준비 꿀팁/u);
const budgeted = composeBudgetedWritingPrompt({ contract, prefix: "", suffix: "", evidence: "근거".repeat(5000), maxChars: 6000 });
assert.ok(budgeted.length <= 6000);
assert.match(budgeted, /포스팅 주제: 준비 꿀팁/u, "budgeted prompts keep the one-line angle summary");

// 3. Sibling overlap and title similarity.
const fullReview = [
  "착용감\n\nRNRN 러닝조끼는 메쉬 소재라 땀이 차도 등판이 빨리 마르는 편이에요. 무게가 120g이라 뛰는 동안 흔들림이 거의 느껴지지 않았어요.",
];
const copied = ["세탁 방법\n\nRNRN 러닝조끼는 메쉬 소재라 땀이 차도 등판이 빨리 마르는 편이에요. 무게가 120g이라 뛰는 동안 흔들림이 거의 느껴지지 않았어요."];
const distinct = ["세탁 방법\n\n세탁망에 넣고 찬물 코스로 돌리면 메쉬 조직이 늘어나지 않아요. 건조기는 피하고 그늘에 널어 말리는 게 좋아요."];
assert.equal(assessSiblingOverlap(copied, [fullReview]).needsRewrite, true);
assert.deepEqual(assessSiblingOverlap(copied, [fullReview]).overlappingSectionIndexes, [0]);
assert.equal(assessSiblingOverlap(distinct, [fullReview]).needsRewrite, false);
assert.equal(assessSiblingOverlap(copied, []).needsRewrite, false);
assert.equal(isTitleTooSimilarToSiblings("러닝조끼 RNRN 후기 착용감 정리", ["러닝조끼 RNRN 후기 착용감 정리해봤어요"]), true);
assert.equal(isTitleTooSimilarToSiblings("RNRN 러닝조끼 세탁법과 관리 순서", ["러닝조끼 RNRN 후기 착용감 정리"]), false);

// 4. Schedule spacing between sibling posts.
assert.equal(familySafeScheduleDate("2026-10-01", 1, ["2026-10-02"], new Set()), "2026-10-04");
assert.equal(familySafeScheduleDate("2026-10-01", 1, ["2026-10-02"], new Set(["2026-10-04"])), "2026-10-05", "occupied dates are skipped");
assert.equal(familySafeScheduleDate("2026-10-05", 1, ["2026-10-02"]), "2026-10-05");
assert.equal(familySafeScheduleDate("2026-10-01", 1, []), "2026-10-01");

// 5. API route against a real temporary SQLite database.
async function verifyRoute() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blogautomcp-angles-"));
  const databaseUrl = `file:${path.join(root, "test.db")}`;
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: "1" }, stdio: "ignore",
  });
  process.env.DATABASE_URL = databaseUrl;
  process.env.DESKTOP_USER_DATA = root;
  process.env.REMOTE_SITE_URL = "https://fixture.invalid";
  process.env.REMOTE_DEVICE_ID = "fixture";
  process.env.REMOTE_DEVICE_TOKEN = "fixture-not-a-live-token";
  delete process.env.ADMIN_API_KEY;
  const { prisma } = await import("../src/lib/db");
  const { GET, POST } = await import("../src/app/api/brandlinks/[id]/angles/route");
  const { NextRequest } = await import("next/server");
  try {
    const parent = await prisma.brandLink.create({ data: {
      url: "https://naver.me/fixture", connectKind: "SHOPPING", externalItemId: "p-1", productName: "RNRN 러닝조끼",
      productFeatures: JSON.stringify(["메쉬 소재", "세탁망 사용 찬물 세탁", "사이즈 S/M/L 중 선택"]), status: "PUBLISHED",
      postUrl: "https://blog.naver.com/fixture/1", categoryNo: "7",
    } });
    const call = (method: "GET" | "POST", id: string, body?: unknown) => {
      const request = new NextRequest(`http://localhost/api/brandlinks/${id}/angles`, {
        method, headers: { "content-type": "application/json", origin: "http://localhost" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const context = { params: Promise.resolve({ id }) };
      return method === "GET" ? GET(request, context) : POST(request, context);
    };
    const listed = await (await call("GET", parent.id)).json();
    assert.equal(listed.success, true);
    assert.deepEqual(listed.data.members.map((member: { angle: string }) => member.angle), ["full-review"]);

    const created = await call("POST", parent.id, { angle: "how-to" });
    assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
    const childId = (await created.json()).data.id as string;
    const child = await prisma.brandLink.findUniqueOrThrow({ where: { id: childId } });
    assert.equal(child.parentBrandLinkId, parent.id);
    assert.equal(child.postAngle, "how-to");
    assert.equal(child.status, "READY", "a topic post starts unwritten even if the full review is published");
    assert.equal(child.postUrl, null);
    assert.deepEqual([child.url, child.productName, child.productFeatures, child.categoryNo, child.externalItemId],
      [parent.url, parent.productName, parent.productFeatures, parent.categoryNo, parent.externalItemId]);

    assert.equal((await call("POST", parent.id, { angle: "how-to" })).status, 409, "no duplicate angle");
    assert.equal((await call("POST", childId, { angle: "full-review" })).status, 400, "the full review is the parent row");
    assert.equal((await call("POST", parent.id, { angle: "care-longterm" })).status, 422, "evidence gate applies");
    assert.equal((await call("POST", parent.id, { angle: "prep-tips" })).status, 400, "travel angles never apply to shopping");

    const fromChild = await (await call("GET", childId)).json();
    assert.equal(fromChild.data.rootId, parent.id, "a child resolves the same family");
    assert.deepEqual(fromChild.data.members.map((member: { angle: string }) => member.angle), ["full-review", "how-to"]);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

verifyRoute().then(() => {
  console.log("PASS: post angle suggestions, evidence gates, prompts, sibling overlap, schedule spacing, angles API");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
