import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "../../scripts/lib/app-paths";
import { readCanonicalSellerSourceHashes } from "../../scripts/lib/canonical-seller-source";
import { buildSelectedProductImageAuditContext } from "../../scripts/lib/publish-image-audit";
import { reviewShoppingReferenceScene, selectShoppingSceneReference } from "../../scripts/lib/shopping-reference-scene";
import { atomicWriteTextFile } from "./atomic-text-file";
import { brandPostReferenceSceneIssue, getBrandPostPackageDir, type BrandPostPackageManifestV2 } from "./brand-post-package";
import { acquireBrandPostImageRepairLock } from "./brand-post-image-repair-lock";
import { readProductSnapshot } from "./draft-context-snapshot";
import { REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "./brand-post-image-evidence";

type RestoreOptions = { brandLinkId: string; backupJobId: unknown; sectionId: unknown; currentAssetKey: unknown; retainedSha256: unknown };
const hash = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
const invalid = (): never => { throw Object.assign(new Error("RETAINED_SCENE_RESTORE_INVALID: 같은 원고·상품의 공식 백업과 정확한 기존 사진 슬롯을 확인할 수 없습니다."), { code: "RETAINED_SCENE_RESTORE_INVALID" }); };
const changed = (): never => { throw Object.assign(new Error("RETAINED_SCENE_RESTORE_CHANGED: 복원 검수 중 원고·사진·참조·백업이 변경되어 기존 상태를 보존했습니다."), { code: "RETAINED_SCENE_RESTORE_CHANGED" }); };

/** Explicit one-slot restoration from an owned material backup. No archive
 * search, source collection, image generation, or approval authority. */
export function planRetainedBrandPostSceneRestoration(options: RestoreOptions) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(options.brandLinkId) || typeof options.backupJobId !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(options.backupJobId) ||
      typeof options.sectionId !== "string" || !options.sectionId || typeof options.currentAssetKey !== "string" ||
      !/^[a-f0-9]{64}$/u.test(options.currentAssetKey) || typeof options.retainedSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(options.retainedSha256) || options.currentAssetKey === options.retainedSha256) return invalid();
  const root = path.resolve(getBrandPostPackageDir(options.brandLinkId)), appData = getAppDataDir();
  const backup = path.join(appData, "material-rewrite-backups", options.backupJobId, options.brandLinkId);
  const files = new Map<string, string>();
  const read = (base: string, file: string, maximum = 24 * 1024 * 1024): Buffer => {
    const resolved = path.resolve(file), relative = path.relative(path.resolve(base), resolved);
    try {
      const stat = fs.lstatSync(resolved);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !stat.isFile() || stat.isSymbolicLink() ||
          stat.size < 1 || stat.size > maximum || path.resolve(fs.realpathSync(resolved)).toLowerCase() !== resolved.toLowerCase()) return invalid();
      const bytes = fs.readFileSync(resolved); files.set(resolved, hash(bytes)); return bytes;
    } catch { return invalid(); }
  };
  const json = (base: string, file: string) => { try { return JSON.parse(read(base, file, 2 * 1024 * 1024).toString("utf8")); } catch { return invalid(); } };
  const job = json(appData, path.join(appData, "material-jobs", `${options.backupJobId}.json`));
  if (job.jobId !== options.backupJobId || !["repair", "rewrite"].includes(job.kind) ||
      !["completed", "partial", "failed", "interrupted"].includes(job.status) ||
      job.items?.filter((item: { productId?: string; backupCreated?: boolean }) => item.productId === options.brandLinkId && item.backupCreated === true).length !== 1) return invalid();
  const manifestPath = path.join(root, "manifest.json"), currentBytes = read(root, manifestPath, 2 * 1024 * 1024);
  let current: BrandPostPackageManifestV2;
  try { current = JSON.parse(currentBytes.toString("utf8")); } catch { return invalid(); }
  const previous = json(backup, path.join(backup, "manifest.json")) as BrandPostPackageManifestV2;
  if (current.version !== "brand-post-package/v2" || previous.version !== current.version || current.connectKind !== "SHOPPING" ||
      previous.connectKind !== current.connectKind || current.brandLinkId !== options.brandLinkId || previous.brandLinkId !== options.brandLinkId ||
      !previous.approvedAt || !Number.isFinite(Date.parse(previous.approvedAt)) ||
      current.imageGeneration?.status === "running" || current.imageGeneration?.recoveryState === "owner-unknown" ||
      !readProductSnapshot(current.sourceSnapshot, { productId: options.brandLinkId, connectKind: "SHOPPING" })) return invalid();
  const textIdentity = (manifest: BrandPostPackageManifestV2) => JSON.stringify({ createdAt: manifest.createdAt, title: manifest.title,
    markdownSha256: manifest.markdownSha256, hashtags: manifest.hashtags, sourceSnapshot: manifest.sourceSnapshot, productUnderstanding: manifest.productUnderstanding,
    imagePolicy: manifest.imagePolicy, imageRequirements: manifest.imageRequirements, contractVersion: manifest.contractVersion,
    sections: manifest.composition.sections.map(section => ({ ...section, imagePaths: [] })),
    textNodes: manifest.composition.renderNodes.filter(node => node.kind !== "image") });
  if (textIdentity(current) !== textIdentity(previous) || !current.markdownSha256 || hash(read(root, current.markdownPath)) !== current.markdownSha256 ||
      hash(read(backup, path.join(backup, path.relative(root, previous.markdownPath)))) !== current.markdownSha256) return invalid();
  const retained = previous.imageAssets?.filter(asset => asset.sha256 === options.retainedSha256);
  if (retained?.length !== 1) return invalid();
  const asset = retained[0], section = current.composition.sections.find(item => item.id === options.sectionId);
  if (asset.role !== "body" || asset.sectionId !== options.sectionId || asset.slotId !== `${options.sectionId}:image:1` ||
      asset.provenance !== "GENERATED_SCENE" || asset.creationMethod !== "reference-guided-scene" || asset.remoteGenerated !== true ||
      !asset.referenceScene || brandPostReferenceSceneIssue(previous, asset) || !section || section.imageSource !== "staged-ai" || section.imagePaths.length !== 1) return invalid();
  const scene = asset.referenceScene;
  for (const [file, expected] of [[asset.path, asset.sha256], [asset.sourcePath, asset.sha256], [scene.referencePath, scene.referenceSha256]]) {
    if (hash(read(root, file)) !== expected || hash(read(backup, path.join(backup, path.relative(root, file)))) !== expected) return invalid();
  }
  for (const item of current.imageAssets || []) if (hash(read(root, item.path)) !== item.sha256) return invalid();
  const canonical = readCanonicalSellerSourceHashes({ snapshot: current.sourceSnapshot, productId: options.brandLinkId, sourceDirectory: path.join(root, "product-sources") });
  if (!canonical.has(scene.referenceSha256)) return invalid();
  const sourceUrls = new Set((Array.isArray(current.sourceSnapshot!.product.referenceImageUrls) ? current.sourceSnapshot!.product.referenceImageUrls : [])
    .filter((url): url is string => typeof url === "string"));
  const receiptNames = fs.readdirSync(path.join(root, "product-sources")).filter(name => name.endsWith(".retrieval.json"));
  if (receiptNames.length > 256) return invalid();
  let sourceReceipts = 0;
  for (const name of receiptNames) {
    const receiptFile = path.join(root, "product-sources", name);
    let receipt; try {
      const stat = fs.lstatSync(receiptFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 32 * 1024) continue;
      receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
    } catch { continue; }
    if (receipt.sha256 !== scene.referenceSha256 || !sourceUrls.has(receipt.sourceUrl)) continue;
    read(root, receiptFile, 32 * 1024);
    if (hash(read(root, receiptFile.slice(0, -".retrieval.json".length))) !== scene.referenceSha256) return invalid();
    sourceReceipts++;
  }
  if (!sourceReceipts) return invalid();
  const identity = hash(JSON.stringify({ backupJobId: options.backupJobId, productId: options.brandLinkId, sectionId: options.sectionId,
    current: options.currentAssetKey, retained: asset, text: textIdentity(current) }));
  const receiptPath = path.join(root, "retained-scene-restorations", `${identity}.json`);
  if (current.composition.sections.some(other => other.id !== section.id && other.imagePaths.includes(asset.path))) return invalid();
  const restored = current.imageAssets?.filter(item => item.sha256 === asset.sha256);
  if (restored?.length === 1) {
    const receipt = json(root, receiptPath);
    if (JSON.stringify(restored[0]) !== JSON.stringify(asset) || section.imagePaths[0] !== asset.path ||
        current.composition.renderNodes.filter(node => node.kind === "image" && node.sectionId === section.id && node.assetPath === asset.path).length !== 1 ||
        receipt.version !== "retained-scene-restoration/v1" || receipt.identity !== identity || !["reviewed", "restored"].includes(receipt.status) ||
        receipt.sceneReview?.reviewStatus !== "passed" || receipt.sceneReview.reviewedOutputSha256 !== asset.sha256) return invalid();
    return { current, candidate: current, asset, files, manifestPath, currentBytes, identity, receiptPath, alreadyRestored: true };
  }
  const replaceable = current.imageAssets?.filter(item => item.sha256 === options.currentAssetKey);
  if (replaceable?.length !== 1 || replaceable[0].role !== "body" || replaceable[0].sectionId !== options.sectionId ||
      replaceable[0].slotId !== asset.slotId || section.imagePaths[0] !== replaceable[0].path ||
      current.composition.sections.some(other => other.id !== section.id && other.imagePaths.includes(replaceable[0].path)) ||
      current.bodyImagePaths.filter(file => file === replaceable[0].path).length !== 1 ||
      previous.bodyImagePaths.filter(file => file === asset.path).length !== 1 ||
      previous.composition.sections.some(other => other.id !== section.id && other.imagePaths.includes(asset.path))) return invalid();
  const replaced = replaceable[0], nodes = current.composition.renderNodes.filter(node => node.kind === "image" && node.assetPath === replaced.path);
  const oldSection = previous.composition.sections.find(item => item.id === section.id);
  if (nodes.length !== 1 || nodes[0].kind !== "image" || nodes[0].sectionId !== section.id ||
      oldSection?.imagePaths.length !== 1 || oldSection.imagePaths[0] !== asset.path ||
      previous.composition.renderNodes.filter(node => node.kind === "image" && node.sectionId === section.id && node.assetPath === asset.path).length !== 1) return invalid();
  const candidate: BrandPostPackageManifestV2 = { ...current, approvedAt: null,
    imageAssets: current.imageAssets!.map(item => item === replaced ? asset : item),
    bodyImagePaths: current.bodyImagePaths.map(file => file === replaced.path ? asset.path : file),
    composition: { ...current.composition, sections: current.composition.sections.map(item => item === section ? { ...item, imagePaths: [asset.path] } : item),
      renderNodes: current.composition.renderNodes.map(node => node.kind === "image" && node.assetPath === replaced.path ? { ...node, assetPath: asset.path } : node) } };
  return { current, candidate, asset, files, manifestPath, currentBytes, identity, receiptPath, alreadyRestored: false };
}

/** Current source/scene QA precedes an atomic one-slot rebind. The old metadata
 * is retained exactly; fresh approval remains a separate native final audit. */
export async function restoreRetainedBrandPostScene(options: RestoreOptions, dependencies: {
  selectSource?: typeof selectShoppingSceneReference; reviewScene?: typeof reviewShoppingReferenceScene;
} = {}) {
  const lock = acquireBrandPostImageRepairLock(options.brandLinkId, { purpose: "retained-scene-restoration" });
  const heartbeat = setInterval(() => { try { lock.heartbeat(); } catch { /* assertOwner below refuses a lost owner. */ } }, 15_000);
  heartbeat.unref?.();
  try {
    const plan = planRetainedBrandPostSceneRestoration(options);
    const assertCurrent = () => {
      lock.assertOwner();
      for (const [file, expected] of plan.files) {
        try { if (hash(fs.readFileSync(file)) !== expected || path.resolve(fs.realpathSync(file)).toLowerCase() !== path.resolve(file).toLowerCase()) return changed(); }
        catch { return changed(); }
      }
      if (!readCanonicalSellerSourceHashes({ snapshot: plan.current.sourceSnapshot, productId: options.brandLinkId,
        sourceDirectory: path.join(getBrandPostPackageDir(options.brandLinkId), "product-sources") }).has(plan.asset.referenceScene!.referenceSha256)) return changed();
    };
    assertCurrent();
    if (plan.alreadyRestored) return { manifest: plan.current, alreadyRestored: true, restoredSha256: plan.asset.sha256 };
    const product = plan.current.sourceSnapshot!.product, section = plan.current.composition.sections.find(item => item.id === options.sectionId)!;
    const productName = typeof product.name === "string" ? product.name : plan.current.title;
    const features = (Array.isArray(product.features) ? product.features : []).filter((value): value is string => typeof value === "string");
    const selectedProduct = buildSelectedProductImageAuditContext(productName, features, plan.current.productUnderstanding);
    const source = await (dependencies.selectSource ?? selectShoppingSceneReference)({ paths: [plan.asset.referenceScene!.referencePath], productName, selectedProduct });
    assertCurrent();
    if (!source || source.sha256 !== plan.asset.referenceScene!.referenceSha256 || path.resolve(source.path) !== path.resolve(plan.asset.referenceScene!.referencePath)) return invalid();
    const sceneReview = await (dependencies.reviewScene ?? reviewShoppingReferenceScene)({ reference: source, outputPath: plan.asset.path,
      productName, imageIntent: section.imageIntent || plan.asset.imageIntent || "",
      sectionTitle: section.title, bodyExcerpt: section.body.join("\n") });
    assertCurrent();
    if (sceneReview.strategyVersion !== REFERENCE_SCENE_STRATEGY_VERSION || sceneReview.reviewStatus !== "passed" ||
        !REFERENCE_SCENE_REVIEW_CHECKS.every(key => sceneReview.checks?.[key] === true) || sceneReview.reviewedOutputSha256 !== plan.asset.sha256 ||
        sceneReview.referenceSha256 !== plan.asset.referenceScene!.referenceSha256 || path.resolve(sceneReview.referencePath) !== path.resolve(source.path)) return invalid();
    const receipt = { version: "retained-scene-restoration/v1", identity: plan.identity, status: "reviewed", at: new Date().toISOString(),
      backupJobId: options.backupJobId, retainedSha256: plan.asset.sha256, replacedSha256: options.currentAssetKey, sceneReview };
    fs.mkdirSync(path.dirname(plan.receiptPath), { recursive: true });
    atomicWriteTextFile(plan.receiptPath, JSON.stringify(receipt, null, 2));
    assertCurrent();
    atomicWriteTextFile(plan.manifestPath, JSON.stringify(plan.candidate, null, 2));
    atomicWriteTextFile(plan.receiptPath, JSON.stringify({ ...receipt, status: "restored" }, null, 2));
    return { manifest: plan.candidate, alreadyRestored: false, restoredSha256: plan.asset.sha256 };
  } finally { clearInterval(heartbeat); lock.release(); }
}
