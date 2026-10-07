/** Offline: references and outputs are synthetic fixtures; every vision/transport call is injected. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import sharp from "sharp";
import { testPngFixture } from "./lib/test-png-fixture";
import { buildShoppingReferenceScenePrompt, reviewShoppingReferenceScene, selectShoppingSceneReference,
  SCENE_FIDELITY_CHECKS, SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION, type ShoppingSceneReference } from "./lib/shopping-reference-scene";
import { assertProductImageReferences } from "../src/lib/codex-image-generation";
import type { BrandPostPackageManifestV2, applyGeneratedBrandPostImage } from "../src/lib/brand-post-package";
import type { ResolvedImageTarget } from "../src/lib/brand-post-image-generation";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shopping-reference-scene-"));
  process.env.DESKTOP_USER_DATA = root;
  const generation = await import("../src/lib/brand-post-image-generation");
  const file = (name: string) => {
    const target = path.join(root, `${name}.png`);
    fs.writeFileSync(target, Buffer.concat([testPngFixture(name), Buffer.alloc(2048)]));
    return target;
  };
  const hash = (target: string) => crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  try {
    const angled = file("angled"), front = file("front"), output = file("output"), anchor = file("approved-anchor");
    const reviewed: string[][] = [];
    const reference = await selectShoppingSceneReference({ paths: [angled, front], productName: "정면 테스트 상품", selectedProduct: "선택 옵션 A" }, {
      verify: async paths => paths,
      review: async call => {
        reviewed.push(call.imagePaths!);
        return JSON.stringify({ identityMatches: true, geometryReadable: call.imagePaths![0] === front,
          completeShape: true, notDeformed: true, unobstructed: true,
          subject: "right-hand intact front-facing instance", geometry: "level seal; centered short cap; 2.3:1 ratio", labels: "brand above original product line", reason: "visible whole front" });
      },
    });
    assert.equal(reference.path, front, "an unreadable severely foreshortened original must not become the geometry reference");
    assert.deepEqual(reviewed, [[angled], [front]]);
    await assert.rejects(selectShoppingSceneReference({ paths: [file("deformed")], productName: "different", selectedProduct: "other" }, {
      verify: async paths => paths,
      review: async () => JSON.stringify({ identityMatches: true, geometryReadable: true, completeShape: true, notDeformed: false, unobstructed: true }),
    }), /PRODUCT_REFERENCE_REQUIRED/);
    const walkingGarment = file("walking-garment");
    const garment = await selectShoppingSceneReference({ paths: [walkingGarment], productName: "와이드 팬츠", selectedProduct: "차콜 와이드 팬츠" }, {
      verify: async paths => paths,
      review: async call => {
        assert.match(call.userPrompt, /normal pose, fabric folds or a moderate oblique view is allowed/u);
        return JSON.stringify({ identityMatches: true, geometryReadable: true, frontFacing: false,
          completeShape: true, notDeformed: true, unobstructed: true, subject: "person walking in charcoal trousers",
          geometry: "wide legs, elastic waist, hems and pockets visible with natural folds", labels: "none visible" });
      },
    });
    assert.equal(garment.path, walkingGarment, "natural garment poses do not need a packaging front view");

    const allChecks = Object.fromEntries(SCENE_FIDELITY_CHECKS.map(key => [key, true]));
    const good = { accepted: true, identityMatches: true, illustrativeOnly: true, checks: allChecks, reason: "both images show the same intact straight front and cap" };
    const result = await reviewShoppingReferenceScene({ reference, outputPath: output, productName: "상품", imageIntent: "연출", anchorSha256: hash(anchor) }, {
      review: async call => {
        assert.deepEqual(call.imagePaths, [front, output], "fidelity review sees actual original AND output in fixed order");
        assert.equal(call.maxImages, 2);
        assert.equal(call.preserveImageOrder, true);
        assert.match(call.userPrompt, /Recognition|Identity recognition/u);
        return JSON.stringify(good);
      },
    });
    assert.equal(result.referenceSha256, hash(front));
    assert.equal(result.reviewedOutputSha256, hash(output));
    assert.equal(result.strategyVersion, SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION);
    for (const key of SCENE_FIDELITY_CHECKS) {
      await assert.rejects(reviewShoppingReferenceScene({ reference, outputPath: output, productName: "상품", imageIntent: "연출" }, {
        review: async () => JSON.stringify({ ...good, checks: { ...allChecks, [key]: false } }),
      }), /REFERENCE_SCENE_FIDELITY_FAILED/, `recognizable brand cannot override failed ${key}`);
    }
    await assert.rejects(reviewShoppingReferenceScene({ reference, outputPath: output, productName: "상품", imageIntent: "연출" }, {
      review: async () => JSON.stringify({ accepted: true, reason: "looks fine" }),
    }), /REFERENCE_SCENE_FIDELITY_FAILED/);
    await assert.rejects(reviewShoppingReferenceScene({ reference, outputPath: output, productName: "상품", imageIntent: "연출" }, {
      review: async () => "unavailable",
    }), /REFERENCE_SCENE_REVIEW_INVALID/);
    await assert.rejects(reviewShoppingReferenceScene({ reference, outputPath: front, productName: "상품", imageIntent: "연출" }), /REFERENCE_SCENE_OUTPUT_REQUIRED/);

    const manifest = {
      version: "brand-post-package/v2", brandLinkId: "reference-offline", connectKind: "SHOPPING", title: "상품", approvedAt: "approved",
      sourceSnapshot: { snapshotId: "snapshot-1", product: { name: "상품", features: [] } },
      heroImagePath: anchor, bodyImagePaths: [], composition: { sections: [], renderNodes: [] },
      imageAssets: [{ path: anchor, sourcePath: anchor, sha256: hash(anchor), role: "hero", provenance: "GENERATED_SCENE",
        creationMethod: "reference-guided-scene", remoteGenerated: true,
        referenceScene: { ...result, anchorSha256: undefined, reviewedOutputSha256: hash(anchor), sourceSnapshotId: "snapshot-1" } }],
    } as unknown as BrandPostPackageManifestV2;
    const target = (id: string): ResolvedImageTarget => ({ request: { requestId: id, slotId: `${id}:image:1` }, sectionId: id,
      role: "body", sectionTitle: "제품을 놓는 공간", imageIntent: "AI 연출 이미지", imageSource: "staged-ai", bodyExcerpt: "원본 참조 연출입니다.", promptRecipe: "warm neutral shelf" });
    let selectionCalls = 0;
    const deps = { collect: async () => [front], select: async (): Promise<ShoppingSceneReference> => { selectionCalls += 1; return reference; } };
    const first = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "상품", target: target("first") }, deps);
    assert.deepEqual(first.referenceImagePaths, [front, anchor]);
    assert.deepEqual(first.referenceHashes, [hash(front), hash(anchor)]);
    manifest.approvedAt = null;
    const secondTarget = target("second");
    const second = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "상품", target: secondTarget }, deps);
    assert.deepEqual(second.referenceHashes, first.referenceHashes, "sibling updates clearing approval retain the prepared approved anchor");
    assert.equal(selectionCalls, 1, "the same post keeps one reviewed original across calls");
    const jobs = generation.prepareImageBatchJobs([secondTarget], manifest, "상품", root);
    assert.deepEqual(jobs[0].referenceImagePaths, [front, anchor]);
    assert.equal(jobs[0].referenceMode, "product");
    assert.deepEqual(jobs[0].requiredReferenceHashes, first.referenceHashes);
    assert.doesNotMatch(jobs[0].prompt, /Generate the environment only|never the product viewpoint/);
    assert.match(jobs[0].prompt, /distinct natural location, pose or camera framing/);
    assertProductImageReferences(jobs[0]);
    assert.throws(() => assertProductImageReferences({ ...jobs[0], referenceImagePaths: [front] }), /PRODUCT_REFERENCE_REQUIRED/);
    assert.throws(() => assertProductImageReferences({ ...jobs[0], requiredReferenceHashes: [...first.referenceHashes].reverse() }), /PRODUCT_REFERENCE_CHANGED/);
    const changedRecipe = { ...secondTarget, promptRecipe: "a different verified setting", referenceContext: { ...second, prompt: `${second.prompt}\nDifferent setting` } };
    assert.notEqual(generation.prepareImageBatchJobs([changedRecipe], manifest, "상품", root)[0].outStem, jobs[0].outStem, "strategy recipe changes cannot reuse old outputs");
    fs.writeFileSync(`${jobs[0].outStem}.checkpoint.jsonl`, JSON.stringify({ state: "submitted" }) + "\n");
    assert.throws(() => generation.prepareImageBatchJobs([changedRecipe], manifest, "상품", root), /IMAGE_RESUME_REQUIRED/,
      "changing prose/recipe cannot bypass a submitted request in the same slot");
    assert.equal(generation.prepareImageBatchJobs([secondTarget], manifest, "상품", root)[0].outStem, jobs[0].outStem,
      "the same request still reaches its existing transport checkpoint");
    const legacyStem = path.join(root, `raw-${"a".repeat(64)}`);
    fs.writeFileSync(`${legacyStem}.checkpoint.jsonl`, JSON.stringify({ fingerprint: "old-background-v2", state: "submitted" }) + "\n");
    assert.throws(() => generation.prepareImageBatchJobs([secondTarget], manifest, "상품", root), /IMAGE_RESUME_REQUIRED/,
      "pre-strategy background submissions require explicit recovery, never silent paid replacement");
    fs.unlinkSync(`${legacyStem}.checkpoint.jsonl`);
    const originalBytes = fs.readFileSync(front);
    fs.appendFileSync(front, "changed after preparation");
    assert.throws(() => generation.prepareImageBatchJobs([secondTarget], manifest, "상품", root), /PRODUCT_REFERENCE_CHANGED/);
    fs.writeFileSync(front, originalBytes);

    const oldBody = file("old-body");
    const oldBodyHash = hash(oldBody);
    manifest.composition.sections.push({ id: "second", title: secondTarget.sectionTitle, body: ["상품 참조 연출"],
      imageIntent: secondTarget.imageIntent, imageSource: "staged-ai", promptRecipe: secondTarget.promptRecipe,
      imagePaths: [oldBody], imageMin: 1, imageMax: 1 } as typeof manifest.composition.sections[number]);
    manifest.imageAssets!.push({ path: oldBody, sourcePath: oldBody, sha256: oldBodyHash, role: "body", sectionId: "second",
      slotId: "second:image:1", provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false,
      imageIntent: secondTarget.imageIntent } as NonNullable<typeof manifest.imageAssets>[number]);
    const current = manifest;
    let qaCalls = 0;
    const external = { brandLinkId: manifest.brandLinkId, manifest: current, productName: "상품", sectionId: "second",
      replaceAssetKey: oldBodyHash, rawPath: output, referenceHashes: first.referenceHashes,
      reviewReferenceScene: async () => { qaCalls += 1; return result; },
      apply: ((applied: Parameters<typeof applyGeneratedBrandPostImage>[0]) => {
        current.imageAssets = current.imageAssets!.filter(asset => asset.sha256 !== oldBodyHash);
        current.imageAssets.push({ path: applied.generatedPath, sourcePath: applied.generatedPath, sha256: hash(applied.generatedPath),
          role: "body", sectionId: applied.sectionId, slotId: applied.slotId, imageIntent: applied.imageIntent,
          provenance: applied.provenance, creationMethod: applied.creationMethod, remoteGenerated: applied.remoteGenerated,
          referenceScene: applied.referenceScene } as NonNullable<typeof current.imageAssets>[number]);
        current.composition.sections[0].imagePaths = [applied.generatedPath];
        current.approvedAt = null;
        // Simulate a lost acknowledgement after package mutation: the durable intent must recover it.
        throw new Error("simulated apply acknowledgement lost");
      }) as NonNullable<Parameters<typeof generation.applyExternalGeneratedBrandPostImage>[0]["apply"]>,
    };
    await assert.rejects(generation.applyExternalGeneratedBrandPostImage({ ...external, referenceHashes: [...first.referenceHashes].reverse() }), /PRODUCT_REFERENCE_CHANGED/);
    assert.equal(qaCalls, 0, "wrong ordered references fail before any vision call");
    await assert.rejects(generation.applyExternalGeneratedBrandPostImage(external), /simulated apply acknowledgement lost/);
    assert.equal(qaCalls, 1);
    const replay = await generation.applyExternalGeneratedBrandPostImage({ ...external, manifest: current,
      reviewReferenceScene: async () => { throw new Error("duplicate vision call"); } });
    assert.equal(replay.alreadyApplied, true, "removed old replaceAssetKey and lost apply acknowledgement recover without a new review or duplicate apply");
    assert.equal(replay.assetKey, hash(output));
    assert.equal(qaCalls, 1);
    const replacementAnchor = file("different-hero");
    manifest.heroImagePath = replacementAnchor;
    manifest.imageAssets![0] = { ...manifest.imageAssets![0], path: replacementAnchor, sha256: hash(replacementAnchor) };
    const changed = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "상품", target: target("third") }, deps);
    assert.deepEqual(changed.referenceImagePaths, [front], "changed hero cannot inherit an old approved anchor");
    assert.equal(generation.findAppliedExternalGeneratedBrandPostImage({ ...external, manifest }), null,
      "a changed anchor invalidates even a previously applied retry receipt");
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest, productName: "상품",
      target: { ...target("feature"), imageSource: "seller-crop", imageIntent: "작동 성능 공식 근거" } }, deps), /REFERENCE_SCENE_NOT_EVIDENCE/);
    const prompt = buildShoppingReferenceScenePrompt({ productName: "shoe", sectionTitle: "대표", imageIntent: "전체", role: "hero", reference });
    assert.match(prompt, /Do not impose a tube, cap, upright packshot, fixed front view/u, "tube geometry is never imposed on every category");
    assert.doesNotMatch(prompt, /d'Alba|2\.3:1 cap height about one fifth/u, "no product-specific template is hardcoded");
    const bodyPrompt = buildShoppingReferenceScenePrompt({ productName: "와이드 팬츠", sectionTitle: "출근 코디", imageIntent: "AI 코디 연출 이미지", role: "body", reference: garment });
    assert.match(bodyPrompt, /Square 1:1 photograph/);
    assert.match(bodyPrompt, /People wearing clothing/);
    assert.match(bodyPrompt, /No information cards, slides, editorial layouts, split panels, collage/);
    assert.doesNotMatch(bodyPrompt, /Create ONE photorealistic editorial|No people, hands|keep the product front view/);
    assert(SCENE_FIDELITY_CHECKS.includes("noAddedText") && SCENE_FIDELITY_CHECKS.includes("noFramesOrPanels") && SCENE_FIDELITY_CHECKS.includes("singleScene"));
    // Exercise the actual module and renderer, not the transport VM harness.
    // The existing checkpoint contains the already reviewed original pixels.
    const decodedOriginal = path.join(root, "actual-thumbnail-source.png");
    await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#b8afa1" } }).png().toFile(decodedOriginal);
    const thumbnailManifest = { ...manifest, brandLinkId: `${manifest.brandLinkId}-actual-thumbnail`, heroImagePath: decodedOriginal,
      imageAssets: [{ path: decodedOriginal, sourcePath: decodedOriginal, sha256: hash(decodedOriginal), role: "hero", provenance: "ORIGINAL", creationMethod: "source" }] } as BrandPostPackageManifestV2;
    const actualHeroRequest = { requestId: "actual-hero", replaceAssetKey: hash(decodedOriginal) };
    await generation.prepareBrandPostImageReferenceContext({ manifest: thumbnailManifest, productName: "와이드 팬츠",
      target: generation.resolveBrandPostImageTarget(thumbnailManifest, actualHeroRequest) }, {
      collect: async () => [decodedOriginal],
      select: async () => ({ ...reference, path: decodedOriginal, sha256: hash(decodedOriginal) }),
    });
    const originalSpawn = childProcess.spawn;
    let spawnedProviders = 0;
    childProcess.spawn = (() => { spawnedProviders += 1; throw new Error("Remote generation forbidden for a local photo thumbnail"); }) as typeof childProcess.spawn;
    syncBuiltinESMExports();
    try {
      for (const sourceOnly of [false, true]) {
        const [thumbnail] = await generation.generateBrandPostImages({ manifest: thumbnailManifest, productName: "와이드 팬츠", sourceOnly,
          requests: [{ ...actualHeroRequest, requestId: `actual-local-hero-${sourceOnly}` }] });
        assert.equal(thumbnail.error, undefined);
        assert.equal(thumbnail.provenance, "PHOTO_TEXT_THUMBNAIL");
        assert.equal(thumbnail.creationMethod, "local-composite");
        assert.equal(thumbnail.remoteGenerated, false);
        assert(thumbnail.generatedPath && fs.existsSync(thumbnail.generatedPath));
        const size = await sharp(thumbnail.generatedPath!).metadata();
        assert.deepEqual([size.width, size.height], [1080, 1080]);
      }
      assert.equal(spawnedProviders, 0, "production hero path must bypass both Codex and browser providers");
    } finally {
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
    }
    console.log("PASS: reference choice, two-image fail-closed shape QA, ordered attachments, stable original/approved anchor, stale anchor rejection, recipe invalidation, evidence boundary");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
