/** Offline subset admission/integration: no real account, provider or publication. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { planConfirmedPrintRepairs } from "../src/lib/brand-post-confirmed-print-repair";
import { publicationDefectMaterialBinding, type ScopedPublicationImageDefectProof } from "./lib/publication-image-defect-proof";
import { repairBrandPostImages } from "../src/lib/brand-post-image-repair";
import { runMaterialPreparation, type Result } from "./lib/scheduled-draft-workflow";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";

const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
const policy = "a".repeat(64);
let checks = 0;
const equal = (actual: unknown, expected: unknown, why: string) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), why); checks++; };
const root = fs.mkdtempSync(path.join(os.tmpdir(), "confirmed-print-subset-"));
const oldRoot = process.env.DESKTOP_USER_DATA;
process.env.DESKTOP_USER_DATA = root;

async function main() {
  const files = ["confirmed", "unknown", "normal"].map(name => path.join(root, `${name}.png`));
  for (const [index, file] of files.entries()) fs.writeFileSync(file, `immutable offline pixels ${index}`);
  const assets = files.map((file, index) => ({ path: file, sourcePath: file, sha256: hash(file), role: "body", sectionId: `section-${index}`,
    slotId: `section-${index}:image:1`, provenance: "GENERATED_SCENE", creationMethod: "reference-guided-scene", remoteGenerated: true }));
  const baseline = { version: "brand-post-package/v2", brandLinkId: "subset-fixture", title: "Saved manuscript", createdAt: "2026-10-21T00:00:00Z",
    connectKind: "SHOPPING", hashtags: [], heroImagePath: "", bodyImagePaths: files, imageAssets: assets,
    composition: { sections: assets.map(asset => ({ id: asset.sectionId, title: asset.sectionId, body: ["Exact saved manuscript."], imagePaths: [asset.path] })), renderNodes: [] },
  } as unknown as BrandPostPackageManifestV2;
  const proofPath = path.join(root, "native-proof.json");
  fs.writeFileSync(proofPath, "offline reader boundary fixture; never native generation authority");
  const proofFor = (manifest = baseline) => ({ version: "publication-image-print-defect/v4", policyFingerprint: policy,
    binding: { material: publicationDefectMaterialBinding(manifest), sha256: assets[0].sha256, sectionId: assets[0].sectionId, slotId: assets[0].slotId },
    identifierReview: { status: "conflict", nativeExecution: true, identifierConflict: {} },
  } as unknown as ScopedPublicationImageDefectProof);
  let suppliedProof = proofFor();
  const reader = (_manifest: BrandPostPackageManifestV2, sectionId: string) => sectionId === assets[0].sectionId
    ? { proof: suppliedProof, path: proofPath, sha256: hash(proofPath) } : null;
  const deps = { policy: () => policy, readDefect: reader as typeof import("./lib/publication-image-defect-proof").readPublicationImageDefect };
  const initial = JSON.stringify(baseline), originalHashes = files.map(hash);
  const plan = planConfirmedPrintRepairs(baseline, deps);
  equal(plan.requests.map(row => [row.sectionId, row.slotId, row.replaceAssetKey]), [[assets[0].sectionId, assets[0].slotId, assets[0].sha256]], "Only exact reader-confirmed current slot is routed");
  equal(plan.proofs.map(row => row.proofSha256), [hash(proofPath)], "Native proof digest is retained without copying authority from prose");
  equal(JSON.stringify(baseline), initial, "Planning never edits the manuscript or any full asset row");
  equal(files.map(hash), originalHashes, "All current pixels remain unchanged");
  equal(planConfirmedPrintRepairs(baseline, { ...deps, readDefect: () => null }).requests, [], "Unknown/invalid-only material has no generation targets");
  equal(planConfirmedPrintRepairs(baseline).requests, [], "Real production reader rejects this unsigned offline fixture");
  for (const mutate of [
    (p: ScopedPublicationImageDefectProof) => { p.policyFingerprint = "b".repeat(64); },
    (p: ScopedPublicationImageDefectProof) => { p.binding.material = "b".repeat(64); },
    (p: ScopedPublicationImageDefectProof) => { p.binding.sha256 = assets[1].sha256; },
    (p: ScopedPublicationImageDefectProof) => { p.binding.slotId = assets[1].slotId; },
    (p: ScopedPublicationImageDefectProof) => { p.identifierReview.nativeExecution = false; },
    (p: ScopedPublicationImageDefectProof) => { p.identifierReview.status = "unverified"; },
    (p: ScopedPublicationImageDefectProof) => { p.identifierReview.missingPrintEvidence = {} as never; },
  ]) {
    suppliedProof = proofFor(); mutate(suppliedProof);
    assert.throws(() => planConfirmedPrintRepairs(baseline, deps), /현재 서명된/u); checks++;
  }
  suppliedProof = proofFor();
  const duplicate = clone(baseline); duplicate.imageAssets!.push(clone(duplicate.imageAssets![0]));
  suppliedProof = proofFor(duplicate);
  assert.throws(() => planConfirmedPrintRepairs(duplicate, deps), /현재 서명된/u); checks++;
  suppliedProof = proofFor();
  const priorBytes = fs.readFileSync(files[0]);
  assert.throws(() => planConfirmedPrintRepairs(baseline, { ...deps, readDefect: ((m, s) => {
    const result = reader(m, s); if (result) fs.writeFileSync(files[0], "changed during reader"); return result;
  }) as typeof deps.readDefect }), /현재 서명된/u); checks++;
  fs.writeFileSync(files[0], priorBytes);
  const originalRead = fs.readFileSync;
  let racedRead = false;
  try {
    Object.defineProperty(fs, "readFileSync", { value: (...args: Parameters<typeof fs.readFileSync>) => {
      const bytes = originalRead(...args);
      if (!racedRead && String(args[0]) === files[0]) { racedRead = true; fs.appendFileSync(files[0], " racing write after captured bytes"); }
      return bytes;
    }, configurable: true, writable: true });
    assert.throws(() => planConfirmedPrintRepairs(baseline, deps), /현재 서명된/u); checks++;
    equal(racedRead, true, "Race actually occurs between the image read and second identity stat");
  } finally { Object.defineProperty(fs, "readFileSync", { value: originalRead, configurable: true, writable: true }); fs.writeFileSync(files[0], priorBytes); }
  let policyCalls = 0;
  assert.throws(() => planConfirmedPrintRepairs(baseline, { ...deps, policy: () => ++policyCalls === 1 ? policy : "c".repeat(64) }), /현재 서명된/u); checks++;

  // Execute the actual authenticated route, replacing only external store/
  // provider boundaries. The route never accepts supplied authority or targets.
  async function route(body: object, admitted = true, changeAfterPlan = false) {
    let generated = 0, planned = 0, writes = 0;
    const loaded = { exports: {} as { POST: (r: unknown, c: unknown) => Promise<{ status: number; body: Result }> } };
    const mapping: Record<string, unknown> = {
      "node:fs": fs, "node:path": path, "node:crypto": crypto,
      "next/server": { NextResponse: { json: (value: unknown, opts?: { status?: number }) => ({ body: value, status: opts?.status || 200 }) } },
      "@/lib/db": { prisma: { brandLink: { findUnique: async () => ({ productName: "Saved manuscript", imageUrls: "[]", status: "READY" }), updateMany: async () => ({ count: 1 }) } } },
      "@/lib/api-auth": { requireAdminApiKey: () => null }, "@/lib/update-guard": { requireNoPendingDesktopUpdate: () => null },
      "@/lib/desktop-activity": { beginDesktopActivity: () => () => {} },
      "@/lib/brand-post-package": { readBrandPostPackage: () => baseline, packagePreview: () => ({ imageAssets: assets, imageSlots: [] }), getBrandPostImageGenerationState: () => null },
      "@/lib/brand-post-image-generation": {}, "@/lib/brand-post-image-replan": {}, "@/lib/brand-post-rejected-original-repair": {}, "@/lib/brand-post-retained-scene": {},
      "@/lib/brand-post-natural-photo-migration": { requiresShoppingNaturalPhotoPlan: () => false },
      "@/lib/brand-post-confirmed-print-repair": { planConfirmedPrintRepairs: (manifest: BrandPostPackageManifestV2) => {
        planned++; return planConfirmedPrintRepairs(manifest, admitted ? deps : { ...deps, readDefect: () => null });
      } },
      "@/lib/brand-post-image-repair": { isBrandPostImageRepairActive: () => false, repairBrandPostImages: async (options: { requests: typeof plan.requests; expectedMaterialBinding: string }) => {
        equal(options.requests.map(row => row.replaceAssetKey), [assets[0].sha256], "Route passes only the admitted subset, never generic missing slots");
        equal(options.expectedMaterialBinding, plan.materialBinding, "Route carries exact material CAS to the locked worker");
        if (changeAfterPlan) throw Object.assign(new Error("CAS changed"), { code: "IMAGE_RESUME_REQUIRED" });
        generated++; writes++; return { errors: [], generatedCount: 1, appliedCount: 1, manifest: baseline };
      } },
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/app/api/brandlinks/[id]/draft/images/route.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, { exports: loaded.exports, require: (name: string) => { assert(name in mapping, name); return mapping[name]; }, Buffer, process });
    const response = await loaded.exports.POST({ json: async () => body }, { params: Promise.resolve({ id: baseline.brandLinkId }) });
    return { ...response, generated, planned, writes };
  }
  const partial = await route({ action: "repair_confirmed_print" });
  assert.equal(partial.body.success, true, JSON.stringify(partial.body));
  equal([partial.status, partial.generated, partial.body.partialImageRepair?.ready], [200, 1, false], "Subset application is explicitly not approval/READY");
  const none = await route({ action: "repair_confirmed_print" }, false);
  equal([none.generated, none.writes, none.body.appliedCount, none.body.partialImageRepair?.status], [0, 0, 0, "no-eligible-defect"], "No current native proof means zero generation/write calls");
  for (const key of ["proof", "proofSha256", "sectionId", "assetKey", "requests", "expectedMaterialBinding", "refreshSourcePhotos"]) {
    const invalid = await route({ action: "repair_confirmed_print", [key]: "untrusted" });
    equal([invalid.status, invalid.planned, invalid.generated], [400, 0, 0], `Client ${key} cannot choose or supply authority`);
  }
  const raced = await route({ action: "repair_confirmed_print" }, true, true);
  equal([raced.body.success, raced.generated, raced.writes], [false, 0, 0], "Failed lock admission never dispatches");

  let workerWrites = 0, workerGenerations = 0;
  await assert.rejects(repairBrandPostImages({ brandLinkId: baseline.brandLinkId, requests: plan.requests, expectedMaterialBinding: "d".repeat(64) }, {
    read: () => clone(baseline), write: value => { workerWrites++; return value; }, apply: () => { throw new Error("must not apply"); },
    generate: async () => { workerGenerations++; return []; },
  }), error => (error as { code?: string }).code === "IMAGE_RESUME_REQUIRED"); checks++;
  equal([workerWrites, workerGenerations], [0, 0], "Actual lock/CAS worker rejects changed material before writing or generating");

  const originalFailure = Object.assign(new Error("original native typed failure"), { code: "PUBLISH_IMAGE_AUDIT_FAILED",
    errors: ["SEMANTIC_REJECTION: confirmed print", "INVALID_REVIEW: unresolved sibling"], imageAuditFailures: [
      { code: "SEMANTIC_REJECTION", sectionId: assets[0].sectionId, assetPath: files[0], rejectionScope: "section" },
      { code: "INVALID_REVIEW", sectionId: assets[1].sectionId, assetPath: files[1], rejectionScope: "section" },
    ] });
  async function workflow(kind: "partial" | "none" | "invalid-only" | "uncertain" | "auth" | "quota" | "invalid-proof", diagnose = false) {
    const actions: string[] = [], stages: string[] = [];
    const repairCode = ({ uncertain: "ECONNRESET", auth: "CODEX_AUTH_REQUIRED", quota: "CODEX_USAGE_LIMIT_REACHED", "invalid-proof": "IMAGE_RESUME_REQUIRED" } as Record<string, string>)[kind];
    const error = kind === "invalid-only" ? Object.assign(new Error("opaque only"), { code: originalFailure.code, errors: ["INVALID_REVIEW: opaque"], imageAuditFailures: [originalFailure.imageAuditFailures[1]] }) : originalFailure;
    await assert.rejects(runMaterialPreparation("workflow-subset", { pause: async () => {}, onStage: text => stages.push(text), call: async (_url, method, body) => {
      const action = (body as { action?: string } | undefined)?.action || method; actions.push(action);
      if (action === "approve" || action === "audit_photo_descriptions") throw error;
      if (action === "repair_confirmed_print") {
        if (repairCode) throw Object.assign(new Error(`partial endpoint ${repairCode}`), { code: repairCode });
        const count = kind === "none" ? 0 : 1;
        return { success: true, appliedCount: count, generatedCount: count, partialImageRepair: { status: count ? "repaired-awaiting-review" : "no-eligible-defect", ready: false, appliedCount: count, generatedCount: count } };
      }
      return { success: true, data: { connectKind: "SHOPPING", status: "READY", approvedAt: null, imageGeneration: { status: "complete" }, imageSlots: [], contentQuality: { signals: [] },
        ...(diagnose ? { approval: { canApprove: false, blockers: [{ code: "image-publication-rejected", sectionId: assets[0].sectionId, reason: "current prior rejection" }] } } : {}) } };
    } }), caught => {
      equal((caught as { code?: string }).code, repairCode || "PUBLISH_IMAGE_AUDIT_FAILED", "Whole material remains blocked; transport/runtime errors keep their codes");
      if (kind === "partial") equal((caught as { partialImageRepair?: { ready: boolean } }).partialImageRepair?.ready, false, "Partial recovery never claims material READY");
      if (repairCode) {
        const details = caught as { originalImageAuditFailure?: { code: string; message: string }; partialImageRepairFailure?: { code: string }; imageAuditFailures?: unknown };
        equal(details.originalImageAuditFailure, { code: originalFailure.code, message: originalFailure.message, errors: originalFailure.errors, imageAuditFailures: originalFailure.imageAuditFailures }, "Endpoint errors retain the exact original native audit report");
        equal(details.partialImageRepairFailure?.code, repairCode, "Partial error code remains independently visible");
        equal(details.imageAuditFailures, originalFailure.imageAuditFailures, "Unknown sibling and confirmed node findings remain intact");
      }
      return true;
    }); checks++;
    equal(actions.filter(action => action === "repair_confirmed_print").length, kind === "invalid-only" ? 0 : 1, "Mixed workflow invokes narrow repair at most once; opaque-only has zero mutation calls");
    equal(actions.filter(action => action === "approve").length, diagnose ? 0 : 1, "No second approval follows a partial or unresolved result");
    equal(actions.filter(action => ["generate_missing", "repair_rejected", "regenerate", "replan_sources", "revise", "prepare_context", "repair_photo_description"].includes(action)), [], "No generic/source/text/replan fallback follows mixed partial admission");
    if (kind === "partial") assert(stages.some(stage => /1장 부분 복구/u.test(stage))); checks++;
  }
  for (const kind of ["partial", "none", "invalid-only", "uncertain", "auth", "quota", "invalid-proof"] as const) await workflow(kind);
  await workflow("partial", true);
  equal(JSON.stringify(baseline), initial, "All workflow scenarios preserve saved manuscript and original asset metadata");
  equal(files.map(hash), originalHashes, "All existing normal/unknown/defect source files remain intact");
  console.log(`PASS: ${checks} confirmed-print partial-repair checks; provider/publication/live writes 0`);
}
main().finally(() => { if (oldRoot === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = oldRoot;
  fs.rmSync(root, { recursive: true, force: true }); }).catch(error => { console.error(error); process.exitCode = 1; });
