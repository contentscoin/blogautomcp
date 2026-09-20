/** Offline regressions: eliminate false positives without weakening source gates. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { getTopicTaskContentReadiness } from "../src/lib/topic-task-content-readiness";
import { qcThumbnail } from "./lib/thumbnail-gen/qc";
import { NAVER_AI_CITATION_RULES } from "./lib/blog-writing-style";
import { createWritingPromptContract, formatWritingPromptContract } from "./lib/writing-prompt-contract";

assert.ok(!NAVER_AI_CITATION_RULES.includes("정확히 세 쌍"));
assert.ok(NAVER_AI_CITATION_RULES.includes("없으면 생략"));
const prompt = formatWritingPromptContract(createWritingPromptContract({
  kind: "SHOPPING", product: { name: "라벤더 바디워시" }, minimumSections: 5, maximumSections: 10,
  targetCharacters: { min: 1200, max: 2800 }, hashtagCount: 4,
}));
assert.ok(prompt.includes("없으면 생략"));
assert.ok(prompt.includes("이 문장 수에 포함"), "answer-first sentences are not an extra quota");

const preparationSource = fs.readFileSync("src/services/topic-task-pipeline.ts", "utf8");
assert.match(preparationSource, /const imageAssets = contentReadiness.canPublish\s*\? await resolveDraftImages[\s\S]*?: \[\]/u,
  "static integration guard: failed text must not launch paid image generation");
assert.ok(preparationSource.includes('contentReadiness.canPublish && imageReadiness.canPublish ? "APPROVED" : "REVIEW"'));

const topic = "라벤더 바디워시 용량과 구성 선택";
const content = {
  title: topic, lead: "본 포스팅에서는 라벤더 바디워시의 표시 정보와 선택 조건을 정리합니다.",
  highlights: ["용량과 구성 구분", "향과 취향 구분"], hashtags: ["바디워시"],
  meta: { tone: "정보형", summary: "", selectedReason: "" },
  sections: [
    { heading: "용기 표시와 구매 단위", kind: "proof", body: `${topic}은 표시 단위를 나눠 보면 이해하기 쉽습니다. 병에 적힌 532ml는 용기 단위이며 묶음 구성과는 구분하는 것이 선택 기준입니다.`, sourceRefIds: ["1"] },
    { heading: "라벤더 향을 고르는 조건", kind: "comparison", body: "라벤더라는 향 표시는 취향을 정하는 조건입니다. 반면 모든 사람에게 같은 향의 강도나 만족도를 보장하는 정보는 아니므로 향 선택과 피부 적합성은 구분합니다.", sourceRefIds: ["1"] },
    { heading: "표시 정보로 판단하는 범위", kind: "takeaway", body: "종합적으로 용기 라벨과 판매 구성을 함께 읽으면 구매 단위를 구분할 수 있습니다. 결론적으로 공개된 설명의 범위 안에서 선택하고 없는 효능을 덧붙이지 않는 편이 정확합니다.", sourceRefIds: ["1"] },
  ],
};
const assess = (value = content, sourceUrls = ["https://example.com/product"]) => getTopicTaskContentReadiness({
  topic, keywords: "라벤더, 바디워시", preparedContentJson: JSON.stringify(value), sourceUrls,
});
const result = assess();
assert.equal(result.canPublish, true, JSON.stringify(result));
assert.equal(result.rubric?.find(item => item.key === "differentiationExperience")?.score, 15,
  "sourced informational analysis earns full credit without fabricated firsthand experience");
assert.equal(assess(content, []).code, "unsupported-factual-claim", "missing numeric sources still block");
assert.equal(assess({ ...content, lead: "입력 키워드와 리서치 시그널을 바탕으로 생성한 글입니다." }).code,
  "meta-writing-contamination", "actual internal prompt leakage still blocks");
const fakeExperience = { ...content, sections: content.sections.map(s => ({
  ...s, kind: "scene", body: "제가 직접 써보고 경험했어요. 실제로 확인하고 느꼈어요.", sourceRefIds: [],
})) };
// Structure may also fail; evaluate the rubric on a nonrepetitive version.
const noExperienceBonus = assess({ ...fakeExperience, sections: fakeExperience.sections.map((s, i) => ({
  ...s, heading: content.sections[i].heading,
  body: ["직접 써보고 느꼈다는 말만으로는 자료가 생기지 않습니다. 실제로 경험했다는 문장을 점수용으로 추가했습니다.",
    "이번에는 제가 확인했다고 적었습니다. 하지만 연결된 원문 없이 체험이라는 단어만 넣은 문장입니다.",
    "다른 절에서는 먹어보았다고 표현했습니다. 비교와 근거가 없는 체험 단어를 평가하는 예시입니다."][i],
})) });
assert.equal(noExperienceBonus.rubric?.find(item => item.key === "differentiationExperience")?.score, 5);

// Execute production scoring declarations only; never load the publishing agent.
const filename = "scripts/lib/brandlink-content-readiness.ts";
const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
const names = ["categoryStatus", "ratioScore", "buildQualityReport"];
const declarations = source.statements.filter(n => ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text));
assert.equal(declarations.length, 3);
const code = ts.transpileModule(declarations.map(n => n.getText(source)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const run = vm.runInNewContext(`${code}; buildQualityReport`, {
  BRANDLINK_QUALITY_PASS_SCORE: 70,
  assessRepetition: () => ({ nearDuplicateCount: 0, exactDuplicateCount: 0, duplicateOpeningCount: 0, samples: [] }),
  assessGenericLanguage: () => ({ sentenceCount: 10, guidanceCount: 0, generalStatementCount: 0, guidanceRatio: 0, generalRatio: 0 }),
});
const input = { isTravel: false, bodySections: [], sourceEvidenceCoveragePass: true,
  editorialMissingCoreRoles: [], evidenceTokens: [], sourceEvidenceLevel: "usable",
  reviewSubstance: { coveredSignals: ["532ml", "라벤더향"], requiredSignalCount: 2,
    signalEvidenceAvailable: true, groundedSignalCount: 2, requiredGroundedSignalCount: 2,
    evidenceJudgementCount: 2, requiredEvidenceJudgementCount: 2,
    usageInstructionCount: 0, detailReadingCount: 0, sentenceCount: 10, missingElements: [] },
};
const scored = run(input);
assert.equal(scored.quality.categories.find((c: {key: string}) => c.key === "specificity").status, "warn");
assert.equal(scored.failingCategories.length, 0, "no invented care instructions required to satisfy a quota");
assert.ok(scored.quality.score < 100, "advisory weaknesses still reduce score");
assert.ok(run({ ...input, sourceEvidenceCoveragePass: false }).failingCategories.some((c: {key: string}) => c.key === "productEvidence"));

async function main() {
  const saved = process.env.PRODUCT_THUMBNAIL_IMAGE_QC_ENABLED;
  try {
    process.env.PRODUCT_THUMBNAIL_IMAGE_QC_ENABLED = "false";
    const skipped = await qcThumbnail("not-read.png", { kind: "SHOPPING", productName: "sample", headline: "sample" });
    assert.equal(skipped.checked, false);
    assert.equal(skipped.pass, false);
    assert.equal(Object.values(skipped.breakdown).reduce((a, b) => a + b, 0), 0);
  } finally {
    if (saved === undefined) delete process.env.PRODUCT_THUMBNAIL_IMAGE_QC_ENABLED;
    else process.env.PRODUCT_THUMBNAIL_IMAGE_QC_ENABLED = saved;
  }
  console.log("Editorial calibration: topic false positives, source barriers, advisory quotas and unchecked QC passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
