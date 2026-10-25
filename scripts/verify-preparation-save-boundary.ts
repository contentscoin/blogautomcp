import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual pre-save image-audit branch, without importing the CLI's
// main() or starting any browser/provider. Preparation must persist first;
// publication must still pass the exact saved-image audit and propagate failure.
const file = "scripts/simple-agent.ts";
const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const matches: ts.IfStatement[] = [];
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(source).includes("runtimeConnectKind") &&
      node.thenStatement.getText(source).includes('setStage("STEP2.6 최종 이미지 검증")')) matches.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(matches.length, 1, "one authoritative publication audit branch");
const compiled = ts.transpileModule(matches[0].getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
let checked = 0;
async function exercise(prepareOutputDir: string | undefined, failure: boolean, connectKind = "SHOPPING") {
  const calls: unknown[] = [];
  const snapshot = { snapshotId: "fixture-source" };
  const assets = [{ path: "saved-hero.png", role: "hero" }];
  const ctx = vm.createContext({
    runtimeConnectKind: connectKind, prepareOutputDir,
    preparedPostOverride: { sourceSnapshot: snapshot, imageAssets: assets },
    composition: { renderNodes: [] }, product: { name: "selected product", features: [] },
    post: { productUnderstanding: {} }, link: { id: "selected-product-id" },
    path: { join: (...parts: string[]) => parts.join("/") },
    getBrandPostPackageDir: () => "selected-package",
    buildSelectedProductImageAuditContext: () => "selected context",
    setStage: () => { checked++; },
    assertPublishImagesSafe: async (options: unknown) => {
      calls.push(options);
      if (failure) throw new Error("REAL_AUDIT_FAILURE");
    },
    PublishImageAuditError: class extends Error {},
  });
  const work = vm.runInContext(`(async () => { ${compiled} })()`, ctx) as Promise<void>;
  if (!prepareOutputDir && connectKind === "SHOPPING" && failure) await assert.rejects(work, /REAL_AUDIT_FAILURE/);
  else await work;
  const expected = !prepareOutputDir && connectKind === "SHOPPING" ? 1 : 0;
  assert.equal(calls.length, expected, "prepare saves before review; publication cannot skip review");
  if (expected) {
    const call = calls[0] as { imageAssets: unknown; sourceSnapshotId: string; selectedSourceSnapshot: unknown; selectedSourceDirectory: string };
    assert.equal(call.imageAssets, assets);
    assert.equal(call.sourceSnapshotId, snapshot.snapshotId);
    assert.equal(call.selectedSourceSnapshot, snapshot);
    assert.equal(call.selectedSourceDirectory, "selected-package/product-sources");
  }
}

async function main() {
  await exercise("first-unapproved-package", true);
  await exercise("submitted-mcp-package", true);
  await exercise(undefined, false);
  await exercise(undefined, true);
  await exercise("", true);
  await exercise(undefined, true, "TRAVEL");
  assert.equal(checked, 3);
  // Check actual return control flow, not a new flag called READY/approved.
  const text = source.getFullText();
  assert.match(text, /if \(prepareOutputDir \|\| DRY_RUN_GENERATE_ONLY\) \{/u);
  const route = fs.readFileSync("src/app/api/brandlinks/[id]/draft/route.ts", "utf8");
  const approval = route.slice(route.indexOf("async function approvePackageAfterCurrentValidation"), route.indexOf("/**", route.indexOf("async function approvePackageAfterCurrentValidation")));
  assert.match(approval, /await validateBrandPostPublishImages\(id/u);
  assert(approval.indexOf("validateBrandPostPublishImages") < approval.indexOf("return approveBrandPostPackage"));
  const classifier = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "classifyFailureCode");
  assert(classifier);
  const classifierJs = ts.transpileModule(classifier.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const classify = vm.runInNewContext(`${classifierJs}; classifyFailureCode`, {
    codexDraftTerminalFailureCode: () => null, getErrorMessage: (error: Error) => error.message,
  }) as (error: unknown) => string;
  assert.equal(classify(Object.assign(new Error("image review"), { code: "PUBLISH_IMAGE_AUDIT_FAILED" })), "PUBLISH_IMAGE_AUDIT_FAILED");
  assert.equal(classify(new Error("wrapped preparation", { cause: new Error("PUBLISH_IMAGE_AUDIT_FAILED: invalid review") })), "PUBLISH_IMAGE_AUDIT_FAILED");
  assert.equal(classify(new Error("unrelated failure")), "LOCAL_AUTOMATION_FAILED");
  console.log("PASS preparation save boundary: first/MCP drafts persist before final review, frozen publication input and real failures preserved, approval still requires final image audit (no provider/browser/data writes)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
