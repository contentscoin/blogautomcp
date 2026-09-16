/** Offline section-image evidence gate regression checks. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { allowsGenericBrandPostProductPhoto } from "../src/lib/brand-post-image-evidence";

interface ReviewModule {
  allowsGenericProductPhoto(target: { sectionTitle: string; imageIntent: string }): boolean;
  selectVerifiedProductSectionImages(
    paths: string[],
    productName: string,
    targets: Array<{ sectionTitle: string; imageIntent: string }>,
  ): Promise<Array<{ targetIndex: number; sourceSha256: string; reviewClass: string }>>;
  selectVerifiedProductSectionImage(
    paths: string[],
    productName: string,
    sectionTitle: string,
    imageIntent: string,
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
        allowsGenericBrandPostProductPhoto,
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
  fs.writeFileSync(candidate, "seller image bytes");
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
      fs.writeFileSync(file, `generic seller photo ${index}`);
      return file;
    });
    const lateEvidence = manyCandidates[16];
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

    console.log("Verified section-image review class and server-side evidence gates.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
