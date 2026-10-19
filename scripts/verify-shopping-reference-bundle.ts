/** Synthetic fixtures only. No provider, network, live package, approval or generation. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import sharp from "sharp";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { testPngFixture } from "./lib/test-png-fixture";
import { buildProduct9Canvas } from "./lib/product-9canvas";
import { buildShoppingReferenceScenePrompt, selectShoppingSceneSupportingReferences, reviewShoppingReferenceScene, SCENE_FIDELITY_CHECKS,
  readShoppingSceneSupportingCandidates, SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION, type ShoppingSceneReference } from "./lib/shopping-reference-scene";
import type { SelectedGalleryComparisonImage } from "./lib/selected-gallery-comparison";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import type { ResolvedImageTarget } from "../src/lib/brand-post-image-generation";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shopping-reference-bundle-"));
  process.env.DESKTOP_USER_DATA = root;
  const oldFetch = globalThis.fetch, oldSpawn = childProcess.spawn;
  globalThis.fetch = async () => { throw new Error("test attempted network"); };
  childProcess.spawn = (() => { throw new Error("test attempted provider/process"); }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  let checks = 0;
  try {
    const generation = await import("../src/lib/brand-post-image-generation");
    const packageModule = await import("../src/lib/brand-post-package");
    const packageDir = packageModule.getBrandPostPackageDir("bundle-offline");
    const sources = path.join(packageDir, "product-sources"); fs.mkdirSync(sources, { recursive: true });
    const make = async (name: string, index: number): Promise<SelectedGalleryComparisonImage> => {
      const file = path.join(sources, `${name}.png`);
      fs.writeFileSync(file, await sharp({ create: { width: 16, height: 16, channels: 3,
        background: `#${crypto.createHash("sha256").update(name).digest("hex").slice(0, 6)}` } }).png().toBuffer());
      const sourceUrl = `https://shop-phinf.pstatic.net/20261019/${index}.png`;
      const receiptPath = `${file}.retrieval.json`;
      fs.writeFileSync(receiptPath, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl,
        sha256: hash(file), retrievedAt: new Date().toISOString() }));
      return { path: file, sha256: hash(file), sourceUrl, sourceSnapshotId: "pending", receiptPath, receiptSha256: hash(receiptPath) };
    };
    const [worn, shape, logo] = await Promise.all([make("worn-with-NEW", 1), make("same-black-whole-shape", 2), make("same-black-intrinsic-logo", 3)]);
    const snapshot = createProductSnapshot({ productId: "bundle-offline", connectKind: "SHOPPING", externalProductId: null,
      sourceUrl: "https://smartstore.naver.com/test/products/1", product: { name: "검정 오픈형 이어폰", features: ["색상: 검정"],
        referenceImageUrls: [worn.sourceUrl, shape.sourceUrl, logo.sourceUrl] } });
    [worn, shape, logo].forEach(file => { file.sourceSnapshotId = snapshot.snapshotId; });
    const reference: ShoppingSceneReference = { path: worn.path, sha256: worn.sha256, subject: "same black worn headset",
      geometry: "partly visible rear band", labels: "tiny intrinsic print unreadable; NEW is external artwork", reviewedAt: new Date().toISOString() };
    const row = (index: number, purpose: "geometry" | "intrinsic-label") => ({ index, purpose, identityMatches: true,
      sameVisibleOption: true, geometryConsistent: true, intrinsicPrintingConsistent: true, detailsVisible: true,
      subject: "same black headset", geometry: "continuous band and matching ear unit", labels: "actual intrinsic logo", reason: "same visible colour and physical landmarks" });
    const selection = { reference, candidates: [shape, logo], sourceSnapshotId: snapshot.snapshotId,
      sourceImageUrls: snapshot.product.referenceImageUrls as string[], selectedProduct: "검정 오픈형 이어폰; black option" };
    const supporting = await selectShoppingSceneSupportingReferences(selection, { review: async call => {
      assert.deepEqual(call.imagePaths, [worn.path, shape.path, logo.path]);
      assert.equal(call.maxImages, 3); assert.match(call.userPrompt, /SAME visible option/);
      assert.match(call.userPrompt, /External NEW badges/); checks += 3;
      return JSON.stringify({ references: [row(1, "geometry"), row(2, "intrinsic-label")] });
    } });
    assert.deepEqual(supporting.map(file => file.sha256), [shape.sha256, logo.sha256]); checks++;
    for (const field of ["sameVisibleOption", "intrinsicPrintingConsistent", "identityMatches"] as const) {
      const rejected = await selectShoppingSceneSupportingReferences(selection, { review: async () =>
        JSON.stringify({ references: [{ ...row(1, "geometry"), [field]: false }] }) });
      assert.deepEqual(rejected, [], `a real ${field} rejection must not become a verified support`); checks++;
    }
    let calls = 0;
    assert.deepEqual(await selectShoppingSceneSupportingReferences({ ...selection,
      candidates: [{ ...shape, sourceSnapshotId: "different-product" }, { ...logo, sourceUrl: "https://shop-phinf.pstatic.net/foreign.png" }] },
    { review: async () => { calls++; throw new Error("foreign bytes reached provider"); } }), []);
    assert.equal(calls, 0); checks += 2;
    await assert.rejects(selectShoppingSceneSupportingReferences(selection, { review: async () =>
      JSON.stringify({ references: [{ ...row(1, "geometry"), sameVisibleOption: undefined }] }) }), /REFERENCE_SCENE_REVIEW_INVALID/); checks++;
    const oldLogo = fs.readFileSync(logo.path);
    await assert.rejects(selectShoppingSceneSupportingReferences(selection, { review: async () => {
      fs.appendFileSync(logo.path, "changed"); return JSON.stringify({ references: [row(1, "geometry")] });
    } }), /REFERENCE_SCENE_CHANGED/); fs.writeFileSync(logo.path, oldLogo); checks++;
    const prompt = buildShoppingReferenceScenePrompt({ productName: "검정 이어폰", sectionTitle: "책상 배치", imageIntent: "연출",
      role: "body", reference, supportingReferences: supporting });
    assert.match(prompt, /INPUT 2.*complete-shape view/); assert.match(prompt, /INPUT 3.*intrinsic-logo\/label close-up/);
    assert.match(prompt, /Never mix variants or copy NEW badges/); checks += 3;
    const generated = path.join(root, "generated.png"); fs.writeFileSync(generated, testPngFixture("wrong-logo-generated"));
    const comparisons = Object.fromEntries(["productShape", "intrinsicPrinting", "visibleOption", "sceneContext"].map(key =>
      [key, { result: "consistent", variation: "none", referenceObservation: "visible reference", candidateObservation: "visible candidate", basis: "compared actual pixels" }]));
    await assert.rejects(reviewShoppingReferenceScene({ reference, outputPath: generated, productName: "검정 이어폰",
      imageIntent: "연출", supportingReferences: supporting }, { review: async call => {
      assert.deepEqual(call.imagePaths, [worn.path, generated, shape.path, logo.path]); assert.equal(call.maxImages, 4);
      assert.match(call.userPrompt, /IMAGE 4 is verified SAME-option seller intrinsic-label/); checks += 3;
      return JSON.stringify({ accepted: true, identityMatches: true, illustrativeOnly: true, comparisons,
        checks: { ...Object.fromEntries(SCENE_FIDELITY_CHECKS.map(key => [key, true])), labelHierarchy: false }, reason: "readable wrong logo" });
    } }), /REFERENCE_SCENE_FIDELITY_FAILED/); checks++;
    const huge = path.join(root, "oversize-primary.png"); fs.writeFileSync(huge, Buffer.alloc(8 * 1024 * 1024 + 1));
    assert.deepEqual(await selectShoppingSceneSupportingReferences({ ...selection, reference: { ...reference, path: huge, sha256: hash(huge) } },
      { review: async () => { throw new Error("optional detail exceeded existing byte budget"); } }), []); checks++;
    const manifest = { version: "brand-post-package/v2", brandLinkId: "bundle-offline", connectKind: "SHOPPING", title: "검정 이어폰",
      sourceSnapshot: snapshot, approvedAt: null, heroImagePath: "", bodyImagePaths: [],
      composition: { sections: [], renderNodes: [] }, imageAssets: [{ path: logo.path, sourcePath: logo.path, sha256: logo.sha256,
        provenance: "ORIGINAL", role: "body", sourceReview: { sourceSha256: logo.sha256 } }] } as unknown as BrandPostPackageManifestV2;
    const target = (name: string): ResolvedImageTarget => ({ request: { requestId: name, slotId: `${name}:image:1` }, sectionId: name,
      role: "body", sectionTitle: "이어폰을 놓는 공간", imageIntent: "AI 연출 이미지", imageSource: "staged-ai", bodyExcerpt: "검정 이어폰의 배치예요." });
    const workDir = path.join(packageDir, "image-generation-work", "resume-v2"); fs.mkdirSync(workDir, { recursive: true });
    const primaryCheckpoint = path.join(path.dirname(workDir), "scene-reference-context.json");
    fs.writeFileSync(primaryCheckpoint, JSON.stringify({ strategyVersion: SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION,
      snapshotId: snapshot.snapshotId, reference }));
    const originalCheckpoint = fs.readFileSync(primaryCheckpoint);
    const legacy = target("legacy");
    const understanding = buildProduct9Canvas({ name: "검정 오픈형 이어폰", features: ["색상: 검정"],
      description: "", sourceUrl: snapshot.sourceUrl, externalProductId: null });
    legacy.referenceContext = { generationMode: "reference-guided-scene", reference, referenceImagePaths: [reference.path],
      referenceHashes: [reference.sha256], prompt: buildShoppingReferenceScenePrompt({ productName: "검정 이어폰", sectionTitle: legacy.sectionTitle,
        imageIntent: legacy.imageIntent, bodyExcerpt: legacy.bodyExcerpt, role: "body", reference, hasAnchor: false, variantIndex: 0,
        adjacentSectionTitles: [], physicalScale: understanding.concept.physicalScale, productImageDirective: understanding.policy.imageDirective }) };
    const legacyJob = generation.prepareImageBatchJobs([legacy], manifest, "검정 이어폰", workDir)[0];
    fs.writeFileSync(`${legacyJob.outStem}.checkpoint.jsonl`, JSON.stringify({ state: "submitted" }) + "\n");
    const legacyMetadata = fs.readFileSync(`${legacyJob.outStem}.reference-scene.json`);
    const deps = { collect: async () => { throw new Error("checkpoint must avoid collection"); }, select: async () => reference,
      selectSupporting: async () => { calls++; return supporting; } };
    await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 이어폰", target: legacy }, deps);
    assert.deepEqual(legacy.referenceContext!.referenceHashes, [reference.sha256]); assert.equal(calls, 0);
    assert.equal(generation.prepareImageBatchJobs([legacy], manifest, "검정 이어폰", workDir)[0].outStem, legacyJob.outStem);
    assert.deepEqual(fs.readFileSync(primaryCheckpoint), originalCheckpoint); checks += 3;
    const fresh = target("fresh");
    const freshContext = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 이어폰", target: fresh }, deps);
    assert.deepEqual(freshContext.referenceHashes, [worn.sha256, shape.sha256, logo.sha256]); assert.equal(calls, 1);
    const freshJob = generation.prepareImageBatchJobs([fresh], manifest, "검정 이어폰", workDir)[0];
    assert.equal(freshJob.referenceImagePaths.length, 3); assert.deepEqual(freshJob.requiredReferenceHashes, freshContext.referenceHashes); checks += 4;
    fs.writeFileSync(`${freshJob.outStem}.checkpoint.jsonl`, JSON.stringify({ state: "submitted" }) + "\n");
    const metadataBytes = fs.readFileSync(`${freshJob.outStem}.reference-scene.json`);
    const resumed = target("fresh");
    await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 이어폰", target: resumed },
      { ...deps, selectSupporting: async () => { throw new Error("resume repeated selection"); } });
    assert.equal(JSON.stringify(resumed.referenceContext), JSON.stringify(freshContext));
    assert.equal(generation.prepareImageBatchJobs([resumed], manifest, "검정 이어폰", workDir)[0].outStem, freshJob.outStem);
    assert.deepEqual(fs.readFileSync(`${freshJob.outStem}.reference-scene.json`), metadataBytes);
    assert.deepEqual(fs.readFileSync(`${legacyJob.outStem}.reference-scene.json`), legacyMetadata);
    assert.deepEqual(fs.readFileSync(primaryCheckpoint), originalCheckpoint); checks += 5;
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 이어폰",
      target: { ...target("fresh"), bodyExcerpt: "수정된 본문" } }, deps), /IMAGE_RESUME_REQUIRED/); checks++;
    const oldOutput = `${legacyJob.outStem}.png`; fs.writeFileSync(oldOutput, testPngFixture("old-rejected-completed-output"));
    manifest.imageAssets!.push({ path: oldOutput, sourcePath: oldOutput, sha256: hash(oldOutput), role: "body",
      slotId: legacy.request.slotId, provenance: "GENERATED_SCENE" } as NonNullable<typeof manifest.imageAssets>[number]);
    const replacement = { ...target("legacy"), request: { ...legacy.request, replaceAssetKey: hash(oldOutput) } };
    const pending = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 이어폰", target: replacement }, deps);
    assert.deepEqual(pending.referenceHashes, [worn.sha256], "an uncertain old request cannot become a new multi-reference request"); checks++;
    fs.writeFileSync(`${legacyJob.outStem}.checkpoint.jsonl`, JSON.stringify({ id: "slot", fingerprint: "b".repeat(64),
      localPath: oldOutput, sha256: hash(oldOutput) }) + "\n");
    await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 이어폰", target: replacement }, deps);
    const replacementJob = generation.prepareImageBatchJobs([replacement], manifest, "검정 이어폰", workDir)[0];
    assert.notEqual(replacementJob.outStem, legacyJob.outStem, "explicit replacement of a settled output gets a new identity");
    assert.deepEqual(replacementJob.requiredReferenceHashes, [worn.sha256, shape.sha256, logo.sha256]);
    assert.deepEqual(fs.readFileSync(`${legacyJob.outStem}.reference-scene.json`), legacyMetadata); checks += 3;
    const futureSnapshot = createProductSnapshot({ productId: manifest.brandLinkId, connectKind: "SHOPPING", externalProductId: null,
      sourceUrl: snapshot.sourceUrl, product: { ...snapshot.product, features: ["색상: 검정", "규격: 새 확인 근거"] } });
    let primarySelections = 0;
    const futureDeps = { collect: async () => [worn.path], select: async () => { primarySelections++; return reference; },
      selectSupporting: async () => [] };
    await generation.prepareBrandPostImageReferenceContext({ manifest: { ...manifest, sourceSnapshot: futureSnapshot }, productName: "검정 이어폰", target: target("future-1") }, futureDeps);
    await generation.prepareBrandPostImageReferenceContext({ manifest: { ...manifest, sourceSnapshot: futureSnapshot }, productName: "검정 이어폰", target: target("future-2") }, futureDeps);
    assert.equal(primarySelections, 1, "an immutable snapshot-specific checkpoint must avoid repeated primary selection");
    assert.deepEqual(fs.readFileSync(primaryCheckpoint), originalCheckpoint); checks += 2;
    const later = await Promise.all(Array.from({ length: 7 }, (_, index) => make(`later-${index}`, index + 10)));
    const poolSnapshot = createProductSnapshot({ productId: manifest.brandLinkId, connectKind: "SHOPPING", externalProductId: null,
      sourceUrl: snapshot.sourceUrl, product: { ...snapshot.product, referenceImageUrls: [...snapshot.product.referenceImageUrls as string[], ...later.map(file => file.sourceUrl)] } });
    const reached = await readShoppingSceneSupportingCandidates({ snapshot: poolSnapshot, productId: manifest.brandLinkId,
      sourceDirectory: sources, preferredHashes: [logo.sha256, later.at(-1)!.sha256] });
    assert.equal(reached.length, 7); assert.equal(reached[0].sha256, logo.sha256);
    assert.equal(reached[1].sha256, later.at(-1)!.sha256, "a verified later whole-shape source must not disappear behind first-two gallery slots"); checks += 3;
    fs.appendFileSync(logo.receiptPath, " ");
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 이어폰", target: target("fresh") }, deps), /IMAGE_RESUME_REQUIRED/); checks++;
    assert.equal(hash(logo.path), logo.sha256); assert.equal(hash(shape.path), shape.sha256); checks += 2;
    console.log(`shopping reference bundle: ${checks} checks passed; provider/network/generation calls 0`);
  } finally {
    globalThis.fetch = oldFetch; childProcess.spawn = oldSpawn; syncBuiltinESMExports();
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
