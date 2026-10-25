/** Offline reproduction of the MCP submit/cache race. Actual scheduler + slot
 * projection functions, real source signatures, controlled worker; no provider. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { productSourceAuditContextKey } from "./lib/product-source-audit-context";
import { attachRemoteProductReferenceInputs } from "../src/lib/brand-post-remote-image-inputs";
import { trackScheduledSourceImageRepair, waitForScheduledSourceImageRepair } from "../src/lib/brand-post-source-repair-wait";
import { testPngFixture } from "./lib/test-png-fixture";

const hash = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-source-repair-coordination-"));
const functionSource = (file: string, names: string[], globals: Record<string, unknown>) => {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const nodes = names.map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name));
  assert.ok(nodes.every(Boolean), "exercise the actual route functions");
  const code = ts.transpileModule(nodes.map(node => node!.getText(ast)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const runtime = vm.createContext({ ...globals, Error, console: { log() {}, warn() {}, error() {} }, Buffer });
  vm.runInContext(code + `\nthis.api={${names.join(",")}}`, runtime, { filename:file });
  return runtime.api;
};
function deferred<T>() { let resolve!: (value:T)=>void, reject!: (error:Error)=>void;
  const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
let checks=0;
async function check(name:string, run:()=>Promise<void>) { await run();checks++;console.log(`PASS ${name}`); }
function fixture(name:string, settings:{ timeoutMs?:number; workerErrors?:string[]; sourceOnly?:boolean; lockOnly?:boolean }={}) {
  const id=`source-wait-${name}`, directory=path.join(root,id);fs.mkdirSync(directory);
  const urls=["https://shop-phinf.pstatic.net/first.png","https://shop-phinf.pstatic.net/later.png"];
  const snapshot=createProductSnapshot({productId:id,externalProductId:null,connectKind:"SHOPPING",sourceUrl:"https://example.test/product",
    product:{name:"확인된 선택 상품",features:["색상: 회색"],referenceImageUrls:urls}});
  const add=(index:number)=>{const bytes=testPngFixture(`selected-source-${index}`),file=path.join(directory,`${index}.png`);
    fs.writeFileSync(file,bytes);fs.writeFileSync(`${file}.retrieval.json`,JSON.stringify({version:"product-image-retrieval/v1",
      sourceUrl:urls[index],sha256:hash(bytes),retrievedAt:new Date().toISOString()}));return {file,sha256:hash(bytes)};};
  const primary=add(0), context={selectedSourceSnapshot:snapshot,selectedSourceProductId:id,selectedSourceDirectory:directory,sourceSnapshotId:snapshot.snapshotId};
  const beforePixel=fs.readFileSync(primary.file), signature=()=>productSourceAuditContextKey(context);
  let active=false,collectorCalls=0,workerCalls=0,waitStages=0,finishedActivities=0,workerBefore:string|null=null,workerAfter:string|null=null;
  const completion=deferred<void>();
  const manifest={version:"brand-post-package/v2",brandLinkId:id,connectKind:"SHOPPING",sourceSnapshot:snapshot,title:"상품 선택 기준",
    imageGeneration:{status:"incomplete",ownerToken:`owner-${name}`,errors:[] as string[]},
    composition:{sections:[{id:"section",title:"상품 외형",body:["확인된 외형을 살펴봅니다."],imageIntent:"자연 사진",imageSource:"staged-ai"}]}};
  const preview={connectKind:"SHOPPING",imageCount:1,markdown:"existing body",readiness:{stage:"before-source"},
    imageGeneration:{status:"running"},imageSlots:[{sectionId:"section",title:"상품 외형",intent:"자연 사진",maximum:1,missing:1,generationMissing:1}]};
  const worker=()=>{workerCalls++;active=true;manifest.imageGeneration.status="running";workerBefore=signature();
    return completion.promise.then(()=>{workerAfter=signature();assert.equal(workerAfter,workerBefore,"selected source pool must not change during the full source audit");
      manifest.imageGeneration.status="incomplete";manifest.imageGeneration.errors=settings.workerErrors||["section: IMAGE_GENERATION_REQUIRED: staged photo remains"];
      return {manifest,errors:manifest.imageGeneration.errors};}).finally(()=>{active=false;});};
  const scheduler=functionSource("src/app/api/brandlinks/[id]/draft/route.ts",["scheduleSectionImageRepair"],{
    readBrandPostPackage:()=>manifest,packagePreview:()=>preview,isAutoSectionImagesEnabled:()=>true,isChatGptBrowserAutomationEnabled:()=>false,
    isBrandPostImageRepairActive:()=>active,beginDesktopActivity:()=>()=>{finishedActivities++;},
    repairBrandPostImages:worker,trackScheduledSourceImageRepair,
  }).scheduleSectionImageRepair;
  const remote=functionSource("src/app/api/remote-agent/poll/route.ts",["numberField","safeImageSlots","draftView"],{
    waitForScheduledSourceImageRepair:(productId:string,options:Parameters<typeof waitForScheduledSourceImageRepair>[1])=>
      waitForScheduledSourceImageRepair(productId,{...options,timeoutMs:settings.timeoutMs??1000}),
    isBrandPostImageRepairActive:()=>active||settings.lockOnly===true,readDraftManifestSafe:()=>manifest,
    packagePreview:()=>({...preview,imageCount:2,imageGeneration:{...manifest.imageGeneration},readiness:{stage:"after-source"}}),
    buildBrandPostImagePrompt:()=>"one natural photograph",allowsShoppingReferenceScene:()=>true,resolveBrandPostImageTarget:()=>({}),
    attachRemoteProductReferenceInputs,prepareBrandPostImageReferenceContext:async()=>{collectorCalls++;add(1);
      return {referenceImagePaths:[primary.file],referenceHashes:[primary.sha256],prompt:"one natural photograph"};},
    uploadRemoteImageAsset:async()=>"https://example.test/reference.png",createHash:crypto.createHash,fs,stripPaths:(value:unknown)=>value,
  });
  const jobContext={cancelled:false,setStage:(stage:string,message:string)=>{assert.equal(stage,"draft-source");assert.match(message,/원본 배정/u);waitStages++;}};
  return {id,manifest,preview,primary,completion,context,signature,add,beforePixel,jobContext,
    schedule:()=>scheduler({brandLinkId:id,productName:"선택 상품",sourceOnly:settings.sourceOnly!==false,skip:false}),
    slots:()=>remote.safeImageSlots(preview,manifest,undefined,jobContext),
    view:()=>remote.draftView(id,preview,true,manifest,jobContext),
    get active(){return active;},get collectorCalls(){return collectorCalls;},get workerCalls(){return workerCalls;},
    get waitStages(){return waitStages;},get finishedActivities(){return finishedActivities;},get workerBefore(){return workerBefore;},get workerAfter(){return workerAfter;},
  };
}
async function main() {
  await check("old concurrent gallery collection changes the exact canonical source signature",async()=>{
    const f=fixture("old-race");const before=f.signature();f.add(1);assert.notEqual(f.signature(),before);
    assert.deepEqual(fs.readFileSync(f.primary.file),f.beforePixel,"existing source bytes need not change for the old race");
  });
  await check("actual scheduler promise is joined before actual slot reference collection",async()=>{
    const f=fixture("joined");assert.equal(f.schedule().scheduled,true);const pending=f.slots();
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.collectorCalls,0);assert.equal(f.waitStages,1);assert.equal(f.workerCalls,1);
    f.completion.resolve();const result=await pending;assert.equal(f.workerAfter,f.workerBefore);assert.equal(f.collectorCalls,1);assert.equal(result[0].referenceReady,true);
    await Promise.resolve();assert.equal(f.finishedActivities,1);assert.deepEqual(fs.readFileSync(f.primary.file),f.beforePixel);
  });
  await check("the same fresh projection supplies returned slots, image counts and saved generation state",async()=>{
    const f=fixture("fresh-view");f.schedule();const pending=f.view();f.completion.resolve();const view=await pending;
    assert.equal(view.imageCount,2);assert.equal(view.imageGeneration.status,"incomplete");assert.equal(view.readiness.stage,"after-source");
    assert.equal(view.imageSlots[0].referenceReady,true);assert.equal(view.markdown,"existing body");assert.equal(f.collectorCalls,1);
  });
  await check("a definitive source failure cannot silently start a fresh reference model",async()=>{
    const f=fixture("failed",{workerErrors:["SOURCE_PROPOSAL_AUDIT_FAILED: IMAGE_CHANGED"]});f.schedule();const pending=f.slots();f.completion.resolve();
    const result=await pending;assert.equal(f.collectorCalls,0);assert.equal(result[0].referenceReady,false);assert.equal(result[0].referencePreparationPending,true);
  });
  await check("worker exception and stopped completion both retain reference-pending state",async()=>{
    for(const kind of ["exception","stopped"]){const f=fixture(kind,{workerErrors:["사용자가 이미지 생성을 중지했습니다."]});f.schedule();const pending=f.slots();
      if(kind==="exception")f.completion.reject(new Error("worker crashed"));else f.completion.resolve();
      const result=await pending;assert.equal(result[0].referenceReady,false);assert.equal(f.collectorCalls,0);}
  });
  await check("bounded timeout leaves the original worker active and never queues a second",async()=>{
    const f=fixture("timeout",{timeoutMs:10});f.schedule();const result=await f.slots();assert.equal(result[0].referenceReady,false);
    assert.equal(f.active,true);assert.equal(f.workerCalls,1);assert.equal(f.collectorCalls,0);f.completion.resolve();await new Promise(resolve=>setTimeout(resolve,0));
  });
  await check("lock-only or stale-running unknown owners cannot invoke a collector",async()=>{
    for(const lockOnly of [true,false]){const f=fixture(`unknown-${lockOnly}`,{lockOnly});f.manifest.imageGeneration.status="running";
      const result=await f.slots();assert.equal(result[0].referenceReady,false);assert.equal(f.collectorCalls,0);assert.equal(f.workerCalls,0);}
  });
  await check("current persisted quota, transient and browser-auth failures block collection after registry loss",async()=>{
    for(const code of ["CODEX_USAGE_LIMIT_REACHED","CODEX_TRANSIENT_FAILURE","CHATGPT_BROWSER_AUTH_REQUIRED"]){
      const f=fixture(`restart-${code}`);f.manifest.imageGeneration.errors=[`${code}: current worker did not finish`];
      const result=await f.slots();assert.equal(result[0].referenceReady,false);assert.equal(f.collectorCalls,0);assert.equal(f.workerCalls,0);
    }
  });
  await check("a completed worker with missing saved state cannot authorize reference collection",async()=>{
    const done=deferred<{errors:string[];manifest:{imageGeneration?:{ownerToken?:string}}}>();
    const operation=trackScheduledSourceImageRepair("source-wait-missing-state",()=>done.promise,()=>undefined);
    const waiting=waitForScheduledSourceImageRepair("source-wait-missing-state",{isActive:()=>false,readState:()=>null,timeoutMs:1000});
    done.resolve({errors:[],manifest:{}});await operation;assert.equal((await waiting).ready,false);
  });
  await check("cancelled MCP waits preserve the worker and do not collect references",async()=>{
    const f=fixture("cancelled");f.schedule();const pending=f.slots();f.jobContext.cancelled=true;
    const result=await pending;assert.equal(result[0].referenceReady,false);assert.equal(f.collectorCalls,0);assert.equal(f.active,true);
    f.completion.resolve();await new Promise(resolve=>setTimeout(resolve,0));
  });
  await check("a later explicit owner's completed repair is not poisoned by an old failure",async()=>{
    const f=fixture("new-owner",{workerErrors:["SOURCE_REVIEW_INCOMPLETE"]});f.schedule();f.completion.resolve();await new Promise(resolve=>setTimeout(resolve,0));
    f.manifest.imageGeneration={status:"complete",ownerToken:"later-explicit-owner",errors:[]};
    const result=await f.slots();assert.equal(result[0].referenceReady,true);assert.equal(f.collectorCalls,1);
  });
  await check("idle products and travel slots keep their immediate existing behavior",async()=>{
    const f=fixture("idle");f.manifest.imageGeneration.status="complete";
    Object.assign(f.manifest,{pipelineNotes:["CODEX_USAGE_LIMIT_REACHED: historical prior job"]});
    const result=await f.slots();assert.equal(result[0].referenceReady,true);assert.equal(f.waitStages,0);assert.equal(f.workerCalls,0);
    const travel=fixture("travel");travel.manifest.connectKind="TRAVEL";const slots=await travel.slots();assert.equal(travel.collectorCalls,0);assert.equal(travel.waitStages,0);assert.equal(slots.length,1);
  });
  console.log(`PASS ${checks} offline MCP source-repair coordination cases; no provider, API, publication or live data.`);
}
main().finally(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});}).catch(error=>{console.error(error);process.exitCode=1;});
