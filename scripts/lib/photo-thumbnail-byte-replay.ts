import fs from "node:fs";
import crypto from "node:crypto";
import { renderShoppingPhotoThumbnailBytes, SHOPPING_THUMBNAIL_LAYOUT_VERSION } from "./thumbnail-layout-v2";

const digest = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
export interface PhotoThumbnailReplayInput {
  sourcePath: string; sourceSha256: string; candidatePath: string; candidateSha256: string; headline: string;
}
export interface PhotoThumbnailReplay {
  version: "exact-photo-thumbnail-replay/v1"; renderer: string; sourceSha256: string; candidateSha256: string; headline: string;
}
// A serialized receipt alone never proves rendering. A new process must replay
// the actual canonical source again; this bounded cache only avoids duplicate
// work in the current process, with both files rehashed at every reader call.
const verified = new Map<string, string>();
const key = (input: PhotoThumbnailReplayInput) => JSON.stringify([input.sourceSha256, input.candidateSha256, input.headline]);
const unchanged = (input: PhotoThumbnailReplayInput) => digest(fs.readFileSync(input.sourcePath)) === input.sourceSha256 &&
  digest(fs.readFileSync(input.candidatePath)) === input.candidateSha256;
export async function replayPhotoThumbnail(input: PhotoThumbnailReplayInput): Promise<PhotoThumbnailReplay | null> {
  try {
    if (!unchanged(input) || input.headline.length > 80) return null;
    const marker: PhotoThumbnailReplay = {version:"exact-photo-thumbnail-replay/v1", renderer:SHOPPING_THUMBNAIL_LAYOUT_VERSION,
      sourceSha256:input.sourceSha256,candidateSha256:input.candidateSha256,headline:input.headline};
    if (verified.get(key(input)) !== JSON.stringify(marker)) {
      const bytes = await renderShoppingPhotoThumbnailBytes({sourcePath:input.sourcePath,headline:input.headline});
      if (digest(bytes) !== input.candidateSha256 || !unchanged(input)) return null;
      if (verified.size >= 32) verified.delete(verified.keys().next().value!);
      verified.set(key(input),JSON.stringify(marker));
    }
    return marker;
  } catch { return null; }
}
export function photoThumbnailReplayIssue(marker: PhotoThumbnailReplay, input: PhotoThumbnailReplayInput): string | null {
  try { return unchanged(input) && verified.get(key(input)) === JSON.stringify(marker) ? null : "thumbnail bytes have no current exact renderer replay"; }
  catch { return "thumbnail replay source or output is unavailable"; }
}
