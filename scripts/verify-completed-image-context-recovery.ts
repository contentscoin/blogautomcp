/** Terminal historical inputs recover pixels, never another generation. Synthetic data only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { buildProduct9Canvas, selectedProductContextFrom9Canvas } from "./lib/product-9canvas";
import { buildShoppingReferenceScenePrompt, SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION,
  type ShoppingSceneReference, type ShoppingSceneSupportingReference } from "./lib/shopping-reference-scene";
import { REFERENCE_SCENE_REVIEW_CHECKS } from "../src/lib/brand-post-image-evidence";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import type { ResolvedImageTarget } from "../src/lib/brand-post-image-generation";
import { buildCodexImageInstruction, readCompletedProductRequest } from "../src/lib/codex-image-generation";
import { testPngFixture } from "./lib/test-png-fixture";

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
    async function fixture(mode: "legacy" | "receipt" = "legacy") {
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
      const sections = ["original", "scene", "text"].map((sectionId, index) => ({ id: sectionId, title: `제목 ${index}`, body: [`원문 ${index}`],
        imagePaths: [], imageMin: index === 1 ? 1 : 0, imageMax: index === 1 ? 1 : 0, imageSource: index === 1 ? "staged-ai" : "none",
        imageIntent: "AI 연출 이미지", promptRecipe: "확인된 전체 제품을 보존" }));
      const manifest = { version: "brand-post-package/v2", brandLinkId: id, connectKind: "SHOPPING", title: "검정 제품", createdAt: new Date().toISOString(),
        sourceSnapshot: snapshot, productUnderstanding: buildProduct9Canvas({ name: "검정 제품", features: ["색상: 검정"] }),
        imageAssets: [], heroImagePath: "", bodyImagePaths: [], approvedAt: null,
        composition: { sections, renderNodes: [{ kind: "heading", sectionId: "scene", text: sections[1].title },
          { kind: "paragraph", sectionId: "scene", text: sections[1].body[0] }] } } as unknown as BrandPostPackageManifestV2;
      const target = (): ResolvedImageTarget => generation.resolveBrandPostImageTarget(manifest,
        { requestId: "fixture", sectionId: "scene", slotId: "scene:image:1" });
      const deps = { collect: async () => [primary], select: async () => reference, selectSupporting: async () => mode === "receipt" ? [support] : [] };
      const originalTarget = target();
      const context = await generation.prepareBrandPostImageReferenceContext({ manifest, productName: "검정 제품", target: originalTarget }, deps);
      const oldOptions = { productName: "검정 제품", sectionTitle: sections[1].title, imageIntent: sections[1].imageIntent, bodyExcerpt: sections[1].body[0],
        stagingRecipe: sections[1].promptRecipe, role: "body" as const, variantIndex: 2, adjacentSectionTitles: [sections[0].title, sections[2].title],
        physicalScale: manifest.productUnderstanding!.concept.physicalScale, productImageDirective: manifest.productUnderstanding!.policy.imageDirective };
      context.prompt = buildShoppingReferenceScenePrompt({ ...oldOptions, reference, hasAnchor: false, supportingReferences: mode === "receipt" ? [support] : [] });
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
