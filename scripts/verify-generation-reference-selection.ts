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
    console.log("PASS: reference/publication cache separation, 12/24 bounded candidates, wrong variant and malformed/changed evidence rejected; no live calls");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
