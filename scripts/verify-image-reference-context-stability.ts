/** Synthetic packages only: actual context/job preparation, no model, network or live data. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { buildProduct9Canvas, selectedProductContextFrom9Canvas } from "./lib/product-9canvas";
import { buildShoppingReferenceScenePrompt, type ShoppingSceneReference, type ShoppingSceneSupportingReference } from "./lib/shopping-reference-scene";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import type { ResolvedImageTarget } from "../src/lib/brand-post-image-generation";
import { testPngFixture } from "./lib/test-png-fixture";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "image-context-stability-"));
  const oldData = process.env.DESKTOP_USER_DATA, oldFetch = globalThis.fetch;
  process.env.DESKTOP_USER_DATA = root;
  globalThis.fetch = async () => { throw new Error("fixture attempted network"); };
  const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const png = (label: string) => Buffer.concat([testPngFixture(label), Buffer.alloc(2048)]);
  let checks = 0;
  try {
    const generation = await import("../src/lib/brand-post-image-generation");
    const { getBrandPostPackageDir } = await import("../src/lib/brand-post-package");
    const id = "context-stability-offline", dir = getBrandPostPackageDir(id), sources = path.join(dir, "product-sources");
    fs.mkdirSync(sources, { recursive: true });
    const primary = path.join(sources, "primary.png"), geometry = path.join(sources, "geometry.png");
    fs.writeFileSync(primary, png("primary-shape")); fs.writeFileSync(geometry, png("geometry-shape"));
    const url = "https://shop-phinf.pstatic.net/fixture/geometry.png", receiptPath = `${geometry}.retrieval.json`;
    const originalReceipt = JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: url, sha256: hash(geometry),
      retrievedAt: new Date(Date.now() - 60000).toISOString(), identityVerified: false, rightsGranted: false });
    fs.writeFileSync(receiptPath, originalReceipt);
    const snapshot = createProductSnapshot({ productId: id, connectKind: "SHOPPING", sourceUrl: "https://smartstore.naver.com/fixture/products/1",
      externalProductId: "1", product: { name: "검정 제품", features: ["색상: 검정"], referenceImageUrls: [url] } });
    const reference: ShoppingSceneReference = { path: primary, sha256: hash(primary), subject: "actual black product", geometry: "visible shape",
      labels: "no intrinsic printing", reviewedAt: new Date().toISOString() };
    const support: ShoppingSceneSupportingReference = { path: geometry, sha256: hash(geometry), sourceUrl: url, sourceSnapshotId: snapshot.snapshotId,
      receiptPath, receiptSha256: hash(receiptPath), purpose: "geometry", subject: "same actual product", geometry: "same complete shape",
      labels: "none", reason: "actual same visible option", reviewedAt: new Date().toISOString() };
    const sections = ["original", "first", "text", "second", "more-text", "third"].map((sectionId, index) => ({ id: sectionId,
      title: `제목 ${index}`, body: [`원문 ${index}`], imagePaths: [], imageMin: index % 2 ? 1 : 0, imageMax: index % 2 ? 1 : 0,
      imageSource: index % 2 ? "staged-ai" : "none", imageIntent: "AI 연출 이미지", promptRecipe: "확인된 전체 제품을 보존" }));
    const manifest = { version: "brand-post-package/v2", brandLinkId: id, connectKind: "SHOPPING", title: "검정 제품",
      sourceSnapshot: snapshot, productUnderstanding: buildProduct9Canvas({ name: "검정 제품", features: ["색상: 검정"] }),
      imageAssets: [], heroImagePath: "", bodyImagePaths: [], approvedAt: null, composition: { sections, renderNodes: [] } } as unknown as BrandPostPackageManifestV2;
    const target = (index = 1, ordinal = 1): ResolvedImageTarget => ({ role: "body", sectionId: sections[index].id, sectionTitle: sections[index].title,
      request: { requestId: "fixture", slotId: `${sections[index].id}:image:${ordinal}` }, imageSource: "staged-ai", imageIntent: sections[index].imageIntent,
      promptRecipe: sections[index].promptRecipe, bodyExcerpt: sections[index].body.join(" ") });
    assert.deepEqual([1, 3, 5].map(index => generation.photorealVariantIndex(manifest, target(index))), [0, 1, 2]);
    assert.equal(generation.photorealVariantIndex(manifest, target(1, 2)), 1);
    assert.equal(generation.photorealVariantIndex(manifest, { ...target(), role: "hero" }), 0);
    sections[1].imageMin = 2;
    assert.deepEqual([generation.photorealVariantIndex(manifest, target(1)), generation.photorealVariantIndex(manifest, target(1, 2)),
      generation.photorealVariantIndex(manifest, target(3))], [0, 1, 2]); sections[1].imageMin = 1; checks += 4;
    const work = path.join(dir, "image-generation-work/resume-v2");
    const deps = { collect: async () => [primary], select: async () => reference, selectSupporting: async () => [support] };
    const preparedTarget = target();
    const context = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: preparedTarget }, deps);
    const legacyOptions = { productName: "검정 제품", sectionTitle: preparedTarget.sectionTitle, imageIntent: preparedTarget.imageIntent,
      bodyExcerpt: preparedTarget.bodyExcerpt, stagingRecipe: preparedTarget.promptRecipe, role: "body" as const, variantIndex: 2,
      adjacentSectionTitles: [sections[0].title, sections[2].title], physicalScale: manifest.productUnderstanding!.concept.physicalScale,
      productImageDirective: manifest.productUnderstanding!.policy.imageDirective };
    context.preparationBinding = digest({ snapshotId: snapshot.snapshotId, selectedProduct: selectedProductContextFrom9Canvas(manifest.productUnderstanding!), promptOptions: legacyOptions });
    context.prompt = buildShoppingReferenceScenePrompt({ ...legacyOptions, reference, hasAnchor: false, supportingReferences: [support] });
    const job = generation.prepareImageBatchJobs([preparedTarget], manifest, "검정 제품", work)[0];
    fs.writeFileSync(`${job.outStem}.codex-submission.json`, JSON.stringify({ state: "submitted", workspace: `${job.outStem}.codex-1`, startedAtMs: Date.now(), threadId: "fixture" }));
    const metadataPath = `${job.outStem}.reference-scene.json`, metadataBefore = fs.readFileSync(metadataPath);
    const resumedTarget = target();
    const noReselect = { collect: async () => { throw new Error("resume recollected"); }, select: async () => { throw new Error("resume reselected"); },
      selectSupporting: async () => { throw new Error("resume reselected supports"); } };
    assert.equal(JSON.stringify(await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: resumedTarget }, noReselect)), JSON.stringify(context));
    assert.equal(generation.prepareImageBatchJobs([resumedTarget], manifest, "검정 제품", work)[0].outStem, job.outStem);
    assert.deepEqual(fs.readFileSync(metadataPath), metadataBefore); checks += 3;
    fs.writeFileSync(receiptPath, JSON.stringify({ ...JSON.parse(originalReceipt), retrievedAt: new Date().toISOString() }));
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect), /IMAGE_RESUME_REQUIRED/); checks++;
    const backupSources = path.join(path.dirname(path.dirname(dir)), "material-rewrite-backups/00000000-0000-4000-8000-000000000001", id, "product-sources");
    fs.mkdirSync(backupSources, { recursive: true });
    const backupReceipt = path.join(backupSources, path.basename(receiptPath)); fs.writeFileSync(backupReceipt, originalReceipt);
    const recovered = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect);
    assert.equal(recovered.supportingReferences![0].receiptPath, backupReceipt);
    assert.equal(recovered.supportingReferences![0].receiptSha256, support.receiptSha256);
    assert.deepEqual(fs.readFileSync(metadataPath), metadataBefore);
    assert.notEqual(hash(receiptPath), support.receiptSha256, "canonical drift remains untouched; the exact historical bytes provide recovery");
    assert.ok(fs.readdirSync(work).some(name => name.includes("receipt-context-"))); checks += 5;
    const freshSlot = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target(3) }, noReselect);
    assert.equal(freshSlot.supportingReferences![0].receiptPath, backupReceipt, "unsubmitted slots recover the same immutable bundle evidence"); checks++;
    const changedText = { ...target(), bodyExcerpt: "다른 본문" };
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: changedText }, noReselect), /IMAGE_RESUME_REQUIRED/); checks++;
    fs.appendFileSync(geometry, "changed pixels");
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect), /IMAGE_RESUME_REQUIRED/); checks++;
    fs.writeFileSync(geometry, png("geometry-shape"));
    fs.writeFileSync(backupReceipt, JSON.stringify({ ...JSON.parse(originalReceipt), sourceUrl: "https://shop-phinf.pstatic.net/foreign.png" }));
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect), /IMAGE_RESUME_REQUIRED/); checks++;
    const outsideSources = path.join(root, "outside-backup-sources"); fs.mkdirSync(outsideSources);
    fs.writeFileSync(path.join(outsideSources, path.basename(receiptPath)), originalReceipt);
    const linkedSources = path.join(path.dirname(path.dirname(dir)), "material-rewrite-backups/00000000-0000-4000-8000-000000000002", id, "product-sources");
    fs.mkdirSync(path.dirname(linkedSources), { recursive: true }); fs.symlinkSync(outsideSources, linkedSources, "junction");
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect), /IMAGE_RESUME_REQUIRED/,
      "an exact historical receipt behind an escaping backup junction cannot authorize recovery"); checks++;
    fs.writeFileSync(backupReceipt, originalReceipt);
    const rawPath = `${job.outStem}.png`; fs.writeFileSync(rawPath, png("completed-rejected-body"));
    fs.writeFileSync(`${job.outStem}.codex-submission.json`, JSON.stringify({ state: "completed", workspace: `${job.outStem}.codex-1`, startedAtMs: Date.now(), threadId: "fixture" }));
    const completedBytes = fs.readFileSync(rawPath), rejectedTarget = target();
    rejectedTarget.referenceContext = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: rejectedTarget }, noReselect);
    for (const message of ["REFERENCE_SCENE_REVIEW_INVALID: fixture", "CODEX_PROVIDER_FAILED: fixture", "REFERENCE_SCENE_FIDELITY_FAILED: string only is not schema evidence"]) {
      await assert.rejects(generation.finishBrandPostGeneratedImage({ manifest, productName: "검정 제품", target: rejectedTarget, rawPath, workDir: work,
        completedJob: job, index: 0, reviewReferenceScene: async () => { throw new Error(message); } }));
      assert.equal(fs.existsSync(`${job.outStem}.body-rejection.json`), false, "provider/invalid/string-only errors never authorize a new attempt"); checks++;
    }
    const failure = () => Object.assign(new Error("REFERENCE_SCENE_FIDELITY_FAILED: actual structured wrong shape fixture"), {
      fidelityFailure: { version: "shopping-scene-fidelity-failure/v1", failedChecks: ["silhouette"], comparisonFailures: ["productShape"],
        accepted: false, identityMatches: false, illustrativeOnly: true } });
    await assert.rejects(generation.finishBrandPostGeneratedImage({ manifest, productName: "검정 제품", target: rejectedTarget, rawPath, workDir: work,
      completedJob: job, index: 0, reviewReferenceScene: async () => { throw failure(); } }), /REFERENCE_SCENE_FIDELITY_FAILED/);
    assert.equal(fs.existsSync(`${job.outStem}.body-rejection.json`), true); checks++;
    const rejectionPath = `${job.outStem}.body-rejection.json`, rejectionBytes = fs.readFileSync(rejectionPath), rejection = JSON.parse(rejectionBytes.toString());
    await assert.rejects(generation.finishBrandPostGeneratedImage({ manifest, productName: "검정 제품", target: rejectedTarget, rawPath, workDir: work,
      completedJob: job, index: 0, reviewReferenceScene: async () => { throw Object.assign(new Error("REFERENCE_SCENE_FIDELITY_FAILED: today's different label finding"), {
        fidelityFailure: { ...rejection.failure, failedChecks: ["labelHierarchy"], comparisonFailures: ["intrinsicPrinting"] } }); } }), /today's different label finding/,
      "a changed negative finding keeps the caller's actual QA error rather than exposing EEXIST");
    assert.deepEqual(fs.readFileSync(rejectionPath), rejectionBytes, "repeated negative QA preserves the first immutable rejection proof"); checks += 2;
    await assert.rejects(generation.finishBrandPostGeneratedImage({ manifest, productName: "검정 제품", target: { ...rejectedTarget, bodyExcerpt: "다른 검수 본문" },
      rawPath, workDir: work, completedJob: job, index: 0, reviewReferenceScene: async () => { throw failure(); } }), /IMAGE_RESUME_REQUIRED/,
      "a different review input cannot reuse or overwrite the old negative proof");
    assert.deepEqual(fs.readFileSync(rejectionPath), rejectionBytes); checks += 2;
    for (const invalidFailure of [{ version: "shopping-scene-fidelity-failure/v1", accepted: true, identityMatches: true, illustrativeOnly: true,
      failedChecks: [], comparisonFailures: [] }, { version: "shopping-scene-fidelity-failure/v1" }, { ...rejection.failure, failedChecks: ["inventedCheck"] }]) {
      fs.writeFileSync(rejectionPath, JSON.stringify({ ...rejection, failure: invalidFailure }));
      assert.equal((await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect)).retryOf, undefined,
        "changed/non-adverse proof cannot authorize another generation"); checks++;
    }
    fs.writeFileSync(rejectionPath, rejectionBytes);
    const submissionPath = `${job.outStem}.codex-submission.json`, submissionBytes = fs.readFileSync(submissionPath);
    fs.writeFileSync(submissionPath, JSON.stringify({ ...JSON.parse(submissionBytes.toString()), threadId: "a-different-thread" }));
    assert.equal((await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect)).retryOf, undefined,
      "another completion receipt cannot borrow a prior rejection"); fs.writeFileSync(submissionPath, submissionBytes); checks++;
    fs.writeFileSync(submissionPath, JSON.stringify({ ...JSON.parse(submissionBytes.toString()), state: "submitting" }));
    assert.equal((await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect)).retryOf, undefined,
      "a submitting receipt remains uncertain even when the raw file exists"); fs.writeFileSync(submissionPath, submissionBytes); checks++;
    manifest.imageAssets!.push({ path: rawPath, sourcePath: rawPath, role: "body", sha256: hash(rawPath), slotId: target().request.slotId,
      provenance: "GENERATED_SCENE", referenceScene: { reviewStatus: "passed", reviewedOutputSha256: hash(rawPath) } } as NonNullable<typeof manifest.imageAssets>[number]);
    assert.equal((await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect)).retryOf, undefined,
      "an adopted good photograph cannot be retired by an old rejection"); manifest.imageAssets!.pop(); checks++;
    fs.writeFileSync(`${job.outStem}.jpg`, png("additional-unreviewed-native-output"));
    assert.equal((await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect)).retryOf, undefined,
      "an added candidate invalidates an all-candidates-rejected proof"); fs.unlinkSync(`${job.outStem}.jpg`); checks++;
    const nodesBefore = manifest.composition.renderNodes;
    manifest.composition.renderNodes = [{ kind: "paragraph", sectionId: "first", text: "실제 게시 본문이 변경됐습니다." }];
    assert.equal((await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect)).retryOf, undefined,
      "actual render-node changes invalidate rejection even if target planning text stayed unchanged"); manifest.composition.renderNodes = nodesBefore; checks++;
    fs.writeFileSync(`${job.outStem}.lock`, "uncertain owner");
    assert.equal((await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect)).retryOf, undefined,
      "an owned/uncertain request remains with its existing transport"); fs.unlinkSync(`${job.outStem}.lock`); checks++;
    const legacyFiveFields = JSON.parse(metadataBefore.toString()); delete legacyFiveFields.referenceContext;
    fs.writeFileSync(metadataPath, JSON.stringify(legacyFiveFields));
    const unboundLegacy = target();
    await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: unboundLegacy }, noReselect);
    assert.throws(() => generation.prepareImageBatchJobs([unboundLegacy], manifest, "검정 제품", work), /IMAGE_RESUME_REQUIRED/,
      "legacy metadata without a frozen context cannot bypass old completion merely because the current prompt changed");
    fs.writeFileSync(metadataPath, metadataBefore); checks++;
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() },
      { ...deps, selectSupporting: async () => [{ ...support, receiptPath: backupReceipt }] }), /IMAGE_REPAIR_EXHAUSTED/, "a repeated identical plan cannot spend another generation"); checks++;
    const improvedReference: ShoppingSceneReference = { ...reference, viewObservation: { subjectState: "freestanding", cameraView: "front",
      geometryVisibility: "complete", hiddenParts: [], intrinsicPrint: "absent", readableIdentifiers: [] } };
    // Retire only the private unsuccessful retry-plan checkpoint produced above.
    const retryCheckpoint = fs.readdirSync(path.dirname(work)).find(name => name.startsWith("scene-reference-context-retry-"));
    assert.ok(retryCheckpoint); fs.unlinkSync(path.join(path.dirname(work), retryCheckpoint));
    const newTarget = target(); let freshSelections = 0;
    newTarget.referenceContext = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: newTarget },
      { ...deps, select: async () => { freshSelections++; return improvedReference; }, selectSupporting: async () => [{ ...support, receiptPath: backupReceipt }] });
    assert.equal(freshSelections, 1); assert.equal(newTarget.referenceContext.retryOf?.outStem, job.outStem);
    const improvedJob = generation.prepareImageBatchJobs([newTarget], manifest, "검정 제품", work)[0];
    assert.notEqual(improvedJob.outStem, job.outStem); assert.notEqual(improvedJob.prompt, job.prompt);
    assert.deepEqual(fs.readFileSync(metadataPath), metadataBefore); assert.deepEqual(fs.readFileSync(rawPath), completedBytes); checks += 6;
    fs.writeFileSync(`${improvedJob.outStem}.codex-submission.json`, JSON.stringify({ state: "submitted", workspace: `${improvedJob.outStem}.codex-1`, startedAtMs: Date.now(), threadId: "fixture" }));
    const pendingTarget = target();
    pendingTarget.referenceContext = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: pendingTarget }, noReselect);
    assert.equal(generation.prepareImageBatchJobs([pendingTarget], manifest, "검정 제품", work)[0].outStem, improvedJob.outStem, "uncertain improved submission resumes the same transport identity"); checks++;
    const improvedRaw = `${improvedJob.outStem}.png`; fs.writeFileSync(improvedRaw, png("improved-but-rejected-body"));
    fs.writeFileSync(`${improvedJob.outStem}.codex-submission.json`, JSON.stringify({ state: "completed", workspace: `${improvedJob.outStem}.codex-1`, startedAtMs: Date.now(), threadId: "fixture" }));
    await assert.rejects(generation.finishBrandPostGeneratedImage({ manifest, productName: "검정 제품", target: newTarget, rawPath: improvedRaw, workDir: work,
      completedJob: improvedJob, index: 0, reviewReferenceScene: async () => { throw failure(); } }), /REFERENCE_SCENE_FIDELITY_FAILED/);
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: target() }, noReselect), /IMAGE_REPAIR_EXHAUSTED/); checks++;
    console.log(`image reference context stability: ${checks} checks passed; generation/provider/network calls 0`);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldData === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = oldData;
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
