import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getBrandPostPackageDir } from "../../src/lib/brand-post-package";
import { atomicWriteTextFile } from "../../src/lib/atomic-text-file";
import { isCodexUsageLimitMessage } from "../../src/lib/local-automation-error";
import { buildProductThumbnailCopy } from "./product-thumbnail";
import { checkedExistingJobResult, type ImageBatchJob } from "../../src/lib/codex-image-generation";
import { isReferenceGuidedThumbnail, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../../src/lib/brand-post-image-evidence";
import { publicationImageContext } from "./publish-image-rejections";
import { readSellerOriginalRecoveryScope, sellerOriginalRecoveryBudgetBinding, type SellerOriginalRecoveryScope } from "./seller-original-recovery-scope";

/** Recover missing product references and rejected scenes from fresh seller evidence. */
// Policy 10 uses explicit incomplete-review outcomes, rebinds proven source SHA
// values to current paths and shares the prewriting scene plan. Earlier exhausted
// inputs get one bounded pass through this changed algorithm; uncertain requests
// still block upstream and timestamps cannot renew a consumed budget.
export const IMAGE_RECOVERY_POLICY_VERSION = 10;

export type ImageRecoveryStage = "refresh-source" | "repair-rejected" | "repair-rejected-original" | "review-completed-hero" | "replan-images" | "replan-after-rejection";
type Entry = { stage: ImageRecoveryStage; input: string; output?: string; status: "running" | "complete" | "failed"; at: string; reason?: string; externalFailure?: boolean; thumbnailCopyBinding?: string; completedHeroReviewBinding?: string; originalSourceScope?: SellerOriginalRecoveryScope };

function validOriginalRecoveryScope(scope: SellerOriginalRecoveryScope | undefined | null): scope is SellerOriginalRecoveryScope {
  try {
    const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
    const identity = scope?.identity;
    return !!scope && scope.version === "seller-original-recovery-scope/v1" && !!identity &&
      [identity.productId, identity.sectionId, identity.slotId].every(value => typeof value === "string" && value.length > 0) &&
      [identity.sha256, identity.context, identity.sourceSnapshotId, scope.binding, scope.nativeProof.sha256, scope.nativeProof.materialContext.sha256].every(sha) &&
      typeof scope.nativeProof.path === "string" && !!scope.nativeProof.path && typeof scope.nativeProof.materialContext.file === "string" && !!scope.nativeProof.materialContext.file &&
      Array.isArray(identity.canonicalReceipts) && identity.canonicalReceipts.length > 0 && identity.canonicalReceipts.every(row =>
        typeof row.sourceUrl === "string" && !!row.sourceUrl && row.sourceSha256 === identity.sha256) &&
      sellerOriginalRecoveryBudgetBinding(identity) === scope.binding;
  } catch { return false; }
}

/** The raw-photo recipe excludes the locally rendered headline. Only one exact
 * rejected hero with a proven completed raw may renew that headline-only scope;
 * body/source budgets and uncertain provider work keep their original identity. */
function rejectedThumbnailCopyBinding(root: string, assetKey: string): string | null {
  try {
    if (!/^[a-f0-9]{64}$/u.test(assetKey)) return null;
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    const heroes = (manifest.imageAssets || []).filter((asset: Record<string, unknown>) => asset.role === "hero" && !asset.sectionId && asset.sha256 === assetKey);
    if (manifest.connectKind !== "SHOPPING" || heroes.length !== 1 || !manifest.sourceSnapshot?.snapshotId) return null;
    const hero = heroes[0], scene = hero.referenceScene;
    const hashFile = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (hero.slotId !== "hero:image:1" || !isReferenceGuidedThumbnail(hero) || scene.strategyVersion !== REFERENCE_SCENE_STRATEGY_VERSION ||
        scene.reviewStatus !== "passed" || !REFERENCE_SCENE_REVIEW_CHECKS.every(key => scene.checks?.[key] === true) ||
        scene.sourceSnapshotId !== manifest.sourceSnapshot.snapshotId || scene.thumbnailOutputSha256 !== assetKey ||
        !scene.thumbnailRawPath || hashFile(hero.path) !== assetKey || hashFile(scene.thumbnailRawPath) !== scene.reviewedOutputSha256 ||
        hashFile(scene.referencePath) !== scene.referenceSha256) return null;
    const rejected = JSON.parse(fs.readFileSync(path.join(root, "publish-image-rejections.json"), "utf8"));
    const context = publicationImageContext(manifest.composition, null);
    if (!Array.isArray(rejected) || !rejected.some(row => row?.sha256 === assetKey && row.sectionId === null &&
        [undefined, "section", "product"].includes(row.scope) && row.context === context)) return null;
    const records: Array<{ recipeSha256: string; rawSha256: string }> = [];
    for (const namespace of ["resume-v1", "resume-v2"]) {
      const directory = path.join(root, "image-generation-work", namespace);
      const names = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => /^raw-[a-f0-9]+\.reference-scene\.json$/u.test(name)) : [];
      if (names.length > 128) return null;
      for (const name of names) {
        const stem = path.join(directory, name.replace(/\.reference-scene\.json$/u, ""));
        const metadata = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
        if (metadata.slotId !== hero.slotId) continue;
        // Any competing/unfinished same-slot record retains the old stop guard.
        if ([".lock", ".lock.recovery", ".resolution.lock", ".resolution.lock.recovery", ".checkpoint.jsonl"].some(extension => fs.existsSync(stem + extension))) return null;
        const receipt = JSON.parse(fs.readFileSync(stem + ".codex-submission.json", "utf8"));
        if (receipt.state !== "completed" || metadata.strategyVersion !== REFERENCE_SCENE_STRATEGY_VERSION ||
            metadata.sourceSnapshotId !== manifest.sourceSnapshot.snapshotId || !/^[a-f0-9]{64}$/u.test(metadata.sceneRecipeSha256 || "") ||
            JSON.stringify(metadata.referenceHashes) !== JSON.stringify([scene.referenceSha256])) return null;
        const job: ImageBatchJob = { id: "thumbnail-copy-recovery", outStem: stem, prompt: "", referenceMode: "product",
          referenceImagePaths: [scene.referencePath], requiredReferenceHashes: [scene.referenceSha256] };
        const raw = checkedExistingJobResult(job, { onResult: async () => {} });
        if (!raw) return null;
        records.push({ recipeSha256: metadata.sceneRecipeSha256, rawSha256: hashFile(raw) });
      }
    }
    const matches = records.filter(record => record.rawSha256 === scene.reviewedOutputSha256);
    if (matches.length !== 1 || records.some(record => record !== matches[0] && record.recipeSha256 === matches[0].recipeSha256)) return null;
    const productName = String(manifest.sourceSnapshot.product?.name || manifest.title);
    return crypto.createHash("sha256").update(JSON.stringify({ version: "thumbnail-copy-recovery/v1", assetKey,
      snapshotId: manifest.sourceSnapshot.snapshotId, rawSha256: scene.reviewedOutputSha256, referenceSha256: scene.referenceSha256,
      sceneRecipeSha256: matches[0].recipeSha256, title: manifest.title, productName,
      copy: buildProductThumbnailCopy(manifest.title, productName, "SHOPPING", manifest.productUnderstanding), style: "shopping-bold" })).digest("hex");
  } catch { return null; }
}

function isOnlyRejectedThumbnailFailure(entry: Entry): boolean {
  const codes = entry.reason?.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/gu) || [];
  return entry.status === "failed" && codes.length > 0 && codes.every(code => code === "IMAGE_OUTPUT_REJECTED");
}

function isExternalRecoveryFailure(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null;
  return /^(?:CODEX_(?:AUTH_REQUIRED|LOGIN_REQUIRED|MODEL_INCOMPATIBLE|TIMEOUT|TRANSIENT_FAILURE|USAGE_LIMIT_REACHED)|CHATGPT_BROWSER_(?:AUTH_REQUIRED|LOGIN_REQUIRED|UNREACHABLE|BUSY)|UNAUTHORIZED|LLM_UNAVAILABLE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|REQUEST_TIMEOUT)$/u
    .test(value?.code || "") || isCodexUsageLimitMessage(value?.message || String(error));
}

/** Old releases recorded account quotas as INVALID_INPUT (or no code at all).
 * Reinterpret only failed records with an exact quota diagnostic. Preserve the
 * original history bytes/fields; running, completed and quality failures retain
 * their budget even when unrelated text mentions a limit. */
function consumesRecoveryBudget(entry: Entry): boolean {
  return !entry.externalFailure && !(entry.status === "failed" && typeof entry.reason === "string" && isCodexUsageLimitMessage(entry.reason));
}
// IMAGE_GENERATION_REQUIRED is what a source-only pass reports for an AI-scene slot; the next
// generation or replan pass can still fill it, so it does not end recovery.
const recoverable = new Set(["IMAGE_SOURCE_BINDING_REQUIRED", "PRODUCT_SOURCE_REQUIRED", "PRODUCT_SOURCE_DOWNLOAD_FAILED", "PRODUCT_CUTOUT_REQUIRED", "IMAGE_GENERATION_REQUIRED", "PRODUCT_REFERENCE_REQUIRED", "REFERENCE_SCENE_FIDELITY_FAILED"]);
export const isRecoverableImageEvidenceFailure = (code?: string) => recoverable.has(code || "");
export function isRecoverableImageEvidenceResult(value: { code?: string; errors?: string[]; error?: string } | null | undefined): boolean {
  if (!isRecoverableImageEvidenceFailure(value?.code)) return false;
  if (value?.errors?.length) return value.errors.every(message => {
    const codes = message.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/gu) || [];
    return codes.length > 0 && codes.every(isRecoverableImageEvidenceFailure);
  });
  return (value?.error?.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/gu) || []).every(isRecoverableImageEvidenceFailure);
}

/** Ignore timestamps/statuses: an unchanged manuscript and evidence must not buy a new retry budget. */
export function imageRecoverySignature(root: string): string | null {
  const read = (file: string) => { try { return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")); } catch { return null; } };
  const manifest = read("manifest.json");
  if (!manifest) return null;
  const context = read("mcp-draft-context.json");
  const rejected = read("publish-image-rejections.json");
  let receipts: string[] = [];
  try {
    receipts = fs.readdirSync(path.join(root, "product-sources")).filter(name => name.endsWith(".retrieval.json"))
      .map(name => read(`product-sources/${name}`)?.sha256).filter((sha): sha is string => typeof sha === "string").sort();
  } catch { /* No sources yet is a meaningful input state. */ }
  return crypto.createHash("sha256").update(JSON.stringify({
    // Bump when the recovery algorithm itself changes, so drafts that failed under the
    // old logic get one attempt with the new logic instead of being suppressed forever.
    version: 1, policy: IMAGE_RECOVERY_POLICY_VERSION, product: manifest.sourceSnapshot?.product,
    productUnderstanding: manifest.productUnderstanding,
    refreshedProduct: context?.product,
    sections: manifest.composition?.sections?.map((section: Record<string, unknown>) => ({
      id: section.id, title: section.title, body: section.body, imageIntent: section.imageIntent,
      imageMin: section.imageMin, imageMax: section.imageMax,
    })),
    assets: manifest.imageAssets?.map((asset: Record<string, unknown>) => [asset.sha256, asset.sectionId]), receipts,
    rejected: Array.isArray(rejected) ? [...new Set(rejected.map(row => JSON.stringify([row.sha256, row.sectionId, row.context, row.scope || "section"])))].sort() : [],
  })).digest("hex");
}

/** Persist the claim before a long operation, including failures and interrupted runs. */
export async function runRecordedImageRecovery<T>(id: string, stage: ImageRecoveryStage, operation: () => Promise<T>, options?: { thumbnailAssetKey?: string; originalSectionId?: string }): Promise<{ attempted: boolean; result?: T }> {
  const root = getBrandPostPackageDir(id);
  const baseInput = imageRecoverySignature(root);
  const originalSourceScope = stage === "repair-rejected-original" && options?.originalSectionId
    ? readSellerOriginalRecoveryScope(id, options.originalSectionId) : undefined;
  if (stage === "repair-rejected-original" && (!baseInput || !validOriginalRecoveryScope(originalSourceScope)))
    throw Object.assign(new Error("현재 원본의 서명된 본문·사진 검수 근거를 확인하지 못했습니다. 원고·사진을 보존했으며 원본 재배정은 실행하지 않았습니다."), { code: "IMAGE_RESUME_REQUIRED" });
  let completedHeroReviewBinding: string | undefined;
  if (stage === "review-completed-hero") {
    if (!baseInput) return { attempted: false };
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
      if (!options?.thumbnailAssetKey || manifest.imageAssets?.filter((asset: { role?: string; sectionId?: string; sha256?: string }) =>
        asset.role === "hero" && !asset.sectionId && asset.sha256 === options.thumbnailAssetKey).length !== 1) return { attempted: false };
      const generation = await import("../../src/lib/brand-post-image-generation");
      completedHeroReviewBinding = await generation.completedHeroReviewBinding(manifest, String(manifest.sourceSnapshot?.product?.name || manifest.title));
    } catch { return { attempted: false }; } // Optional read-only admission cannot erase the retained original failure.
  }
  const scopedInput = (base: string | null) => completedHeroReviewBinding && base
    ? crypto.createHash("sha256").update(JSON.stringify({ base, completedHeroReviewBinding })).digest("hex") : base;
  const input = originalSourceScope?.binding || scopedInput(baseInput);
  // In-memory fixtures/non-persisted drafts still use the bounded workflow loop.
  if (!input) return { attempted: true, result: await operation() };
  const file = path.join(root, "image-recovery-history.json");
  let entries: Entry[] = [];
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(saved.entries)) throw new Error("Invalid image recovery history");
    entries = saved.entries;
  } catch (error) {
    if (stage === "repair-rejected-original" && (error as NodeJS.ErrnoException).code !== "ENOENT")
      throw Object.assign(new Error("기존 원본 복구 이력을 확인할 수 없습니다. 재배정을 반복하지 않았습니다."), { code: "IMAGE_RESUME_REQUIRED" });
  }
  if (originalSourceScope && entries.some(entry => !entry || typeof entry !== "object" ||
    !["running", "complete", "failed"].includes(entry.status) || typeof entry.stage !== "string" ||
    !/^[a-f0-9]{64}$/u.test(entry.input || "") || !Number.isFinite(Date.parse(entry.at))))
    throw Object.assign(new Error("기존 원본 복구 이력이 불완전합니다. 재배정을 반복하지 않았습니다."), { code: "IMAGE_RESUME_REQUIRED" });
  if (originalSourceScope && entries.some(entry => entry.stage === "repair-rejected-original" &&
    (!validOriginalRecoveryScope(entry.originalSourceScope) ||
      entry.originalSourceScope.binding === input))) return { attempted: false };
  const thumbnailCopyBinding = stage === "repair-rejected" && options?.thumbnailAssetKey
    ? rejectedThumbnailCopyBinding(root, options.thumbnailAssetKey) : null;
  if (entries.some(entry => (stage === "review-completed-hero" || consumesRecoveryBudget(entry)) && entry.stage === stage && (entry.input === input || entry.output === input) &&
      (!thumbnailCopyBinding || entry.thumbnailCopyBinding === thumbnailCopyBinding || !isOnlyRejectedThumbnailFailure(entry)))) return { attempted: false };
  if (originalSourceScope) {
    // Immutable deny marker survives the generic bounded-history window and
    // uncertain transports. It grants no source/image/approval authority.
    const claims = path.join(root, "seller-original-recovery-scopes");
    fs.mkdirSync(claims, { recursive: true });
    try {
      fs.writeFileSync(path.join(claims, input + ".json"), JSON.stringify({ version: "seller-original-recovery-claim/v1",
        claimedAt: new Date().toISOString(), scope: originalSourceScope, generationAuthorization: false, approvalAuthorization: false }), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return { attempted: false };
      throw error;
    }
  }
  const entry: Entry = { stage, input, status: "running", at: new Date().toISOString(), ...(thumbnailCopyBinding ? { thumbnailCopyBinding } : {}),
    ...(completedHeroReviewBinding ? { completedHeroReviewBinding } : {}), ...(originalSourceScope ? { originalSourceScope } : {}) };
  entries.push(entry);
  const save = () => atomicWriteTextFile(file, JSON.stringify({ version: 1, entries: originalSourceScope ? entries : entries.slice(-32) }, null, 2));
  save();
  try {
    const result = await operation();
    entry.status = "complete";
    return { attempted: true, result };
  } catch (error) {
    entry.status = "failed";
    entry.reason = String((error as Error).message || error).slice(0, 500);
    // Stop this run, but a later explicit preparation after login/runtime repair
    // must not be permanently suppressed by unchanged product bytes.
    entry.externalFailure = isExternalRecoveryFailure(error) && !(originalSourceScope &&
      [undefined, "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "REQUEST_TIMEOUT"].includes((error as { code?: string })?.code));
    throw error;
  } finally {
    entry.output = originalSourceScope ? input : scopedInput(imageRecoverySignature(root)) || input;
    save();
  }
}
