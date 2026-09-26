/** Regressions for the three first-pass failure causes seen in batch drafting (1.3.80 field report). */
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeDraftSections, sectionEntryToString, splitMergedSection } from "./lib/draft-sections";
import { parseVisualReviews } from "./lib/publish-image-audit";
import { auditSectionProposals } from "./lib/product-section-proposal-audit";
import { assessProductReviewSubstance, productEvidenceRequirement, productSignalAnchor, productSignalCoveredBySentence } from "./lib/product-editorial-plan";
import { isUnbrandedCommodityProduct } from "./lib/unbranded-product";
import { buildPostQualityReport, SHOPPING_POST_CONTRACT_V1 } from "../src/lib/post-composition-contract";
import { detectUnsupportedExperience, getBrandLinkContentReadiness, stripInternalGuidanceSentences } from "./lib/brandlink-content-readiness";
import { IMAGE_RECOVERY_POLICY_VERSION } from "./lib/material-image-recovery";
import { isSeverelyFailingDraft } from "./lib/scheduled-draft-workflow";
import { ensureStaticDecodableImage } from "./lib/product-photo-source";
import { replanShoppingImageCoverage, type ImageReplanDependencies } from "../src/lib/brand-post-image-replan";
import { refreshStoredContentQuality, type BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import { planQualityConvergence } from "./lib/quality-convergence";
import type { BrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { createShoppingFactCard, selectShoppingFactCardFacts, wrapCardText } from "./lib/shopping-fact-card";
import { isShoppingFactCardPath } from "./lib/shopping-fact-card-rule";
import { readProductPhotoSource } from "./lib/product-photo-provenance";
import { classifyBrandPostImageEvidence, isShoppingFactCardAsset } from "../src/lib/brand-post-image-evidence";
import { planSellerVisionBatches } from "./lib/detail-vision-reader";
import { isDraftEditorialQualityPassed } from "../src/lib/brand-post-quality-display";
import { buildProductReviewAnalysis } from "./lib/product-editorial-plan";
import { extractTravelPageResearch, mergeTravelVisionSchedules, assessTravelPageResearchCoverage } from "./lib/travel-content";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createWritingPromptContract, formatWritingPromptContract, getWritingOutputExample } from "./lib/writing-prompt-contract";

async function main() {
  // 1. Structure: object sections, merged sections, and the output example.
  assert.equal(sectionEntryToString({ title: "흡입력", body: "18,000Pa 흡입력이에요.\n덕분에 카펫도 편해요." }), "흡입력\n\n18,000Pa 흡입력이에요.\n덕분에 카펫도 편해요.");
  assert.equal(sectionEntryToString({ heading: "무게", paragraphs: ["1.2kg이에요.", "손목 부담이 적어요."] }), "무게\n\n1.2kg이에요.\n\n손목 부담이 적어요.");
  const merged = ["흡입력", "18,000Pa 흡입력이에요. 카펫도 편해요.", "무게와 손목", "1.2kg이라 가벼워요.", "충전과 사용 시간", "최대 40분 사용해요.", "이런 분께 맞아요", "원룸이라면 잘 맞아요."].join("\n\n");
  assert.equal(splitMergedSection(merged).length, 4);
  assert.equal(normalizeDraftSections([merged], 5).length, 4, "merged string splits on heading boundaries");
  assert.equal(normalizeDraftSections(["A\n\n본문입니다.", "B\n\n본문입니다."], 2).length, 2, "already-structured drafts are untouched");
  assert.deepEqual(splitMergedSection("한 문단만 있습니다."), ["한 문단만 있습니다."]);
  const contract = createWritingPromptContract({ kind: "SHOPPING", minimumSections: 7, maximumSections: 11, targetCharacters: { min: 1800, max: 3600 }, hashtagCount: 4 });
  assert.equal(getWritingOutputExample(contract).sections.length, 2, "the example shows one array element per section");
  assert.match(formatWritingPromptContract(contract), /sections는 7~11개이며 섹션마다 원소 하나\("소제목\\n\\n본문"\)/u);
  const agent = fs.readFileSync("scripts/simple-agent.ts", "utf8");
  assert.match(agent, /const variants = \[\s*candidate,/u, "raw JSON is parsed before curly-quote rewriting");
  assert.match(agent, /DRAFT_OUTPUT_SCHEMA,\s*\);/u, "the draft call requests structured output");
  assert.match(agent, /같은 지시로 1회 재작성/u, "a format-only miss gets one retry instead of failing the item");

  // 2. Product evidence: the prompt and the grader share the same facts and counts; repair notes name missing facts.
  const product = { productName: "일렉트로룩스 Well Q6 무선청소기", sourceDescription: "무선 스틱 청소기",
    sourceFeatures: ["흡입력: 18,000Pa", "배터리: 최대 40분 사용", "무게: 2.4kg", "먼지통 용량: 0.3L"] };
  const requirement = productEvidenceRequirement(product);
  assert.ok(requirement.requiredSignalCount >= 2 && requirement.signals.length >= requirement.requiredSignalCount);
  assert.equal(productSignalAnchor("무게: 2.4kg"), "2.4kg");
  const partial = assessProductReviewSubstance({ ...product, sections: ["흡입력\n\n18,000Pa 흡입력이라 카펫 먼지도 한 번에 빨아들여요. 덕분에 청소 시간이 줄어 편해요."] });
  assert.equal(partial.coveredSignals.length + partial.missingSignals.length, requirement.signals.length);
  assert.ok(partial.missingSignals.length > 0);
  assert.equal(partial.requiredSignalCount, requirement.requiredSignalCount, "prompt requirement equals grader requirement");
  const readiness = getBrandLinkContentReadiness({ productName: product.productName, title: "일렉트로룩스 Well Q6 무선청소기 선택 기준 정리",
    brandLink: "https://naver.me/x", sections: ["흡입력\n\n18,000Pa 흡입력이라 카펫 먼지도 한 번에 빨아들여요. 덕분에 청소 시간이 줄어 편해요.",
      "이 포스팅은 쇼핑커넥트 활동의 일환으로 판매 발생 시 수수료를 제공받습니다."], hashtags: ["무선청소기", "청소기추천", "일렉트로룩스"],
    generationSource: "AI", hasRepresentativeImage: true, requireRepresentativeImage: false, connectKind: "SHOPPING",
    sourceDescription: product.sourceDescription, sourceFeatures: product.sourceFeatures, mode: "editorial" });
  const evidenceNotes = readiness.quality.categories.find((category) => category.key === "productEvidence")!.notes.join(" ");
  assert.match(evidenceNotes, /본문에 아직 없는 확인 사실/u, "repair guidance names the missing facts");
  assert.match(evidenceNotes, /2\.4kg|40분|0\.3L/u);
  assert.match(agent, /\[필수 상품 근거 · 원고 품질검사가 그대로 확인함\]/u, "first-draft prompt lists the graded facts");

  // 3. Visual audit: tolerant parsing, strict on missing fields; malformed proposals are dropped, not fatal.
  const ok = { accepted: true, identityMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, reviewClass: "product-photo", reason: "보풀제거기 본체가 보임" };
  assert.ok(parseVisualReviews(`검토 결과입니다.\n{"reviews":[${JSON.stringify({ ...ok, index: "1" })}]}\n끝`, 1)[0], "prose around JSON and string index are accepted");
  assert.ok(parseVisualReviews(JSON.stringify({ reviews: [{ ...ok, index: 1, notice: "false" }] }), 1)[0]);
  assert.equal(parseVisualReviews(JSON.stringify({ reviews: [{ ...ok, index: 1, notice: undefined }] }), 1)[0], null, "missing safety fields are never guessed");
  assert.equal(parseVisualReviews(JSON.stringify({ reviews: [{ ...ok, index: 1 }, { ...ok, index: 1 }] }), 1)[0], null, "duplicates fail closed");
  const rejected: string[] = [];
  const accepted = await auditSectionProposals({
    productName: "풀라스 보풀제거기", targets: [{ sectionTitle: "날", sectionBody: ["6중 날이에요."], imageIntent: "날 구조" }, { sectionTitle: "충전", sectionBody: ["USB 충전이에요."], imageIntent: "충전 단자" }],
    proposals: [{ targetIndex: 0, path: "/a.png", sourceSha256: "a" }, { targetIndex: 1, path: "/b.png", sourceSha256: "b" }],
    select: (rows) => rows,
    onRejected: (row) => rejected.push(row.sourceSha256),
    audit: async (options) => {
      const nodes = options.composition.renderNodes.flatMap((node, index) => node.kind === "image" ? [index] : []);
      return { ok: false, checked: 2, receiptReused: false,
        images: nodes.map((nodeIndex, i) => ({ nodeIndex, assetPath: i ? "/b.png" : "/a.png", sha256: i ? "b" : "a" })),
        failures: [{ nodeIndex: nodes[0]!, assetPath: "/a.png", code: "INVALID_REVIEW", reason: "Missing, duplicate, or malformed visual verdict." }] } as never;
    },
  });
  assert.deepEqual(rejected, ["a"]);
  assert.deepEqual(accepted.map((row) => row.sourceSha256), ["b"], "a malformed verdict drops only that proposal");
  const auditSource = fs.readFileSync("scripts/lib/publish-image-audit.ts", "utf8");
  assert.match(auditSource, /outputSchema: VISUAL_REVIEW_SCHEMA/u);
  assert.match(auditSource, /형식이 깨진 판정만 한 번 더 묻는다/u);

  // 4. Internal guidance sentences are removed deterministically; headings and other sentences stay.
  const leaked = "자외선 차단\n\nSPF50+ PA++++ 표기예요. 작성 지침에 따라 정리했어요. 덕분에 외출 전에 편해요.";
  assert.equal(stripInternalGuidanceSentences(leaked), "자외선 차단\n\nSPF50+ PA++++ 표기예요. 덕분에 외출 전에 편해요.");
  assert.equal(stripInternalGuidanceSentences("무게\n\n2.4kg이에요."), "무게\n\n2.4kg이에요.");
  assert.match(agent, /severe\s*\n?\s*\? defaultSectionIndexes/u, "badly failing saved drafts are repaired as a whole");

  // 5. Animated or warning-laden seller images get a static sibling; undecodable ones are skipped.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-reliability-"));
  try {
    const frames = await Promise.all(["#f00", "#00f"].map((background) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer()));
    const animated = path.join(dir, "banner.gif");
    await sharp(frames, { join: { animated: true } }).gif({ loop: 0 }).toFile(animated);
    assert.equal((await sharp(fs.readFileSync(animated)).metadata()).pages, 2, "fixture is a real animated GIF");
    const staticPath = await ensureStaticDecodableImage(animated);
    assert.ok(staticPath && staticPath !== animated && staticPath.endsWith(".static.png"));
    const meta = await sharp(fs.readFileSync(staticPath!), { failOn: "warning" }).metadata();
    assert.equal(meta.pages ?? 1, 1, "static sibling is single-frame and passes the audit decode");
    const png = path.join(dir, "clean.png");
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toFile(png);
    assert.equal(await ensureStaticDecodableImage(png), png, "clean images are used as-is");
    const junk = path.join(dir, "junk.jpg");
    fs.writeFileSync(junk, Buffer.from("not an image"));
    assert.equal(await ensureStaticDecodableImage(junk), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 6. Replan: when no seller photo proves the feature, coverage moves to an optional lifestyle slot filled by generation.
  let stored = { version: "brand-post-package/v2", brandLinkId: "fx", connectKind: "SHOPPING", imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
    approvedAt: "old", title: "청소기", createdAt: "c", imageRequirements: { policy: "verified-source-first" },
    composition: { sections: [
      { id: "feature", title: "흡입 구조", body: ["흡입 구조"], imageIntent: "흡입 구조 기능 근거", imageMin: 1, imageMax: 1, imagePaths: [] },
      { id: "fit", title: "잘 맞는 공간", body: ["원룸"], imageIntent: "AI 연출 이미지: 추천 환경의 공간 배치. 실제 사용이나 성능 증명이 아님", imageMin: 0, imageMax: 1, imagePaths: [] },
    ], renderNodes: [] }, imageAssets: [] } as unknown as BrandPostPackageManifestV2;
  const repairCalls: boolean[] = [];
  const deps = {
    read: () => structuredClone(stored),
    write: (value: BrandPostPackageManifestV2) => { stored = value; return value; },
    reconcile: (value: BrandPostPackageManifestV2) => value,
    lock: () => ({ assertOwner() {}, release() {} }),
    slots: (value: BrandPostPackageManifestV2) => value.composition.sections.map((section) => ({
      sectionId: section.id, minimum: section.imageMin!, maximum: section.imageMax!, count: section.imagePaths.length,
      missing: Math.max(0, section.imageMin! - section.imagePaths.length), generatedMinimum: 0, generationMissing: 0, staleTargets: [],
      assets: section.imagePaths.map((file) => ({ path: file, creationMethod: "source-with-generated-background" })),
    })),
    repair: async (options: { sourceOnly?: boolean }) => {
      repairCalls.push(Boolean(options.sourceOnly));
      if (!options.sourceOnly) stored.composition.sections[1].imagePaths = ["generated-fit.png"];
      return { errors: options.sourceOnly ? ["IMAGE_SOURCE_BINDING_REQUIRED: 원본 부족"] : [] };
    },
  } as unknown as ImageReplanDependencies;
  const replanned = await replanShoppingImageCoverage({ brandLinkId: "fx" }, deps);
  assert.deepEqual(repairCalls, [true, false], "source review first, then generation for the lifestyle slot");
  assert.equal(replanned.changed, true);
  assert.equal(replanned.after.missing, 0);
  assert.equal(stored.composition.sections[0].imageMin, 0, "the feature section keeps its text but no longer needs a proof image");
  assert.equal(stored.composition.sections[0].imageIntent, "흡입 구조 기능 근거", "intent is never relabelled");
  assert.equal(stored.composition.sections[1].imageMin, 1);

  // 7. Advice about using the product is not an experience claim; real claims still are.
  for (const advice of ["직접 사용 전에는 팔 안쪽에 먼저 발라 보세요.", "직접 사용할 때는 소량부터 바르는 게 좋아요.",
    "직접 사용하시려면 충전부터 확인하세요.", "직접 사용 시 눈가는 피하세요.", "직접 사용하는 분이라면 용량을 먼저 보세요."]) {
    assert.deepEqual(detectUnsupportedExperience(advice), [], advice);
  }
  for (const claim of ["직접 사용해 보니 촉촉했어요.", "제가 직접 사용했는데 좋았어요.", "2주 동안 발라 봤어요."]) {
    assert.ok(detectUnsupportedExperience(claim).length > 0, claim);
  }

  // 8. Recovery history is keyed by algorithm version, so new replan logic gets one fresh attempt.
  assert.ok(IMAGE_RECOVERY_POLICY_VERSION >= 2);

  // 9. Severely failing saved drafts (half or more categories failing) are rewritten from scratch once.
  const categories = (fails: number) => Array.from({ length: 6 }, (_, index) => ({ status: index < fails ? "fail" : "pass" }));
  assert.equal(isSeverelyFailingDraft({ canPublish: false, quality: { categories: categories(3) } } as never), true);
  assert.equal(isSeverelyFailingDraft({ canPublish: false, quality: { categories: categories(1) } } as never), false);
  assert.equal(isSeverelyFailingDraft({ canPublish: true, quality: { categories: categories(6) } } as never), false);
  assert.equal(isSeverelyFailingDraft(null), false);
  const workflow = fs.readFileSync("scripts/lib/scheduled-draft-workflow.ts", "utf8");
  assert.match(workflow, /reusedSavedDraft && isSeverelyFailingDraft\(previousReadiness\)/u);

  // 10. Replan relaxation: nothing can take the coverage, but the post already has enough images.
  let relaxedStore = { version: "brand-post-package/v2", brandLinkId: "rx", connectKind: "SHOPPING", imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
    approvedAt: "old", title: "보풀제거기", createdAt: "c", heroImagePath: "hero.png", imageRequirements: { policy: "verified-source-first" },
    composition: { sections: [
      { id: "feature", title: "6중 날", body: ["6중 날"], imageIntent: "6중 날 기능 근거", imageMin: 1, imageMax: 1, imagePaths: [] },
      { id: "spec", title: "규격", body: ["규격"], imageIntent: "크기 비교 또는 스펙 이미지", imageMin: 0, imageMax: 1, imagePaths: [] },
      { id: "done", title: "구성", body: ["구성"], imageIntent: "전체 구성 원본", imageMin: 4, imageMax: 4, imagePaths: ["a", "b", "c", "d"] },
    ], renderNodes: [] }, imageAssets: [] } as unknown as BrandPostPackageManifestV2;
  const relaxDeps = {
    read: () => structuredClone(relaxedStore),
    write: (value: BrandPostPackageManifestV2) => { relaxedStore = value; return value; },
    reconcile: (value: BrandPostPackageManifestV2) => value,
    lock: () => ({ assertOwner() {}, release() {} }),
    slots: (value: BrandPostPackageManifestV2) => value.composition.sections.map((section) => ({
      sectionId: section.id, minimum: section.imageMin!, maximum: section.imageMax!, count: section.imagePaths.length,
      missing: Math.max(0, section.imageMin! - section.imagePaths.length), generatedMinimum: 0, generationMissing: 0, staleTargets: [],
      assets: section.imagePaths.map((file) => ({ path: file, creationMethod: "source", sourceReview: { usage: "section-matched-product-evidence", reviewClass: "product-photo" } })),
    })),
    repair: async () => ({ errors: ["IMAGE_SOURCE_BINDING_REQUIRED: 원본 부족"] }),
  } as unknown as ImageReplanDependencies;
  const relaxedResult = await replanShoppingImageCoverage({ brandLinkId: "rx" }, relaxDeps);
  assert.equal(relaxedResult.reason, "COVERAGE_RELAXED_POST_HAS_ENOUGH_IMAGES", "4 section images + hero = 5 meets the floor");
  assert.equal(relaxedResult.after.missing, 0);
  assert.equal(relaxedStore.composition.sections[0].imageMin, 0);
  assert.equal(relaxedStore.composition.sections[0].imageIntent, "6중 날 기능 근거", "intent is not relabelled");
  assert.ok(relaxedStore.pipelineNotes?.some((note) => note.startsWith("IMAGE_COVERAGE_RELAXED")));
  relaxedStore.composition.sections[0].imageMin = 1;
  relaxedStore.composition.sections[2].imagePaths = ["a", "b"];
  relaxedStore.composition.sections[2].imageMin = 2;
  const thin = await replanShoppingImageCoverage({ brandLinkId: "rx" }, relaxDeps);
  assert.match(thin.reason, /^REPLAN_INSUFFICIENT_VERIFIED_ALTERNATIVES · 전체 이미지 3\/5장/u, "too few images overall still asks for more");

  // 11. Grader fact matching: decimals kept, spacing ignored, a numeric token alone suffices (golf-watch case).
  const golf = ["무선 방식", "배터리: 내장배터리", "방수: 생활방수", "사이즈/무게: 가로 47.8mm × 47.8mm × 13.73mm / 30.1g (밴드 미포함)", "오차 범위: ±3m"];
  assert.ok(productSignalCoveredBySentence(golf[3]!, "무게가 30.1g라 손목 부담이 적어요."), "30.1g without incidental words");
  assert.ok(productSignalCoveredBySentence(golf[1]!, "내장 배터리라 건전지가 필요 없어요."), "spacing ignored");
  assert.ok(productSignalCoveredBySentence(golf[4]!, "오차 범위는 ±3m예요."));
  assert.ok(!productSignalCoveredBySentence(golf[3]!, "무게가 30g대라 가벼워요."), "a different number is not the fact");
  const golfReview = assessProductReviewSubstance({ productName: "보이스캐디 T13 PRO", sourceDescription: "시계형 골프거리측정기", sourceFeatures: golf, sections: [
    "가벼운 착용감\n\n무게가 30.1g이에요. 덕분에 18홀 내내 손목 부담이 적어 편해요.\n내장 배터리 방식이에요. 그래서 라운드 전 충전만 해 두면 편해요.",
    "거리 정확도\n\n오차 범위는 ±3m예요. 그래서 그린 공략 거리 판단에 실용적이에요.",
  ] });
  assert.ok(golfReview.evidenceJudgementCount >= golfReview.requiredEvidenceJudgementCount, "judgements now count");
  assert.ok(golfReview.groundedSignalCount >= golfReview.requiredGroundedSignalCount);

  // 12. Unbranded commodity products (fresh food, gift sets without model numbers) use item/packaging identity.
  assert.equal(isUnbrandedCommodityProduct("예다움 상주곶감 반건시 추석 명절 상견례 선물세트"), true);
  assert.equal(isUnbrandedCommodityProduct("운림가 55년전통 국산 전라도 포기 김장 배추 김치 2kg"), true);
  assert.equal(isUnbrandedCommodityProduct("[추석선물 EVENT] 2026 보이스캐디 T13 PRO 시계형 골프거리측정기"), false, "model numbers keep brand identity rules");
  assert.equal(isUnbrandedCommodityProduct("아토케어 듀얼스톰 침구침대청소기"), false);
  assert.match(fs.readFileSync("scripts/lib/publish-image-audit.ts", "utf8"), /isUnbrandedCommodityProduct\(options\.productName\) \? \[UNBRANDED_COMMODITY_IDENTITY_RULE_EN\]/u);
  assert.match(fs.readFileSync("scripts/lib/product-photo-review.ts", "utf8"), /pixelRulesFor\(productName\)/u);

  // 13. Prepare mode keeps the manuscript: no verified hero photo, or a rejected thumbnail, no longer aborts the draft.
  assert.match(agent, /대표 상품 사진을 확보하지 못해 썸네일 없이 원고를 저장합니다/u);
  assert.match(agent, /썸네일 감사 거절 · 다른 검증 원본으로 재생성/u);
  assert.match(agent, /failure\.code === "SEMANTIC_REJECTION" && node\?\.kind === "image" && node\.role === "thumbnail"/u);

  // 14. Seller gallery exhausted (no cutout, no more sources): floor 3, recorded on the composition and honoured by the gate.
  let exhaustedStore = { version: "brand-post-package/v2", brandLinkId: "gx", connectKind: "SHOPPING", imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
    approvedAt: "old", title: "침구청소기", createdAt: "c", heroImagePath: "hero.png", imageRequirements: { policy: "verified-source-first" },
    composition: { sections: [
      { id: "feature", title: "열풍 건조", body: ["열풍 건조"], imageIntent: "열풍 건조 기능 근거", imageMin: 1, imageMax: 1, imagePaths: [] },
      { id: "fit", title: "잘 맞는 집", body: ["원룸"], imageIntent: "AI 연출 이미지: 추천 환경의 공간 배치. 실제 사용이나 성능 증명이 아님", imageMin: 0, imageMax: 1, imagePaths: [] },
      { id: "done", title: "구성", body: ["구성"], imageIntent: "전체 구성 원본", imageMin: 2, imageMax: 2, imagePaths: ["a", "b"] },
    ], renderNodes: [] }, imageAssets: [] } as unknown as BrandPostPackageManifestV2;
  const exhaustedDeps = {
    read: () => structuredClone(exhaustedStore),
    write: (value: BrandPostPackageManifestV2) => { exhaustedStore = value; return value; },
    reconcile: (value: BrandPostPackageManifestV2) => value,
    lock: () => ({ assertOwner() {}, release() {} }),
    slots: (value: BrandPostPackageManifestV2) => value.composition.sections.map((section) => ({
      sectionId: section.id, minimum: section.imageMin!, maximum: section.imageMax!, count: section.imagePaths.length,
      missing: Math.max(0, section.imageMin! - section.imagePaths.length), generatedMinimum: 0, generationMissing: 0, staleTargets: [],
      assets: section.imagePaths.map((file) => ({ path: file, creationMethod: "source", sourceReview: { usage: "section-matched-product-evidence", reviewClass: "product-photo" } })),
    })),
    repair: async (options: { sourceOnly?: boolean }) => ({ errors: options.sourceOnly
      ? ["IMAGE_SOURCE_BINDING_REQUIRED: 원본 부족"]
      : ["shopping-fit: PRODUCT_CUTOUT_REQUIRED: 검증된 상품 사진은 있으나 안전하게 분리 가능한 원본이 없습니다."] }),
  } as unknown as ImageReplanDependencies;
  const exhausted = await replanShoppingImageCoverage({ brandLinkId: "gx" }, exhaustedDeps);
  assert.equal(exhausted.reason, "COVERAGE_RELAXED_SELLER_GALLERY_EXHAUSTED", "2 images + hero = 3 meets the exhausted-gallery floor");
  assert.equal(exhaustedStore.composition.imageFloor, 3);
  const floorReport = (imageFloor?: number) => buildPostQualityReport({ contract: SHOPPING_POST_CONTRACT_V1, preset: "PREMIUM",
    sections: [], imageCount: 3, imageFloor });
  assert.ok(!floorReport(3).blockers.some((blocker) => blocker.includes("이미지가")), "the gate honours the recorded floor");
  const unfilled = { id: "feature", title: "기능", body: ["본문"], characterCount: 0, imagePaths: [], imageIntent: "기능 근거",
    headingStyle: "sectionTitle", imageMin: 1, imageMax: 1 } as never;
  assert.ok(buildPostQualityReport({ contract: SHOPPING_POST_CONTRACT_V1, preset: "PREMIUM", sections: [unfilled], imageCount: 3 })
    .blockers.some((blocker) => blocker.includes("이미지가 5장보다 적습니다")), "with a required slot still empty the contract minimum applies");
  assert.ok(floorReport().warnings.some((warning) => warning.includes("이미지가 5장보다 적습니다")) &&
    !floorReport().blockers.some((blocker) => blocker.includes("이미지가")), "all required slots filled: three images block no longer, the gap is advice");


  // 12. (1.3.85) A passing draft with a warn-level flow signal is not sent to text repair.
  const passing = {
    canPublish: true, verdict: "pass", code: "ok", reason: null, score: 97, summary: "통과",
    signals: [{ key: "editorial-flow", label: "제품정체-기능원리-사용법-장단점-결론 흐름", status: "fail" }],
    blockers: [], qualityFailures: [],
    quality: { score: 97, passScore: 62, categories: [{ key: "usefulness", label: "구매 판단", score: 12, maxScore: 15, status: "warn", notes: ["총점 기준 충족으로 권고 사항으로 처리"] }] },
  } as unknown as BrandLinkContentReadiness;
  const refreshed = refreshStoredContentQuality(passing, { canAutoPublish: true, blockers: [] } as never)!;
  assert.equal(refreshed.canPublish, true, "a text signal already judged by the gate does not block after image refresh");
  assert.equal(refreshStoredContentQuality(passing, { canAutoPublish: false, blockers: ["이미지 부족"] } as never)!.canPublish, false,
    "a composition failure still blocks");
  assert.equal(planQualityConvergence({ current: { ...passing, canPublish: false, verdict: "quality", code: "quality-score-below-threshold" } as BrandLinkContentReadiness,
    attempt: 0, maximumAttempts: 1 }).action, "complete", "no blocker, no failed category, passing score: nothing to rewrite");
  assert.match(agent, /if \(!applied && !\(qualityConvergence && selectedQuality\.canPublish\)\)/u, "an already passing draft is kept, not rejected");

  // 13. (1.3.85) Image-only detail pages: the second vision batch reaches ordinary seller images.
  assert.deepEqual(planSellerVisionBatches([], ["a.jpg", "b.jpg"], 8), [["a.jpg", "b.jpg"]], "no tall crops: seller images are read first");
  assert.deepEqual(planSellerVisionBatches(["c1", "c2"], ["c1", "c2", "g1", "g2"], 8), [["c1", "c2"], ["g1", "g2"]]);
  assert.equal(planSellerVisionBatches(["c"], Array.from({ length: 20 }, (_, i) => `g${i}`), 8)[1].length, 8);
  assert.match(agent, /SOURCE_EVIDENCE_REQUIRED: 제품 자체의 확인 가능한 구성·중량·기능·규격 텍스트 근거가 부족합니다\. \(상세 구간/u,
    "the failure names what was read");

  // 14. (1.3.85) No separable cutout: a flat information card frames the whole verified photo.
  const cardDir = fs.mkdtempSync(path.join(os.tmpdir(), "fact-card-"));
  try {
    const photo = path.join(cardDir, "photo.jpg");
    await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#8aa4c8" } }).jpeg().toFile(photo);
    const facts = ["용량: 4.5L", "소비전력: 300W", "가열식 살균 방식", "연속 사용: 최대 12시간", "무게: 2.1kg"];
    const chosen = selectShoppingFactCardFacts({ facts, sectionText: "가열식 살균 방식이라 물을 끓여 내보내요. 4.5L라 하루 종일 써요." });
    assert.deepEqual(chosen.slice(0, 2).sort(), ["가열식 살균 방식", "용량: 4.5L"].sort(), "facts the section mentions come first");
    assert.deepEqual(wrapCardText("아주아주아주아주 긴 한 줄짜리 사실 문장입니다 계속 길어집니다 끝없이", 10, 2), [], "overlong facts are skipped, not truncated");
    const hashes = new Set<string>();
    for (let variant = 0; variant < 3; variant += 1) {
      const card = await createShoppingFactCard({ sourcePath: photo, title: "가열식이라 위생적인가", facts: chosen, variant, outputDir: cardDir });
      const meta = await sharp(card.outputPath).metadata();
      assert.equal(`${meta.width}x${meta.height}`, "1200x900");
      assert.ok(isShoppingFactCardPath(card.outputPath));
      assert.equal(readProductPhotoSource(card.outputPath)?.segmented, false, "the whole photo is recorded as unsegmented");
      hashes.add(fs.readFileSync(card.outputPath).toString("base64"));
    }
    assert.equal(hashes.size, 3, "variants differ so duplicates are not rejected");
    await assert.rejects(createShoppingFactCard({ sourcePath: photo, title: "t", facts: ["하나"], variant: 0, outputDir: cardDir }), /SHOPPING_FACT_CARD_FACTS_REQUIRED/u);
  } finally {
    fs.rmSync(cardDir, { recursive: true, force: true });
  }
  const cardAsset = { provenance: "EDITORIAL_CARD", creationMethod: "local-composite", remoteGenerated: false } as const;
  assert.ok(isShoppingFactCardAsset(cardAsset));
  assert.deepEqual(classifyBrandPostImageEvidence(cardAsset), { coherent: true, generated: false, reason: null });
  const imageSource = fs.readFileSync("src/lib/brand-post-image-generation.ts", "utf8");
  assert.equal((imageSource.match(/publishFactCard\(requestIndex/gu) || []).length, 2, "both cutout-failure branches try a card first");
  assert.ok(!imageSource.includes("createOriginalProductPhotoOnBackground"), "whole photos are still never put on generated backgrounds");
  let cardStore = structuredClone(stored);
  cardStore.composition.sections[0].imageMin = 1;
  cardStore.composition.sections[1].imageMin = 0;
  cardStore.composition.sections[1].imagePaths = [];
  const cardDeps = { ...deps,
    read: () => structuredClone(cardStore),
    write: (value: BrandPostPackageManifestV2) => { cardStore = value; return value; },
    slots: (value: BrandPostPackageManifestV2) => value.composition.sections.map((section) => ({
      sectionId: section.id, minimum: section.imageMin!, maximum: section.imageMax!, count: section.imagePaths.length,
      missing: Math.max(0, section.imageMin! - section.imagePaths.length), generatedMinimum: 0, generationMissing: 0, staleTargets: [],
      assets: section.imagePaths.map((file) => ({ path: file, ...cardAsset })),
    })),
    repair: async (options: { sourceOnly?: boolean }) => {
      if (!options.sourceOnly) cardStore.composition.sections[1].imagePaths = ["shopping-fact-card-fit.png"];
      return { errors: options.sourceOnly ? ["IMAGE_SOURCE_BINDING_REQUIRED: 원본 부족"] : [] };
    },
  } as unknown as ImageReplanDependencies;
  const cardReplan = await replanShoppingImageCoverage({ brandLinkId: "fx" }, cardDeps);
  assert.equal(cardReplan.reason, "VERIFIED_ALTERNATIVE_COVERAGE", "a fact card carries the moved coverage");
  assert.equal(cardReplan.after.missing, 0);


  // 15. (1.3.86) Fact cards pass approval; advisory signals never read as failures.
  const pkgSource = fs.readFileSync("src/lib/brand-post-package.ts", "utf8");
  assert.match(pkgSource, /!source\.segmented && asset\.creationMethod !== "source" && !isShoppingFactCardAsset\(asset\)/u,
    "the full-frame overlay block exempts flat information cards");
  const flowReadiness = getBrandLinkContentReadiness({
    productName: product.productName, title: `${product.productName} 사용법`, brandLink: "https://naver.me/x", generationSource: "AI",
    hasRepresentativeImage: true, requireRepresentativeImage: false, connectKind: "SHOPPING", experienceMode: "AI_ASSISTED_INFORMATION",
    compositionQualityReport: null, sourceDescription: product.sourceDescription, sourceFeatures: product.sourceFeatures, mode: "editorial",
    hashtags: ["청소기"], sections: ["흡입력\n\n18,000Pa 흡입력이에요.", "고지\n\n이 포스팅은 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다."],
  });
  const flow = flowReadiness.signals.find((signal) => signal.key === "editorial-flow");
  if (flowReadiness.quality.score >= flowReadiness.quality.passScore) assert.notEqual(flow?.status, "fail", "a passing score keeps flow gaps advisory");
  assert.notEqual(flowReadiness.signals.find((signal) => signal.key === "hashtags")?.status, "fail", "one hashtag warns, never fails");
  assert.equal(isDraftEditorialQualityPassed({ canPublish: true, code: "ok", blockers: [], signals: [{ key: "editorial-flow", status: "warn" }],
    quality: { score: 90, passScore: 62, categories: [] } }), true);

  // 16. (1.3.86) Digital/appliance facts read from detail images count as evidence.
  const monitor = buildProductReviewAnalysis({ productName: "삼탠바이미 무빙큐빅스 화이트에디션 X2", description: "", targetSectionCount: 11,
    features: ["화면 크기: 27형", "해상도: 1920x1080 FHD", "주사율: 60Hz", "배터리: 최대 3시간 사용", "무게: 7.9kg", "터치: 10포인트 멀티터치"] });
  assert.notEqual(monitor.evidenceLevel, "sparse");
  assert.ok(monitor.verifiedSignals.some((signal) => signal.includes("27형")) && monitor.verifiedSignals.some((signal) => signal.includes("60Hz")));
  const laptop = buildProductReviewAnalysis({ productName: "베이직북 16", description: "", targetSectionCount: 11,
    features: ["프로세서: 인텔 N100", "메모리: 8GB", "저장용량: 256GB SSD", "무게: 1.6kg"] });
  assert.notEqual(laptop.evidenceLevel, "sparse");

  // 17. (1.3.86) Hotel/free-time packages: itinerary trip places count as visits; vision fills only empty days.
  const nextData = { props: { pageProps: { product: { productName: "동경 4일 시내호텔 3연박", dayPeriod: 4, visitAreas: [{ countryName: "일본", cityName: "도쿄" }], mustSeeTours: { tours: [] },
    schedules: [
      { dayOfSchedule: 1, tripPlaces: [{ placeName: "나리타 공항" }, { placeName: "시부야" }], info: { editors: ["호텔 체크인"] } },
      { dayOfSchedule: 2, tripPlaces: [{ placeName: "하코네" }, { placeName: "오와쿠다니" }], info: { editors: [] } },
      { dayOfSchedule: 3, tripPlaces: [], info: { editors: [] } },
      { dayOfSchedule: 4, tripPlaces: [{ placeName: "하라주쿠" }], info: { editors: ["귀국"] } },
    ] } } } };
  const research = extractTravelPageResearch(nextData);
  if (research) {
    assert.ok(research.highlights.some((item) => item.name === "시부야") && !research.highlights.some((item) => /공항|호텔/u.test(item.name)),
      "trip places fill visits without airports or hotels");
    const before = assessTravelPageResearchCoverage(research);
    assert.ok(before.visitCount >= before.requiredVisitCount);
    const merged = mergeTravelVisionSchedules(research, ["상세 이미지 확인: 3일차: 요코하마 → 미나토미라이", "상세 이미지 확인: 2일차: 다른 일정"]);
    assert.deepEqual(merged!.schedules.find((schedule) => schedule.day === 3)!.activities, ["요코하마", "미나토미라이"]);
    assert.deepEqual(merged!.schedules.find((schedule) => schedule.day === 2)!.activities, research.schedules.find((schedule) => schedule.day === 2)!.activities,
      "vision never overwrites a day the structured data already has");
    assert.equal(assessTravelPageResearchCoverage(merged).sufficient, true);
  } else {
    assert.fail("the fixture NEXT_DATA shape must parse");
  }
  assert.match(agent, /방문지 \$\{coverage\.visitCount\}\/\$\{coverage\.requiredVisitCount\}/u, "the travel failure names the coverage");

  // 18. (1.3.86) Merged travel sections split on markdown, bold, day and symbol headings.
  const mdMerged = Array.from({ length: 7 }, (_, i) => `## ${i + 1}일차 후쿠오카 코스\n나카스 강변을 걸어요. 저녁엔 포장마차가 열려요.`).join("\n");
  assert.equal(normalizeDraftSections([mdMerged], 7).length, 7);
  assert.equal(splitMergedSection(Array.from({ length: 4 }, (_, i) => `${i + 1}일차 타이페이\n고궁 박물관을 둘러봐요.\n지우펀 야경도 좋아요.`).join("\n")).length, 4);
  assert.equal(splitMergedSection(Array.from({ length: 5 }, (_, i) => `■ 포인트 ${i + 1}\n설명 문장입니다.`).join("\n")).length, 5);
  assert.deepEqual(splitMergedSection("1일차 오전에는 공항에서 시내로 이동해요.\n점심은 라멘이에요."), ["1일차 오전에는 공항에서 시내로 이동해요.\n점심은 라멘이에요."],
    "a sentence that starts with a day number is body text");

  // 19. (1.3.86) The travel repair note names the missing places.
  const travelReadiness = getBrandLinkContentReadiness({
    productName: "보라카이 3박4일", title: "보라카이 3박4일 여행", brandLink: "https://naver.me/x", generationSource: "AI",
    hasRepresentativeImage: true, requireRepresentativeImage: false, connectKind: "TRAVEL", experienceMode: "AI_ASSISTED_INFORMATION",
    compositionQualityReport: null, sourceDescription: "", mode: "editorial", hashtags: ["보라카이"],
    sourceFeatures: ["여행 기간: 4일", "핵심 방문지: 화이트비치, 디몰", "1일차 일정: 화이트비치", "2일차 일정: 디몰", "3일차 일정: 호핑투어"],
    sections: ["화이트비치\n\n화이트비치 모래가 고와요. 노을이 예뻐요.", "고지\n\n이 포스팅은 네이버 여행 커넥트 활동의 일환으로, 예약 발생 시 수수료를 제공받습니다."],
  });
  const travelEvidence = travelReadiness.quality.categories.find((category) => category.key === "productEvidence")!;
  assert.equal(travelEvidence.status, "fail");
  assert.ok(travelEvidence.notes.some((note) => note.includes("디몰")), JSON.stringify(travelEvidence.notes));

  console.log("PASS: draft structure normalization + retry, shared evidence requirement + named missing facts, tolerant visual verdicts + non-fatal per-image proposal failures, leak stripping, static seller images, generated lifestyle replan, advice-not-claim, recovery policy version, severe-draft rewrite, coverage relaxation, grader fact matching, unbranded identity, prepare-mode thumbnail recovery, exhausted-gallery floor, recheck/revise agreement, seller-image vision batch, fact cards, card approval, advisory signals, digital facts, travel trip-place visits, heading splits, named missing places");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
