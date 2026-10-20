import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getAppDataDir } from "./app-paths";
import { publicationImageContext } from "./publish-image-rejections";
import { referencePlaneComparisonIssue, type ReferencePlaneContext } from "./reference-plane-grounding";
import { normalizeIntrinsicIdentifierLiteral, INTRINSIC_IDENTIFIER_OCR_VERSION } from "./intrinsic-identifier-ocr";
import { corroboratableIdentifierPairs, intrinsicIdentifierBoxesOverlap, type IntrinsicIdentifierServerConflict } from "./intrinsic-identifier-comparison";
import { INTRINSIC_IDENTIFIER_OBSERVER_VERSION, intrinsicIdentifierObserverRequestSha256,
  parseIntrinsicIdentifierObserverResponse } from "./intrinsic-identifier-observer";
import type { BrandPostPackageManifestV2 } from "../../src/lib/brand-post-package";
import { publicationIdentifierReviewEvidenceIssue, type PublicationIdentifierReviewInput, type PublicationIdentifierReviewResult } from "./publication-identifier-review";
import { scopedPublicationEvidenceIssue, visibleMemberInclusionIssue, pixelFormatEvidenceIssue, type ScopedReviewEvidence } from "./publication-image-scoped-review";
import { visibleIdentityEvidenceIssue, visibleIdentityReviewContext } from "./publication-visible-identity";
import { publicationClaimUnits } from "./publication-claim-units";
import { readCanonicalSellerSourceHashes } from "./canonical-seller-source";

const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const fileHash = (file: string) => hash(fs.readFileSync(file));
const valid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const directory = () => path.join(getAppDataDir(), "publication-image-defect-proofs");
function secret(create: boolean): Buffer | null {
  const file = path.join(directory(), ".signing-key");
  try { const bytes = fs.readFileSync(file); return bytes.length === 32 ? bytes : null; }
  catch (error) { if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") return null; }
  fs.mkdirSync(directory(), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, crypto.randomBytes(32), { flag: "wx", mode: 0o600 });
    try { fs.linkSync(temporary, file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } finally { fs.rmSync(temporary, { force: true }); }
  return secret(false);
}
export function publicationDefectMaterialBinding(manifest: BrandPostPackageManifestV2): string {
  return hash(JSON.stringify({ id: manifest.brandLinkId, createdAt: manifest.createdAt, title: manifest.title,
    hashtags: manifest.hashtags, sourceSnapshot: manifest.sourceSnapshot, composition: manifest.composition,
    assets: manifest.imageAssets, hero: manifest.heroImagePath, body: manifest.bodyImagePaths }));
}
function currentBinding(manifest: BrandPostPackageManifestV2, sectionId: string, sha256: string) {
  const matches = (manifest.imageAssets || []).filter(asset => asset.sha256 === sha256 && asset.sectionId === sectionId &&
    asset.provenance === "GENERATED_SCENE" && asset.creationMethod === "reference-guided-scene" && asset.remoteGenerated === true);
  if (matches.length !== 1) return null;
  const asset = matches[0], section = manifest.composition.sections.find(row => row.id === sectionId);
  if (!asset.slotId || !asset.sourcePath || !section?.imagePaths.includes(asset.path) || fileHash(asset.path) !== sha256 || fileHash(asset.sourcePath) !== sha256 ||
      !asset.referenceScene || asset.referenceScene.sourceSnapshotId !== manifest.sourceSnapshot?.snapshotId) return null;
  const stem = asset.sourcePath.replace(/\.(?:png|jpe?g|webp)$/iu, ""), metadataPath = `${stem}.reference-scene.json`;
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  if (metadata.slotId !== asset.slotId || metadata.sourceSnapshotId !== manifest.sourceSnapshot?.snapshotId || !Array.isArray(metadata.referenceHashes)) return null;
  return { material: publicationDefectMaterialBinding(manifest), context: publicationImageContext(manifest.composition, sectionId),
    sectionId, slotId: asset.slotId, sha256, outStem: stem, metadataSha256: fileHash(metadataPath),
    referenceHashes: metadata.referenceHashes as string[], assetSha256: hash(JSON.stringify(asset)) };
}
export interface PublicationImageDefectProof {
  version: "publication-image-conflicting-print/v2";
  binding: NonNullable<ReturnType<typeof currentBinding>>;
  policyFingerprint: string;
  requestBindingSha256: string;
  comparison: Record<string, unknown>;
  comparisonContext: ReferencePlaneContext;
  rawVerdict: { accepted: unknown; identityMatches: unknown };
  identifierConflict: IntrinsicIdentifierServerConflict;
  at: string;
  signature: string;
}
export interface ScopedPublicationImageDefectProof {
  version: "publication-image-print-defect/v4";
  binding: NonNullable<ReturnType<typeof currentBinding>>;
  policyFingerprint: string;
  requestBindingSha256: string;
  defectKind: "conflicting-print" | "missing-print";
  visibleReview: ScopedReviewEvidence;
  claimsReview: ScopedReviewEvidence;
  formatReview: ScopedReviewEvidence;
  materialContext: { file: string; sha256: string };
  identifierReview: PublicationIdentifierReviewResult;
  identifierInput: PublicationIdentifierReviewInput;
  at: string;
  signature: string;
}
function scopedDefectIssue(row: Omit<ScopedPublicationImageDefectProof, "signature">, manifest: BrandPostPackageManifestV2): string | null {
  try {
    const { identifierInput: input, identifierReview: b, binding } = row;
    const asset = (manifest.imageAssets || []).find(asset => asset.sha256 === binding.sha256 && asset.sectionId === binding.sectionId);
    if (!asset || input.candidateSha256 !== binding.sha256 || path.resolve(input.candidatePath) !== path.resolve(asset.path) ||
        input.primaryReference.sha256 !== asset.referenceScene?.referenceSha256 ||
        scopedPublicationEvidenceIssue(row.visibleReview, { task: "A-visible", candidateSha256: binding.sha256,
          primaryReferenceSha256: input.primaryReference.sha256 }) ||
        scopedPublicationEvidenceIssue(row.claimsReview, { task: "C-photo-claims", candidateSha256: binding.sha256 }) ||
        scopedPublicationEvidenceIssue(row.formatReview, { task: "D-pixel-format", candidateSha256: binding.sha256 }) ||
        row.visibleReview.row?.accepted !== true || row.visibleReview.row?.identityMatches !== true || (row.visibleReview.row?.picturedMemberEvidence as {verdict?: string})?.verdict !== "selected-member-visible" ||
        visibleMemberInclusionIssue(row.visibleReview.row, JSON.stringify(nativeTaskData(row.visibleReview).selectedSubjectFacts)) ||
        visibleIdentityEvidenceIssue(row.visibleReview.row, visibleIdentityReviewContext(""))) return "isolated visible/native evidence is invalid";
    const c = row.claimsReview.row;
    const d = row.formatReview.row;
    if (!sectionTaskDataMatches(manifest,binding.sectionId,asset.path,row.claimsReview,row.formatReview,false)) return "isolated claim/format request is not the current rendered section";
    if (!c || c.accepted !== true || c.photoClaimMatches !== true || !d || d.accepted !== true || d.notice !== false ||
        d.singlePhotograph !== true || d.noGraphicLayout !== true || d.textPolicyMatches !== true || pixelFormatEvidenceIssue(d, "detail") || c.mixedOptions !== false &&
        !(c.mixedOptions === true && c.explicitNamedComparison === true && c.optionsClearlyLabeled === true)) return "independent claim/format task did not pass";
    const canonical = readCanonicalSellerSourceHashes({ snapshot: manifest.sourceSnapshot, productId: manifest.brandLinkId,
      sourceDirectory: path.join(getAppDataDir(), "prepared-brand-posts", manifest.brandLinkId, "product-sources") });
    if (!canonical.has(input.primaryReference.sha256) || input.canonicalReferences.some(reference =>
      !canonical.has(reference.sha256) || reference.sourceSnapshotId !== manifest.sourceSnapshot?.snapshotId)) return "print source is not current canonical evidence";
    if (publicationIdentifierReviewEvidenceIssue(b, input) || b.status !== "conflict" ||
        row.defectKind !== (b.missingPrintEvidence ? "missing-print" : "conflicting-print") ||
        row.requestBindingSha256 !== hash(JSON.stringify({ visible: row.visibleReview.requestSha256,
          identifiers: b.requestSha256, claims: row.claimsReview.requestSha256, format: row.formatReview.requestSha256 }))) return "isolated print defect is not corroborated";
    const context = readPublicationDefectMaterialContext(row);
    if (!context || publicationDefectMaterialBinding(context) !== binding.material || binding.material !== publicationDefectMaterialBinding(manifest))
      return "immutable defect material context is missing or changed";
    return null;
  } catch { return "isolated defect inputs changed or are malformed"; }
}
export function isCorroboratedNativeIdentifierConflict(value: IntrinsicIdentifierServerConflict | undefined, candidateSha256: string,
  comparison: Record<string, unknown>, context: ReferencePlaneContext): value is IntrinsicIdentifierServerConflict {
  try {
    if (!value || value.version !== "intrinsic-identifier-conflict/v1" || value.evidence.version !== INTRINSIC_IDENTIFIER_OCR_VERSION ||
        !value.evidence.nativeExecution) return false;
    const originals = corroboratableIdentifierPairs(comparison);
    if (value.blindObservations) {
      // Only the transcription and word boxes may come from the separate blind
      // task. Product/component/option/source correspondence remains the
      // original verdict's exact independently mapped semantic observation.
      const fixed = (pair: IntrinsicIdentifierServerConflict["pair"]) => ({ ...pair,
        sourceLiteral: "", candidateLiteral: "", sourceBox: null, candidateBox: null });
      if (!originals.some(pair => JSON.stringify(fixed(pair)) === JSON.stringify(fixed(value.pair)) &&
          intrinsicIdentifierBoxesOverlap(pair.sourceBox, value.pair.sourceBox) && intrinsicIdentifierBoxesOverlap(pair.candidateBox, value.pair.candidateBox))) return false;
      for (const side of ["source", "candidate"] as const) {
        const observation = value.blindObservations[side], expectedSha = side === "source" ? value.pair.sourceSha256 : candidateSha256;
        if (observation.version !== INTRINSIC_IDENTIFIER_OBSERVER_VERSION || !observation.nativeExecution ||
            observation.imageSha256 !== expectedSha || observation.requestSha256 !== intrinsicIdentifierObserverRequestSha256(expectedSha!) ||
            typeof observation.rawResponse !== "string" || observation.rawResponse.length > 4096 ||
            hash(observation.rawResponse) !== observation.responseSha256 ||
            JSON.stringify(parseIntrinsicIdentifierObserverResponse(observation.rawResponse)) !== JSON.stringify(observation.observation) ||
            observation.observation.readability !== "legible" || observation.observation.location !== "intrinsic" ||
            observation.observation.identifierRole !== value.pair.identifierRole ||
            observation.observation.literal !== value.pair[`${side}Literal`] ||
            JSON.stringify(observation.observation.box) !== JSON.stringify(value.pair[`${side}Box`])) return false;
      }
    } else if (!originals.some(pair => JSON.stringify(pair) === JSON.stringify(value.pair))) return false;
    const { evidence, pair } = value, source = evidence.source.consensus, candidate = evidence.candidate.consensus;
    const registered = pair.sourceImageIndex === context.primaryReferenceImageIndex ? context.primaryReferenceSha256
      : context.supplementalReferences.find(reference => reference.imageIndex === pair.sourceImageIndex)?.sha256;
    return !!source && !!candidate && registered === pair.sourceSha256 && pair.sourceSha256 === evidence.source.originalSha256 &&
      candidateSha256 === evidence.candidate.originalSha256 && JSON.stringify(pair.sourceBox) === JSON.stringify(evidence.source.box) &&
      JSON.stringify(pair.candidateBox) === JSON.stringify(evidence.candidate.box) &&
      source.normalized === normalizeIntrinsicIdentifierLiteral(pair.sourceLiteral) && candidate.normalized === normalizeIntrinsicIdentifierLiteral(pair.candidateLiteral) &&
      source.normalized !== candidate.normalized && source.minimumConfidence >= 85 && candidate.minimumConfidence >= 85 &&
      new Set(source.presets).size >= 2 && new Set(candidate.presets).size >= 2 &&
      fileHash(evidence.engine.binaryPath) === evidence.engine.binarySha256 && fileHash(evidence.engine.traineddataPath) === evidence.engine.traineddataSha256;
  } catch { return false; }
}
function proofFile(binding: NonNullable<ReturnType<typeof currentBinding>>, policy: string) {
  return path.join(directory(), `${hash(JSON.stringify({ binding, policy }))}.json`);
}
function locator(id: string, sectionId: string, sha256: string) {
  const row = { version: "publication-image-defect-seen/v1", id, sectionId, sha256 };
  return { file: path.join(directory(), `seen-${hash(JSON.stringify({ id, sectionId, sha256 }))}.json`), bytes: JSON.stringify(row) };
}
/** Block-only memory: malformed/stale native proof must never fall through to
 * the older generic explicit-replace path. A locator is NEVER generation authority. */
export function publicationImageDefectWasRecorded(id: string, sectionId: string, sha256: string): boolean {
  const expected = locator(id, sectionId, sha256);
  try {
    if (fs.readFileSync(expected.file, "utf8") !== expected.bytes) throw new Error("invalid locator");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("IMAGE_RESUME_REQUIRED: 이전 최종 사진 거절 기록을 확인하지 못해 추가 생성하지 않았습니다.");
  }
}
/** Called only after the native audit has validated the actual structured row
 * and all final pixel/context snapshots. It changes no review decision. */
export function recordPublicationImageDefect(options: { manifest: BrandPostPackageManifestV2; sectionId: string; sha256: string;
  policyFingerprint: string; requestBindingSha256: string; verdict: Record<string, unknown>; context: ReferencePlaneContext;
  identifierConflict?: IntrinsicIdentifierServerConflict }): void {
  const { verdict } = options, comparison = verdict.referenceComparison as Record<string, unknown> | undefined;
  if (!comparison || referencePlaneComparisonIssue(verdict, options.context) || !isCorroboratedNativeIdentifierConflict(options.identifierConflict, options.sha256, comparison, options.context) ||
      !valid(options.policyFingerprint) || !valid(options.requestBindingSha256)) return;
  let binding: ReturnType<typeof currentBinding>;
  try { binding = currentBinding(options.manifest, options.sectionId, options.sha256); } catch { return; }
  if (!binding || comparison.primaryReferenceSha256 !== (options.manifest.imageAssets || []).find(asset => asset.sha256 === options.sha256)?.referenceScene?.referenceSha256) return;
  const key = secret(true); if (!key) throw new Error("PUBLICATION_DEFECT_PROOF_KEY_INVALID");
  const seen = locator(options.manifest.brandLinkId, options.sectionId, options.sha256);
  try { fs.writeFileSync(seen.file, seen.bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (!publicationImageDefectWasRecorded(options.manifest.brandLinkId, options.sectionId, options.sha256))
    throw new Error("PUBLICATION_DEFECT_PROOF_LOCATOR_INVALID");
  const file = proofFile(binding, options.policyFingerprint);
  if (fs.existsSync(file)) return; // Immutable first observed verdict for these exact inputs.
  const payload = { version: "publication-image-conflicting-print/v2" as const, binding, policyFingerprint: options.policyFingerprint,
    requestBindingSha256: options.requestBindingSha256, comparison, comparisonContext: options.context,
    rawVerdict: { accepted: verdict.accepted, identityMatches: verdict.identityMatches }, identifierConflict: options.identifierConflict, at: new Date().toISOString() };
  const bytes = JSON.stringify({ ...payload, signature: crypto.createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex") });
  try { fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}
/** A context snapshot is only historical data, never approval or retry authority. */
function materialContextBytes(manifest: BrandPostPackageManifestV2): string {
  const { brandLinkId, createdAt, title, hashtags, sourceSnapshot, composition, imageAssets, heroImagePath, bodyImagePaths } = manifest;
  return JSON.stringify({ version: "publication-defect-material-context/v1", manifest: { brandLinkId, createdAt, title, hashtags,
    sourceSnapshot, composition, imageAssets, heroImagePath, bodyImagePaths } });
}
function preserveMaterialContext(manifest: BrandPostPackageManifestV2): {file:string;sha256:string} {
  const bytes = materialContextBytes(manifest);
  if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) throw new Error("PUBLICATION_DEFECT_CONTEXT_TOO_LARGE");
  const sha256 = hash(bytes), file = `context-${sha256}.json`;
  fs.mkdirSync(directory(), {recursive:true});
  try { fs.writeFileSync(path.join(directory(), file), bytes, {flag:"wx",mode:0o600}); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || fileHash(path.join(directory(),file)) !== sha256) throw error; }
  return {file,sha256};
}
export function readPublicationDefectMaterialContext(proof: {materialContext:{file:string;sha256:string};binding:{material:string}}): BrandPostPackageManifestV2 | null {
  try {
    const ref = proof.materialContext;
    if (!ref || !valid(ref.sha256) || ref.file !== `context-${ref.sha256}.json`) return null;
    const file = path.join(directory(),ref.file), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) return null;
    const bytes = fs.readFileSync(file), value = JSON.parse(bytes.toString("utf8"));
    if (hash(bytes) !== ref.sha256 || value.version !== "publication-defect-material-context/v1" ||
        publicationDefectMaterialBinding(value.manifest) !== proof.binding.material) return null;
    return value.manifest;
  } catch { return null; }
}
export interface OriginalPhotoClaimDefectProof {
  version: "publication-original-photo-claim/v1";
  binding: { material: string; sectionId: string; slotId: string; sha256: string; assetSha256: string; context: string; sourceSnapshotId: string; canonicalReceipts: Array<{file:string;sha256:string}> };
  policyFingerprint: string; materialContext: {file:string;sha256:string};
  visibleReview: ScopedReviewEvidence; claimsReview: ScopedReviewEvidence; formatReview: ScopedReviewEvidence;
  identifierReview: PublicationIdentifierReviewResult; identifierInput: PublicationIdentifierReviewInput;
  at: string; signature: string;
}
function originalClaimBinding(manifest: BrandPostPackageManifestV2, sectionId: string, sha256: string): OriginalPhotoClaimDefectProof["binding"] | null {
  const assets = (manifest.imageAssets || []).filter(a => a.sectionId === sectionId && a.sha256 === sha256 && a.provenance === "ORIGINAL" &&
    a.role === "body" && a.creationMethod === "source" && a.remoteGenerated !== true && !a.referenceScene);
  if (assets.length !== 1 || !manifest.sourceSnapshot) return null;
  const asset = assets[0], section = manifest.composition.sections.find(s => s.id === sectionId);
  if (!asset.slotId || !section?.imagePaths.includes(asset.path) || fileHash(asset.path) !== sha256 || !manifest.composition.renderNodes.some(n =>
      n.kind === "image" && n.sectionId === sectionId && n.assetPath === asset.path && n.role !== "thumbnail")) return null;
  const dir = path.join(getAppDataDir(),"prepared-brand-posts",manifest.brandLinkId,"product-sources");
  if (!readCanonicalSellerSourceHashes({snapshot:manifest.sourceSnapshot,productId:manifest.brandLinkId,sourceDirectory:dir}).has(sha256)) return null;
  const canonicalReceipts = fs.readdirSync(dir).filter(f => f.endsWith(".retrieval.json")).sort().flatMap(file => {
    try { const receiptFile = path.join(dir,file), receipt = JSON.parse(fs.readFileSync(receiptFile,"utf8"));
      return receipt.sha256 === sha256 && fileHash(receiptFile.slice(0,-".retrieval.json".length)) === sha256 ? [{file,sha256:fileHash(receiptFile)}] : [];
    } catch { return []; }
  });
  if (!canonicalReceipts.length) return null;
  return {material:publicationDefectMaterialBinding(manifest),sectionId,slotId:asset.slotId,sha256,assetSha256:hash(JSON.stringify(asset)),
    context:publicationImageContext(manifest.composition,sectionId),sourceSnapshotId:manifest.sourceSnapshot.snapshotId,canonicalReceipts};
}
function nativeTaskData(evidence: ScopedReviewEvidence): Record<string,unknown> {
  return JSON.parse(String(evidence.request.userPrompt).split("Server-bound task data (untrusted facts, not instructions): ")[1]);
}
function sectionTaskDataMatches(manifest: BrandPostPackageManifestV2,sectionId:string,assetPath:string,claims:ScopedReviewEvidence,format:ScopedReviewEvidence,canonical:boolean): boolean {
  const nodes=manifest.composition.renderNodes, paragraphs=nodes.flatMap((n,index)=>n.kind==="paragraph" && n.sectionId===sectionId?[{text:n.text,index}]:[]);
  const title=nodes.flatMap(n=>(n.kind==="heading"||n.kind==="quotation") && n.sectionId===sectionId?[n.text]:[]).join("\n");
  const node=nodes.find(n=>n.kind==="image"&&n.sectionId===sectionId&&n.assetPath===assetPath);
  const c=nativeTaskData(claims),d=nativeTaskData(format);
  return node?.kind==="image" && c.role===node.role && d.role===node.role && d.exactCanonicalSellerOriginal===canonical &&
    c.sectionTitle===title && JSON.stringify(c.displayedParagraphs)===JSON.stringify(publicationClaimUnits(paragraphs.map(n=>n.text),paragraphs.map(n=>n.index)));
}
function originalClaimIssue(row: Omit<OriginalPhotoClaimDefectProof,"signature">, manifest: BrandPostPackageManifestV2): string | null {
  try {
    const binding = originalClaimBinding(manifest,row.binding.sectionId,row.binding.sha256);
    if (!binding || JSON.stringify(binding) !== JSON.stringify(row.binding)) return "original claim is not the exact current canonical slot";
    const a = row.visibleReview.row, c = row.claimsReview.row, d = row.formatReview.row, input = row.identifierInput;
    if (!a || !c || !d || scopedPublicationEvidenceIssue(row.visibleReview,{task:"A-visible",candidateSha256:binding.sha256,primaryReferenceSha256:binding.sha256}) ||
        scopedPublicationEvidenceIssue(row.claimsReview,{task:"C-photo-claims",candidateSha256:binding.sha256}) ||
        scopedPublicationEvidenceIssue(row.formatReview,{task:"D-pixel-format",candidateSha256:binding.sha256}) ||
        a.accepted !== true || a.identityMatches !== true || visibleIdentityEvidenceIssue(a,visibleIdentityReviewContext("")) ||
        visibleMemberInclusionIssue(a,JSON.stringify(nativeTaskData(row.visibleReview).selectedSubjectFacts)) ||
        (a.picturedMemberEvidence as {verdict?:string}).verdict !== "selected-member-visible" || d.accepted !== true || pixelFormatEvidenceIssue(d,"detail") ||
        d.notice !== false || d.singlePhotograph !== true || d.noGraphicLayout !== true || d.textPolicyMatches !== true ||
        c.accepted !== false || c.photoClaimMatches !== false || c.mixedOptions !== false || row.identifierReview.status !== "pass" ||
        publicationIdentifierReviewEvidenceIssue(row.identifierReview,input) || input.candidateSha256 !== binding.sha256 || input.primaryReference.sha256 !== binding.sha256)
      return "original claim-only independent checks did not strictly pass";
    const asset = manifest.imageAssets!.find(a => a.sectionId === binding.sectionId && a.sha256 === binding.sha256)!;
    if (path.resolve(input.candidatePath) !== path.resolve(asset.path) || !sectionTaskDataMatches(manifest,binding.sectionId,asset.path,row.claimsReview,row.formatReview,true)) return "original claim input differs";
    const nodes = manifest.composition.renderNodes, paragraphs = nodes.flatMap((n,index) => n.kind === "paragraph" && n.sectionId === binding.sectionId ? [{text:n.text,index}] : []);
    const units = publicationClaimUnits(paragraphs.map(n => n.text),paragraphs.map(n => n.index));
    const title = nodes.flatMap(n => (n.kind === "heading" || n.kind === "quotation") && n.sectionId === binding.sectionId ? [n.text] : []).join("\n");
    const data = nativeTaskData(row.claimsReview), objection = c.photoClaimObjection as Record<string,unknown>;
    if (data.sectionTitle !== title || JSON.stringify(data.displayedParagraphs) !== JSON.stringify(units) || !objection ||
        Object.keys(objection).sort().join("|") !== ["origin","sourceIndex","quote","scope","conflict"].sort().join("|") ||
        typeof objection.conflict !== "string" || !objection.conflict.trim() || !["pictured-appearance","quantity","complete-set","performance","result"].includes(String(objection.scope)) ||
        !(objection.origin === "section-title" && objection.sourceIndex === null && objection.quote === title ||
          objection.origin === "section-body" && Number.isSafeInteger(objection.sourceIndex) && units[Number(objection.sourceIndex)]?.text === objection.quote))
      return "original claim is not a whole current displayed unit";
    const context = readPublicationDefectMaterialContext(row);
    return context && publicationDefectMaterialBinding(context) === binding.material ? null : "original context is missing or changed";
  } catch { return "original claim proof is malformed or changed"; }
}
/** Source-slot rebind admission only; never image generation, manuscript edit or approval. */
export function recordOriginalPhotoClaimDefect(options: {manifest:BrandPostPackageManifestV2;sectionId:string;sha256:string;policyFingerprint:string;
  visibleReview:ScopedReviewEvidence;claimsReview:ScopedReviewEvidence;formatReview:ScopedReviewEvidence;identifierReview:PublicationIdentifierReviewResult;identifierInput:PublicationIdentifierReviewInput}): void {
  let binding: ReturnType<typeof originalClaimBinding>;
  try { binding = originalClaimBinding(options.manifest,options.sectionId,options.sha256); } catch { return; }
  if (!binding || !valid(options.policyFingerprint)) return;
  const payload: Omit<OriginalPhotoClaimDefectProof,"signature"> = {version:"publication-original-photo-claim/v1",binding,
    materialContext:preserveMaterialContext(options.manifest),policyFingerprint:options.policyFingerprint,visibleReview:options.visibleReview,claimsReview:options.claimsReview,
    formatReview:options.formatReview,identifierReview:options.identifierReview,identifierInput:options.identifierInput,at:new Date().toISOString()};
  if (originalClaimIssue(payload,options.manifest)) return;
  const key = secret(true); if (!key) return;
  const file = path.join(directory(),`original-claim-${hash(JSON.stringify({binding,policy:options.policyFingerprint}))}.json`);
  const bytes = JSON.stringify({...payload,signature:crypto.createHmac("sha256",key).update(JSON.stringify(payload)).digest("hex")});
  try {fs.writeFileSync(file,bytes,{flag:"wx",mode:0o600});} catch(error) {if((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;}
}
export function readOriginalPhotoClaimDefect(manifest:BrandPostPackageManifestV2,sectionId:string,sha256:string,policy:string): {proof:OriginalPhotoClaimDefectProof;path:string;sha256:string}|null {
  try {
    const binding = originalClaimBinding(manifest,sectionId,sha256), key = secret(false); if (!binding || !key) return null;
    const file = path.join(directory(),`original-claim-${hash(JSON.stringify({binding,policy}))}.json`), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) return null;
    const bytes = fs.readFileSync(file), row = JSON.parse(bytes.toString("utf8")) as OriginalPhotoClaimDefectProof, {signature,...payload} = row;
    if (row.version !== "publication-original-photo-claim/v1" || row.policyFingerprint !== policy || !valid(signature) ||
        !crypto.timingSafeEqual(Buffer.from(signature,"hex"),crypto.createHmac("sha256",key).update(JSON.stringify(payload)).digest()) || originalClaimIssue(row,manifest)) return null;
    return {proof:row,path:file,sha256:hash(bytes)};
  } catch {return null;}
}
/** New isolated tasks are retained as independent native packets. No legacy
 * verdict is modified, and source OCR alone never certifies candidate blankness. */
export function recordScopedPublicationImageDefect(options: { manifest: BrandPostPackageManifestV2; sectionId: string; sha256: string;
  policyFingerprint: string; visibleReview: ScopedReviewEvidence; claimsReview: ScopedReviewEvidence; formatReview: ScopedReviewEvidence;
  identifierReview: PublicationIdentifierReviewResult; identifierInput: PublicationIdentifierReviewInput }): void {
  let binding: ReturnType<typeof currentBinding>;
  try { binding = currentBinding(options.manifest, options.sectionId, options.sha256); } catch { return; }
  if (!binding || !valid(options.policyFingerprint)) return;
  const materialContext = preserveMaterialContext(options.manifest);
  const payload: Omit<ScopedPublicationImageDefectProof, "signature"> = { version: "publication-image-print-defect/v4", binding, materialContext,
    policyFingerprint: options.policyFingerprint, requestBindingSha256: hash(JSON.stringify({ visible: options.visibleReview.requestSha256,
      identifiers: options.identifierReview.requestSha256, claims: options.claimsReview.requestSha256, format: options.formatReview.requestSha256 })),
    defectKind: options.identifierReview.missingPrintEvidence ? "missing-print" : "conflicting-print",
    visibleReview: options.visibleReview, claimsReview: options.claimsReview, formatReview: options.formatReview, identifierReview: options.identifierReview,
    identifierInput: options.identifierInput, at: new Date().toISOString() };
  if (scopedDefectIssue(payload, options.manifest)) return;
  const key = secret(true); if (!key) throw new Error("PUBLICATION_DEFECT_PROOF_KEY_INVALID");
  const seen = locator(options.manifest.brandLinkId, options.sectionId, options.sha256);
  try { fs.writeFileSync(seen.file, seen.bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (!publicationImageDefectWasRecorded(options.manifest.brandLinkId, options.sectionId, options.sha256)) throw new Error("PUBLICATION_DEFECT_PROOF_LOCATOR_INVALID");
  const file = proofFile(binding, options.policyFingerprint);
  const bytes = JSON.stringify({ ...payload, signature: crypto.createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex") });
  try { fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}
export function readPublicationImageDefect(manifest: BrandPostPackageManifestV2, sectionId: string, sha256: string, policy: string):
  { proof: PublicationImageDefectProof | ScopedPublicationImageDefectProof; path: string; sha256: string } | null {
  try {
    const binding = currentBinding(manifest, sectionId, sha256), key = secret(false);
    if (!binding || !key) return null;
    const file = proofFile(binding, policy); if (fs.statSync(file).size > 192 * 1024) return null;
    const bytes = fs.readFileSync(file), row = JSON.parse(bytes.toString("utf8")) as PublicationImageDefectProof | ScopedPublicationImageDefectProof;
    const { signature, ...payload } = row;
    if (row.policyFingerprint !== policy || !valid(row.requestBindingSha256) ||
        !valid(signature) || JSON.stringify(row.binding) !== JSON.stringify(binding) ||
        !crypto.timingSafeEqual(Buffer.from(signature, "hex"), crypto.createHmac("sha256", key).update(JSON.stringify(payload)).digest())) return null;
    if (row.version === "publication-image-conflicting-print/v2") {
      if (!isCorroboratedNativeIdentifierConflict(row.identifierConflict, sha256, row.comparison, row.comparisonContext)) return null;
    } else if (row.version !== "publication-image-print-defect/v4" || scopedDefectIssue(row, manifest)) return null;
    return { proof: row, path: file, sha256: hash(bytes) };
  } catch { return null; }
}
export function readPublicationImageRepairPlan(parentSha256: string): { outStem: string; contextSha256: string } | null {
  try {
    const key = secret(false); if (!key || !valid(parentSha256)) return null;
    const row = JSON.parse(fs.readFileSync(path.join(directory(), `plan-${parentSha256}.json`), "utf8"));
    const { signature, ...payload } = row;
    if (payload.version !== "publication-image-repair-plan/v1" || payload.parentSha256 !== parentSha256 || typeof payload.outStem !== "string" ||
        !valid(payload.contextSha256) || !valid(signature) || !crypto.timingSafeEqual(Buffer.from(signature, "hex"),
          crypto.createHmac("sha256", key).update(JSON.stringify(payload)).digest())) return null;
    return { outStem: payload.outStem, contextSha256: payload.contextSha256 };
  } catch { return null; }
}
/** First frozen improved plan consumes this parent. A changed plan cannot mint
 * another request even if only metadata (and no transport journal) survived. */
export function sealPublicationImageRepairPlan(parentSha256: string, outStem: string, contextSha256: string): void {
  if (!valid(parentSha256) || !valid(contextSha256)) throw new Error("IMAGE_RESUME_REQUIRED: Invalid repair plan binding");
  const file = path.join(directory(), `plan-${parentSha256}.json`), key = secret(false);
  if (!key) throw new Error("IMAGE_RESUME_REQUIRED: Missing native repair authority");
  const payload = { version: "publication-image-repair-plan/v1", parentSha256, outStem, contextSha256 };
  const bytes = JSON.stringify({ ...payload, signature: crypto.createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex") });
  try { fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const saved = readPublicationImageRepairPlan(parentSha256);
  if (!saved || saved.outStem !== outStem || saved.contextSha256 !== contextSha256)
    throw new Error("IMAGE_RESUME_REQUIRED: 이전 최종 거절의 단일 개선 계획이 다릅니다. 추가 생성하지 않았습니다.");
}
