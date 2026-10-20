import crypto from "node:crypto";

export interface PublicationClaimUnit {
  sourceIndex: number;
  sourceRenderNodeIndex: number;
  startOffset: number;
  endOffset: number;
  sha256: string;
  text: string;
}

/** Literal display paragraphs only. Offsets are UTF-16 offsets into the
 * original render-node string; no trimming or normalization creates claims. */
export function publicationClaimUnits(body: readonly string[], renderNodeIndices?: readonly number[]): PublicationClaimUnit[] {
  if (renderNodeIndices && (renderNodeIndices.length !== body.length || renderNodeIndices.some(n => !Number.isSafeInteger(n) || n < 0)))
    throw new Error("INVALID_CLAIM_RENDER_MAP");
  const units: PublicationClaimUnit[] = [];
  body.forEach((text, index) => {
    const boundaries = [...text.matchAll(/(?:\r?\n)[\t ]*(?:\r?\n)(?:(?:[\t ]*\r?\n))*/gu)];
    let start = 0;
    for (const boundary of [...boundaries, { index: text.length, 0: "" }]) {
      const end = boundary.index!;
      if (text.slice(start, end).trim()) {
        const literal = text.slice(start, end);
        units.push({ sourceIndex: units.length, sourceRenderNodeIndex: renderNodeIndices?.[index] ?? index,
          startOffset: start, endOffset: end, sha256: crypto.createHash("sha256").update(literal).digest("hex"), text: literal });
      }
      start = end + boundary[0].length;
    }
  });
  return units;
}
