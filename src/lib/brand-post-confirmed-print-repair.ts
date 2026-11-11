import fs from "node:fs";
import crypto from "node:crypto";
import { publicationDefectMaterialBinding, readPublicationImageDefect } from "../../scripts/lib/publication-image-defect-proof";
import { publicationImageAuditPolicyFingerprint } from "../../scripts/lib/publish-image-audit";
import type { BrandPostPackageManifestV2 } from "./brand-post-package";
import type { BrandPostImageGenerationRequest } from "./brand-post-image-generation";

const hash = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const hold = () => Object.assign(new Error("현재 서명된 인쇄 결함과 사진·원고의 정확한 연결을 확인하지 못했습니다. 기존 사진을 보존했습니다."), { code: "IMAGE_RESUME_REQUIRED" });

/** Synchronous bounded reads detect replacement as well as changed bytes. */
function stableHash(file: string, maximum: number): string {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size < BigInt(1) || before.size > BigInt(maximum)) throw hold();
  const bytes = fs.readFileSync(file), after = fs.lstatSync(file, { bigint: true });
  if (["dev", "ino", "size", "mtimeNs", "ctimeNs"].some(key => before[key as keyof typeof before] !== after[key as keyof typeof after]) || BigInt(bytes.length) !== before.size) throw hold();
  return hash(bytes);
}

type Dependencies = { policy: typeof publicationImageAuditPolicyFingerprint; readDefect: typeof readPublicationImageDefect };

/** Routing is server-owned. Error prose, supplied keys and a locator alone
 * authorize nothing. The generator still verifies the exact completed origin,
 * mandatory print reference and sealed one-child budget before dispatch. */
export function planConfirmedPrintRepairs(manifest: BrandPostPackageManifestV2, dependencies: Dependencies = {
  policy: publicationImageAuditPolicyFingerprint, readDefect: readPublicationImageDefect,
}): { requests: BrandPostImageGenerationRequest[]; materialBinding: string; policyFingerprint: string;
  proofs: { sectionId: string; assetKey: string; proofSha256: string }[] } {
  const materialBinding = publicationDefectMaterialBinding(manifest), policyFingerprint = dependencies.policy();
  if (!/^[a-f0-9]{64}$/u.test(policyFingerprint) || manifest.connectKind !== "SHOPPING") throw hold();
  const requests: BrandPostImageGenerationRequest[] = [], proofs: { sectionId: string; assetKey: string; proofSha256: string }[] = [];
  const seen = new Set<string>();
  for (const asset of manifest.imageAssets || []) {
    if (asset.role !== "body" || !asset.sectionId || !asset.slotId || asset.provenance !== "GENERATED_SCENE" ||
        asset.creationMethod !== "reference-guided-scene" || asset.remoteGenerated !== true || !/^[a-f0-9]{64}$/u.test(asset.sha256)) continue;
    const authority = dependencies.readDefect(manifest, asset.sectionId, asset.sha256, policyFingerprint);
    if (!authority) continue;
    const proof = authority.proof;
    if (proof.version !== "publication-image-print-defect/v4" || proof.policyFingerprint !== policyFingerprint ||
        proof.binding.material !== materialBinding || proof.binding.sha256 !== asset.sha256 || proof.binding.sectionId !== asset.sectionId ||
        proof.binding.slotId !== asset.slotId || proof.identifierReview.status !== "conflict" || proof.identifierReview.nativeExecution !== true ||
        Boolean(proof.identifierReview.identifierConflict) === Boolean(proof.identifierReview.missingPrintEvidence)) throw hold();
    const matches = manifest.imageAssets!.filter(row => row.role === "body" && row.sectionId === asset.sectionId && row.slotId === asset.slotId);
    if (matches.length !== 1 || !asset.sourcePath || stableHash(asset.path, 24 * 1024 * 1024) !== asset.sha256 ||
        stableHash(asset.sourcePath, 24 * 1024 * 1024) !== asset.sha256 || stableHash(authority.path, 192 * 1024) !== authority.sha256 ||
        seen.has(asset.slotId) || requests.length >= 12) throw hold();
    seen.add(asset.slotId);
    requests.push({ requestId: crypto.randomUUID(), sectionId: asset.sectionId, slotId: asset.slotId, replaceAssetKey: asset.sha256 });
    proofs.push({ sectionId: asset.sectionId, assetKey: asset.sha256, proofSha256: authority.sha256 });
  }
  if (dependencies.policy() !== policyFingerprint || publicationDefectMaterialBinding(manifest) !== materialBinding) throw hold();
  return { requests, materialBinding, policyFingerprint, proofs };
}
