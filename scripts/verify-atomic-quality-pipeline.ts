import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSameProductInfoIdentity, mergeProductInfo, type MergeableProductInfo } from "./lib/product-info-merge";
import { commitPreparedPackageTransaction } from "./lib/prepared-package-transaction";
import { atomicWriteTextFile } from "../src/lib/atomic-text-file";
import {
  assessTravelFeatureCoverage,
  assessTravelPageResearchCoverage,
  buildTravelReviewAnalysis,
  travelPageResearchFeatures,
  type TravelPageResearch,
} from "./lib/travel-content";

function product(overrides: Partial<MergeableProductInfo> = {}): MergeableProductInfo {
  return {
    name: "미닉스 미니건조기 3.5kg PRO+",
    description: "소형 의류를 건조하는 3.5kg 건조기",
    features: ["용량: 3.5kg", "소비전력: 700W"],
    price: "",
    originalPrice: "",
    discountRate: "",
    couponInfo: "",
    deliveryInfo: "",
    reviewCount: "",
    rating: "",
    representativeImagePath: null,
    imagePaths: [],
    detailImagePaths: [],
    sourceImageUrls: [],
    finalUrl: "https://brand.naver.com/minix/products/12345",
    storeName: "미닉스",
    travelPageResearch: null,
    ...overrides,
  };
}

const priorTravel: TravelPageResearch = {
  source: "naver-package-next-data",
  durationDays: 10,
  destinations: ["이탈리아"],
  highlights: [{ name: "로마", description: "고대 도시" }],
  schedules: [{ day: 1, activities: ["로마"], meals: [], transport: null }],
  flights: [],
  shopping: [],
};
const liveTravel: TravelPageResearch = {
  source: "naver-package-next-data",
  durationDays: 10,
  destinations: ["스위스"],
  highlights: [{ name: "융프라우", description: "고산 지역" }],
  schedules: [{ day: 2, activities: ["융프라우"], meals: [], transport: "열차" }],
  flights: [],
  shopping: [],
};

const merged = mergeProductInfo(
  product({ features: ["용량: 3.5kg", "관리: 필터 분리 세척"], travelPageResearch: priorTravel }),
  product({ description: "히트펌프 방식의 소형 건조기", features: ["소비전력: 700W"], travelPageResearch: liveTravel }),
);
assert.deepEqual(merged.features, ["소비전력: 700W", "관리: 필터 분리 세척"], "live facts replace stale selected-option rows while retaining additive non-option facts");
assert.ok(!merged.features.includes("용량: 3.5kg"), "cached capacity must be re-observed before it becomes current option evidence");
assert.match(merged.description, /3\.5kg 건조기/u);
assert.match(merged.description, /히트펌프 방식/u);
assert.deepEqual(merged.travelPageResearch?.highlights.map((item) => item.name), ["로마", "융프라우"]);
assert.deepEqual(merged.travelPageResearch?.schedules.map((item) => item.day), [1, 2]);
assert.throws(
  () => mergeProductInfo(product(), product({ name: "아이닉 에어프라이어 AO-16L", finalUrl: "https://brand.naver.com/innic/products/98765" })),
  /PRODUCT_IDENTITY_MISMATCH/u,
  "a richer unrelated page must not be merged",
);
assert.equal(isSameProductInfoIdentity(
  product({ name: "삼성 비스포크 건조기 DV20", finalUrl: "https://naver.me/abc" }),
  product({ name: "삼성 비스포크 냉장고 DV20", finalUrl: "https://brand.naver.com/samsung/products/999" }),
), false, "one missing locator plus shared brand/model tokens cannot merge two different product categories");
assert.equal(isSameProductInfoIdentity(
  product({
    name: "향좋은 아비노 고보습 민감피부 저자극 바디워시 스트레스릴리프(라벤더향), 532ml, 2개",
    finalUrl: "https://naver.me/avino",
  }),
  product({
    name: "향좋은 아비노 고보습 민감피부 저자극 바디워시 스트레스릴리프(라벤더향), 532ml, 2개 : 켄뷰 공식몰",
    finalUrl: "https://brand.naver.com/aveeno/products/12345",
  }),
), true, "detail-page store suffix must not break product identity when the core title matches");
assert.equal(isSameProductInfoIdentity(
  product({ name: "스마트카라 스톤 음식물처리기 2L 건조분쇄형 SC-S0201", finalUrl: "https://naver.me/a" }),
  product({ name: "스마트카라 스톤 음식물처리기 2L 건조분쇄형 SC-S0201 : 스마트카라", finalUrl: "https://brand.naver.com/x/products/2" }),
), true, "colon + brand-only store label must still match");
assert.doesNotThrow(
  () => mergeProductInfo(
    product({
      name: "향좋은 아비노 고보습 민감피부 저자극 바디워시 스트레스릴리프(라벤더향), 532ml, 2개",
      finalUrl: "https://naver.me/avino",
    }),
    product({
      name: "향좋은 아비노 고보습 민감피부 저자극 바디워시 스트레스릴리프(라벤더향), 532ml, 2개 : 켄뷰 공식몰",
      finalUrl: "https://brand.naver.com/aveeno/products/12345",
      description: "라벤더향 바디워시",
    }),
  ),
  "store-suffixed live detail must merge into the stored shopping product",
);

const sparseTenDay: TravelPageResearch = {
  source: "naver-package-next-data",
  durationDays: 10,
  destinations: ["이탈리아"],
  highlights: [{ name: "로마", description: "고대 도시" }],
  schedules: [{ day: 1, activities: ["로마"], meals: [], transport: null }],
  flights: [],
  shopping: [],
};
const sparseTravelFeatures = travelPageResearchFeatures(sparseTenDay);
const sparseCoverage = assessTravelPageResearchCoverage(sparseTenDay);
assert.equal(sparseCoverage.requiredItineraryDayCount, 6);
assert.equal(sparseCoverage.sufficient, false, "one day cannot cover a ten-day product");
assert.equal(assessTravelFeatureCoverage(sparseTravelFeatures).sufficient, false);
assert.equal(buildTravelReviewAnalysis({
  name: "이탈리아 일주 10일",
  description: "항공과 숙박을 포함한 장거리 일정",
  features: sparseTravelFeatures,
  price: "",
}).evidenceLevel, "sparse", "raw feature count cannot upgrade incomplete itinerary coverage to usable");
assert.equal(buildTravelReviewAnalysis({
  name: "이탈리아 일주 10일",
  description: "로마와 피렌체, 베네치아를 이동하는 패키지",
  features: ["핵심 방문지: 로마, 피렌체, 베네치아", "1일차 일정: 로마"],
  price: "",
}).evidenceLevel, "sparse", "duration in the product title must raise itinerary coverage even when the collector omitted its duration feature");
const outOfRangeTravel = assessTravelFeatureCoverage([
  "여행 기간: 3일", "핵심 방문지: 로마, 피렌체", "1일차 일정: 로마", "99일차 일정: 피렌체",
]);
assert.equal(outOfRangeTravel.itineraryDayCount, 1, "itinerary days outside the advertised duration cannot satisfy coverage");
assert.equal(outOfRangeTravel.sufficient, false);

const completeTenDay: TravelPageResearch = {
  ...sparseTenDay,
  highlights: ["로마", "피렌체", "베네치아"].map((name) => ({ name, description: `${name} 방문` })),
  schedules: Array.from({ length: 6 }, (_, index) => ({
    day: index + 1,
    activities: [["로마", "피렌체", "베네치아"][index % 3]],
    meals: [],
    transport: null,
  })),
};
assert.equal(assessTravelPageResearchCoverage(completeTenDay).sufficient, true);
assert.equal(assessTravelFeatureCoverage(travelPageResearchFeatures(completeTenDay)).sufficient, true);

const simpleAgentSource = fs.readFileSync(path.join(process.cwd(), "scripts", "simple-agent.ts"), "utf8");
const systemPrompt = simpleAgentSource.slice(
  simpleAgentSource.indexOf("const systemPrompt ="),
  simpleAgentSource.indexOf("const travelSectionPlan", simpleAgentSource.indexOf("const systemPrompt =")),
);
for (const sellerDerivedBlock of [
  "openCrabPromptBlock",
  "travelPageResearchPromptBlock",
  "travelFactsPromptBlock",
  "travelReviewPromptBlock",
  "travelEditorialPromptBlock",
  "adaptiveEditorialPromptBlock",
  "qualitySelfReviewPromptBlock",
]) {
  assert.doesNotMatch(systemPrompt, new RegExp(`\\$\\{${sellerDerivedBlock}`, "u"), `${sellerDerivedBlock} must not enter the system role`);
}
const serverGuidance = simpleAgentSource.slice(
  simpleAgentSource.indexOf("const serverGuidancePrompt ="),
  simpleAgentSource.indexOf("const userPrompt =", simpleAgentSource.indexOf("const serverGuidancePrompt =")),
);
assert.doesNotMatch(serverGuidance, /openCrabPromptBlock|editorialPromptBlock|travelPageResearchPromptBlock|travelFactsPromptBlock|travelReviewPromptBlock|travelEditorialPromptBlock/u,
  "seller-derived text must remain data inside the untrusted JSON rather than masquerading as server guidance");
assert.match(simpleAgentSource, /travelPageResearch:\s*isTravel \? product\.travelPageResearch \|\| null : null/u);
assert.match(simpleAgentSource, /travelEditorialPlan:\s*isTravel \? travelEditorialPlan : null/u);
assert.match(simpleAgentSource, /\[UNTRUSTED_SELLER_DATA\][\s\S]*JSON\.stringify\(sellerPromptData\)[\s\S]*\[\/UNTRUSTED_SELLER_DATA\]/u);
assert.match(simpleAgentSource, /const evidence = \[\s*"\[UNTRUSTED_SELLER_DATA\]"[\s\S]*"\[\/UNTRUSTED_SELLER_DATA\]"/u,
  "the direct browser route must preserve the same seller-data boundary");
const transactionSource = fs.readFileSync(path.join(process.cwd(), "scripts", "lib", "prepared-package-transaction.ts"), "utf8");
assert.doesNotMatch(transactionSource, /renameSync\(manifestPath,\s*rollbackPath\)/u,
  "manifest activation must never remove the active manifest before the atomic replacement succeeds");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prepared-package-transaction-"));
try {
  const oldMarkdownPath = path.join(temp, "post.md");
  const manifestPath = path.join(temp, "manifest.json");
  const oldMarkdown = "# 기존 승인 대기 원고";
  fs.writeFileSync(oldMarkdownPath, oldMarkdown, "utf8");
  const oldManifest = JSON.stringify({
    version: "brand-post-package/v2",
    markdownPath: oldMarkdownPath,
    markdownSha256: crypto.createHash("sha256").update(oldMarkdown).digest("hex"),
  });
  fs.writeFileSync(manifestPath, oldManifest, "utf8");

  assert.throws(() => atomicWriteTextFile(manifestPath, JSON.stringify({ replacement: true }), {
    replaceForTest: (temporaryPath, targetPath) => {
      assert.equal(path.dirname(temporaryPath), path.dirname(targetPath), "temporary files must share the target directory");
      throw new Error("SIMULATED_ATOMIC_RENAME_FAILURE");
    },
  }), /SIMULATED_ATOMIC_RENAME_FAILURE/u);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), oldManifest, "failed replacement must preserve the active file byte-for-byte");
  assert.deepEqual(
    fs.readdirSync(temp).filter((entry) => /^\.manifest\.json\..+\.tmp$/u.test(entry)),
    [],
    "failed replacement must remove its unpublished temporary file",
  );

  assert.throws(() => commitPreparedPackageTransaction({
    outputDir: temp,
    markdown: "# 교체 도중 중단될 원고",
    buildManifest: (markdownPath, markdownSha256) => ({ markdownPath, markdownSha256 }),
    beforeActivate: () => { throw new Error("SIMULATED_PROCESS_KILL_BEFORE_MANIFEST_SWAP"); },
  }), /SIMULATED_PROCESS_KILL/u);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), oldManifest, "failed staging must preserve the active manifest byte-for-byte");
  assert.equal(fs.readFileSync(oldMarkdownPath, "utf8"), oldMarkdown, "failed staging must not overwrite active markdown");

  const committed = commitPreparedPackageTransaction({
    outputDir: temp,
    markdown: "# 새 원고",
    buildManifest: (markdownPath, markdownSha256) => ({ markdownPath, markdownSha256 }),
  });
  const active = JSON.parse(fs.readFileSync(committed.manifestPath, "utf8")) as {
    markdownPath: string;
    markdownSha256: string;
  };
  assert.match(active.markdownPath, /\.package-revisions[\\/][^\\/]+[\\/]post\.md$/u);
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(active.markdownPath)).digest("hex"),
    active.markdownSha256,
    "the active manifest must always address the immutable markdown revision it hashed",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("PASS: cumulative product merge, travel duration coverage, seller prompt boundary, atomic package activation");
