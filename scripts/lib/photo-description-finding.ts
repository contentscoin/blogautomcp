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

// A visual mismatch never authorizes deleting a specification, option fact,
// performance claim or an instruction embedded in model/image text.
const protectedPhotoFact = /[A-Za-z\d]|라벨|표기|표시|로고|브랜드|상표|인쇄|문구|번호|용량|규격|모델|성분|인증|온도|시간|수치|측정|전압|중량|무게|용적|원산지|제조|기종|옵션|구성|세트|수량|개수|성능|효능|효과|기능|작동|살균|방수|방진|충전|배터리|삭제|재작성|프롬프트|명령|지시|승인|시스템|(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(?:개|대|병|통|벌|켤레|쌍|가지)(?=[가은는이을를의만씩로과와도\s,.!?。！？]|$)/u;
const explicitPhotoSubject = /^(?:(?:이|해당|본문의|첨부한|제공된|판매자가\s*제공한|생성(?:된)?)\s*)?(?:(?:제품|상자)\s*)?(?:(?:연출|원본|참조|판매자)\s*)?(?:사진|이미지)(?:에는|에서는|에서|처럼|은|는|에|의|\s*속)/u;
// Closed visual language, not an extensible capability blacklist. Unrecognized
// nouns, count expressions and operating terms require manual text review.
// Atoms permit normal Hangul spacing/josa; no value is inferred or substituted.
const visualAtoms = [
  "밝은", "어두운", "투명", "불투명", "둥근", "각진", "길쭉한", "긴", "짧은", "넓은", "좁은", "작은", "큰",
  "흰색", "검은색", "검정색", "검정", "갈색", "초록색", "연보라색", "보라색", "베이지색", "아이보리색",
  "원목", "목재", "나무", "금속", "유리", "플라스틱", "천", "상단", "하단", "위", "아래", "옆", "앞", "뒤",
  "프레임", "용기", "조명", "본체", "상품", "제품", "상자", "뚜껑", "받침", "기둥", "손잡이", "고리", "끈", "밴드", "칸",
  "제형", "바닥", "카펫", "접시", "고기", "갈비", "곶감", "모습", "외형", "형태", "구조", "장면",
  "펼쳐져", "놓여", "놓인", "담겨", "담긴", "걸려", "걸린", "이어진", "나뉜", "길게", "서로", "다른",
  "양념한", "조리", "전", "밀고", "지나가는", "사용", "잘", "맞는", "한", "있어요", "있습니다", "보여요", "보입니다",
  "이에요", "예요", "입니다", "과", "와", "가", "이", "은", "는", "을", "를", "의", "에", "로", "으로", "마다",
] as const;
function closedVisualSentence(value: string): boolean {
  const description = value.replace(explicitPhotoSubject, "");
  if (!/^[가-힣\s,.!?。！？·]+$/u.test(description)) return false;
  const words = description.match(/[가-힣]+/gu) || [];
  return words.length > 0 && words.every(word => {
    const reachable = new Set([0]);
    for (let offset = 0; offset < word.length; offset++) {
      if (!reachable.has(offset)) continue;
      for (const atom of visualAtoms) if (word.startsWith(atom, offset)) reachable.add(offset + atom.length);
    }
    return reachable.has(word.length);
  });
}
function photoSentences(body: string): string[] {
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
  return sentences;
}
function implicitAppearance(sentence: string): boolean {
  return /^(?:밝은|어두운|투명한?|둥근|각진|길쭉한|흰색|검은색|검정|갈색|원목)/u.test(sentence) &&
    !/[A-Za-z]|선택|추천|취향|어울|좋[아은]|필요|확인|구매|색상은|재질은|소재는/u.test(sentence) &&
    /(?:외형|형태|모습|구조)(?:이에요|예요|입니다)[.!?。！？]$/u.test(sentence);
}
/** Recheck even a historical server finding before deleting its bound literal. */
export function isRepairablePhotoDescriptionLiteral(value: string): boolean {
  const sentences = photoSentences(value);
  return value.length >= 8 && value.length <= 260 && !protectedPhotoFact.test(value) &&
    sentences.length === 1 && sentences[0] === value && closedVisualSentence(value) &&
    (explicitPhotoSubject.test(value) || implicitAppearance(value));
}

/** A visual reason is evidence, never free-form edit instructions. A new
 * implicit appearance description requires the exact indexed published body
 * objection AND a separate whole-sentence quote; neither permits paragraph edits. */
export function locatePhotoDescriptionSentence(bodyInput: string | readonly string[], reason: string, objection?: unknown): string | null {
  const paragraphs: readonly string[] = Array.isArray(bodyInput) ? bodyInput : [String(bodyInput)];
  const body = paragraphs.join("\n");
  const quotes = [...reason.matchAll(/["'“‘「『«]([^"'”’」』»\r\n]{8,260})["'”’」』»]/gu)].map(match => match[1].trim());
  let source = body;
  if (objection !== undefined) {
    if (!objection || typeof objection !== "object" || Array.isArray(objection)) return null;
    const proof = objection as Record<string, unknown>;
    if (Object.keys(proof).length !== 5 || proof.origin !== "section-body" || proof.scope !== "pictured-appearance" ||
        !Number.isSafeInteger(proof.sourceIndex) || Number(proof.sourceIndex) < 0 ||
        typeof proof.quote !== "string" || proof.quote !== paragraphs[Number(proof.sourceIndex)] ||
        typeof proof.conflict !== "string" || !proof.conflict.trim()) return null;
    source = proof.quote;
  }
  const withoutTerminal = (value: string) => value.replace(/[.!?。！？]$/u, "").trim();
  const matches = [...new Set(photoSentences(source).filter(sentence => {
    if (!isRepairablePhotoDescriptionLiteral(sentence)) return false;
    if (explicitPhotoSubject.test(sentence)) return quotes.some(quote => withoutTerminal(sentence) === withoutTerminal(quote));
    // Deliberately narrow: a direct description ending in a visible form, not
    // a preference, purchase recommendation, material/option declaration or claim.
    return objection !== undefined && implicitAppearance(sentence) && quotes.includes(sentence);
  }))];
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
  const section = input.composition.sections.find(item => item.id === input.sectionId);
  const paragraphs = input.composition.renderNodes.filter(node => node.kind === "paragraph" && node.sectionId === input.sectionId)
    .map(node => node.kind === "paragraph" ? node.text : "");
  if (JSON.stringify(Array.isArray(input.sectionBody) ? input.sectionBody : [input.sectionBody]) !== JSON.stringify(paragraphs) ||
      row.photoClaimObjection === undefined) return null;
  const literalClaim = locatePhotoDescriptionSentence(paragraphs, row.reason, row.photoClaimObjection);
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
