import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import {
  CHATGPT_DIRECT_PRIMARY_PROMPT_MAX_CHARS,
  CHATGPT_DIRECT_RECOVERY_PROMPT_MAX_CHARS,
  compactChatGptEvidence,
} from "./lib/chatgpt-direct-prompt";
import {
  composeBudgetedWritingPrompt,
  createWritingPromptContract,
  formatDraftSubmissionNextAction,
  formatWritingPromptContract,
  getWritingOutputExample,
  reviewGeneratedEvidenceFacts,
  selectGroundedEvidenceFacts,
} from "./lib/writing-prompt-contract";

// Execute the real prompt builder in isolation. Importing simple-agent would launch
// the agent and its browser/network workflow, so compile only this pure declaration.
const agentPath = path.join(__dirname, "simple-agent.ts");
const source = ts.createSourceFile(agentPath, fs.readFileSync(agentPath, "utf8"), ts.ScriptTarget.Latest, true);
const builder = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "buildDirectBrowserGptPrompt",
);
assert.ok(builder, "The browser prompt builder must exist");
const compiled = ts.transpileModule(builder.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const buildBrowserPrompt = vm.runInNewContext(`${compiled}\nbuildDirectBrowserGptPrompt;`, {
  CHATGPT_DIRECT_PRIMARY_PROMPT_MAX_CHARS,
  CHATGPT_DIRECT_RECOVERY_PROMPT_MAX_CHARS,
  compactChatGptEvidence,
  composeBudgetedWritingPrompt,
  formatOpenCrabSeoBriefForPrompt: () => "",
}) as (...args: unknown[]) => string;

let browserCases = 0;
for (const kind of ["SHOPPING", "TRAVEL"] as const) {
  // Non-default bounds catch accidental provider hardcoding.
  const contract = createWritingPromptContract({
    kind, minimumSections: 8, maximumSections: 11,
    targetCharacters: { min: 2400, max: 4200 }, hashtagCount: 4,
  });
  const mandatory = formatWritingPromptContract(contract);
  const example = getWritingOutputExample(contract);
  assert.deepEqual(JSON.parse(mandatory.split("\n").at(-1)!), example);
  assert.equal(example.sections[0].split("\n\n")[1].split("\n").length, kind === "TRAVEL" ? 5 : 4);
  assert.equal(example.hashtags.length, 4);
  assert.deepEqual(example.evidenceFacts, []);
  assert.match(mandatory, /최소 2400자/u);
  assert.match(mandatory, /권장 상한 4200자/u);
  assert.match(mandatory, /본문 문단을 구분자 없이 이은 문자열 길이\(문단 내부 공백 포함\)/u);
  assert.doesNotMatch(mandatory, /공백 제외/u);
  assert.match(mandatory, /sections는 8~11개/u);
  assert.match(mandatory, /제목 25~35자/u);
  assert.match(mandatory, /출처 없는 운영시간.*생략/u);
  assert.match(mandatory, /검색 도구가 없으면 제공된 근거 안에서/u);
  assert.match(mandatory, /추정형 표현을 확정형으로 바꿔 사실처럼 만들지/u);

  const context = {
    connectKind: kind, productName: "검증용 상품", description: "제공된 원본 정보\n".repeat(3000),
    features: ["기능 A", "기능 B"], price: "100원", originalPrice: "", discountRate: "",
    couponInfo: "", deliveryInfo: "", reviewCount: "", rating: "",
    minimumSectionCount: 8, maximumSectionCount: 11, targetSectionCount: 9,
    writingContract: contract, editorialPromptBlock: "장소 및 기능 근거\n".repeat(3000),
    editorialSectionTitles: ["첫 장면", "배경", "실용 정보"],
  };
  for (const mode of ["primary", "recovery"] as const) {
    const prompt = buildBrowserPrompt("system", "user", context, 8, mode);
    const limit = mode === "primary" ? CHATGPT_DIRECT_PRIMARY_PROMPT_MAX_CHARS : CHATGPT_DIRECT_RECOVERY_PROMPT_MAX_CHARS;
    assert.ok(prompt.length <= limit, `${kind}/${mode}: ${prompt.length}/${limit}`);
    assert.ok(prompt.endsWith(mandatory), "Budgeting must retain the entire shared contract and JSON example");
    assert.equal(prompt.split(contract.version).length - 1, 1, "Mandatory rules should appear once");
    browserCases += 1;
  }
  const raisedMinimum = buildBrowserPrompt("", "", context, 9, "recovery");
  assert.match(raisedMinimum, /sections는 9~11개/u);

  const verified = createWritingPromptContract({
    kind, minimumSections: 8, maximumSections: 11,
    targetCharacters: { min: 2400, max: 4200 }, hashtagCount: 4,
    verifiedExperienceNotes: "직접 방문한 날짜와 관찰 내용만 확인된 메모입니다.",
  });
  const verifiedPrompt = buildBrowserPrompt("", "", { ...context, writingContract: verified }, 8, "recovery");
  assert.ok(verifiedPrompt.includes(verified.verifiedExperienceNotes));
  assert.doesNotMatch(verifiedPrompt, /실제 사용·구매·방문 경험은 제공되지 않았으므로/u);
  assert.match(verifiedPrompt, /검증 메모에 명시된 사실에만 한정/u);
  assert.throws(() => composeBudgetedWritingPrompt({
    contract, prefix: "", suffix: "", evidence: "", maxChars: 100,
  }), /고정 프롬프트가 예산을 초과/u, "Never silently truncate mandatory rules");
}

assert.throws(() => createWritingPromptContract({
  kind: "TRAVEL", minimumSections: 12, maximumSections: 7,
  targetCharacters: { min: 1750, max: 3600 }, hashtagCount: 5,
}), /Invalid writing contract bounds/);

const supplied = Object.freeze(["무선 충전 지원 안 함", "최대 하중 10kg", "USB-C 충전"]);
const unsupported = [
  "무선 충전 지원", "최대 하중 100kg", "10kg", "USB-C 충전 및 완전 방수",
  "배터리 100시간", "최대 하중 １０kg", "USB-C 충전. 전원 없이 작동합니다.",
];
const evidence = reviewGeneratedEvidenceFacts([
  "  최대   하중 10kg\n", "USB-C 충전", "USB-C 충전", ...unsupported, null, 3,
], supplied);
assert.deepEqual(evidence.matchedSuppliedFacts, [supplied[1], supplied[2]], "Return only complete original supplied facts");
assert.deepEqual(evidence.unverifiedFacts, unsupported, "Numbers, negation, extra claims, and substrings cannot verify themselves");
assert.deepEqual(supplied, ["무선 충전 지원 안 함", "최대 하중 10kg", "USB-C 충전"], "Do not mutate source evidence");
assert.deepEqual(reviewGeneratedEvidenceFacts(["새 기능"], []), { matchedSuppliedFacts: [], unverifiedFacts: ["새 기능"] });
assert.deepEqual(reviewGeneratedEvidenceFacts(null, supplied), { matchedSuppliedFacts: [], unverifiedFacts: [] });
const longSource = "확인된 정보 ".repeat(50);
const appendedClaim = `${longSource} 방수 100미터를 보장합니다.`;
assert.deepEqual(reviewGeneratedEvidenceFacts([appendedClaim], [longSource]).matchedSuppliedFacts, [], "Never truncate away an unsupported suffix before matching");

// Also exercise the real post-generation boundary, not just the matching helper.
const step2 = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "step2_generatePost",
);
assert.ok(step2?.body);
const statements = step2.body.statements;
const parsedDraftIndex = statements.findIndex((node) => ts.isVariableStatement(node) &&
  node.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "json"),
);
assert.ok(parsedDraftIndex >= 0);
const evidenceBoundary = statements[parsedDraftIndex + 1];
assert.ok(evidenceBoundary && ts.isIfStatement(evidenceBoundary));
const product = { name: "테스트 보조배터리", description: "", features: [...supplied], price: "13,700원", originalPrice: "", couponInfo: "" };
const boundaryContext: Record<string, unknown> = {
  isTravel: false, product, json: { evidenceFacts: [...supplied, ...unsupported, "판매가 13,700원", "판매가 17,300원"] },
  reviewGeneratedEvidenceFacts, selectGroundedEvidenceFacts, scoringEvidenceFacts: undefined, console: { log: () => undefined },
};
vm.runInNewContext(ts.transpileModule(evidenceBoundary.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText, boundaryContext);
assert.deepEqual(product.features, [...supplied], "Model evidence must not expand or replace QC source features");
assert.deepEqual(
  boundaryContext.scoringEvidenceFacts,
  [supplied[0], supplied[1], "최대 하중 １０kg", "판매가 13,700원"],
  "Only snapshot-backed statements count for scoring: changed numbers, flipped negation, added claims and bare fragments are rejected",
);
const groundedReview = selectGroundedEvidenceFacts(
  ["메쉬 소재 러닝 조끼 판매가 13,700원", "메쉬 소재 러닝 조끼 판매가 13,900원", "러닝 조끼 방수 등급 IPX7", "러닝"],
  "RNRN 러닝 조끼 메쉬 소재\n가격: 13,700원\n원가: 59,800원",
);
assert.deepEqual(groundedReview.grounded, ["메쉬 소재 러닝 조끼 판매가 13,700원"]);
assert.equal(groundedReview.rejected.length, 3);

// Test the generated handoff instructions rather than source-code string presence.
const nextAction = formatDraftSubmissionNextAction();
assert.match(nextAction, /텍스트 실패가 명시된 경우에만/u);
assert.match(nextAction, /이미지·배치 실패만 있으면 원고를 재작성하거나 재제출하지 마세요/u);
assert.match(nextAction, /composition-quality 안에 본문 분량·섹션 실패도 있으면 그 텍스트 항목만/u);
assert.match(nextAction, /원인이 불명확하면 실패 상세를 조회/u);
assert.match(nextAction, /발행은 별도 확인/u);

console.log(JSON.stringify({ ok: true, browserCases, unsupportedCandidates: unsupported.length, sourceEvidenceBoundary: true, sharedSchema: true, compositionOnlyHandoff: true }));
