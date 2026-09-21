/** Offline: latter seller crops, failures and the existing wall-clock budget. */
import assert from "node:assert/strict";
import { readSellerDetailOcrFacts } from "./lib/product-source-ocr";
const tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
  "5\t1\t1\t1\t1\t1\t0\t0\t100\t20\t96\t자동온수세척";
const paths = Array.from({ length: 10 }, (_, index) => `crop-${index + 1}.jpg`);
const base = { exists: () => true, candidates: ["fixture-tesseract"], cacheKey: () => null };
async function main() {
  const inspected: string[] = [];
  const late = await readSellerDetailOcrFacts(paths, { ...base, run: async (_binary, args) => {
    if (args.includes("--list-langs")) return "eng\nkor\n";
    inspected.push(args[0]);
    return args[0] === "crop-8.jpg" ? tsv : "";
  } });
  assert.deepEqual(inspected, paths.slice(0, 8));
  assert.equal(late.scannedImageCount, 8);
  assert.deepEqual(late.imagePaths, ["crop-8.jpg"]);
  assert.deepEqual(late.facts, ["기능: 자동온수세척"]);
  assert.equal(late.status, "complete");
  const failed = await readSellerDetailOcrFacts(paths, { ...base, run: async (_binary, args) => {
    if (args.includes("--list-langs")) return "eng\nkor\n";
    throw new Error("OCR image process failed");
  } });
  assert.equal(failed.status, "unavailable", "all failed image processes must not report complete");
  assert.equal(failed.scannedImageCount, 0);
  assert.deepEqual(failed.facts, []);
  const empty = await readSellerDetailOcrFacts(paths, { ...base,
    run: async (_binary, args) => args.includes("--list-langs") ? "eng\nkor\n" : "" });
  assert.equal(empty.status, "complete", "successful OCR without product facts is not a runtime failure");
  assert.equal(empty.scannedImageCount, 8);
  assert.equal(empty.imagePaths.length, 0, "scanned crops and fact-bearing crops are distinct counts");
  let elapsed = 0;
  const timed = await readSellerDetailOcrFacts(paths, { ...base, now: () => elapsed, maximumMs: 20,
    run: async (_binary, args, timeout) => {
      assert.ok(timeout > 0 && timeout <= 8_000);
      if (args.includes("--list-langs")) return "eng\nkor\n";
      elapsed += 12;
      return tsv;
    } });
  assert.equal(timed.status, "timeout");
  assert.equal(timed.scannedImageCount, 2, "eight-image coverage never removes the shared deadline");
  console.log("PASS OCR retained eight crops, eighth-crop evidence, truthful empty/failure counts and shared deadline");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
