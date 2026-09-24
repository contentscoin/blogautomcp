/** Regressions for the three first-pass failure causes seen in batch drafting (1.3.80 field report). */
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeDraftSections, sectionEntryToString, splitMergedSection } from "./lib/draft-sections";
import { parseVisualReviews } from "./lib/publish-image-audit";
import { auditSectionProposals } from "./lib/product-section-proposal-audit";
import { assessProductReviewSubstance, productEvidenceRequirement, productSignalAnchor } from "./lib/product-editorial-plan";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { createWritingPromptContract, formatWritingPromptContract, getWritingOutputExample } from "./lib/writing-prompt-contract";

async function main() {
  // 1. Structure: object sections, merged sections, and the output example.
  assert.equal(sectionEntryToString({ title: "흡입력", body: "18,000Pa 흡입력이에요.\n덕분에 카펫도 편해요." }), "흡입력\n\n18,000Pa 흡입력이에요.\n덕분에 카펫도 편해요.");
  assert.equal(sectionEntryToString({ heading: "무게", paragraphs: ["1.2kg이에요.", "손목 부담이 적어요."] }), "무게\n\n1.2kg이에요.\n\n손목 부담이 적어요.");
  const merged = ["흡입력", "18,000Pa 흡입력이에요. 카펫도 편해요.", "무게와 손목", "1.2kg이라 가벼워요.", "충전과 사용 시간", "최대 40분 사용해요.", "이런 분께 맞아요", "원룸이라면 잘 맞아요."].join("\n\n");
  assert.equal(splitMergedSection(merged).length, 4);
  assert.equal(normalizeDraftSections([merged], 5).length, 4, "merged string splits on heading boundaries");
  assert.equal(normalizeDraftSections(["A\n\n본문입니다.", "B\n\n본문입니다."], 2).length, 2, "already-structured drafts are untouched");
  assert.deepEqual(splitMergedSection("한 문단만 있습니다."), ["한 문단만 있습니다."]);
  const contract = createWritingPromptContract({ kind: "SHOPPING", minimumSections: 7, maximumSections: 11, targetCharacters: { min: 1800, max: 3600 }, hashtagCount: 4 });
  assert.equal(getWritingOutputExample(contract).sections.length, 2, "the example shows one array element per section");
  assert.match(formatWritingPromptContract(contract), /sections는 7~11개이며 섹션마다 원소 하나\("소제목\\n\\n본문"\)/u);
  const agent = fs.readFileSync("scripts/simple-agent.ts", "utf8");
  assert.match(agent, /const variants = \[\s*candidate,/u, "raw JSON is parsed before curly-quote rewriting");
  assert.match(agent, /DRAFT_OUTPUT_SCHEMA,\s*\);/u, "the draft call requests structured output");
  assert.match(agent, /같은 지시로 1회 재작성/u, "a format-only miss gets one retry instead of failing the item");

  // 2. Product evidence: the prompt and the grader share the same facts and counts; repair notes name missing facts.
  const product = { productName: "일렉트로룩스 Well Q6 무선청소기", sourceDescription: "무선 스틱 청소기",
    sourceFeatures: ["흡입력: 18,000Pa", "배터리: 최대 40분 사용", "무게: 2.4kg", "먼지통 용량: 0.3L"] };
  const requirement = productEvidenceRequirement(product);
  assert.ok(requirement.requiredSignalCount >= 2 && requirement.signals.length >= requirement.requiredSignalCount);
  assert.equal(productSignalAnchor("무게: 2.4kg"), "2.4kg");
  const partial = assessProductReviewSubstance({ ...product, sections: ["흡입력\n\n18,000Pa 흡입력이라 카펫 먼지도 한 번에 빨아들여요. 덕분에 청소 시간이 줄어 편해요."] });
  assert.equal(partial.coveredSignals.length + partial.missingSignals.length, requirement.signals.length);
  assert.ok(partial.missingSignals.length > 0);
  assert.equal(partial.requiredSignalCount, requirement.requiredSignalCount, "prompt requirement equals grader requirement");
  const readiness = getBrandLinkContentReadiness({ productName: product.productName, title: "일렉트로룩스 Well Q6 무선청소기 선택 기준 정리",
    brandLink: "https://naver.me/x", sections: ["흡입력\n\n18,000Pa 흡입력이라 카펫 먼지도 한 번에 빨아들여요. 덕분에 청소 시간이 줄어 편해요.",
      "이 포스팅은 쇼핑커넥트 활동의 일환으로 판매 발생 시 수수료를 제공받습니다."], hashtags: ["무선청소기", "청소기추천", "일렉트로룩스"],
    generationSource: "AI", hasRepresentativeImage: true, requireRepresentativeImage: false, connectKind: "SHOPPING",
    sourceDescription: product.sourceDescription, sourceFeatures: product.sourceFeatures, mode: "editorial" });
  const evidenceNotes = readiness.quality.categories.find((category) => category.key === "productEvidence")!.notes.join(" ");
  assert.match(evidenceNotes, /본문에 아직 없는 확인 사실/u, "repair guidance names the missing facts");
  assert.match(evidenceNotes, /2\.4kg|40분|0\.3L/u);
  assert.match(agent, /\[필수 상품 근거 · 원고 품질검사가 그대로 확인함\]/u, "first-draft prompt lists the graded facts");

  // 3. Visual audit: tolerant parsing, strict on missing fields; malformed proposals are dropped, not fatal.
  const ok = { accepted: true, identityMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, reviewClass: "product-photo", reason: "보풀제거기 본체가 보임" };
  assert.ok(parseVisualReviews(`검토 결과입니다.\n{"reviews":[${JSON.stringify({ ...ok, index: "1" })}]}\n끝`, 1)[0], "prose around JSON and string index are accepted");
  assert.ok(parseVisualReviews(JSON.stringify({ reviews: [{ ...ok, index: 1, notice: "false" }] }), 1)[0]);
  assert.equal(parseVisualReviews(JSON.stringify({ reviews: [{ ...ok, index: 1, notice: undefined }] }), 1)[0], null, "missing safety fields are never guessed");
  assert.equal(parseVisualReviews(JSON.stringify({ reviews: [{ ...ok, index: 1 }, { ...ok, index: 1 }] }), 1)[0], null, "duplicates fail closed");
  const rejected: string[] = [];
  const accepted = await auditSectionProposals({
    productName: "풀라스 보풀제거기", targets: [{ sectionTitle: "날", sectionBody: ["6중 날이에요."], imageIntent: "날 구조" }, { sectionTitle: "충전", sectionBody: ["USB 충전이에요."], imageIntent: "충전 단자" }],
    proposals: [{ targetIndex: 0, path: "/a.png", sourceSha256: "a" }, { targetIndex: 1, path: "/b.png", sourceSha256: "b" }],
    select: (rows) => rows,
    onRejected: (row) => rejected.push(row.sourceSha256),
    audit: async (options) => {
      const nodes = options.composition.renderNodes.flatMap((node, index) => node.kind === "image" ? [index] : []);
      return { ok: false, checked: 2, receiptReused: false,
        images: nodes.map((nodeIndex, i) => ({ nodeIndex, assetPath: i ? "/b.png" : "/a.png", sha256: i ? "b" : "a" })),
        failures: [{ nodeIndex: nodes[0]!, assetPath: "/a.png", code: "INVALID_REVIEW", reason: "Missing, duplicate, or malformed visual verdict." }] } as never;
    },
  });
  assert.deepEqual(rejected, ["a"]);
  assert.deepEqual(accepted.map((row) => row.sourceSha256), ["b"], "a malformed verdict drops only that proposal");
  const auditSource = fs.readFileSync("scripts/lib/publish-image-audit.ts", "utf8");
  assert.match(auditSource, /outputSchema: VISUAL_REVIEW_SCHEMA/u);
  assert.match(auditSource, /형식이 깨진 판정만 한 번 더 묻는다/u);

  console.log("PASS: draft structure normalization + retry, shared evidence requirement + named missing facts, tolerant visual verdicts + non-fatal proposal INVALID_REVIEW");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
