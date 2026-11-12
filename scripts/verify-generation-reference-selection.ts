/** Offline purpose separation: reference artwork never authorizes publication. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { testPngFixture } from "./lib/test-png-fixture";
import { selectVerifiedProductPhotos } from "./lib/product-photo-review";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generation-reference-selection-"));
  try {
    const paths = Array.from({ length: 14 }, (_, index) => {
      const file = path.join(root, `${index}.png`);
      fs.writeFileSync(file, testPngFixture(`reference-${index}`));
      return file;
    });
    const calls: string[] = [];
    const review = async (input: { userPrompt: string; imagePaths?: string[] }) => {
      calls.push(input.userPrompt);
      return JSON.stringify({ productPhoto: input.userPrompt.includes("생성용 상품 참조 입력 검사") && input.imagePaths?.[0] === paths[12], reason: "fixture visible product; publication artwork rejected" });
    };
    assert.deepEqual(await selectVerifiedProductPhotos(paths, "purpose-separated product", 1, { review }), []);
    assert.equal(calls.length, 12, "publication keeps its bounded budget");
    assert.deepEqual(await selectVerifiedProductPhotos(paths, "purpose-separated product", 1, { review, purpose: "generation-reference" }), [paths[12]]);
    assert.equal(calls.length, 25, "generation checks later candidates and does not reuse publication verdicts");
    assert.deepEqual(await selectVerifiedProductPhotos([paths[12]], "purpose-separated product", 1, { review }), [], "generation acceptance cannot authorize publication");
    assert.deepEqual(await selectVerifiedProductPhotos([paths[0]], "wrong variant", 1, {
      purpose: "generation-reference", review: async () => JSON.stringify({ productPhoto: false, reason: "visible variant mismatch" }),
    }), []);
    await assert.rejects(selectVerifiedProductPhotos([paths[0]], "invalid schema", 1, {
      purpose: "generation-reference", review: async () => JSON.stringify({ productPhoto: "true", reason: "invalid" }),
    }), /REFERENCE_SCENE_REVIEW_INVALID/);
    await assert.rejects(selectVerifiedProductPhotos([paths[1]], "changed source", 1, {
      purpose: "generation-reference", review: async () => {
        fs.writeFileSync(paths[1], testPngFixture("changed bytes"));
        return JSON.stringify({ productPhoto: true, reason: "complete product" });
      },
    }), /REFERENCE_SCENE_CHANGED/);
    // Disk verdict cache: survives a fresh module (new process) only for identical bytes + product + purpose.
    const cacheDir = path.join(root, "verdict-cache");
    let diskCalls = 0;
    const diskReview = async () => { diskCalls++; return JSON.stringify({ productPhoto: true, reason: "fixture product visible" }); };
    assert.deepEqual(await selectVerifiedProductPhotos([paths[13]], "disk cached product", 1, { review: diskReview, verdictCacheDir: cacheDir }), [paths[13]]);
    assert.equal(diskCalls, 1);
    assert.equal(fs.readdirSync(cacheDir).filter(name => name.endsWith(".json")).length, 1, "only the parsed verdict is stored");
    const fresh = (await import(`./lib/product-photo-review.ts?fresh=${Date.now()}`)) as typeof import("./lib/product-photo-review");
    assert.deepEqual(await fresh.selectVerifiedProductPhotos([paths[13]], "disk cached product", 1, { review: diskReview, verdictCacheDir: cacheDir }), [paths[13]]);
    assert.equal(diskCalls, 1, "a new process reuses the stored verdict for the same bytes");
    await fresh.selectVerifiedProductPhotos([paths[13]], "other product", 1, { review: diskReview, verdictCacheDir: cacheDir });
    await fresh.selectVerifiedProductPhotos([paths[13]], "disk cached product", 1, { review: diskReview, verdictCacheDir: cacheDir, purpose: "generation-reference" });
    assert.equal(diskCalls, 3, "product name and purpose are part of the disk key");
    const [cached] = fs.readdirSync(cacheDir).filter(name => name.endsWith(".json")).sort((a, b) =>
      fs.statSync(path.join(cacheDir, a)).mtimeMs - fs.statSync(path.join(cacheDir, b)).mtimeMs);
    const row = JSON.parse(fs.readFileSync(path.join(cacheDir, cached), "utf8"));
    fs.writeFileSync(path.join(cacheDir, cached), JSON.stringify({ ...row, sourceHash: "0".repeat(64) }));
    const fresh2 = (await import(`./lib/product-photo-review.ts?fresh2=${Date.now()}`)) as typeof import("./lib/product-photo-review");
    await fresh2.selectVerifiedProductPhotos([paths[13]], "disk cached product", 1, { review: diskReview, verdictCacheDir: cacheDir });
    assert.equal(diskCalls, 4, "a stored verdict whose source hash does not match the bytes is ignored");
    const badDir = path.join(root, "bad-cache");
    await assert.rejects(fresh2.selectVerifiedProductPhotos([paths[13]], "unparsable", 1, { verdictCacheDir: badDir, review: async () => "not json" }));
    assert.equal(fs.existsSync(badDir) ? fs.readdirSync(badDir).length : 0, 0, "invalid responses are never cached");
    console.log("PASS: reference/publication cache separation, 12/24 bounded candidates, wrong variant and malformed/changed evidence rejected; no live calls");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
