import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readBrandPostPackage, getBrandPostPackageDir } from "../../src/lib/brand-post-package";
import { readOriginalPhotoClaimDefect } from "./publication-image-defect-proof";
import { publicationImageAuditPolicyFingerprint } from "./publish-image-audit";

const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
export interface SellerOriginalRecoveryScope {
  version: "seller-original-recovery-scope/v1";
  identity: { productId: string; sectionId: string; slotId: string; sha256: string; context: string; sourceSnapshotId: string;
    canonicalReceipts: Array<{ sourceUrl: string; sourceSha256: string }> };
  binding: string;
  /** Trace only: a new audit/policy/timestamp never renews the same source scope. */
  nativeProof: { path: string; sha256: string; materialContext: { file: string; sha256: string } };
}

/** Receipts remain admission evidence, never a budget-renewal knob. Multiple
 * canonical URLs may retrieve identical original pixels in one frozen source
 * snapshot, so their mutable cache aliases are deliberately excluded. */
export function sellerOriginalRecoveryBudgetBinding(identity: SellerOriginalRecoveryScope["identity"]): string {
  const { productId, sectionId, slotId, sha256, context, sourceSnapshotId } = identity;
  return hash(JSON.stringify({ productId, sectionId, slotId, sha256, context, sourceSnapshotId }));
}

/** Only a current native A/B/D-positive, C-only-negative canonical ORIGINAL
 * proof can reach source-stage admission. A generic rejection/diagnosis cannot.
 * This reads immutable proof/context; it neither signs nor mutates anything. */
export function readSellerOriginalRecoveryScope(id: string, sectionId: string): SellerOriginalRecoveryScope | null {
  try {
    const manifest = readBrandPostPackage(id, { migrate: false });
    if (!manifest || manifest.version !== "brand-post-package/v2" || manifest.connectKind !== "SHOPPING" ||
        manifest.imageGeneration?.status === "running" || manifest.imageGeneration?.recoveryState === "owner-unknown") return null;
    const originals = (manifest.imageAssets || []).filter(asset => asset.sectionId === sectionId && asset.role === "body" &&
      asset.provenance === "ORIGINAL" && asset.creationMethod === "source" && asset.remoteGenerated !== true && !asset.referenceScene);
    if (originals.length !== 1) return null;
    const current = readOriginalPhotoClaimDefect(manifest, sectionId, originals[0].sha256, publicationImageAuditPolicyFingerprint());
    if (!current) return null;
    const sourceDirectory = path.join(getBrandPostPackageDir(id), "product-sources");
    const receipts = current.proof.binding.canonicalReceipts.map(row => {
      if (path.basename(row.file) !== row.file) throw new Error("Invalid source receipt path");
      const bytes = fs.readFileSync(path.join(sourceDirectory, row.file));
      if (hash(bytes) !== row.sha256) throw new Error("Source receipt changed");
      const receipt = JSON.parse(bytes.toString("utf8"));
      if (receipt.sha256 !== originals[0].sha256 || typeof receipt.sourceUrl !== "string") throw new Error("Source receipt mismatch");
      return { sourceUrl: receipt.sourceUrl as string, sourceSha256: receipt.sha256 as string };
    });
    // Exact proof retains each receipt's bytes/path. Admission trace retains
    // every distinct canonical URL; none can renew the stable source budget.
    const canonicalReceipts = [...new Map(receipts.map(receipt => [JSON.stringify(receipt), receipt])).values()]
      .sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl) || left.sourceSha256.localeCompare(right.sourceSha256));
    const identity = { productId: id, sectionId, slotId: current.proof.binding.slotId, sha256: originals[0].sha256,
      context: current.proof.binding.context, sourceSnapshotId: current.proof.binding.sourceSnapshotId, canonicalReceipts };
    return { version: "seller-original-recovery-scope/v1", identity, binding: sellerOriginalRecoveryBudgetBinding(identity),
      nativeProof: { path: current.path, sha256: current.sha256, materialContext: current.proof.materialContext } };
  } catch { return null; }
}
