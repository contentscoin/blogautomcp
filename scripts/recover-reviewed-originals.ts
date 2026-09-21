/** Offline only. A review plan is explicit input, never an inferred QC bypass.
 * Usage: ts-node --project tsconfig.scripts.json scripts/recover-reviewed-originals.ts plan.json [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { acquireBrandPostImageRepairLock } from "../src/lib/brand-post-image-repair-lock";
import { readSavedProductSourceCandidates } from "./lib/product-photo-source";
import { allowsOriginalShoppingScene, allowsGenericBrandPostProductPhoto } from "../src/lib/brand-post-image-evidence";
import { applyGeneratedBrandPostImage, evaluateBrandPostPackageReadiness, getBrandPostPackageDir,
  getBrandPostImageGenerationState,
  normalizePackageImageAssets, readBrandPostPackage, reconcileBrandPostPackageQuality,
  writeBrandPostPackageManifest } from "../src/lib/brand-post-package";

interface ReviewedOriginal {
  brandLinkId: string;
  sectionId: string;
  sourceSha256: string;
  reviewClass: "scene-evidence" | "feature-evidence" | "product-photo";
  reason: string;
  reviewedAt: string;
  /** Explicit replacement of the one existing image, never an implicit overwrite. */
  expectedReplacementSha256?: string;
}

const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function run() {
  const [planFile, flag] = process.argv.slice(2);
  if (!planFile || (flag && flag !== "--apply")) throw new Error("Expected reviewed plan JSON [--apply]");
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8")) as ReviewedOriginal[];
  if (!Array.isArray(plan) || !plan.length || plan.length > 20) throw new Error("Expected 1-20 explicit reviews");
  const results = [];
  for (const id of new Set(plan.map(row => row.brandLinkId))) {
    // The lock is only acquired for a mutation; dry-run never writes user data.
    const lock = flag ? acquireBrandPostImageRepairLock(id, { purpose: "offline-reviewed-original-recovery" }) : null;
    let rollback: ReturnType<typeof readBrandPostPackage> = null;
    let mutated = false;
    try {
      const original = readBrandPostPackage(id, { migrate: false });
      if (!original || original.version !== "brand-post-package/v2" || original.approvedAt ||
          getBrandPostImageGenerationState(original)?.status === "running") throw new Error(`Inactive unapproved draft required: ${id}`);
      const manifest = reconcileBrandPostPackageQuality({ ...original, imageGeneration: getBrandPostImageGenerationState(original) });
      if (manifest.connectKind !== "SHOPPING" || manifest.imagePolicy !== "LOCKED_PRODUCT_OR_ORIGINAL" || manifest.imageRequirements?.policy === "generated-required")
        throw new Error("Original recovery requires a mixed shopping image policy");
      const root = getBrandPostPackageDir(id);
      const assets = normalizePackageImageAssets(manifest);
      const candidates = readSavedProductSourceCandidates(path.join(root, "product-sources"));
      const claimed = new Set(assets.filter(asset => asset.role === "hero" || asset.sectionId).map(asset => asset.sha256));
      const sectionIds = new Set<string>();
      const released = new Set<string>();
      const rows = plan.filter(row => row.brandLinkId === id).map(row => {
        if (!/^[a-f0-9]{64}$/u.test(row.sourceSha256) || !row.reason?.trim() || !Number.isFinite(Date.parse(row.reviewedAt)) ||
            !["scene-evidence", "feature-evidence", "product-photo"].includes(row.reviewClass)) throw new Error("Incomplete explicit visual review");
        const section = manifest.composition.sections.find(section => section.id === row.sectionId);
        const currentAsset = assets.find(asset => asset.sectionId === row.sectionId && asset.sha256 === row.sourceSha256 &&
          asset.provenance === "ORIGINAL" && asset.creationMethod === "source");
        const refresh = Boolean(currentAsset && section?.imagePaths.length === 1 && section.imagePaths[0] === currentAsset.path);
        const replacement = row.expectedReplacementSha256 ? assets.find(asset => asset.sectionId === row.sectionId &&
          asset.sha256 === row.expectedReplacementSha256 && asset.role === "body" && section?.imagePaths.length === 1 &&
          section.imagePaths[0] === asset.path) : undefined;
        if (row.expectedReplacementSha256 && !replacement) throw new Error("Replacement guard does not match the current section image");
        if (!section || (section.imagePaths.length && !refresh && !replacement) || sectionIds.has(section.id)) throw new Error("Expected empty section, same-byte re-review, or guarded replacement");
        if (allowsOriginalShoppingScene(section) !== (row.reviewClass === "scene-evidence")) throw new Error("Review class does not match scene intent");
        if (row.reviewClass === "product-photo" && !allowsGenericBrandPostProductPhoto({ sectionTitle: section.title, imageIntent: section.imageIntent }))
          throw new Error(`Generic photo cannot prove this feature intent: ${section.id}`);
        if (claimed.has(row.sourceSha256) && !refresh) throw new Error(`Source bytes already assigned: ${row.sourceSha256}`);
        const source = candidates.find(file => sha(file) === row.sourceSha256);
        if (!source) throw new Error("Intact seller download receipt and matching bytes required");
        if (replacement) { claimed.delete(replacement.sha256); released.add(replacement.sha256); }
        claimed.add(row.sourceSha256); sectionIds.add(section.id);
        const asset = currentAsset || assets.find(asset => asset.sha256 === row.sourceSha256 && asset.role === "body" && !asset.sectionId && !released.has(asset.sha256));
        return { row, section, source, asset, refresh, replacement };
      });
      const before = evaluateBrandPostPackageReadiness(original);
      let after = evaluateBrandPostPackageReadiness(manifest);
      let backup: string | undefined;
      if (lock) {
        lock.assertOwner();
        const current = readBrandPostPackage(id, { migrate: false });
        if (JSON.stringify(current) !== JSON.stringify(original)) throw new Error("Draft changed during planning");
        backup = path.join(root, `manifest.before-original-recovery-${Date.now()}.json`);
        fs.copyFileSync(path.join(root, "manifest.json"), backup, fs.constants.COPYFILE_EXCL);
        rollback = original;
        mutated = true;
        writeBrandPostPackageManifest(manifest);
        for (const { row, section, source, asset, refresh, replacement } of rows) {
          lock.assertOwner();
          const updated = applyGeneratedBrandPostImage({ brandLinkId: id, sectionId: section.id,
            slotId: `${section.id}:image:1`, generatedPath: asset?.path || source,
            ...(asset ? { bindExistingAssetKey: asset.sha256 } : {}),
            ...(refresh ? { replaceAssetKey: row.sourceSha256 } : replacement ? { replaceAssetKey: replacement.sha256 } : {}),
            provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false,
            imageIntent: section.imageIntent,
            sourceReview: { version: "product-photo-source-review/v1", sourceSha256: row.sourceSha256,
              usage: "section-matched-product-evidence", sectionIntent: section.imageIntent,
              reviewClass: row.reviewClass, reason: row.reason, reviewedAt: row.reviewedAt },
          });
          after = evaluateBrandPostPackageReadiness(updated);
          const slot = after.imageSlots.find(slot => slot.sectionId === section.id);
          if (!slot || slot.missing || slot.generationMissing || slot.staleTargets.length) throw new Error("Applied original failed slot audit; backup retained");
        }
      }
      results.push({ id, applied: Boolean(flag), backup, assignments: rows.map(({ row, section }) => ({ ...row, imageIntent: section.imageIntent })),
        before: before.imageSlots.filter(slot => slot.missing || slot.generationMissing),
        after: after.imageSlots.filter(slot => slot.missing || slot.generationMissing), canApprove: after.canApprove });
    } catch (error) {
      if (mutated && rollback && lock) {
        lock.assertOwner();
        writeBrandPostPackageManifest(rollback);
      }
      throw error;
    } finally { lock?.release(); }
  }
  console.log(JSON.stringify(results, null, 2));
}
if (require.main === module) { try { run(); } catch (error) { console.error(error); process.exitCode = 1; } }
