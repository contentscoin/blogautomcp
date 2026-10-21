/** Offline API regression: no account, database, browser, generation or publication is used. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import http from "node:http";
import { runMaterialPreparation, localScheduleCall, type Call, type Result } from "./lib/scheduled-draft-workflow";
import { sourceReviewFailureForSlot } from "./lib/product-source-audit-context";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { findProductSectionReviewConflicts } from "./lib/product-section-review-conflicts";
import type { BrandPostImageGenerationResult } from "../src/lib/brand-post-image-generation";

async function scenario(action: string, legacy = true, travel = false, repairResult?: { errors: string[]; appliedCount: number }, expectedStatus = 200) {
  let migrations = 0;
  let generations = 0;
  let wholePlans = 0;
  let sourceOnly: boolean | undefined;
  const phases: string[] = [];
  let manifest = { version: "brand-post-package/v2", connectKind: travel ? "TRAVEL" : "SHOPPING", title: "상품",
    composition: { strategyVersion: legacy ? "shopping-post-strategy/v1" : "shopping-post-strategy/v2" } };
  const preview = { imageSlots: [{ sectionId: "scene", maximum: 1, count: 0, missing: 1, generationMissing: 1, assets: [], staleTargets: [] }],
    imageAssets: [{ assetKey: "a".repeat(64) }] };
  const loaded = { exports: {} };
  const dependencies: Record<string, unknown> = {
    "node:fs": fs, "node:path": path, "node:crypto": crypto,
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) => ({ body, status: options?.status || 200 }) } },
    "@/lib/db": { prisma: { brandLink: {
      findUnique: async () => ({ productName: "상품", imageUrls: "[]", status: "READY", updatedAt: new Date() }),
      updateMany: async () => ({ count: 1 }),
    } } },
    "@/lib/api-auth": { requireAdminApiKey: () => null },
    "@/lib/update-guard": { requireNoPendingDesktopUpdate: () => null },
    "@/lib/desktop-activity": { beginDesktopActivity: () => () => {} },
    "@/lib/brand-post-package": {
      readBrandPostPackage: () => manifest, packagePreview: () => preview,
      getBrandPostImageGenerationState: () => undefined, normalizePackageImageAssets: () => [],
      getBrandPostPackageDir: () => "C:/fixture",
    },
    "@/lib/brand-post-natural-photo-migration": {
      requiresShoppingNaturalPhotoPlan: (value: typeof manifest) => value.connectKind === "SHOPPING" && value.composition.strategyVersion !== "shopping-post-strategy/v2",
      migrateShoppingNaturalPhotoPlan: () => { migrations++; phases.push("migrate"); manifest = { ...manifest, composition: { strategyVersion: "shopping-post-strategy/v2" } }; return { manifest, changed: true }; },
    },
    "@/lib/brand-post-image-generation": { applyExternalGeneratedBrandPostImage: () => { throw new Error("targeted legacy apply must stop before generation"); } },
    "@/lib/brand-post-image-replan": { replanShoppingImageCoverage: () => { throw new Error("legacy replan must request explicit full preparation"); } },
    "@/lib/brand-post-rejected-original-repair": { planRejectedOriginalRepair: () => { throw new Error("original-only recovery is covered by its isolated contract suite"); } },
    "@/lib/brand-post-retained-scene": { restoreRetainedBrandPostScene: () => { throw new Error("retained-scene restoration is covered by its isolated contract suite"); } },
    "@/lib/brand-post-confirmed-print-repair": { planConfirmedPrintRepairs: () => { throw new Error("confirmed-print subsets are covered by their isolated contract suite"); } },
    "@/lib/brand-post-image-repair": {
      isBrandPostImageRepairActive: () => false,
      planSectionImageRequests: () => [{ requestId: "scene", sectionId: "scene" }],
      planWholeBrandPostImageRequests: () => { wholePlans++; phases.push("plan"); return [{ requestId: "hero", replaceAssetKey: "a".repeat(64) }, { requestId: "scene", sectionId: "scene" }]; },
      repairBrandPostImages: async (options: { sourceOnly?: boolean }) => { generations++; sourceOnly = options.sourceOnly; phases.push("repair"); return { errors: [], generatedCount: 0, appliedCount: 0, ...repairResult, manifest }; },
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/app/api/brandlinks/[id]/draft/images/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { module: loaded, exports: loaded.exports, console, process, Buffer, Date, Error,
    require: (name: string) => { assert(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; } });
  const api = loaded.exports as { POST: (request: unknown, context: unknown) => Promise<{ status: number;
    body: Result & { appliedCount?: number; generatedCount?: number } }> };
  const response = await api.POST({ json: async () => ({ action, sectionId: "scene", assetKey: "a".repeat(64), generatedPath: "C:/fixture/generated.png" }) }, { params: Promise.resolve({ id: "fixture-product" }) });
  if (legacy && !travel && !["generate_missing", "bind_sources"].includes(action)) {
    assert.equal(response.status, 409);
    assert.equal(response.body.code, "NATURAL_IMAGE_PLAN_REQUIRED");
    assert.equal(migrations, 0);
    assert.equal(generations, 0);
    assert.equal(wholePlans, 0);
  } else {
    assert.equal(response.status, expectedStatus);
    assert.equal(migrations, legacy && !travel ? 1 : 0);
    assert.equal(generations, 1);
    assert.equal(wholePlans, 1);
    assert.equal(sourceOnly, action === "bind_sources");
    assert.deepEqual(phases, migrations ? ["migrate", "plan", "repair"] : ["plan", "repair"]);
  }
  return response;
}

async function main() {
  for (const action of ["generate_section", "regenerate", "apply_generated", "repair_rejected", "replan_sources"]) await scenario(action);
  for (const action of ["generate_missing", "bind_sources"]) {
    await scenario(action);
    await scenario(action, false);
    await scenario(action, true, true);
  }
  const previousRoot = process.env.DESKTOP_USER_DATA;
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "source-route-workflow-"));
  process.env.DESKTOP_USER_DATA = fixtureRoot;
  try {
    for (const outcome of ["recovered", "auth", "incomplete", "unknown-output", "unknown-code", "output-rejected"] as const) {
      const errors = ["scene: IMAGE_GENERATION_REQUIRED: Staged AI slot still needs its own generated photograph.",
        ...(outcome === "auth" ? ["CODEX_AUTH_REQUIRED: Login is required."]
          : outcome === "incomplete" ? ["SOURCE_REVIEW_INCOMPLETE: Final source verdict is missing."]
            : outcome === "unknown-output" ? ["OUTCOME_UNKNOWN: Prior image outcome is unresolved."]
              : outcome === "unknown-code" ? ["UNRECOGNIZED_IMAGE_FAILURE: Unsupported image failure."]
                : outcome === "output-rejected" ? ["IMAGE_OUTPUT_REJECTED: The same completed thumbnail pixels were previously rejected."] : [])];
      // Actual route serialization/classification, with an offline repair result:
      // one original placed, AI slots intentionally untouched by bind_sources.
      const response = await scenario("bind_sources", false, false, { errors, appliedCount: 1 });
      assert.equal(response.body.code, outcome === "auth" ? "CODEX_AUTH_REQUIRED" : outcome === "incomplete"
        ? "SOURCE_REVIEW_INCOMPLETE" : outcome === "output-rejected" ? "IMAGE_OUTPUT_REJECTED" : "IMAGE_GENERATION_REQUIRED");
      assert.equal(response.body.appliedCount, 1); assert.equal(response.body.generatedCount, 0);
      const actions: string[] = [];
      let rejected = outcome !== "recovered", originalBound = false, repaired = false, approved = false;
      let approvalCalls = 0;
      const call: Call = async (url, method, body) => {
        const action = (body as { action?: string } | undefined)?.action || method;
        actions.push(action);
        if (url.endsWith("/images")) {
          if (action === "bind_sources") { originalBound = true; return response.body; }
          assert.equal(action, "repair_rejected"); repaired = true;
          return { success: true, errors: [], appliedCount: 2, remainingMissing: 0 };
        }
        if (action === "approve") {
          approvalCalls++;
          if (approvalCalls === 1) { rejected = true; throw Object.assign(new Error("final pixel rejection"), {
            code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: ["SEMANTIC_REJECTION: selected option needs a matching original and replacement scene"],
          }); }
          approved = true;
        }
        return { success: true, data: { connectKind: "SHOPPING", approvedAt: approved ? "approved" : null,
          approval: { canApprove: approved, blockers: [] }, imageGeneration: { status: "complete" },
          composition: { sections: [{ id: "original", imageSource: "seller-original" }, { id: "scene", imageSource: "staged-ai" }] },
          imageSlots: [{ sectionId: "original", missing: rejected && !originalBound ? 1 : 0, generationMissing: 0 },
            { sectionId: "scene", missing: rejected && !repaired ? 2 : 0, generationMissing: rejected && !repaired ? 2 : 0 }],
          contentQuality: { signals: [] } } };
      };
      const operation = runMaterialPreparation(`route-source-${outcome}`, { call, pause: async () => {} });
      if (outcome === "recovered") await operation;
      else await assert.rejects(operation, (error: unknown) => (error as { code?: string }).code === (
        outcome === "auth" ? "CODEX_AUTH_REQUIRED" : outcome === "incomplete" ? "SOURCE_REVIEW_INCOMPLETE"
          : outcome === "unknown-output" ? "OUTCOME_UNKNOWN" : outcome === "output-rejected" ? "IMAGE_OUTPUT_REJECTED" : "UNRECOGNIZED_IMAGE_FAILURE"));
      assert.equal(actions.filter(action => action === "bind_sources").length, 1);
      assert.equal(actions.filter(action => action === "repair_rejected").length, outcome === "recovered" ? 1 : 0,
        "only the known remaining AI requirement authorizes the bounded next repair");
      assert.equal(approvalCalls, outcome === "recovered" ? 2 : 0);
      assert.equal(approved, outcome === "recovered");
      assert(!actions.some(action => ["prepare_context", "generate_missing", "regenerate", "replan_sources", "revise"].includes(action)),
        "source-only continuation never grants a generic retry, source refresh or whole manuscript rewrite");
    }
    const candidate = path.join(fixtureRoot, "seller-original.png"); fs.writeFileSync(candidate, "intact fixture source bytes");
    const candidateSha = crypto.createHash("sha256").update(fs.readFileSync(candidate)).digest("hex");
    const snapshot = createProductSnapshot({ productId: "source-conflict-fixture", connectKind: "SHOPPING", externalProductId: "sku",
      sourceUrl: "https://brand.naver.com/fixture/products/1", product: { name: "상품", features: ["선택 옵션"], referenceImageUrls: [] } });
    const source = fs.readFileSync("src/lib/brand-post-image-generation.ts", "utf8");
    const ast = ts.createSourceFile("brand-post-image-generation.ts", source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "generateBrandPostImages");
    assert(declaration, "exercise the actual source-generation orchestration, including its catch and failed-slot mapping");
    const rejectedDeclaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "rejectedThumbnailOutputError");
    assert(rejectedDeclaration);
    const holdDeclaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "assertImageRegenerationNotHeld");
    assert(holdDeclaration, "standalone AST harness must retain the actual pre-dispatch preservation guard");
    const heroTarget = { request: { requestId: "hero", slotId: "hero:image:1" }, role: "hero", sectionTitle: "Thumbnail", imageIntent: "natural product overview" };
    let transports = 0;
    const outputContext = vm.createContext({ exports: {}, fs, path,
      resolveBrandPostImageSlots: (_manifest: unknown, requests: unknown[]) => requests, resolveTarget: () => heroTarget,
      getBrandPostPackageDir: () => fixtureRoot, resolveBrandPostImageBatchWorkDir: () => fixtureRoot,
      prepareImageBatchJobsIsolated: () => { const failure=outputContext.rejectOutput(); return { jobs:[],targetIndexes:[],errors:[{targetIndex:0,error:failure.message,errorCode:failure.code}] }; },
      runImageBatch: async (jobs: unknown[]) => { transports += jobs.length; assert.equal(jobs.length,0); },
    });
    vm.runInContext(ts.transpileModule(holdDeclaration.getText(ast) + "\n" + rejectedDeclaration.getText(ast) + "\n" + declaration.getText(ast), { compilerOptions: {
      module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText.replace(/^exports\.generateBrandPostImages = generateBrandPostImages;$/mu, "") +
      "\nthis.rejectOutput = rejectedThumbnailOutputError; this.generate = generateBrandPostImages;",outputContext);
    const outputResults = await outputContext.generate({manifest:{brandLinkId:"fixture-product",connectKind:"TRAVEL",title:"상품",composition:{sections:[],renderNodes:[]}},
      productName:"상품",requests:[heroTarget.request]}) as BrandPostImageGenerationResult[];
    assert.equal(outputResults[0].errorCode,"IMAGE_OUTPUT_REJECTED");assert.equal(outputResults[0].generatedPath,null);assert.equal(transports,0);
    const repairSource=fs.readFileSync("src/lib/brand-post-image-repair.ts","utf8"),repairAst=ts.createSourceFile("repair.ts",repairSource,ts.ScriptTarget.Latest,true);
    const repairDeclaration=repairAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="repairBrandPostImages");assert(repairDeclaration);
    let stored={version:"brand-post-package/v2",brandLinkId:"fixture-product",connectKind:"SHOPPING",title:"상품",composition:{sections:[],renderNodes:[]},imageGeneration:undefined as unknown};
    let applies=0;
    const repairContext=vm.createContext({exports:{},activeJobs:new Set(),controllers:new Map(),AbortController,process,setInterval,clearInterval,
      acquireBrandPostImageRepairLock:()=>({ownerToken:"offline-owner",assertOwner(){},heartbeat(){},release(){}}),
      packagePreview:()=>({imageSlots:[]})});
    vm.runInContext(ts.transpileModule(repairDeclaration.getText(repairAst),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
      .replace(/^exports\.repairBrandPostImages = repairBrandPostImages;$/mu,"")+"\nthis.repair=repairBrandPostImages;",repairContext);
    const repaired=await repairContext.repair({brandLinkId:"fixture-product",requests:[heroTarget.request]},
      {read:()=>stored,write:(value:typeof stored)=>{stored=value;},apply:()=>{applies++;throw new Error("a rejected cached output must never attach");},
        generate:async (options:{onResult:(result:BrandPostImageGenerationResult)=>Promise<void>})=>{for(const result of outputResults)await options.onResult(result);return outputResults;}});
    assert.equal(applies,0);assert.equal(repaired.appliedCount,0);assert.match(repaired.errors[0],/IMAGE_OUTPUT_REJECTED:/u);
    const outputResponse=await scenario("generate_missing",false,false,{errors:repaired.errors,appliedCount:0},422);
    assert.equal(outputResponse.body.code,"IMAGE_OUTPUT_REJECTED");assert.equal(outputResponse.body.success,false);
    const previousOutputPort=process.env.APP_PORT,outputServer=http.createServer((_request,reply)=>{reply.writeHead(outputResponse.status,{"content-type":"application/json"});reply.end(JSON.stringify(outputResponse.body));});
    await new Promise<void>(resolve=>outputServer.listen(0,"127.0.0.1",resolve));process.env.APP_PORT=String((outputServer.address() as {port:number}).port);
    try{await assert.rejects(localScheduleCall("/api/brandlinks/fixture/draft/images","POST",{action:"regenerate"}),
      (error:unknown)=>(error as {code?:string;httpStatus?:number}).code==="IMAGE_OUTPUT_REJECTED"&&(error as {httpStatus?:number}).httpStatus===422);}
    finally{if(previousOutputPort===undefined)delete process.env.APP_PORT;else process.env.APP_PORT=previousOutputPort;await new Promise<void>(resolve=>outputServer.close(()=>resolve()));}
    for(const finalRecovery of [false,true]){
      const actions:string[]=[];let rejected=false,approvalCalls=0;
      const call:Call=async(url,method,body)=>{const action=(body as {action?:string}|undefined)?.action||method;actions.push(action);
        if(url.endsWith("/images"))return {success:true,code:"IMAGE_OUTPUT_REJECTED",errors:[],remainingMissing:0};
        if(action==="approve"){approvalCalls++;rejected=true;throw Object.assign(new Error("exact final audit failed"),{code:"PUBLISH_IMAGE_AUDIT_FAILED",errors:["SEMANTIC_REJECTION: unresolved thumbnail verdict"]});}
        return {success:true,data:{connectKind:"SHOPPING",approvedAt:null,imageGeneration:{status:"complete"},imageAssets:[{assetKey:"b".repeat(64),role:"hero"}],
          approval:{canApprove:false,blockers:rejected?[{code:"image-publication-rejected",reason:"대표 이미지 검수 실패"}]:[]},composition:{sections:[]},
          imageSlots:finalRecovery?[]:[{sectionId:"scene",missing:1,generationMissing:1}],contentQuality:{signals:[]}}};};
      await assert.rejects(runMaterialPreparation(`cached-output-${finalRecovery}`,{call,pause:async()=>{}}),
        (error:unknown)=>finalRecovery?(error as {code?:string;causeCode?:string}).code==="PUBLISH_IMAGE_AUDIT_FAILED"&&(error as {causeCode?:string}).causeCode==="IMAGE_OUTPUT_REJECTED"
          :(error as {code?:string}).code==="IMAGE_OUTPUT_REJECTED");
      assert.equal(approvalCalls,finalRecovery?1:0);assert.equal(actions.filter(action=>action==="regenerate").length,finalRecovery?1:0);
      assert(!actions.some(action=>["prepare_context","replan_sources","revise"].includes(action)),"typed rejection never grants source refresh, rewriting, or another generation");
    }
    const conflictingPair = findProductSectionReviewConflicts({ assignments: [{ targetIndex: 1, selectedIndex: 1, reviewClass: "product-photo", reason: "positive" }],
      notSelected: [{ targetIndex: 1, selectedIndex: 1, reason: "identity unresolved" }] }, { targetCount: 1, candidateCount: 1, allowedPairs: new Set(["0:0"]) });
    assert.equal(conflictingPair.size, 1);
    for (const mode of ["typed-error", "unfilled-conflict"] as const) {
      const target = { request: { requestId: "original", sectionId: "original" }, sectionId: "original", role: "body",
        sectionTitle: "상품 외형", imageIntent: "판매자 원본 상품 외형", imageSource: "seller-original", bodyExcerpt: "확인된 상품 정보" };
      const context = vm.createContext({ exports: {}, fs, path, sourceReviewFailureForSlot,
        resolveBrandPostImageSlots: (_manifest: unknown, requests: unknown[]) => requests, resolveTarget: () => target,
        normalizePackageImageAssets: () => [], getUsedShoppingProductSources: () => [], readProductPhotoSource: () => null,
        getBrandPostPackageDir: () => fixtureRoot, readSavedProductSourceCandidates: () => [candidate],
        collectShoppingProductSourceCandidates: async (input: { localCandidates: string[] }) => input.localCandidates,
        sha256File: () => candidateSha, allowsShoppingReferenceScene: () => false, isShoppingLifestyleImage: () => false,
        allowsGenericBrandPostProductPhoto: () => true, allowsOriginalShoppingScene: () => false, rejectedPublicationImageHashes: () => [],
        buildSelectedProductImageAuditContext: () => "selected exact facts", atomicWriteTextFile: () => {},
        selectVerifiedProductSectionImages: async (_paths: string[], _name: string, _targets: unknown[], options: {
          selectedSourceSnapshot: unknown; selectedSourceProductId: string; selectedSourceDirectory: string; sourceSnapshotId: string;
          onDiagnostics: (report: unknown) => void }) => {
          assert.equal(options.selectedSourceSnapshot, snapshot); assert.equal(options.selectedSourceProductId, snapshot.productId);
          assert.equal(options.selectedSourceDirectory, path.join(fixtureRoot, "product-sources")); assert.equal(options.sourceSnapshotId, snapshot.snapshotId);
          if (mode === "typed-error") throw Object.assign(new Error("server-detected pair conflict"), { code: "SOURCE_REVIEW_CONFLICT" });
          options.onDiagnostics({ version: 1, status: "incomplete", cacheHit: false, errorCode: "SOURCE_REVIEW_CONFLICT",
            error: "SOURCE_REVIEW_CONFLICT: the completed response has one unresolved pair", entries: [{ targetIndex: 0,
              path: candidate, sourceSha256: candidateSha, status: "review-failed", suitability: "unreviewed", failureCode: "SOURCE_REVIEW_CONFLICT" }] });
          return [];
        },
      });
      vm.runInContext(ts.transpileModule(holdDeclaration.getText(ast) + "\n" + declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^exports\.generateBrandPostImages = generateBrandPostImages;$/mu, "") +
        "\nthis.generate = generateBrandPostImages;", context);
      const generated = await context.generate({ sourceOnly: true, manifest: { brandLinkId: snapshot.productId, connectKind: "SHOPPING",
        title: "상품", sourceSnapshot: snapshot, imageAssets: [], composition: { sections: [], renderNodes: [] } },
        productName: "상품", requests: [target.request] }) as BrandPostImageGenerationResult[];
      assert.equal(generated.length, 1); assert.equal(generated[0].generatedPath, null);
      assert.equal(generated[0].errorCode, "SOURCE_REVIEW_CONFLICT"); assert.match(generated[0].error!, /^SOURCE_REVIEW_CONFLICT:/u);
      const errors = generated.map(result => `${result.sectionId}: ${result.error}`);
      const response = await scenario("bind_sources", false, false, { errors, appliedCount: 0 }, 422);
      assert.equal(response.body.code, "SOURCE_REVIEW_CONFLICT"); assert.equal(response.status, 422);
      const previousPort = process.env.APP_PORT;
      const server = http.createServer((_request, reply) => {
        reply.writeHead(response.status, { "content-type": "application/json" }); reply.end(JSON.stringify(response.body));
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      process.env.APP_PORT = String((server.address() as { port: number }).port);
      try { await assert.rejects(localScheduleCall("/api/brandlinks/fixture/draft/images", "POST", { action: "bind_sources" }),
        (error: unknown) => (error as { code?: string; httpStatus?: number }).code === "SOURCE_REVIEW_CONFLICT" &&
          (error as { httpStatus?: number }).httpStatus === 422); }
      finally { if (previousPort === undefined) delete process.env.APP_PORT; else process.env.APP_PORT = previousPort;
        await new Promise<void>(resolve => server.close(() => resolve())); }
    }
    assert.equal(sourceReviewFailureForSlot(new Error("plain conflicting description")).errorCode, undefined,
      "the source code is never inferred from untyped model prose");
  } finally {
    if (previousRoot === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previousRoot;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  console.log("PASS natural photo image actions: explicit whole-plan migration, targeted 409 without generation, source-only binding, current plan and travel compatibility");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
