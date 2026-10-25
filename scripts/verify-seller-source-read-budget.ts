/** Offline: execute the actual optional-intake block with stalled DOM promises.
 * No browser, network, model, package write or operational data is used. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createSellerSourceReadBudget } from "./lib/seller-source-read-budget";
import { isCandidateProductImageUrl, preserveSellerDetailSourceUrls } from "./lib/product-image-selection";

async function main() {
  let clock = 0, nextCalls = 0;
  const bound = createSellerSourceReadBudget({ maximumMs: 10, now: () => clock });
  assert.deepEqual(await bound.read("late-completion", async () => { clock = 11; return ["late"]; }, ["retained"]), ["retained"]);
  assert.deepEqual(await bound.read("must-not-start", async () => { nextCalls++; return []; }, ["retained"]), ["retained"]);
  assert.equal(nextCalls, 0);
  const source = fs.readFileSync(path.join(__dirname, "simple-agent.ts"), "utf8");
  const begin = source.indexOf("  const sellerReadBudget = createSellerSourceReadBudget(");
  const end = source.indexOf("  const salesPageImageCount =", begin);
  assert(begin > 0 && end > begin);
  const actualBlock = ts.transpileModule(source.slice(begin, end), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const evaluate = new Function("env", `const {connectKind, structuredProduct, sanitizedFeatures, page, revealProductDetailImages,
    collectProductImageUrlsFromPage, createSellerSourceReadBudget, sanitizeText, isolateSellerEvidenceText,
    isCandidateProductImageUrl, preserveSellerDetailSourceUrls, SELLER_SOURCE_IMAGE_LIMIT, console}=env;
    return (async()=>{${actualBlock}\nreturn {allImageUrls,sanitizedFeatures,timedOut:sellerReadBudget.timedOut};})();`);
  const first = "https://shop-phinf.pstatic.net/20260101/a.jpg", second = "https://shop-phinf.pstatic.net/20260101/b.jpg";
  for (const mode of ["healthy", "detail-hung", "images-hung", "reviews-hung"] as const) {
    let detailCalls = 0, imageCalls = 0, reviewCalls = 0, late: ((images: string[]) => void) | undefined;
    const result = await evaluate({ connectKind: "SHOPPING", structuredProduct: { reviewHighlights: [], imageUrls: [first, second, "data:invalid"] },
      sanitizedFeatures: [], page: { evaluate: async () => { reviewCalls++; return mode === "reviews-hung" ? new Promise(() => {}) : []; } },
      revealProductDetailImages: async () => { detailCalls++; if (mode === "detail-hung") await new Promise(() => {}); },
      collectProductImageUrlsFromPage: async () => { imageCalls++; return mode === "images-hung" ? new Promise<string[]>(resolve => { late = resolve; }) : [first]; },
      createSellerSourceReadBudget: () => createSellerSourceReadBudget({ maximumMs: mode === "healthy" ? 1000 : 25 }),
      sanitizeText: (s: string) => s.trim(), isolateSellerEvidenceText: (s: string) => s,
      isCandidateProductImageUrl, preserveSellerDetailSourceUrls, SELLER_SOURCE_IMAGE_LIMIT: 24, console: { log: () => {} },
    });
    assert.deepEqual(result.allImageUrls, [first, second], "only the actual collected primary-product URLs survive a stalled optional read");
    assert.equal(detailCalls, 1); assert.equal(imageCalls, mode === "detail-hung" ? 0 : 1, "gallery DOM is read once, never again after optional reviews");
    assert.equal(reviewCalls, mode === "detail-hung" || mode === "images-hung" ? 0 : 1);
    assert.equal(result.timedOut, mode !== "healthy");
    late?.(["https://shop-phinf.pstatic.net/late/ignored.jpg"]);
    await Promise.resolve();
    assert.deepEqual(result.allImageUrls, [first, second], "a late DOM answer cannot alter the adopted source list");
  }
  console.log("PASS actual seller intake: hung detail/gallery/review reads are bounded; one DOM snapshot, primary-product source fallback, no late adoption or duplicate reads; zero model/browser/operational calls");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
