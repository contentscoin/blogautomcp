/** Offline only: real local raster decoding, stubbed visual provider. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { auditPublishImages, assertPublishImagesSafe, PublishImageAuditError, type PublishImageAuditOptions } from "./lib/publish-image-audit";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-publish-audit-"));
  let assertions = 0;
  try {
    const photo = path.join(root, "GENERATED_APPROVED_lavender.png");
    const tall = path.join(root, "detail.png");
    await sharp({ create: { width: 320, height: 240, channels: 3, background: "white" } }).png().toFile(photo);
    await sharp({ create: { width: 860, height: 5880, channels: 3, background: "white" } }).png().toFile(tall);
    const good = { index: 1, accepted: true, identityMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, reviewClass: "product-photo", reason: "Visible lavender Stress Relief 532ml pair" };
    const options = (assetPath = photo, count = 1): PublishImageAuditOptions => ({
      productName: "Aveeno lavender Stress Relief 532ml 2pack",
      composition: {
        sections: [{ id: "overview", title: "어떤 제품인지", body: ["선택 상품 라벤더 532ml 2개"], characterCount: 20, imagePaths: [assetPath], imageIntent: "전체 구성 또는 패키지 사진", headingStyle: "plain" }],
        renderNodes: [
          ...Array.from({ length: count }, () => ({ kind: "image" as const, assetPath, sectionId: "overview", role: "detail" as const, altText: "approved", layout: "single" as const, sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" as const })),
          { kind: "heading", sectionId: "overview", text: "어떤 제품인지" },
          { kind: "paragraph", sectionId: "overview", text: "선택 상품 라벤더 532ml 2개" },
        ],
      },
      review: async call => JSON.stringify({ reviews: call.imagePaths!.map((_, i) => ({ ...good, index: i + 1 })) }),
    });
    const check = async (patch: Record<string, unknown>, expected: boolean, input = options()) => {
      input.review = async () => JSON.stringify({ reviews: [{ ...good, ...patch }] });
      assert.equal((await auditPublishImages(input)).ok, expected); assertions++;
    };
    await check({}, true);
    await check({ notice: true, reason: "Expiry notice table" }, false);
    await check({ identityMatches: false, reason: "Wrong fragrance-free Skin Relief" }, false);
    await check({ mixedOptions: true, reason: "Unlabeled mixed Skin Relief and Stress Relief" }, false);
    await check({ mixedOptions: true, explicitNamedComparison: true }, false);
    const comparison = options();
    Object.assign(comparison.composition.sections[0], { title: "라벤더 Stress Relief와 무향 Skin Relief 비교", imageIntent: "두 옵션 비교", body: ["라벤더 Stress Relief와 무향 Skin Relief를 비교한다."] });
    Object.assign(comparison.composition.renderNodes[1], { text: comparison.composition.sections[0].title });
    Object.assign(comparison.composition.renderNodes[2], { text: comparison.composition.sections[0].body[0] });
    await check({ mixedOptions: true, explicitNamedComparison: true, optionsClearlyLabeled: true, reviewClass: "feature-evidence" }, true, comparison);
    const feature = options();
    feature.composition.sections[0].imageIntent = "보습 기능 설명";
    await check({}, false, feature);
    feature.review = async () => JSON.stringify({ reviews: [{ ...good, reason: "선택 제품과 상충하는 다른 브랜드나 옵션 표시는 없습니다." }] });
    const featureFailure = (await auditPublishImages(feature)).failures[0];
    assert.match(featureFailure.reason, /기능 근거 부족/);
    assert.match(featureFailure.reason, /픽셀 관찰/);
    assert.match(featureFailure.reason, /상충하는 다른 브랜드/);
    assertions++;
    await check({ reviewClass: "feature-evidence", reason: "Legible official explanation of this feature" }, true, feature);
    const lifestyle = options();
    lifestyle.composition.sections[0].imageIntent = "AI 연출 이미지: 생활 공간 배치";
    await check({}, true, lifestyle);
    await check({ identityMatches: false }, false, lifestyle);
    lifestyle.review = async call => {
      assert.match(call.userPrompt, /require the visible AI 연출 이미지 disclosure/);
      return JSON.stringify({ reviews: [good] });
    };
    assert.equal((await auditPublishImages(lifestyle)).ok, true);
    assertions++;
    const thumbnail = options();
    Object.assign(thumbnail.composition.renderNodes[0], { role: "thumbnail", sectionId: null });
    await check({ reason: "Correct product with title overlay" }, true, thumbnail);
    await check({ notice: true }, false, thumbnail);
    await check({ mixedOptions: true, explicitNamedComparison: true, optionsClearlyLabeled: true }, false, thumbnail);
    // Reproduce the Cuckoo over-strict policy without pretending a mock is a
    // live visual verdict. These assertions verify the actual provider prompt.
    const cuckoo = options();
    cuckoo.productName = "쿠쿠 건조분쇄형 에코웨일 큐브 2L 음식물처리기 CFD-FNL201DCGW 눌음방지";
    Object.assign(cuckoo.composition.renderNodes[0], { role: "thumbnail", sectionId: null });
    cuckoo.review = async call => {
      assert.match(call.userPrompt, /not OCR certification/);
      assert.match(call.userPrompt, /Classify the image by its main content/);
      assert.match(call.userPrompt, /Other attached candidates are also unverified/);
      assert.match(call.userPrompt, /Missing or small specification text alone must not cause rejection/);
      assert.match(call.userPrompt, /brand plus a generic category alone is not sufficient/);
      assert.match(call.userPrompt, /truncate essential copy so its meaning is materially misleading/);
      assert.doesNotMatch(call.userPrompt, /Unreadable\/uncertain identity rejects|correct complete product/);
      assert.doesNotMatch(call.systemPrompt || "", /When uncertain reject\./);
      return JSON.stringify({ reviews: [{ ...good, reason: "Distinctive selected design is visible; tiny model/capacity print absent, not verified from pixels" }] });
    };
    assert.equal((await auditPublishImages(cuckoo)).ok, true); assertions++;
    await check({ accepted: false, identityMatches: false, reason: "Only brand and generic appliance silhouette visible; distinguishing design obscured" }, false, cuckoo);
    await check({ accepted: false, identityMatches: false, reason: "Visible model label contradicts selected model" }, false, cuckoo);
    await check({ accepted: false, reason: "Clipped essential overlay changes claim meaning" }, false, cuckoo);
    for (const [file, code] of [[tall, "LONG_IMAGE"], [path.join(root, "missing.png"), "MISSING_IMAGE"]]) {
      const input = options(file);
      input.review = async () => { throw new Error("Must reject before provider"); };
      assert.equal((await auditPublishImages(input)).failures[0].code, code); assertions++;
    }
    const batched = options(photo, 19);
    const sizes: number[] = [];
    batched.review = async call => {
      sizes.push(call.imagePaths!.length);
      assert.equal(call.preserveImageOrder, true);
      assert.equal(call.maxImages, call.imagePaths!.length);
      assert.match(call.userPrompt, /actual pixels/);
      return JSON.stringify({ reviews: call.imagePaths!.map((_, i) => ({ ...good, index: i + 1 })) });
    };
    assert.equal((await auditPublishImages(batched)).ok, true);
    assert.deepEqual(sizes, [8, 8, 3]); assertions++;
    for (const answer of ["broken", '{"reviews":[]}', JSON.stringify({ reviews: [good, good] }), JSON.stringify({ reviews: [{ ...good, notice: undefined }] })]) {
      const input = options(); input.review = async () => answer;
      await assert.rejects(assertPublishImagesSafe(input), PublishImageAuditError); assertions++;
    }
    for (const message of ["CODEX_AUTH_REQUIRED", "transport disconnected"]) {
      const error = new Error(message); const input = options(); input.review = async () => { throw error; };
      await assert.rejects(assertPublishImagesSafe(input), e => e === error); assertions++;
    }
    // Reuse the same prepared composition/path with approved-looking metadata:
    // every call still reaches pixel review; an earlier success cannot bypass it.
    const prepared = options(); let calls = 0;
    prepared.review = async () => JSON.stringify({ reviews: [{ ...good, notice: ++calls > 1 }] });
    assert.equal((await auditPublishImages(prepared)).ok, true);
    await assert.rejects(assertPublishImagesSafe(prepared), PublishImageAuditError);
    assert.equal(calls, 2); assertions++;
    const changed = options();
    changed.review = async () => {
      await sharp({ create: { width: 320, height: 240, channels: 3, background: "black" } }).png().toFile(photo);
      return JSON.stringify({ reviews: [good] });
    };
    assert.equal((await auditPublishImages(changed)).failures[0].code, "IMAGE_CHANGED"); assertions++;
    const orphan = options(); Object.assign(orphan.composition.renderNodes[0], { sectionId: "absent" });
    assert.equal((await auditPublishImages(orphan)).failures[0].code, "INVALID_CONTEXT"); assertions++;
    const empty = options(); empty.composition.renderNodes = [];
    assert.equal((await auditPublishImages(empty)).ok, false); assertions++;
    // An old saved comparison must not authorize mixed options when the actual
    // rendered paragraph now discusses only the purchased lavender product.
    const stale = options();
    Object.assign(stale.composition.sections[0], {
      title: "STALE comparison title", body: ["STALE Skin Relief versus Stress Relief"],
      imageIntent: "Skin Relief와 Stress Relief 비교 사진",
    });
    stale.composition.renderNodes.push({ kind: "paragraph", sectionId: "other-section", text: "UNRELATED comparison" });
    stale.review = async call => {
      const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image"))!;
      const slots = JSON.parse(line.slice(line.indexOf("[")));
      assert.equal(slots[0].sectionTitle, "어떤 제품인지");
      assert.deepEqual(slots[0].sectionBody, ["선택 상품 라벤더 532ml 2개"]);
      assert.doesNotMatch(line, /STALE|UNRELATED/);
      assert.match(call.userPrompt, /Only that text can establish explicitNamedComparison/);
      return JSON.stringify({ reviews: [{ ...good, mixedOptions: true, optionsClearlyLabeled: true, explicitNamedComparison: false, reviewClass: "feature-evidence" }] });
    };
    assert.equal((await auditPublishImages(stale)).ok, false); assertions++;
    // Actual quotation/paragraph edits take precedence in the opposite direction too.
    const renderedComparison = options();
    Object.assign(renderedComparison.composition.renderNodes[1], { kind: "quotation", text: "Skin Relief와 Stress Relief 비교" });
    Object.assign(renderedComparison.composition.renderNodes[2], { text: "무향 Skin Relief와 라벤더 Stress Relief를 비교한다." });
    renderedComparison.review = async call => {
      assert.match(call.userPrompt, /"sectionTitle":"Skin Relief와 Stress Relief 비교"/);
      assert.match(call.userPrompt, /"sectionBody":\["무향 Skin Relief와 라벤더 Stress Relief를 비교한다\."\]/);
      return JSON.stringify({ reviews: [{ ...good, mixedOptions: true, explicitNamedComparison: true, optionsClearlyLabeled: true, reviewClass: "feature-evidence" }] });
    };
    assert.equal((await auditPublishImages(renderedComparison)).ok, true); assertions++;
    const renderedFeature = options();
    Object.assign(renderedFeature.composition.renderNodes[1], { text: "보습 효과와 기능" });
    await check({}, false, renderedFeature);
    const missingText = options();
    missingText.composition.renderNodes = missingText.composition.renderNodes.filter(n => n.kind === "image");
    missingText.review = async () => { throw new Error("Missing published context must fail locally"); };
    assert.equal((await auditPublishImages(missingText)).failures[0].code, "INVALID_CONTEXT"); assertions++;
    const headingless = options();
    headingless.composition.renderNodes = headingless.composition.renderNodes.filter(n => n.kind !== "heading");
    await check({}, true, headingless);
    console.log(`PASS publish image audit: ${assertions} offline scenarios (no paid calls)`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
