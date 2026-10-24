import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";
import { attachRemoteProductReferenceInputs } from "../src/lib/brand-post-remote-image-inputs";

async function main() {
  const hash = "a".repeat(64);
  let uploadCalls = 0;
  const slots = [{ sectionId: "hero", imagePrompt: "stale preliminary prompt" }, { sectionId: "daily" }, { sectionId: "facts" }];
  const result = await attachRemoteProductReferenceInputs(slots, {
    prepare: async slot => slot.sectionId === "facts" ? null : { referenceImagePaths: ["C:/private/source.jpg"], referenceHashes: [hash], prompt: "Use the supplied product reference." },
    upload: async () => { uploadCalls++; return "https://assets.example/source.jpg"; },
  });
  assert.equal(uploadCalls, 1, "Shared identity uploads must be reused within the draft response.");
  assert.equal(result[0].referenceReady, true);
  assert.equal(result[1].referenceReady, true);
  assert.equal(result[0].imagePrompt, "Use the supplied product reference.", "MCP must replace preliminary prose with the exact prepared generation harness.");
  assert.equal(result[1].imagePrompt, result[0].imagePrompt);
  assert.equal(result[2].imagePrompt, null, "Fact slots must not be converted into generated product evidence.");
  assert(!JSON.stringify(result).includes("C:/private"), "Local reference paths must not enter the remote payload.");
  assert.deepEqual(result[0].referenceImages, [{ role: "product-identity", url: "https://assets.example/source.jpg", sha256: hash }]);
  const failed = await attachRemoteProductReferenceInputs([slots[0]], {
    prepare: async () => ({ referenceImagePaths: ["private.jpg"], referenceHashes: [hash], prompt: "Use reference." }), upload: async () => null,
  });
  assert.equal(failed[0].referenceReady, false);
  assert.equal(failed[0].imagePrompt, null, "Upload failures must not leave a generation prompt with missing references.");
  const malformed = await attachRemoteProductReferenceInputs([slots[0]], {
    prepare: async () => ({ referenceImagePaths: ["private.jpg"], referenceHashes: [], prompt: "Use reference." }), upload: async () => "https://assets.example/x",
  });
  assert.equal(malformed[0].referenceReady, false);
  const dual = await attachRemoteProductReferenceInputs([slots[0]], {
    prepare: async () => ({ referenceImagePaths: ["source.jpg", "accepted.png"], referenceHashes: [hash, "b".repeat(64)], prompt: "Preserve identity, use accepted scene." }),
    upload: async file => `https://assets.example/${file}`,
  });
  assert.equal((dual[0].referenceImages as Array<{role:string}>)[1].role, "approved-scene-continuity");
  const bundleHashes = [hash, "b".repeat(64), "c".repeat(64)];
  const bundle = { referenceImagePaths: ["source.jpg", "geometry.jpg", "label.png"], referenceHashes: bundleHashes,
    supportingReferences: [{ path: "geometry.jpg", sha256: bundleHashes[1], purpose: "geometry" as const },
      { path: "label.png", sha256: bundleHashes[2], purpose: "intrinsic-label" as const }], prompt: "Use exact geometry and identifying print." };
  const bundled = await attachRemoteProductReferenceInputs([slots[0]], { prepare: async () => bundle,
    upload: async file => `https://assets.example/${file}` });
  assert.equal(bundled[0].referenceReady, true);
  assert.deepEqual((bundled[0].referenceImages as Array<{role:string}>).map(image => image.role),
    ["product-identity", "product-geometry", "product-intrinsic-label"]);
  assert.deepEqual(bundled[0].referenceHashes, bundleHashes, "reference order is forwarded without sorting or truncation");
  for (const invalid of [{ ...bundle, referenceImagePaths: [...bundle.referenceImagePaths, "extra.jpg"], referenceHashes: [...bundleHashes, "d".repeat(64)] },
    { ...bundle, referenceHashes: [...bundleHashes].reverse() }, { ...bundle, referenceHashes: [hash, "0".repeat(64), bundleHashes[2]] },
    { ...bundle, supportingReferences: undefined }]) {
    let invalidUploads = 0;
    const rejected = await attachRemoteProductReferenceInputs([slots[0]], { prepare: async () => invalid,
      upload: async () => { invalidUploads++; return "https://assets.example/source.jpg"; } });
    assert.equal(rejected[0].referenceReady, false); assert.equal(rejected[0].imagePrompt, null); assert.equal(invalidUploads, 0);
  }
  const native: Array<{ role: string; base64: string }> = [];
  let readCalls = 0;
  const pixelDeps = {
    prepare: async () => ({ referenceImagePaths: ["source.jpg", "accepted.png"], referenceHashes: [hash, "b".repeat(64)], prompt: "Use actual pixels." }),
    upload: async (file: string) => `https://assets.example/${file}`,
    readImage: async (file: string) => { readCalls++; return { base64: Buffer.from(file).toString("base64"), mimeType: "image/png" as const }; },
    onReference: (input: {role: string; base64: string}) => { native.push(input); },
  };
  const pixelSlots = await attachRemoteProductReferenceInputs(slots.slice(0, 2), pixelDeps);
  assert.equal(readCalls, 2, "The same exact references are read once across sibling slots.");
  assert.equal(native[0].role, "product-identity");
  assert.equal(native[1].role, "approved-scene-continuity");
  assert.equal(native[0].base64, Buffer.from("source.jpg").toString("base64"));
  assert.equal(pixelSlots[0].referenceReady, true);
  native.length = 0;
  const brokenPixels = await attachRemoteProductReferenceInputs([slots[0]], { ...pixelDeps,
    readImage: async () => { throw new Error("changed bytes"); } });
  assert.equal(brokenPixels[0].referenceReady, false);
  assert.equal(native.length, 0, "Partial native attachments must not be exposed as a complete reference set.");
  const large = await attachRemoteProductReferenceInputs([slots[0]], { ...pixelDeps,
    readImage: async () => ({ base64: "A".repeat(3 * 1024 * 1024), mimeType: "image/png" as const }) });
  assert.equal(large[0].referenceReady, false, "References must fit the shared completion envelope.");

  // Execute the actual PC ingress guard without an API call. The image apply
  // helper still owns exact prepared-hash/order comparison after this guard.
  const pollSource = ts.createSourceFile("poll.ts", fs.readFileSync("src/app/api/remote-agent/poll/route.ts", "utf8"), ts.ScriptTarget.Latest, true);
  let guard: ts.IfStatement | undefined;
  const visit = (node: ts.Node) => { if (ts.isIfStatement(node) && node.expression.getText(pollSource).includes('referenceHashes.length < 1')) guard = node; ts.forEachChild(node, visit); };
  visit(pollSource); assert.ok(guard);
  const runtime: { check?: (kind: string, hashes: unknown) => boolean; [key: string]: unknown } = {
    LocalAutomationError: class extends Error { constructor(code: string, message: string) { super(`${code}: ${message}`); } },
  };
  vm.runInNewContext(ts.transpileModule(`this.check = (kind, referenceHashes) => { ${guard.getText(pollSource)}; return true; };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, runtime);
  assert.equal(runtime.check!("SHOPPING", bundleHashes), true);
  assert.equal(runtime.check!("TRAVEL", undefined), true);
  for (const hashes of [[], ["bad"], [...bundleHashes, "d".repeat(64)]]) assert.throws(() => runtime.check!("SHOPPING", hashes), /INVALID_INPUT/u);

  const draftView = pollSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "draftView"); assert.ok(draftView);
  const references = ["product-identity", "product-geometry", "product-intrinsic-label", "approved-scene-continuity"].map((role, index) =>
    ({ role, sha256: String.fromCharCode(97 + index).repeat(64), base64: "AQID", mimeType: "image/png", url: `https://assets.example/${index}.png` }));
  const viewRuntime: { view?: (...args: unknown[]) => Promise<Record<string, unknown>>; [key: string]: unknown } = {
    fs: { existsSync: () => false }, stripPaths: (value: unknown) => value,
    numberField: (record: Record<string, unknown>, key: string) => Number(record[key] || 0),
    safeImageSlots: async (_preview: unknown, _manifest: unknown, onReference: (reference: typeof references[number]) => void) => {
      references.forEach(onReference); return [{ referenceReady: true, referenceHashes: references.slice(0, 3).map(reference => reference.sha256), imagePrompt: "valid bundle" },
        { referenceReady: true, referenceHashes: [references[0].sha256, references[3].sha256], imagePrompt: "incomplete legacy bundle" }];
    },
  };
  vm.runInNewContext(ts.transpileModule(`this.view = ${draftView.getText(pollSource)};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, viewRuntime);
  const view = await viewRuntime.view!("fixture", {}, false);
  assert.equal((view.nativeReferenceImages as unknown[]).length, 3);
  const viewSlots = view.imageSlots as Array<{ referenceReady: boolean; imagePrompt: string | null }>;
  assert.equal(viewSlots[0].referenceReady, true); assert.equal(viewSlots[1].referenceReady, false); assert.equal(viewSlots[1].imagePrompt, null);
  viewRuntime.safeImageSlots = async (_preview: unknown, _manifest: unknown, onReference: (reference: typeof references[number]) => void) => {
    references.slice(0, 2).forEach(onReference);
    onReference({ ...references[2], role: "product-identity" });
    return [{ sectionId: "first", maximum: 1, referenceReady: true, referenceHashes: [references[0].sha256, references[1].sha256], imagePrompt: "first bundle" },
      { sectionId: "original", maximum: 1, referenceReady: false, referenceHashes: [], imagePrompt: null },
      { sectionId: "second", maximum: 1, referenceReady: true, referenceHashes: [references[2].sha256], imagePrompt: "second bundle" }];
  };
  const viewManifest = { version: "brand-post-package/v2", connectKind: "SHOPPING", composition: { sections: [
    { id: "first", imageSource: "staged-ai" }, { id: "second", imageSource: "staged-ai" }, { id: "original", imageSource: "seller-original" }] } };
  const differentPrimary = await viewRuntime.view!("fixture", { connectKind: "SHOPPING" }, false, viewManifest);
  assert.deepEqual(JSON.parse(JSON.stringify((differentPrimary.nativeReferenceImages as Array<{role: string}>).map(image => image.role))), ["product-identity", "product-geometry"]);
  const differentSlots = differentPrimary.imageSlots as Array<{referenceReady:boolean; referenceNextCall?:unknown}>;
  assert.equal(differentSlots[1].referenceNextCall, undefined, "a seller-original slot must never advise a generated-reference request");
  const pending = differentSlots[2];
  assert.equal(pending.referenceReady, false);
  assert.equal(JSON.stringify(pending.referenceNextCall), JSON.stringify({ tool: "post_get_draft", arguments: { connectKind: "shopping", draftId: "fixture", referenceSectionId: "second" } }));
  viewRuntime.safeImageSlots = async (_preview: unknown, _manifest: unknown, onReference: (reference: typeof references[number]) => void) => {
    references.slice(0, 3).forEach(onReference);
    return [{ sectionId: "first", maximum: 1, referenceReady: true, referenceHashes: references.slice(0, 3).map(reference => reference.sha256) },
      { sectionId: "second", maximum: 1, referenceReady: true, referenceHashes: [references[0].sha256, references[2].sha256, references[1].sha256] }];
  };
  const reordered = await viewRuntime.view!("fixture", {}, false, viewManifest);
  const reorderedSlots = reordered.imageSlots as Array<{referenceReady:boolean; referenceNextCall?:unknown}>;
  assert.equal(reorderedSlots[0].referenceReady, true); assert.equal(reorderedSlots[1].referenceReady, false,
    "containing the same hashes is insufficient when geometry and label attachments arrive in a different order");
  assert.ok(reorderedSlots[1].referenceNextCall);
  viewRuntime.safeImageSlots = async (_preview: unknown, _manifest: unknown, onReference: (reference: typeof references[number]) => void) => {
    onReference(references[0]); onReference({ ...references[0], role: "product-geometry" });
    return [{ referenceReady: true, referenceHashes: [references[0].sha256], imagePrompt: "conflicting role" }];
  };
  const conflict = await viewRuntime.view!("fixture", {}, false);
  assert.equal(conflict.nativeReferenceImages, undefined, "one hash cannot silently change from product identity to supporting geometry");
  assert.equal((conflict.imageSlots as Array<{referenceReady:boolean}>)[0].referenceReady, false);
  viewRuntime.safeImageSlots = async () => null;
  const noSlots = await viewRuntime.view!("fixture", {}, false);
  assert.equal(noSlots.imageSlots, null, "a package without image-slot metadata retains its existing null response");
  assert.equal(noSlots.nativeReferenceImages, undefined);

  const safeSlots = pollSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "safeImageSlots"); assert.ok(safeSlots);
  const buffers = new Map(bundle.referenceImagePaths.map((file, index) => [file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(String(index))])]));
  const hashes = bundle.referenceImagePaths.map(file => createHash("sha256").update(buffers.get(file)!).digest("hex"));
  const exactBundle = { ...bundle, referenceHashes: hashes,
    supportingReferences: bundle.supportingReferences.map((support, index) => ({ ...support, sha256: hashes[index + 1] })) };
  const preparedSections: string[] = [], attached: unknown[] = [];
  const slotRuntime: { safe?: (...args: unknown[]) => Promise<Array<Record<string, unknown>> | null>; [key: string]: unknown } = {
    Buffer, createHash, fs: { promises: { readFile: async (file: string) => buffers.get(file) } },
    numberField: (record: Record<string, unknown>, key: string) => Number(record[key] || 0),
    waitForScheduledSourceImageRepair: async () => ({ ready: true, waited: false }), isBrandPostImageRepairActive: () => false,
    buildBrandPostImagePrompt: () => "preliminary",
    resolveBrandPostImageTarget: (_manifest: unknown, input: {sectionId: string}) => ({ sectionId: input.sectionId, imageSource: input.sectionId === "original" ? "seller-original" : "staged-ai" }),
    allowsShoppingReferenceScene: (target: {imageSource: string}) => target.imageSource === "staged-ai",
    prepareBrandPostImageReferenceContext: async (input: {target: {sectionId: string}}) => { preparedSections.push(input.target.sectionId); return exactBundle; },
    attachRemoteProductReferenceInputs, uploadRemoteImageAsset: async (file: string) => `https://assets.example/${file}`,
    LocalAutomationError: class extends Error { constructor(code: string, message: string) { super(`${code}: ${message}`); } },
  };
  vm.runInNewContext(ts.transpileModule(`this.safe = ${safeSlots.getText(pollSource)};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, slotRuntime);
  const slotPreview = { connectKind: "SHOPPING", imageSlots: ["original", "first", "second"].map(sectionId => ({ sectionId, title: sectionId, maximum: 1 })) };
  const slotManifest = { version: "brand-post-package/v2", brandLinkId: "fixture", connectKind: "SHOPPING", title: "상품",
    composition: { sections: [] } };
  const selected = await slotRuntime.safe!(slotPreview, slotManifest, (image: unknown) => attached.push(image), undefined, undefined, "second");
  assert.deepEqual(preparedSections, ["second"], "a selected-slot read prepares no sibling bundle or SDK call");
  assert.equal(attached.length, 3); assert.equal(selected![2].referenceReady, true);
  assert.equal(selected![1].referenceReady, false);
  for (const sectionId of ["unknown", "original"]) await assert.rejects(() => slotRuntime.safe!(slotPreview, slotManifest, undefined, undefined, undefined, sectionId), /INVALID_INPUT/u);
  await assert.rejects(() => slotRuntime.safe!({}, slotManifest, undefined, undefined, undefined, "second"), /INVALID_INPUT/u);
  assert.deepEqual(preparedSections, ["second"], "invalid or non-generation sections never fall back to preparing every slot");
  console.log("Remote product references: source forwarding, shared upload, path privacy and fail-closed cases passed.");
}
main().catch(error => { console.error(error); process.exitCode=1; });
