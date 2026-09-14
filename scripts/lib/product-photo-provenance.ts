import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAX_PHOTO_BYTES = 24 * 1024 * 1024;
const digest = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");

function photoBytes(file: string): Buffer {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_PHOTO_BYTES) {
    throw new Error("상품 원본 이미지 파일 크기가 허용 범위를 벗어났습니다.");
  }
  return fs.readFileSync(file);
}

export interface ProductPhotoSourceRecord {
  version: "product-photo-source/v1";
  sourcePath: string;
  sourceSha256: string;
  outputSha256: string;
  provenance: "LOCKED_PRODUCT" | "EDITORIAL_CARD";
  segmented: boolean;
}

/** Retain the actual photo, independently of downloaded files cleaned up after a run. */
export function preserveProductPhotoSource(options: {
  sourcePath: string;
  outputPath: string;
  segmented: boolean;
}): ProductPhotoSourceRecord {
  const bytes = photoBytes(options.sourcePath);
  const sourceSha256 = digest(bytes);
  const outputSha256 = digest(photoBytes(options.outputPath));
  const sourceDir = path.join(path.dirname(options.outputPath), "product-sources");
  fs.mkdirSync(sourceDir, { recursive: true });
  const suffix = path.extname(options.sourcePath).toLowerCase();
  const extension = [".png", ".jpg", ".jpeg", ".webp"].includes(suffix) ? suffix : ".png";
  const sourcePath = path.resolve(sourceDir, `${sourceSha256}${extension}`);
  try { fs.writeFileSync(sourcePath, bytes, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || digest(photoBytes(sourcePath)) !== sourceSha256) throw error;
  }
  const record: ProductPhotoSourceRecord = {
    version: "product-photo-source/v1", sourcePath, sourceSha256, outputSha256,
    provenance: options.segmented ? "LOCKED_PRODUCT" : "EDITORIAL_CARD",
    segmented: options.segmented,
  };
  fs.writeFileSync(`${options.outputPath}.source.json`, JSON.stringify(record, null, 2), "utf8");
  return record;
}

/** Metadata supplies candidates only; the caller must still run product-photo QC. */
export function readProductPhotoSource(outputPath: string): ProductPhotoSourceRecord | null {
  try {
    const metadata = `${outputPath}.source.json`;
    if (fs.statSync(metadata).size > 64 * 1024) return null;
    const record = JSON.parse(fs.readFileSync(metadata, "utf8"));
    if (!["product-photo-source/v1", "original-photo-background/v1"].includes(record?.version) ||
        typeof record.sourcePath !== "string" || !path.isAbsolute(record.sourcePath) ||
        !/^[a-f0-9]{64}$/u.test(record.sourceSha256) || !/^[a-f0-9]{64}$/u.test(record.outputSha256) ||
        typeof record.segmented !== "boolean" ||
        record.outputSha256 !== digest(photoBytes(outputPath)) ||
        record.sourceSha256 !== digest(photoBytes(record.sourcePath))) return null;
    return { ...record, version: "product-photo-source/v1" };
  } catch { return null; }
}

/** Package copies must keep the photo and its output-bound receipt together. */
export function copyProductPhotoSource(sourceOutputPath: string, destinationOutputPath: string): boolean {
  const record = readProductPhotoSource(sourceOutputPath);
  if (!record) return false;
  if (digest(photoBytes(destinationOutputPath)) !== record.outputSha256) {
    throw new Error("상품 이미지 복사본이 원본 출처 기록과 일치하지 않습니다.");
  }
  preserveProductPhotoSource({ sourcePath: record.sourcePath, outputPath: destinationOutputPath, segmented: record.segmented });
  return true;
}
