import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrandPostPackageManifest } from "./brand-post-package";
import { publicationImageAuditPolicyFingerprint } from "../../scripts/lib/publish-image-audit";
import { readSuccessfulImageAuditReadinessBinding } from "../../scripts/lib/publish-image-audit-receipt";
import { readProductPhotoSource } from "../../scripts/lib/product-photo-provenance";
import { COMPATIBLE_STRICT_PUBLICATION_POLICIES } from "../../scripts/lib/lightweight-publication-review";

/** Exact saved input binding for the signed successful pixel-audit receipt.
 * Progress/approval timestamps never change the content being reviewed.
 * Missing files are deliberately bound as missing, then local readiness rejects
 * them; adding/replacing a file or gallery receipt invalidates that binding. */
export function brandPostApprovalBinding(manifest: BrandPostPackageManifest, sourceDirectory: string,
  policy = publicationImageAuditPolicyFingerprint()): string {
  return brandPostApprovalBindingsForPolicies(manifest, sourceDirectory, [policy])[0];
}

/** Same bytes as brandPostApprovalBinding per policy, but each bound file is
 * read once and fed to every policy's hash (one disk pass, identical output). */
function brandPostApprovalBindingsForPolicies(manifest: BrandPostPackageManifest, sourceDirectory: string,
  policies: readonly string[]): string[] {
  const { approvedAt: _approval, imageGeneration: _progress, textQualityRevalidation, ...content } = manifest;
  void _approval; void _progress;
  const { checkedAt: _textCheckTime, ...textBinding } = textQualityRevalidation || {};
  void _textCheckTime;
  const hashes = policies.map(policy => {
    const hash = crypto.createHash("sha256");
    hash.update(JSON.stringify({ version: "saved-material-publication-audit/v1",
      policy, content,
      ...(textQualityRevalidation ? { textQualityRevalidation: textBinding } : {}) }));
    return hash;
  });
  const update = (data: string | Buffer) => { for (const hash of hashes) hash.update(data); };
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
    update(JSON.stringify({ file: path.resolve(file) }));
    try { update(fs.readFileSync(file)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      update("missing-file");
    }
  }
  return hashes.map(hash => hash.digest("hex"));
}

/** Read-only migration: historical strict success remains valid only for the
 * exact same manuscript, selected facts, pixels and source/retrieval files. */
export function brandPostCompatibleApprovalBindings(manifest: BrandPostPackageManifest, sourceDirectory: string): string[] {
  return brandPostApprovalBindingsForPolicies(manifest, sourceDirectory, [...COMPATIBLE_STRICT_PUBLICATION_POLICIES]);
}

/** [current, ...compatible] bindings from a single read of the bound files. */
export function brandPostAllApprovalBindings(manifest: BrandPostPackageManifest, sourceDirectory: string): string[] {
  return brandPostApprovalBindingsForPolicies(manifest, sourceDirectory,
    [publicationImageAuditPolicyFingerprint(), ...COMPATIBLE_STRICT_PUBLICATION_POLICIES]);
}

export function hasCurrentBrandPostApprovalReceipt(manifest: BrandPostPackageManifest, sourceDirectory: string): boolean {
  if (manifest.connectKind !== "SHOPPING") return true;
  if (manifest.version !== "brand-post-package/v2") return false;
  try { return brandPostAllApprovalBindings(manifest, sourceDirectory)
    .some(binding => readSuccessfulImageAuditReadinessBinding(manifest.brandLinkId, binding)); }
  catch { return false; }
}
