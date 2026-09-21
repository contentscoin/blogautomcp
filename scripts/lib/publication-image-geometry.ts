import fs from "node:fs";

// Next ships this synchronous image-header parser in the desktop runtime too.
// Read actual bytes, never stored dimensions or file extensions.
// Bundled CommonJS module has no public TypeScript declaration.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { imageSize } = require("next/dist/compiled/image-size") as {
  imageSize(input: Buffer): { width?: number; height?: number };
};
export const MAX_PUBLICATION_IMAGE_ASPECT_RATIO = 3;
export function isPublicationImageAspectAllowed(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 &&
    Math.max(width / height, height / width) <= MAX_PUBLICATION_IMAGE_ASPECT_RATIO;
}
/** Geometry only; final publication still fully decodes and visually reviews pixels. */
export function publicationImageGeometryIssue(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > 24 * 1024 * 1024) throw new Error("size");
    const { width, height } = imageSize(fs.readFileSync(file));
    if (!width || !height) throw new Error("dimensions");
    return isPublicationImageAspectAllowed(width, height) ? null :
      `LONG_IMAGE: ${width}x${height} 이미지가 발행 기준 ${MAX_PUBLICATION_IMAGE_ASPECT_RATIO}:1을 초과합니다. 원본을 교체해야 합니다.`;
  } catch { return "INVALID_IMAGE: 실제 이미지 크기를 확인할 수 없습니다. 원본을 교체해야 합니다."; }
}
