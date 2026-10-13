/** Offline API regression: no account, database, browser, generation or publication is used. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { runMaterialPreparation, type Call, type Result } from "./lib/scheduled-draft-workflow";

async function scenario(action: string, legacy = true, travel = false, repairResult?: { errors: string[]; appliedCount: number }) {
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
      repairBrandPostImages: async (options: { sourceOnly?: boolean }) => { generations++; sourceOnly = options.sourceOnly; phases.push("repair"); return { errors: [], generatedCount: 0, appliedCount: 0, ...repairResult, manifest }; },
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/app/api/brandlinks/[id]/draft/images/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { module: loaded, exports: loaded.exports, console, process, Buffer, Date, Error,
    require: (name: string) => { assert(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; } });
  const api = loaded.exports as { POST: (request: unknown, context: unknown) => Promise<{ status: number;
    body: Result & { appliedCount?: number; generatedCount?: number } }> };
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
  return response;
}

async function main() {
  for (const action of ["generate_section", "regenerate", "apply_generated", "repair_rejected", "replan_sources"]) await scenario(action);
  for (const action of ["generate_missing", "bind_sources"]) {
    await scenario(action);
    await scenario(action, false);
    await scenario(action, true, true);
  }
  const previousRoot = process.env.DESKTOP_USER_DATA;
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "source-route-workflow-"));
  process.env.DESKTOP_USER_DATA = fixtureRoot;
  try {
    for (const outcome of ["recovered", "auth", "incomplete", "unknown-output", "unknown-code"] as const) {
      const errors = ["scene: IMAGE_GENERATION_REQUIRED: Staged AI slot still needs its own generated photograph.",
        ...(outcome === "auth" ? ["CODEX_AUTH_REQUIRED: Login is required."]
          : outcome === "incomplete" ? ["SOURCE_REVIEW_INCOMPLETE: Final source verdict is missing."]
            : outcome === "unknown-output" ? ["OUTCOME_UNKNOWN: Prior image outcome is unresolved."]
              : outcome === "unknown-code" ? ["UNRECOGNIZED_IMAGE_FAILURE: Unsupported image failure."] : [])];
      // Actual route serialization/classification, with an offline repair result:
      // one original placed, AI slots intentionally untouched by bind_sources.
      const response = await scenario("bind_sources", false, false, { errors, appliedCount: 1 });
      assert.equal(response.body.code, outcome === "auth" ? "CODEX_AUTH_REQUIRED" : outcome === "incomplete"
        ? "SOURCE_REVIEW_INCOMPLETE" : "IMAGE_GENERATION_REQUIRED");
      assert.equal(response.body.appliedCount, 1); assert.equal(response.body.generatedCount, 0);
      const actions: string[] = [];
      let rejected = outcome !== "recovered", originalBound = false, repaired = false, approved = false;
      let approvalCalls = 0;
      const call: Call = async (url, method, body) => {
        const action = (body as { action?: string } | undefined)?.action || method;
        actions.push(action);
        if (url.endsWith("/images")) {
          if (action === "bind_sources") { originalBound = true; return response.body; }
          assert.equal(action, "repair_rejected"); repaired = true;
          return { success: true, errors: [], appliedCount: 2, remainingMissing: 0 };
        }
        if (action === "approve") {
          approvalCalls++;
          if (approvalCalls === 1) { rejected = true; throw Object.assign(new Error("final pixel rejection"), {
            code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: ["SEMANTIC_REJECTION: selected option needs a matching original and replacement scene"],
          }); }
          approved = true;
        }
        return { success: true, data: { connectKind: "SHOPPING", approvedAt: approved ? "approved" : null,
          approval: { canApprove: approved, blockers: [] }, imageGeneration: { status: "complete" },
          composition: { sections: [{ id: "original", imageSource: "seller-original" }, { id: "scene", imageSource: "staged-ai" }] },
          imageSlots: [{ sectionId: "original", missing: rejected && !originalBound ? 1 : 0, generationMissing: 0 },
            { sectionId: "scene", missing: rejected && !repaired ? 2 : 0, generationMissing: rejected && !repaired ? 2 : 0 }],
          contentQuality: { signals: [] } } };
      };
      const operation = runMaterialPreparation(`route-source-${outcome}`, { call, pause: async () => {} });
      if (outcome === "recovered") await operation;
      else await assert.rejects(operation, (error: unknown) => (error as { code?: string }).code === (
        outcome === "auth" ? "CODEX_AUTH_REQUIRED" : outcome === "incomplete" ? "SOURCE_REVIEW_INCOMPLETE"
          : outcome === "unknown-output" ? "OUTCOME_UNKNOWN" : "UNRECOGNIZED_IMAGE_FAILURE"));
      assert.equal(actions.filter(action => action === "bind_sources").length, 1);
      assert.equal(actions.filter(action => action === "repair_rejected").length, outcome === "recovered" ? 1 : 0,
        "only the known remaining AI requirement authorizes the bounded next repair");
      assert.equal(approvalCalls, outcome === "recovered" ? 2 : 0);
      assert.equal(approved, outcome === "recovered");
      assert(!actions.some(action => ["prepare_context", "generate_missing", "regenerate", "replan_sources", "revise"].includes(action)),
        "source-only continuation never grants a generic retry, source refresh or whole manuscript rewrite");
    }
  } finally {
    if (previousRoot === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previousRoot;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  console.log("PASS natural photo image actions: explicit whole-plan migration, targeted 409 without generation, source-only binding, current plan and travel compatibility");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
