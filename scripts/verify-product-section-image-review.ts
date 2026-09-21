import { publicationImageGeometryIssue } from "./lib/publication-image-geometry";
import { testPngFixture } from "./lib/test-png-fixture";
/** Offline section-image evidence gate regression checks. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { allowsGenericBrandPostProductPhoto, allowsOriginalShoppingScene } from "../src/lib/brand-post-image-evidence";
import type { ProductSectionImageDiagnostics, ProductSectionImageReviewOptions } from "./lib/product-photo-review";

interface ReviewModule {
  allowsGenericProductPhoto(target: { sectionTitle: string; imageIntent: string }): boolean;
  selectVerifiedProductSectionImages(
    paths: string[],
    productName: string,
    targets: Array<{ sectionTitle: string; imageIntent: string; sectionBody?: string[]; excludedSourceSha256?: string[] }>,
    options?: ProductSectionImageReviewOptions,
  ): Promise<Array<{ targetIndex: number; sourceSha256: string; reviewClass: string }>>;
  selectVerifiedProductSectionImage(
    paths: string[],
    productName: string,
    sectionTitle: string,
    imageIntent: string,
    sectionBody?: string[],
  ): Promise<{ sourceSha256: string; reviewClass: string } | null>;
}

type ReviewCall = { userPrompt: string; imagePaths: string[]; maxImages?: number; preserveImageOrder?: boolean };

function loadReview(answer: string | ((options: ReviewCall, callIndex: number) => string)) {
  let prompt = "";
  const calls: ReviewCall[] = [];
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
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process,
    Buffer,
  }, { filename: "scripts/lib/product-photo-review.ts" });
  return { review: loadedModule.exports as ReviewModule, calls, get prompt() { return prompt; } };
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
    assert.match(bodyAware.prompt, /같은 상품의 다른 효능/);
    await bodyAware.review.selectVerifiedProductSectionImages([candidate], "fixture", [{ ...featureTarget, sectionBody: ["보송한 마무리 기준입니다."] }]);
    assert.equal(bodyAware.calls.length, 2, "body edits invalidate section review cache");
    const singleBody = loadReview('{"selectedIndex":null}');
    await singleBody.review.selectVerifiedProductSectionImage([candidate], "fixture", "발림", "공식 기능 설명", body);
    assert.match(singleBody.prompt, /촉촉한 수분 공급/);
    await singleBody.review.selectVerifiedProductSectionImage([candidate], "fixture", "발림", "공식 기능 설명", ["보송한 마무리"]);
    assert.equal(singleBody.calls.length, 2, "single review cache includes actual text");
    const diagnosticReports: ProductSectionImageDiagnostics[] = [];
    const diagnosed = loadReview('{"assignments":[],"rejections":[{"targetIndex":1,"selectedIndex":1,"reason":"45분 표시가 없음"}]}');
    const diagnosticOptions = { onDiagnostics: (report: ProductSectionImageDiagnostics) => diagnosticReports.push(report) };
    await diagnosed.review.selectVerifiedProductSectionImages([candidate], "diagnostic", [featureTarget, overviewTarget], diagnosticOptions);
    assert.equal(diagnosticReports[0].status, "complete");
    assert.equal(diagnosticReports[0].entries.length, 2);
    assert.equal(diagnosticReports[0].entries[0].status, "rejected");
    assert.equal(diagnosticReports[0].entries[0].sourceSha256, sha256);
    assert.equal(diagnosticReports[0].entries[0].reason, "45분 표시가 없음");
    assert.equal(diagnosticReports[0].entries[1].status, "not-proposed");
    diagnosticReports[0].entries[0].reason = "caller mutation";
    await diagnosed.review.selectVerifiedProductSectionImages([candidate], "diagnostic", [featureTarget, overviewTarget], diagnosticOptions);
    assert.equal(diagnosed.calls.length, 1, "empty assignment results are cached with diagnostics");
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

    const sceneTarget = { sectionTitle: "집에서 활용", imageIntent: "집에서 활용: 제품 원형을 보존한 연출컷 또는 원본 사용 장면" };
    const scene = loadReview('{"assignments":[{"targetIndex":1,"selectedIndex":1,"reviewClass":"scene-evidence","reason":"상품이 주방 작업대에 놓인 원본 사진"}]}');
    assert.equal((await scene.review.selectVerifiedProductSectionImages([candidate], "꽃게", [sceneTarget])).length, 1);
    assert.match(scene.prompt, /"allowedReviewClasses":\["scene-evidence"\]/u);
    for (const reviewClass of ["product-photo", "feature-evidence"]) {
      const wrong = loadReview(JSON.stringify({ assignments: [{ targetIndex: 1, selectedIndex: 1, reviewClass, reason: "not a scene" }] }));
      assert.equal((await wrong.review.selectVerifiedProductSectionImages([candidate], "꽃게", [sceneTarget])).length, 0);
    }
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
    console.log("Verified section-image review class and server-side evidence gates.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
