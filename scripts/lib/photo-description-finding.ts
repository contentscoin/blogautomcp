import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "./app-paths";
import { atomicWriteTextFile } from "../../src/lib/atomic-text-file";
import { publicationImageContext } from "./publish-image-rejections";
import type { ResolvedPostDocumentV1 } from "../../src/lib/post-composition-contract";

export interface PhotoDescriptionFinding {
  category: "photo-description-mismatch";
  nodeIndex: number;
  sectionId: string;
  assetPath: string;
  sha256: string;
  context: string;
  /** Exact erroneous sentence in both saved body and actual published nodes. */
  literalClaim: string;
}

/** A visual reason is evidence, never free-form edit instructions. Only a
 * quoted, unique, complete photo-description sentence can become an edit. */
export function locatePhotoDescriptionSentence(bodyInput: string | readonly string[], reason: string): string | null {
  const body = Array.isArray(bodyInput) ? bodyInput.join("\n") : String(bodyInput);
  const quotes = [...reason.matchAll(/["'“‘「『]([^"'”’」』\r\n]{8,260})["'”’」』]/gu)].map(match => match[1].trim());
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index <= body.length; index++) {
    const character = body[index];
    // A decimal/product version is part of its sentence, never a boundary.
    const decimal = character === "." && /\d/u.test(body[index - 1] || "") && /\d/u.test(body[index + 1] || "");
    if (index === body.length || character === "\n" || /[.!?。！？]/u.test(character || "") && !decimal) {
      const sentence = body.slice(start, index + (character === "\n" ? 0 : 1)).trim();
      if (sentence) sentences.push(sentence);
      start = index + 1;
    }
  }
  const withoutTerminal = (value: string) => value.replace(/[.!?。！？]$/u, "").trim();
  const matches = [...new Set(sentences.filter(sentence => sentence.length <= 260 &&
    /^(?:(?:이|해당|본문의|첨부한|생성(?:된)?)\s*)?(?:제품\s*)?(?:연출\s*)?(?:사진|이미지)(?:에는|에서는|에서|은|는|에|의|\s*속)/u.test(sentence) &&
    // A product specification/identifier is not an expendable scene description.
    !/\d|라벨|표기|용량|규격|모델|성분|인증|온도|시간|수치|측정|전압|중량|무게|용적/u.test(sentence) &&
    quotes.some(quote => withoutTerminal(sentence) === withoutTerminal(quote))))];
  if (matches.length !== 1 || body.split(matches[0]).length !== 2) return null;
  return matches[0];
}

export function photoDescriptionFinding(input: {
  composition: Pick<ResolvedPostDocumentV1, "renderNodes" | "sections">;
  nodeIndex: number; sectionId: string | null; assetPath: string; sha256: string;
  sectionBody: string | readonly string[]; allowProductPhoto: boolean; role: string;
  verdict: Record<string, unknown> & { reason: string };
}): PhotoDescriptionFinding | null {
  const row = input.verdict;
  // Accepted=false alone must never be interpreted as a text-only defect.
  // Identity, options, notices, format and feature-evidence gates remain adverse.
  if (!input.sectionId || input.role === "thumbnail" || !/^[a-f0-9]{64}$/u.test(input.sha256) ||
      row.photoClaimMatches !== false || row.identityMatches !== true || row.notice !== false ||
      row.mixedOptions !== false || row.singlePhotograph !== true || row.noGraphicLayout !== true ||
      row.textPolicyMatches !== true || (row.reviewClass === "product-photo" && !input.allowProductPhoto)) return null;
  const literalClaim = locatePhotoDescriptionSentence(input.sectionBody, row.reason);
  const section = input.composition.sections.find(item => item.id === input.sectionId);
  const paragraphs = input.composition.renderNodes.filter(node => node.kind === "paragraph" && node.sectionId === input.sectionId)
    .map(node => node.kind === "paragraph" ? node.text : "");
  if (!literalClaim || !section || section.body.filter(text => text.includes(literalClaim)).length !== 1 ||
      paragraphs.filter(text => text.includes(literalClaim)).length !== 1) return null;
  return { category: "photo-description-mismatch", nodeIndex: input.nodeIndex, sectionId: input.sectionId,
    assetPath: input.assetPath, sha256: input.sha256,
    context: publicationImageContext(input.composition, input.sectionId), literalClaim };
}

function location(id: string): string {
  if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(id)) throw new Error("Invalid package ID");
  return path.join(getAppDataDir(), "prepared-brand-posts", id, "photo-description-findings.json");
}
export function findingKey(finding: PhotoDescriptionFinding): string {
  return crypto.createHash("sha256").update(JSON.stringify(finding)).digest("hex");
}
export function readPhotoDescriptionFindings(id: string): PhotoDescriptionFinding[] {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(location(id), "utf8"));
    return Array.isArray(value) ? value.filter((item): item is PhotoDescriptionFinding => item &&
      item.category === "photo-description-mismatch" && Number.isSafeInteger(item.nodeIndex) && item.nodeIndex >= 0 &&
      typeof item.sectionId === "string" && typeof item.assetPath === "string" &&
      /^[a-f0-9]{64}$/u.test(item.sha256) && /^[a-f0-9]{64}$/u.test(item.context) &&
      typeof item.literalClaim === "string" && item.literalClaim.length >= 8 && item.literalClaim.length <= 260) : [];
  } catch { return []; }
}
/** Persist only findings from the real server audit. The repair endpoint never
 * accepts a client-supplied verdict or replacement text. */
export function savePhotoDescriptionFindings(id: string, findings: PhotoDescriptionFinding[]): void {
  const file = location(id);
  if (!fs.existsSync(path.join(path.dirname(file), "manifest.json"))) return;
  atomicWriteTextFile(file, JSON.stringify(findings.slice(0, 12), null, 2));
}
