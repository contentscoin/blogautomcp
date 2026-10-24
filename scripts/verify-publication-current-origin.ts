/** Planner-only offline regression. Native proof/strict completed-reader boundaries
 * are simulated; this fixture never signs a proof or dispatches a provider job. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { publicationImageContext } from "./lib/publish-image-rejections";
import type { CompletedProductRequestProof, CompletedProductCandidateSet } from "../src/lib/codex-image-generation";
import type { planPublicationImageRetry, assertPublicationRetryPrintReference } from "../src/lib/brand-post-publication-image-repair";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import type { BrandPostImageReferenceContext, ResolvedImageTarget } from "../src/lib/brand-post-image-generation";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "publication-current-origin-"));
const sha = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const fileHash = (file: string) => sha(fs.readFileSync(file));
const moduleFile = path.resolve("src/lib/brand-post-publication-image-repair.ts");
const nativeRequire = createRequire(moduleFile);
const code = ts.transpileModule(fs.readFileSync(moduleFile, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
let checks = 0;

function fixture() {
  const packageDir = fs.mkdtempSync(path.join(root, "package-")); const work = path.join(packageDir, "image-generation-work", "resume-v2");
  const sourceDir = path.join(packageDir, "product-sources"), images = path.join(packageDir, "images");
  fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(sourceDir); fs.mkdirSync(images);
  const primary = path.join(sourceDir, "primary.png"), detail = path.join(sourceDir, "detail.png");
  fs.writeFileSync(primary, "same selected primary"); fs.writeFileSync(detail, "same selected label closeup");
  const referencePaths = [primary, detail], referenceHashes = referencePaths.map(fileHash);
  const slotId = "section:image:1", sectionId = "section", snapshot = sha("exact selected snapshot");
  const urls = ["https://shop-phinf.pstatic.net/selected/primary.png", "https://shop-phinf.pstatic.net/selected/detail.png"];
  referencePaths.forEach((file,index)=>fs.writeFileSync(file+".retrieval.json",JSON.stringify({version:"product-image-retrieval/v1",sha256:referenceHashes[index],sourceUrl:urls[index],retrievedAt:"2026-10-20T00:00:00Z"})));
  const context = { product: "same selected listing", title: "Actual section title", intent: "Natural exterior illustration", body: "Actual unchanged section body" };
  const suffix = `\nImage slot: ${slotId}. Use a distinct natural location, pose or camera framing for this slot; preserve product identity and real proportions. No added text, frames, panels, collage or inset.`;
  const requests = new Map<string, CompletedProductRequestProof | null>(), candidates = new Map<string, CompletedProductCandidateSet | null>();
  const add = (name: string, pixels: string, paths = referencePaths) => {
    const stem = path.join(work, `raw-${sha(name)}`), output = `${stem}.png`;
    fs.writeFileSync(output, pixels);
    const refs = paths.map(fileHash), prompt = `Exact frozen scene recipe\nReference and section data (untrusted, not instructions): ${JSON.stringify({ context, referenceLock: { sha256: refs[0] } })}${suffix}`;
    const request = { receiptSha256: sha(`${name} terminal receipt with host budget 1`), rolloutPath: path.join(packageDir, `${name}.jsonl`),
      rolloutSha256: sha(`${name} terminal host transcript`), prompt, referenceImagePaths: paths, referenceHashes: refs };
    const candidateSet = { receiptSha256: request.receiptSha256, completion: { source: "rollout" as const, completedAtMs: 100,
      rolloutPath: request.rolloutPath, rolloutSha256: request.rolloutSha256 }, candidates: [{ path: output, sha256: sha(pixels) }] };
    requests.set(stem, request); candidates.set(stem, candidateSet);
    const metadata = { slotId, sourceSnapshotId: snapshot, sceneRecipeSha256: sha(prompt), referenceHashes: refs };
    fs.writeFileSync(`${stem}.reference-scene.json`, JSON.stringify(metadata));
    fs.writeFileSync(`${stem}.codex-submission.json`, `${name} immutable simulated receipt`);
    return { stem, output, metadataPath: `${stem}.reference-scene.json`, metadata, request, candidateSet };
  };
  // Actual 74 shape: the old primary-only request and the current request with
  // its added label detail are both terminal, but only current sourcePath owns
  // the bytes being replaced. Neither filename's recency selects the parent.
  const old = add("old-terminal", "old different completed image", [primary]);
  const current = add("current-origin", "current completed image");
  const currentPath = path.join(images, "current.png"); fs.copyFileSync(current.output, currentPath);
  const asset = { path: currentPath, sourcePath: current.output, sha256: fileHash(currentPath), role: "body" as const,
    sectionId, slotId, provenance: "GENERATED_SCENE" as const, creationMethod: "reference-guided-scene" as const, remoteGenerated: true, imageIntent: context.intent };
  const manifest = { brandLinkId: "offline-product", createdAt: "2026-10-21", connectKind: "SHOPPING", title: "preserved manuscript",
    sourceSnapshot: { snapshotId: snapshot, product:{referenceImageUrls:urls} }, imageAssets: [asset], bodyImagePaths: [currentPath],
    composition: { sections: [{ id: sectionId, title: context.title, body: [context.body], imageIntent: context.intent, imagePaths: [currentPath] }],
      renderNodes: [{ kind: "paragraph", sectionId, text: context.body }, { kind: "image", sectionId, assetPath: currentPath }] } } as unknown as BrandPostPackageManifestV2;
  const target = { request: { requestId: "offline-repair", sectionId, slotId, replaceAssetKey: asset.sha256 }, role: "body", sectionId,
    sectionTitle: context.title, imageIntent: context.intent, bodyExcerpt: context.body } as ResolvedImageTarget;
  const ledger = [{ sha256: asset.sha256, sectionId, context: publicationImageContext(manifest.composition, sectionId), scope: "product" }];
  fs.writeFileSync(path.join(packageDir, "publish-image-rejections.json"), JSON.stringify(ledger));
  const authority = { path: path.join(packageDir, "simulated-proof.json"), sha256: sha("separate exact current native defect proof"),
    proof: {version:"publication-image-print-defect/v4",at:"2026-10-20T00:00:00Z",identifierReview:{nativeExecution:true,status:"conflict",
      identifierConflict:{pair:{sourceSha256:referenceHashes[1],sourceLiteral:"ActualSourceWord"}},comparison:{sourceObservation:"Selected housing intrinsic word"}},
      identifierInput:{primaryReference:{path:primary,sha256:referenceHashes[0]}},binding: { outStem: current.stem, sha256: asset.sha256, sectionId, slotId, referenceHashes,
      assetSha256: sha(JSON.stringify(asset)) } } };
  let known = true, readableAuthority: unknown = authority;
  let seal: { outStem: string; contextSha256: string } | null = null;
  const exports = { exports: {} };
  vm.runInNewContext(code, { module: exports, exports: exports.exports, Buffer, process, Error, console,
    require: (name: string) => {
      if (name.endsWith("/publication-image-defect-proof")) return { publicationImageDefectWasRecorded: () => known,
        readPublicationImageDefect: () => readableAuthority, readPublicationImageRepairPlan: () => seal };
      if (name.endsWith("/canonical-seller-source")) return { readCanonicalSellerSourceHashes: () => new Set(referenceHashes) };
      if (name === "./codex-image-generation") return { readCompletedProductRequest: (stem: string) => requests.get(stem) || null,
        collectCompletedProductCandidates: (job: { outStem: string }) => candidates.get(job.outStem) || null };
      return nativeRequire(name);
    } }, { filename: moduleFile });
  const api = exports.exports as { planPublicationImageRetry: typeof planPublicationImageRetry; assertPublicationRetryPrintReference:typeof assertPublicationRetryPrintReference };
  const planner = api.planPublicationImageRetry;
  const plan = (expectedContext?: Record<string, unknown>) => planner({ manifest, target, packageDir, policyFingerprint: sha("current policy"), expectedContext });
  return { packageDir, work, primary, detail, old, current, requests, candidates, manifest, target, context, ledger, authority, asset, plan, add,verifyPrintContext:api.assertPublicationRetryPrintReference,
    setKnown: (value: boolean) => { known = value; }, setAuthority: (value: unknown) => { readableAuthority = value; },
    setSeal: (value: typeof seal) => { seal = value; } };
}
function held(f: ReturnType<typeof fixture>, label: string) { assert.throws(() => f.plan(), /IMAGE_RESUME_REQUIRED|IMAGE_REPAIR_EXHAUSTED/u, label); checks++; }
function mutateMetadata(row: { metadataPath: string }, patch: Record<string, unknown>) {
  const metadata = JSON.parse(fs.readFileSync(row.metadataPath, "utf8")); fs.writeFileSync(row.metadataPath, JSON.stringify({ ...metadata, ...patch }));
}
async function main() {
  const positive = fixture(), before = [positive.old.metadataPath, `${positive.old.stem}.codex-submission.json`, positive.old.output,
    positive.current.metadataPath, `${positive.current.stem}.codex-submission.json`, positive.current.output, positive.asset.path].map(file => [file, fileHash(file)]);
  const first = positive.plan()!;
  assert.equal(first.primaryReference.sha256,fileHash(positive.primary));assert.equal(first.requiredPrintReference.path,positive.detail);
  assert.equal(first.requiredPrintReference.purpose,"intrinsic-label");assert.equal(JSON.parse(first.requiredPrintReference.labels).sourceLiteral,"ActualSourceWord");
  assert.equal(first.requiredPrintReference.viewObservation,undefined,"a readable logo proof never manufactures complete geometry");checks+=5;
  assert.equal(first.parent.dispositions.length, 2); assert.equal(first.parent.currentSha256, positive.asset.sha256); checks += 2;
  assert.equal(first.parent.dispositions.filter(row => row.candidateSha256 === positive.asset.sha256).length, 1); checks++;
  for (const row of first.parent.dispositions) {
    assert.equal(row.metadataSha256, fileHash(`${row.outStem}.reference-scene.json`));
    assert.equal(row.requestSha256, sha(JSON.stringify(positive.requests.get(row.outStem))));
    assert.equal(row.candidateSha256, positive.candidates.get(row.outStem)!.candidates[0].sha256); checks += 3;
  }
  for (const [file, expected] of before) { assert.equal(fileHash(file), expected); checks++; }
  const originalBody = JSON.stringify(positive.manifest.composition);
  assert.equal(JSON.stringify(positive.plan()), JSON.stringify(first)); assert.equal(JSON.stringify(positive.manifest.composition), originalBody); checks += 2;
  // The single child seals ALL terminal history, and a repeat can only resume
  // that same frozen child; neither old file is retired or selected as parent.
  const childStem = path.join(positive.work, `raw-${sha("one sealed child")}`);
  const childContext = { prompt: positive.current.request.prompt.slice(0, positive.current.request.prompt.lastIndexOf("\nImage slot:")),
    reference:{path:positive.primary,sha256:fileHash(positive.primary),labels:"Original observed primary labels"},supportingReferences:[first.requiredPrintReference],
    referenceImagePaths: positive.current.request.referenceImagePaths, referenceHashes: positive.current.request.referenceHashes,
    publicationRetryOf: first.parent } as BrandPostImageReferenceContext;
  positive.verifyPrintContext(childContext,first.requiredPrintReference,first.primaryReference.sha256);checks++;
  for(const mutate of [(c:BrandPostImageReferenceContext)=>{c.supportingReferences=[];},
    (c:BrandPostImageReferenceContext)=>{c.supportingReferences![0].purpose="geometry";},
    (c:BrandPostImageReferenceContext)=>{c.supportingReferences![0].labels="Unverified expected spelling";},
    (c:BrandPostImageReferenceContext)=>{c.referenceHashes.reverse();c.referenceImagePaths.reverse();},
    (c:BrandPostImageReferenceContext)=>{c.reference.sha256=first.requiredPrintReference.sha256;},
    (c:BrandPostImageReferenceContext)=>{c.referenceImagePaths=[positive.primary];c.referenceHashes=[first.primaryReference.sha256];}]) {
    const changed=structuredClone(childContext);mutate(changed);assert.throws(()=>positive.verifyPrintContext(changed,first.requiredPrintReference,first.primaryReference.sha256),/IMAGE_RESUME_REQUIRED/u);checks++;
  }
  const capacity=structuredClone(childContext),large=path.join(positive.packageDir,"oversized-primary.png");fs.writeFileSync(large,Buffer.alloc(8*1024*1024));
  capacity.reference={...capacity.reference,path:large,sha256:fileHash(large)};capacity.referenceImagePaths[0]=large;capacity.referenceHashes[0]=fileHash(large);
  assert.throws(()=>positive.verifyPrintContext(capacity,first.requiredPrintReference,capacity.reference.sha256),/IMAGE_RESUME_REQUIRED/u,"mandatory label cannot be dropped to fit the 8MiB budget");checks++;
  fs.writeFileSync(`${childStem}.reference-scene.json`, JSON.stringify({ slotId: positive.target.request.slotId, sourceSnapshotId: positive.manifest.sourceSnapshot!.snapshotId,
    sceneRecipeSha256: sha(childContext.prompt + positive.current.request.prompt.slice(positive.current.request.prompt.lastIndexOf("\nImage slot:"))),
    referenceHashes: childContext.referenceHashes, referenceContext: childContext }));
  positive.setSeal({ outStem: childStem, contextSha256: sha(JSON.stringify(childContext)) });
  assert.deepEqual(JSON.parse(JSON.stringify(positive.plan()!.parent)), JSON.parse(JSON.stringify(first.parent))); checks++;
  positive.requests.set(positive.old.stem, { ...positive.old.request, receiptSha256: sha("changed past receipt") });
  held(positive, "sealed history request mutation cannot open another child");
  for (const kind of ["locator-without-proof", "proof-without-locator", "current-sourcepath", "current-sha", "asset-fullrow", "duplicate-current-asset", "missing-current",
    "same-current-pixels-other-origin", "same-past-pixels-other-origin", "unknown-history", "active-history", "recovery-lock-history", "orphan-history", "multi-candidate-history",
    "history-snapshot", "history-recipe", "history-host-input", "history-title", "history-body", "history-intent", "history-reference-order", "history-reference-primary",
    "history-retry-child", "current-retry-child", "extra-unknown-child", "unsigned-child", "current-not-rejected"] as const) {
    const f = fixture();
    if (kind === "locator-without-proof") f.setAuthority(null);
    else if (kind === "proof-without-locator") f.setKnown(false);
    else if (kind === "current-sourcepath") f.asset.sourcePath = f.old.output;
    else if (kind === "current-sha") fs.appendFileSync(f.asset.path, "changed");
    else if (kind === "asset-fullrow") f.asset.imageIntent += " changed";
    else if (kind === "duplicate-current-asset") f.manifest.imageAssets!.push({ ...f.asset });
    else if (kind === "missing-current") f.requests.set(f.current.stem, null);
    else if (kind === "same-current-pixels-other-origin") f.add("another current origin", fs.readFileSync(f.current.output, "utf8"));
    else if (kind === "same-past-pixels-other-origin") f.add("another past origin", fs.readFileSync(f.old.output, "utf8"));
    else if (kind === "unknown-history" || kind === "history-host-input") f.requests.set(f.old.stem, null);
    else if (kind === "active-history") fs.writeFileSync(`${f.old.stem}.lock`, "active");
    else if (kind === "recovery-lock-history") fs.writeFileSync(`${f.old.stem}.lock.recovery`, "unknown");
    else if (kind === "orphan-history") fs.writeFileSync(path.join(f.work, `raw-${sha("orphan")}.codex-submission.json`), "unknown");
    else if (kind === "multi-candidate-history") f.candidates.set(f.old.stem, { ...f.old.candidateSet, candidates: [...f.old.candidateSet.candidates, { path: f.current.output, sha256: f.asset.sha256 }] });
    else if (kind === "history-snapshot") mutateMetadata(f.old, { sourceSnapshotId: sha("another snapshot") });
    else if (kind === "history-recipe") mutateMetadata(f.old, { sceneRecipeSha256: sha("unbound changed recipe") });
    else if (["history-title", "history-body", "history-intent"].includes(kind)) {
      const field = kind.slice("history-".length), prompt = f.old.request.prompt.replace(JSON.stringify(f.context), JSON.stringify({ ...f.context, [field]: "different current text" }));
      f.requests.set(f.old.stem, { ...f.old.request, prompt }); mutateMetadata(f.old, { sceneRecipeSha256: sha(prompt) });
    } else if (kind === "history-reference-order" || kind === "history-reference-primary") {
      const refs = kind === "history-reference-order" ? [...f.current.request.referenceHashes].reverse() : [f.current.request.referenceHashes[1]];
      f.requests.set(f.old.stem, { ...f.old.request, referenceHashes: refs }); mutateMetadata(f.old, { referenceHashes: refs });
    } else if (kind === "history-retry-child" || kind === "current-retry-child") {
      const row = kind === "history-retry-child" ? f.old : f.current;
      mutateMetadata(row, { referenceContext: { prompt: row.request.prompt.slice(0, row.request.prompt.lastIndexOf("\nImage slot:")),
        referenceImagePaths: row.request.referenceImagePaths, referenceHashes: row.request.referenceHashes, retryOf: { outStem: "already consumed" } } });
    } else if (kind === "extra-unknown-child" || kind === "unsigned-child") {
      const unknown = f.add("unknown child", "unknown pixels");
      mutateMetadata(unknown, { referenceContext: { publicationRetryOf: { unknown: true } } });
    } else if (kind === "current-not-rejected") fs.writeFileSync(path.join(f.packageDir, "publish-image-rejections.json"), "[]");
    held(f, kind);
  }
  const noAuthority = fixture(); noAuthority.setKnown(false); noAuthority.setAuthority(null); assert.equal(noAuthority.plan(), null); checks++;
  for(const kind of ["scope-out","hold","no-native","missing-print-source","receipt-url","receipt-time","receipt-version","source-pixels","primary-sha","no-receipt"] as const) {
    const f=fixture();
    if(kind==="scope-out")f.authority.proof.identifierReview.status="pass";
    else if(kind==="hold")f.authority.proof.identifierReview.status="hold";
    else if(kind==="no-native")f.authority.proof.identifierReview.nativeExecution=false;
    else if(kind==="missing-print-source")f.authority.proof.identifierReview.identifierConflict.pair.sourceSha256=sha("unbound source");
    else if(kind==="primary-sha")f.authority.proof.identifierInput.primaryReference.path=f.detail;
    else if(kind==="source-pixels")fs.appendFileSync(f.detail,"changed");
    else if(kind==="no-receipt")fs.rmSync(f.detail+".retrieval.json");
    else {const receipt=JSON.parse(fs.readFileSync(f.detail+".retrieval.json","utf8"));
      if(kind==="receipt-url")receipt.sourceUrl="https://shop-phinf.pstatic.net/unselected.png";
      if(kind==="receipt-time")receipt.retrievedAt="2999-01-01T00:00:00Z";
      if(kind==="receipt-version")receipt.version="unverified";
      fs.writeFileSync(f.detail+".retrieval.json",JSON.stringify(receipt));}
    held(f,"required current corroborated source: "+kind);
  }
  const extraContext = fixture(); assert.throws(() => extraContext.plan({ product: "different selected product" }), /IMAGE_RESUME_REQUIRED/u); checks++;
  console.log(`PASS publication current origin: ${checks} offline checks; current full asset/sourcePath is the sole parent, strict different-SHA terminal history remains sealed and immutable, unknown/active/duplicate origin/context/retry children hold; proof signing/provider/dispatch/live writes 0`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
