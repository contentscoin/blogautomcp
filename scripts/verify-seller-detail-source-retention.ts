/** Offline reproduction: twenty gallery images precede lazy-loaded Samsung specs. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { isCandidateProductImageUrl, isSalesPageProductImageUrl, isPreferredThumbnailImageUrl,
  normalizeCandidateImageUrl, preserveSellerDetailSourceUrls, prioritizeImageCandidates } from "./lib/product-image-selection";
const root = "https://d15zs6bxpcjiwz.cloudfront.net/Home/Dryers/";
const spec = `${root}DV21DG8600BW_spec.jpg`;
const detail = `${root}DV21DG8600BW.jpg`;
const gallery = Array.from({ length: 20 }, (_, index) => `https://shop-phinf.pstatic.net/gallery-${index}.jpg`);
assert.equal(isCandidateProductImageUrl(spec), true);
assert.equal(isSalesPageProductImageUrl(spec), true);
assert.equal(normalizeCandidateImageUrl(spec), spec);
assert.equal(isPreferredThumbnailImageUrl(spec), false, "spec sheets never become preferred thumbnail candidates");
for (const bad of ["https://other.cloudfront.net/x.jpg", "https://d15zs6bxpcjiwz.cloudfront.net.evil.test/x.jpg",
  "https://sub.d15zs6bxpcjiwz.cloudfront.net/x.jpg", "http://d15zs6bxpcjiwz.cloudfront.net/x.jpg",
  "https://user@d15zs6bxpcjiwz.cloudfront.net/x.jpg", "https://d15zs6bxpcjiwz.cloudfront.net:8443/x.jpg"])
  assert.equal(isCandidateProductImageUrl(bad), false);
const ranked = prioritizeImageCandidates([
  ...gallery.map((url, index) => ({ url, index, source: "gallery" as const, width: 860, height: 860 })),
  { url: detail, index: 20, source: "dom", width: 1, height: 1 },
  { url: spec, index: 21, source: "dom", width: 1, height: 1 },
]);
assert.deepEqual(ranked.slice(0, 20), gallery, "existing gallery/thumbnail order is unchanged");
const references = preserveSellerDetailSourceUrls(ranked, 20);
assert.deepEqual(references.slice(0, 2), [spec, detail]);
assert.equal(references.length, 20);
assert.equal(new Set(references).size, 20);
const agent = fs.readFileSync("scripts/simple-agent.ts", "utf8");
assert.ok(agent.includes('img.getAttribute("data-src")'), "lazy source URL must be read before dimensions are available");
assert.ok(agent.includes("preserveSellerDetailSourceUrls(allImageUrls, imageCandidateMax)"));
assert.equal((agent.match(/referenceImageUrls: preserveSellerDetailSourceUrls\(product\.sourceImageUrls\)/gu) || []).length, 2,
  "both draft snapshot routes preserve the spec before the twenty-source cap");
console.log("PASS lazy seller spec survives 20 gallery sources, snapshots and strict CDN checks without changing thumbnail order");
