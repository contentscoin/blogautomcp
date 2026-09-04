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
  formatDraftMemoRequirements,
  extractRequestedDraftTitle,
  resolveWritingDraftTitle,
  formatWritingPromptContract,
  getWritingOutputExample,
  reviewGeneratedEvidenceFacts,
  selectGroundedEvidenceFacts,
} from "./lib/writing-prompt-contract";

// Execute the real prompt builder in isolation. Importing simple-agent would launch
// the agent and its browser/network workflow, so compile only this pure declaration.
const agentPath = path.join(__dirname, "simple-agent.ts");
const source = ts.createSourceFile(agentPath, fs.readFileSync(agentPath, "utf8"), ts.ScriptTarget.Latest, true);

// Run production declarations in isolation: no agent entrypoint, network or DB.
const declarations = new Map<string, ts.VariableDeclaration>();
function collectDeclarations(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    declarations.set(node.name.text, node);
  }
  ts.forEachChild(node, collectDeclarations);
}
collectDeclarations(source);
function evaluateInitializer<T = unknown>(name: string, context: Record<string, unknown>): T {
  const initializer = declarations.get(name)?.initializer;
  assert.ok(initializer, `Production initializer ${name} exists`);
  const defaults: Record<string, unknown> = {};
  function collectIdentifiers(node: ts.Node): void {
    if (ts.isIdentifier(node)) defaults[node.text] = "";
    ts.forEachChild(node, collectIdentifiers);
  }
  collectIdentifiers(initializer);
  return vm.runInNewContext(ts.transpileModule(`(${initializer.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { ...defaults, JSON, ...context }) as T;
}
const memo = "제목은 정확히 오사카 3일 여행, 교토·고베 일정과 온천호텔 선택 기준 으로 작성. 실제 체험으로 주장하지 말고 상품 근거에 기반한 정보형 원고.";
const exactTitle = "오사카 3일 여행, 교토·고베 일정과 온천호텔 선택 기준";
assert.equal(extractRequestedDraftTitle(memo), exactTitle);
assert.equal(extractRequestedDraftTitle('제목은 정확히 “오사카 여행”으로 작성.'), "오사카 여행");
assert.equal(extractRequestedDraftTitle("온천호텔 선택 기준을 다뤄주세요."), undefined);
const memoContractContext = {
  createWritingPromptContract, connectKind: "TRAVEL", minimumBodySectionCount: 8,
  maximumBodySectionCount: 11, compositionContract: { targetCharacters: { min: 2400, max: 4200 } },
  NAVER_BLOG_HASHTAG_COUNT: 4, BRANDLINK_EXPERIENCE_MODE: "AI_INFORMATION",
  process: { env: { BRANDLINK_DRAFT_MEMO: memo } },
};
const memoContract = evaluateInitializer<ReturnType<typeof createWritingPromptContract>>("writingContract", { ...memoContractContext, specInput: undefined });
assert.equal(memoContract.draftMemo, memo, "Codex must receive the environment memo even without spec-first input");
assert.equal(evaluateInitializer<ReturnType<typeof createWritingPromptContract>>("writingContract", { ...memoContractContext, specInput: { memo: "상품 선택 기준" } }).draftMemo,
  "상품 선택 기준", "Explicit input takes precedence over environment");
const memoBlock = formatWritingPromptContract(memoContract);
assert.ok(memoBlock.includes(memo));
assert.match(memoBlock, /필수 주제.*일반 편집 지침보다 우선/u);
assert.match(memoBlock, /사실 증거가 아닙니다/u);
assert.match(memoBlock, /숙박·온천호텔 선택 기준/u);
const prompt = evaluateInitializer<string>("userPrompt", {
  isTravel: true, product: { description: "숙박 호텔 미정", features: ["교토·고베 일정"] },
  writingContract: memoContract, mandatoryWritingPromptBlock: memoBlock,
});
assert.ok(prompt.includes(memo), "Actual Codex user prompt contains full memo");
assert.ok(prompt.includes("숙박 호텔 미정"), "Lodging evidence survives the destination-only travel lens");
const sanitize = (title: string) => title.trim();
for (const name of ["normalizedTitle", "repairedTitle"]) {
  assert.equal(evaluateInitializer(name, {
    json: { title: "오사카3일 교토 고베야경, 란덴과 도톤보리" }, repairedJson: { title: "변경된 제목" },
    product: { name: "원본 상품명" }, normalizedTitle: exactTitle,
    writingContract: memoContract, resolveWritingDraftTitle, sanitizeTitle: sanitize,
  }), exactTitle, `${name} must preserve explicit requested title`);
}
assert.throws(() => resolveWritingDraftTitle("title", "fallback", memoContract, () => "changed"), /기존 제목 정책과 충돌/u);
const noMemoContract = createWritingPromptContract({ kind: "TRAVEL", minimumSections: 8, maximumSections: 11,
  targetCharacters: { min: 2400, max: 4200 }, hashtagCount: 4 });
assert.equal(resolveWritingDraftTitle(" normal ", "fallback", noMemoContract, sanitize), "normal");
assert.equal(formatDraftMemoRequirements(noMemoContract), "");
const budgetedMemoPrompt = composeBudgetedWritingPrompt({ contract: memoContract, prefix: "", suffix: "",
  evidence: "원본 근거".repeat(10000), maxChars: 6000 });
assert.ok(budgetedMemoPrompt.includes(memo), "Evidence truncation cannot remove requirements");
assert.ok(budgetedMemoPrompt.length <= 6000);
const repairBuilder = declarations.get("buildRepairPrompt")?.initializer;
assert.ok(repairBuilder && ts.isArrowFunction(repairBuilder) && ts.isBlock(repairBuilder.body));
const repairReturn = repairBuilder.body.statements.find(ts.isReturnStatement);
assert.ok(repairReturn?.expression);
declarations.set("repairPromptForTest", ts.factory.createVariableDeclaration("repairPromptForTest", undefined, undefined, repairReturn.expression));
const repairPrompt = evaluateInitializer<string>("repairPromptForTest", {
  editorialQuality: { code: "too-short-content", reason: "short", blockers: [], quality: { score: 50, passScore: 80 } },
  failedSignals: [], qualityNotes: [], repetitionSamples: [], travelSubstance: null,
  isTravel: true, mandatoryWritingPromptBlock: memoBlock, normalizedTitle: exactTitle,
  writingContract: memoContract, product: { description: "숙박 호텔 미정", features: ["교토·고베 일정"] },
  bodySections: ["온천호텔 선택 기준\n\n숙박 호텔은 미정입니다."], hashtags: [],
});
assert.ok(repairPrompt.includes(memo), "Actual quality repair prompt retains full memo");
assert.ok(repairPrompt.includes("숙박 호텔 미정"), "Repair retains original lodging evidence");
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

// Attribute/value pairs and polarity must be grounded together, never as a bag of tokens.
const groundingCases = [
  {
    snapshot: "충전 시간: 2시간 / 사용 시간: 8시간",
    grounded: ["충전 시간: 2시간", "사용 시간: 8시간", "충전시간 : 2 시간."],
    rejected: ["충전 시간: 8시간", "사용 시간: 2시간", "충전 시간: 2시간 완전 방수"],
  },
  {
    snapshot: "배터리 용량 5000mAh 미지원",
    grounded: ["배터리 용량 5000mAh 미지원", "배터리 용량: 5,000 mAh 미지원."],
    rejected: ["배터리 용량 5000mAh 지원", "배터리 용량 5000mAh", "배터리 용량 5000mAh 미포함"],
  },
  {
    snapshot: "충전 시간: 2시간\n사용 시간: 8시간\n배터리 용량 5000mAh 지원",
    grounded: ["배터리 용량 5000mAh 지원"],
    rejected: ["충전 시간: 8시간", "배터리 용량 5000mAh 미지원", "배터리 용량 5000mAh 지원 안 함"],
  },
  {
    snapshot: "최대 하중: 10kg.\n무선 충전 지원 안 함\n온도: -5도\n전압: 3.7V\n방수: IPX7 (수영 제외)",
    grounded: ["최대 하중 １０ kg", "무선충전 지원 안함", "온도: -5도", "전압 3.7 V", "방수: IPX7 (수영 제외)"],
    rejected: ["최대 하중 100kg", "하중 10kg", "무선 충전 지원", "무선 충전 함", "온도: 5도", "전압 37V", "방수: IPX7", "하중 한도는 10kg입니다"],
  },
  {
    snapshot: "배터리 용량 5000mAh 미지원\n방수 등급 IPX7 지원\n소비전력: 5mW\n방수: IPX7 / 수영 제외",
    grounded: ["방수 등급: IPX7 지원", "소비전력 5 mW", "방수: IPX7 / 수영 제외"],
    rejected: ["배터리 용량 5000mAh 지원", "방수 등급 IPX7 미지원", "소비전력: 5MW", "방수: IPX7"],
  },
  {
    snapshot: "RNRN 러닝 조끼 메쉬 소재\n가격: 13,700원\n원가: 59,800원",
    grounded: ["판매가: 13,700 원", "RNRN 러닝 조끼 메쉬 소재 판매가 13,700원", "메쉬 소재 러닝 조끼 판매가 13,700원"],
    rejected: ["판매가 59,800원", "메쉬 소재 러닝 조끼 판매가 59,800원", "메쉬 소재 방수 러닝 조끼 판매가 13,700원", "메쉬 소재 러닝 조끼 판매가 13,700원 무료배송"],
  },
  {
    snapshot: "테스트 제품\n13,700원\n59,800원\n면적: 10²m",
    grounded: ["면적: 10²m"],
    rejected: ["판매가 13,700원", "판매가 59,800원", "면적: 102m"],
  },
] as const;
for (const testCase of groundingCases) {
  assert.deepEqual(
    selectGroundedEvidenceFacts([...testCase.grounded, ...testCase.rejected], testCase.snapshot),
    { grounded: [...testCase.grounded], rejected: [...testCase.rejected] },
    `Conservative evidence grounding: ${testCase.snapshot}`,
  );
}
assert.deepEqual(selectGroundedEvidenceFacts(null, "배터리 용량 5000mAh"), { grounded: [], rejected: [] });
assert.deepEqual(selectGroundedEvidenceFacts([null, 3, "", "  최대 하중 10kg\n", "최대 하중 10kg"], "최대 하중 10kg"), {
  grounded: ["최대 하중 10kg"], rejected: [],
});

// Test the generated handoff instructions rather than source-code string presence.
const nextAction = formatDraftSubmissionNextAction();
assert.match(nextAction, /텍스트 실패가 명시된 경우에만/u);
assert.match(nextAction, /이미지·배치 실패만 있으면 원고를 재작성하거나 재제출하지 마세요/u);
assert.match(nextAction, /composition-quality 안에 본문 분량·섹션 실패도 있으면 그 텍스트 항목만/u);
assert.match(nextAction, /원인이 불명확하면 실패 상세를 조회/u);
assert.match(nextAction, /발행은 별도 확인/u);

console.log(JSON.stringify({ ok: true, browserCases, unsupportedCandidates: unsupported.length, groundingCases: groundingCases.length,
  groundedCandidates: groundingCases.reduce((sum, testCase) => sum + testCase.grounded.length, 0),
  rejectedCandidates: groundingCases.reduce((sum, testCase) => sum + testCase.rejected.length, 0),
  sourceEvidenceBoundary: true, sharedSchema: true, compositionOnlyHandoff: true }));
