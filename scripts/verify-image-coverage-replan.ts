import assert from "node:assert/strict";
import { replanShoppingImageCoverage, type ImageReplanDependencies } from "../src/lib/brand-post-image-replan";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";

async function scenario(mode: "success" | "insufficient" | "revision" | "generated" | "overview" | "existing" | "auth" | "external" | "recoverable", repairError?: string) {
  let stored = { version: "brand-post-package/v2", brandLinkId: "fixture", connectKind: "SHOPPING",
    imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", approvedAt: "old-approval", title: "45분 청소기", createdAt: "original",
    sourceSnapshot: { snapshotId: "fixed-source", facts: ["사용시간 45분"] }, hashtags: ["청소기"],
    imageRequirements: { policy: mode === "generated" ? "generated-required" : "verified-source-first" },
    composition: { sections: [
      { id: "runtime", title: "사용시간", body: ["45분 사용시간은 판매자가 확인한 정보다."], imageIntent: "45분 사용시간 기능 근거", imageMin: 1, imageMax: 1, imagePaths: [] },
      { id: "filter", title: "필터 구조", body: ["필터 구조를 확인한다."], imageIntent: "필터 구조 원본", imageMin: 0, imageMax: 1, imagePaths: [] },
      { id: "keep", title: "기존 근거", body: ["원문 유지"], imageIntent: "기존 기능 근거", imageMin: 3, imageMax: 3, imagePaths: ["a", "b", "c"] },
    ], renderNodes: [{ kind: "paragraph", text: "원문 유지" }] }, imageAssets: [{ path: "a", sha256: "original" }],
  } as unknown as BrandPostPackageManifestV2;
  stored.imageGeneration = { status: "incomplete", requested: 1, applied: 0, remaining: 1, errors: ["old optional failure"], updatedAt: "old" };
  if (mode === "existing") stored.composition.sections[1].imagePaths = ["verified-filter-photo"];
  const original = structuredClone(stored);
  let repairCalls = 0;
  let writes = 0;
  let released = false;
  const deps = {
    read: () => structuredClone(stored),
    write: (value: BrandPostPackageManifestV2) => { stored = value; writes++; return value; },
    reconcile: (value: BrandPostPackageManifestV2) => value,
    lock: () => ({ assertOwner() {}, release() { released = true; } }),
    slots: (value: BrandPostPackageManifestV2) => value.composition.sections.map(section => ({
      sectionId: section.id, minimum: section.imageMin!, maximum: section.imageMax!, count: section.imagePaths.length,
      missing: Math.max(0, section.imageMin! - section.imagePaths.length), generatedMinimum: 0, generationMissing: 0,
      staleTargets: [], assets: section.imagePaths.map(file => ({ path: file, creationMethod: "source",
        sourceReview: { usage: "section-matched-product-evidence", reviewClass: mode === "overview" ? "product-photo" : "feature-evidence" } })),
    })),
    repair: async (options: { sourceOnly: boolean; requests: Array<{ sectionId: string }> }) => {
      repairCalls++; assert.equal(options.sourceOnly, true); assert.deepEqual(options.requests.map(r => r.sectionId), ["filter"]);
      if (mode === "revision") stored.composition.sections[0].body = ["동시 수정"];
      if (mode !== "insufficient") stored.composition.sections[1].imagePaths = ["verified-filter-photo"];
      return { errors: mode === "auth" ? ["AUTH_REQUIRED: 로그인 필요"] : repairError ? [repairError] : [] };
    },
  } as unknown as ImageReplanDependencies;
  if (mode === "auth" || mode === "external") {
    await assert.rejects(replanShoppingImageCoverage({ brandLinkId: "fixture" }, deps), (error: Error) =>
      error.message.startsWith("IMAGE_REPLAN_EXTERNAL_BLOCKED:") && error.message.includes(repairError || "AUTH_REQUIRED"));
    assert.equal(writes, 0);
    assert.equal(stored.composition.sections[0].imageMin, 1);
    assert.equal(stored.composition.sections[1].imageMin, 0);
    assert.deepEqual(stored.composition.sections[1].imagePaths, ["verified-filter-photo"]);
    return;
  }
  const result = await replanShoppingImageCoverage({ brandLinkId: "fixture" }, deps);
  if (mode === "success" || mode === "existing" || mode === "recoverable") {
    assert.equal(result.changed, true); assert.equal(result.after.required, result.before.required);
    assert.equal(result.after.missing, 0); assert.equal(stored.approvedAt, null);
    assert.deepEqual(stored.sourceSnapshot, original.sourceSnapshot);
    assert.deepEqual(stored.imageAssets, original.imageAssets);
    assert.deepEqual(stored.composition.renderNodes, original.composition.renderNodes);
    assert.deepEqual(stored.composition.sections.map(({ id, title, body, imageIntent }) => ({ id, title, body, imageIntent })),
      original.composition.sections.map(({ id, title, body, imageIntent }) => ({ id, title, body, imageIntent })));
    assert.equal(stored.composition.sections[0].imagePaths.length, 0);
    assert.equal(stored.composition.sections[0].imageMin, 0);
    assert.equal(stored.composition.sections[1].imageMin, 1);
    assert.deepEqual(stored.imageGeneration?.errors, []);
    assert(stored.pipelineNotes?.some(note => note.includes("old optional failure")));
    assert.equal(writes, 1);
  } else { assert.equal(result.changed, false); assert.equal(writes, 0); assert.equal(stored.composition.sections[0].imageMin, 1); }
  assert.equal(repairCalls, mode === "generated" || mode === "existing" ? 0 : 1);
  assert.equal(released, mode !== "generated");
}
async function main() {
  for (const mode of ["success", "insufficient", "revision", "generated", "overview", "existing", "auth"] as const) await scenario(mode);
  for (const error of ["CODEX_MODEL_INCOMPATIBLE: unavailable model", "CHATGPT_BROWSER_UNREACHABLE: closed",
    "IMAGE_RESUME_REQUIRED: interrupted", "request timed out", "unknown transport failure",
    "IMAGE_SOURCE_BINDING_REQUIRED: cause CODEX_MODEL_INCOMPATIBLE"]) await scenario("external", error);
  for (const code of ["IMAGE_SOURCE_BINDING_REQUIRED", "PRODUCT_SOURCE_REQUIRED", "PRODUCT_SOURCE_DOWNLOAD_FAILED",
    "PRODUCT_CUTOUT_REQUIRED", "IMAGE_GENERATION_REQUIRED"]) await scenario("recoverable", `optional-section: ${code}: unavailable source`);
  console.log("PASS image coverage replan: reviewed and existing alternatives, insufficient evidence, concurrent revision, generation policy, generic-photo rejection, historical errors, authentication stop");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
