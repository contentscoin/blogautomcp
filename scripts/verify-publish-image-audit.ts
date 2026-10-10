/** Offline only: real local raster decoding, stubbed visual provider. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import sharp from "sharp";
import { auditPublishImages, assertPublishImagesSafe, parseVisualReviews, PublishImageAuditError, type PublishImageAuditOptions } from "./lib/publish-image-audit";
import { REFERENCE_SCENE_CAPTION, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-publish-audit-"));
  let assertions = 0;
  try {
    const photo = path.join(root, "GENERATED_APPROVED_lavender.png");
    const tall = path.join(root, "detail.png");
    await sharp({ create: { width: 320, height: 240, channels: 3, background: "white" } }).png().toFile(photo);
    await sharp({ create: { width: 860, height: 5880, channels: 3, background: "white" } }).png().toFile(tall);
    const good = { index: 1, accepted: true, identityMatches: true, photoClaimMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true, noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo", reason: "Visible lavender Stress Relief 532ml pair" };
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
    await check({ photoClaimMatches: false, accepted: true, reason: "The photograph cannot prove the performance asserted by the paragraph" }, false);
    for (const photoClaimMatches of [undefined, null, "yes", 1]) {
      await check({ photoClaimMatches }, false);
    }
    assert.equal(parseVisualReviews(JSON.stringify({ reviews: [{ ...good, photoClaimMatches: "true" }] }), 1)[0]?.photoClaimMatches, true,
      "the existing boolean-string parser remains compatible with the new required field");
    assert.equal(parseVisualReviews(JSON.stringify({ reviews: [{ ...good, photoClaimMatches: "false" }] }), 1)[0]?.photoClaimMatches, false);
    assertions++;
    for (const key of ["singlePhotograph", "noGraphicLayout", "textPolicyMatches"]) {
      await check({ [key]: false, reason: "Product matches but body output is a framed explanation layout" }, false);
      await check({ [key]: undefined }, false);
    }
    // A repair must expose the actual failed format check and preserve the
    // pixel observation, including decisive evidence near its end.
    for (const [key, expectedReason] of [
      ["singlePhotograph", "단일 자연스러운 사진이 아님"],
      ["noGraphicLayout", "설명판·프레임·인셋 등 그래픽 배치 포함"],
      ["textPolicyMatches", "본문 사진에 추가 설명 텍스트 포함"],
    ]) {
      const detailed = options();
      const observation = `${"상품의 외형과 라벨은 일치합니다. ".repeat(40)}사진 하단에 배송 안내 문구가 추가되어 있습니다.`;
      detailed.review = async () => JSON.stringify({ reviews: [{ ...good, [key]: false, reason: observation }] });
      const failure = (await auditPublishImages(detailed)).failures[0];
      assert.equal(failure.code, "SEMANTIC_REJECTION");
      assert.ok(failure.reason.includes(expectedReason));
      assert.ok(failure.reason.endsWith(observation));
      assertions++;
    }
    const legacyCard = options();
    legacyCard.imageAssets = [{ path: photo, sourcePath: photo, sha256: "a".repeat(64), role: "body", sectionId: "overview", provenance: "EDITORIAL_CARD", creationMethod: "local-composite", remoteGenerated: false }];
    legacyCard.review = async () => { throw new Error("Stored editorial cards must be rejected before remote review"); };
    assert.equal((await auditPublishImages(legacyCard)).failures[0].code, "SEMANTIC_REJECTION"); assertions++;
    const hiddenCardPath = path.join(root, "shopping-fact-card-old.png");
    fs.copyFileSync(photo, hiddenCardPath);
    const hiddenCard = options(hiddenCardPath);
    hiddenCard.review = async () => { throw new Error("A card filename cannot pass by omitting metadata"); };
    assert.equal((await auditPublishImages(hiddenCard)).failures[0].code, "SEMANTIC_REJECTION"); assertions++;
    await check({ notice: true, reason: "Expiry notice table" }, false);
    // A notice describes announcement pixels, never AI provenance or the
    // disclosure outside a correctly bound reference-guided body photograph.
    // These are provider-contract fixtures, not live pixel verdicts.
    const original = path.join(root, "seller-reference.png");
    await sharp({ create: { width: 320, height: 240, channels: 3, background: "#dddddd" } }).png().toFile(original);
    const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const scene = options();
    Object.assign(scene.composition.sections[0], { imageSource: "staged-ai", imageIntent: "AI 연출 이미지: 생활 공간 배치" });
    Object.assign(scene.composition.renderNodes[0], { caption: REFERENCE_SCENE_CAPTION });
    scene.sourceSnapshotId = "offline-selected-product";
    scene.imageAssets = [{ path: photo, sourcePath: photo, sha256: hash(photo), role: "body", sectionId: "overview",
      creationMethod: "reference-guided-scene", provenance: "GENERATED_SCENE", remoteGenerated: true,
      referenceScene: { strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION, sourceSnapshotId: scene.sourceSnapshotId,
        referencePath: original, referenceSha256: hash(original), reviewedOutputSha256: hash(photo), reviewStatus: "passed",
        checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])) } }];
    scene.review = async call => {
      const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image"))!;
      const slots = JSON.parse(line.slice(line.indexOf("[")));
      assert.equal(slots[0].referenceGuidedScene, true);
      assert.equal(slots[0].originalComparisonPassed, true);
      assert.equal(slots[0].adjacentCaption, REFERENCE_SCENE_CAPTION);
      const schema = call.outputSchema as { properties: { reviews: { items: { required: string[]; properties: Record<string, { type: string; description?: string }> } } } };
      for (const text of [call.userPrompt, schema.properties.reviews.items.properties.notice.description!]) {
        assert.match(text, /notice=true ONLY means a shipping, service or seller announcement visible in the attached IMAGE PIXELS/);
        assert.match(text, /never means AI-generated provenance, an illustrative image intent, the need for AI disclosure, or an adjacentCaption\/article disclosure outside the image/);
        assert.match(text, /Set notice=false for those contexts/);
        assert.match(text, /burned into a body photo, reject it using textPolicyMatches\/noGraphicLayout/);
      }
      for (const text of [call.userPrompt, schema.properties.reviews.items.properties.singlePhotograph.description!]) {
        assert.match(text, /ONE physical product and its optically consistent reflection/);
        assert.match(text, /ordinary mirror and its physical frame are scene props, not a graphic photo frame/);
        assert.match(text, /Reject independent duplicate physical products/);
        assert.match(text, /physically inconsistent\/impossible reflections/);
      }
      assert.match(call.userPrompt, /noGraphicLayout means no graphic frame around a seller photo/);
      assert.ok(schema.properties.reviews.items.required.includes("notice"));
      assert.equal(schema.properties.reviews.items.properties.notice.type, "boolean");
      const validate = new Ajv({ allErrors: true }).compile(call.outputSchema as object);
      assert.equal(validate({ reviews: [good] }), true);
      // True adverse findings are schema-valid and still blocked downstream.
      assert.equal(validate({ reviews: [{ ...good, notice: true }] }), true);
      for (const notice of [undefined, null, "true", "false", "yes", 1, [], {}])
        assert.equal(validate({ reviews: [{ ...good, notice }] }), false, "the emitted schema requires an actual boolean notice verdict");
      return JSON.stringify({ reviews: [{ ...good, reason: "One selected product in a natural illustrative scene; AI disclosure is an adjacent caption, no announcement pixels" }] });
    };
    assert.equal((await auditPublishImages(scene)).ok, true); assertions++;
    // Contract regressions for the real Cuckoo rejection: all identity/format
    // findings were true, yet accepted=false because the product filled the
    // foreground. Synthetic pixels below test prompt/schema and gate behavior,
    // never claim that a live candidate has passed a new visual audit.
    const cuckooContext: PublishImageAuditOptions = { ...scene, productName: "쿠쿠 에코웨일 큐브 음식물처리기",
      selectedProduct: "쿠쿠 에코웨일 큐브 화이트 2L", composition: structuredClone(scene.composition) };
    const kitchenTitle = "주방에서 어떤 장면에 잘 맞을까";
    const kitchenBody = "화이트 큐브형 본체를 주방 조리대에 배치한 모습을 보여줍니다. 사진은 처리 방식이나 성능을 입증하는 자료가 아닙니다.";
    Object.assign(cuckooContext.composition.sections[0], { title: kitchenTitle, body: [kitchenBody],
      imageIntent: "AI 연출 이미지: 주방 생활 맥락을 보여주는 자연스러운 사진. 실제 사용 후기나 기능·수치·성능의 증거가 아님" });
    Object.assign(cuckooContext.composition.renderNodes[0], { role: "scene" });
    Object.assign(cuckooContext.composition.renderNodes[1], { text: kitchenTitle });
    Object.assign(cuckooContext.composition.renderNodes[2], { text: kitchenBody });
    cuckooContext.review = async call => {
      const schema = call.outputSchema as { properties: { reviews: { items: { required: string[]; properties: Record<string, { type: string; description?: string }> } } } };
      const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image"))!;
      const [slot] = JSON.parse(line.slice(line.indexOf("[")));
      assert.equal(slot.role, "scene");
      assert.equal(slot.referenceGuidedScene, true);
      assert.equal(slot.visualContract.purpose, "lifestyle-illustration");
      assert.deepEqual(slot.sectionBody, [kitchenBody]);
      for (const text of [call.userPrompt, schema.properties.reviews.items.properties.accepted.description!]) {
        assert.match(text, /natural photograph.*not a drawn illustration, diagram or information card/u);
        assert.match(text, /Product-focused close-up photography is allowed when coherent setting cues remain visibly present/u);
        assert.match(text, /large foreground product alone is not an intent mismatch/u);
        assert.match(text, /No person, hands, wearing, use action, wide room view or staged price\/payment action is required/u);
        assert.match(text, /a kitchen intent needs coherent kitchen cues/u);
        assert.match(text, /isolated white-background catalog photo cannot satisfy that setting/u);
        assert.match(text, /still reject implausible real-world scale, contact or placement, wrong identity\/options, distorted structure/u);
        assert.match(text, /without overriding the separate identity, format and photoClaim verdicts/u);
      }
      assert.match(call.userPrompt, /Use ONLY the role assigned to this exact index/u);
      assert.match(call.userPrompt, /role=scene is a body image, never a thumbnail/u);
      assert.match(call.userPrompt, /Seller-added product-name typography outside the physical product is added body-image text/u);
      assert.equal(schema.properties.reviews.items.properties.accepted.type, "boolean");
      assert.ok(schema.properties.reviews.items.required.includes("accepted"));
      const validate = new Ajv({ allErrors: true }).compile(call.outputSchema as object);
      assert.equal(validate({ reviews: [{ ...good, accepted: false }] }), true, "a real adverse verdict remains schema-valid and must block downstream");
      for (const accepted of [undefined, null, "yes", 1]) assert.equal(validate({ reviews: [{ ...good, accepted }] }), false);
      return JSON.stringify({ reviews: [{ ...good, reason: "Correct white CUCKOO foreground product on a kitchen counter; coherent cabinets and utensils are visible, no people or use action, no proof claim" }] });
    };
    assert.equal((await auditPublishImages(cuckooContext)).ok, true); assertions++;
    for (const patch of [
      { accepted: false, reason: "쿠쿠 외형과 단일 주방 사진은 맞지만 전경 상품이 커 생활 맥락 일러스트 의도와 맞지 않습니다." },
      { accepted: false, reason: "No kitchen setting is visible; this is an isolated white-background catalog photo" },
      { accepted: false, reason: "Physically implausible product scale or unsupported contact with the counter" },
      { identityMatches: false, reason: "The kitchen setting is correct but a distinguishable wrong product model is shown" },
      { singlePhotograph: false, reason: "Product-focused kitchen layout is a collage, not one natural photograph" },
      { noGraphicLayout: false, reason: "The compatible foreground product is pasted inside a graphic frame" },
      { textPolicyMatches: false, reason: "Seller-added product-name typography is burned into this scene/body photo" },
      { photoClaimMatches: false, reason: "The body claims the scene proves price or processing performance that pixels cannot establish" },
    ]) await check(patch, false, cuckooContext);
    for (const accepted of [undefined, null, "yes", 1]) {
      const malformed = await auditPublishImages({ ...cuckooContext, review: async () => JSON.stringify({ reviews: [{ ...good, accepted }] }) });
      assert.equal(malformed.failures[0].code, "INVALID_REVIEW"); assertions++;
    }
    for (const reason of ["배송 중단·반품 안내 표지가 이미지 픽셀에 보임", "AAWireless 제품 외형은 맞지만 AI 연출 이미지 고지 대상"]) {
      const rejected = await auditPublishImages({ ...scene, review: async () => JSON.stringify({ reviews: [{ ...good, notice: true, reason }] }) });
      assert.equal(rejected.ok, false);
      assert.equal(rejected.failures[0].code, "SEMANTIC_REJECTION");
      assert.equal(rejected.failures[0].rejectionScope, "product");
      assert.match(rejected.failures[0].reason, /공지·안내 이미지/);
      assert.ok(rejected.failures[0].reason.endsWith(reason), "notice=true is never normalized away because its reason mentions AI");
      assertions++;
    }
    for (const notice of [undefined, null, "yes", 1, [], {}]) {
      const invalid = await auditPublishImages({ ...scene, review: async () => JSON.stringify({ reviews: [{ ...good, notice }] }) });
      assert.equal(invalid.failures[0].code, "INVALID_REVIEW"); assertions++;
    }
    const addedDisclosure = await auditPublishImages({ ...scene, review: async () => JSON.stringify({ reviews: [{ ...good,
      notice: false, textPolicyMatches: false, reason: "AI 연출 설명 문구가 본문 사진의 픽셀 위에 추가되어 있음" }] }) });
    assert.equal(addedDisclosure.failures[0].code, "SEMANTIC_REJECTION");
    assert.match(addedDisclosure.failures[0].reason, /본문 사진에 추가 설명 텍스트/); assertions++;
    await check({ reason: "One physical selected dryer and its geometrically consistent mirror reflection in a single bathroom photograph" }, true, scene);
    for (const patch of [
      { singlePhotograph: false, reason: "Two independent physical dryers are staged as one selected unit" },
      { singlePhotograph: false, reason: "A second product has been pasted into an inset panel" },
      { singlePhotograph: false, reason: "Reflected pose and perspective cannot be explained by the mirror surface" },
      { identityMatches: false, reason: "The reflected product has a contradictory model silhouette" },
      { noGraphicLayout: false, reason: "A seller photograph is pasted inside a graphic explanation frame" },
      { accepted: false, reason: "All checks true but the model still rejects the mirrored product" },
    ]) await check(patch, false, scene);
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
    await check({ reviewClass: "feature-evidence", reason: "Photograph directly shows the visible seam and closure" }, true, feature);
    await check({ reviewClass: "feature-evidence", noGraphicLayout: false, reason: "Official explanatory feature panel" }, false, feature);
    const shokz = options();
    shokz.productName = "샥즈 오픈스윔 프로";
    shokz.selectedProduct = JSON.stringify({ name: shokz.productName, optionFacts: ["색상: 오렌지", "저장공간: 32GB"] });
    const shokzTitle = "수영과 지상에서 쓰는 MP3·블루투스 기준";
    const shokzBody = "수영에서는 MP3 모드를 사용하고, 지상에서는 블루투스로 연결할 수 있습니다.";
    Object.assign(shokz.composition.sections[0], { title: shokzTitle, body: [shokzBody], imageSource: "seller-original",
      imageIntent: "판매페이지 원본 상품 사진: 선택한 상품·옵션의 외형 확인" });
    Object.assign(shokz.composition.renderNodes[1], { text: shokzTitle });
    Object.assign(shokz.composition.renderNodes[2], { text: shokzBody });
    shokz.review = async call => {
      const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image"))!;
      const slots = JSON.parse(line.slice(line.indexOf("[")));
      assert.equal(slots[0].visualContract.purpose, "product-appearance");
      assert.equal(slots[0].visualContract.claimPolicy, "visual-compatibility-and-explicit-photo-claims");
      assert.equal(slots[0].visualContract.demonstrateEveryParagraphFeature, false);
      assert.equal(slots[0].visualContract.identityAndVisibleOptionMustMatch, true);
      assert.equal(slots[0].visualContract.photoMustNotClaimUnseenPerformance, true);
      assert.equal(slots[0].sectionTitle, shokzTitle);
      assert.deepEqual(slots[0].sectionBody, [shokzBody]);
      assert.ok(call.userPrompt.includes(JSON.stringify(shokz.selectedProduct)), "final review keeps exact selected product and option context");
      assert.match(call.userPrompt, /Technical prose alone does not make a correct seller overview into feature evidence/);
      assert.match(call.userPrompt, /Even when allowProductPhoto=true, reject generic photos used as proof of a feature claim/);
      const schema = call.outputSchema as { properties: { reviews: { items: { required: string[]; properties: Record<string, { type: string }> } } } };
      assert.ok(schema.properties.reviews.items.required.includes("photoClaimMatches"));
      assert.equal(schema.properties.reviews.items.properties.photoClaimMatches.type, "boolean");
      return JSON.stringify({ reviews: [{ ...good, reason: "A coherent seller photograph shows the selected orange exterior; the prose does not claim photographic performance proof" }] });
    };
    assert.equal((await auditPublishImages(shokz)).ok, true); assertions++;
    for (const patch of [
      { identityMatches: false, reason: "Visible different option or model" },
      { textPolicyMatches: false, reason: "Added headline on a body photo" },
      { noGraphicLayout: false, reason: "Seller photo inside an explanation frame" },
    ]) await check(patch, false, shokz);
    const photoProof = structuredClone(shokz.composition);
    Object.assign(photoProof.renderNodes[2], { text: "이 사진이 소음 감소 효과를 증명합니다." });
    const unsupportedPhotoProof = await auditPublishImages({ ...shokz, composition: photoProof,
      review: async call => {
        assert.ok(call.userPrompt.includes("이 사진이 소음 감소 효과를 증명합니다."));
        return JSON.stringify({ reviews: [{ ...good, accepted: true, photoClaimMatches: false,
          reason: "A static seller exterior photo cannot prove noise reduction" }] });
      } });
    assert.equal(unsupportedPhotoProof.ok, false);
    assert.equal(unsupportedPhotoProof.failures[0].code, "SEMANTIC_REJECTION");
    assert.equal(unsupportedPhotoProof.failures[0].rejectionScope, "section", "unsupported photo proof does not reject the product's bytes globally");
    assert.match(unsupportedPhotoProof.failures[0].reason, /사진을 기능·성능·결과의 증거/);
    assertions++;
    // Offline provider-contract boundaries: a disclaimer is not photo proof,
    // while a precise claim about visible label text still needs legible pixels.
    const aveenoAppearance = options();
    const aveenoBody = ["제품 이미지에서는 바디워시 펌프 용기와 라벤더 연출을 확인할 수 있어요.",
      "사진은 외관과 향 콘셉트를 보여주는 자료이며 피부 효과나 실제 향의 강도를 입증하진 않습니다."];
    Object.assign(aveenoAppearance.composition.sections[0], { imageSource: "seller-original",
      imageIntent: "판매페이지 원본 상품 사진: 선택한 상품·옵션의 외형 확인" });
    aveenoAppearance.composition.renderNodes.splice(2, 1, ...aveenoBody.map(text => ({ kind: "paragraph" as const, sectionId: "overview", text })));
    aveenoAppearance.review = async call => {
      const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image"))!;
      const slots = JSON.parse(line.slice(line.indexOf("[")));
      assert.equal(slots[0].visualContract.purpose, "product-appearance");
      assert.deepEqual(slots[0].sectionBody, aveenoBody);
      assert.match(call.userPrompt, /A negation or disclaimer that the photo does NOT prove an effect is not a proof claim/);
      return JSON.stringify({ reviews: [{ ...good, photoClaimMatches: true,
        reason: "The selected exterior and lavender concept match; the paragraph explicitly disclaims skin-efficacy proof" }] });
    };
    assert.equal((await auditPublishImages(aveenoAppearance)).ok, true); assertions++;
    const dalbaPixelClaim = options();
    dalbaPixelClaim.productName = "[2주 잡티 개선 프로그램] 달바 비타 토닝 3종 세트 토너 180ml+세럼 100ml+크림 단지형 55g+퍼스널 케어 4종 증정";
    dalbaPixelClaim.selectedProduct = JSON.stringify({ name: dalbaPixelClaim.productName, selectedOption: { status: "not-applicable" },
      optionFacts: ["토너 180ml", "세럼 100ml", "크림 단지형 55g", "퍼스널 케어 4종 증정"] });
    const dalbaBody = ["이미지에서 확인되는 제품은 달바 비타 토닝 세럼 토너이며 라벨에 100ml라고 적혀 있어요.",
      "세트의 토너 180ml와 이미지 속 제품 용량이 달라 동일", "구성인지 구매 화면에서 대조할 필요가 있습니다."];
    Object.assign(dalbaPixelClaim.composition.sections[0], { imageSource: "seller-original",
      imageIntent: "판매페이지 원본 상품 사진: 선택한 상품·옵션의 외형 확인" });
    dalbaPixelClaim.composition.renderNodes.splice(2, 1, ...dalbaBody.map(text => ({ kind: "paragraph" as const, sectionId: "overview", text })));
    dalbaPixelClaim.review = async call => {
      const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image"))!;
      const slots = JSON.parse(line.slice(line.indexOf("[")));
      assert.equal(slots[0].visualContract.purpose, "product-appearance");
      assert.deepEqual(slots[0].sectionBody, dalbaBody);
      assert.ok(call.userPrompt.includes(JSON.stringify(dalbaPixelClaim.selectedProduct)));
      assert.match(call.userPrompt, /verify explicit pixel assertions such as 'the photo label reads 100ml' against actually legible confirming pixels/);
      assert.match(call.userPrompt, /This differs from requiring OCR of specifications merely supplied as product facts/);
      return JSON.stringify({ reviews: [{ ...good, accepted: true, identityMatches: true, photoClaimMatches: false,
        reason: "The tiny label is unreadable, so the precise published 100ml label assertion is unsupported; selected product facts specify 180ml" }] });
    };
    const dalbaAudit = await auditPublishImages(dalbaPixelClaim);
    assert.equal(dalbaAudit.ok, false);
    assert.equal(dalbaAudit.failures[0].code, "SEMANTIC_REJECTION");
    assert.equal(dalbaAudit.failures[0].rejectionScope, "section");
    assert.match(dalbaAudit.failures[0].reason, /100ml/);
    assertions++;
    const lifestyle = options();
    lifestyle.composition.sections[0].imageIntent = "AI 연출 이미지: 생활 공간 배치";
    await check({}, true, lifestyle);
    await check({ identityMatches: false }, false, lifestyle);
    lifestyle.review = async call => {
      assert.match(call.userPrompt, /Never require or allow AI disclosure burned into body-image pixels/);
      return JSON.stringify({ reviews: [good] });
    };
    assert.equal((await auditPublishImages(lifestyle)).ok, true);
    assertions++;
    const thumbnail = options();
    Object.assign(thumbnail.composition.renderNodes[0], { role: "thumbnail", sectionId: null });
    await check({ reason: "Correct product with title overlay" }, true, thumbnail);
    await check({ thumbnailHeadlineLegible: false, reason: "Headline is too small at preview size" }, false, thumbnail);
    await check({ noGraphicLayout: false, reason: "Tiny product photo inside a blue explanation panel" }, false, thumbnail);
    await check({ notice: true }, false, thumbnail);
    await check({ mixedOptions: true, explicitNamedComparison: true, optionsClearlyLabeled: true }, false, thumbnail);
    // Reproduce the Cuckoo over-strict policy without pretending a mock is a
    // live visual verdict. These assertions verify the actual provider prompt.
    const cuckoo = options();
    cuckoo.productName = "쿠쿠 건조분쇄형 에코웨일 큐브 2L 음식물처리기 CFD-FNL201DCGW 눌음방지";
    Object.assign(cuckoo.composition.renderNodes[0], { role: "thumbnail", sectionId: null });
    cuckoo.review = async call => {
      assert.match(call.userPrompt, /not OCR certification/);
      assert.match(call.userPrompt, /Every body image must be ONE natural photograph/);
      assert.match(call.userPrompt, /Other attached candidates are also unverified/);
      assert.match(call.userPrompt, /Missing or small specification text alone must not cause rejection/);
      assert.match(call.userPrompt, /brand plus a generic category alone is not sufficient/);
      assert.match(call.userPrompt, /clipped essential words/);
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
