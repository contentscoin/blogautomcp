import assert from "node:assert/strict";
import { detectUnsupportedExperience, getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { validateDraft } from "./lib/post-spec/validate";
import type { PostSpec } from "./lib/post-spec/types";

// Minimal spec: other QC outcomes are deliberately not asserted or changed.
const spec: PostSpec = {
  version: "post-spec/v1", connectKind: "SHOPPING", productId: null, productName: "테스트 제품",
  facts: { lines: [], travel: null, blockedClaimRules: [] }, brief: null, sections: [], evidenceLedger: [],
  imagePlan: { policy: "LOCKED_PRODUCT_OR_ORIGINAL", hero: null, slots: [], targetBody: 0, resolvedBody: 0, minBody: 0, shortfall: 0, shrinkApplied: false, notes: [] },
  seo: { primaryKeyword: "테스트", secondaryKeywords: [], title: { minChars: 1, maxChars: 50, keywordFirst: true, mustIncludeTokens: ["테스트"] }, firstSentenceMustInclude: "테스트", keywordMentionsPer1000: [0, 1000], hashtags: { count: 0, required: [], banned: [] } },
  geo: { summaryLines: 0, factsMinLines: 0, faqCount: 0, checklistMin: 0, sourceLine: "" },
  totalChars: [0, 10000], disclosure: "", generation: { mode: "single", chunks: [], maxOutputTokens: 1000, temperature: 0 },
};
const safe = [
  "직접 구매나 사용 후기는 제공되지 않았으므로 확인된 정보만 안내합니다.",
  "직접 사용 후기는 없습니다.", "제가 구매한 적은 없습니다.",
  "직접 사용하지 않았습니다.", "직접 사용해 본 적이 없습니다.",
  "직접 사용하면 알 수 있습니다.", "직접 사용해 보세요.", "직접 구매하세요.",
  "직접 사용해 봤다면 차이를 확인하세요.", "방문했다면 운영 시간을 확인하세요.",
  "사용 후 건조 과정", "사용하는 방식", "직접 사용하는 방식", "직접 사용 후 건조 과정",
  "직접 사용하기 전에 설명서를 읽으세요.", "직접 사용하지 마세요.",
];
const claims = [
  "직접 사용해 봤어요.", "제가 구매했습니다.", "저도 주문했어요.", "방문했어요.",
  "택배 도착 후 개봉했습니다.", "재구매 의사가 있습니다.", "강력 추천합니다.",
  "공항에 도착하니 비가 왔어요.",
  "직접 구매나 사용 후기는 제공되지 않았으므로 직접 사용해 봤어요.",
  "직접 사용해 봤어요. 구매 후기는 제공되지 않았습니다.",
  "직접 사용해 봤어요, 사용 후기는 없습니다.",
  "직접 사용해 봤어요 그런데 구매 경험은 없습니다.",
  "직접 사용하지 않았지만 제가 구매했어요.",
  "직접 구매 후기는 없고 직접 사용해 봤어요.",
  "직접 사용해 보세요. 저는 직접 사용해 봤어요.",
  "직접 사용했습니다만 후기는 없습니다.",
];
for (const [expected, cases] of [[false, safe], [true, claims]] as const) {
  for (const text of cases) {
    const found = detectUnsupportedExperience(text);
    assert.equal(found.length > 0, expected, `helper: ${text}`);
    for (const match of found) assert.ok(text.includes(match), `exact match: ${match}`);
    const gate = getBrandLinkContentReadiness({ productName: spec.productName, title: "테스트 제품 안내", sections: [text], hashtags: [], brandLink: "", generationSource: "AI", hasRepresentativeImage: false, mode: "editorial" });
    assert.equal(gate.blockers.some(b => b.code === "unsupported-experience-claim"), expected, `readiness: ${text}`);
    const report = validateDraft(spec, { title: "테스트 제품 안내", sections: [{ index: 0, role: "benefit", title: "", lines: [text] }], hashtags: [], source: "local-template", model: null, attempts: 0 }, { brandLink: "", hasRepresentativeImage: false, requireRepresentativeImage: false, thumbnailGenerated: false });
    const target = report.repair.targets.find(t => t.code === "FORBIDDEN_CLAIM");
    assert.equal(Boolean(target), expected, `section gate: ${text}`);
    if (target) assert.ok(found.some(match => target.reason.includes(match)));
  }
}
// Every boundary and both clause orders must preserve the independent claim.
for (const boundary of [". ", ", ", "; ", "\n", " 하지만 ", " 그리고 "]) {
  for (const text of [safe[0] + boundary + claims[0], claims[0] + boundary + safe[0]]) {
    assert.ok(detectUnsupportedExperience(text).length > 0, text);
  }
}
const baseInput = { productName: spec.productName, title: "테스트 제품 안내", sections: [claims[0]], hashtags: [], brandLink: "", generationSource: "AI" as const, hasRepresentativeImage: false };
assert.equal(getBrandLinkContentReadiness({ ...baseInput, experienceMode: "VERIFIED_EXPERIENCE" }).blockers.some(b => b.code === "unsupported-experience-claim"), false);
assert.equal(getBrandLinkContentReadiness({ ...baseInput, title: "테스트 제품 내돈내산", sections: [safe[0]] }).blockers.some(b => b.code === "unsupported-experience-claim"), true);
const headingReport = validateDraft(spec, { title: baseInput.title, sections: [{ index: 0, role: "benefit", title: claims[0], lines: [safe[0]] }], hashtags: [], source: "local-template", model: null, attempts: 0 }, { brandLink: "", hasRepresentativeImage: false, requireRepresentativeImage: false, thumbnailGenerated: false });
assert.ok(headingReport.repair.targets.some(t => t.code === "FORBIDDEN_CLAIM"));
console.log(`Experience context verified: ${safe.length + claims.length} cases across helper and both gates, plus 12 clause-boundary cases and 3 title/mode checks.`);
