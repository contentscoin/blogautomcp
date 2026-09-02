import { randomUUID } from "node:crypto";
import {
  applyGeneratedBrandPostImage, packagePreview, readBrandPostPackage,
  writeBrandPostPackageManifest, type BrandPostPackageManifestV2,
} from "./brand-post-package";
import {
  generateBrandPostImages, type BrandPostImageGenerationRequest,
  type BrandPostImageGenerationResult,
} from "./brand-post-image-generation";

type ImageSlot = ReturnType<typeof packagePreview>["imageSlots"][number];

/** One plan shared by auto repair and the manual fill button. No hidden four-slot limit. */
export function planSectionImageRequests(slots: ImageSlot[]): BrandPostImageGenerationRequest[] {
  const requests: BrandPostImageGenerationRequest[] = [];
  for (const slot of slots) {
    let count = slot.count;
    const originals = slot.assets.filter((asset) => asset && (!asset.provenance || asset.provenance === "ORIGINAL"));
    for (let index = 0; index < Math.max(slot.missing, slot.generationMissing); index += 1) {
      if (slot.maximum === 0) break;
      let replaceAssetKey: string | undefined;
      if (count >= slot.maximum) {
        replaceAssetKey = originals.shift()?.assetKey;
        if (!replaceAssetKey) break;
      } else {
        count += 1;
      }
      requests.push({ requestId: randomUUID(), sectionId: slot.sectionId, replaceAssetKey });
    }
  }
  return requests;
}

const shared = globalThis as typeof globalThis & { brandPostImageJobs?: Set<string>; brandPostImageAbort?: Map<string, AbortController> };
const activeJobs = shared.brandPostImageJobs ??= new Set<string>();
const controllers = shared.brandPostImageAbort ??= new Map<string, AbortController>();
export const isBrandPostImageRepairActive = (id: string) => activeJobs.has(id);
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

/** Each success is committed immediately. A failed slot never starves later sections. */
export async function repairBrandPostImages(options: {
  brandLinkId: string;
  productName?: string;
  requests?: BrandPostImageGenerationRequest[];
}, dependencies: ImageRepairDependencies = {
  read: readBrandPostPackage, write: writeBrandPostPackageManifest,
  apply: applyGeneratedBrandPostImage, generate: generateBrandPostImages,
}) {
  if (activeJobs.has(options.brandLinkId)) throw new Error("이 초안의 이미지 생성이 이미 진행 중입니다.");
  activeJobs.add(options.brandLinkId);
  const controller = new AbortController();
  controllers.set(options.brandLinkId, controller);
  let applied = 0;
  const errors: string[] = [];
  let requested = 0;
  let expectedDraft: string | undefined;
  const seen = new Set<string>();
  const read = () => {
    const manifest = dependencies.read(options.brandLinkId);
    if (!manifest || manifest.version !== "brand-post-package/v2") throw new Error("이미지를 편집할 v2 초안 패키지가 없습니다.");
    const identity = JSON.stringify({
      createdAt: manifest.createdAt, title: manifest.title,
      sections: manifest.composition.sections.map(({ id, title, body }) => ({ id, title, body })),
    });
    if (expectedDraft !== undefined && identity !== expectedDraft) {
      throw new Error("이미지 생성 중 원고가 변경되었습니다. 이전 원고의 이미지는 새 원고에 적용하지 않습니다.");
    }
    expectedDraft ??= identity;
    return manifest;
  };
  const persist = (running: boolean) => {
    const manifest = read();
    const remaining = packagePreview(manifest).imageSlots.reduce((sum, slot) => sum + Math.max(slot.missing, slot.generationMissing), 0);
    const updated: BrandPostPackageManifestV2 = {
      ...manifest, approvedAt: null,
      imageGeneration: {
        status: running ? "running" : remaining === 0 && errors.length === 0 ? "complete" : "incomplete",
        requested, applied, remaining, errors: [...errors], updatedAt: new Date().toISOString(),
      },
    };
    dependencies.write(updated);
    return { manifest: updated, remaining };
  };
  try {
    const manifest = read();
    const requests = options.requests ?? planSectionImageRequests(packagePreview(manifest).imageSlots);
    requested = requests.length;
    if (requested === 0) {
      const remaining = packagePreview(manifest).imageSlots.reduce((sum, slot) => sum + Math.max(slot.missing, slot.generationMissing), 0);
      return { manifest, remaining, generatedCount: 0, errors, warning: remaining ? `섹션 이미지 ${remaining}장 미완료.` : null };
    }
    if (requested > 0) {
      persist(true);
      const allowed = new Set(requests.map((request) => request.requestId));
      const accept = async (result: BrandPostImageGenerationResult) => {
        if (controller.signal.aborted) return;
        if (!allowed.has(result.requestId) || seen.has(result.requestId)) return;
        seen.add(result.requestId);
        if (result.generatedPath) {
          try {
            read(); // Never apply a late result to a replaced/revised draft.
            dependencies.apply({ brandLinkId: options.brandLinkId, ...result, generatedPath: result.generatedPath });
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
        const results = await dependencies.generate({ manifest, productName: options.productName || manifest.title, requests, onResult: accept, signal: controller.signal });
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
    activeJobs.delete(options.brandLinkId);
    controllers.delete(options.brandLinkId);
  }
}
