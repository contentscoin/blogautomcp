export interface RemoteProductReferenceContext {
  referenceImagePaths: string[];
  referenceHashes: string[];
  prompt: string;
}

export interface RemoteProductReferenceImage {
  role: "product-identity" | "approved-scene-continuity";
  sha256: string;
  url: string;
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export interface RemoteProductReferenceDependencies {
  /** Prepare reviewed product references, not arbitrary seller banners. */
  prepare: (slot: Record<string, unknown>) => Promise<RemoteProductReferenceContext | null>;
  upload: (file: string) => Promise<string | null>;
  /** Exact bounded bytes for a native MCP image block, not a resized preview. */
  readImage?: (file: string, expectedHash: string) => Promise<Pick<RemoteProductReferenceImage, "base64" | "mimeType">>;
  onReference?: (image: RemoteProductReferenceImage) => void;
}

/** Forward actual image URLs to the native image tool without disclosing local paths.
 * A prompt claiming to have references is insufficient when upload fails. */
export async function attachRemoteProductReferenceInputs(
  slots: Array<Record<string, unknown>>,
  deps: RemoteProductReferenceDependencies,
): Promise<Array<Record<string, unknown>>> {
  const uploads = new Map<string, Promise<string | null>>();
  const pixels = new Map<string, Promise<Pick<RemoteProductReferenceImage, "base64" | "mimeType">>>();
  const upload = (file: string) => {
    let pending = uploads.get(file);
    if (!pending) {
      pending = deps.upload(file);
      uploads.set(file, pending);
    }
    return pending;
  };
  // Keep source selection ordered: every slot shares the first reviewed identity.
  const prepared: Array<Record<string, unknown>> = [];
  for (const slot of slots) {
    try {
      const context = await deps.prepare(slot);
      if (!context) {
        prepared.push({ ...slot, generationRole: "verified-source-or-information-card", referenceReady: false, referenceImages: [], referenceHashes: [], imagePrompt: null });
        continue;
      }
      if (!context.referenceImagePaths.length || context.referenceImagePaths.length > 2 ||
          context.referenceImagePaths.length !== context.referenceHashes.length || new Set(context.referenceHashes).size !== context.referenceHashes.length ||
          !context.referenceHashes.every(hash => /^[a-f0-9]{64}$/u.test(hash)) || !context.prompt.trim()) {
        throw new Error("PRODUCT_REFERENCE_REQUIRED");
      }
      const inputs = await Promise.all(context.referenceImagePaths.map(async (file, index) => {
        const url = await upload(file);
        if (!url || !/^https:\/\//u.test(url)) throw new Error("PRODUCT_REFERENCE_UPLOAD_FAILED");
        const metadata = { role: index === 0 ? "product-identity" as const : "approved-scene-continuity" as const, url, sha256: context.referenceHashes[index] };
        if (!deps.readImage) return { metadata };
        let pending = pixels.get(`${file}:${metadata.sha256}`);
        if (!pending) {
          pending = deps.readImage(file, metadata.sha256);
          pixels.set(`${file}:${metadata.sha256}`, pending);
        }
        return { metadata, image: { ...metadata, ...await pending } };
      }));
      const referenceImages = inputs.map(input => input.metadata);
      // The shared completion envelope allows 7 MiB including manuscript and
      // metadata. Keep exact reference bytes within 4 MiB before base64 encoding.
      if (inputs.reduce((bytes, input) => bytes + (input.image ? Math.floor(input.image.base64.length * 3 / 4) : 0), 0) > 4 * 1024 * 1024)
        throw new Error("PRODUCT_REFERENCE_TOO_LARGE");
      inputs.forEach(input => { if (input.image) deps.onReference?.(input.image); });
      prepared.push({ ...slot, generationRole: "reference-guided-product-scene", referenceReady: true,
        referenceImages, referenceHashes: context.referenceHashes, imagePrompt: context.prompt });
    } catch {
      prepared.push({ ...slot, generationRole: "reference-guided-product-scene", referenceReady: false, referenceImages: [], referenceHashes: [], imagePrompt: null,
        referenceError: "상품 참조 이미지의 검토 또는 전송을 완료하지 못했습니다. PC 소재 준비에서 참조 상태를 확인하세요." });
    }
  }
  return prepared;
}
