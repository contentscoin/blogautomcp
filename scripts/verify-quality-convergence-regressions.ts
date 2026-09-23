import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getBrandLinkContentReadiness, type BrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { shouldAcceptQualityRepair } from "./lib/quality-repair-policy";
import { runMaterialPreparation, type Call } from "./lib/scheduled-draft-workflow";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import {
  brandPostQualitySourceFromSnapshot,
  buildBrandPostQualitySource,
} from "../src/lib/brand-post-quality-source";
import {
  isProductSnapshotEvidenceRicher,
  productSnapshotEvidenceProfile,
} from "../src/lib/brand-post-revalidation";
import { isDraftEditorialQualityPassed } from "../src/lib/brand-post-quality-display";
import { assessProductReviewSubstance } from "./lib/product-editorial-plan";

const disclosure = "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.";

function passingTextQuality() {
  return {
    signals: [{ key: "review-substance", status: "pass" }],
    quality: { score: 100, passScore: 70, categories: [] },
  };
}

type CounterexampleFailure = { name: string; message: string };

function checkCounterexample(
  failures: CounterexampleFailure[],
  name: string,
  check: () => void,
): void {
  try {
    check();
  } catch (error) {
    failures.push({
      name,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function assertChildDeadlineGuard(source: string, terminationSource: string, label: string): void {
  assert.match(source, /setTimeout\s*\(/u, `${label} must set a finite child-process deadline`);
  assert.match(source, /(?:child\.kill\s*\(|killProcessTree\s*\(|terminate(?:Child\w*|ProcessTree)\s*\()/u,
    `${label} must terminate the child when its deadline expires`);
  assert.match(source, /clearTimeout\s*\(/u, `${label} must clear its deadline after child exit/error`);
  assert.match(terminationSource, /spawn\("taskkill",\s*\["\/pid",\s*String\(child\.pid\),\s*"\/T",\s*"\/F"\]/u,
    `${label} must terminate the Windows child process tree`);
  assert.match(terminationSource, /child\.kill\("SIGKILL"\)/u,
    `${label} must retain a hard-kill fallback when tree termination fails or stalls`);
}

async function verifyMaterialWorkflowContract(): Promise<void> {
  let created = false;
  let revised = false;
  let approved = false;
  let draftPosts = 0;
  let convergenceCalls = 0;

  const call: Call = async (url, method, body) => {
    const action = (body as { action?: string } | undefined)?.action;
    if (method === "GET" && url.endsWith("/draft") && !created) {
      return { success: true, data: null };
    }
    if (method === "POST" && url.endsWith("/draft")) {
      draftPosts += 1;
      created = true;
      assert.deepEqual(body, {
        autoApprove: false,
        autoSectionImages: false,
        autoQualityRepair: false,
      }, "material creation must reserve the repair budget for saved-draft convergence");
    }
    if (action === "revise") {
      convergenceCalls += 1;
      assert.equal((body as { qualityConvergence?: boolean }).qualityConvergence, true);
      assert.match(String((body as { instructions?: string }).instructions), /\[자동 품질 수렴 계획\]/u);
      assert.match(String((body as { instructions?: string }).instructions), /구매 판단에 필요한 요소/u);
      revised = true;
    }
    if (action === "approve") approved = true;

    const textFailed = created && !revised;
    return {
      success: true,
      data: {
        approvedAt: approved ? "2026-09-14T00:00:00.000Z" : null,
        approval: { canApprove: !textFailed },
        imageSlots: [],
        contentQuality: textFailed
          ? {
              signals: [{ key: "review-substance", status: "fail", label: "구매 판단에 필요한 요소" }],
              quality: { score: 91, passScore: 70, categories: [] },
            }
          : passingTextQuality(),
      },
    };
  };

  await runMaterialPreparation("material-contract", { call, pause: async () => {} });
  assert.equal(draftPosts, 1);
  assert.equal(convergenceCalls, 1, "saved draft must enter the bounded convergence engine exactly once");
}

async function verifyCompositionDoesNotRewriteText(): Promise<void> {
  let imagesReady = false;
  let approved = false;
  let revisions = 0;
  let imageRepairs = 0;

  const call: Call = async (url, method, body) => {
    const action = (body as { action?: string } | undefined)?.action;
    if (action === "revise") revisions += 1;
    if (url.endsWith("/draft/images") && method === "POST") {
      imageRepairs += 1;
      imagesReady = true;
    }
    if (action === "approve") approved = true;
    return {
      success: true,
      data: {
        approvedAt: approved ? "2026-09-14T00:00:00.000Z" : null,
        approval: { canApprove: imagesReady },
        imageSlots: [{ missing: imagesReady ? 0 : 1, generationMissing: imagesReady ? 0 : 1 }],
        contentQuality: {
          signals: [{ key: "composition-quality", status: imagesReady ? "pass" : "fail", label: "이미지 구성" }],
          quality: { score: 100, passScore: 70, categories: [] },
        },
      },
    };
  };

  await runMaterialPreparation("composition-only", { call, pause: async () => {} });
  assert.equal(imageRepairs, 1);
  assert.equal(revisions, 0, "image/composition failures must never consume a text rewrite");
}

async function verifySparseRefreshStopsWithoutRewrite(sparse: BrandLinkContentReadiness): Promise<void> {
  let contextRefreshes = 0;
  let refreshRechecks = 0;
  let revisions = 0;
  const call: Call = async (url, method, body) => {
    const action = (body as { action?: string; refreshSource?: boolean } | undefined)?.action;
    if (method === "POST" && url.endsWith("/draft")) {
      contextRefreshes += 1;
      assert.deepEqual(body, { action: "prepare_context" });
      return { success: true, data: null };
    }
    if (action === "recheck" && (body as { refreshSource?: boolean }).refreshSource === true) refreshRechecks += 1;
    if (action === "revise") revisions += 1;
    return { success: true, data: { imageSlots: [], contentQuality: sparse } };
  };
  await assert.rejects(
    runMaterialPreparation("sparse-refresh", { call, pause: async () => {} }),
    (error: unknown) => (error as { code?: string }).code === "SOURCE_EVIDENCE_REQUIRED",
  );
  assert.equal(contextRefreshes, 1, "sparse evidence gets one server-owned context refresh");
  assert.equal(refreshRechecks, 1, "the refreshed source is explicitly compared during recheck");
  assert.equal(revisions, 0, "sparse evidence must never trigger prose generation");
}

async function main(): Promise<void> {
  const decimalGrounding = assessProductReviewSubstance({
    productName: "캐치웰 CX PRO 무선청소기",
    sourceDescription: "무선청소기",
    sourceFeatures: ["무게: 2.4kg"],
    sections: [
      "손목 부담\n\n무게는 2.4kg입니다. 무게 2.4kg은 손목 부담이 우선인 사용자에게 중요한 제약입니다.",
    ],
  });
  assert.ok(decimalGrounding.coveredSignals.includes("무게: 2.4kg"),
    "decimal measurements must remain intact source evidence");
  assert.equal(decimalGrounding.groundedSignalCount, 1,
    "a decimal measurement and its same-paragraph judgement stay grounded");

  const rawEvidence = {
    productName: "테스트 정리함 M3",
    description: "작은 부품을 세 구역으로 나눠 옮기는 정리함",
    features: ["분리형 칸막이", "접이식 손잡이", "내부 트레이 3개"],
  };
  const generationSource = buildBrandPostQualitySource(rawEvidence);
  const snapshot = createProductSnapshot({
    productId: "fixture-product",
    connectKind: "SHOPPING",
    externalProductId: "M3",
    sourceUrl: "https://example.invalid/M3",
    capturedAt: "2026-09-14T00:00:00.000Z",
    product: {
      name: rawEvidence.productName,
      description: rawEvidence.description,
      features: rawEvidence.features,
      price: "19,900원",
      couponInfo: "최대 2천원 할인",
      seoKeywords: ["정리함", "수납", "추천"],
    },
  });
  const recheckSource = brandPostQualitySourceFromSnapshot(snapshot);
  assert.deepEqual(recheckSource, generationSource, "generation and recheck must use byte-identical canonical QC evidence");
  assert.doesNotMatch(JSON.stringify(recheckSource), /19,900|쿠폰|추천/u, "transaction and SEO metadata must not enter product-function evidence");

  const metadataOnlyRefresh = createProductSnapshot({
    productId: "fixture-product",
    connectKind: "SHOPPING",
    externalProductId: "M3",
    sourceUrl: "https://example.invalid/M3",
    capturedAt: "2026-09-14T01:00:00.000Z",
    product: {
      name: rawEvidence.productName,
      description: rawEvidence.description,
      features: rawEvidence.features,
      price: "17,900원",
      couponInfo: "신규 쿠폰 3천원",
      seoKeywords: ["정리함", "수납", "베스트", "추천"],
    },
  });
  assert.equal(isProductSnapshotEvidenceRicher(metadataOnlyRefresh, snapshot), false,
    "new transaction metadata alone cannot replace the frozen evidence snapshot");
  const richerRefresh = createProductSnapshot({
    productId: "fixture-product",
    connectKind: "SHOPPING",
    externalProductId: "M3",
    sourceUrl: "https://example.invalid/M3",
    capturedAt: "2026-09-14T02:00:00.000Z",
    product: {
      name: rawEvidence.productName,
      description: rawEvidence.description,
      features: [...rawEvidence.features, "폴리프로필렌 본체", "가로 32cm"],
    },
  });
  assert.equal(isProductSnapshotEvidenceRicher(richerRefresh, snapshot), true);
  assert.ok(productSnapshotEvidenceProfile(richerRefresh).facts > productSnapshotEvidenceProfile(snapshot).facts);

  const unrelatedRicherRefresh = createProductSnapshot({
    productId: "fixture-product",
    connectKind: "SHOPPING",
    externalProductId: "M3",
    sourceUrl: "https://example.invalid/M3",
    capturedAt: "2026-09-14T03:00:00.000Z",
    product: {
      name: rawEvidence.productName,
      description: "무선 캠핑 선풍기로 텐트 안 공기를 순환하는 제품",
      features: [
        "배터리 용량 10000mAh",
        "풍량 조절 4단",
        "자동 회전 각도 120도",
        "충전시간 약 5시간",
        "사용시간 최대 20시간",
        "본체 무게 800g",
        "클립 고정 방식",
        "리모컨 구성품 포함",
      ],
    },
  });
  const cumulativeRicherRefresh = createProductSnapshot({
    productId: "fixture-product",
    connectKind: "SHOPPING",
    externalProductId: "M3",
    sourceUrl: "https://example.invalid/M3",
    capturedAt: "2026-09-14T04:00:00.000Z",
    product: {
      name: rawEvidence.productName,
      description: rawEvidence.description,
      features: [...rawEvidence.features, "폴리프로필렌 본체", "가로 32cm"],
    },
  });
  assert.ok(productSnapshotEvidenceProfile(unrelatedRicherRefresh).facts > productSnapshotEvidenceProfile(snapshot).facts,
    "counterexample must contain more counted facts so raw-count comparison is exercised");

  const simpleAgentSource = fs.readFileSync(path.join(process.cwd(), "scripts", "simple-agent.ts"), "utf8");
  const revalidationSource = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brand-post-revalidation.ts"), "utf8");
  const draftRouteSource = fs.readFileSync(path.join(process.cwd(), "src", "app", "api", "brandlinks", "[id]", "draft", "route.ts"), "utf8");
  const remoteAgentPollSource = fs.readFileSync(path.join(process.cwd(), "src", "app", "api", "remote-agent", "poll", "route.ts"), "utf8");
  assert.match(simpleAgentSource, /buildBrandPostQualitySource\(\{ productName:/u);
  assert.match(simpleAgentSource, /brandPostQualitySourceFromSnapshot\(frozenSnapshot\)/u);
  assert.doesNotMatch(simpleAgentSource, /hasSufficientVisualDraftEvidence/u,
    "image counts must not satisfy the product source-evidence gate");
  assert.match(simpleAgentSource, /allowedPropertyType = \/\^\(\?:PropertyValue\|QuantitativeValue\)\$\/u/u,
    "JSON-LD feature extraction must accept only typed property values");
  assert.match(simpleAgentSource, /\[class\*="spec" i\] li, \[id\*="spec" i\] li/u);
  assert.doesNotMatch(simpleAgentSource, /featureEls = await page\.\$\$\([^\n]*benefit/u,
    "benefit containers must never enter feature/spec evidence");
  assert.match(simpleAgentSource, /\[product\.description, \.\.\.product\.features\]\.join\("\\n"\)/u,
    "grounding must exclude product identity, price and coupon metadata");
  assert.match(simpleAgentSource, /\[UNTRUSTED_SELLER_DATA\]/u);
  assert.match(simpleAgentSource, /SELLER_PROMPT_INJECTION_PATTERN/u);
  assert.match(simpleAgentSource, /const failure = classifyProductSourceFailure\(error\);[\s\S]{0,120}if \(!failure\.retryable\) throw error;/u,
    "auth and deterministic source failures must stop without retrying");
  assert.match(simpleAgentSource, /PRODUCT_SOURCE_AUTH_REQUIRED:/u);
  assert.match(simpleAgentSource, /sourceUrl: product\.finalUrl \|\| productIdentity\?\.sourceUrl \|\| brandLink \|\| null/u,
    "server-owned refresh context must identify the actual detail page before the category or affiliate URL");
  assert.match(revalidationSource, /brandPostQualitySourceFromSnapshot\(snapshot\)/u);
  assert.match(draftRouteSource, /link\.finalUrl \|\| link\.sourceUrl \|\| link\.url/u);
  assert.match(draftRouteSource, /isProductSnapshotEvidenceRicher\(candidate\.snapshot, current\.snapshot\)/u);
  assert.match(remoteAgentPollSource, /실패 signals[\s\S]{0,240}post_revise_draft/u,
    "MCP quality repair must use the image-preserving revision tool");
  assert.doesNotMatch(remoteAgentPollSource, /실패 signals[\s\S]{0,240}post_submit_draft를 다시/u,
    "MCP quality repair must not replace the complete draft package");

  const counterexampleFailures: CounterexampleFailure[] = [];
  checkCounterexample(counterexampleFailures, "request body contextSnapshot is never trusted as evidence", () => {
    const submitRouteSource = draftRouteSource.slice(draftRouteSource.indexOf("export async function POST"));
    assert.match(submitRouteSource, /const suppliedContext = JSON\.parse\(fs\.readFileSync\(contextPath, "utf8"\)\)/u,
      "submit_generated must load the server-owned context file");
    assert.match(submitRouteSource, /readProductSnapshot\(suppliedContext\?\.snapshot/u,
      "the accepted snapshot must come from the server-owned context");
    assert.match(submitRouteSource, /JSON\.stringify\(suppliedContext/u,
      "the persisted submitted context must be the server-owned context");
    assert.doesNotMatch(submitRouteSource,
      /readProductSnapshot\(\s*(?:body\.contextSnapshot|forwardedContext)|JSON\.stringify\(\s*forwardedContext|sourceSnapshot\s*:\s*(?:body\.contextSnapshot|forwardedContext)/u,
      "request-body context data may be compared by snapshotId, but its product facts must never be parsed, persisted or evaluated");
  });
  checkCounterexample(counterexampleFailures, "richer replacement preserves frozen facts", () => {
    assert.equal(isProductSnapshotEvidenceRicher(unrelatedRicherRefresh, snapshot), false,
      "a candidate that merely has more unrelated facts must not replace the frozen source");
    assert.equal(isProductSnapshotEvidenceRicher(cumulativeRicherRefresh, snapshot), true,
      "a candidate that preserves the frozen facts and adds substantive evidence should replace it");
  });
  checkCounterexample(counterexampleFailures, "source URL identity rejects tracking-query spoof and accepts equivalent path encoding", () => {
    const actualDetail = createProductSnapshot({
      productId: "fixture-product", connectKind: "SHOPPING", externalProductId: "M3",
      sourceUrl: "https://shop.example/products/M3?reqChannel=brandconnect",
      capturedAt: "2026-09-14T05:00:00.000Z",
      product: { name: rawEvidence.productName, description: rawEvidence.description, features: rawEvidence.features },
    });
    const crossOriginSpoof = createProductSnapshot({
      productId: "fixture-product", connectKind: "SHOPPING", externalProductId: "M3",
      sourceUrl: "https://evil.example/products/OTHER",
      capturedAt: "2026-09-14T05:01:00.000Z",
      product: { name: rawEvidence.productName, description: rawEvidence.description,
        features: [...rawEvidence.features, "폴리프로필렌 본체", "가로 32cm"] },
    });
    assert.equal(isProductSnapshotEvidenceRicher(crossOriginSpoof, actualDetail), false,
      "a tracking parameter must not make a concrete product URL generic or authorize a foreign replacement");

    const encodedPath = createProductSnapshot({
      productId: "fixture-product", connectKind: "SHOPPING", externalProductId: "M3",
      sourceUrl: "https://www.verygoodtour.com/package/A%7CB",
      capturedAt: "2026-09-14T05:02:00.000Z",
      product: { name: rawEvidence.productName, description: rawEvidence.description, features: rawEvidence.features },
    });
    const literalPath = createProductSnapshot({
      productId: "fixture-product", connectKind: "SHOPPING", externalProductId: "M3",
      sourceUrl: "https://www.verygoodtour.com/package/A|B",
      capturedAt: "2026-09-14T05:03:00.000Z",
      product: { name: rawEvidence.productName, description: rawEvidence.description,
        features: [...rawEvidence.features, "폴리프로필렌 본체", "가로 32cm"] },
    });
    assert.equal(isProductSnapshotEvidenceRicher(literalPath, encodedPath), true,
      "equivalent literal and percent-encoded path characters must keep the same product identity");
  });
  checkCounterexample(counterexampleFailures, "every approval reruns the current server-owned evaluator", () => {
    const approvalHelper = sourceBetween(
      draftRouteSource,
      "function revalidatePackageForApproval",
      "function scheduleSectionImageRepair",
    );
    assert.match(approvalHelper, /readBrandPostPackage\(brandLinkId, \{ migrate: false \}\)/u,
      "approval must not migrate or trust a legacy verdict");
    assert.match(approvalHelper, /mcp-draft-context\.json/u,
      "approval fallback must come from the server-owned saved context file");
    assert.match(approvalHelper, /const savedContext = !manifest\.sourceSnapshot/u,
      "only a missing package snapshot may use the saved-context fallback");
    assert.match(approvalHelper, /revalidateSavedBrandPostText\([\s\S]*reconcileBrandPostPackageQuality\(manifest\)/u,
      "approval must rerun the current evaluator over reconciled saved text");
    const approvalBranch = sourceBetween(
      draftRouteSource,
      'if (body.action === "approve"',
      'if (body.action === "revise")',
    );
    const revalidation = approvalBranch.indexOf("revalidatePackageForApproval(id, link)");
    const approval = approvalBranch.indexOf("approveBrandPostPackage(id)");
    assert.ok(revalidation >= 0 && approval > revalidation,
      "desktop and MCP approval must revalidate before setting approvedAt");
    const automaticApproval = draftRouteSource.indexOf("if (body.autoApprove === true)");
    const autoRevalidation = draftRouteSource.indexOf("revalidatePackageForApproval(id, link)", automaticApproval);
    const autoApproval = draftRouteSource.indexOf("approveBrandPostPackage(id)", automaticApproval);
    assert.ok(automaticApproval >= 0 && autoRevalidation > automaticApproval && autoApproval > autoRevalidation,
      "automatic approval must use the same current-evaluator boundary");
  });

  const preparedRevisionSource = sourceBetween(
    simpleAgentSource,
    "async function runPreparedPostRevision",
    "async function main()",
  );
  checkCounterexample(counterexampleFailures, "only editorial convergence failure preserves the previous package", () => {
    const finalReadiness = preparedRevisionSource.lastIndexOf("const contentReadiness =");
    const packageWrite = preparedRevisionSource.indexOf("writePreparedBrandPostPackage", finalReadiness);
    assert.ok(finalReadiness >= 0 && packageWrite > finalReadiness,
      "revision must evaluate final readiness before locating its package commit");
    const beforeCommit = preparedRevisionSource.slice(finalReadiness, packageWrite);
    assert.match(beforeCommit, /isDraftEditorialQualityPassed\(contentReadiness\)/u,
      "the commit boundary must classify the editorial gate separately from composition");
    assert.match(beforeCommit,
      /if\s*\([^)]*!editorialReady[^)]*\)\s*\{?[\s\S]{0,800}?(?:throw\s+|return\b)/u,
      "a final editorial failure must exit before writePreparedBrandPostPackage and preserve the prior package");
    assert.doesNotMatch(beforeCommit, /if\s*\([^)]*!contentReadiness\.canPublish/u,
      "composition-only failure must not roll back an accepted manuscript");

    const compositionOnly = {
      canPublish: false, code: "composition-quality", score: 100,
      blockers: [{ code: "composition-quality" }],
      signals: [
        { key: "review-substance", status: "pass" },
        { key: "composition-quality", status: "fail" },
      ],
      quality: { score: 100, passScore: 70, categories: [] },
    } as Parameters<typeof isDraftEditorialQualityPassed>[0];
    assert.equal(isDraftEditorialQualityPassed(compositionOnly), true,
      "a 100-point text candidate with only missing images is safe to persist");
    const editorialFailure = {
      ...compositionOnly!,
      canPublish: false,
      signals: [...compositionOnly!.signals, { key: "review-substance", status: "fail" }],
    } as NonNullable<Parameters<typeof isDraftEditorialQualityPassed>[0]>;
    assert.equal(isDraftEditorialQualityPassed(editorialFailure), false,
      "new editorial failures must still block the commit");
  });
  checkCounterexample(counterexampleFailures, "quality convergence bypasses spec section revision", () => {
    const reviseCall = preparedRevisionSource.indexOf("candidateResult = await reviseAssembledPost");
    assert.ok(reviseCall >= 0, "fixture expects the manual spec revision path to remain available");
    const branchStart = preparedRevisionSource.lastIndexOf("if (", reviseCall);
    const branchHeaderEnd = preparedRevisionSource.indexOf("{", branchStart);
    const branchHeader = preparedRevisionSource.slice(branchStart, branchHeaderEnd + 1);
    assert.match(branchHeader, /!qualityConvergence/u,
      "qualityConvergence must use one whole-draft convergence call instead of spec section-per-call revision");
  });
  checkCounterexample(counterexampleFailures, "draft child processes have deadlines and kill cleanup", () => {
    const revisionChildSource = sourceBetween(
      draftRouteSource,
      "async function runRevision",
      "export async function PATCH",
    );
    const terminationSource = sourceBetween(
      draftRouteSource,
      "async function terminateProcessTree",
      "function normalizeSubmittedDraft",
    );
    assertChildDeadlineGuard(revisionChildSource, terminationSource, "draft revision child");
  });

  const sparse = getBrandLinkContentReadiness({
    productName: "RNRN 러닝조끼 메쉬 남녀공용 러닝 베스트",
    title: "RNRN 러닝조끼 메쉬 베스트 선택 기준",
    sections: [
      "상품 소개\n\nRNRN 러닝조끼는 여름 운동용으로 소개됩니다. 통기성이 뛰어나고 땀을 빠르게 말린다고 볼 수 있어요. 구매 전에 옵션을 확인하세요.",
      "소재 판단\n\n메쉬라는 이름을 근거로 공기가 잘 통한다고 판단했습니다. 장시간 달리기에도 쾌적할 수 있어요. 가격도 함께 확인하세요.",
      "착용 방법\n\n티셔츠 위에 착용하고 어깨선을 맞춥니다. 세탁망에 넣어 찬물로 세척하면 됩니다. 건조기는 피하는 편이 안전합니다.",
      "사용 장면\n\n여름 러닝과 트랙 훈련에 편리합니다. 가벼운 운동복이 필요한 사람에게 유용해요. 상세페이지를 살펴보세요.",
      "장점\n\n열을 잘 배출하는 것이 장점입니다. 남녀 모두 편하게 입을 수 있어요. 운동할 때 실용적입니다.",
      "제약\n\n보온이 필요한 환경에는 맞지 않습니다. 내구성 수치는 확인되지 않았습니다. 조건을 비교하세요.",
      "추천 대상\n\n여름에 달리는 사람에게 잘 맞습니다. 보온 조끼가 필요한 사람에게는 비추천 대상입니다.",
      "최종 판단\n\n여름 러닝용 메쉬 조끼가 필요한 경우라면 후보입니다. 확인된 성능 수치가 중요하면 다른 제품이 더 낫습니다.",
      disclosure,
    ],
    hashtags: ["러닝조끼", "메쉬조끼", "러닝베스트"],
    brandLink: "https://naver.me/sparse-fixture",
    generationSource: "AI",
    hasRepresentativeImage: true,
    requireRepresentativeImage: false,
    thumbnailGenerated: true,
    connectKind: "SHOPPING",
    sourceDescription: "RNRN 공식스토어 러닝 용품",
    sourceFeatures: ["러닝조끼", "메쉬", "여름", "가격: 13,700원", "원가: 59,800원", "쿠폰/혜택: Npay Plus"],
    mode: "editorial",
  });
  assert.equal(sparse.canPublish, false, "SEO and transaction metadata cannot justify unsupported product claims");
  assert.equal(sparse.quality.sourceEvidence?.level, "sparse");
  assert.equal(sparse.quality.sourceEvidence?.sufficient, false);
  assert.equal(sparse.quality.categories.find((category) => category.key === "productEvidence")?.status, "fail");
  await verifySparseRefreshStopsWithoutRewrite(sparse);

  const before = {
    ...sparse,
    canPublish: false,
    score: 80,
    blockers: [],
    signals: [{ key: "review-substance", label: "구매 판단", status: "fail" as const }],
  } satisfies BrandLinkContentReadiness;
  const newSafetyRegression = {
    ...before,
    score: 99,
    signals: [],
    blockers: [{ code: "unsupported-experience-claim" as const, tier: "safety" as const, reason: "검증되지 않은 직접 사용 주장" }],
  } satisfies BrandLinkContentReadiness;
  assert.equal(shouldAcceptQualityRepair(before, newSafetyRegression), false, "a higher score cannot commit a candidate with a new blocker");
  assert.equal(shouldAcceptQualityRepair(before, { ...before, score: 79, signals: [] }), false, "removing one signal cannot commit a lower-scoring candidate");
  assert.equal(shouldAcceptQualityRepair(before, { ...before, score: 81, signals: [] }), true);

  const revisionStart = simpleAgentSource.indexOf("async function runPreparedPostRevision");
  const candidatePolicy = simpleAgentSource.indexOf("shouldAcceptQualityRepair(selectedQuality, lastCandidateQuality)", revisionStart);
  const candidateCommit = simpleAgentSource.indexOf("writePreparedBrandPostPackage", candidatePolicy);
  assert.ok(revisionStart >= 0 && candidatePolicy > revisionStart && candidateCommit > candidatePolicy,
    "saved-material revision must evaluate candidate policy before committing the package");

  await verifyMaterialWorkflowContract();
  await verifyCompositionDoesNotRewriteText();

  if (counterexampleFailures.length > 0) {
    const detail = counterexampleFailures.map((failure, index) =>
      `${index + 1}. ${failure.name}: ${failure.message}`,
    ).join("\n");
    throw new Error(`COUNTEREXAMPLE REGRESSIONS (${counterexampleFailures.length})\n${detail}`);
  }

  console.log("PASS: decimal grounding, canonical QC source, untrusted request context, cumulative richer refresh, sparse source stop, bounded convergence, no failed commit, spec bypass, child kill deadlines");
}

void main();
