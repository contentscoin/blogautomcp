/** Offline production-function coverage: no account, browser, provider or live data. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { applyFreeformDraftRevision, assertUntargetedSectionHashesUnchanged,
  requestsFreeformTitleRevision, requestsFreeformSectionHeadingRevision } from "./lib/freeform-draft-revision";
import { readPreparedCompositionSections } from "./lib/prepared-post-markdown";
import { preservePreparedRevisionRenderPlan } from "./lib/prepared-revision-composition";
import { selectPreparedRevisionSectionIndexes, isPreparedTitleOnlyRepair } from "./lib/prepared-revision-policy";
import { shouldAcceptQualityRepair } from "./lib/quality-repair-policy";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { normalizePublishedPostText, resolvePostDocument, getPostCompositionContract } from "../src/lib/post-composition-contract";
import { classifyLocalFailure, LocalAutomationError } from "../src/lib/local-automation-error";
import { normalizeMaterialFailureObservations, formatMaterialFailureReference } from "./lib/material-failure-reference";
import { codexDraftTerminalFailureCode } from "./lib/codex-draft-provider";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { buildProduct9Canvas } from "./lib/product-9canvas";
import { createWritingPromptContract, formatWritingPromptContract } from "./lib/writing-prompt-contract";
import { assertShoppingPrewritePhoto, persistPrewritePhotoForContext, readSubmittedPrewritePhoto,
  withShoppingPrewritePhoto, writingPhotosFromPrewrite, type ShoppingPrewritePhotoProof } from "./lib/shopping-prewrite-photos";

const photoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "blogautomcp-revision-contract-"));
const photoPaths = ["hero.png", "source.png", "scene.png"].map(name => path.join(photoRoot, name));
for (const file of photoPaths) fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(2048, 8)]));
const hashFile = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

for (const [instruction, postTitle, sectionHeading] of [
  ["3번 소제목을 수정해 주세요", false, true],
  ["글 제목은 유지하고 3번 소제목을 수정해 주세요", false, true],
  ["소제목만 교정해 주세요(본문은 유지)", false, true],
  ["3번 소제목을 교정하고 나머지 소제목은 유지해 주세요", false, true],
  ["선택한 소제목 오기만 고칩니다. 나머지 전체 글 제목·소제목·본문은 그대로 유지하세요.", false, true],
  ["글 제목과 3번 소제목을 수정해 주세요", true, true],
  ["글 제목을 수정하고 소제목은 유지해 주세요", true, false],
  ["소제목은 유지하고 본문만 교정해 주세요", false, false],
] as const) {
  assert.equal(requestsFreeformTitleRevision(instruction), postTitle, instruction);
  assert.equal(requestsFreeformSectionHeadingRevision(instruction), sectionHeading, instruction);
}
const bodyParagraphs = [["첫 번째 원래 문단입니다.", "두 번째 원래 문단입니다."], ["다른 섹션 본문입니다."]];
const draft = { title: "저장된 전체 글 제목", sections: ["기존 소제목\r\n\r\n  첫 번째 원래 문단입니다.\r\n\r\n두 번째 원래 문단입니다.  ", "다른 소제목\n\n다른 섹션 본문입니다."] };
const headingOnly = applyFreeformDraftRevision(draft, JSON.stringify({ updates: [{ index: 0, heading: "교정한 소제목" }] }), [0], { allowSectionHeadingChange: true });
assert.equal(headingOnly.title, draft.title);
assert.equal(headingOnly.sections[0], "교정한 소제목" + draft.sections[0].slice("기존 소제목".length), "heading-only keeps every original body byte and separator");
assert.equal(headingOnly.sections[1], draft.sections[1]);
assert.throws(() => applyFreeformDraftRevision(draft, JSON.stringify({ title: "권한 없는 전체 제목", updates: [{ index: 0, heading: "교정" }] }), [0], { allowSectionHeadingChange: true }), /제목 수정이 요청되지/u);
assert.throws(() => applyFreeformDraftRevision(draft, JSON.stringify({ updates: [{ index: 0, heading: "교정" }] }), [0]), /소제목 수정이 요청되지/u);
assert.throws(() => applyFreeformDraftRevision(draft, JSON.stringify({ updates: [{ index: 1, heading: "범위 밖" }] }), [0], { allowSectionHeadingChange: true }), /식별자/u);
const paragraphRevision = applyFreeformDraftRevision(draft, JSON.stringify({ updates: [{ index: 0, paragraphs: ["교정한 첫 문단입니다.", bodyParagraphs[0][1]] }] }), [0], { bodyParagraphs });
assert.equal(paragraphRevision.sections[0], "기존 소제목\n\n교정한 첫 문단입니다.\n\n두 번째 원래 문단입니다.");
for (const update of [
  { index: 0, paragraphs: ["문단 수 부족"] }, { index: 0, paragraphs: ["", "빈 문단"] },
  { index: 0, paragraphs: ["내부\n개행", "두 번째"] }, { index: 0, paragraphs: ["내부\r개행", "두 번째"] },
  { index: 0, paragraphs: ["## 임의 제목", "두 번째"] },
  { index: 0, body: "충돌", paragraphs: ["첫 번째", "두 번째"] },
  { index: 1, paragraphs: ["범위 밖"] }, { index: 0, paragraphs: ["첫 번째", "두 번째"], heading: "미허용" },
]) assert.throws(() => applyFreeformDraftRevision(draft, JSON.stringify({ updates: [update] }), [0], { bodyParagraphs }));
assert.throws(() => applyFreeformDraftRevision(draft, JSON.stringify({ updates: [{ index: 0, paragraphs: bodyParagraphs[0] }, { index: 0, paragraphs: bodyParagraphs[0] }] }), [0], { bodyParagraphs }), /식별자/u);
assert.throws(() => applyFreeformDraftRevision(draft, JSON.stringify({ updates: [{ index: 0, paragraphs: bodyParagraphs[0] }] }), [0]), /paragraphs/u);
assert.match(applyFreeformDraftRevision(draft, JSON.stringify({ updates: [{ index: 0, body: "기존 body 응답 호환" }] }), [0]).sections[0], /기존 body 응답 호환/u);

const fixture = normalizePublishedPostText(resolvePostDocument({ connectKind: "SHOPPING", title: "테스트 상품 보관 기준",
  sections: Array.from({ length: 7 }, (_, index) => `${index === 3 ? "65kg 수치 확인" : `섹션 ${index}`}\n\n첫 문단 ${index}의 확인된 상품 설명입니다.\n\n둘째 문단 ${index}의 확인된 보관 조건입니다.\n\n셋째 문단 ${index}의 확인된 구매 기준입니다.`),
  hashtags: ["상품", "보관", "선택"], imagePaths: photoPaths,
  connectUrl: "https://example.test/affiliate" }));
fixture.sections[0].imageSource = "seller-original";
fixture.sections[0].imagePaths = [photoPaths[0]];
// Actual legacy packages have two text blocks per section. Keep an explicit
// boundary so a freely rewrapped body still fails closed while arrays succeed.
const seenParagraphSections = new Set<string>();
fixture.renderNodes = fixture.renderNodes.flatMap(node => {
  if (node.kind !== "paragraph" || !node.sectionId) return [node];
  if (seenParagraphSections.has(node.sectionId)) return [];
  seenParagraphSections.add(node.sectionId);
  return [
    { ...node, text: fixture.sections.find(section => section.id === node.sectionId)!.body.slice(0, 2).join("\n\n") },
    { kind: "divider" as const, sectionId: node.sectionId },
    { ...node, text: fixture.sections.find(section => section.id === node.sectionId)!.body[2] },
  ];
});
const initialSections = readPreparedCompositionSections(fixture);
const measured = getBrandLinkContentReadiness({ productName: "테스트 상품", title: fixture.title, sections: initialSections,
  hashtags: ["상품", "보관", "선택"], brandLink: "https://example.test/affiliate", generationSource: "AI", hasRepresentativeImage: true });
const sourceText = fs.readFileSync("scripts/simple-agent.ts", "utf8");
const source = ts.createSourceFile("simple-agent.ts", sourceText, ts.ScriptTarget.Latest, true);
const actualFunction = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "runPreparedPostRevision");
assert.ok(actualFunction);
const actualFunctionText = actualFunction.getText(source);
const classifier = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "classifyFailureCode");
assert.ok(classifier);
const classifierSandbox: { classify?: (error: unknown) => string; [key: string]: unknown } = {
  codexDraftTerminalFailureCode, getErrorMessage: (error: unknown) => String(error),
};
vm.runInNewContext(ts.transpileModule(`this.classify = ${classifier.getText(source)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, classifierSandbox);
const draftRouteText = fs.readFileSync("src/app/api/brandlinks/[id]/draft/route.ts", "utf8");
const draftRoute = ts.createSourceFile("route.ts", draftRouteText, ts.ScriptTarget.Latest, true);
const readFailure = draftRoute.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "readPrepareFailure");
assert.ok(readFailure);
for (const code of ["DRAFT_REVISION_FORMAT_INVALID", "REVISION_RENDER_SCOPE_AMBIGUOUS"]) {
  const originalMessage = `${code}: 원고와 사진을 보존했습니다.`;
  const classified = classifierSandbox.classify!(new Error(originalMessage));
  assert.equal(classified, code, "the actual result.json classifier preserves the revision cause");
  const routeSandbox: { read?: (log: string, id: string) => { code: string; message: string }; [key: string]: unknown } = {
    readBrandPostPackageResult: () => ({ ok: false, code: classified, message: originalMessage }),
  };
  vm.runInNewContext(ts.transpileModule(`this.read = ${readFailure.getText(draftRoute)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, routeSandbox);
  const localFailure = routeSandbox.read!("unused-log", "fixture");
  assert.deepEqual(JSON.parse(JSON.stringify(localFailure)), { code, message: originalMessage });
  const nativeCode = classifyLocalFailure({ status: 500, code: localFailure.code, message: localFailure.message });
  assert.equal(new LocalAutomationError(nativeCode, localFailure.message).message, originalMessage,
    "the MCP outer fallback may be generic but must retain the exact cause message");
  const observations = normalizeMaterialFailureObservations([{ version: 1, productId: "fixture-product", phase: "writing",
    revision: "1".repeat(64), errorCode: localFailure.code, sectionIds: [], protectedAssetShas: [], attempt: 1, outcome: "failed", at: "2026-10-18T03:00:00.000Z" }]);
  assert.equal(observations[0].errorCode, code, "material failure observations preserve the typed writing cause");
  const reference = formatMaterialFailureReference(observations, { productId: "fixture-product", revision: "1".repeat(64) });
  assert.ok(reference.includes(code), "the exact current revision's cause reaches the next agent's reference");
  assert.match(reference, /문단 수.*블록 경계/u);
  assert.match(reference, /허용된 heading 필드/u);
  assert.match(reference, /원고·사진.*보존/u);
  assert.match(reference, /전체 재작성이나 이미지 요청 재전송을 하지/u);
  assert.equal(formatMaterialFailureReference(observations, { productId: "fixture-product", revision: "2".repeat(64) }), "",
    "an old revision cannot grant instructions or corrective authority to the current agent");
}

async function execute(options: { instructions: string; responses: string[]; qualityConvergence?: boolean; providerError?: Error;
  savedPhoto?: "trusted" | "stale"; rejectPhoto?: boolean; noOriginal?: boolean; spec?: boolean }) {
  const writes: Array<{ composition: typeof fixture; post: { title: string; sections: string[] } }> = [];
  const prompts: Array<Record<string, unknown>> = [];
  const logs: string[] = [];
  let responseIndex = 0, dbWrites = 0;
  const quality = { ...measured, canPublish: !options.qualityConvergence, blockers: [], score: 92 };
  const snapshot = createProductSnapshot({ productId: "fixture", connectKind: "SHOPPING", externalProductId: "test-product",
    sourceUrl: "https://example.test/product", product: { name: "테스트 상품", description: "확인된 상품 설명", features: ["확인된 보관 조건"] } });
  const outputDir = fs.mkdtempSync(path.join(photoRoot, "run-"));
  let photoReviews = 0;
  const selectPhoto = async (files: string[]) => options.rejectPhoto ? null : { path: files[0], sourceSha256: hashFile(files[0]),
    targetIndex: 0, reviewClass: "product-photo" as const, reason: "선택 상품 외형의 검증 원본", reviewedAt: new Date().toISOString() };
  const composition = options.noOriginal ? { ...fixture, sections: fixture.sections.map(section => ({ ...section, imageSource: "none" as const })) } : fixture;
  if (options.savedPhoto) {
    const proofSnapshot = options.savedPhoto === "stale" ? createProductSnapshot({ ...snapshot,
      product: { ...snapshot.product, name: "다른 상품" } }) : snapshot;
    const proof = await withShoppingPrewritePhoto({ snapshot: proofSnapshot, candidatePaths: [photoPaths[0]] }, async value => value,
      { select: async files => ({ ...(await selectPhoto(files))!, path: files[0], sourceSha256: hashFile(files[0]) }) });
    const contextPath = path.join(outputDir, "mcp-draft-context.json"), saved = persistPrewritePhotoForContext(proof, contextPath);
    fs.writeFileSync(contextPath, JSON.stringify({ snapshot: proofSnapshot, snapshotId: proofSnapshot.snapshotId,
      prewritingPhotoProof: saved, publicationPhotoContext: writingPhotosFromPrewrite(saved) }));
  }
  const prepared = { composition, manifest: { fixture: true }, sourceSnapshot: snapshot,
    post: { title: fixture.title, sections: initialSections, hashtags: ["상품", "보관", "선택"] }, heroImagePath: photoPaths[0], bodyImagePaths: photoPaths.slice(1),
    ...(options.spec ? { spec: {}, draft: {} } : {}) };
  const photoInputs: Array<ShoppingPrewritePhotoProof | undefined> = [];
  const sandbox: { run?: (id: string, kind: string, link: unknown, request: string) => Promise<void>; [key: string]: unknown } = {
    process: { env: { BRANDLINK_PREPARE_OUTPUT_DIR: outputDir } }, fs: { ...fs, readFileSync: (file: string, ...args: unknown[]) => file === "fixture-request"
      ? JSON.stringify({ instructions: options.instructions, sectionIndexes: [0, 1, 3], qualityConvergence: Boolean(options.qualityConvergence) })
      : Reflect.apply(fs.readFileSync, fs, [file, ...args]) },
    path, crypto, console: { log: (line: string) => logs.push(line) },
    buildProduct9Canvas, getBrandPostPackageDir: () => outputDir, readSubmittedPrewritePhoto, assertShoppingPrewritePhoto, writingPhotosFromPrewrite,
    withShoppingPrewritePhoto: async (input: Parameters<typeof withShoppingPrewritePhoto>[0], operation: (proof: ShoppingPrewritePhotoProof) => Promise<ShoppingPrewritePhotoProof>) => {
      photoReviews++; return withShoppingPrewritePhoto(input, operation, { select: selectPhoto });
    },
    loadPreparedBrandLinkPostOverride: () => prepared,
    brandPostQualitySourceFromSnapshot: () => ({ productName: "테스트 상품", sourceDescription: "확인된 상품 설명", sourceFeatures: ["확인된 보관 조건"] }),
    preservePreparedRevisionRenderPlan, normalizePublishedPostText, resolvePostDocument, getPostCompositionContract,
    BRANDLINK_QUALITY_PRESET: "PREMIUM", BRANDLINK_EXPERIENCE_MODE: "AI_ASSISTED_INFORMATION", BRANDLINK_REQUIRE_REPRESENTATIVE_IMAGE: true,
    getBrandLinkContentReadiness: () => quality, publishedReadinessSections: (document: typeof fixture) => readPreparedCompositionSections(document),
    stripInternalGuidanceSentences: (text: string) => text, requestsFreeformTitleRevision, requestsFreeformSectionHeadingRevision,
    createWritingPromptContract, formatWritingPromptContract, selectPreparedRevisionSectionIndexes, isPreparedTitleOnlyRepair,
    planQualityConvergence: () => ({ action: "repair-text", targets: [{ key: "fixture-body" }] }), formatQualityConvergenceInstructions: () => "실패 항목만 보완",
    generateWithAI: async (_system: string, prompt: string, _context: unknown, _images: unknown, _schema: unknown, proof?: ShoppingPrewritePhotoProof) => {
      prompts.push(JSON.parse(prompt)); photoInputs.push(proof); if (proof) assertShoppingPrewritePhoto(proof, snapshot);
      if (options.providerError) throw options.providerError; return options.responses[Math.min(responseIndex++, options.responses.length - 1)]; },
    applyFreeformDraftRevision, assertUntargetedSectionHashesUnchanged, shouldAcceptQualityRepair,
    codexDraftTerminalFailureCode, getErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
    isDraftEditorialQualityPassed: () => true, writePreparedBrandPostPackage: (params: typeof writes[number]) => { writes.push(params); return "fixture-manifest"; },
    writePrepareResult: () => undefined, prisma: { brandLink: { update: async () => { dbWrites++; } } },
  };
  vm.runInNewContext(ts.transpileModule(`this.run = ${actualFunctionText};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, sandbox);
  let failure = "";
  try { await sandbox.run!("fixture", "SHOPPING", { url: "https://example.test/affiliate" }, "fixture-request"); }
  catch (error) { failure = String(error); }
  return { writes, prompts, logs, dbWrites, failure, photoReviews, photoInputs };
}

async function main() {
  const heading = await execute({ instructions: "글 제목은 유지하고 3번 소제목만 교정해 주세요. 본문은 유지하세요.", responses: [JSON.stringify({ updates: [{ index: 3, heading: "1.65kg 수치 확인" }] })] });
  assert.equal(heading.failure, "");
  assert.equal(heading.writes.length, 1);
  assert.equal(heading.writes[0].post.title, fixture.title);
  assert.deepEqual(heading.writes[0].composition.sections.map(section => section.body), fixture.sections.map(section => section.body));
  assert.equal(heading.writes[0].composition.sections[3].title, "1.65kg 수치 확인");
  const paragraphResponse = { updates: [0, 1, 3].map(index => ({ index, paragraphs: fixture.sections[index].body.map((body, part) => part < 2 ? body.replace("확인된", "근거로 확인된") : body) })) };
  const paragraphs = await execute({ instructions: "지정한 본문의 문장만 교정하세요. 글 제목과 소제목은 유지하세요.", responses: [JSON.stringify(paragraphResponse)] });
  assert.equal(paragraphs.failure, "");
  assert.equal(paragraphs.writes.length, 1);
  assert.deepEqual(paragraphs.writes[0].composition.renderNodes.filter(node => node.kind !== "paragraph"), fixture.renderNodes.filter(node => node.kind !== "paragraph"));
  const promptSections = paragraphs.prompts[0].sections as Array<{ bodyParagraphs: string[] }>;
  assert.deepEqual(promptSections[0].bodyParagraphs, fixture.sections[0].body);
  assert.equal(paragraphs.photoReviews, 1);
  assert.ok(paragraphs.photoInputs[0], "the actual revision writer receives the exact reviewed original pixels");
  assert.match(String(paragraphs.prompts[0].writingHarness), /VERIFIED_PUBLICATION_ORIGINAL|PLANNED_SCENE/u);
  assert.match(String(paragraphs.prompts[0].writingHarness), /scene-1|scene-2|scene-3/u);
  const savedPlan = paragraphs.prompts[0].savedPhotoPlan as Array<{sectionId: string; imageSource: string; imageIntent: string}>;
  assert.equal(savedPlan.length, fixture.sections.length - 1);
  assert.equal(savedPlan[0].sectionId, fixture.sections[0].id); assert.equal(savedPlan[0].imageSource, "seller-original");
  assert.equal(savedPlan[0].imageIntent, fixture.sections[0].imageIntent);
  const trusted = await execute({ instructions: "지정 문장만 교정", responses: [JSON.stringify(paragraphResponse)], savedPhoto: "trusted", spec: true });
  assert.equal(trusted.failure, ""); assert.equal(trusted.photoReviews, 0, "an intact same-snapshot proof is rebound without another visual call");
  assert.ok(trusted.photoInputs[0]);
  const stale = await execute({ instructions: "지정 문장만 교정", responses: [JSON.stringify(paragraphResponse)], savedPhoto: "stale" });
  assert.equal(stale.failure, ""); assert.equal(stale.photoReviews, 1, "another product's cached proof never authorizes this revision");
  const rejectedPhoto = await execute({ instructions: "지정 문장만 교정", responses: [JSON.stringify(paragraphResponse)], rejectPhoto: true });
  assert.match(rejectedPhoto.failure, /IMAGE_SOURCE_BINDING_REQUIRED/u); assert.equal(rejectedPhoto.prompts.length, 0);
  assert.equal(rejectedPhoto.writes.length + rejectedPhoto.dbWrites, 0);
  const noOriginal = await execute({ instructions: "지정 문장만 교정", responses: [JSON.stringify(paragraphResponse)], noOriginal: true });
  assert.equal(noOriginal.failure, ""); assert.equal(noOriginal.photoReviews, 0); assert.equal(noOriginal.photoInputs[0], undefined);
  assert.match(String(noOriginal.prompts[0].writingHarness), /연결 정보가 없습니다|연결 정보 없음/u);
  assert.match(String(noOriginal.prompts[0].photoRevisionRule), /외형 묘사를 추가·변경하지/u);
  for (const response of ["bad JSON", JSON.stringify({ updates: [{ index: 0, paragraphs: ["문단 수 오류"] }] })]) {
    const failed = await execute({ instructions: "지정 문장만 교정", responses: [response] });
    assert.match(failed.failure, /DRAFT_REVISION_FORMAT_INVALID/u);
    assert.doesNotMatch(failed.failure, /QUALITY_REPAIR_REJECTED/u);
    assert.equal(failed.writes.length + failed.dbWrites, 0);
  }
  const wrapped = fixture.sections[0].body.join("\n\n").replace("첫 문단", "첫\n\n문단");
  const scopeFailure = await execute({ instructions: "지정 문장만 교정", responses: [JSON.stringify({ updates: [{ index: 0, body: wrapped }] })] });
  assert.match(scopeFailure.failure, /REVISION_RENDER_SCOPE_AMBIGUOUS/u);
  assert.doesNotMatch(scopeFailure.failure, /QUALITY_REPAIR_REJECTED/u);
  assert.equal(scopeFailure.writes.length + scopeFailure.dbWrites, 0);
  const qualityFailure = await execute({ instructions: "품질 실패만 보완", qualityConvergence: true,
    responses: ["bad JSON", JSON.stringify({ updates: [{ index: 0, body: fixture.sections[0].body.join("\n\n") }] })] });
  assert.match(qualityFailure.failure, /QUALITY_REPAIR_REJECTED/u, "a later parsed but non-improving candidate must not reuse the old format error");
  assert.doesNotMatch(qualityFailure.failure, /DRAFT_REVISION_FORMAT_INVALID/u);
  assert.equal(qualityFailure.writes.length + qualityFailure.dbWrites, 0);
  const quotaFailure = await execute({ instructions: "품질 실패만 보완", responses: [], qualityConvergence: true,
    providerError: Object.assign(new Error("CODEX_USAGE_LIMIT_REACHED: usage limit reached"), { code: "CODEX_USAGE_LIMIT_REACHED" }) });
  assert.match(quotaFailure.failure, /CODEX_USAGE_LIMIT_REACHED/u);
  assert.doesNotMatch(quotaFailure.failure, /DRAFT_REVISION_FORMAT_INVALID|QUALITY_REPAIR_REJECTED/u);
  assert.equal(quotaFailure.prompts.length, 1, "a terminal provider failure is never retried as an editing failure");
  assert.equal(quotaFailure.writes.length + quotaFailure.dbWrites, 0);
  console.log("PASS: actual manual revision function, separate heading authority, fixed paragraph contracts, exact layout retention, legacy body compatibility and truthful failure causes");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(photoRoot, { recursive: true, force: true }));
