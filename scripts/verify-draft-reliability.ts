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
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
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
  assert.ok(floorReport().blockers.some((blocker) => blocker.includes("이미지가 5장보다 적습니다")), "without a floor the contract minimum still applies");

  console.log("PASS: draft structure normalization + retry, shared evidence requirement + named missing facts, tolerant visual verdicts + non-fatal per-image proposal failures, leak stripping, static seller images, generated lifestyle replan, advice-not-claim, recovery policy version, severe-draft rewrite, coverage relaxation, grader fact matching, unbranded identity, prepare-mode thumbnail recovery, exhausted-gallery floor");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
