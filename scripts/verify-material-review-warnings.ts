import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readCurrentMaterialReviewWarnings } from "../src/lib/material-review-warnings";
import { brandPostApprovalBinding, brandPostAllApprovalBindings, brandPostCompatibleApprovalBindings, hasCurrentBrandPostApprovalReceipt } from "../src/lib/brand-post-approval-receipt";
import { publicationImageAuditPolicyFingerprint } from "./lib/publish-image-audit";
import { COMPATIBLE_STRICT_PUBLICATION_POLICIES } from "./lib/lightweight-publication-review";
import { readProductPhotoSource } from "./lib/product-photo-provenance";
import { materialRevision } from "../src/lib/material-library";
import { nextRemoteAgentPollDelay } from "../src/components/RemoteAgentPoller";
import { packagePreview, type BrandPostPackageManifest } from "../src/lib/brand-post-package";
import { MaterialReviewWarnings } from "../src/components/MaterialReviewWarnings";
import { PUBLICATION_IMAGE_AUDIT_POLICY_FILES } from "./lib/publish-image-audit";
import { writeSuccessfulImageAuditReceipt } from "./lib/publish-image-audit-receipt";

/** Frozen copy of the pre-optimisation binding: signed receipts depend on these exact bytes. */
function legacyBinding(manifest: BrandPostPackageManifest, sourceDirectory: string, policy = publicationImageAuditPolicyFingerprint()): string {
  const { approvedAt: _a, imageGeneration: _p, textQualityRevalidation, ...content } = manifest; void _a; void _p;
  const { checkedAt: _t, ...textBinding } = textQualityRevalidation || {}; void _t;
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify({ version: "saved-material-publication-audit/v1", policy, content, ...(textQualityRevalidation ? { textQualityRevalidation: textBinding } : {}) }));
  const files = new Set([manifest.markdownPath, manifest.heroImagePath, ...manifest.bodyImagePaths,
    ...(manifest.imageAssets || []).flatMap(asset => [asset.path, asset.sourcePath, asset.referenceScene?.referencePath, asset.referenceScene?.thumbnailRawPath].filter((file): file is string => Boolean(file))),
    ...(manifest.version === "brand-post-package/v2" ? manifest.composition.sections.flatMap(section => section.imagePaths) : [])]);
  for (const asset of manifest.imageAssets || []) { files.add(`${asset.path}.source.json`); const original = readProductPhotoSource(asset.path); if (original) files.add(original.sourcePath); }
  try { for (const name of fs.readdirSync(sourceDirectory).filter(name => name.endsWith(".retrieval.json")).sort()) { files.add(path.join(sourceDirectory, name)); files.add(path.join(sourceDirectory, name.slice(0, -".retrieval.json".length))); } }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const file of [...files].filter(Boolean).sort()) {
    hash.update(JSON.stringify({ file: path.resolve(file) }));
    try { hash.update(fs.readFileSync(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; hash.update("missing-file"); }
  }
  return hash.digest("hex");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-print-warning-"));
const priorUser = process.env.DESKTOP_USER_DATA, priorProject = process.env.DESKTOP_PROJECT_ROOT;
let checks = 0;
try {
  process.env.DESKTOP_USER_DATA = root;
  for (const file of PUBLICATION_IMAGE_AUDIT_POLICY_FILES) {
    const to = path.join(root, "project", file);fs.mkdirSync(path.dirname(to), { recursive: true });fs.copyFileSync(path.resolve(file), to);
  }
  process.env.DESKTOP_PROJECT_ROOT = path.join(root, "project");
  const image = path.join(root, "photo.png"), markdown = path.join(root, "draft.md"), sources = path.join(root, "sources");
  fs.mkdirSync(sources);fs.writeFileSync(image, "unaltered-pixel-fixture");fs.writeFileSync(markdown, "원고 원형 보존");
  const sha = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
  const manifest = { version: "brand-post-package/v2", brandLinkId: "warning_fixture", connectKind: "SHOPPING", approvedAt: "2026-10-21T00:00:00Z", title: "보존 원고",
    markdownPath: markdown, markdownSha256: sha(fs.readFileSync(markdown)), heroImagePath: image, bodyImagePaths: [image], hashtags: [],
    imageAssets: [{ path: image, sourcePath: image, sha256: sha(fs.readFileSync(image)), role: "body", slotId: "slot" }],
    composition: { renderNodes: [{ kind: "image", sectionId: "section", assetPath: image }], sections: [{ id: "section", title: "보존 문단", body: ["같은 원고"], imagePaths: [image] }] },
  } as unknown as Extract<BrandPostPackageManifest, { version: "brand-post-package/v2" }>;
  const signed = [{ nodeIndex: 0, sha256: manifest.imageAssets![0].sha256, evidenceSha256: "d".repeat(64), kind: "suspected-omission-uncorroborated" as const }];
  const sign = () => writeSuccessfulImageAuditReceipt(manifest.brandLinkId, "a".repeat(64), brandPostApprovalBinding(manifest, sources), signed);
  const receipt = path.join(root, "data/publication-image-audit-receipts", sha(manifest.brandLinkId) + ".json");
  sign();const originalReceipt = fs.readFileSync(receipt), warnings = readCurrentMaterialReviewWarnings(manifest, sources);
  assert.equal(warnings.length, 1);assert.match(warnings[0].reason, /누락 의심·미확정/);assert.equal(hasCurrentBrandPostApprovalReceipt(manifest, sources), true);checks += 3;
  assert.deepEqual(Object.keys(warnings[0]).sort(), ["assetSha256", "kind", "nodeIndex", "reason"]);checks++;
  const html = renderToStaticMarkup(createElement(MaterialReviewWarnings, { warnings }));
  assert.match(html, /인쇄 누락 의심·미확정/);assert.match(html, /1장/);assert.match(html, /사진 1/);assert(!html.includes(root));assert(!html.includes("검수 통과"));checks += 5;
  assert.equal(renderToStaticMarkup(createElement(MaterialReviewWarnings, {})), "");checks++;
  for (const change of [(row: Record<string, unknown>) => { delete row.printWarnings; }, (row: Record<string, unknown>) => { (row.printWarnings as typeof signed)[0].kind = "intrinsic-print-unverified" as never; },
    (row: Record<string, unknown>) => { row.readinessBindingKey = "e".repeat(64); }]) {
    const row = JSON.parse(originalReceipt.toString());change(row);fs.writeFileSync(receipt, JSON.stringify(row));
    assert.deepEqual(readCurrentMaterialReviewWarnings(manifest, sources), []);assert.equal(hasCurrentBrandPostApprovalReceipt(manifest, sources), false);checks += 2;
  }
  fs.writeFileSync(receipt, originalReceipt);
  const beforeImage = fs.readFileSync(image);fs.writeFileSync(image, "altered");assert.deepEqual(readCurrentMaterialReviewWarnings(manifest, sources), []);assert.equal(hasCurrentBrandPostApprovalReceipt(manifest, sources), false);checks += 2;fs.writeFileSync(image, beforeImage);
  const beforeTitle = manifest.title;manifest.title = "다른 원고";assert.deepEqual(readCurrentMaterialReviewWarnings(manifest, sources), []);assert.equal(hasCurrentBrandPostApprovalReceipt(manifest, sources), false);checks += 2;manifest.title = beforeTitle;
  const policy = path.join(root, "project", PUBLICATION_IMAGE_AUDIT_POLICY_FILES[0]);fs.appendFileSync(policy, "\n// unrelated release logging comment\n");assert.deepEqual(readCurrentMaterialReviewWarnings(manifest, sources), warnings);assert.equal(hasCurrentBrandPostApprovalReceipt(manifest, sources), true);checks += 2;fs.copyFileSync(path.resolve(PUBLICATION_IMAGE_AUDIT_POLICY_FILES[0]), policy);
  const node = (manifest as Extract<BrandPostPackageManifest, {version:"brand-post-package/v2"}>).composition.renderNodes[0];
  if (node.kind === "image") { const previous = node.assetPath;node.assetPath = path.join(root, "different.png");assert.deepEqual(readCurrentMaterialReviewWarnings(manifest, sources), []);checks++;node.assetPath = previous; }
  assert.equal(typeof packagePreview, "function", "Cold import must not introduce a package/approval/warning initialization cycle");checks++;
  // Exercise the exact common preview body (UI and MCP), with unrelated quality
  // gates held independently. Warning authentication remains the real reader.
  const file = path.resolve("src/lib/brand-post-package.ts"), source = fs.readFileSync(file, "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "packagePreview")!;
  const compiled = ts.transpileModule(fn.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { packagePreview?: (value: BrandPostPackageManifest) => { reviewWarnings: typeof warnings; readiness: { summary: string } } } = {};
  vm.runInNewContext(compiled, { exports, fs, path, normalizePackageImageAssets: () => manifest.imageAssets,
    evaluateBrandPostPackageReadiness: () => ({ imageSlots: [], canApprove: true, blockers: [], composition: manifest.composition, contentScore: 100 }),
    readCurrentMaterialReviewWarnings, getBrandPostPackageDir: () => root, isValidPackageImage: () => true });
  // The preview uses <package>/product-sources; sign that exact server binding.
  fs.mkdirSync(path.join(root, "product-sources"));writeSuccessfulImageAuditReceipt(manifest.brandLinkId, "a".repeat(64), brandPostApprovalBinding(manifest, path.join(root, "product-sources")), signed);
  const preview = exports.packagePreview!(manifest);assert.equal(preview.reviewWarnings.length, 1);assert.match(preview.readiness.summary, /미검증/);checks += 2;
  for (const target of ["src/app/page.tsx", "src/components/MaterialLibrary.tsx"]) assert.match(fs.readFileSync(target, "utf8"), /<MaterialReviewWarnings warnings=\{(?:draftPreview|item)\.reviewWarnings\}/);
  checks += 2;
  // #20: one-pass multi-policy binding must stay byte-identical to the legacy per-policy hash.
  fs.writeFileSync(path.join(sources, "cmp.png.retrieval.json"), "{}");fs.writeFileSync(path.join(sources, "cmp.png"), "retrieval-pixels");
  const legacyAll = [legacyBinding(manifest, sources), ...COMPATIBLE_STRICT_PUBLICATION_POLICIES.map(policy => legacyBinding(manifest, sources, policy))];
  assert.equal(brandPostApprovalBinding(manifest, sources), legacyAll[0]);
  assert.deepEqual(brandPostCompatibleApprovalBindings(manifest, sources), legacyAll.slice(1));
  assert.deepEqual(brandPostAllApprovalBindings(manifest, sources), legacyAll);
  assert.equal(brandPostApprovalBinding(manifest, sources, "custom-policy"), legacyBinding(manifest, sources, "custom-policy"));
  assert.equal(brandPostApprovalBinding(manifest, path.join(root, "missing-dir")), legacyBinding(manifest, path.join(root, "missing-dir")));
  fs.rmSync(path.join(sources, "cmp.png.retrieval.json"));fs.rmSync(path.join(sources, "cmp.png"));checks += 5;
  // #22: cached revision still changes when an image is overwritten in place.
  const revisionBefore = materialRevision(manifest);assert.equal(materialRevision(manifest), revisionBefore);
  const savedPixels = fs.readFileSync(image);fs.writeFileSync(image, "changed-pixel-fixture!");
  assert.notEqual(materialRevision(manifest), revisionBefore);fs.writeFileSync(image, savedPixels);checks += 2;
  // #23: idle back-off 3→6→12→15s, busy 10s, job/recovery resets; never paused.
  let idle = 0; const delays: number[] = [];
  for (let i = 0; i < 5; i++) { const next = nextRemoteAgentPollDelay(idle, { success: true, data: { configured: true, job: null, busy: null } }); idle = next.idleDelayMs; delays.push(next.delayMs); }
  assert.deepEqual(delays, [3000, 6000, 12000, 15000, 15000]);
  assert.equal(nextRemoteAgentPollDelay(idle, { success: true, data: { job: null, busy: { id: "x" } } }).delayMs, 10000);
  assert.deepEqual(nextRemoteAgentPollDelay(idle, { success: true, data: { job: { id: "j" } } }), { delayMs: 3000, idleDelayMs: 0 });
  assert.equal(nextRemoteAgentPollDelay(idle, { success: true, data: { job: null, completionRecovered: true } }).delayMs, 3000);
  assert.equal(nextRemoteAgentPollDelay(idle, null).delayMs, 3000);checks += 5;
  console.log(`PASS: ${checks} authenticated material warning/preview/UI checks; provider/live mutations 0`);
} finally {
  if (priorUser === undefined) delete process.env.DESKTOP_USER_DATA;else process.env.DESKTOP_USER_DATA = priorUser;
  if (priorProject === undefined) delete process.env.DESKTOP_PROJECT_ROOT;else process.env.DESKTOP_PROJECT_ROOT = priorProject;
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("material-print-warning-"));
  fs.rmSync(root, { recursive: true, force: true });
}
