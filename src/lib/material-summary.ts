import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getAppDataDir, getProjectRoot } from "../../scripts/lib/app-paths";
import { PUBLICATION_IMAGE_AUDIT_POLICY_FILES } from "../../scripts/lib/publish-image-audit";
import { getBrandPostImageGenerationState, type BrandPostPackageManifest } from "./brand-post-package";
import type { MaterialLibraryRecord } from "./material-library";

export type MaterialSummary = MaterialLibraryRecord & {
  verification: { mode: "saved-summary"; strict: false; observedAt: string; contentCheckedAt: string | null;
    requiresFullVerification: true; changedSinceObservation: boolean; missingRequiredFiles: number;
    lastStrictCheckAt?: string; lastStrictResult?: "ready" | "blocked" };
};
const MAX_SUMMARIES = 256;
const MAX_DEPENDENCIES = 4096;
type StrictObservation = Pick<MaterialLibraryRecord, "ready" | "blockers" | "score" | "imageCount" | "preparationDiagnostics"> & { checkedAt: string };
type SummaryEntry = { signature: string; value: MaterialSummary; strictObservation?: StrictObservation };
const cache = new Map<string, SummaryEntry>();
const pending = new Map<string, Promise<MaterialSummary | null>>();

function displaySummary(entry: SummaryEntry, observedAt: string): MaterialSummary {
  const { strictObservation: observation, value } = entry;
  if (!observation) return { ...value, verification: { ...value.verification, observedAt } };
  const { checkedAt, ...diagnostics } = observation;
  return { ...value, ...diagnostics, blockers: [...diagnostics.blockers], verification: { ...value.verification, observedAt,
    changedSinceObservation: false, lastStrictCheckAt: checkedAt, lastStrictResult: observation.ready ? "ready" : "blocked" } };
}

async function fileStamp(file: string): Promise<string> {
  try {
    const stat = await fs.stat(file, { bigint: true });
    return `${file}\0${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.mode}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return `${file}\0missing`;
    throw error;
  }
}

async function metadataSignature(manifest: BrandPostPackageManifest, manifestBytes: string, directory: string) {
  const receiptFile = path.join(getAppDataDir(), "publication-image-audit-receipts", `${crypto.createHash("sha256").update(manifest.brandLinkId).digest("hex")}.json`);
  const signingKeyFile = path.join(getAppDataDir(), "publication-image-audit-receipts", ".signing-key");
  const policyFiles = PUBLICATION_IMAGE_AUDIT_POLICY_FILES.map(relative => path.join(getProjectRoot(), relative));
  const used = new Set([manifest.heroImagePath,
    ...(manifest.version === "brand-post-package/v2" ? manifest.composition.sections.flatMap(section => section.imagePaths) : manifest.bodyImagePaths),
  ].map(file => path.resolve(file)));
  const required = new Set([manifest.markdownPath, ...used,
    ...(manifest.imageAssets || []).filter(asset => used.has(path.resolve(asset.path))).flatMap(asset => [
      asset.referenceScene?.referencePath, asset.referenceScene?.thumbnailRawPath].filter((file): file is string => Boolean(file))),
    ...(manifest.approvedAt && manifest.connectKind === "SHOPPING" ? [receiptFile, signingKeyFile, ...policyFiles] : []),
  ].map(file => path.resolve(file)));
  const files = new Set<string>([manifest.markdownPath, manifest.heroImagePath, ...manifest.bodyImagePaths,
    ...(manifest.imageAssets || []).flatMap(asset => [asset.path, `${asset.path}.source.json`, asset.sourcePath,
      asset.referenceScene?.referencePath, asset.referenceScene?.thumbnailRawPath].filter((file): file is string => Boolean(file))),
    ...(manifest.version === "brand-post-package/v2" ? manifest.composition.sections.flatMap(section => section.imagePaths) : []),
    path.join(directory, "publish-image-rejections.json"),
    receiptFile, signingKeyFile, ...policyFiles,
  ]);
  const sourceDirectory = path.join(directory, "product-sources");
  try {
    // Membership is part of the summary identity too: newly retrieved seller
    // photos must invalidate the UI even if selected photo paths did not change.
    for (const name of await fs.readdir(sourceDirectory)) files.add(path.join(sourceDirectory, name));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (files.size > MAX_DEPENDENCIES) throw new Error("소재 파일 수가 많아 개별 검사가 필요합니다.");
  const hash = crypto.createHash("sha256").update(manifestBytes).update(JSON.stringify(getBrandPostImageGenerationState(manifest)) || "none");
  const sorted = [...files].filter(Boolean).map(file => path.resolve(file)).sort();
  let missingRequiredFiles = 0;
  // Bounded asynchronous stat calls only. Never read photo, manuscript, source
  // gallery, policy source or signing-key bytes on an automatic UI poll.
  for (let offset = 0; offset < sorted.length; offset += 16) {
    const batch = sorted.slice(offset, offset + 16);
    for (const [index, stamp] of (await Promise.all(batch.map(fileStamp))).entries()) {
      hash.update(stamp);
      if (required.has(batch[index]) && stamp.endsWith("\0missing")) missingRequiredFiles++;
    }
  }
  return { signature: hash.digest("hex"), missingRequiredFiles };
}

async function readSummary(productId: string): Promise<MaterialSummary | null> {
  if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(productId)) throw new Error("소재 ID가 올바르지 않습니다.");
  const directory = path.join(getAppDataDir(), "prepared-brand-posts", productId);
  let bytes: string;
  try { bytes = await fs.readFile(path.join(directory, "manifest.json"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { cache.delete(productId); return null; } throw error; }
  const manifest = JSON.parse(bytes) as BrandPostPackageManifest;
  if (!["brand-post-package/v1", "brand-post-package/v2"].includes(manifest.version) || manifest.brandLinkId !== productId)
    throw new Error("준비된 초안 패키지 형식이 올바르지 않습니다.");
  const { signature, missingRequiredFiles } = await metadataSignature(manifest, bytes, directory);
  const previous = cache.get(productId);
  const observedAt = new Date().toISOString();
  if (previous?.signature === signature) {
    cache.delete(productId); cache.set(productId, previous);
    return displaySummary(previous, observedAt);
  }
  const blockers: string[] = [];
  if (missingRequiredFiles) blockers.push(`저장된 원고·사진·검사 근거 파일 ${missingRequiredFiles}개를 찾을 수 없습니다. 개별 검사가 필요합니다.`);
  const quality = manifest.contentQuality;
  if (!manifest.approvedAt) blockers.push("저장된 승인 이력이 없습니다. 소재 준비·검사를 완료하세요.");
  if (!quality || quality.canPublish === false) blockers.push("저장된 원고 검사 결과를 확인하세요.");
  if (manifest.version !== "brand-post-package/v2" || !manifest.composition.qualityReport.canAutoPublish)
    blockers.push("저장된 구성 검사 결과를 확인하세요.");
  const generation = getBrandPostImageGenerationState(manifest);
  if (generation?.status === "running") blockers.push("이미지 준비 작업이 진행 중입니다.");
  const imageCount = manifest.version === "brand-post-package/v2"
    ? manifest.composition.renderNodes.filter(node => node.kind === "image").length : 1 + manifest.bodyImagePaths.length;
  const changed = Boolean(previous && previous.signature !== signature);
  const value: MaterialSummary = {
    productId, revision: signature, title: manifest.title, connectKind: manifest.connectKind,
    createdAt: manifest.createdAt, approvedAt: manifest.approvedAt, ready: blockers.length === 0, blockers,
    score: quality?.quality?.score ?? quality?.score ?? null, imageCount,
    ...(generation ? { imageGeneration: { status: generation.status, requested: generation.requested, applied: generation.applied,
      remaining: generation.remaining, updatedAt: generation.updatedAt, ...(generation.heartbeatAt ? { heartbeatAt: generation.heartbeatAt } : {}),
      ...(generation.recoveryState ? { recoveryState: generation.recoveryState } : {}) } } : {}),
    verification: { mode: "saved-summary", strict: false, observedAt, contentCheckedAt: manifest.textQualityRevalidation?.checkedAt || manifest.approvedAt || null,
      requiresFullVerification: true, changedSinceObservation: changed, missingRequiredFiles },
  };
  cache.delete(productId); cache.set(productId, { signature, value });
  while (cache.size > MAX_SUMMARIES) cache.delete(cache.keys().next().value!);
  return value;
}

/** Display-only projection. Its revision is an observation token, never an
 * authorization or publication revision. getMaterial remains byte-strict. */
export function getMaterialSummary(productId: string): Promise<MaterialSummary | null> {
  const existing = pending.get(productId);
  if (existing) return existing;
  if (pending.size >= MAX_SUMMARIES) return Promise.reject(new Error("소재 요약 조회가 많아 잠시 후 다시 확인하세요."));
  const reading = readSummary(productId).finally(() => { if (pending.get(productId) === reading) pending.delete(productId); });
  pending.set(productId, reading);
  return reading;
}

/** A deliberately requested byte-strict selection check may improve the UI's
 * latest diagnostics for exactly the metadata observed before and after it.
 * This bounded, memory-only note is never read by getMaterial or publication. */
export function observeStrictMaterialSummary(productId: string, expectedRevision: string, material: MaterialLibraryRecord): boolean {
  const entry = cache.get(productId);
  if (!entry || entry.signature !== expectedRevision || material.productId !== productId || !/^[a-f0-9]{64}$/u.test(material.revision)) return false;
  entry.strictObservation = { ready: material.ready, blockers: [...material.blockers], score: material.score,
    imageCount: material.imageCount, ...(material.preparationDiagnostics ? { preparationDiagnostics: material.preparationDiagnostics } : {}),
    checkedAt: new Date().toISOString() };
  return true;
}
