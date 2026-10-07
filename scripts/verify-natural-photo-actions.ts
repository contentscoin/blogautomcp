/** Offline API regression: no account, database, browser, generation or publication is used. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

async function scenario(action: string, legacy = true, travel = false) {
  let migrations = 0;
  let generations = 0;
  let wholePlans = 0;
  let sourceOnly: boolean | undefined;
  const phases: string[] = [];
  let manifest = { version: "brand-post-package/v2", connectKind: travel ? "TRAVEL" : "SHOPPING", title: "상품",
    composition: { strategyVersion: legacy ? "shopping-post-strategy/v1" : "shopping-post-strategy/v2" } };
  const preview = { imageSlots: [{ sectionId: "scene", maximum: 1, count: 0, missing: 1, generationMissing: 1, assets: [], staleTargets: [] }],
    imageAssets: [{ assetKey: "a".repeat(64) }] };
  const loaded = { exports: {} };
  const dependencies: Record<string, unknown> = {
    "node:fs": fs, "node:path": path, "node:crypto": crypto,
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) => ({ body, status: options?.status || 200 }) } },
    "@/lib/db": { prisma: { brandLink: {
      findUnique: async () => ({ productName: "상품", imageUrls: "[]", status: "READY", updatedAt: new Date() }),
      updateMany: async () => ({ count: 1 }),
    } } },
    "@/lib/api-auth": { requireAdminApiKey: () => null },
    "@/lib/update-guard": { requireNoPendingDesktopUpdate: () => null },
    "@/lib/desktop-activity": { beginDesktopActivity: () => () => {} },
    "@/lib/brand-post-package": {
      readBrandPostPackage: () => manifest, packagePreview: () => preview,
      getBrandPostImageGenerationState: () => undefined, normalizePackageImageAssets: () => [],
      getBrandPostPackageDir: () => "C:/fixture",
    },
    "@/lib/brand-post-natural-photo-migration": {
      requiresShoppingNaturalPhotoPlan: (value: typeof manifest) => value.connectKind === "SHOPPING" && value.composition.strategyVersion !== "shopping-post-strategy/v2",
      migrateShoppingNaturalPhotoPlan: () => { migrations++; phases.push("migrate"); manifest = { ...manifest, composition: { strategyVersion: "shopping-post-strategy/v2" } }; return { manifest, changed: true }; },
    },
    "@/lib/brand-post-image-generation": { applyExternalGeneratedBrandPostImage: () => { throw new Error("targeted legacy apply must stop before generation"); } },
    "@/lib/brand-post-image-replan": { replanShoppingImageCoverage: () => { throw new Error("legacy replan must request explicit full preparation"); } },
    "@/lib/brand-post-image-repair": {
      isBrandPostImageRepairActive: () => false,
      planSectionImageRequests: () => [{ requestId: "scene", sectionId: "scene" }],
      planWholeBrandPostImageRequests: () => { wholePlans++; phases.push("plan"); return [{ requestId: "hero", replaceAssetKey: "a".repeat(64) }, { requestId: "scene", sectionId: "scene" }]; },
      repairBrandPostImages: async (options: { sourceOnly?: boolean }) => { generations++; sourceOnly = options.sourceOnly; phases.push("repair"); return { errors: [], generatedCount: 0, appliedCount: 0, manifest }; },
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/app/api/brandlinks/[id]/draft/images/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { module: loaded, exports: loaded.exports, console, process, Buffer, Date, Error,
    require: (name: string) => { assert(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; } });
  const api = loaded.exports as { POST: (request: unknown, context: unknown) => Promise<{ status: number; body: { code?: string } }> };
  const response = await api.POST({ json: async () => ({ action, sectionId: "scene", assetKey: "a".repeat(64), generatedPath: "C:/fixture/generated.png" }) }, { params: Promise.resolve({ id: "fixture-product" }) });
  if (legacy && !travel && !["generate_missing", "bind_sources"].includes(action)) {
    assert.equal(response.status, 409);
    assert.equal(response.body.code, "NATURAL_IMAGE_PLAN_REQUIRED");
    assert.equal(migrations, 0);
    assert.equal(generations, 0);
    assert.equal(wholePlans, 0);
  } else {
    assert.equal(response.status, 200);
    assert.equal(migrations, legacy && !travel ? 1 : 0);
    assert.equal(generations, 1);
    assert.equal(wholePlans, 1);
    assert.equal(sourceOnly, action === "bind_sources");
    assert.deepEqual(phases, migrations ? ["migrate", "plan", "repair"] : ["plan", "repair"]);
  }
}

async function main() {
  for (const action of ["generate_section", "regenerate", "apply_generated", "repair_rejected", "replan_sources"]) await scenario(action);
  for (const action of ["generate_missing", "bind_sources"]) {
    await scenario(action);
    await scenario(action, false);
    await scenario(action, true, true);
  }
  console.log("PASS natural photo image actions: explicit whole-plan migration, targeted 409 without generation, source-only binding, current plan and travel compatibility");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
