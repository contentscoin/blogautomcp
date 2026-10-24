import crypto from "node:crypto";

/** Eligibility for a photographic performance/result objection, never proof
 * that the claim is true. An adjacent specification alone supplies no link. */
export function hasExplicitPhotographicProofLink(text: string): boolean {
  const photograph="(?:(?:(?:이|그|해당|위|아래)\\s*)?(?:사진|이미지|촬영(?:(?:한|된)\\s*(?:사진|이미지|컷|장면))?)|(?:이|그|해당|위|아래)\\s*(?:컷|장면))";
  // Locative/comparative/inspection constructions explicitly place the
  // assertion in a depicted scene. Mere coexistence or adjacency does not.
  const evidenceFrame=new RegExp(photograph+"\\s*(?:(?:속|안)\\s*에서|에서|[을를]\\s*보면|처럼|(?:과|와)?\\s*같이|대로)","u");
  const subjectProof=new RegExp(photograph+"\\s*(?:으?로(?:는|도|만)?|에(?:는|도)?|만으?로|[을를]\\s*통해|[은는이가])\\s*[^.!?。！？\\r\\n]{0,160}(?:확인|입증|증명|검증|알\\s*수|보여|보이|보인|보임|드러|나타|판독|측정|시연)","u");
  return evidenceFrame.test(text) || subjectProof.test(text) || /촬영\s*결과/u.test(text) ||
    /\b(?:photo(?:graph)?|image|picture|shot|scene|capture)\b[^.!?。！？\r\n]{0,160}\b(?:shows?|proves?|demonstrates?|confirms?|verif(?:y|ies)|establishes?|evidence|visible|depicts?)\b/iu.test(text);
}

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
