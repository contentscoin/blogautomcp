import fs from "node:fs";
import { createHash } from "node:crypto";
import { readProductSnapshot, type ProductSnapshot } from "./draft-context-snapshot";
import { readSubmittedPrewritePhoto, type ShoppingPrewritePhotoProof } from "../../scripts/lib/shopping-prewrite-photos";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};

/** A seller URL is discovery metadata. Only this frozen, inspected file is the writer's original image. */
export async function attachPreparedDraftOriginal(data: RecordValue, productId: string, contextPath: string, dependencies: {
  upload: (file: string, expectedHash: string) => Promise<string | null>;
  warn: (message: string) => void;
  readProof?: (file: string, expected: ProductSnapshot) => ShoppingPrewritePhotoProof | null;
}) {
  const prepared = { ...data };
  if (String(data.connectKind).toUpperCase() !== "SHOPPING") return prepared;
  // Local proof paths are retained on the PC. The immutable public snapshot remains unchanged.
  const proof = object(data.prewritingPhotoProof), original = object(proof.original);
  const publication = object(data.publicationPhotoContext), verified = object(publication.verifiedOriginal);
  const { path: _proofPath, ...publicOriginal } = original;
  const { path: _publicationPath, ...publicVerified } = verified;
  void _proofPath; void _publicationPath;
  if (data.prewritingPhotoProof) prepared.prewritingPhotoProof = { ...proof, original: publicOriginal };
  if (data.publicationPhotoContext) prepared.publicationPhotoContext = { ...publication, verifiedOriginal: publicVerified };
  delete prepared.nativeReferenceImages;
  try {
    const snapshot = readProductSnapshot(data.snapshot, { productId, connectKind: "SHOPPING" });
    if (!snapshot || data.snapshotId !== snapshot.snapshotId) throw new Error("PREWRITING_SOURCE_CHANGED");
    const saved = (dependencies.readProof || readSubmittedPrewritePhoto)(contextPath, snapshot);
    if (!saved) throw new Error("PREWRITING_PHOTO_REQUIRED");
    const bytes = fs.readFileSync(saved.original.path);
    if (!bytes.length || bytes.length > 4 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== saved.original.sha256)
      throw new Error("PREWRITING_PHOTO_CHANGED");
    const mimeType = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp" : null;
    if (!mimeType) throw new Error("PREWRITING_PHOTO_REQUIRED");
    // Existing authenticated agent asset upload reads/checks these same bytes before sending them.
    const url = await dependencies.upload(saved.original.path, saved.original.sha256);
    const parsed = url ? new URL(url) : null;
    if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("PRODUCT_REFERENCE_UPLOAD_FAILED");
    // Async delivery must not turn a stale proof into an attached, current reference.
    const afterUpload = (dependencies.readProof || readSubmittedPrewritePhoto)(contextPath, snapshot);
    if (!afterUpload || afterUpload.snapshot.snapshotId !== saved.snapshot.snapshotId || afterUpload.original.sha256 !== saved.original.sha256 ||
        afterUpload.original.path !== saved.original.path || createHash("sha256").update(fs.readFileSync(saved.original.path)).digest("hex") !== saved.original.sha256)
      throw new Error("PREWRITING_PHOTO_CHANGED");
    prepared.nativeReferenceImages = [{ role: "product-identity", sha256: saved.original.sha256, url,
      base64: bytes.toString("base64"), mimeType }];
    prepared.publicationPhotoAvailability = { ...object(data.publicationPhotoAvailability), status: "attached-verified-original",
      externalWriterReady: true, snapshotId: snapshot.snapshotId, originalSha256: saved.original.sha256,
      attachmentRequiredForExternalWriter: true, listingUrlIsNotPhotoUrl: true, futureScenesGenerated: false };
  } catch {
    prepared.publicationPhotoAvailability = { ...object(data.publicationPhotoAvailability), status: "needs_reference",
      externalWriterReady: false, attachmentRequiredForExternalWriter: true, listingUrlIsNotPhotoUrl: true, futureScenesGenerated: false };
    dependencies.warn("선택 상품의 검증 원본 픽셀을 첨부하지 못했습니다. 판매자 URL이나 원본 해시만으로 원고·연출 사진을 생성하지 말고, 기존 근거를 보존한 채 PC 소재 준비 또는 참조 전달 복구를 확인하세요.");
  }
  return prepared;
}
