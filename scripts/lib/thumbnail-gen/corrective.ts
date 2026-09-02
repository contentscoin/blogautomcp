/**
 * 실패 유형별 교정 프롬프트 (ProductThumbnail.md §11 표).
 */

import { QC_MAX, type QcFailureCode, type ThumbnailQcReport } from "./qc";

const CORRECTIONS: Record<QcFailureCode, string> = {
  productDistorted: "Make the product more faithful to the provided reference image: same shape, color, material, and package impression.",
  productNameMissing: "Render the exact product name label exactly as provided. Do not replace it with a category name or generic product name.",
  koreanTypo: "Korean text must be exactly copied, fewer text strings, larger text, no extra text.",
  textCut: "Increase safe margins, keep all text fully inside the safe zone away from the edges.",
  productSmall: "Make the product much larger and sharper as the main hero object.",
  notPhotoreal: "More photorealistic real-world product scene, camera/lens realism, no vector or cartoon style.",
  mockup: "Remove the phone, laptop, or shopping screen. Focus on the product hero scene and exact product name label.",
  forbiddenInfo: "Remove all affiliate commission, commission rate, internal seller data, and unverified claims.",
  lowContrast: "Increase contrast between the headline and its background: put a clean panel or gradient behind the text.",
  extraText: "Remove every text element that is not in the required list. Only the required Korean strings may appear.",
};

export function correctionsFor(report: ThumbnailQcReport): string[] {
  const lines = report.failures.map((code) => CORRECTIONS[code]).filter(Boolean);
  if (lines.length === 0 && report.checked && !report.pass) {
    // 코드 없이 점수만 미달인 경우: 만점 대비 감점이 가장 큰 항목 기준 일반 교정
    const weakest = (Object.entries(report.breakdown) as Array<[keyof ThumbnailQcReport["breakdown"], number]>)
      .map(([key, value]) => [key, QC_MAX[key] - value] as const)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    if (weakest === "korean") lines.push(CORRECTIONS.koreanTypo);
    else if (weakest === "readability") lines.push(CORRECTIONS.lowContrast, "Make the headline larger.");
    else if (weakest === "photoreal") lines.push(CORRECTIONS.notPhotoreal);
    else if (weakest === "fidelity") lines.push(CORRECTIONS.productDistorted);
    else if (weakest === "productName") lines.push(CORRECTIONS.productNameMissing);
    else lines.push(CORRECTIONS.textCut);
  }
  return Array.from(new Set(lines));
}

export function buildCorrectivePrompt(basePrompt: string, report: ThumbnailQcReport, attempt: number): string {
  const corrections = correctionsFor(report);
  if (corrections.length === 0) return basePrompt;
  return [
    basePrompt,
    "",
    `Corrections required (attempt ${attempt}). The previous attempt failed QC${report.note ? `: ${report.note}` : "."}`,
    ...corrections.map((line) => `- ${line}`),
  ].join("\n");
}
