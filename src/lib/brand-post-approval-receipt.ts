import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrandPostPackageManifest } from "./brand-post-package";
import { publicationImageAuditPolicyFingerprint } from "../../scripts/lib/publish-image-audit";
import { readSuccessfulImageAuditReadinessBinding } from "../../scripts/lib/publish-image-audit-receipt";
import { readProductPhotoSource } from "../../scripts/lib/product-photo-provenance";

/** Exact saved input binding for the signed successful pixel-audit receipt.
 * Progress/approval timestamps never change the content being reviewed.
 * Missing files are deliberately bound as missing, then local readiness rejects
 * them; adding/replacing a file or gallery receipt invalidates that binding. */
export function brandPostApprovalBinding(manifest: BrandPostPackageManifest, sourceDirectory: string): string {
  const { approvedAt: _approval, imageGeneration: _progress, textQualityRevalidation, ...content } = manifest;
  void _approval; void _progress;
  const { checkedAt: _textCheckTime, ...textBinding } = textQualityRevalidation || {};
  void _textCheckTime;
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify({ version: "saved-material-publication-audit/v1",
    policy: publicationImageAuditPolicyFingerprint(), content,
    ...(textQualityRevalidation ? { textQualityRevalidation: textBinding } : {}) }));
  const files = new Set([manifest.markdownPath, manifest.heroImagePath, ...manifest.bodyImagePaths,
    ...(manifest.imageAssets || []).flatMap(asset => [asset.path, asset.sourcePath,
      asset.referenceScene?.referencePath, asset.referenceScene?.thumbnailRawPath].filter((file): file is string => Boolean(file))),
    ...(manifest.version === "brand-post-package/v2" ? manifest.composition.sections.flatMap(section => section.imagePaths) : [])]);
  for (const asset of manifest.imageAssets || []) {
    files.add(`${asset.path}.source.json`);
    const original = readProductPhotoSource(asset.path);
    if (original) files.add(original.sourcePath);
  }
  // The reviewer chooses comparisons from these server-owned retrieval pairs.
  // Bind their full membership too: a newly cached comparison must invalidate an
  // old readiness decision even when all previously selected files survive.
  try {
    for (const name of fs.readdirSync(sourceDirectory).filter(name => name.endsWith(".retrieval.json")).sort()) {
      files.add(path.join(sourceDirectory, name));
      files.add(path.join(sourceDirectory, name.slice(0, -".retrieval.json".length)));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const file of [...files].filter(Boolean).sort()) {
    hash.update(JSON.stringify({ file: path.resolve(file) }));
    try { hash.update(fs.readFileSync(file)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("missing-file");
    }
  }
  return hash.digest("hex");
}

export function hasCurrentBrandPostApprovalReceipt(manifest: BrandPostPackageManifest, sourceDirectory: string): boolean {
  if (manifest.connectKind !== "SHOPPING") return true;
  if (manifest.version !== "brand-post-package/v2") return false;
  try { return readSuccessfulImageAuditReadinessBinding(manifest.brandLinkId, brandPostApprovalBinding(manifest, sourceDirectory)); }
  catch { return false; }
}
