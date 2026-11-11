import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { brandPostImageProgress } from "../src/lib/brand-post-image-progress";

async function main() {
const source = fs.readFileSync("src/app/api/brandlinks/[id]/draft/route.ts", "utf8");
const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "GET");
assert(declaration);
const js = ts.transpileModule(declaration.getText(ast), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const state = { status: "running" as const, requested: 4, applied: 2, remaining: 2,
  errors: [], updatedAt: "2026-10-15T00:00:00.000Z", ownerPid: 1234, ownerToken: "private-owner-marker" };
assert.equal("ownerToken" in brandPostImageProgress(state)!, false);
assert.equal("ownerPid" in brandPostImageProgress(state)!, false);
assert.equal(brandPostImageProgress(undefined), null);
let reads = 0, previews = 0, denied = false;
const harnessExports: Record<string, unknown> = {};
vm.runInNewContext(js, {
  exports: harnessExports,
  requireAdminApiKey: () => denied ? { status: 401 } : null,
  readBrandPostPackage: (_id: string, options: { migrate?: boolean }) => { assert.equal(options.migrate, false); reads++; return { imageGeneration: state }; },
  getBrandPostImageGenerationState: () => ({ ...state, status: "incomplete", recoveryState: "owner-exited" }),
  brandPostImageProgress,
  packagePreview: () => { previews++; return { strictPreview: true }; },
  NextResponse: { json: (body: unknown, options?: { status?: number }) => ({ status: options?.status ?? 200, body }) },
});
const get = harnessExports.GET as (request: unknown, context: unknown) => Promise<{ status: number; body: { data: Record<string, unknown> } }>;
const context = { params: Promise.resolve({ id: "test-product" }) };
const progress = await get({ nextUrl: new URL("http://localhost/draft?progressOnly=1") }, context);
assert.equal(progress.status, 200);
assert.equal(previews, 0, "progress polling must not invoke preview, image reads or readiness evaluation");
assert.equal(progress.body.data.progressOnly, true);
assert.equal((progress.body.data.imageGeneration as { status: string }).status, "incomplete");
assert(!JSON.stringify(progress).includes("private-owner-marker"));
assert.equal("ready" in progress.body.data, false);
await get({ nextUrl: new URL("http://localhost/draft") }, context);
assert.equal(previews, 1, "ordinary draft reads retain their existing full preview contract");
denied = true;
const before = reads;
assert.equal((await get({ nextUrl: new URL("http://localhost/draft?progressOnly=1") }, context)).status, 401);
assert.equal(reads, before, "authentication must run before any package read");
console.log("PASS: lightweight progress, owner interruption, strict preview and authorization boundaries");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
