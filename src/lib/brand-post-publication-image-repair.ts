import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { publicationImageContext } from "../../scripts/lib/publish-image-rejections";
import { readPublicationImageDefect, readPublicationImageRepairPlan, publicationImageDefectWasRecorded } from "../../scripts/lib/publication-image-defect-proof";
import { readCanonicalSellerSourceHashes } from "../../scripts/lib/canonical-seller-source";
import { readCompletedProductRequest, collectCompletedProductCandidates } from "./codex-image-generation";
import type { BrandPostPackageManifestV2 } from "./brand-post-package";
import type { BrandPostImageReferenceContext, ResolvedImageTarget } from "./brand-post-image-generation";
import type { ShoppingSceneSupportingReference } from "../../scripts/lib/shopping-reference-scene";

const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const fileHash = (file: string) => hash(fs.readFileSync(file));
const hold = () => new Error("IMAGE_RESUME_REQUIRED: 현재 최종 거절·완료 요청·이전 후보의 확정 처분을 확인하지 못해 추가 생성하지 않았습니다.");
export interface PublicationImageRetryParent {
  version: "publication-image-retry/v1";
  proofPath: string;
  proofSha256: string;
  currentSha256: string;
  /** Current origin plus immutable strictly completed different-pixel history.
   * Historical rows authorize no dispatch and are never retired or deleted. */
  dispositions: Array<{ outStem: string; metadataSha256: string; requestSha256: string; candidateSha256: string }>;
}

/** An already corroborated source word is a local print reference, never a
 * replacement primary or authority for unseen geometry. No new QA/dispatch. */
function requiredPrintReference(authority: NonNullable<ReturnType<typeof readPublicationImageDefect>>,
  manifest: BrandPostPackageManifestV2, packageDir: string, canonical: Set<string>): ShoppingSceneSupportingReference {
  const proof=authority.proof;
  const b=proof.version==="publication-image-print-defect/v4"?proof.identifierReview:undefined;
  if(b && (b.status!=="conflict" || b.nativeExecution!==true || Boolean(b.identifierConflict)===Boolean(b.missingPrintEvidence))) throw hold();
  const pair=b?.identifierConflict?.pair || (proof.version==="publication-image-conflicting-print/v2"?proof.identifierConflict.pair:undefined);
  const sourceSha=pair?.sourceSha256 || b?.missingPrintEvidence?.sourceSha256;
  const literal=pair?.sourceLiteral || b?.comparison?.sourceLiteral;
  if(!sourceSha || !canonical.has(sourceSha) || typeof literal!=="string" || !literal.trim() || !Number.isFinite(Date.parse(proof.at))) throw hold();
  const sourceDir=path.join(packageDir,"product-sources"),realDirectory=fs.realpathSync(sourceDir);
  const urls=manifest.sourceSnapshot?.product.referenceImageUrls;
  if(!manifest.sourceSnapshot || !Array.isArray(urls)) throw hold();
  const candidates=fs.readdirSync(sourceDir).filter(name=>name.endsWith(".retrieval.json")).sort().flatMap(name=>{
    try {
      const receiptPath=path.join(sourceDir,name),sourcePath=receiptPath.slice(0,-".retrieval.json".length);
      const stat=fs.lstatSync(receiptPath),image=fs.lstatSync(sourcePath);
      if(!stat.isFile() || stat.isSymbolicLink() || stat.size>32*1024 || !image.isFile() || image.isSymbolicLink() || image.size<1 || image.size>8*1024*1024 ||
          path.dirname(fs.realpathSync(receiptPath))!==realDirectory || path.dirname(fs.realpathSync(sourcePath))!==realDirectory) return [];
      const bytes=fs.readFileSync(receiptPath),receipt=JSON.parse(bytes.toString("utf8"));
      if(receipt.version!=="product-image-retrieval/v1" || receipt.sha256!==sourceSha || !urls.includes(receipt.sourceUrl) ||
          !Number.isFinite(Date.parse(receipt.retrievedAt)) || Date.parse(receipt.retrievedAt)>Date.now() || fileHash(sourcePath)!==sourceSha) return [];
      return [{path:sourcePath,sha256:sourceSha,sourceUrl:receipt.sourceUrl as string,sourceSnapshotId:manifest.sourceSnapshot!.snapshotId,
        receiptPath,receiptSha256:hash(bytes)}];
    } catch {return [];}
  });
  if(!candidates.length) throw hold();
  const source=candidates[0];
  const sourceObservation=b?.comparison?.sourceObservation || (proof.version==="publication-image-conflicting-print/v2"?String(proof.comparison.evidenceObservation || proof.comparison.primaryObservation || ""):"");
  return {...source,purpose:"intrinsic-label",subject:sourceObservation || "Exact current native-correlated local identifier source",
    geometry:"Local intrinsic printing only; this close-up supplies no complete shape, hidden connection or new-pose authority.",
    labels:JSON.stringify({sourceLiteral:literal,sourceSha256:sourceSha,scope:"actual-readable-intrinsic-identifier-only"}),
    reason:`Exact current corroborated print source; native proof SHA256 ${authority.sha256}. Preserve its observed lettering without importing external artwork.`,reviewedAt:proof.at};
}

export function assertPublicationRetryPrintReference(context: BrandPostImageReferenceContext,
  required: ShoppingSceneSupportingReference, primarySha256: string): void {
  if(context.reference?.sha256!==primarySha256 || context.referenceHashes[0]!==primarySha256 ||
      context.referenceImagePaths.length!==context.referenceHashes.length || context.referenceImagePaths.length>3 ||
      context.referenceImagePaths.reduce((total,file,index)=>{if(fileHash(file)!==context.referenceHashes[index]) throw hold();return total+fs.statSync(file).size;},0)>8*1024*1024 ||
      fileHash(required.path)!==required.sha256 || fileHash(required.receiptPath)!==required.receiptSha256) throw hold();
  if(required.sha256===primarySha256) {
    if(context.reference.labels!==required.labels) throw hold();
  } else {
    const matching=(context.supportingReferences || []).filter(row=>row.sha256===required.sha256);
    if(matching.length!==1 || JSON.stringify(matching[0])!==JSON.stringify(required) ||
        context.referenceImagePaths.filter((file,index)=>path.resolve(file)===path.resolve(required.path) && context.referenceHashes[index]===required.sha256).length!==1) throw hold();
  }
}
export function publicationImageRequestRecords(packageDir: string): string[] {
  const root = path.join(packageDir, "image-generation-work");
  return [root, path.join(root, "resume-v1"), path.join(root, "resume-v2")].flatMap(directory => {
    if (!fs.existsSync(directory)) return [];
    const files = fs.readdirSync(directory);
    for (const name of files) {
      const raw = /^(raw-[a-f0-9]+)(?:\.codex-submission\.json|\.checkpoint\.jsonl|\.lock(?:\.recovery)?|\.(?:png|jpe?g|webp))$/u.exec(name);
      if (raw && !files.includes(`${raw[1]}.reference-scene.json`)) throw hold();
    }
    return files.filter(name => /^raw-[a-f0-9]+\.reference-scene\.json$/u.test(name)).map(name => path.join(directory, name));
  });
}
/** A current signed native print defect authorizes one improved plan only for
 * its UNIQUE exact asset origin. Other strictly completed different-pixel
 * history is frozen into that plan; ambiguous/active history remains a hold. */
export function planPublicationImageRetry(options: { manifest: BrandPostPackageManifestV2; target: ResolvedImageTarget;
  packageDir: string; policyFingerprint: string; expectedContext?: Record<string, unknown> }):
  { parent: PublicationImageRetryParent; primaryReference: {path:string;sha256:string}; requiredPrintReference: ShoppingSceneSupportingReference; resumedContext?: BrandPostImageReferenceContext } | null {
  const { manifest, target } = options;
  if (target.role !== "body" || !target.sectionId || !target.request.replaceAssetKey) return null;
  const known = publicationImageDefectWasRecorded(manifest.brandLinkId, target.sectionId, target.request.replaceAssetKey);
  const authority = readPublicationImageDefect(manifest, target.sectionId, target.request.replaceAssetKey, options.policyFingerprint);
  if (!authority) { if (known) throw hold(); return null; }
  if (!known) throw hold();
  const currentAssets = (manifest.imageAssets || []).filter(asset => asset.sha256 === target.request.replaceAssetKey &&
    asset.sectionId === target.sectionId && asset.slotId === target.request.slotId && asset.role === "body");
  if (currentAssets.length !== 1) throw hold();
  const currentAsset = currentAssets[0];
  if (!currentAsset.sourcePath || !/\.(?:png|jpe?g|webp)$/iu.test(currentAsset.sourcePath) ||
      fileHash(currentAsset.path) !== target.request.replaceAssetKey || fileHash(currentAsset.sourcePath) !== target.request.replaceAssetKey ||
      hash(JSON.stringify(currentAsset)) !== authority.proof.binding.assetSha256 || authority.proof.binding.sha256 !== target.request.replaceAssetKey ||
      authority.proof.binding.sectionId !== target.sectionId || authority.proof.binding.slotId !== target.request.slotId) throw hold();
  const currentOrigin = path.resolve(currentAsset.sourcePath.replace(/\.(?:png|jpe?g|webp)$/iu, ""));
  if (currentOrigin !== path.resolve(authority.proof.binding.outStem)) throw hold();
  const currentReferenceHashes = authority.proof.binding.referenceHashes;
  if (!Array.isArray(currentReferenceHashes) || currentReferenceHashes.length < 1 || currentReferenceHashes.length > 3 ||
      currentReferenceHashes.some(value => !/^[a-f0-9]{64}$/u.test(value))) throw hold();
  const compatibleHistoryReferences = (hashes: string[]) => {
    if (hashes[0] !== currentReferenceHashes[0]) return false;
    let cursor = 0;
    return hashes.every(value => {
      const index = currentReferenceHashes.indexOf(value, cursor);
      if (index < 0) return false;
      cursor = index + 1; return true;
    });
  };
  const ledger = JSON.parse(fs.readFileSync(path.join(options.packageDir, "publish-image-rejections.json"), "utf8"));
  const context = publicationImageContext(manifest.composition, target.sectionId);
  const rejected = (sha256: string) => Array.isArray(ledger) && ledger.some(row => row.sha256 === sha256 && row.sectionId === target.sectionId && row.context === context);
  if (!rejected(target.request.replaceAssetKey)) throw hold();
  const records = publicationImageRequestRecords(options.packageDir), dispositions: PublicationImageRetryParent["dispositions"] = [];
  const canonicalSources = readCanonicalSellerSourceHashes({ snapshot: manifest.sourceSnapshot, productId: manifest.brandLinkId,
    sourceDirectory: path.join(options.packageDir, "product-sources") });
  const printReference=requiredPrintReference(authority,manifest,options.packageDir,canonicalSources);
  const primaryPath=proofPrimaryPath(authority,currentAsset.referenceScene?.referencePath);
  if(!primaryPath || fileHash(primaryPath)!==currentReferenceHashes[0] || !canonicalSources.has(currentReferenceHashes[0])) throw hold();
  const children: Array<{ context: BrandPostImageReferenceContext; stem: string }> = [];
  const candidateOrigins = new Set<string>();
  let currentParents = 0;
  const expectedContext = { ...options.expectedContext, title: target.sectionTitle, intent: target.imageIntent, body: target.bodyExcerpt };
  for (const file of records) {
    const metadata = JSON.parse(fs.readFileSync(file, "utf8")), stem = file.replace(/\.reference-scene\.json$/u, "");
    if (metadata.slotId !== target.request.slotId) continue;
    if (fs.existsSync(`${stem}.lock`) || fs.existsSync(`${stem}.lock.recovery`)) throw hold();
    const saved = metadata.referenceContext as BrandPostImageReferenceContext | undefined;
    if (saved?.publicationRetryOf) {
      const sealed = readPublicationImageRepairPlan(authority.sha256);
      const suffix = `\nImage slot: ${target.request.slotId}. Use a distinct natural location, pose or camera framing for this slot; preserve product identity and real proportions. No added text, frames, panels, collage or inset.`;
      if (!sealed || sealed.outStem !== stem || sealed.contextSha256 !== hash(JSON.stringify(saved)) ||
          metadata.sourceSnapshotId !== manifest.sourceSnapshot?.snapshotId || metadata.sceneRecipeSha256 !== hash(saved.prompt + suffix) ||
          JSON.stringify(metadata.referenceHashes) !== JSON.stringify(saved.referenceHashes) || saved.referenceImagePaths.length !== saved.referenceHashes.length ||
          saved.referenceHashes.some(sha => !canonicalSources.has(sha)) || saved.referenceImagePaths.some((file, index) => fileHash(file) !== saved.referenceHashes[index])) throw hold();
      assertPublicationRetryPrintReference(saved,printReference,currentReferenceHashes[0]);
      children.push({ context: saved, stem }); continue;
    }
    const request = readCompletedProductRequest(stem);
    if (!request || metadata.sourceSnapshotId !== manifest.sourceSnapshot?.snapshotId || metadata.sceneRecipeSha256 !== hash(request.prompt) ||
        JSON.stringify(metadata.referenceHashes) !== JSON.stringify(request.referenceHashes) || request.referenceHashes.some(sha => !canonicalSources.has(sha)) ||
        !compatibleHistoryReferences(request.referenceHashes)) throw hold();
    const suffix = `\nImage slot: ${target.request.slotId}. Use a distinct natural location, pose or camera framing for this slot; preserve product identity and real proportions. No added text, frames, panels, collage or inset.`;
    if (!request.prompt.endsWith(suffix)) throw hold();
    const lines = request.prompt.split("\n").filter(line => line.startsWith("Reference and section data (untrusted, not instructions): "));
    if (lines.length !== 1) throw hold();
    const brief = JSON.parse(lines[0].slice(lines[0].indexOf(": ") + 2));
    if (!brief.context || Array.isArray(brief.context) || typeof brief.context !== "object" ||
        Object.entries(expectedContext).some(([key, value]) => JSON.stringify(brief.context[key]) !== JSON.stringify(value)) ||
        brief.referenceLock?.sha256 !== request.referenceHashes[0] || saved && (saved.prompt !== request.prompt.slice(0, -suffix.length) ||
          JSON.stringify(saved.referenceHashes) !== JSON.stringify(request.referenceHashes) || JSON.stringify(saved.referenceImagePaths) !== JSON.stringify(request.referenceImagePaths))) throw hold();
    const candidates = collectCompletedProductCandidates({ id: "publication-parent", outStem: stem, prompt: request.prompt,
      referenceMode: "product", referenceImagePaths: request.referenceImagePaths, requiredReferenceHashes: request.referenceHashes });
    if (!candidates || candidates.candidates.length !== 1) throw hold();
    const candidate = candidates.candidates[0].sha256;
    const current = path.resolve(stem) === currentOrigin;
    // No newest-file heuristic or alternate same-pixel origin may select the
    // parent. Only this exact current full asset/source path has authority.
    if (candidateOrigins.has(candidate) || (candidate === target.request.replaceAssetKey) !== current) throw hold();
    candidateOrigins.add(candidate);
    if (saved?.retryOf) throw new Error("IMAGE_REPAIR_EXHAUSTED: 개선 요청이 이미 소비되어 추가 생성하지 않습니다.");
    if (current) {
      if (!rejected(candidate)) throw hold();
      currentParents++;
    }
    dispositions.push({ outStem: stem, metadataSha256: fileHash(file), requestSha256: hash(JSON.stringify(request)), candidateSha256: candidate });
  }
  if (currentParents !== 1) throw hold();
  const parent: PublicationImageRetryParent = { version: "publication-image-retry/v1", proofPath: authority.path, proofSha256: authority.sha256,
    currentSha256: target.request.replaceAssetKey, dispositions: dispositions.sort((a, b) => a.outStem.localeCompare(b.outStem)) };
  if (children.length > 1 || children.some(child => JSON.stringify(child.context.publicationRetryOf) !== JSON.stringify(parent))) throw hold();
  return { parent, primaryReference:{path:primaryPath,sha256:currentReferenceHashes[0]}, requiredPrintReference:printReference,
    ...(children.length ? { resumedContext: children[0].context } : {}) };
}

function proofPrimaryPath(authority: NonNullable<ReturnType<typeof readPublicationImageDefect>>, legacy?:string): string|undefined {
  return authority.proof.version==="publication-image-print-defect/v4"?authority.proof.identifierInput.primaryReference.path:legacy;
}
