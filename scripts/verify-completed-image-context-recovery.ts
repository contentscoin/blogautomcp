/** Terminal historical inputs recover pixels, never another generation. Synthetic data only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { buildProduct9Canvas, selectedProductContextFrom9Canvas } from "./lib/product-9canvas";
import { buildShoppingReferenceScenePrompt, SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION,
  type ShoppingSceneReference, type ShoppingSceneSupportingReference } from "./lib/shopping-reference-scene";
import { REFERENCE_SCENE_REVIEW_CHECKS } from "../src/lib/brand-post-image-evidence";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import type { ResolvedImageTarget } from "../src/lib/brand-post-image-generation";
import { buildCodexImageInstruction, readCompletedProductRequest } from "../src/lib/codex-image-generation";
import { testPngFixture } from "./lib/test-png-fixture";
import { runRecordedImageRecovery, imageRecoverySignature, IMAGE_RECOVERY_POLICY_VERSION } from "./lib/material-image-recovery";
import { runMaterialPreparation, type Call, type Result } from "./lib/scheduled-draft-workflow";
import { publicationImageContext, recordPublicationImageRegenerationHolds } from "./lib/publish-image-rejections";
import { recordPublicationImageDefect, readPublicationImageDefect, recordScopedPublicationImageDefect, readPublicationDefectMaterialContext } from "./lib/publication-image-defect-proof";
import { buildScopedPublicationPackets, serializeScopedPublicationResponse, parseScopedPublicationResponse, type ScopedReviewEvidence } from "./lib/publication-image-scoped-review";
import { visibleIdentityReviewContext } from "./lib/publication-visible-identity";
import { publicationIdentifierReviewRequestSha256, publicationIdentifierReviewEvidenceIssue, type PublicationIdentifierReviewResult, type PublicationIdentifierReviewInput,
  type PublicationIdentifierComparison } from "./lib/publication-identifier-review";
import { publicationImageAuditPolicyFingerprint } from "./lib/publish-image-audit";
import { planPublicationImageRetry } from "../src/lib/brand-post-publication-image-repair";
import type { IntrinsicIdentifierServerConflict, IntrinsicIdentifierPair } from "./lib/intrinsic-identifier-comparison";
import { INTRINSIC_IDENTIFIER_OCR_VERSION } from "./lib/intrinsic-identifier-ocr";
import { INTRINSIC_IDENTIFIER_OBSERVER_VERSION, intrinsicIdentifierObserverRequestSha256, serializeIntrinsicIdentifierObserverResponse,
  type IntrinsicIdentifierObservation, type IntrinsicIdentifierObserverEvidence } from "./lib/intrinsic-identifier-observer";
import { buildProductThumbnailCopy } from "./lib/product-thumbnail";
import { PRODUCT_IMAGE_PRINT_OBSERVABILITY_RULE_EN, PRODUCT_IMAGE_PRINT_OBSERVABILITY_RULE_VERSION,
  PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_EN, PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_KO,
  PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_VERSION } from "./lib/product-image-visual-contract";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "completed-image-context-"));
  const oldData = process.env.DESKTOP_USER_DATA, oldHome = process.env.CODEX_HOME, oldFetch = globalThis.fetch;
  process.env.DESKTOP_USER_DATA = root; process.env.CODEX_HOME = path.join(root, "codex");
  globalThis.fetch = async () => { throw new Error("fixture attempted network"); };
  const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
  const fileHash = (file: string) => hash(fs.readFileSync(file));
  const png = (label: string) => Buffer.concat([testPngFixture(label), Buffer.alloc(2048)]);
  let checks = 0, reviews = 0, transportCalls = 0;
  try {
    const generation = await import("../src/lib/brand-post-image-generation");
    const { getBrandPostPackageDir } = await import("../src/lib/brand-post-package");
    async function fixture(mode: "legacy" | "receipt" | "hero" = "legacy", legacyPartialSupport = false) {
      const id = crypto.randomUUID(), dir = getBrandPostPackageDir(id), sources = path.join(dir, "product-sources");
      fs.mkdirSync(sources, { recursive: true });
      const primary = path.join(sources, "primary.png"), geometry = path.join(sources, "geometry.png");
      fs.writeFileSync(primary, png("same selected primary")); fs.writeFileSync(geometry, png("same selected side view"));
      const urls = ["https://shop-phinf.pstatic.net/fixture/primary.png", "https://shop-phinf.pstatic.net/fixture/geometry.png"];
      const receipt = (file: string, url: string, retrievedAt: string) => JSON.stringify({ version: "product-image-retrieval/v1",
        sourceUrl: url, sha256: fileHash(file), retrievedAt, identityVerified: false, rightsGranted: false });
      for (const [index, file] of [primary, geometry].entries()) fs.writeFileSync(`${file}.retrieval.json`, receipt(file, urls[index], new Date(Date.now() - 60000).toISOString()));
      const snapshot = createProductSnapshot({ productId: id, connectKind: "SHOPPING", sourceUrl: "https://smartstore.naver.com/fixture/products/1",
        externalProductId: "1", product: { name: "검정 제품", features: ["색상: 검정"], referenceImageUrls: urls } });
      const reference: ShoppingSceneReference = { path: primary, sha256: fileHash(primary), subject: "same selected complete product",
        geometry: "exact visible product structure", labels: "no intrinsic printing", reviewedAt: new Date(Date.now() - 50000).toISOString() };
      const support: ShoppingSceneSupportingReference = { path: geometry, sha256: fileHash(geometry), sourceUrl: urls[1], sourceSnapshotId: snapshot.snapshotId,
        receiptPath: `${geometry}.retrieval.json`, receiptSha256: fileHash(`${geometry}.retrieval.json`), purpose: "geometry", subject: "same selected product",
        geometry: "its exact side structure", labels: "none", reason: "matches same visible option", reviewedAt: new Date(Date.now() - 50000).toISOString() };
      if (legacyPartialSupport) support.viewObservation = { subjectState: "worn", cameraView: "side", geometryVisibility: "partial",
        hiddenParts: ["rear connection"], intrinsicPrint: "readable", readableIdentifiers: ["Voltium"] };
      const sections = ["original", "scene", "text"].map((sectionId, index) => ({ id: sectionId, title: `제목 ${index}`, body: [`원문 ${index}`],
        imagePaths: [], imageMin: index === 1 ? 1 : 0, imageMax: index === 1 ? 1 : 0, imageSource: index === 1 ? "staged-ai" : "none",
        imageIntent: "AI 연출 이미지", promptRecipe: "확인된 전체 제품을 보존" }));
      const manifest = { version: "brand-post-package/v2", brandLinkId: id, connectKind: "SHOPPING", title: "검정 제품", createdAt: new Date().toISOString(),
        sourceSnapshot: snapshot, productUnderstanding: buildProduct9Canvas({ name: "검정 제품", features: ["색상: 검정"] }),
        imageAssets: [], heroImagePath: "", bodyImagePaths: [], approvedAt: null,
        composition: { sections, renderNodes: [{ kind: "heading", sectionId: "scene", text: sections[1].title },
          { kind: "paragraph", sectionId: "scene", text: sections[1].body[0] }] } } as unknown as BrandPostPackageManifestV2;
      if (mode === "hero") {
        manifest.heroImagePath = primary;
        manifest.imageAssets!.push({ path: primary, sourcePath: primary, sha256: fileHash(primary), role: "hero", sectionId: null, provenance: "PHOTO_TEXT_THUMBNAIL",
          creationMethod: "local-composite", imageIntent: manifest.title });
      }
      const target = (): ResolvedImageTarget => generation.resolveBrandPostImageTarget(manifest,
        mode === "hero" ? { requestId: "fixture", replaceAssetKey: fileHash(primary), slotId: "hero:image:1" } : { requestId: "fixture", sectionId: "scene", slotId: "scene:image:1" });
      const includeSupport = mode === "receipt" || legacyPartialSupport;
      const deps = { collect: async () => [primary], select: async () => reference, selectSupporting: async () => includeSupport ? [support] : [] };
      const originalTarget = target();
      const context = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: originalTarget }, deps);
      const oldOptions = { productName: "검정 제품", sectionTitle: originalTarget.sectionTitle, imageIntent: originalTarget.imageIntent, bodyExcerpt: originalTarget.bodyExcerpt,
        stagingRecipe: originalTarget.promptRecipe, role: originalTarget.role, variantIndex: mode === "hero" ? 0 : 2, adjacentSectionTitles: mode === "hero" ? [] : [sections[0].title, sections[2].title],
        physicalScale: manifest.productUnderstanding!.concept.physicalScale, productImageDirective: manifest.productUnderstanding!.policy.imageDirective };
      context.prompt = buildShoppingReferenceScenePrompt({ ...oldOptions, reference, hasAnchor: false, supportingReferences: includeSupport ? [support] : [] });
      context.preparationBinding = hash(JSON.stringify({ snapshotId: snapshot.snapshotId,
        selectedProduct: selectedProductContextFrom9Canvas(manifest.productUnderstanding!), promptOptions: oldOptions }));
      const work = path.join(dir, "image-generation-work/resume-v2");
      const original = generation.prepareImageBatchJobs([originalTarget], manifest, "검정 제품", work)[0];
      const metadataPath = `${original.outStem}.reference-scene.json`, meta = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      if (mode === "legacy") { delete meta.referenceContext; fs.writeFileSync(metadataPath, JSON.stringify(meta)); }
      const startedAtMs = Date.now() - 500, threadId = crypto.randomUUID(), workspace = `${original.outStem}.codex-1`;
      fs.mkdirSync(workspace);
      const native = path.join(process.env.CODEX_HOME!, "generated_images", threadId); fs.mkdirSync(native, { recursive: true });
      const output = path.join(native, "actual.png"); fs.writeFileSync(output, png("one actual completed photograph")); fs.copyFileSync(output, `${original.outStem}.png`);
      const receiptPath = `${original.outStem}.codex-submission.json`;
      fs.writeFileSync(receiptPath, JSON.stringify({ state: "completed", workspace, startedAtMs, threadId, completedAtMs: Date.now(),
        generationBudget: { limit: 1, observedCalls: 1, observation: "rollout" } }));
      const day = new Date(startedAtMs).toISOString().slice(0, 10).split("-"), sessions = path.join(process.env.CODEX_HOME!, "sessions", ...day);
      fs.mkdirSync(sessions, { recursive: true });
      const rollout = path.join(sessions, `rollout-test-${threadId}.jsonl`);
      const refs = context.referenceImagePaths;
      const content = refs.flatMap((file, index) => [{ type: "input_text", text: `<image name=[Image #${index + 1}] path="${file}">` },
        { type: "input_image", image_url: `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`, detail: "high" }, { type: "input_text", text: "</image>" }]);
      content.push({ type: "input_text", text: buildCodexImageInstruction(original.prompt, refs.length, "product") });
      const records = [{ timestamp: new Date(startedAtMs).toISOString(), type: "session_meta", payload: { id: threadId, cwd: workspace, thread_source: "blogautomcp-image" } },
        { timestamp: new Date(startedAtMs).toISOString(), type: "event_msg", payload: { type: "task_started", turn_id: "owned-turn" } },
        { timestamp: new Date(startedAtMs).toISOString(), type: "response_item", payload: { type: "message", role: "user", content } },
        { timestamp: new Date(startedAtMs).toISOString(), type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "one-generation",
          input: "const result = await tools.image_gen__imagegen({prompt: 'fixture'});" } },
        { timestamp: new Date().toISOString(), type: "event_msg", payload: { type: "task_complete", turn_id: "owned-turn" } }];
      const writeRollout = () => fs.writeFileSync(rollout, records.map(record => JSON.stringify(record)).join("\n") + "\n"); writeRollout();
      const before = { metadata: fs.readFileSync(metadataPath), receipt: fs.readFileSync(receiptPath), rollout: fs.readFileSync(rollout), raw: fs.readFileSync(`${original.outStem}.png`) };
      const noReselect = { collect: async () => { throw new Error("unexpected reference collection"); }, select: async () => { throw new Error("unexpected new source selection"); },
        selectSupporting: async () => { throw new Error("unexpected new support selection"); } };
      const prepare = async () => { const t = target(); t.referenceContext = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: t }, noReselect);
        return { target: t, job: generation.prepareImageBatchJobs([t], manifest, "검정 제품", work)[0] }; };
      const unchanged = () => { assert.deepEqual(fs.readFileSync(metadataPath), before.metadata); assert.deepEqual(fs.readFileSync(receiptPath), before.receipt);
        assert.deepEqual(fs.readFileSync(rollout), before.rollout); assert.deepEqual(fs.readFileSync(`${original.outStem}.png`), before.raw); };
      return { manifest, work, original, prepare, target, metadataPath, receiptPath, primary, geometry, sources, records, writeRollout, rollout, output, unchanged, receipt, urls };
    }
    const legacy = await fixture();
    // A final native wrong-print decision is distinct from transport completion
    // or generic historical rejection. A competing parent remains a hold.
    async function publicationFixture(competing = false) {
      const f = await fixture("receipt"), dir = path.dirname(path.dirname(f.work)), currentSha = fileHash(`${f.original.outStem}.png`);
      const scene = { path: `${f.original.outStem}.png`, sourcePath: `${f.original.outStem}.png`, sha256: currentSha, role: "body" as const,
        sectionId: "scene", slotId: "scene:image:1", provenance: "GENERATED_SCENE" as const, creationMethod: "reference-guided-scene" as const,
        remoteGenerated: true, imageIntent: "AI 연출 이미지", referenceScene: { strategyVersion: SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION,
          referencePath: f.primary, referenceSha256: fileHash(f.primary), sourceSnapshotId: f.manifest.sourceSnapshot!.snapshotId,
          reviewedOutputSha256: currentSha, reviewStatus: "passed" as const, reviewedAt: new Date().toISOString(), reason: "earlier scene review",
          checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])) } };
      f.manifest.imageAssets = [scene]; f.manifest.bodyImagePaths = [scene.path]; f.manifest.composition.sections[1].imagePaths = [scene.path];
      f.manifest.composition.renderNodes.push({ kind: "image", sectionId: "scene", assetPath: scene.path,role:"detail" } as never);
      const oldStem = path.join(f.work, `raw-${"3".repeat(64)}`), oldThread = crypto.randomUUID(), oldWorkspace = `${oldStem}.codex-1`;
      fs.mkdirSync(oldWorkspace); fs.copyFileSync(f.metadataPath, `${oldStem}.reference-scene.json`);
      const native = path.join(process.env.CODEX_HOME!, "generated_images", oldThread); fs.mkdirSync(native, { recursive: true });
      fs.writeFileSync(path.join(native, "old.png"), png("old visibly blank historical product")); fs.copyFileSync(path.join(native, "old.png"), `${oldStem}.png`);
      const oldSha = fileHash(`${oldStem}.png`), oldReceipt = { ...JSON.parse(fs.readFileSync(f.receiptPath, "utf8")), threadId: oldThread, workspace: oldWorkspace };
      fs.writeFileSync(`${oldStem}.codex-submission.json`, JSON.stringify(oldReceipt));
      const oldRecords = structuredClone(f.records) as Array<{ timestamp: string; type: string; payload: Record<string, unknown> }>;
      oldRecords[0].payload = { ...oldRecords[0].payload, id: oldThread, cwd: oldWorkspace };
      const oldRollout = path.join(path.dirname(f.rollout), `rollout-test-${oldThread}.jsonl`); fs.writeFileSync(oldRollout, oldRecords.map(row => JSON.stringify(row)).join("\n") + "\n");
      assert.ok(readCompletedProductRequest(oldStem)); checks++;
      if (!competing) for (const suffix of [".png", ".reference-scene.json", ".codex-submission.json"]) fs.rmSync(`${oldStem}${suffix}`);
      const pair: IntrinsicIdentifierPair = { candidateLiteral: "Voltum", sourceLiteral: "Voltium", identifierRole: "brand" as const, sourceImageIndex: 3, sourceSha256: fileHash(f.geometry),
        sourceLocation: "intrinsic" as const, candidateLocation: "intrinsic" as const, sourceReadability: "legible" as const, candidateReadability: "legible" as const,
        sameSelectedComponent: true, sameSelectedVisibleOption: true, candidateBox: [100, 100, 400, 160] as [number, number, number, number],
        sourceBox: [200, 200, 600, 260] as [number, number, number, number] };
      const engine = path.join(dir, "fixture-ocr-binary"), data = path.join(dir, "fixture-traineddata"); fs.writeFileSync(engine, "unit fixture binary"); fs.writeFileSync(data, "unit fixture data");
      const ocrImage = (originalSha256: string, box: [number, number, number, number], literal: string) => ({ originalSha256, box,
        pixelBox: { left: 1, top: 1, width: 100, height: 30 }, regionSha256: hash(literal + " fixture region"), transcripts: [],
        consensus: { literal, normalized: literal.toLowerCase(), minimumConfidence: 95, presets: ["raw-1x", "gray-normal-invert-2x"] } });
      const identifierConflict: IntrinsicIdentifierServerConflict = { version: "intrinsic-identifier-conflict/v1", pair, evidence: {
        version: INTRINSIC_IDENTIFIER_OCR_VERSION, nativeExecution: true, sourceLiteral: pair.sourceLiteral, normalizedSourceLiteral: "voltium",
        source: ocrImage(fileHash(f.geometry), pair.sourceBox!, "Voltium"), candidate: ocrImage(currentSha, pair.candidateBox!, "Voltum"),
        engine: { binaryPath: engine, binarySha256: fileHash(engine), traineddataPath: data, traineddataSha256: fileHash(data), configHash: hash("fixture config") } } };
      const comparison = { primaryReferenceImageIndex: 2, primaryReferenceSha256: fileHash(f.primary), primaryObservation: "selected shape and its button face",
        candidateObservation: "readable wrong identifying brand", objectionKind: "conflicting-print", evidenceImageIndex: 3,
        samePhysicalPart: true, samePhysicalSurface: false, sameSelectedVisibleOption: true,
        referencePrintState: "present", candidatePrintState: "present", candidateIdentifierVisibility: "legible", identifierComparisons: [pair],
        evidenceObservation: "selected actual brand on supplemental other face", basis: "source Voltium; candidate Voltum" };
      const verdict = { accepted: false, identityMatches: false, referenceComparison: comparison }, plane = { primaryReferenceImageIndex: 2,
        primaryReferenceSha256: fileHash(f.primary), supplementalReferences: [{ imageIndex: 3, sha256: fileHash(f.geometry) }] };
      const policy = publicationImageAuditPolicyFingerprint();
      const record = (row = verdict, conflict: IntrinsicIdentifierServerConflict | null = identifierConflict) => recordPublicationImageDefect({ manifest: f.manifest, sectionId: "scene", sha256: currentSha,
        policyFingerprint: policy, requestBindingSha256: hash("actual native request bytes"), verdict: row, context: plane, identifierConflict: conflict || undefined });
      const target = () => generation.resolveBrandPostImageTarget(f.manifest, { requestId: "final-repair", sectionId: "scene", slotId: "scene:image:1", replaceAssetKey: currentSha });
      const plan = () => planPublicationImageRetry({ manifest: f.manifest, target: target(), packageDir: dir, policyFingerprint: policy });
      const ledgerPath = path.join(dir, "publish-image-rejections.json");
      const ledger = [oldSha, currentSha].map(sha256 => ({ sha256, sectionId: "scene", context: publicationImageContext(f.manifest.composition, "scene"), scope: "product" }));
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger)); fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(f.manifest));
      return { f, dir, currentSha, oldSha, oldStem, oldRollout, target, plan, record, verdict, policy, ledgerPath, ledger, identifierConflict };
    }
    const finalRetry = await publicationFixture();
    assert.equal(finalRetry.plan(), null, "generic rejection cannot authorize a request"); checks++;
    finalRetry.record({ ...finalRetry.verdict, referenceComparison: { ...finalRetry.verdict.referenceComparison, objectionKind: "unresolved" } }, null);
    assert.equal(finalRetry.plan(), null, "uncertainty is not a concrete typed print defect"); checks++;
    finalRetry.record(); const finalPlan = finalRetry.plan();
    assert.equal(finalPlan?.parent.dispositions.length, 1); checks++;
    const stableRecords = [finalRetry.f.metadataPath, finalRetry.f.receiptPath, finalRetry.f.rollout, `${finalRetry.f.original.outStem}.png`,
      finalRetry.oldRollout].map(file => [file, fileHash(file)]);
    const newView = { ...JSON.parse(fs.readFileSync(finalRetry.f.metadataPath, "utf8")).referenceContext.reference,
      viewObservation: { subjectState: "freestanding", cameraView: "front", geometryVisibility: "complete", hiddenParts: [], intrinsicPrint: "readable", readableIdentifiers: ["Voltium"] } } as ShoppingSceneReference;
    const freshTarget = finalRetry.target();
    await generation.prepareBrandPostImageReferenceContext({ manifest: finalRetry.f.manifest, target: freshTarget, productName: "검정 제품" },
      { collect: async () => [finalRetry.f.primary], select: async () => newView, selectSupporting: async () => [] });
    assert.ok(freshTarget.referenceContext?.publicationRetryOf); assert.equal(freshTarget.referenceContext?.completedRequestRecovery, undefined); checks += 2;
    assert.equal(freshTarget.referenceContext!.reference.sha256,fileHash(finalRetry.f.primary),"a clearer label close-up cannot replace the parent's primary shape/view");
    const mandatoryLabel=freshTarget.referenceContext!.supportingReferences?.find(row=>row.sha256===finalRetry.identifierConflict.pair.sourceSha256);
    assert.ok(mandatoryLabel && mandatoryLabel.purpose==="intrinsic-label","the exact native/OCR conflict source must be attached, even if an optional selector would omit it");
    assert.equal(JSON.parse(mandatoryLabel.labels).sourceLiteral,finalRetry.identifierConflict.pair.sourceLiteral,"generation copies observed actual intrinsic lettering, never a guessed product-name translation");checks+=3;
    const freshJob = generation.prepareImageBatchJobs([freshTarget], finalRetry.f.manifest, "검정 제품", finalRetry.f.work)[0];
    assert.equal(freshJob.referenceImagePaths![0],finalRetry.f.primary);assert.ok(freshJob.referenceImagePaths!.includes(mandatoryLabel.path));checks+=2;
    assert.notEqual(freshJob.outStem, finalRetry.f.original.outStem); assert.notEqual(freshJob.outStem, finalRetry.oldStem); assert.equal(freshJob.reviewOnly, undefined); checks += 3;
    const repeatTarget = finalRetry.target();
    await generation.prepareBrandPostImageReferenceContext({ manifest: finalRetry.f.manifest, target: repeatTarget, productName: "검정 제품" },
      { collect: async () => { throw new Error("repeat collection"); }, select: async () => { throw new Error("repeat source review"); } });
    assert.equal(generation.prepareImageBatchJobs([repeatTarget], finalRetry.f.manifest, "검정 제품", finalRetry.f.work)[0].outStem, freshJob.outStem); checks++;
    const childMetadataPath = `${freshJob.outStem}.reference-scene.json`, childMetadataBytes = fs.readFileSync(childMetadataPath);
    const changedChild = JSON.parse(childMetadataBytes.toString()); changedChild.referenceContext.prompt += "different plan";
    fs.writeFileSync(childMetadataPath, JSON.stringify(changedChild)); assert.throws(finalRetry.plan, /IMAGE_RESUME_REQUIRED/); checks++;
    fs.writeFileSync(childMetadataPath, childMetadataBytes);
    fs.writeFileSync(`${freshJob.outStem}.codex-submission.json`, JSON.stringify({ state: "submitting", workspace: `${freshJob.outStem}.codex-1`, startedAtMs: Date.now(), threadId: null }));
    const pendingFinal = finalRetry.target();
    await generation.prepareBrandPostImageReferenceContext({ manifest: finalRetry.f.manifest, target: pendingFinal, productName: "검정 제품" },
      { collect: async () => { throw new Error("pending child cannot recollect"); }, select: async () => { throw new Error("pending child cannot reselect"); } });
    assert.equal(generation.prepareImageBatchJobs([pendingFinal], finalRetry.f.manifest, "검정 제품", finalRetry.f.work)[0].outStem, freshJob.outStem); checks++;
    fs.rmSync(`${freshJob.outStem}.codex-submission.json`);
    const forgedChild = path.join(finalRetry.f.work, `raw-${"a".repeat(64)}`);
    fs.copyFileSync(childMetadataPath, `${forgedChild}.reference-scene.json`); assert.throws(finalRetry.plan, /IMAGE_RESUME_REQUIRED/); checks++;
    fs.rmSync(`${forgedChild}.reference-scene.json`);
    for (const [file, expected] of stableRecords) { assert.equal(fileHash(file), expected); checks++; }
    const competing = await publicationFixture(true); competing.record();
    assert.equal(competing.plan()?.parent.dispositions.length, 2, "a different strictly terminal old output is preserved as sealed history, not mistaken for the current origin"); checks++;
    for (const negative of ["unknown", "orphan", "budget", "changed-prompt", "unrejected", "changed-body", "tampered-proof", "unknown-lock"] as const) {
      const f = await publicationFixture(); f.record();
      if (negative === "unknown") {
        const stem = path.join(f.f.work, `raw-${"9".repeat(64)}`); fs.copyFileSync(f.f.metadataPath, `${stem}.reference-scene.json`);
        fs.writeFileSync(`${stem}.codex-submission.json`, JSON.stringify({ state: "submitting", workspace: `${stem}.codex-1`, startedAtMs: Date.now(), threadId: null }));
      } else if (negative === "orphan") fs.writeFileSync(path.join(path.dirname(f.f.work), `raw-${"b".repeat(64)}.codex-submission.json`), "{}");
      else if (negative === "unknown-lock") fs.writeFileSync(`${f.f.original.outStem}.lock`, "{}");
      else if (negative === "budget") {
        const receipt = JSON.parse(fs.readFileSync(f.f.receiptPath, "utf8")); receipt.generationBudget.observedCalls = 2;
        fs.writeFileSync(f.f.receiptPath, JSON.stringify(receipt));
      } else if (negative === "changed-prompt") {
        fs.writeFileSync(f.f.rollout, fs.readFileSync(f.f.rollout, "utf8").replace("Reference and section data", "changed Reference and section data"));
      } else if (negative === "unrejected") fs.writeFileSync(f.ledgerPath, JSON.stringify(f.ledger.filter(row => row.sha256 !== f.currentSha)));
      else if (negative === "changed-body") f.f.manifest.composition.sections[1].body.push("changed");
      else {
        const proof = readPublicationImageDefect(f.f.manifest, "scene", f.currentSha, f.policy)!; const row = JSON.parse(fs.readFileSync(proof.path, "utf8"));
        row.requestBindingSha256 = hash("tampered"); fs.writeFileSync(proof.path, JSON.stringify(row));
      }
      assert.throws(f.plan, /IMAGE_RESUME_REQUIRED/);
      checks++;
    }
    const stale = await publicationFixture(); stale.record();
    assert.throws(() => planPublicationImageRetry({ manifest: stale.f.manifest, target: stale.target(), packageDir: stale.dir,
      policyFingerprint: hash("a different policy") }), /IMAGE_RESUME_REQUIRED/); checks++;
    const brokenLocator = await publicationFixture(); brokenLocator.record();
    const seenPath = path.join(root, "data/publication-image-defect-proofs", `seen-${hash(JSON.stringify({ id: brokenLocator.f.manifest.brandLinkId,
      sectionId: "scene", sha256: brokenLocator.currentSha }))}.json`);
    fs.writeFileSync(seenPath, "broken"); assert.throws(brokenLocator.plan, /IMAGE_RESUME_REQUIRED/); checks++;
    for (const kind of ["no-native-ocr", "ocr-native-candidate-disagree", "wrong-source", "unselected-component"] as const) {
      const f = await publicationFixture(), conflict = structuredClone(f.identifierConflict);
      if (kind === "no-native-ocr") conflict.evidence.nativeExecution = false;
      if (kind === "ocr-native-candidate-disagree") {
        conflict.pair.candidateLiteral = "Voltium";
        f.verdict.referenceComparison.identifierComparisons = [conflict.pair];
      }
      if (kind === "wrong-source") conflict.evidence.source.originalSha256 = hash("another source");
      if (kind === "unselected-component") conflict.pair.sameSelectedComponent = false;
      f.record(f.verdict, conflict); assert.equal(f.plan(), null, "uncorroborated observations cannot mint native regeneration authority"); checks++;
    }
    async function isolatedFixture() {
      const f = await publicationFixture(), input: PublicationIdentifierReviewInput = { candidatePath: f.f.manifest.imageAssets![0].path,
        candidateSha256: f.currentSha, primaryReference: { path: f.f.primary, sha256: fileHash(f.f.primary) },
        canonicalReferences: [f.f.primary, f.f.geometry].map(file => ({ path: file, sha256: fileHash(file), sourceSnapshotId: f.f.manifest.sourceSnapshot!.snapshotId })), workspace: root };
      const packets = buildScopedPublicationPackets({ candidatePath: input.candidatePath, candidateSha256: input.candidateSha256,
        primaryReference: input.primaryReference, role: "detail", exactCanonicalSellerOriginal: false, sectionTitle: "제목 1", sectionBody: ["원문 1"],sectionBodyRenderNodeIndices:[1],
        allowProductPhoto: true, selection: visibleIdentityReviewContext(""), selectedProduct: JSON.stringify({selectedTitle:"Synthetic selected component"}) });
      const a = { memberBrandScope:"selected-main-product-body",memberBrandObservation:"Visible main physical product body, not an independent accessory", reason: "Synthetic native geometry correspondence", picturedMemberEvidence: {scope:"pictured-member-only",memberFactIndex:0,picturedMember:"visible selected fixture member",verdict:"selected-member-visible",selectedFact:"Synthetic selected component",
        referenceObservation:"source selected visible member",candidateObservation:"candidate same visible member",conflict:""}, identityMatches: true, accepted: true, visibleIdentityEvidence: { basis: "observed-correspondence", landmarks: [
          { part: "contour", referenceObservation: "source contour", candidateObservation: "candidate contour" },
          { part: "connection", referenceObservation: "source connection", candidateObservation: "candidate connection" }], conflict: "" } };
      const c = { reason: "Synthetic native claims and format", photoClaimObjection: { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" },
        optionConflictWitness: { origin: "none", quote: "", visibleAlternatives: [] }, photoClaimMatches: true, intrinsicPrintProofClaim:false, mixedOptions: false,
        explicitNamedComparison: false, optionsClearlyLabeled: false, reviewClass: "product-photo", accepted: true };
      const d = {reason:"Synthetic pixel-only format",pixelFormatObjection:{kind:"none",location:"",observation:""},notice:false,singlePhotograph:true,noGraphicLayout:true,textPolicyMatches:true,thumbnailHeadlineLegible:true,accepted:true};
      const evidence = (index: number, row: Record<string, unknown>): ScopedReviewEvidence => { const packet = packets[index], rawResponse = serializeScopedPublicationResponse(packet.task,row);
        return { version: "publication-image-scoped-review/v2", task: packet.task, requestSha256: packet.requestSha256,
          request: { ...packet.call, imagePaths: packet.call.imagePaths!.map(fileHash) }, context: packet.context,
          responseSha256: hash(rawResponse), rawResponse, row:parseScopedPublicationResponse(packet.task,rawResponse,packet.call.outputSchema,packet.call.userPrompt), nativeExecution: true }; };
      const comparison: PublicationIdentifierComparison = { sourceImageIndex: 3, sourceSha256: fileHash(f.f.geometry), sourceObservation: "Actual synthetic source Voltium",
        candidateObservation: "Actual synthetic candidate Voltum", correspondenceObservation: "The same locally selected component and colour", samePhysicalPart: true,
        samePhysicalSurface: true, sameSelectedVisibleOption: true, sourcePrintState: "present", candidatePrintState: "present", sourceBox: f.identifierConflict.pair.sourceBox!,
        candidateBox: f.identifierConflict.pair.candidateBox!, sourceLiteral: "Voltium", identifierRole: "brand", sourceRegionCoverage: "entire-observed-identifier",
        candidateRegionCoverage: "entire-corresponding-print-location", candidateSurfaceCondition: "marked", candidateIdentifierVisibility: "legible",
        identifierComparisons: [f.identifierConflict.pair], reason: "Actual synthetic readable different identifier", accepted: false };
      const primaryObservation: IntrinsicIdentifierObservation = {literal:"",box:null,identifierRole:"none",location:"not-observed",readability:"absent"};
      const sourceObservation: IntrinsicIdentifierObservation = {literal:"Voltium",box:f.identifierConflict.pair.sourceBox!,identifierRole:"brand",location:"intrinsic",readability:"legible"};
      const candidateObservation: IntrinsicIdentifierObservation = {literal:"Voltum",box:f.identifierConflict.pair.candidateBox!,identifierRole:"brand",location:"intrinsic",readability:"legible"};
      const observeEvidence = (sha256:string,observation:IntrinsicIdentifierObservation):IntrinsicIdentifierObserverEvidence => {const rawResponse=serializeIntrinsicIdentifierObserverResponse(observation);return {
        version:INTRINSIC_IDENTIFIER_OBSERVER_VERSION,nativeExecution:true,imageSha256:sha256,requestSha256:intrinsicIdentifierObserverRequestSha256(sha256),
        responseSha256:hash(rawResponse),rawResponse,observation};};
      const blindInputObservations = {candidate:observeEvidence(f.currentSha,candidateObservation),sources:[
        {imageIndex:2,sha256:fileHash(f.f.primary),evidence:observeEvidence(fileHash(f.f.primary),primaryObservation)},
        {imageIndex:3,sha256:fileHash(f.f.geometry),evidence:observeEvidence(fileHash(f.f.geometry),sourceObservation)}]};
      const sourceMeta = await sharp(f.f.geometry).metadata(), candidateMeta = await sharp(input.candidatePath).metadata();
      const localPair = {sourceImageIndex:3,sourceDimensions:{width:sourceMeta.width!,height:sourceMeta.height!},candidateDimensions:{width:candidateMeta.width!,height:candidateMeta.height!},coordinateSpace:"normalized-1000" as const};
      const context = { candidateSha256: f.currentSha, primaryReferenceImageIndex: 2 as const, primaryReferenceSha256: fileHash(f.f.primary),
        references: input.canonicalReferences.map((reference, index) => ({ imageIndex: index + 2, sha256: fileHash(reference.path), sourceSnapshotId: reference.sourceSnapshotId })),localPair };
      const rawB = JSON.stringify({coordinateSpace:"normalized-1000",sourceImageSize:localPair.sourceDimensions,candidateImageSize:localPair.candidateDimensions,comparison});
      const identifiers: PublicationIdentifierReviewResult = { version: "publication-identifier-review/v1", strategyVersion:"blind-two-image/v1",status: "conflict",blindInputObservations,
        nativeExecution: true, reason: "Synthetic separately corroborated conflict", rawB, comparison, context,
        requestSha256: publicationIdentifierReviewRequestSha256(context,blindInputObservations), responseSha256: hash(rawB), identifierConflict: {...f.identifierConflict,
          blindObservations:{source:blindInputObservations.sources[1].evidence,candidate:blindInputObservations.candidate}} };
      return { f, visibleReview: evidence(0, a), claimsReview: evidence(1, c), formatReview:evidence(2,d), identifiers, input,
        record: (visibleReview: ScopedReviewEvidence, claimsReview: ScopedReviewEvidence, identifierReview: PublicationIdentifierReviewResult) =>
          recordScopedPublicationImageDefect({ manifest: f.f.manifest, sectionId: "scene", sha256: f.currentSha, policyFingerprint: f.policy,
            visibleReview, claimsReview, formatReview:evidence(2,d), identifierReview, identifierInput: input }) };
    }
    const scoped = await isolatedFixture(); assert.equal(publicationIdentifierReviewEvidenceIssue(scoped.identifiers,scoped.input),null,"scoped B fixture must satisfy the production reader"); scoped.record(scoped.visibleReview, scoped.claimsReview, scoped.identifiers);
    const scopedProof = readPublicationImageDefect(scoped.f.f.manifest, "scene", scoped.f.currentSha, scoped.f.policy)!;
    assert.ok(scopedProof && scopedProof.proof.version === "publication-image-print-defect/v4", "scoped native v4 proof must exist");
    assert.equal(scopedProof.proof.defectKind, "conflicting-print"); assert.equal(scoped.f.plan()?.parent.dispositions.length, 1); checks += 3;
    assert.deepEqual(readPublicationDefectMaterialContext(scopedProof.proof)?.composition,scoped.f.f.manifest.composition); checks++;
    const contextSidecar=path.join(root,"data/publication-image-defect-proofs",scopedProof.proof.materialContext.file),sidecarBytes=fs.readFileSync(contextSidecar);
    fs.appendFileSync(contextSidecar," ");assert.equal(readPublicationImageDefect(scoped.f.f.manifest,"scene",scoped.f.currentSha,scoped.f.policy),null);checks++;
    fs.writeFileSync(contextSidecar,sidecarBytes);fs.renameSync(contextSidecar,`${contextSidecar}.missing`);
    assert.equal(readPublicationImageDefect(scoped.f.f.manifest,"scene",scoped.f.currentSha,scoped.f.policy),null);checks++;
    fs.renameSync(`${contextSidecar}.missing`,contextSidecar);
    const holdFile = path.join(scoped.f.dir, "publish-image-regeneration-holds.json");
    recordPublicationImageRegenerationHolds(scoped.f.f.manifest.brandLinkId, scoped.f.f.manifest.composition, [{ sha256: scoped.f.currentSha,
      sectionId: "scene", slotId: "scene:image:1", sourceSnapshotId: scoped.f.f.manifest.sourceSnapshot!.snapshotId,
      policyFingerprint: scoped.f.policy, kind: "uncorroborated-identifier" }]);
    const heldBytes = fs.readFileSync(holdFile), scopedView = { ...JSON.parse(fs.readFileSync(scoped.f.f.metadataPath, "utf8")).referenceContext.reference,
      viewObservation: { subjectState: "freestanding", cameraView: "front", geometryVisibility: "complete", hiddenParts: [], intrinsicPrint: "readable", readableIdentifiers: ["Voltium"] } } as ShoppingSceneReference;
    const heldTarget = scoped.f.target();
    await generation.prepareBrandPostImageReferenceContext({ manifest: scoped.f.f.manifest, target: heldTarget, productName: "검정 제품" },
      { collect: async () => [scoped.f.f.primary], select: async () => scopedView, selectSupporting: async () => [] });
    assert.ok(heldTarget.referenceContext?.publicationRetryOf, "only a fresh exact native v3 concrete proof can enter the bounded planner through valid uncertainty");
    assert.deepEqual(fs.readFileSync(holdFile), heldBytes, "the prior unresolved HOLD remains immutable history, never approval"); checks += 2;
    fs.writeFileSync(holdFile, "[");
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest: scoped.f.f.manifest, target: scoped.f.target(), productName: "검정 제품" }), /PUBLICATION_IMAGE_REGENERATION_HELD/u);
    fs.writeFileSync(holdFile, heldBytes); checks++;
    const proofBytes = fs.readFileSync(scopedProof.path), tamperedProof = JSON.parse(proofBytes.toString()); tamperedProof.policyFingerprint = hash("stale policy");
    fs.writeFileSync(scopedProof.path, JSON.stringify(tamperedProof));
    await assert.rejects(generation.prepareBrandPostImageReferenceContext({ manifest: scoped.f.f.manifest, target: scoped.f.target(), productName: "검정 제품" }), /PUBLICATION_IMAGE_REGENERATION_HELD/u);
    fs.writeFileSync(scopedProof.path, proofBytes); checks++;
    for (const mutation of ["injected-a", "injected-b", "raw-a", "raw-b", "unknown-part", "wrong-source", "c-false", "not-selected-component"] as const) {
      const v = await isolatedFixture();
      if (mutation === "injected-a") v.visibleReview.nativeExecution = false;
      if (mutation === "injected-b") v.identifiers.nativeExecution = false;
      if (mutation === "raw-a") v.visibleReview.rawResponse += " ";
      if (mutation === "raw-b") v.identifiers.rawB += " ";
      if (mutation === "unknown-part") v.identifiers.identifierConflict!.pair.sameSelectedComponent = null;
      if (mutation === "wrong-source") v.input.primaryReference.sha256 = hash("foreign primary");
      if (mutation === "c-false") v.claimsReview.row!.accepted = false;
      if (mutation === "not-selected-component") (v.visibleReview.row!.picturedMemberEvidence as {verdict:string}).verdict = "nonselected-subject-visible";
      v.record(v.visibleReview, v.claimsReview, v.identifiers); assert.equal(v.f.plan(), null, `${mutation}: no separate native proof/one-child authority`); checks++;
    }
    const nativePositive = await publicationFixture();
    nativePositive.record({ ...nativePositive.verdict, accepted: true, identityMatches: true,
      referenceComparison: { ...nativePositive.verdict.referenceComparison, objectionKind: "none" } });
    const positiveProof = readPublicationImageDefect(nativePositive.f.manifest, "scene", nativePositive.currentSha, nativePositive.policy)!;
    assert.ok(positiveProof.proof.version === "publication-image-conflicting-print/v2");
    assert.equal(positiveProof.proof.rawVerdict.accepted, true); assert.equal(positiveProof.proof.rawVerdict.identityMatches, true);
    assert.equal(nativePositive.plan()?.parent.dispositions.length, 1, "derived corroborated defect is separate from unchanged raw model verdict"); checks += 3;
    const changedEngine = await publicationFixture(); changedEngine.record(); fs.appendFileSync(changedEngine.identifierConflict.evidence.engine.binaryPath, "changed");
    assert.throws(changedEngine.plan, /IMAGE_RESUME_REQUIRED/); checks++;
    const blindEvidence = (sha256: string, observation: IntrinsicIdentifierObservation): IntrinsicIdentifierObserverEvidence => {
      const rawResponse = serializeIntrinsicIdentifierObserverResponse(observation);
      return { version: INTRINSIC_IDENTIFIER_OBSERVER_VERSION, nativeExecution: true, imageSha256: sha256,
        requestSha256: intrinsicIdentifierObserverRequestSha256(sha256), responseSha256: hash(rawResponse), rawResponse, observation };
    };
    async function blindFixture() {
      const f = await publicationFixture(), conflict = structuredClone(f.identifierConflict), original = structuredClone(conflict.pair);
      f.verdict.referenceComparison.identifierComparisons = [{ ...original, sourceLiteral: "Volt(i)um (unclear observed letters)", sourceBox: [210, 200, 450, 250] }];
      conflict.blindObservations = {
        source: blindEvidence(conflict.pair.sourceSha256!, { literal: conflict.pair.sourceLiteral, box: conflict.pair.sourceBox,
          identifierRole: "brand", location: "intrinsic", readability: "legible" }),
        candidate: blindEvidence(f.currentSha, { literal: conflict.pair.candidateLiteral, box: conflict.pair.candidateBox,
          identifierRole: "brand", location: "intrinsic", readability: "legible" }),
      };
      return { f, conflict };
    }
    const blind = await blindFixture(), rawPair = JSON.stringify(blind.f.verdict.referenceComparison);
    blind.f.record(blind.f.verdict, blind.conflict);
    assert.equal(blind.f.plan()?.parent.dispositions.length, 1); checks++;
    const blindProof = readPublicationImageDefect(blind.f.f.manifest, "scene", blind.f.currentSha, blind.f.policy)!;
    assert.ok(blindProof.proof.version === "publication-image-conflicting-print/v2");
    assert.equal(JSON.stringify(blindProof.proof.comparison), rawPair, "raw uncertain native word/ROI is retained separately from blind transcription"); checks++;
    assert.equal(blindProof.proof.identifierConflict.blindObservations!.source.observation.literal, "Voltium"); checks++;
    for (const negative of ["injected", "source-sha", "request", "response", "parsed", "role", "box", "unselected", "unmapped", "other-component-locus"] as const) {
      const { f, conflict } = await blindFixture(), source = conflict.blindObservations!.source;
      if (negative === "injected") source.nativeExecution = false;
      if (negative === "source-sha") source.imageSha256 = hash("foreign source");
      if (negative === "request") source.requestSha256 = hash("prompt with expected word");
      if (negative === "response") source.rawResponse += " ";
      if (negative === "parsed") source.observation.literal = "Voltium guessed";
      if (negative === "role") conflict.pair.identifierRole = "sku";
      if (negative === "box") conflict.pair.sourceBox![0]++;
      if (negative === "unselected") conflict.pair.sameSelectedComponent = false;
      if (negative === "unmapped") conflict.pair.sourceImageIndex = 7;
      if (negative === "other-component-locus") {
        conflict.pair.sourceBox = [10, 10, 100, 60]; conflict.evidence.source.box = conflict.pair.sourceBox;
        conflict.blindObservations!.source = blindEvidence(conflict.pair.sourceSha256!, { ...source.observation, box: conflict.pair.sourceBox });
      }
      f.record(f.verdict, conflict); assert.equal(f.plan(), null, "invalid independent observation cannot authorize regeneration"); checks++;
    }
    const recovered = await legacy.prepare();
    assert.equal(recovered.job.outStem, legacy.original.outStem); assert.ok(recovered.job.reviewOnly?.completedRequestRecovery);
    assert.equal(recovered.job.prompt, legacy.original.prompt); assert.equal(recovered.job.reviewOnly.candidateSet?.candidates.length, 1); legacy.unchanged(); checks += 4;
    await generation.runImageBatch([recovered.job], legacy.work, async result => { assert.ok(result.recoveryJob); }, undefined,
      { runCodex: async () => { transportCalls++; throw new Error("unexpected provider"); }, runBrowser: async () => { transportCalls++; throw new Error("unexpected browser"); }, browserEnabled: true });
    const done = await generation.resolveCompletedProductImage({ job: recovered.job, target: recovered.target, manifest: legacy.manifest, productName: "검정 제품", workDir: legacy.work,
      reviewReferenceScene: async input => { reviews++; return { strategyVersion: SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION, referencePath: input.reference.path,
        referenceSha256: input.reference.sha256, reviewedOutputSha256: fileHash(input.outputPath), reviewStatus: "passed", reason: "current complete QA passed",
        reviewedAt: new Date().toISOString(), checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])) } as Awaited<ReturnType<typeof import("./lib/shopping-reference-scene").reviewShoppingReferenceScene>>; } });
    assert.equal(fileHash(done.generatedPath!), fileHash(legacy.output)); assert.equal(reviews, 1); assert.equal(transportCalls, 0); legacy.unchanged(); checks += 4;
    const drift = await fixture("receipt"), changedReceipt = `${drift.geometry}.retrieval.json`;
    fs.writeFileSync(changedReceipt, drift.receipt(drift.geometry, drift.urls[1], new Date().toISOString()));
    const changedBytes = fs.readFileSync(changedReceipt), receiptRecovery = await drift.prepare();
    assert.ok(receiptRecovery.job.reviewOnly?.completedRequestRecovery); assert.equal(receiptRecovery.job.outStem, drift.original.outStem);
    assert.deepEqual(fs.readFileSync(changedReceipt), changedBytes); drift.unchanged(); checks += 3;
    const adverse = await fixture(), rejected = await adverse.prepare();
    const fidelityFailure = () => Object.assign(new Error("REFERENCE_SCENE_FIDELITY_FAILED: actual wrong product shape"), {
      fidelityFailure: { version: "shopping-scene-fidelity-failure/v1", failedChecks: ["silhouette"], comparisonFailures: ["productShape"],
        accepted: false, identityMatches: false, illustrativeOnly: true } });
    await assert.rejects(generation.resolveCompletedProductImage({ job: rejected.job, target: rejected.target, manifest: adverse.manifest,
      productName: "검정 제품", workDir: adverse.work, reviewReferenceScene: async () => { throw fidelityFailure(); } }), /REFERENCE_SCENE_FIDELITY_FAILED/);
    const negativePath = `${adverse.original.outStem}.body-rejection.json`, negativeBytes = fs.readFileSync(negativePath);
    assert.ok(JSON.parse(negativeBytes.toString()).failure.failedChecks.includes("silhouette"));
    const changedReference = { ...rejected.target.referenceContext!.reference, viewObservation: { subjectState: "freestanding", cameraView: "front",
      geometryVisibility: "complete", hiddenParts: [], intrinsicPrint: "absent", readableIdentifiers: [] } } as ShoppingSceneReference;
    const improvedTarget = adverse.target();
    await generation.prepareBrandPostImageReferenceContext({ manifest: adverse.manifest, productName: "검정 제품", target: improvedTarget },
      { collect: async () => [adverse.primary], select: async () => changedReference, selectSupporting: async () => [] });
    assert.equal(improvedTarget.referenceContext?.retryOf?.outStem, adverse.original.outStem);
    assert.ok(improvedTarget.referenceContext?.retryOf?.completedRequestRecovery);
    const improvedJob = generation.prepareImageBatchJobs([improvedTarget], adverse.manifest, "검정 제품", adverse.work)[0];
    assert.notEqual(improvedJob.outStem, adverse.original.outStem); assert.equal(improvedJob.reviewOnly, undefined);
    const improvedMetadata = JSON.parse(fs.readFileSync(`${improvedJob.outStem}.reference-scene.json`, "utf8"));
    assert.ok(improvedMetadata.referenceContext.preparationBinding); assert.ok(improvedMetadata.referenceContext.prompt);
    assert.equal(improvedMetadata.referenceContext.completedRequestRecovery, undefined, "the new request owns its own frozen generation context");
    assert.deepEqual(fs.readFileSync(negativePath), negativeBytes); adverse.unchanged(); checks += 8;
    fs.writeFileSync(`${improvedJob.outStem}.codex-submission.json`, JSON.stringify({ state: "submitting", workspace: `${improvedJob.outStem}.codex-1`,
      startedAtMs: Date.now(), threadId: null }));
    const pendingTarget = adverse.target();
    await generation.prepareBrandPostImageReferenceContext({ manifest: adverse.manifest, productName: "검정 제품", target: pendingTarget },
      { collect: async () => { throw new Error("pending child must not recollect"); }, select: async () => { throw new Error("pending child must not reselect"); } });
    assert.equal(generation.prepareImageBatchJobs([pendingTarget], adverse.manifest, "검정 제품", adverse.work)[0].outStem, improvedJob.outStem);
    assert.deepEqual(fs.readFileSync(negativePath), negativeBytes); checks += 2;
    async function currentNegativeFixture() {
      const f = await fixture(), r = await f.prepare(); let error: unknown;
      try { await generation.resolveCompletedProductImage({ job: r.job, target: r.target, manifest: f.manifest, productName: "검정 제품", workDir: f.work,
        reviewReferenceScene: async () => { throw fidelityFailure(); } }); } catch (failure) { error = failure; }
      assert.ok(error instanceof Error);
      return { f, r, error };
    }
    const positiveReview = async (input: Parameters<typeof import("./lib/shopping-reference-scene").reviewShoppingReferenceScene>[0]) => ({
      strategyVersion: SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION, referencePath: input.reference.path, referenceSha256: input.reference.sha256,
      reviewedOutputSha256: fileHash(input.outputPath), reviewStatus: "passed", reason: "current improved photograph passed complete source and body QA",
      reviewedAt: new Date().toISOString(), checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true]))
    }) as Awaited<ReturnType<typeof import("./lib/shopping-reference-scene").reviewShoppingReferenceScene>>;
    async function automaticImprovement(mode: "pass" | "real-negative" | "provider-failed" | "duplicate-delivery" = "pass") {
      const { f, r, error } = await currentNegativeFixture(); let prepares = 0, dispatches = 0, finalReviews = 0;
      const rejection = fs.readFileSync(`${f.original.outStem}.body-rejection.json`);
      const plannedReference = { ...r.target.referenceContext!.reference, viewObservation: { subjectState: "freestanding", cameraView: "front",
        geometryVisibility: "complete", hiddenParts: [], intrinsicPrint: "absent", readableIdentifiers: [] } } as ShoppingSceneReference;
      const task = generation.repairRejectedCompletedBodyImage({ manifest: f.manifest, productName: "검정 제품", target: r.target, job: r.job,
        error, workDir: f.work, index: 0 }, {
        prepareContext: async options => { prepares++; return generation.prepareBrandPostImageReferenceContext(options,
          { collect: async () => [f.primary], select: async () => plannedReference, selectSupporting: async () => [] }); },
        runBatch: async (jobs, _work, onResult) => {
          dispatches++; assert.equal(jobs.length, 1); const next = jobs[0]; assert.notEqual(next.outStem, f.original.outStem);
          assert.equal(next.reviewOnly, undefined, "only one new, separately bound improved job reaches dispatch");
          if (mode === "provider-failed") { await onResult({ id: next.id, localPath: null, error: "CODEX_PROVIDER_FAILED: fixture" }, 0); return; }
          const raw = `${next.outStem}.png`; fs.writeFileSync(raw, png("one simulated improved provider result"));
          fs.writeFileSync(`${next.outStem}.codex-submission.json`, JSON.stringify({ state: "completed", workspace: `${next.outStem}.codex-1`,
            startedAtMs: Date.now() - 100, completedAtMs: Date.now(), threadId: "simulated-improvement" }));
          await onResult({ id: next.id, localPath: raw }, 0);
          if (mode === "duplicate-delivery") await onResult({ id: next.id, localPath: raw }, 0);
        },
        reviewReferenceScene: async input => { finalReviews++; if (mode === "real-negative") throw fidelityFailure(); return positiveReview(input); },
      });
      if (mode === "pass") { const result = await task; assert.ok(result?.generatedPath); assert.notEqual(fileHash(result.generatedPath), fileHash(f.original.outStem + ".png")); checks += 2; }
      else await assert.rejects(task, mode === "real-negative" ? /REFERENCE_SCENE_FIDELITY_FAILED/ : mode === "provider-failed" ? /CODEX_PROVIDER_FAILED/ : /IMAGE_RESUME_REQUIRED/);
      assert.equal(prepares, 1); assert.equal(dispatches, 1); assert.equal(finalReviews, mode === "provider-failed" ? 0 : 1);
      assert.deepEqual(fs.readFileSync(`${f.original.outStem}.body-rejection.json`), rejection); f.unchanged(); checks += 4;
      if (mode === "real-negative") {
        await assert.rejects(f.prepare(), /IMAGE_REPAIR_EXHAUSTED/, "a rejected improved result cannot recursively spend a third request"); checks++;
      }
    }
    for (const mode of ["pass", "real-negative", "provider-failed", "duplicate-delivery"] as const) await automaticImprovement(mode);
    for (const mode of ["fresh-owned", "normal-bound", "native-ocr-disagree", "host-budget", "already-child"] as const) {
      const f = await fixture("receipt"), target = f.target();
      target.referenceContext = JSON.parse(fs.readFileSync(f.metadataPath, "utf8")).referenceContext;
      const conflict = structuredClone(finalRetry.identifierConflict);
      conflict.pair.sourceSha256 = fileHash(f.geometry); conflict.evidence.source.originalSha256 = fileHash(f.geometry);
      conflict.evidence.candidate.originalSha256 = fileHash(f.original.outStem + ".png");
      const error = Object.assign(new Error("REFERENCE_SCENE_FIDELITY_FAILED: corroborated native intrinsic print contradiction"), {
        fidelityFailure: { version: "shopping-scene-fidelity-failure/v1", accepted: false, identityMatches: false, illustrativeOnly: true,
          failedChecks: ["labelHierarchy"], comparisonFailures: ["intrinsicPrinting"] }, identifierConflict: conflict,
        originalVerdict: { accepted: true, identityMatches: true } });
      await assert.rejects(generation.finishBrandPostGeneratedImage({ manifest: f.manifest, productName: "검정 제품", target,
        rawPath: `${f.original.outStem}.png`, workDir: f.work, index: 0, completedJob: f.original,
        reviewReferenceScene: async () => { throw error; } }), /REFERENCE_SCENE_FIDELITY_FAILED/); checks++;
      const failureBytes = fs.readFileSync(`${f.original.outStem}.body-rejection.json`);
      if (mode === "normal-bound") f.manifest.imageAssets = [{ path: `${f.original.outStem}.png`, sourcePath: `${f.original.outStem}.png`, sha256: fileHash(`${f.original.outStem}.png`),
        role: "body", sectionId: "scene", slotId: "scene:image:1", provenance: "GENERATED_SCENE", referenceScene: {
          reviewStatus: "passed", reviewedOutputSha256: fileHash(`${f.original.outStem}.png`) } } as never];
      if (mode === "native-ocr-disagree") conflict.pair.candidateLiteral = "Voltium";
      if (mode === "host-budget") { const receipt = JSON.parse(fs.readFileSync(f.receiptPath, "utf8")); receipt.generationBudget.observedCalls = 2; fs.writeFileSync(f.receiptPath, JSON.stringify(receipt)); }
      if (mode === "already-child") target.referenceContext!.retryOf = { outStem: "old", metadataSha256: hash("old"), rejectionSha256: hash("old proof") };
      let planned = 0, dispatches = 0;
      const task = generation.repairRejectedCompletedBodyImage({ manifest: f.manifest, productName: "검정 제품", target, job: f.original, error, workDir: f.work, index: 0 }, {
        prepareContext: async options => {
          planned++;
          const reference = { ...target.referenceContext!.reference, viewObservation: { subjectState: "freestanding", cameraView: "front", geometryVisibility: "complete",
            hiddenParts: [], intrinsicPrint: "absent", readableIdentifiers: [] } } as ShoppingSceneReference;
          return generation.prepareBrandPostImageReferenceContext(options, { collect: async () => [f.primary], select: async () => reference, selectSupporting: async () => [] });
        }, runBatch: async (jobs, _dir, callback) => {
          dispatches++; assert.equal(jobs.length, 1); assert.notEqual(jobs[0].outStem, f.original.outStem);
          assert.equal(jobs[0].reviewOnly, undefined); await callback({ id: jobs[0].id, localPath: null, error: "CODEX_PROVIDER_FAILED: offline fixture stops before generation" }, 0);
        },
      });
      if (mode === "fresh-owned") { await assert.rejects(task, /CODEX_PROVIDER_FAILED/); assert.equal(planned, 1); assert.equal(dispatches, 1); }
      else { assert.equal(await task, null, mode); assert.equal(planned, 0); assert.equal(dispatches, 0); }
      assert.deepEqual(fs.readFileSync(`${f.original.outStem}.body-rejection.json`), failureBytes); checks += 4;
    }
    for (const mode of ["provider-error", "invalid-review", "string-only", "global-only", "already-improved", "not-review-only", "missing-proof", "damaged-proof", "changed-body", "damaged-snapshot", "cancelled"] as const) {
      const { f, r, error } = await currentNegativeFixture(); let prepares = 0, dispatches = 0;
      let observedError: unknown = error;
      if (mode === "provider-error") observedError = new Error("CODEX_PROVIDER_FAILED: fixture");
      if (mode === "invalid-review") observedError = new Error("REFERENCE_SCENE_REVIEW_INVALID: fixture");
      if (mode === "string-only") observedError = new Error("REFERENCE_SCENE_FIDELITY_FAILED: no structured current evidence");
      if (mode === "global-only") observedError = Object.assign(new Error("REFERENCE_SCENE_FIDELITY_FAILED: contradictory accepted flag"), {
        fidelityFailure: { version: "shopping-scene-fidelity-failure/v1", accepted: false, identityMatches: true, illustrativeOnly: true, failedChecks: [], comparisonFailures: [] } });
      if (mode === "already-improved") r.target.referenceContext!.retryOf = { outStem: "older", metadataSha256: "a".repeat(64), rejectionSha256: "b".repeat(64) };
      if (mode === "not-review-only") delete r.job.reviewOnly;
      if (mode === "missing-proof") fs.unlinkSync(`${f.original.outStem}.body-rejection.json`);
      if (mode === "damaged-proof") { const file = `${f.original.outStem}.body-rejection.json`, p = JSON.parse(fs.readFileSync(file, "utf8")); p.metadataSha256 = "a".repeat(64); fs.writeFileSync(file, JSON.stringify(p)); }
      if (mode === "changed-body") f.manifest.composition.renderNodes = [{ kind: "paragraph", sectionId: "scene", text: "새 본문" }];
      if (mode === "damaged-snapshot") f.manifest.sourceSnapshot!.product.name = "다른 상품";
      const controller = new AbortController(); if (mode === "cancelled") controller.abort();
      const task = generation.repairRejectedCompletedBodyImage({ manifest: f.manifest, productName: "검정 제품", target: r.target, job: r.job,
        error: observedError, workDir: f.work, index: 0, signal: controller.signal }, {
        prepareContext: async () => { prepares++; throw new Error("unexpected planning"); }, runBatch: async () => { dispatches++; throw new Error("unexpected dispatch"); },
      });
      if (mode === "cancelled") await assert.rejects(task, /IMAGE_RESUME_REQUIRED/); else assert.equal(await task, null, mode);
      assert.equal(prepares, 0); assert.equal(dispatches, 0); checks += 3;
    }
    for (const mode of ["changed-during-plan", "wrong-retry-proof", "receipt-during-plan", "pixels-during-plan"] as const) {
      const { f, r, error } = await currentNegativeFixture(); let dispatches = 0;
      await assert.rejects(generation.repairRejectedCompletedBodyImage({ manifest: f.manifest, productName: "검정 제품", target: r.target, job: r.job,
        error, workDir: f.work, index: 0 }, {
        prepareContext: async options => {
          if (mode === "receipt-during-plan" || mode === "pixels-during-plan") {
            const planned = { ...r.target.referenceContext!.reference, viewObservation: { subjectState: "freestanding", cameraView: "front",
              geometryVisibility: "complete", hiddenParts: [], intrinsicPrint: "absent", readableIdentifiers: [] } } as ShoppingSceneReference;
            const context = await generation.prepareBrandPostImageReferenceContext(options,
              { collect: async () => [f.primary], select: async () => planned, selectSupporting: async () => [] });
            fs.appendFileSync(mode === "receipt-during-plan" ? `${f.primary}.retrieval.json` : f.primary, "changed");
            return context;
          }
          const context = { ...r.target.referenceContext! }; delete context.completedRequestRecovery;
          if (mode === "changed-during-plan") f.manifest.composition.renderNodes = [{ kind: "paragraph", sectionId: "scene", text: "중간에 바뀐 본문" }];
          options.target.referenceContext = context; return context;
        }, runBatch: async () => { dispatches++; throw new Error("unexpected dispatch"); },
      }), /IMAGE_RESUME_REQUIRED/);
      assert.equal(dispatches, 0); checks += 2;
    }
    await assert.rejects(generation.generateBrandPostImages({ manifest: legacy.manifest, productName: "검정 제품", requests: [], canonicalSourceOnly: true }), /REJECTED_ORIGINAL_REPAIR_INVALID/);
    checks++;
    const hero = await fixture("hero"), heroPrepared = await hero.prepare();
    const heroBinding = await generation.completedHeroReviewBinding(hero.manifest, "검정 제품");
    assert.match(heroBinding, /^[a-f0-9]{64}$/u); assert.ok(heroPrepared.job.reviewOnly); hero.unchanged(); checks += 2;
    const manifestPath = path.join(path.dirname(path.dirname(hero.work)), "manifest.json"); fs.writeFileSync(manifestPath, JSON.stringify(hero.manifest));
    const historyPath = path.join(path.dirname(manifestPath), "image-recovery-history.json");
    const oldInput = imageRecoverySignature(path.dirname(manifestPath));
    const historical = { stage: "repair-rejected", input: oldInput, output: oldInput, status: "failed", reason: "REFERENCE_SCENE_FIDELITY_FAILED: old print policy", at: "2026-10-20T16:41:04.848Z" };
    fs.writeFileSync(historyPath, JSON.stringify({ version: 1, entries: [historical] }));
    let policyReviews = 0;
    assert.equal((await runRecordedImageRecovery(hero.manifest.brandLinkId, "repair-rejected", async () => { throw new Error("old budget cannot dispatch"); })).attempted, false);
    const firstPolicy = await runRecordedImageRecovery(hero.manifest.brandLinkId, "review-completed-hero", async () => { policyReviews++; return true; }, { thumbnailAssetKey: fileHash(hero.primary) });
    assert.equal(firstPolicy.attempted, true);
    assert.equal((await runRecordedImageRecovery(hero.manifest.brandLinkId, "review-completed-hero", async () => { policyReviews++; }, { thumbnailAssetKey: fileHash(hero.primary) })).attempted, false);
    assert.equal(policyReviews, 1); assert.deepEqual(JSON.parse(fs.readFileSync(historyPath, "utf8")).entries[0], historical);
    assert.equal(IMAGE_RECOVERY_POLICY_VERSION, 10); hero.unchanged(); checks += 6;
    // A changed evidence-scope QA policy can review the exact same completed
    // pixels once. Legacy partial geometry metadata is retained verbatim and
    // grants neither a complete-shape assertion nor another image generation.
    const scopedHero = await fixture("hero", true), scopedPrepared = await scopedHero.prepare();
    const scopedBinding = await generation.completedHeroReviewBinding(scopedHero.manifest, "검정 제품");
    const scopedContext = scopedPrepared.target.referenceContext!;
    const evidenceScope = { version: PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_VERSION,
      rulesSha256: hash(JSON.stringify({ en: PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_EN, ko: PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_KO })),
      primary: { path: scopedContext.reference.path, sha256: scopedContext.reference.sha256, viewObservation: scopedContext.reference.viewObservation ?? null },
      supporting: scopedContext.supportingReferences!.map(reference => ({ purpose: reference.purpose, path: reference.path, sha256: reference.sha256,
        sourceSnapshotId: reference.sourceSnapshotId, sourceUrl: reference.sourceUrl, receiptPath: reference.receiptPath,
        receiptSha256: reference.receiptSha256, viewObservation: reference.viewObservation ?? null })) };
    const scopeBinding = (scope?: typeof evidenceScope) => hash(JSON.stringify({ version: "completed-hero-policy-review/v1",
      policy: PRODUCT_IMAGE_PRINT_OBSERVABILITY_RULE_VERSION, policySha256: hash(PRODUCT_IMAGE_PRINT_OBSERVABILITY_RULE_EN),
      ...(scope ? { referenceEvidenceScope: scope } : {}), snapshot: scopedHero.manifest.sourceSnapshot, currentHeroSha256: fileHash(scopedHero.primary),
      publicationContext: publicationImageContext(scopedHero.manifest.composition, null), copy: hash(JSON.stringify({ title: scopedHero.manifest.title,
        productName: "검정 제품", copy: buildProductThumbnailCopy(scopedHero.manifest.title, "검정 제품", "SHOPPING", scopedHero.manifest.productUnderstanding), style: "shopping-bold" })),
      metadataSha256: fileHash(scopedHero.metadataPath), prompt: scopedPrepared.job.prompt, references: scopedPrepared.job.requiredReferenceHashes,
      reviewOnly: scopedPrepared.job.reviewOnly, actualRequest: readCompletedProductRequest(scopedPrepared.job.outStem) }));
    assert.equal(scopedBinding, scopeBinding(evidenceScope)); assert.notEqual(scopedBinding, scopeBinding());
    assert.notEqual(scopedBinding, scopeBinding({ ...evidenceScope, rulesSha256: hash(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_EN) }));
    const wrongRoleScope = structuredClone(evidenceScope); wrongRoleScope.supporting[0].purpose = "intrinsic-label";
    assert.notEqual(scopedBinding, scopeBinding(wrongRoleScope));
    const wrongViewScope = structuredClone(evidenceScope); wrongViewScope.supporting[0].viewObservation!.hiddenParts = [];
    assert.notEqual(scopedBinding, scopeBinding(wrongViewScope)); checks += 5;
    const scopedRoot = path.dirname(path.dirname(scopedHero.work)), scopedManifestFile = path.join(scopedRoot, "manifest.json"), scopedHistoryFile = path.join(scopedRoot, "image-recovery-history.json");
    fs.writeFileSync(scopedManifestFile, JSON.stringify(scopedHero.manifest));
    const scopedBase = imageRecoverySignature(scopedRoot), previousPolicy = hash(JSON.stringify({ base: scopedBase, completedHeroReviewBinding: scopeBinding() }));
    const oldReview = { stage: "review-completed-hero", input: previousPolicy, output: previousPolicy, status: "complete", at: "2026-10-20T17:33:49.576Z",
      completedHeroReviewBinding: scopeBinding() };
    fs.writeFileSync(scopedHistoryFile, JSON.stringify({ version: 1, entries: [oldReview] }));
    let scopeReviews = 0;
    assert.equal((await runRecordedImageRecovery(scopedHero.manifest.brandLinkId, "review-completed-hero", async () => { scopeReviews++; },
      { thumbnailAssetKey: fileHash(scopedHero.primary) })).attempted, true);
    assert.equal((await runRecordedImageRecovery(scopedHero.manifest.brandLinkId, "review-completed-hero", async () => { scopeReviews++; },
      { thumbnailAssetKey: fileHash(scopedHero.primary) })).attempted, false);
    assert.equal(scopeReviews, 1); assert.deepEqual(JSON.parse(fs.readFileSync(scopedHistoryFile, "utf8")).entries[0], oldReview);
    assert.equal(imageRecoverySignature(scopedRoot), scopedBase); scopedHero.unchanged(); checks += 5;
    const jobCount = fs.readdirSync(hero.work).filter(name => name.endsWith(".reference-scene.json")).length;
    const unrelated = { ...heroPrepared.target, request: { ...heroPrepared.target.request, slotId: "hero:image:2" } };
    assert.throws(() => generation.prepareImageBatchJobs([unrelated], hero.manifest, "검정 제품", hero.work, { completedReviewOnly: true }), /IMAGE_RESUME_REQUIRED/);
    assert.equal(fs.readdirSync(hero.work).filter(name => name.endsWith(".reference-scene.json")).length, jobCount); checks += 2;
    await assert.rejects(generation.generateBrandPostImages({ manifest: hero.manifest, productName: "검정 제품", completedReviewOnly: true,
      requests: [{ requestId: "body-forbidden", sectionId: "scene" }] }), /IMAGE_RESUME_REQUIRED/); checks++;
    const pendingHero = await fixture("hero");
    const pendingReceipt = JSON.parse(fs.readFileSync(pendingHero.receiptPath, "utf8")); pendingReceipt.state = "submitting";
    fs.writeFileSync(pendingHero.receiptPath, JSON.stringify(pendingReceipt));
    pendingHero.records.pop(); pendingHero.writeRollout();
    await assert.rejects(generation.completedHeroReviewBinding(pendingHero.manifest, "검정 제품"), /IMAGE_RESUME_REQUIRED/); checks++;
    const changedHero = await fixture("hero"); fs.appendFileSync(changedHero.output, "modified candidate");
    await assert.rejects(generation.completedHeroReviewBinding(changedHero.manifest, "검정 제품"), /IMAGE_RESUME_REQUIRED/); checks++;
    for (const mutation of ["completed-budget", "host-prompt", "host-reference", "host-timestamp"] as const) {
      const f = await fixture("hero"), prepared = await f.prepare();
      if (mutation === "completed-budget") {
        const receipt = JSON.parse(fs.readFileSync(f.receiptPath, "utf8")); receipt.generationBudget.observedCalls = 2; receipt.generationBudget.exceededAtMs = Date.now();
        fs.writeFileSync(f.receiptPath, JSON.stringify(receipt));
      } else if (mutation === "host-prompt") {
        f.records[2].payload.content!.at(-1)!.text = buildCodexImageInstruction("different actual host prompt", 1, "product"); f.writeRollout();
      } else if (mutation === "host-reference") {
        f.records[2].payload.content!.find(item => item.type === "input_image")!.image_url = `data:image/png;base64,${png("foreign reference").toString("base64")}`;
        f.writeRollout();
      } else { f.records[2].timestamp = new Date(Date.now() + 60000).toISOString(); f.writeRollout(); }
      assert.throws(() => generation.prepareImageBatchJobs([prepared.target], f.manifest, "검정 제품", f.work, { completedReviewOnly: true }), /IMAGE_RESUME_REQUIRED/);
      await assert.rejects(generation.completedHeroReviewBinding(f.manifest, "검정 제품"), /IMAGE_RESUME_REQUIRED/);
      checks += 2;
    }
    // The review-only boundary covers its caller too: a fresh negative, an
    // unknown request/result or final-QA rejection cannot fall through to the
    // still-unused source/replan/paid-generation recovery budgets.
    for (const outcome of ["passed", "negative", "unknown", "transport", "provider", "ineligible", "spent", "final-negative", "final-transport"] as const) {
      const f = await fixture("hero"), packageDir = path.dirname(path.dirname(f.work));
      const file = path.join(packageDir, "manifest.json"), ledger = path.join(packageDir, "image-recovery-history.json");
      fs.writeFileSync(file, JSON.stringify(f.manifest));
      const signature = imageRecoverySignature(packageDir);
      const prior = { ...historical, input: signature, output: signature };
      fs.writeFileSync(ledger, JSON.stringify({ version: 1, entries: [prior] }));
      if (outcome === "ineligible") { f.records.pop(); f.writeRollout(); }
      if (outcome === "spent") await runRecordedImageRecovery(f.manifest.brandLinkId, "review-completed-hero", async () => {}, { thumbnailAssetKey: fileHash(f.primary) });
      const before = fs.readFileSync(file), metadataBefore = fs.readFileSync(f.metadataPath), receiptBefore = fs.readFileSync(f.receiptPath),
        rawBefore = fs.readFileSync(`${f.original.outStem}.png`), calls: string[] = [];
      let reviewed = false, approved = false;
      const response = (): Result => ({ success: true, data: { connectKind: "SHOPPING", approvedAt: approved ? "fixture-approved" : null,
        composition: { sections: [] }, imageAssets: f.manifest.imageAssets,
        imageGeneration: { status: "incomplete", recoveryState: "idle" }, imageSlots: [{ missing: 0, generationMissing: 0 }],
        contentQuality: { signals: [] }, approval: { canApprove: reviewed,
          blockers: reviewed ? [] : [{ code: "image-format-obsolete", sectionId: null, reason: "대표 이미지: prior retained hero" }] } } });
      const call: Call = async (_url, method, body) => {
        const action = (body as { action?: string } | undefined)?.action;
        if (method === "GET" || action === "recheck") return response();
        calls.push(String(action));
        if (action === "review_completed_hero") {
          assert.equal((body as { assetKey?: string }).assetKey, fileHash(f.primary));
          if (outcome === "transport") throw Object.assign(new Error("transport unknown"), { code: "ECONNRESET" });
          if (outcome === "provider") throw Object.assign(new Error("provider authorization missing"), { code: "CODEX_AUTH_REQUIRED" });
          if (outcome === "unknown") return { success: false, code: "IMAGE_RESUME_REQUIRED", errors: ["IMAGE_RESUME_REQUIRED: uncertain receipt"] };
          if (outcome === "negative") return { success: false, code: "REFERENCE_SCENE_FIDELITY_FAILED", errors: ["REFERENCE_SCENE_FIDELITY_FAILED: current exact pixels mismatch"] };
          reviewed = true; return response();
        }
        if (action === "approve") {
          if (outcome === "final-negative") throw Object.assign(new Error("final QA found actual wrong product"), {
            code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: ["SEMANTIC_REJECTION: actual product mismatch"] });
          if (outcome === "final-transport") throw Object.assign(new Error("final transport unknown"), { code: "ECONNRESET" });
          approved = true; return response();
        }
        throw new Error(`review-only workflow attempted forbidden ${method} ${action}`);
      };
      const workflow = runMaterialPreparation(f.manifest.brandLinkId, { call, pause: async () => {} }, { incrementalOnly: true, beforeRepair: async () => {} });
      if (outcome === "passed") await workflow;
      else await assert.rejects(workflow, (error: unknown) => !String(error).includes("forbidden"));
      assert.deepEqual(calls, ["ineligible", "spent"].includes(outcome) ? [] : ["passed", "final-negative", "final-transport"].includes(outcome)
        ? ["review_completed_hero", "approve"] : ["review_completed_hero"]);
      assert.equal(approved, outcome === "passed"); assert.deepEqual(fs.readFileSync(file), before);
      const entries = JSON.parse(fs.readFileSync(ledger, "utf8")).entries;
      assert.deepEqual(entries[0], prior); assert.ok(entries.every((entry: { stage: string }) => ["repair-rejected", "review-completed-hero"].includes(entry.stage)));
      if (outcome !== "ineligible") f.unchanged();
      else { assert.deepEqual(fs.readFileSync(f.metadataPath), metadataBefore); assert.deepEqual(fs.readFileSync(f.receiptPath), receiptBefore);
        assert.deepEqual(fs.readFileSync(`${f.original.outStem}.png`), rawBefore); }
      checks += 5;
    }
    for (const mutation of ["body", "snapshot", "slot", "recipe", "source-pixels", "source-url", "foreign-workspace", "no-terminal", "second-request", "attachment-pixels", "uncertain", "lock",
      "generation-budget", "request-after-terminal", "request-after-generation", "request-before-turn", "request-future-time", "extra-generation"] as const) {
      const f = await fixture(mutation === "source-url" ? "receipt" : "legacy");
      if (mutation === "body") f.manifest.composition.sections[1].body = ["다른 본문"];
      if (mutation === "snapshot") f.manifest.sourceSnapshot!.snapshotId = "a".repeat(64);
      if (["slot", "recipe"].includes(mutation)) { const meta = JSON.parse(fs.readFileSync(f.metadataPath, "utf8"));
        if (mutation === "slot") meta.slotId = "other:image:1"; else meta.sceneRecipeSha256 = "a".repeat(64); fs.writeFileSync(f.metadataPath, JSON.stringify(meta)); }
      if (mutation === "source-pixels") fs.appendFileSync(f.primary, "changed");
      if (mutation === "source-url") fs.writeFileSync(`${f.geometry}.retrieval.json`, f.receipt(f.geometry, "https://shop-phinf.pstatic.net/fixture/foreign.png", new Date().toISOString()));
      if (mutation === "foreign-workspace") f.records[0].payload.cwd = "foreign";
      if (mutation === "no-terminal") f.records.pop();
      if (mutation === "second-request") f.records.splice(3, 0, f.records[2]);
      if (mutation === "request-after-terminal") f.records.push(f.records.splice(2, 1)[0]);
      if (mutation === "request-after-generation") f.records.splice(3, 0, f.records.splice(2, 1)[0]);
      if (mutation === "request-before-turn") f.records.splice(1, 0, f.records.splice(2, 1)[0]);
      if (mutation === "request-future-time") f.records[2].timestamp = new Date(Date.now() + 60000).toISOString();
      if (mutation === "extra-generation") f.records.splice(4, 0, { timestamp: f.records[3].timestamp, type: "response_item",
        payload: { type: "custom_tool_call", name: "exec", call_id: "second-generation", input: "await tools.image_gen__imagegen({prompt: 'second'});" } });
      if (mutation === "attachment-pixels") {
        const c = f.records[2].payload.content!; c.find(item => item.type === "input_image")!.image_url = `data:image/png;base64,${png("foreign reference").toString("base64")}`;
      }
      if (["foreign-workspace", "no-terminal", "second-request", "attachment-pixels", "request-after-terminal", "request-after-generation", "request-before-turn", "request-future-time", "extra-generation"].includes(mutation)) f.writeRollout();
      if (mutation === "uncertain") { const receipt = JSON.parse(fs.readFileSync(f.receiptPath, "utf8")); receipt.state = "submitting"; fs.writeFileSync(f.receiptPath, JSON.stringify(receipt)); }
      if (mutation === "generation-budget") { const receipt = JSON.parse(fs.readFileSync(f.receiptPath, "utf8")); receipt.generationBudget.observedCalls = 2; receipt.generationBudget.exceededAtMs = Date.now(); fs.writeFileSync(f.receiptPath, JSON.stringify(receipt)); }
      if (mutation === "lock") fs.writeFileSync(`${f.original.outStem}.lock`, "active");
      await assert.rejects(f.prepare(), mutation); checks++;
    }
    for (const mutation of ["receipt", "metadata", "rollout", "candidate", "competing-request"] as const) {
      const f = await fixture(), r = await f.prepare();
      if (mutation === "receipt") fs.appendFileSync(`${f.primary}.retrieval.json`, " ");
      if (mutation === "metadata") fs.appendFileSync(f.metadataPath, " ");
      if (mutation === "rollout") fs.appendFileSync(f.rollout, "\n");
      if (mutation === "candidate") fs.appendFileSync(f.output, "changed");
      if (mutation === "competing-request") {
        const other = path.join(f.work, `raw-${"f".repeat(64)}`); fs.copyFileSync(f.metadataPath, `${other}.reference-scene.json`);
        fs.writeFileSync(`${other}.codex-submission.json`, JSON.stringify({ state: "submitting", workspace: `${other}.codex-1`, startedAtMs: Date.now(), threadId: null }));
        assert.throws(() => generation.prepareImageBatchJobs([r.target], f.manifest, "검정 제품", f.work), /IMAGE_RESUME_REQUIRED/); checks++; continue;
      }
      let resultError = "";
      await generation.runImageBatch([r.job], f.work, async result => { resultError = result.error || ""; }, undefined,
        { runCodex: async () => { transportCalls++; throw new Error("unexpected provider"); }, runBrowser: async () => { transportCalls++; throw new Error("unexpected browser"); } });
      assert.match(resultError, /IMAGE_RESUME_REQUIRED/); checks++;
    }
    for (const namespace of ["root", "resume-v1"] as const) {
      const f = await fixture(), otherDir = namespace === "root" ? path.dirname(f.work) : path.join(path.dirname(f.work), namespace);
      fs.mkdirSync(otherDir, { recursive: true });
      const other = path.join(otherDir, `raw-${"e".repeat(64)}`);
      fs.copyFileSync(f.metadataPath, `${other}.reference-scene.json`);
      fs.writeFileSync(`${other}.codex-submission.json`, JSON.stringify({ state: "submitting", workspace: `${other}.codex-1`, startedAtMs: Date.now(), threadId: null }));
      await assert.rejects(f.prepare(), /IMAGE_RESUME_REQUIRED/); checks++;
    }
    for (const race of ["rollout-read", "rollout-final-read", "receipt-final-read"] as const) {
      const f = await fixture(), oldRead = fs.readFileSync;
      const watched = race === "receipt-final-read" ? f.receiptPath : f.rollout;
      const changedAt = race === "rollout-read" ? 2 : 3;
      let reads = 0;
      fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
        const result = Reflect.apply(oldRead, fs, args) as string | Buffer;
        return String(args[0]) === watched && ++reads === changedAt
          ? typeof result === "string" ? result + " " : Buffer.concat([result, Buffer.from(" ")]) : result;
      }) as typeof fs.readFileSync;
      try { assert.equal(readCompletedProductRequest(f.original.outStem), null, race); }
      finally { fs.readFileSync = oldRead; }
      f.unchanged(); checks++;
    }
    assert.equal(readCompletedProductRequest(legacy.original.outStem)?.prompt, legacy.original.prompt); checks++;
    assert.equal(transportCalls, 0);
    console.log(`completed image context recovery: ${checks} checks passed; current visual QA ${reviews}; provider/generation/network calls 0`);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldData === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = oldData;
    if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
