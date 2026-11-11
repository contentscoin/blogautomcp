import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { imageAuditFailureSections } from "../src/lib/publish-image-failure-diagnostics";
import { PublishImageAuditError, type PublishImageAuditFailure } from "./lib/publish-image-audit";
import type { ResolvedPostDocumentV1 } from "../src/lib/post-composition-contract";

async function main() {
  const composition = { renderNodes: [
    { kind: "paragraph", sectionId: "shopping-section-unrelated", text: "not an image" },
    { kind: "image", sectionId: "shopping-section-exact123", assetPath: "exact.png", role: "detail" },
    { kind: "image", sectionId: null, assetPath: "hero.png", role: "thumbnail" },
  ] } as Pick<ResolvedPostDocumentV1, "renderNodes">;
  const failure = (nodeIndex: number, assetPath: string): PublishImageAuditFailure => ({
    nodeIndex, assetPath, code: "SEMANTIC_REJECTION", reason: "forbidden body text", rejectionScope: "product",
  });
  const failures = [failure(1, "exact.png"), failure(2, "hero.png"), failure(1, "wrong.png"),
    failure(0, "exact.png"), failure(-1, "exact.png"), failure(99, "exact.png"), failure(1.5, "exact.png")];
  const input = JSON.stringify(failures);
  const result = imageAuditFailureSections(composition, failures);
  assert.equal(result[0].sectionId, "shopping-section-exact123");
  assert.equal(result[1].sectionId, null);
  for (const row of result.slice(2)) assert.equal(row.sectionId, undefined, "no section inference from an invalid node, wrong path or nearby paragraph");
  assert.equal(JSON.stringify(failures), input, "the audit input is not mutated");
  assert.deepEqual(imageAuditFailureSections(composition, [{ ...failure(99, "exact.png"), sectionId: "untrusted-section" } as PublishImageAuditFailure]),
    [failure(99, "exact.png")], "an old diagnostic cannot replace exact-node binding");
  for (const row of result) { assert.equal(row.photoDescription, undefined); assert.equal(Object.hasOwn(row, "findingKey"), false); }

  // Execute the actual approval wrapper with isolated readonly boundaries.
  const error = new PublishImageAuditError({ ok: false, checked: 1, failures: [failure(1, "exact.png")], images: [] });
  let releases = 0;
  const manifest = { version: "brand-post-package/v2", connectKind: "SHOPPING", title: "fixture", composition, sourceSnapshot: { product: { name: "fixture" } } };
  const fixture = { exports: {} as Record<string, unknown> };
  const dependencies: Record<string, unknown> = {
    "../../scripts/lib/publish-image-audit": { PublishImageAuditError, buildSelectedProductImageAuditContext: () => "fixture",
      assertPublishImagesSafe: async (options: { composition: unknown }) => { assert.equal(options.composition, composition); throw error; } },
    "./brand-post-image-repair-lock": { acquireBrandPostImageRepairLock: () => ({ assertOwner: () => {}, release: () => { releases++; } }) },
    "./brand-post-package": { getBrandPostPackageDir: () => "readonly-fixture", readBrandPostPackage: (_id: string, options: object) => { assert.equal(JSON.stringify(options), '{"migrate":false}'); return manifest; } },
    "node:path": path, "./material-library": { materialRevision: () => "fixture-revision" },
    "./post-composition-contract": { normalizePublishedPostText: () => composition },
    "./brand-post-approval-receipt": { brandPostApprovalBinding: () => "fixture-binding", brandPostCompatibleApprovalBindings: () => [] },
    "./publish-image-failure-diagnostics": { imageAuditFailureSections },
  };
  const filename = path.resolve("src/lib/brand-post-publish-preflight.ts");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new vm.Script(compiled, { filename }).runInNewContext({ module: fixture, exports: fixture.exports,
    require: (name: string) => { assert.ok(name in dependencies, `unknown boundary ${name}`); return dependencies[name]; } });
  await assert.rejects((fixture.exports.validateBrandPostPublishImages as (id: string) => Promise<unknown>)("fixture-product"), (value: unknown) => {
    assert.equal(value, error, "same error instance/class reaches the existing API serialization");
    assert.ok(value instanceof PublishImageAuditError);
    assert.equal((value.audit.failures[0] as { sectionId?: string }).sectionId, "shopping-section-exact123");
    assert.equal(value.audit.failures[0].photoDescription, undefined);
    return true;
  });
  assert.equal(releases, 1);
  console.log("PASS: exact audited-node diagnostic sections, invalid/path/thumbnail guards, no edit authority, same error instance and readonly approval wrapper");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
