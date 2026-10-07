/**
 * ChatGPT 계정 Codex 비전 QC — ProductThumbnail.md §10 배점 + 자동 탈락 조건.
 */

import fs from "fs";
import { codexJson } from "../codex-text";
import type { ThumbnailKind } from "./prompt";

export type QcFailureCode =
  | "productDistorted"
  | "productNameMissing"
  | "koreanTypo"
  | "textCut"
  | "productSmall"
  | "notPhotoreal"
  | "mockup"
  | "forbiddenInfo"
  | "lowContrast"
  | "headlineSmall"
  | "editorialCard"
  | "extraText";

export interface ThumbnailQcBreakdown {
  productName: number; // 25
  fidelity: number; // 20
  korean: number; // 15
  readability: number; // 15
  photoreal: number; // 15
  layout: number; // 5
  forbidden: number; // 5
}

export interface ThumbnailQcReport {
  checked: boolean;
  pass: boolean;
  score: number;
  breakdown: ThumbnailQcBreakdown;
  failures: QcFailureCode[];
  autoFail: boolean;
  note: string;
}

export interface ThumbnailQcExpectation {
  kind: ThumbnailKind;
  productName: string;
  headline: string;
  subline?: string;
  badge?: string;
  referenceImagePath?: string | null;
}

export const QC_MAX: ThumbnailQcBreakdown = { productName: 25, fidelity: 20, korean: 15, readability: 15, photoreal: 15, layout: 5, forbidden: 5 };

export function qcMinScore(): number {
  const parsed = Number.parseInt(process.env.PRODUCT_THUMBNAIL_QC_MIN_SCORE || "", 10);
  return Number.isFinite(parsed) && parsed >= 50 && parsed <= 100 ? parsed : 95;
}

function clamp(value: unknown, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}

const AUTO_FAIL: QcFailureCode[] = ["productDistorted", "productNameMissing", "koreanTypo", "textCut", "forbiddenInfo", "mockup", "headlineSmall", "editorialCard"];

interface RawQc {
  breakdown?: Partial<Record<keyof ThumbnailQcBreakdown, unknown>>;
  failures?: unknown;
  note?: unknown;
}

/** 모델 응답을 점수/합격으로 환산한다 (순수 함수, 테스트 대상). */
export function scoreQcReport(raw: RawQc, minScore = qcMinScore()): ThumbnailQcReport {
  const breakdown: ThumbnailQcBreakdown = {
    productName: clamp(raw.breakdown?.productName, QC_MAX.productName),
    fidelity: clamp(raw.breakdown?.fidelity, QC_MAX.fidelity),
    korean: clamp(raw.breakdown?.korean, QC_MAX.korean),
    readability: clamp(raw.breakdown?.readability, QC_MAX.readability),
    photoreal: clamp(raw.breakdown?.photoreal, QC_MAX.photoreal),
    layout: clamp(raw.breakdown?.layout, QC_MAX.layout),
    forbidden: clamp(raw.breakdown?.forbidden, QC_MAX.forbidden),
  };
  const failures = (Array.isArray(raw.failures) ? raw.failures : [])
    .filter((item): item is QcFailureCode => typeof item === "string")
    .filter((item, index, list) => list.indexOf(item) === index);
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const autoFail = failures.some((code) => AUTO_FAIL.includes(code));
  return {
    checked: true,
    pass: !autoFail && score >= minScore,
    score,
    breakdown,
    failures,
    autoFail,
    note: typeof raw.note === "string" ? raw.note.slice(0, 300) : "",
  };
}

export async function qcThumbnail(imagePath: string, expected: ThumbnailQcExpectation): Promise<ThumbnailQcReport> {
  const enabled = (process.env.PRODUCT_THUMBNAIL_IMAGE_QC_ENABLED || "true").toLowerCase() !== "false";
  const skipped = (reason: string): ThumbnailQcReport => ({
    checked: false,
    pass: false,
    score: 0,
    breakdown: { productName: 0, fidelity: 0, korean: 0, readability: 0, photoreal: 0, layout: 0, forbidden: 0 },
    failures: [],
    autoFail: false,
    note: reason,
  });
  if (!enabled) return skipped("QC 비활성화");
  const images = [imagePath];
  const hasReference = Boolean(expected.referenceImagePath && fs.existsSync(expected.referenceImagePath));
  if (hasReference) {
    images.push(expected.referenceImagePath as string);
  }
  const isTravel = expected.kind === "TRAVEL";
  const prompt = [
    `첫 번째 이미지는 네이버 블로그 ${isTravel ? "여행 상품" : "상품"} 썸네일 생성 결과입니다.${hasReference ? " 두 번째 이미지는 원본 참조 사진입니다." : ""}`,
    "아래 기준으로만 채점해 JSON 으로 답하세요. 점수는 각 항목 최대치 이내의 정수입니다.",
    "",
    `기대 ${isTravel ? "상품/여행지" : "제품"}명: "${expected.productName}"`,
    `기대 헤드라인: "${expected.headline}"`,
    expected.subline ? `기대 서브라인: "${expected.subline}"` : "",
    expected.badge ? `기대 배지: "${expected.badge}"` : "",
    "",
    "채점 항목(최대점):",
    `- productName(${QC_MAX.productName}): ${isTravel ? "기대 여행지/상품명이 정확히 보이고 다른 이름으로 바뀌지 않음" : "원본과 동일한 제품·옵션임을 식별할 수 있음. 별도 작은 제품명 텍스트는 요구하지 않으며 헤드라인만 허용"}`,
    `- fidelity(${QC_MAX.fidelity}): ${hasReference ? "참조 사진과 형태·색상·용도가 크게 다르지 않음" : "실제 존재하는 장면/제품처럼 보이고 왜곡이 없음"}`,
    `- korean(${QC_MAX.korean}): 한글 오탈자·깨진 글자·가짜 글자·잘림 없음, 기대 문구와 일치`,
    `- readability(${QC_MAX.readability}): ${isTravel ? "20% 축소에서도 헤드라인이 읽힘(크기·대비)" : "120px와 240px 정사각 축소에서 모두 핵심 문구를 바로 읽을 수 있음. 1080px 기준 132px 이상 굵은 1~2줄 헤드라인; 작거나 흐리면 headlineSmall"}`,
    `- photoreal(${QC_MAX.photoreal}): 실제 사진 같은 조명·재질·그림자(벡터/카툰/플랫 아님)`,
    `- layout(${QC_MAX.layout}): ${isTravel ? "텍스트가 피사체를 가리지 않고 가장자리 10% 안에서 잘리지 않음" : "한 장의 자연스러운 전면 사진, 큰 제품과 6% 여백의 헤드라인. 작은 삽입사진, 설명 프레임, 카드·분할패널·불릿이 있으면 editorialCard. 허리선·밑단·라벨을 가리거나 자르면 productDistorted"}`,
    `- forbidden(${QC_MAX.forbidden}): 수수료/최저가/1위/워터마크/가짜 로고 같은 금지 정보 없음`,
    "",
    "failures 배열에는 해당하는 코드만 넣으세요:",
    "productDistorted, productNameMissing, koreanTypo, textCut, productSmall, notPhotoreal, mockup, forbiddenInfo, lowContrast, extraText, headlineSmall, editorialCard",
    "",
    '응답 형식: {"breakdown": {"productName": n, "fidelity": n, "korean": n, "readability": n, "photoreal": n, "layout": n, "forbidden": n}, "failures": ["..."], "note": "한 줄 설명"}',
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await codexJson<RawQc>({ user: prompt, imagePaths: images, timeoutMs: 120_000 });
    return scoreQcReport(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 검사 불가와 합격을 구분한다. 호출자는 재생성 대신 원본/로컬 합성 경로로 복귀한다.
    return skipped(`QC 실행 실패 — 생략 (${message.slice(0, 120)})`);
  }
}
