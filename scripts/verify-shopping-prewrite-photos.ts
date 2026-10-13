/** Offline causal regressions for actual STEP2 orchestration. No browser, provider or image generation is started. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { classifyLocalFailure, extractLocalApiError, toLocalAutomationError } from "../src/lib/local-automation-error";
import { createWritingPromptContract, getWritingOutputExample } from "./lib/writing-prompt-contract";
import { hasSufficientProductReviewEvidence } from "./lib/product-editorial-plan";
import { assertShoppingPrewritePhoto, persistPrewritePhotoForContext, readSubmittedPrewritePhoto, selectShoppingPrewriteOriginal, withShoppingPrewritePhoto, writingPhotosFromPrewrite,
  type ShoppingPrewritePhotoProof } from "./lib/shopping-prewrite-photos";
import { codexWritingImageRoles, resolveCodexWritingImages, runCodexDraft, codexDraftTerminalFailureCode } from "./lib/codex-draft-provider";
import { SHOPPING_NATURAL_SCENE_ROLES } from "./lib/shopping-scene-roles";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blogautomcp-prewrite-"));
  const file = path.join(root, "seller-original.png"), bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(2048, 8)]);
  const hash = (value: string) => crypto.createHash("sha256").update(fs.readFileSync(value)).digest("hex");
  fs.writeFileSync(file, bytes);
  const snapshot = () => createProductSnapshot({ productId: "oa-fixture", connectKind: "SHOPPING", externalProductId: "selected-model",
    sourceUrl: "https://seller.example/selected-product", product: { name: "오아 듀얼미스트 가습기", description: "분리형 물통을 적용한 충전식 가습기",
      features: ["물통 용량: 200ml", "정격 소비전력: 5W", "충전 단자: USB-C", "선택 옵션: 화이트", "분리형 물통 구조"], referenceImageUrls: ["https://seller.example/source.png"] } });
  const accepted = async (paths: string[], _name: string, selected: string) => {
    assert.match(selected, /selectedTitle/u); assert.match(selected, /confirmedOptionLabel/u);
    return paths[0] ? { path: paths[0], sourceSha256: hash(paths[0]), reviewClass: "product-photo" as const,
      reviewedAt: new Date().toISOString(), reason: "하나의 흰색 가습기 외형이 보이고 추가 설명판이 없습니다.", targetIndex: 0 } : null;
  };
  try {
    let writes = 0, crops = 0;
    const operation = async (proof: ShoppingPrewritePhotoProof) => { writes++; assertShoppingPrewritePhoto(proof); return proof; };
    await assert.rejects(() => withShoppingPrewritePhoto({ snapshot: snapshot(), candidatePaths: [file] }, operation, {
      select: async () => null, recoverSourcePixels: async () => { crops++; return null; },
    }), /IMAGE_SOURCE_BINDING_REQUIRED/);
    assert.equal(writes, 0); assert.equal(crops, 1);

    // Exercise the production selector's diagnostic handling. Missing verdicts
    // remain distinct from a complete negative review and cannot buy another
    // source crop, writer call or scene generation.
    for (const status of ["incomplete", "failed"] as const) {
      let unknownCrops = 0;
      await assert.rejects(() => withShoppingPrewritePhoto({ snapshot: snapshot(), candidatePaths: [file] }, operation, {
        select: (paths, name, selected) => selectShoppingPrewriteOriginal(paths, name, selected, async (_paths, _name, _targets, options) => {
          options?.onDiagnostics?.({ version: 1, status, cacheHit: false, reviewedAt: new Date().toISOString(),
            candidateCount: 1, targetCount: 1, entries: [{ targetIndex: 0, path: file, sourceSha256: hash(file),
              status: "not-proposed", suitability: "unreviewed", reason: "missing verdict", reviewedAt: new Date().toISOString() }] });
          return [];
        }),
        recoverSourcePixels: async () => { unknownCrops++; return null; },
      }), (error: unknown) => (error as { code?: string }).code === "SOURCE_REVIEW_INCOMPLETE");
      assert.equal(unknownCrops, 0); assert.equal(writes, 0);
    }
    assert.equal(await selectShoppingPrewriteOriginal([file], "fixture", "selected", async (_paths, _name, _targets, options) => {
      options?.onDiagnostics?.({ version: 1, status: "complete", cacheHit: false, reviewedAt: new Date().toISOString(),
        candidateCount: 1, targetCount: 1, entries: [] }); return [];
    }), null, "a complete negative review remains source shortfall, not an unknown outcome");
    for (const failure of [
      { error: new Error("상품 섹션 이미지 검사 응답을 해석할 수 없습니다."), expected: "SOURCE_REVIEW_INCOMPLETE" },
      { error: Object.assign(new Error("sign in"), { code: "CODEX_AUTH_REQUIRED" }), expected: "CODEX_AUTH_REQUIRED" },
      { error: new Error("SOURCE_PROPOSAL_AUDIT_FAILED: IMAGE_CHANGED: changed bytes"), expected: "PREWRITING_PHOTO_CHANGED" },
    ]) {
      await assert.rejects(() => selectShoppingPrewriteOriginal([file], "fixture", "selected", async (_paths, _name, _targets, options) => {
        options?.onDiagnostics?.({ version: 1, status: "failed", cacheHit: false, reviewedAt: new Date().toISOString(),
          candidateCount: 1, targetCount: 1, entries: [], error: failure.error.message });
        throw failure.error;
      }), (error: unknown) => (error as { code?: string }).code === failure.expected);
    }

    const proof = await withShoppingPrewritePhoto({ snapshot: snapshot(), candidatePaths: [file] }, operation, { select: accepted });
    const context = writingPhotosFromPrewrite(proof);
    assert.equal(writes, 1); assert.equal(context.verifiedOriginal.sha256, hash(file));
    assert.equal(context.verifiedOriginal.inclusionScope, "selected-product-exterior");
    assert.equal(context.plannedScenes?.length, 3);
    assert.deepEqual(context.plannedScenes, SHOPPING_NATURAL_SCENE_ROLES.map(scene => ({ role: scene.role, intent: scene.purpose })),
      "the writer and image generator use the same three distinct camera coverage roles");
    if (process.platform === "win32") {
      const lowerProof = { ...proof, original: { ...proof.original, path: proof.original.path.toLowerCase() } };
      assertShoppingPrewritePhoto(lowerProof);
      assert.deepEqual(resolveCodexWritingImages({ imagePaths: [proof.original.path],
        publicationPhotoInput: { path: lowerProof.original.path, sha256: proof.original.sha256 } }), [lowerProof.original.path],
      "Windows path casing is equivalent, but it does not duplicate the same original as source-reading artwork");
    }

    const sourceChanged = createProductSnapshot({ ...snapshot(), sourceUrl: "https://seller.example/other-option", product: snapshot().product });
    assert.throws(() => assertShoppingPrewritePhoto(proof, sourceChanged), /PREWRITING_PHOTO_CHANGED/);
    const optionChanged = snapshot(); optionChanged.product.features = ["선택 옵션: 블랙"];
    assert.throws(() => assertShoppingPrewritePhoto(proof, optionChanged), /PREWRITING_SOURCE_CHANGED/);
    const sourceBytesChanged = snapshot(); sourceBytesChanged.product.price = "9,900원";
    assert.throws(() => assertShoppingPrewritePhoto(proof, sourceBytesChanged), /PREWRITING_SOURCE_CHANGED/,
      "full snapshot product payload is validated even when the caller retains the old metadata ID");
    await assert.rejects(() => withShoppingPrewritePhoto({ snapshot: snapshot(), candidatePaths: [file] }, operation, { select: async paths => {
      const before = hash(paths[0]); fs.appendFileSync(paths[0], "changed during review");
      return { path: paths[0], sourceSha256: before, reviewClass: "product-photo", reviewedAt: "now", reason: "accepted", targetIndex: 0 };
    } }), /PREWRITING_PHOTO_CHANGED/);
    fs.writeFileSync(file, bytes);
    const foreign = path.join(root, "unreviewed-foreign.png"); fs.writeFileSync(foreign, bytes);
    await assert.rejects(() => withShoppingPrewritePhoto({ snapshot: snapshot(), candidatePaths: [file] }, operation, { select: async () => ({
      path: foreign, sourceSha256: hash(foreign), reviewClass: "product-photo", reviewedAt: "now", reason: "unknown", targetIndex: 0,
    }) }), /PREWRITING_PHOTO_CHANGED/);

    const recovered = path.join(root, "verified-region.png"); fs.writeFileSync(recovered, Buffer.concat([bytes, Buffer.from("source crop")]));
    let selections = 0;
    const croppedProof = await withShoppingPrewritePhoto({ snapshot: snapshot(), candidatePaths: [file] }, operation, {
      select: async (paths, name, selected) => { selections++; return selections === 1 ? null : accepted(paths, name, selected); },
      recoverSourcePixels: async () => recovered,
    });
    assert.equal(selections, 2); assert.equal(croppedProof.original.path, recovered);
    const persist = persistPrewritePhotoForContext(croppedProof, path.join(root, "context", "mcp-draft-context.json"));
    fs.unlinkSync(recovered); assertShoppingPrewritePhoto(persist);
    assert.equal(persist.original.sha256, croppedProof.original.sha256, "context keeps exact source pixels after temporary collector cleanup");

    const details = Array.from({ length: 5 }, (_, index) => {
      const detail = path.join(root, `detail_${index}.png`); fs.writeFileSync(detail, Buffer.concat([bytes, Buffer.from(String(index))])); return detail;
    });
    const inputs = { imagePaths: details, maxImages: 4, publicationPhotoInput: { path: persist.original.path, sha256: persist.original.sha256 } };
    const images = resolveCodexWritingImages(inputs);
    assert.equal(images.length, 4); assert.equal(images[0], persist.original.path, "detail-first ordering cannot evict the verified opening original");
    assert.match(codexWritingImageRoles(images, inputs.publicationPhotoInput), /첨부 1: 작성 전 검사/u);
    assert.match(codexWritingImageRoles(images, inputs.publicationPhotoInput), /첨부 2: 판매자 상세 근거 읽기용/u);
    assert.deepEqual(resolveCodexWritingImages({ ...inputs, maxImages: 1 }), [persist.original.path]);
    fs.appendFileSync(persist.original.path, "changed after context");
    await assert.rejects(() => runCodexDraft({ systemPrompt: "unused", userPrompt: "unused", ...inputs }), /PREWRITING_PHOTO_CHANGED/,
      "changed source fails before importing/creating the provider");

    // Execute the actual production wrapper/classifier extracted from simple-agent, with only external operations replaced.
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/simple-agent.ts"), "utf8");
    const ast = ts.createSourceFile("simple-agent.ts", source, ts.ScriptTarget.Latest, true);
    const declarations = ["sanitizeProductForWriting", "writingSourceSnapshot", "step2_generatePost", "classifyFailureCode"].map(name => {
      const node = ast.statements.find((entry): entry is ts.FunctionDeclaration => ts.isFunctionDeclaration(entry) && entry.name?.text === name);
      assert.ok(node, `${name} production function exists`); return node.getText(ast);
    });
    let writerCalls = 0, contextExports = 0, mode: "missing" | "valid" | "wrong-option" = "missing", contextOnly = false;
    let canonicalSelected = "";
    let lastPreparedProduct: Record<string, unknown> | undefined;
    const runtime = vm.createContext({ console, createProductSnapshot, hasSufficientProductReviewEvidence,
      isolateSellerEvidenceText: (text: string) => text, sanitizeSellerEvidenceFeatures: (facts: string[]) => facts,
      sanitizeTravelPageResearch: (value: unknown) => value, preserveSellerDetailSourceUrls: (urls: string[]) => urls,
      toProductSourceEvidenceInput: (product: { name: string; description: string; features: string[] }) => ({ productName: product.name, description: product.description, features: product.features }),
      reportDraftProgress: () => {}, BRANDLINK_DRAFT_CONTEXT_OUTPUT: "", TEMP_PATH: root, publishImageCleanup: { track: () => {} },
      recoverProductPhotoRegion: async () => null,
      selectShoppingPrewriteOriginal: async (paths: string[], name: string, selected: string) => {
        canonicalSelected = selected; return mode === "valid" ? accepted(paths, name, selected) : null;
      },
      withShoppingPrewritePhoto, persistPrewritePhotoForContext, writingPhotosFromPrewrite, assertShoppingPrewritePhoto,
      step2_generatePostAfterPreflight: async (product: { prewritingPhotoProof?: ShoppingPrewritePhotoProof }) => {
        lastPreparedProduct = product as Record<string, unknown>;
        assertShoppingPrewritePhoto(product.prewritingPhotoProof!);
        if (contextOnly) contextExports++; else writerCalls++;
        return { title: "fixture" };
      }, codexDraftTerminalFailureCode, getErrorMessage: (error: unknown) => String(error),
    });
    vm.runInContext(ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText +
      "\nthis.prepare = step2_generatePost; this.classify = classifyFailureCode;", runtime);
    const prepare = runtime.prepare as (product: Record<string, unknown>, url: string, id: string, kind: string,
      spec?: { submittedPrewritingPhotoProof: ShoppingPrewritePhotoProof; imageCandidates?: unknown[] }, identity?: { externalProductId?: string | null; sourceUrl?: string | null }) => Promise<unknown>;
    const product = () => ({ ...snapshot().product, price: "", originalPrice: "", discountRate: "", couponInfo: "", deliveryInfo: "",
      rating: "", reviewCount: "", storeName: null, representativeImagePath: file, imagePaths: [file], detailImagePaths: [],
      sourceImageUrls: ["https://seller.example/source.png"], finalUrl: "https://seller.example/selected-product" });
    for (const failedMode of ["missing", "wrong-option"] as const) {
      mode = failedMode;
      await assert.rejects(() => prepare(product(), "https://seller.example/selected-product", "oa-fixture", "SHOPPING"), /IMAGE_SOURCE_BINDING_REQUIRED/);
      assert.equal(writerCalls, 0); assert.equal(contextExports, 0);
    }
    await assert.rejects(() => prepare({ ...product(), description: "", features: [] }, "https://seller.example/selected-product", "oa-fixture", "SHOPPING"), /SOURCE_EVIDENCE_REQUIRED/);
    assert.equal(writerCalls, 0);
    mode = "valid"; await prepare(product(), "https://seller.example/selected-product", "oa-fixture", "SHOPPING");
    assert.equal(writerCalls, 1); assert.match(canonicalSelected, /validatedSellerFeatures/u);
    contextOnly = true; runtime.BRANDLINK_DRAFT_CONTEXT_OUTPUT = path.join(root, "export", "mcp-draft-context.json");
    mode = "missing";
    await assert.rejects(() => prepare(product(), "https://seller.example/selected-product", "oa-fixture", "SHOPPING"), /IMAGE_SOURCE_BINDING_REQUIRED/);
    assert.equal(contextExports, 0, "prepare_context also cannot export a ready-looking unavailable original");
    mode = "valid"; await prepare(product(), "https://seller.example/selected-product", "oa-fixture", "SHOPPING");
    assert.equal(contextExports, 1); assert.equal(writerCalls, 1);
    // Run the real context-export branch, rather than reconstructing a similar JSON fixture.
    const postPreflight = ast.statements.find((entry): entry is ts.FunctionDeclaration => ts.isFunctionDeclaration(entry) && entry.name?.text === "step2_generatePostAfterPreflight");
    assert.ok(postPreflight?.body);
    const contextBranch = postPreflight.body.statements.find((entry): entry is ts.IfStatement => ts.isIfStatement(entry) && entry.expression.getText(ast) === "BRANDLINK_DRAFT_CONTEXT_OUTPUT");
    assert.ok(contextBranch);
    const contract = createWritingPromptContract({ kind: "SHOPPING", product: lastPreparedProduct as { name: string; description: string; features: string[] },
      minimumSections: 5, maximumSections: 8, targetCharacters: { min: 1200, max: 2800 }, hashtagCount: 5,
      publicationPhotoContext: lastPreparedProduct!.publicationPhotoContext as ReturnType<typeof writingPhotosFromPrewrite>,
    });
    Object.assign(runtime, { fs, path, Buffer, preserveSellerDetailSourceUrls: (urls: string[]) => urls,
      BRANDLINK_QUALITY_PRESET: "balanced", BRANDLINK_EXPERIENCE_MODE: "NONE", BRANDLINK_EXPERIENCE_NOTES: "",
      minimumBodySectionCount: 5, maximumBodySectionCount: 8, compositionContract: { targetCharacters: { min: 1200, max: 2800 } },
      writingContract: contract, getWritingOutputExample, systemPrompt: "fixture system", userPrompt: "fixture user",
      qualityEvidenceAnchors: [], minimumEvidenceAnchorCount: 2, minimumEvidenceLinkedJudgements: 2,
      isTravel: false, travelEditorialPlan: [], productEditorialPlan: null, openCrabSeoBrief: null, productUnderstanding: null,
      formatDraftSubmissionNextAction: () => "submit the fixed snapshot", assertShoppingPrewritePhoto,
    });
    vm.runInContext(ts.transpileModule(`function exportActualContext(product, productId, connectKind, productIdentity, brandLink) { ${contextBranch.getText(ast)} }\nthis.exportActualContext = exportActualContext;`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, runtime);
    runtime.exportActualContext(lastPreparedProduct, "oa-fixture", "SHOPPING", { externalProductId: null, sourceUrl: "https://seller.example/selected-product" }, "https://seller.example/selected-product");
    const exported = JSON.parse(fs.readFileSync(String(runtime.BRANDLINK_DRAFT_CONTEXT_OUTPUT), "utf8"));
    assert.equal(exported.snapshotId, (lastPreparedProduct!.prewritingPhotoProof as ShoppingPrewritePhotoProof).snapshot.snapshotId);
    assert.equal(exported.snapshot.snapshotId, exported.snapshotId);
    assert.equal(exported.generation.writingContract.publicationPhotoContext.verifiedOriginal.snapshotId, exported.snapshotId);
    assert.equal(exported.publicationPhotoAvailability.attachmentRequiredForExternalWriter, true);
    assert.equal(exported.publicationPhotoAvailability.listingUrlIsNotPhotoUrl, true);
    assert.equal(hash(exported.publicationPhotoContext.verifiedOriginal.path), exported.publicationPhotoContext.verifiedOriginal.sha256);
    const submittedProof = readSubmittedPrewritePhoto(String(runtime.BRANDLINK_DRAFT_CONTEXT_OUTPUT), exported.snapshot);
    assert.ok(submittedProof);
    const exportedFile = String(runtime.BRANDLINK_DRAFT_CONTEXT_OUTPUT);
    if (process.platform === "win32") {
      const aliasContext = JSON.parse(JSON.stringify(exported)); aliasContext.publicationPhotoContext.verifiedOriginal.path = submittedProof.original.path.toLowerCase();
      fs.writeFileSync(exportedFile, JSON.stringify(aliasContext));
      assert.ok(readSubmittedPrewritePhoto(exportedFile.toLowerCase(), exported.snapshot));
    }
    const corruptContext = JSON.parse(JSON.stringify(exported)); corruptContext.snapshot.product.referenceImageUrls.push("https://seller.example/unrelated.png");
    fs.writeFileSync(exportedFile, JSON.stringify(corruptContext));
    assert.throws(() => readSubmittedPrewritePhoto(exportedFile, exported.snapshot), /PREWRITING_SOURCE_CHANGED/);
    fs.writeFileSync(exportedFile, JSON.stringify({ ...exported, prewritingPhotoProof: undefined }));
    assert.throws(() => readSubmittedPrewritePhoto(exportedFile, exported.snapshot), /PREWRITING_PHOTO_CHANGED/);
    fs.writeFileSync(exportedFile, JSON.stringify(exported));
    mode = "wrong-option"; contextOnly = false; runtime.BRANDLINK_DRAFT_CONTEXT_OUTPUT = "";
    const submittedSpec = { submittedPrewritingPhotoProof: submittedProof, imageCandidates: [{ path: details[0], kind: "hero", score: 9999 }] };
    await prepare({ ...product(), detailImagePaths: ["different local cache count"] }, "https://seller.example/selected-product", "oa-fixture", "SHOPPING", submittedSpec);
    assert.equal(writerCalls, 2, "MCP submission keeps the exact context original and source snapshot without selecting a different gallery photo");
    assert.deepEqual(JSON.parse(JSON.stringify(submittedSpec.imageCandidates)), [{ path: submittedProof.original.path, kind: "source", score: 1000 }],
      "assembly candidates use the same known original, never the raw seller explanation panel previously marked hero");
    const submittedChangedProduct = { ...product(), features: ["선택 옵션: 블랙", "정격 소비전력: 50W", "분리형 물통 구조"] };
    await assert.rejects(() => prepare(submittedChangedProduct, "https://seller.example/selected-product", "oa-fixture", "SHOPPING",
      { submittedPrewritingPhotoProof: submittedProof }), /PREWRITING_PHOTO_CHANGED/);
    fs.appendFileSync(submittedProof.original.path, "changed before submission");
    assert.throws(() => readSubmittedPrewritePhoto(path.join(root, "export", "mcp-draft-context.json"), exported.snapshot), /PREWRITING_PHOTO_CHANGED/);
    assert.equal(runtime.classify(Object.assign(new Error("new original missing"), { code: "IMAGE_SOURCE_BINDING_REQUIRED" })), "IMAGE_SOURCE_BINDING_REQUIRED");
    assert.equal(runtime.classify(new Error("outer", { cause: new Error("PREWRITING_PHOTO_CHANGED: changed") })), "PREWRITING_PHOTO_CHANGED");
    for (const code of ["SOURCE_EVIDENCE_REQUIRED", "SOURCE_REVIEW_INCOMPLETE", "IMAGE_SOURCE_BINDING_REQUIRED", "PREWRITING_PHOTO_CHANGED", "PREWRITING_SOURCE_CHANGED"] as const) {
      const message = `[STEP1 상품 확인] ${code}: 실제 상품 입력을 다시 확인하세요.`;
      for (const status of [400, 500]) assert.equal(classifyLocalFailure({ message, status }), code,
        "context preparation without result.json retains the real upstream cause from its log");
      assert.equal(toLocalAutomationError({ code, message }).code, code);
      assert.deepEqual(extractLocalApiError({ code, error: message }), { code, message });
      assert.deepEqual(extractLocalApiError({ error: { code, message } }), { code, message });
    }
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("PASS prewriting: actual STEP2 source/original/option guard before writer/context, SHA/snapshot drift, native source crop, persistent exact context photo and actual attachment roles");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
