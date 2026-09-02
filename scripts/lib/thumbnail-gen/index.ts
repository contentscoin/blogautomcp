/**
 * 썸네일 생성 진입점 — 쇼핑/여행 공통. 문구까지 gpt-image 가 그리고 비전 QC 로 검수한다.
 */

import { isImageApiThumbnailAvailable } from "../openai-image";
import { extractTravelProductFacts } from "../travel-content";
import { generateThumbnailWithQc, type ThumbnailGenerationResult } from "./generate";
import { buildShoppingThumbnailPrompt, buildTravelThumbnailPrompt, listThumbnailMoods, type ThumbnailCopy, type ThumbnailKind } from "./prompt";

export * from "./prompt";
export * from "./qc";
export * from "./corrective";
export * from "./generate";

export interface GenerateThumbnailInput {
  kind: ThumbnailKind;
  productName: string;
  categoryName?: string;
  description?: string;
  features?: string[];
  price?: string;
  copy: ThumbnailCopy;
  moodId?: string;
  referenceImagePath?: string | null;
  outputDir: string;
  maxAttempts?: number;
  onLog?: (line: string) => void;
}

export function isGenerativeThumbnailAvailable(): boolean {
  return isImageApiThumbnailAvailable();
}

/** 생성형 한글 문구는 짧을수록 정확하다. 헤드라인을 10자 안팎으로 압축한다. */
export function condenseHeadline(headline: string, max = 12): string {
  const cleaned = headline.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace >= 4 ? cut.slice(0, lastSpace) : cut).trim();
}

export function buildThumbnailPrompt(input: GenerateThumbnailInput): string {
  const copy: ThumbnailCopy = { ...input.copy, headline: condenseHeadline(input.copy.headline) };
  if (input.kind === "TRAVEL") {
    return buildTravelThumbnailPrompt({
      productName: input.productName,
      facts: extractTravelProductFacts(input.productName, input.description || "", input.features || []),
      copy,
      moodId: input.moodId,
      hasReferenceImage: Boolean(input.referenceImagePath),
    });
  }
  return buildShoppingThumbnailPrompt({
    productName: input.productName,
    categoryName: input.categoryName,
    description: input.description,
    features: input.features,
    price: input.price,
    copy,
    moodId: input.moodId,
  });
}

export async function generateThumbnail(input: GenerateThumbnailInput): Promise<ThumbnailGenerationResult | null> {
  const prompt = buildThumbnailPrompt(input);
  const headline = condenseHeadline(input.copy.headline);
  const log = input.onLog || (() => undefined);
  const mood = listThumbnailMoods(input.kind).find((item) => item.id === input.moodId);
  log(`gpt-image 썸네일 생성 시작 (${input.kind}, 무드: ${mood?.label || "자동"}, 헤드라인: "${headline}")`);
  return generateThumbnailWithQc({
    prompt,
    referenceImagePath: input.referenceImagePath,
    outputDir: input.outputDir,
    fileLabel: input.copy.productNameLabel || input.productName,
    maxAttempts: input.maxAttempts,
    expected: {
      kind: input.kind,
      productName: input.copy.productNameLabel || input.productName,
      headline,
      subline: input.copy.subline,
      badge: input.copy.badge,
      referenceImagePath: input.referenceImagePath,
    },
    onAttempt: (attempt) => {
      if (!attempt.path) log(`시도 ${attempt.attempt}: 생성 실패`);
      else if (attempt.qc?.checked) log(`시도 ${attempt.attempt}: QC ${attempt.qc.score}점 ${attempt.qc.pass ? "통과" : `불합격 (${attempt.qc.failures.join(", ") || attempt.qc.note})`}`);
      else log(`시도 ${attempt.attempt}: QC 생략 (${attempt.qc?.note || ""})`);
    },
  });
}
