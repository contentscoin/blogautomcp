import assert from "node:assert/strict";
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
  console.log("Remote product references: source forwarding, shared upload, path privacy and fail-closed cases passed.");
}
main().catch(error => { console.error(error); process.exitCode=1; });
