import { randomUUID } from "node:crypto";
import {
  applyGeneratedBrandPostImage, packagePreview, readBrandPostPackage,
  writeBrandPostPackageManifest, type BrandPostPackageManifestV2,
} from "./brand-post-package";
import {
  generateBrandPostImages, type BrandPostImageGenerationRequest,
  type BrandPostImageGenerationResult,
} from "./brand-post-image-generation";
import {
  acquireBrandPostImageRepairLock,
  isBrandPostImageRepairLocked,
} from "./brand-post-image-repair-lock";

type ImageSlot = ReturnType<typeof packagePreview>["imageSlots"][number];

/** One plan shared by auto repair and the manual fill button. No hidden four-slot limit. */
export function planSectionImageRequests(slots: ImageSlot[]): BrandPostImageGenerationRequest[] {
  const requests: BrandPostImageGenerationRequest[] = [];
  for (const slot of slots) {
    let count = slot.count;
    let generatedCount = slot.generatedCount;
    const usedSlots = new Set<string>([
      ...slot.assets.flatMap(asset => asset?.expectedSlotId ? [asset.expectedSlotId] : []),
      ...slot.staleTargets.map(target => target.slotId),
    ]);
    const plannedReplacementKeys = new Set<string>();
    for (const stale of slot.staleTargets) {
      if (slot.maximum === 0) break;
      if (stale.assetKey && plannedReplacementKeys.has(stale.assetKey)) continue;
      requests.push({
        requestId: randomUUID(),
        sectionId: slot.sectionId,
        slotId: stale.slotId,
        replaceAssetKey: stale.assetKey,
      });
      if (stale.assetKey) plannedReplacementKeys.add(stale.assetKey);
      count += 1;
      generatedCount += 1;
    }
    const originals = slot.assets.filter((asset) => asset && (!asset.provenance || asset.provenance === "ORIGINAL"));
    let missing = Math.max(0, slot.minimum - count);
    let generationMissing = Math.max(0, slot.generatedMinimum - generatedCount);
    while (Math.max(missing, generationMissing) > 0) {
      if (slot.maximum === 0) break;
      let replaceAssetKey: string | undefined;
      let slotId: string | undefined;
      if (count >= slot.maximum) {
        const original = originals.shift();
        replaceAssetKey = original?.assetKey;
        slotId = original?.expectedSlotId || original?.slotId;
        if (!replaceAssetKey) break;
      } else {
        count += 1;
        let ordinal = 1;
        while (usedSlots.has(`${slot.sectionId}:image:${ordinal}`)) ordinal += 1;
        slotId = `${slot.sectionId}:image:${ordinal}`;
        usedSlots.add(slotId);
      }
      requests.push({ requestId: randomUUID(), sectionId: slot.sectionId, slotId, replaceAssetKey });
      generatedCount += 1;
      missing = Math.max(0, slot.minimum - count);
      generationMissing = Math.max(0, slot.generatedMinimum - generatedCount);
    }
  }
  return requests;
}

const shared = globalThis as typeof globalThis & { brandPostImageJobs?: Set<string>; brandPostImageAbort?: Map<string, AbortController> };
const activeJobs = shared.brandPostImageJobs ??= new Set<string>();
const controllers = shared.brandPostImageAbort ??= new Map<string, AbortController>();
export const isBrandPostImageRepairActive = (id: string) => activeJobs.has(id) || isBrandPostImageRepairLocked(id);
export function cancelBrandPostImageRepairs(): number {
  for (const controller of controllers.values()) controller.abort();
  return controllers.size;
}

export interface ImageRepairDependencies {
  read: typeof readBrandPostPackage;
  write: typeof writeBrandPostPackageManifest;
  apply: typeof applyGeneratedBrandPostImage;
  generate: typeof generateBrandPostImages;
}

function recordedImageOwnerIsRecoverable(state: BrandPostPackageManifestV2["imageGeneration"]): boolean {
  if (!state || state.status !== "running" || !Number.isInteger(state.ownerPid) || Number(state.ownerPid) < 1) return false;
  // The caller already proved this process has no active in-memory job and won
  // the package lock. A same-PID record is therefore residue from an interrupted
  // promise in this process, not a concurrent owner.
  if (state.ownerPid === process.pid) return true;
  try {
    process.kill(Number(state.ownerPid), 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
  }
  const heartbeatAt = Date.parse(state.heartbeatAt || state.updatedAt);
  return Number.isFinite(heartbeatAt) && Date.now() - heartbeatAt >= 5 * 60_000;
}

/** Each success is committed immediately. A failed slot never starves later sections. */
export async function repairBrandPostImages(options: {
  brandLinkId: string;
  productName?: string;
  sourceImageUrls?: string[];
  requests?: BrandPostImageGenerationRequest[];
  sourceOnly?: boolean;
}, dependencies: ImageRepairDependencies = {
  read: readBrandPostPackage, write: writeBrandPostPackageManifest,
  apply: applyGeneratedBrandPostImage, generate: generateBrandPostImages,
}) {
  if (activeJobs.has(options.brandLinkId)) throw new Error("이 초안의 이미지 생성이 이미 진행 중입니다.");
  const processLock = acquireBrandPostImageRepairLock(options.brandLinkId);
  activeJobs.add(options.brandLinkId);
  const controller = new AbortController();
  controllers.set(options.brandLinkId, controller);
  const ownerToken = processLock.ownerToken;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let applied = 0;
  const errors: string[] = [];
  let requested = 0;
  let expectedDraft: string | undefined;
  let manifestOwnershipClaimed = false;
  const seen = new Set<string>();
  const read = () => {
    const manifest = dependencies.read(options.brandLinkId, { migrate: false });
    if (!manifest || manifest.version !== "brand-post-package/v2") throw new Error("이미지를 편집할 v2 초안 패키지가 없습니다.");
    const identity = JSON.stringify({
      createdAt: manifest.createdAt, title: manifest.title,
      sourceSnapshotId: manifest.sourceSnapshot?.snapshotId || null,
      sections: manifest.composition.sections.map(({ id, title, body, imageIntent, imageMin, imageMax }) => ({
        id, title, body, imageIntent, imageMin, imageMax,
      })),
    });
    if (expectedDraft !== undefined && identity !== expectedDraft) {
      throw new Error("이미지 생성 중 원고가 변경되었습니다. 이전 원고의 이미지는 새 원고에 적용하지 않습니다.");
    }
    expectedDraft ??= identity;
    return manifest;
  };
  const persist = (running: boolean) => {
    processLock.assertOwner();
    const manifest = read();
    const priorState = manifest.imageGeneration;
    if (!manifestOwnershipClaimed && priorState?.status === "running" &&
        priorState.ownerToken !== ownerToken && !recordedImageOwnerIsRecoverable(priorState)) {
      throw new Error("IMAGE_REPAIR_BUSY: 기존 이미지 보강 소유자가 아직 실행 중이어서 매니페스트를 인계받지 않습니다.");
    }
    if (manifestOwnershipClaimed && manifest.imageGeneration?.ownerToken !== ownerToken) {
      throw new Error("IMAGE_REPAIR_OWNERSHIP_LOST: 매니페스트의 이미지 보강 소유권이 변경되어 덮어쓰기를 중단합니다.");
    }
    const remaining = packagePreview(manifest).imageSlots.reduce((sum, slot) => sum + Math.max(slot.missing, slot.generationMissing), 0);
    const updated: BrandPostPackageManifestV2 = {
      ...manifest, approvedAt: null,
      imageGeneration: {
        status: running ? "running" : remaining === 0 && errors.length === 0 ? "complete" : "incomplete",
        requested, applied, remaining, errors: [...errors], updatedAt: new Date().toISOString(),
        ownerPid: process.pid, ownerToken, heartbeatAt: new Date().toISOString(),
      },
    };
    dependencies.write(updated);
    processLock.assertOwner();
    const committed = dependencies.read(options.brandLinkId, { migrate: false });
    if (!committed || committed.version !== "brand-post-package/v2" || committed.imageGeneration?.ownerToken !== ownerToken) {
      throw new Error("IMAGE_REPAIR_OWNERSHIP_LOST: 이미지 보강 상태의 원자적 갱신을 확인하지 못했습니다.");
    }
    manifestOwnershipClaimed = true;
    return { manifest: updated, remaining };
  };
  try {
    const manifest = read();
    const requests = options.requests ?? planSectionImageRequests(packagePreview(manifest).imageSlots);
    requested = requests.length;
    if (requested === 0) {
      const remaining = packagePreview(manifest).imageSlots.reduce((sum, slot) => sum + Math.max(slot.missing, slot.generationMissing), 0);
      const recovered = manifest.imageGeneration?.status === "running"
        ? persist(false)
        : { manifest, remaining };
      return { ...recovered, generatedCount: 0, errors, warning: remaining ? `섹션 이미지 ${remaining}장 미완료.` : null };
    }
    if (requested > 0) {
      persist(true);
      heartbeat = setInterval(() => {
        try {
          processLock.heartbeat();
          const current = read();
          if (current.imageGeneration?.ownerToken !== ownerToken) throw new Error("Image owner changed");
          dependencies.write({ ...current, imageGeneration: { ...current.imageGeneration, heartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
        } catch { controller.abort(); }
      }, 15_000);
      heartbeat.unref?.();
      const allowed = new Set(requests.map((request) => request.requestId));
      const accept = async (result: BrandPostImageGenerationResult) => {
        if (controller.signal.aborted) return;
        if (!allowed.has(result.requestId) || seen.has(result.requestId)) return;
        seen.add(result.requestId);
        if (result.generatedPath) {
          try {
            processLock.assertOwner();
            read(); // Never apply a late result to a replaced/revised draft.
            dependencies.apply({ brandLinkId: options.brandLinkId, ...result, generatedPath: result.generatedPath });
            processLock.assertOwner();
            applied += 1;
          } catch (error) {
            errors.push(`${result.sectionId || "대표 이미지"}: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          errors.push(`${result.sectionId || "대표 이미지"}: ${result.error || "이미지 생성 실패"}`);
        }
        persist(true);
      };
      try {
        const results = await dependencies.generate({ manifest, productName: options.productName || manifest.title,
          sourceImageUrls: options.sourceImageUrls, requests, onResult: accept, signal: controller.signal,
          sourceOnly: options.sourceOnly });
        for (const result of results) await accept(result);
        for (const request of requests) {
          if (!seen.has(request.requestId)) errors.push(`${request.sectionId || "대표 이미지"}: 생성 결과가 반환되지 않았습니다.`);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (controller.signal.aborted) errors.push("사용자가 이미지 생성을 중지했습니다. 중지 후 결과는 적용하지 않습니다.");
    const finished = persist(false);
    return {
      ...finished, generatedCount: applied, errors,
      warning: errors.length || finished.remaining
        ? `섹션 이미지 ${applied}장 반영, ${finished.remaining}장 미완료. ${errors.join(" ")}`.trim()
        : null,
    };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    activeJobs.delete(options.brandLinkId);
    controllers.delete(options.brandLinkId);
    processLock.release();
  }
}
