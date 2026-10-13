import { publicationImageGeometryIssue } from "./lib/publication-image-geometry";
import * as unbrandedProduct from "./lib/unbranded-product";
import * as productImageVisualContract from "./lib/product-image-visual-contract";
import { testPngFixture } from "./lib/test-png-fixture";
/** Offline section-image evidence gate regression checks. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { allowsGenericBrandPostProductPhoto, allowsOriginalShoppingScene, type BrandPostImageSourceHint } from "../src/lib/brand-post-image-evidence";
import type { ProductSectionImageAssignment, ProductSectionImageDiagnostics, ProductSectionImageReviewOptions } from "./lib/product-photo-review";
import { auditSectionProposals } from "./lib/product-section-proposal-audit";
import { selectShoppingPrewriteOriginal } from "./lib/shopping-prewrite-photos";
import type { PublishImageAuditOptions, PublishImageAuditResult } from "./lib/publish-image-audit";
import * as productSourceAuditContext from "./lib/product-source-audit-context";
import * as productSectionReviewConflicts from "./lib/product-section-review-conflicts";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { buildProduct9Canvas, selectedProductContextFrom9Canvas } from "./lib/product-9canvas";

interface ReviewModule {
  allowsGenericProductPhoto(target: { sectionTitle: string; imageIntent: string }): boolean;
  selectVerifiedProductSectionImages(
    paths: string[],
    productName: string,
    targets: Array<{ sectionTitle: string; imageIntent: string; imageSource?: BrandPostImageSourceHint; sectionBody?: string[]; excludedSourceSha256?: string[] }>,
    options?: ProductSectionImageReviewOptions,
  ): Promise<ProductSectionImageAssignment[]>;
  selectVerifiedProductSectionImage(
    paths: string[],
    productName: string,
    sectionTitle: string,
    imageIntent: string,
    sectionBody?: string[],
  ): Promise<{ path: string; sourceSha256: string; reviewClass: string } | null>;
}

type ReviewCall = { userPrompt: string; imagePaths: string[]; maxImages?: number; preserveImageOrder?: boolean };

function loadReview(answer: string | ((options: ReviewCall, callIndex: number) => string),
  finalAudit?: (input: PublishImageAuditOptions, callIndex: number) => PublishImageAuditResult) {
  let prompt = "";
  const calls: ReviewCall[] = [];
  const auditCalls: PublishImageAuditOptions[] = [];
  const source = fs.readFileSync(path.resolve("scripts/lib/product-photo-review.ts"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: (name: string) => {
      if (name === "./publication-image-geometry") return { publicationImageGeometryIssue };
      // Exercise real bounded proposal logic with an offline final-review result.
      // Semantic failures/auth/round bounds are covered by verify-product-proposal-audit.
      if (name === "./product-section-proposal-audit") return {
        auditSectionProposals: (options: Parameters<typeof auditSectionProposals>[0]) => auditSectionProposals({ ...options,
          audit: async (input) => { auditCalls.push(input); if (finalAudit) return finalAudit(input, auditCalls.length - 1);
            const { composition } = input; return { ok: true, checked: composition.sections.length, failures: [],
            images: composition.renderNodes.flatMap((node, nodeIndex) => node.kind === "image" ? [{ nodeIndex,
              assetPath: node.assetPath, sha256: crypto.createHash("sha256").update(fs.readFileSync(node.assetPath)).digest("hex") }] : []) }; },
        }),
      };
      if (name === "node:fs") return fs;
      if (name === "node:crypto") return crypto;
      if (name === "./codex-draft-provider") return {
        runCodexDraft: async (options: ReviewCall) => {
          prompt = options.userPrompt;
          calls.push(options);
          return typeof answer === "function" ? answer(options, calls.length - 1) : answer;
        },
      };
      if (name === "../../src/lib/brand-post-image-evidence") return {
        allowsGenericBrandPostProductPhoto, allowsOriginalShoppingScene,
      };
      if (name === "./unbranded-product") return unbrandedProduct;
      if (name === "./product-image-visual-contract") return productImageVisualContract;
      if (name === "./product-source-audit-context") return productSourceAuditContext;
      if (name === "./product-section-review-conflicts") return productSectionReviewConflicts;
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process,
    Buffer,
  }, { filename: "scripts/lib/product-photo-review.ts" });
  return { review: loadedModule.exports as ReviewModule, calls, auditCalls, get prompt() { return prompt; } };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "section-image-review-"));
  const candidate = path.join(root, "seller-photo.jpg");
  fs.writeFileSync(candidate, testPngFixture("seller image bytes"));
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(candidate)).digest("hex");
  const featureTarget = {
    sectionTitle: "냉온풍이 만드는 차이",
    imageIntent: "해당 핵심 기능·작동 방식·조작부를 직접 보여주거나 공식 설명하는 판매페이지 근거 이미지",
  };
  const overviewTarget = {
    sectionTitle: "어떤 제품인지부터 보면",
    imageIntent: "전체 구성 또는 패키지 사진",
  };

  try {
    const rejectedHash = loadReview('{"assignments":[{"targetIndex":1,"selectedIndex":1,"reviewClass":"feature-evidence","reason":"same rejected image"}]}');
    assert.equal((await rejectedHash.review.selectVerifiedProductSectionImages([candidate], "fixture", [{ ...featureTarget, excludedSourceSha256: [sha256] }])).length, 0);
    const bodyAware = loadReview('{"assignments":[]}');
    const body = ["촉촉한 수분 공급이 필요한 경우의 선택 기준입니다."];
    await bodyAware.review.selectVerifiedProductSectionImages([candidate], "fixture", [{ ...featureTarget, sectionBody: body }]);
    assert.match(bodyAware.prompt, /촉촉한 수분 공급/);
    assert.match(bodyAware.prompt, /실제 발행 문장/);
    assert.match(bodyAware.prompt, /실제 발행 문장의 기능과 다른 효능/);
    assert.match(bodyAware.prompt, /"purpose":"feature-evidence"/);
    assert.match(bodyAware.prompt, /"claimPolicy":"direct-requested-feature"/);
    await bodyAware.review.selectVerifiedProductSectionImages([candidate], "fixture", [{ ...featureTarget, sectionBody: ["보송한 마무리 기준입니다."] }]);
    assert.equal(bodyAware.calls.length, 4, "body edits invalidate section review cache; missing verdicts receive one bounded review");
    const selected = JSON.stringify({ name: "fixture", optionFacts: ["색상: 화이트"] });
    await bodyAware.review.selectVerifiedProductSectionImages([candidate], "fixture", [featureTarget], { selectedProduct: selected });
    assert(bodyAware.prompt.includes(selected), "source review receives exact selected variant facts");
    await bodyAware.review.selectVerifiedProductSectionImages([candidate], "fixture", [featureTarget], { selectedProduct: selected.replace("화이트", "블랙") });
    assert.equal(bodyAware.calls.length, 8, "selected option edits invalidate source review cache; incomplete verdicts are not cached");
    const singleBody = loadReview('{"selectedIndex":null}');
    await singleBody.review.selectVerifiedProductSectionImage([candidate], "fixture", "발림", "공식 기능 설명", body);
    assert.match(singleBody.prompt, /촉촉한 수분 공급/);
    await singleBody.review.selectVerifiedProductSectionImage([candidate], "fixture", "발림", "공식 기능 설명", ["보송한 마무리"]);
    assert.equal(singleBody.calls.length, 2, "single review cache includes actual text");
    const diagnosticReports: ProductSectionImageDiagnostics[] = [];
    const diagnosed = loadReview('{"assignments":[],"rejections":[{"targetIndex":1,"selectedIndex":1,"reason":"45분 표시가 없음"},{"targetIndex":2,"selectedIndex":1,"reason":"선택한 상품 외형 불일치"}]}');
    const diagnosticOptions = { onDiagnostics: (report: ProductSectionImageDiagnostics) => diagnosticReports.push(report) };
    await diagnosed.review.selectVerifiedProductSectionImages([candidate], "diagnostic", [featureTarget, overviewTarget], diagnosticOptions);
    assert.equal(diagnosticReports[0].status, "complete");
    assert.equal(diagnosticReports[0].entries.length, 2);
    assert.equal(diagnosticReports[0].entries[0].status, "rejected");
    assert.equal(diagnosticReports[0].entries[0].sourceSha256, sha256);
    assert.equal(diagnosticReports[0].entries[0].reason, "45분 표시가 없음");
    assert.equal(diagnosticReports[0].entries[1].status, "rejected");
    diagnosticReports[0].entries[0].reason = "caller mutation";
    await diagnosed.review.selectVerifiedProductSectionImages([candidate], "diagnostic", [featureTarget, overviewTarget], diagnosticOptions);
    assert.equal(diagnosed.calls.length, 1, "complete actual rejections are cached with diagnostics");
    assert.equal(diagnosticReports[1].cacheHit, true);
    assert.equal(diagnosticReports[1].entries[0].reason, "45분 표시가 없음", "callback cannot corrupt cached diagnostics");
    for (const invalid of ["not json", "{}", "null", '{"assignments":null}']) {
      const broken = loadReview(invalid);
      const failedReports: ProductSectionImageDiagnostics[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(broken.review.selectVerifiedProductSectionImages([candidate], "invalid", [featureTarget], {
          onDiagnostics: report => failedReports.push(report),
        }));
      }
      assert.equal(broken.calls.length, 2, "invalid review must not be cached as completed");
      assert.equal(failedReports[0].status, "failed");
      assert.equal(failedReports[0].entries[0].status, "review-failed");
    }
    const rejected = loadReview('{"assignments":[{"targetIndex":1,"selectedIndex":1,"reviewClass":"product-photo","reason":"generic"}]}');
    assert.equal(rejected.review.allowsGenericProductPhoto(featureTarget), false);
    assert.equal(rejected.review.allowsGenericProductPhoto({
      sectionTitle: "냉온풍이 만드는 차이",
      imageIntent: "냉온풍이 만드는 차이: 구성품·패키지 원본 사진",
    }), false, "a stale package-photo suffix must not override the feature-specific section title");
    for (const term of ["용량", "크기", "설치", "세척", "살균", "소음", "전력", "소재", "안전", "보관", "사용법", "구조"]) {
      assert.equal(rejected.review.allowsGenericProductPhoto({
        sectionTitle: `${term} 선택 기준`, imageIntent: "제품 대표 사진",
      }), false, `${term} feature evidence must not be satisfied by a generic product photo`);
    }
    assert.equal((await rejected.review.selectVerifiedProductSectionImages(
      [candidate], "CRNK 바디드라이어", [featureTarget],
    )).length, 0, "server must reject a generic product-photo classification for a feature slot");
    assert.match(rejected.prompt, /"allowedReviewClasses":\["feature-evidence"\]/u);
    assert.match(rejected.prompt, /feature-evidence만 허용된 파트에 먼저 배정/u);

    const acceptedFeature = loadReview('{"assignments":[{"targetIndex":1,"selectedIndex":1,"reviewClass":"feature-evidence","reason":"조작부가 보임"}]}');
    const featureRows = await acceptedFeature.review.selectVerifiedProductSectionImages(
      [candidate], "CRNK 바디드라이어", [featureTarget],
    );
    assert.equal(featureRows.length, 1);
    assert.equal(featureRows[0].sourceSha256, sha256);
    assert.equal(featureRows[0].reviewClass, "feature-evidence");
    assert.equal(acceptedFeature.calls[0].preserveImageOrder, true);

    const exactCopy = path.join(root, "same-reviewed-pixels-new-path.png");
    fs.copyFileSync(candidate, exactCopy);
    const copiedReports: ProductSectionImageDiagnostics[] = [];
    const copiedRows = await acceptedFeature.review.selectVerifiedProductSectionImages([exactCopy], "CRNK 바디드라이어", [featureTarget], {
      onDiagnostics: report => copiedReports.push(report),
    });
    assert.equal(copiedRows[0].path, exactCopy); assert.equal(copiedReports[0].entries[0].path, exactCopy);
    assert.equal(copiedRows[0].sourceSha256, sha256); assert.equal(copiedReports[0].cacheHit, true);
    assert.equal(acceptedFeature.calls.length, 1); assert.equal(acceptedFeature.auditCalls.length, 1,
      "exact reviewed bytes at a new collector path reuse the verdict without a provider or final audit replay");
    fs.writeFileSync(exactCopy, testPngFixture("modified product option pixels"));
    const modifiedRows = await acceptedFeature.review.selectVerifiedProductSectionImages([exactCopy], "CRNK 바디드라이어", [featureTarget]);
    assert.equal(acceptedFeature.calls.length, 2); assert.equal(acceptedFeature.auditCalls.length, 2);
    assert.notEqual(modifiedRows[0].sourceSha256, sha256, "changed pixels cannot reuse the previous completed review");

    fs.copyFileSync(candidate, exactCopy);
    const singleCopy = loadReview('{"selectedIndex":1,"reviewClass":"feature-evidence","reason":"visible control"}');
    const firstSingle = await singleCopy.review.selectVerifiedProductSectionImage([candidate], "fixture", featureTarget.sectionTitle, featureTarget.imageIntent);
    assert.ok(firstSingle); firstSingle.sourceSha256 = "0".repeat(64); firstSingle.path = "foreign unreviewed path";
    const cachedSingle = await singleCopy.review.selectVerifiedProductSectionImage([exactCopy], "fixture", featureTarget.sectionTitle, featureTarget.imageIntent);
    assert.equal(cachedSingle?.path, exactCopy); assert.equal(cachedSingle?.sourceSha256, sha256); assert.equal(singleCopy.calls.length, 1,
      "a caller cannot change the stored reviewed-byte identity");

    const invalidFinal = loadReview('{"assignments":[{"targetIndex":1,"selectedIndex":1,"reviewClass":"feature-evidence","reason":"visible control"}]}', input => {
      const nodeIndex = input.composition.renderNodes.findIndex(node => node.kind === "image");
      return { ok: false, checked: 1, images: [], failures: [{ nodeIndex, assetPath: candidate, code: "INVALID_REVIEW", reason: "missing final verdict" }] };
    });
    const incompleteReports: ProductSectionImageDiagnostics[] = [];
    assert.equal((await invalidFinal.review.selectVerifiedProductSectionImages([candidate], "incomplete-final", [featureTarget], {
      onDiagnostics: report => incompleteReports.push(report),
    })).length, 0);
    assert.equal(invalidFinal.calls.length, 1); assert.equal(invalidFinal.auditCalls.length, 1,
      "an invalid final verdict cannot renew its proposal or buy another audit in the same operation");
    assert.equal(incompleteReports[0].status, "incomplete");
    assert.equal(incompleteReports[0].entries[0].status, "review-failed");
    assert.equal(incompleteReports[0].entries[0].suitability, "unreviewed",
      "missing final verdict is not proof of a pixel rejection or absent seller original");

    const acceptedOverview = loadReview('{"assignments":[{"targetIndex":1,"selectedIndex":1,"reviewClass":"product-photo","reason":"전체 제품"}]}');
    assert.equal(acceptedOverview.review.allowsGenericProductPhoto(overviewTarget), true);
    assert.equal(acceptedOverview.review.allowsGenericProductPhoto({
      sectionTitle: "아비노 532ml 용량과 전체 구성", imageIntent: "전체 구성 또는 패키지 사진",
    }), true, "identity specification in an overview title is not a feature demonstration");
    assert.equal(acceptedOverview.review.allowsGenericProductPhoto({
      sectionTitle: "아비노 용량 비교와 전체 구성", imageIntent: "전체 구성 또는 패키지 사진",
    }), false, "comparison still requires feature evidence");
    assert.equal(acceptedOverview.review.allowsGenericProductPhoto({
      sectionTitle: "아비노 전체 구성", imageIntent: "용량과 규격 실측 사진",
    }), false, "a feature-specific visual intent cannot be relaxed by an overview title");
    const overviewRows = await acceptedOverview.review.selectVerifiedProductSectionImages(
      [candidate], "CRNK 바디드라이어", [overviewTarget],
    );
    assert.equal(overviewRows.length, 1);
    assert.equal(overviewRows[0].reviewClass, "product-photo");
    assert.match(acceptedOverview.prompt, /"allowedReviewClasses":\["product-photo","feature-evidence"\]/u);

    const rejectedSingle = loadReview('{"selectedIndex":1,"reviewClass":"product-photo","reason":"generic"}');
    assert.equal(await rejectedSingle.review.selectVerifiedProductSectionImage(
      [candidate], "CRNK 바디드라이어", featureTarget.sectionTitle, featureTarget.imageIntent,
    ), null, "single-image path must enforce the same feature-evidence rule");

    const manyCandidates = Array.from({ length: 17 }, (_, index) => {
      const file = path.join(root, `generic-${String(index).padStart(2, "0")}.jpg`);
      fs.writeFileSync(file, testPngFixture(`generic seller photo ${index}`));
      return file;
    });
    const lateEvidence = manyCandidates[16];
    const budgetCandidates = manyCandidates.slice(0, 7);
    const eligiblePool = JSON.stringify({ assignments: budgetCandidates.map((_, index) => ({
      targetIndex: 1, selectedIndex: index + 1, reviewClass: "product-photo", reason: "eligible seller exterior",
    })), rejections: [], notSelected: [] });
    const budgetReports: ProductSectionImageDiagnostics[] = [];
    const exhaustedFinal = loadReview(eligiblePool, (input, callIndex) => {
      assert.equal(input.composition.sections.length, 1);
      const nodeIndex = input.composition.renderNodes.findIndex(node => node.kind === "image");
      const node = input.composition.renderNodes[nodeIndex];
      assert.equal(node.kind, "image");
      if (node.kind !== "image") throw new Error("Missing final audit image fixture");
      assert.equal(node.assetPath, budgetCandidates[callIndex % 6], "a rejected proposal must not re-enter the same audit operation");
      const image = { nodeIndex, assetPath: node.assetPath,
        sha256: crypto.createHash("sha256").update(fs.readFileSync(node.assetPath)).digest("hex") };
      return { ok: false, checked: 1, images: [image], failures: [{ nodeIndex, assetPath: node.assetPath,
        code: "SEMANTIC_REJECTION", reason: ["wrong visible option", "graphic layout", "wrong product identity"][callIndex % 3] }] };
    });
    for (let invocation = 0; invocation < 2; invocation++) {
      assert.equal((await exhaustedFinal.review.selectVerifiedProductSectionImages(budgetCandidates, "bounded-final", [overviewTarget], {
        onDiagnostics: report => budgetReports.push(report),
      })).length, 0, "a seventh proposal without a final verdict must never fill the original slot");
      const diagnostic = budgetReports[invocation];
      assert.equal(diagnostic.status, "incomplete", "six rejected final verdicts do not settle an unaudited seventh proposal");
      assert.equal(diagnostic.cacheHit, false, "incomplete final audit exhaustion must not seal the completed source-review cache");
      assert.match(diagnostic.error || "", /^SOURCE_REVIEW_INCOMPLETE:/u);
      assert.equal(diagnostic.entries.filter(entry => entry.status === "rejected").length, 6);
      const remainingProposal = diagnostic.entries.find(entry => entry.path === budgetCandidates[6])!;
      assert.equal(remainingProposal.status, "proposed"); assert.equal(remainingProposal.suitability, "eligible");
      assert.equal(remainingProposal.selection, "reserve");
      assert.equal(remainingProposal.reviewHistory?.some(entry => entry.stage === "final-audit"), false,
        "a shortlist proposal is never represented as a completed final audit");
      assert.equal(exhaustedFinal.auditCalls.length, (invocation + 1) * 6, "the final audit stays bounded to six calls per explicit operation");
      assert.equal(exhaustedFinal.calls.length, invocation + 1, "a caller receives fresh incomplete diagnostics rather than the old false completion cache");
    }
    await assert.rejects(selectShoppingPrewriteOriginal(budgetCandidates, "bounded-prewrite", "selected-variant",
      exhaustedFinal.review.selectVerifiedProductSectionImages), (error: unknown) =>
      (error as { code?: string }).code === "SOURCE_REVIEW_INCOMPLETE",
    "the real prewriting source gate preserves final-audit exhaustion rather than treating it as absent seller photography");
    assert.equal(exhaustedFinal.auditCalls.length, 18, "prewriting uses the same six-call bound and never audits a seventh proposal");
    const filledWithReserves = loadReview(eligiblePool);
    const filledReports: ProductSectionImageDiagnostics[] = [];
    for (let invocation = 0; invocation < 2; invocation++) {
      assert.equal((await filledWithReserves.review.selectVerifiedProductSectionImages(budgetCandidates, "filled-with-reserves", [overviewTarget], {
        onDiagnostics: report => filledReports.push(report),
      })).length, 1);
      assert.equal(filledReports[invocation].status, "complete", "unneeded alternatives do not invalidate an audited filled target");
    }
    assert.equal(filledReports[1].cacheHit, true);
    assert.equal(filledWithReserves.calls.length, 1); assert.equal(filledWithReserves.auditCalls.length, 1,
      "already accepted exact source pixels are reused without renewed provider or final audit calls");
    const partialFailure = loadReview((_options, callIndex) => callIndex === 0 ? '{"assignments":[]}' : 'invalid');
    const partialReports: ProductSectionImageDiagnostics[] = [];
    await assert.rejects(partialFailure.review.selectVerifiedProductSectionImages(
      manyCandidates, "partial", [featureTarget], { onDiagnostics: report => partialReports.push(report) },
    ));
    assert.equal(partialReports[0].status, "failed", "a partially reviewed collection is not complete");
    assert.equal(partialReports[0].entries.filter(entry => entry.status === "not-proposed").length, 16);
    assert.equal(partialReports[0].entries.filter(entry => entry.status === "review-failed").length, 1);
    const batched = loadReview((_options, callIndex) => callIndex === 0
      ? '{"assignments":[]}'
      : '{"assignments":[{"targetIndex":1,"selectedIndex":1,"reviewClass":"feature-evidence","reason":"후반 URL 기능 패널"}]}');
    const batchedRows = await batched.review.selectVerifiedProductSectionImages(
      manyCandidates, "CRNK 바디드라이어", [featureTarget],
    );
    assert.equal(batched.calls.length, 2, "more than sixteen sources must be reviewed in bounded batches");
    assert.deepEqual(batched.calls.map(call => call.imagePaths.length), [16, 1]);
    assert.equal(batched.calls[0].preserveImageOrder, true);
    assert.equal(batched.calls[1].imagePaths[0], lateEvidence);
    assert.equal(batchedRows[0].sourceSha256,
      crypto.createHash("sha256").update(fs.readFileSync(lateEvidence)).digest("hex"),
      "a relevant late seller URL must remain eligible after sixteen generic local files");

    const sceneTarget = { sectionTitle: "집에서 활용", imageIntent: "상품을 식별할 수 있는 판매자 원본 사진", imageSource: "seller-original" as const };
    const scene = loadReview('{"assignments":[{"targetIndex":1,"selectedIndex":1,"reviewClass":"scene-evidence","reason":"상품이 주방 작업대에 놓인 원본 사진"}]}');
    assert.equal((await scene.review.selectVerifiedProductSectionImages([candidate], "꽃게", [sceneTarget])).length, 1);
    assert.match(scene.prompt, /"allowedReviewClasses":\["product-photo","scene-evidence"\]/u);
    const originalPackshot = loadReview('{"assignments":[{"targetIndex":1,"selectedIndex":1,"reviewClass":"product-photo","reason":"흰 배경에 전체 상품이 보이는 원본 사진"}]}');
    assert.equal((await originalPackshot.review.selectVerifiedProductSectionImages([candidate], "꽃게", [sceneTarget])).length, 1,
      "an explicit original slot accepts a plain seller photo as well as an original lifestyle scene");
    assert.equal(originalPackshot.auditCalls[0].composition.sections[0].imageSource, "seller-original",
      "source review normalization and proposal assembly preserve the explicit original policy for the final pixel gate");
    const shokzBody = ["수영에서는 MP3 모드를 사용하고, 지상에서는 블루투스로 연결할 수 있습니다."];
    const shokzProduct = JSON.stringify({ name: "샥즈 오픈스윔 프로", optionFacts: ["색상: 오렌지", "저장공간: 32GB"] });
    const shokzTarget = { sectionTitle: "수영과 지상에서 쓰는 MP3·블루투스 기준", sectionBody: shokzBody,
      imageIntent: "판매페이지 원본 상품 사진: 선택한 상품·옵션의 외형 확인", imageSource: "seller-original" as const };
    const shokzOriginal = loadReview('{"assignments":[{"targetIndex":1,"selectedIndex":1,"reviewClass":"product-photo","reason":"선택한 오렌지 상품 외형이 보이는 자연스러운 사진"}]}');
    assert.equal((await shokzOriginal.review.selectVerifiedProductSectionImages([candidate], "샥즈 오픈스윔 프로", [shokzTarget], { selectedProduct: shokzProduct })).length, 1,
      "a seller exterior photo beside technical prose need not depict every swimming, land, MP3 and Bluetooth use");
    const shokzLine = shokzOriginal.prompt.split("\n").find(line => line.startsWith("본문 파트 목록:"))!;
    const shokzSlots = JSON.parse(shokzLine.slice(shokzLine.indexOf("[")));
    assert.equal(shokzSlots[0].visualContract.purpose, "product-appearance");
    assert.equal(shokzSlots[0].visualContract.claimPolicy, "visual-compatibility-and-explicit-photo-claims");
    assert.equal(shokzSlots[0].visualContract.demonstrateEveryParagraphFeature, false);
    assert.equal(shokzSlots[0].visualContract.identityAndVisibleOptionMustMatch, true);
    assert.equal(shokzSlots[0].visualContract.photoMustNotClaimUnseenPerformance, true);
    assert.match(shokzSlots[0].sourcePhotoContract, /흰 배경 팩샷 허용/u);
    assert.match(shokzSlots[0].sourcePhotoContract, /운동·생활 공간 배경 필수 아님/u);
    assert.match(shokzOriginal.prompt, /수영·운동·거실·주방 사용 장면이나 생활 배경이 없다는 이유로 거절하지/u);
    assert.deepEqual(shokzSlots[0].sectionBody, shokzBody);
    assert.ok(shokzOriginal.prompt.includes(shokzProduct), "the exact selected option remains part of source review");
    assert.deepEqual(shokzOriginal.auditCalls[0].composition.sections[0].body, shokzBody,
      "source proposal passes the unchanged technical paragraph to the final pixel gate");
    assert.equal(shokzOriginal.auditCalls[0].selectedProduct, shokzProduct);
    const beefProduct = selectedProductContextFrom9Canvas(buildProduct9Canvas({ name: "한우 선물세트",
      description: "미검증 원시 설명", features: ["부위: 등심, 채끝, 차돌박이, 앞다리, 설도", "중량: 1200g"] }));
    const beefTarget = { ...shokzTarget, sectionTitle: "세트에 포함된 차돌박이 외형", sectionBody: ["세트에 포함된 차돌박이의 외형을 보여주는 사진입니다."] };
    const componentProposal = loadReview(call => {
      assert.ok(call.userPrompt.includes(beefProduct), "validated seller-feature membership reaches the first proposal review");
      assert.match(call.userPrompt, /검증된 선택 상품 사실과 실제 픽셀 모두로 같은 세트에 포함됨이 확인/u);
      assert.match(call.userPrompt, /전체 묶음·총중량이 보이지 않는 사유만으로 거부하지/u);
      assert.match(call.userPrompt, /갤러리 출처·파일명만으로 포함을 추정하거나 전체 구성·중량을 인증하지/u);
      assert.match(call.userPrompt, /명시적 전체 사진 약속의 불일치·다른 부위나 옵션·추가 설명판은 거부/u);
      assert.ok(!call.userPrompt.includes("미검증 원시 설명"));
      return JSON.stringify({ assignments: [{ targetIndex: 1, selectedIndex: 1, reviewClass: "product-photo", reason: "검증된 포함 부위와 보이는 차돌박이 외형이 일치하며 전체 세트 사진을 약속하지 않음" }] });
    });
    assert.equal((await componentProposal.review.selectVerifiedProductSectionImages([candidate], "한우 선물세트", [beefTarget], { selectedProduct: beefProduct })).length, 1);
    assert.equal(componentProposal.auditCalls[0].selectedProduct, beefProduct, "the same facts also reach the final proposal audit");
    for (const reason of ["갤러리 출처만 있어 포함 부위가 미확정", "명시한 전체 1200g 세트가 보이지 않음", "다른 부위나 옵션", "추가 설명판"]) {
      const rejectedComponent = loadReview(JSON.stringify({ assignments: [], rejections: [{ targetIndex: 1, selectedIndex: 1, reason }] }));
      assert.equal((await rejectedComponent.review.selectVerifiedProductSectionImages([candidate], "한우 선물세트", [beefTarget], { selectedProduct: beefProduct })).length, 0,
        `component membership guidance never restores a rejected proposal: ${reason}`);
      assert.equal(rejectedComponent.auditCalls.length, 0, "a first-review rejection is never promoted to a final audit");
    }
    const originalFeature = loadReview('{"assignments":[{"targetIndex":1,"selectedIndex":1,"reviewClass":"feature-evidence","reason":"설명 카드"}]}');
    assert.equal((await originalFeature.review.selectVerifiedProductSectionImages([candidate], "꽃게", [sceneTarget])).length, 0,
      "an original photography slot must not be filled by a feature card");
    assert.equal((await scene.review.selectVerifiedProductSectionImages([candidate], "꽃게", [{ ...sceneTarget, imageSource: "staged-ai" }])).length, 0,
      "an original scene cannot silently fill a slot reserved for an AI lifestyle photo");
    assert.equal((await scene.review.selectVerifiedProductSectionImages([candidate], "꽃게", [featureTarget])).length, 0,
      "scene photos cannot stand in for direct feature evidence");
    const alternatives = loadReview(JSON.stringify({ assignments: [
      { targetIndex: 1, selectedIndex: 1, reviewClass: "product-photo", reason: "overview" },
      { targetIndex: 1, selectedIndex: 2, reviewClass: "product-photo", reason: "other overview" },
      { targetIndex: 2, selectedIndex: 1, reviewClass: "feature-evidence", reason: "only feature source" },
    ] }));
    const matched = await alternatives.review.selectVerifiedProductSectionImages(
      manyCandidates.slice(0, 2), "CX PRO", [overviewTarget, featureTarget]);
    assert.equal(matched.length, 2, "flexible overview must leave the only feature source available");
    assert.equal(new Set(matched.map(row => row.sourceSha256)).size, 2, "distinct slots must use distinct bytes");
    // Reproduce the production shortlist failure: three supposedly suitable
    // photos fail the real final gate, while the fourth was only ranked lower.
    const reserveReports: ProductSectionImageDiagnostics[] = [];
    const reserveReview = loadReview((_call, callIndex) => callIndex === 0 ? JSON.stringify({
      assignments: [1, 2, 3].map(selectedIndex => ({ targetIndex: 1, selectedIndex, reviewClass: "product-photo", reason: "선택 옵션의 외형 후보" })),
      rejections: [{ targetIndex: 1, selectedIndex: 4, reason: "선택한 세 장보다 덜 명확합니다" },
        { targetIndex: 1, selectedIndex: 5, reason: "다른 옵션과 추가 설명판" }],
    }) : JSON.stringify({ assignments: [{ targetIndex: 1, selectedIndex: 1, reviewClass: "product-photo", reason: "독립적으로 확인한 선택 옵션의 단일 사진" }] }),
    (input, callIndex) => {
      const nodeIndex = input.composition.renderNodes.findIndex(node => node.kind === "image");
      const node = input.composition.renderNodes[nodeIndex]; assert(node.kind === "image");
      assert.equal(input.selectedProduct, shokzProduct, "renewed shortlist preserves exact selected option");
      assert.deepEqual(input.composition.sections[0].body, shokzBody, "renewed shortlist preserves published prose");
      return { ok: callIndex >= 3, checked: 1,
        images: [{ nodeIndex, assetPath: node.assetPath, sha256: crypto.createHash("sha256").update(fs.readFileSync(node.assetPath)).digest("hex") }],
        failures: callIndex < 3 ? [{ nodeIndex, assetPath: node.assetPath, code: "SEMANTIC_REJECTION", reason: "선택 옵션 식별 불일치" }] : [] };
    });
    const reserveRows = await reserveReview.review.selectVerifiedProductSectionImages(manyCandidates.slice(0, 5), "샥즈 오픈스윔 프로", [shokzTarget], {
      selectedProduct: shokzProduct, onDiagnostics: report => reserveReports.push(report),
    });
    assert.equal(reserveReview.calls.length, 2, "rank-only omission gets one renewed suitability review");
    assert.deepEqual(Array.from(reserveReview.calls[1].imagePaths), [manyCandidates[3]], "wrong-option/explanatory-panel and real pixel rejections never enter renewal");
    assert.equal(reserveReview.auditCalls.length, 4, "renewed fourth candidate must pass the final gate");
    assert.equal(reserveRows.length, 1);
    assert.equal(reserveRows[0].sourceSha256, crypto.createHash("sha256").update(fs.readFileSync(manyCandidates[3])).digest("hex"));
    const reserveEntry = reserveReports[0].entries.find(entry => entry.path === manyCandidates[3])!;
    assert.equal(reserveEntry.status, "proposed"); assert.equal(reserveEntry.suitability, "eligible"); assert.equal(reserveEntry.selection, "assigned");
    assert.deepEqual(Array.from(reserveEntry.reviewHistory || [], row => row.stage), ["proposal", "renewed-proposal"]);
    assert.equal(reserveEntry.reviewHistory?.[0].status, "not-selected", "lower ranking never becomes a factual rejection");
    assert.match(reserveEntry.reviewHistory?.[0].reason || "", /선택한 세 장보다/u, "original observation remains recorded");
    assert.equal(reserveReports[0].entries.filter(entry => entry.status === "rejected").length, 4);
    for (const conflict of ["rejections", "notSelected"]) {
      const contradictory = loadReview(JSON.stringify({ assignments: [{ targetIndex: 1, selectedIndex: 1, reviewClass: "product-photo", reason: "적합" }],
        [conflict]: [{ targetIndex: 1, selectedIndex: 1, reason: "다른 옵션" }] }));
      const conflictReports: ProductSectionImageDiagnostics[] = [];
      assert.equal((await contradictory.review.selectVerifiedProductSectionImages([candidate], "conflict", [overviewTarget], {
        onDiagnostics: report => conflictReports.push(report),
      })).length, 0);
      assert.equal(conflictReports[0].status, "incomplete"); assert.equal(conflictReports[0].errorCode, "SOURCE_REVIEW_CONFLICT");
      assert.equal(conflictReports[0].entries[0].status, "review-failed"); assert.equal(conflictReports[0].entries[0].suitability, "unreviewed");
      assert.equal(contradictory.calls.length, 1, "an ambiguous pair never buys a renewed pixel call");
      assert.equal(contradictory.auditCalls.length, 0, "contradictory first-stage verdict never gets promoted");
      assert.equal((await contradictory.review.selectVerifiedProductSectionImages([candidate], "conflict", [overviewTarget], {
        onDiagnostics: report => conflictReports.push(report),
      })).length, 0);
      assert.equal(contradictory.calls.length, 2, "an explicit second caller cannot reuse an incomplete conflict as a completed cache verdict");
      assert.equal(conflictReports[1].cacheHit, false);
    }
    const rankAndAdverse = loadReview(JSON.stringify({ assignments: [],
      rejections: [{ targetIndex: 1, selectedIndex: 1, reason: "다른 옵션" }],
      notSelected: [{ targetIndex: 1, selectedIndex: 1, reason: "순위가 낮음" }] }));
    const rankConflictReports: ProductSectionImageDiagnostics[] = [];
    assert.equal((await rankAndAdverse.review.selectVerifiedProductSectionImages([candidate], "conflict", [overviewTarget], {
      onDiagnostics: report => rankConflictReports.push(report),
    })).length, 0);
    assert.equal(rankConflictReports[0].errorCode, "SOURCE_REVIEW_CONFLICT");
    assert.equal(rankAndAdverse.auditCalls.length, 0);
    const pairResponse = { assignments: Array.from({ length: 11 }, (_, index) => ({ targetIndex: 1, selectedIndex: index + 1,
      reviewClass: "product-photo", reason: "독립적으로 식별한 상품 외형" })),
      rejections: Array.from({ length: 5 }, (_, index) => ({ targetIndex: 1, selectedIndex: index + 12, reason: "실제 다른 옵션 또는 설명판" })),
      notSelected: [{ targetIndex: 1, selectedIndex: 1, reason: "구성과 라벨 식별이 불확실함" }] };
    const pairIsolated = loadReview(JSON.stringify(pairResponse));
    const pairReports: ProductSectionImageDiagnostics[] = [];
    const pairSelected = await pairIsolated.review.selectVerifiedProductSectionImages(manyCandidates.slice(0, 16), "pair-isolation", [overviewTarget], {
      onDiagnostics: report => pairReports.push(report),
    });
    assert.equal(pairIsolated.calls.length, 1); assert.equal(pairIsolated.auditCalls.length, 1);
    assert.equal(pairSelected.length, 1); assert.equal(pairSelected[0].path, manyCandidates[1], "the conflicting positive row is never adopted");
    assert.equal(pairReports[0].entries.filter(entry => entry.failureCode === "SOURCE_REVIEW_CONFLICT").length, 1);
    assert.equal(pairReports[0].entries.filter(entry => entry.status === "rejected").length, 5, "all genuine pixel rejections remain adverse");
    assert.equal(pairReports[0].status, "complete"); assert.equal(pairReports[0].errorCode, undefined,
      "an unused conflict cannot block another fully audited assignment for the same target");
    await pairIsolated.review.selectVerifiedProductSectionImages(manyCandidates.slice(0, 16), "pair-isolation", [overviewTarget]);
    assert.equal(pairIsolated.calls.length, 1, "the fully audited assignment remains reusable despite an unused ambiguous alternative");
    assert.equal(rankAndAdverse.calls.length, 1, "a rank omission cannot undo an explicit adverse verdict via renewal");
    const unknownReserveReports: ProductSectionImageDiagnostics[] = [];
    const unknownReserve = loadReview(JSON.stringify({ assignments: [], notSelected: [{ targetIndex: 1, selectedIndex: 1, reason: "상위 순위에 들지 않아 미검토" }] }));
    assert.equal((await unknownReserve.review.selectVerifiedProductSectionImages([candidate], "unreviewed", [overviewTarget], {
      onDiagnostics: report => unknownReserveReports.push(report),
    })).length, 0);
    assert.equal(unknownReserve.calls.length, 2, "renewal is bounded even if the reviewer again omits the candidate");
    assert.equal(unknownReserve.auditCalls.length, 0, "unreviewed omissions never become approved pixels");
    assert.equal(unknownReserveReports[0].entries[0].status, "not-selected");
    assert.equal(unknownReserveReports[0].entries[0].suitability, "unreviewed");
    assert.equal(unknownReserveReports[0].status, "incomplete", "unreviewed is not evidence that no original exists");
    await unknownReserve.review.selectVerifiedProductSectionImages([candidate], "unreviewed", [overviewTarget]);
    assert.equal(unknownReserve.calls.length, 4, "incomplete no-assignment results must not seal the cache");
    const omittedReports: ProductSectionImageDiagnostics[] = [];
    const omitted = loadReview((_, callIndex) => callIndex === 0
      ? JSON.stringify({ assignments: [], rejections: [{ targetIndex: 1, selectedIndex: 1, reason: "다른 옵션의 사진" }] })
      : JSON.stringify({ assignments: [{ targetIndex: 1, selectedIndex: 1, reviewClass: "product-photo", reason: "선택 상품 외형 일치" }] }));
    const omittedRows = await omitted.review.selectVerifiedProductSectionImages(manyCandidates.slice(0, 2), "omitted", [overviewTarget], {
      onDiagnostics: report => omittedReports.push(report),
    });
    assert.equal(omitted.calls.length, 2);
    assert.deepEqual(Array.from(omitted.calls[1].imagePaths), [manyCandidates[1]], "only omitted candidate gets a fresh review; genuine rejection stays excluded");
    assert.equal(omittedRows.length, 1); assert.equal(omitted.auditCalls.length, 1, "an omission requires the same final pixel gate");
    assert.equal(omittedReports[0].status, "complete");
    assert.equal(omittedReports[0].entries[1].reviewHistory?.[0].status, "not-proposed");
    assert.equal(omittedReports[0].entries[1].selection, "assigned");
    const allOmitted = Array.from({ length: 48 }, (_, index) => {
      const file = path.join(root, `omitted-${index}.png`);
      fs.writeFileSync(file, testPngFixture(`unreviewed seller candidate ${index}`));
      return file;
    });
    const lateOmission = loadReview((options, callIndex) => {
      assert(options.imagePaths.length <= 16, "review transport stays bounded");
      return JSON.stringify({ assignments: callIndex === 5
        ? [{ targetIndex: 1, selectedIndex: 16, reviewClass: "product-photo", reason: "마지막 후보의 실제 상품 외형 일치" }] : [] });
    });
    const lateOmissionRows = await lateOmission.review.selectVerifiedProductSectionImages(allOmitted, "late-omission", [overviewTarget]);
    assert.equal(lateOmission.calls.length, 6, "at most three initial and three omission batches");
    assert.equal(lateOmissionRows.length, 1);
    assert.equal(lateOmissionRows[0].sourceSha256, crypto.createHash("sha256").update(fs.readFileSync(allOmitted[47])).digest("hex"));
    assert.equal(lateOmission.auditCalls.length, 1, "later omitted candidate is independently audited before assignment");
    const mutableCandidate = path.join(root, "changed-reference.png");
    fs.writeFileSync(mutableCandidate, testPngFixture("before review"));
    const changedReference = loadReview(() => {
      fs.writeFileSync(mutableCandidate, testPngFixture("changed during review"));
      return JSON.stringify({ assignments: [{ targetIndex: 1, selectedIndex: 1, reviewClass: "product-photo", reason: "외형 후보" }] });
    });
    await assert.rejects(changedReference.review.selectVerifiedProductSectionImages([mutableCandidate], "changed", [overviewTarget]), /IMAGE_CHANGED/u);
    assert.equal(changedReference.auditCalls.length, 0, "changed references stop before allocation");
    const sourceDirectory = path.join(root, "canonical-gallery"); fs.mkdirSync(sourceDirectory);
    const galleryFile = path.join(sourceDirectory, "canonical.png");
    fs.writeFileSync(galleryFile, testPngFixture("canonical gallery before"));
    const sourceUrl = "https://shop-phinf.pstatic.net/fixture/canonical.png";
    const receiptFile = `${galleryFile}.retrieval.json`;
    const writeReceipt = () => fs.writeFileSync(receiptFile, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(galleryFile)).digest("hex"), retrievedAt: new Date().toISOString() }));
    writeReceipt();
    const selectedSnapshot = createProductSnapshot({ productId: "canonical-review-product", connectKind: "SHOPPING",
      externalProductId: "selected-sku", sourceUrl: "https://brand.naver.com/fixture/products/1",
      product: { name: "선택 상품", features: ["선택 옵션 화이트"], referenceImageUrls: [sourceUrl] } });
    const context = { selectedProduct: "same selected facts", selectedSourceSnapshot: selectedSnapshot,
      selectedSourceProductId: selectedSnapshot.productId, selectedSourceDirectory: sourceDirectory, sourceSnapshotId: selectedSnapshot.snapshotId };
    const contextReview = loadReview(JSON.stringify({ assignments: [{ targetIndex: 1, selectedIndex: 1, reviewClass: "product-photo", reason: "선택 외형" }] }));
    const collect = (value = context) => contextReview.review.selectVerifiedProductSectionImages([candidate], "canonical", [overviewTarget], value);
    await collect();
    assert.equal(contextReview.auditCalls[0].selectedSourceSnapshot, selectedSnapshot);
    assert.equal(contextReview.auditCalls[0].selectedSourceProductId, selectedSnapshot.productId);
    assert.equal(contextReview.auditCalls[0].selectedSourceDirectory, sourceDirectory);
    assert.equal(contextReview.auditCalls[0].sourceSnapshotId, selectedSnapshot.snapshotId);
    assert.equal(contextReview.auditCalls[0].imageAssets?.[0].provenance, "ORIGINAL");
    await collect(); assert.equal(contextReview.calls.length, 1, "unchanged complete source context reuses its final-reviewed result");
    fs.writeFileSync(galleryFile, testPngFixture("canonical gallery changed"));
    await collect(); assert.equal(contextReview.calls.length, 2, "changed comparison bytes cannot reuse a prior source-final verdict");
    writeReceipt();
    await collect(); assert.equal(contextReview.calls.length, 3, "changed retrieval binding also invalidates the cache");
    const otherSnapshot = createProductSnapshot({ ...selectedSnapshot, product: { ...selectedSnapshot.product, features: ["선택 옵션 블랙"] } });
    await collect({ ...context, selectedSourceSnapshot: otherSnapshot, sourceSnapshotId: otherSnapshot.snapshotId });
    assert.equal(contextReview.calls.length, 4, "changed canonical option facts invalidate even an identical selectedProduct string");
    await assert.rejects(collect({ ...context, sourceSnapshotId: "f".repeat(64) }), /INVALID_CONTEXT/u);
    assert.equal(contextReview.calls.length, 4, "invalid snapshot binding stops before proposal/model/cache reuse");
    await assert.rejects(contextReview.review.selectVerifiedProductSectionImages([candidate], "partial", [overviewTarget], {
      selectedSourceSnapshot: selectedSnapshot }), /INVALID_CONTEXT/u);
    const changedGalleryDuringReview = loadReview(() => {
      fs.writeFileSync(galleryFile, testPngFixture("gallery changed during review"));
      return JSON.stringify({ assignments: [{ targetIndex: 1, selectedIndex: 1, reviewClass: "product-photo", reason: "외형" }] });
    });
    await assert.rejects(changedGalleryDuringReview.review.selectVerifiedProductSectionImages([candidate], "changed-gallery", [overviewTarget], context), /IMAGE_CHANGED/u);
    const mutableSnapshot = createProductSnapshot({ ...selectedSnapshot, product: { ...selectedSnapshot.product, features: ["화이트"] } });
    const mutableContext = { ...context, selectedSourceSnapshot: mutableSnapshot, sourceSnapshotId: mutableSnapshot.snapshotId };
    const changedSnapshotDuringReview = loadReview(() => {
      mutableSnapshot.product.features = ["검수 중 변경된 블랙"];
      return JSON.stringify({ assignments: [{ targetIndex: 1, selectedIndex: 1, reviewClass: "product-photo", reason: "외형" }] });
    });
    await assert.rejects(changedSnapshotDuringReview.review.selectVerifiedProductSectionImages([candidate], "changed-snapshot", [overviewTarget], mutableContext), /INVALID_CONTEXT/u);
    assert.equal(changedSnapshotDuringReview.calls.length, 1);
    const receiptChangedDuringReview = loadReview(() => {
      fs.appendFileSync(receiptFile, " ");
      return JSON.stringify({ assignments: [{ targetIndex: 1, selectedIndex: 1, reviewClass: "product-photo", reason: "외형" }] });
    });
    await assert.rejects(receiptChangedDuringReview.review.selectVerifiedProductSectionImages([candidate], "changed-receipt", [overviewTarget], context), /IMAGE_CHANGED/u);
    console.log("Verified section-image review class, canonical source/cache bindings and server-side evidence gates.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
