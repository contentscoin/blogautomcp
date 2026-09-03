import { composeBudgetedChatGptPrompt } from "./chatgpt-direct-prompt";
import { isMeaningfulProductEvidenceFeature } from "./product-editorial-plan";

export interface WritingPromptContract {
  version: "writing-prompt-contract/v1";
  kind: "SHOPPING" | "TRAVEL";
  sections: { min: number; max: number };
  characters: { min: number; max: number };
  sentences: { min: number; max: number };
  title: { min: number; max: number };
  hashtagCount: number;
  verifiedExperienceNotes: string;
}

export function createWritingPromptContract(input: {
  kind: WritingPromptContract["kind"];
  minimumSections: number;
  maximumSections: number;
  targetCharacters: { min: number; max: number };
  hashtagCount: number;
  verifiedExperienceNotes?: string;
}): WritingPromptContract {
  for (const [min, max] of [
    [input.minimumSections, input.maximumSections],
    [input.targetCharacters.min, input.targetCharacters.max],
  ]) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
      throw new Error("Invalid writing contract bounds");
    }
  }
  if (!Number.isInteger(input.hashtagCount) || input.hashtagCount < 3 || input.hashtagCount > 10) {
    throw new Error("Invalid writing contract hashtag count");
  }
  return {
    version: "writing-prompt-contract/v1",
    kind: input.kind,
    sections: { min: input.minimumSections, max: input.maximumSections },
    characters: { ...input.targetCharacters },
    sentences: { min: input.kind === "TRAVEL" ? 5 : 4, max: 6 },
    title: { min: 25, max: 35 },
    hashtagCount: input.hashtagCount,
    verifiedExperienceNotes: input.verifiedExperienceNotes?.trim() || "",
  };
}

/** Shape example, not a factual draft. The prose requirements still apply. */
export function getWritingOutputExample(contract: WritingPromptContract) {
  return {
    title: `${contract.title.min}~${contract.title.max}자 SEO 제목`,
    evidenceFacts: [] as string[],
    sections: [
      "소제목\n\n" + Array.from(
        { length: contract.sentences.min }, (_, index) => `근거에 맞춘 문장${index + 1}.`,
      ).join("\n"),
    ],
    hashtags: Array.from({ length: contract.hashtagCount }, (_, index) => `검색키워드${index + 1}`),
  };
}

/** Mandatory rules are shared by API/Codex, exported context, and browser recovery. */
export function formatWritingPromptContract(contract: WritingPromptContract): string {
  return [
    `[공유 필수 작성 계약 · ${contract.version}]`,
    "- 관측 분포와 선택 렌즈는 아래 필수 기준을 완화하지 않습니다. 기존 제목·사실성·품질 정책도 지킵니다.",
    `- 제목 ${contract.title.min}~${contract.title.max}자, 핵심 검색어를 앞에 배치합니다. 제목·소제목에 이모지를 넣지 않습니다.`,
    `- 본문 sections는 ${contract.sections.min}~${contract.sections.max}개입니다. 소제목·순서는 근거에 맞춰 구성합니다.`,
    `- 소제목·고지 문구를 제외하고 본문 문단을 구분자 없이 이은 문자열 길이(문단 내부 공백 포함)로 최소 ${contract.characters.min}자를 충족하고, 권장 상한 ${contract.characters.max}자 안에서 작성합니다.`,
    `- 각 섹션은 소제목, 빈 줄, ${contract.sentences.min}~${contract.sentences.max}개의 완결된 문장으로 작성하며 문장마다 줄바꿈합니다.`,
    "- 숫자를 채우려고 사실·일정·장소·역사·분위기·후기·성능을 지어내거나 같은 뜻을 반복하지 않습니다. 근거가 부족하면 충족했다고 주장하지 않습니다.",
    "- 제공된 출처 또는 실제 열어 확인한 자료의 사실만 사용합니다. 검색 도구가 없으면 제공된 근거 안에서 작성합니다.",
    "- 출처 없는 운영시간·입장료·호텔 등급·날씨 등 변동 정보와 불확실한 주장은 생략합니다. 추정형 표현을 확정형으로 바꿔 사실처럼 만들지 않습니다.",
    contract.verifiedExperienceNotes
      ? `- 실제 체험 표현은 다음 검증 메모에 명시된 사실에만 한정합니다: ${contract.verifiedExperienceNotes}`
      : "- 실제 구매·사용·방문·탑승·숙박·식사 경험을 만들지 않습니다. 제목에 후기·내돈내산·실사용·직접 써본·직접 다녀온 표현을 넣지 않습니다.",
    "- evidenceFacts는 모델이 정리한 후보이며 검증 증명이 아닙니다. 제공된 확인 사실과 일치하는 내용만 기록하고, 이미지에서 새로 추정한 사실이나 근거 없는 후보는 제외합니다. 없으면 []입니다.",
    `- 해시태그는 검색 의도가 분명한 ${contract.hashtagCount}개입니다.`,
    "- 고지 문구와 원시 URL은 출력하지 않습니다. 커넥트 카드와 고지는 시스템이 별도로 붙입니다.",
    "- title, evidenceFacts, sections, hashtags 필드를 가진 JSON 하나만 출력합니다. 코드블록·작업 설명은 넣지 않습니다.",
    "- 다음은 필드와 섹션 한 개의 형식 예시입니다. 실제 sections 개수와 전체 분량은 위 기준을 따릅니다.",
    JSON.stringify(getWritingOutputExample(contract)),
  ].join("\n");
}

/** Only evidence may be truncated; the full mandatory contract is in the fixed suffix. */
export function composeBudgetedWritingPrompt(input: {
  contract: WritingPromptContract;
  prefix: string;
  evidence: string;
  suffix: string;
  maxChars: number;
}): string {
  return composeBudgetedChatGptPrompt({
    ...input,
    suffix: [input.suffix, formatWritingPromptContract(input.contract)].filter(Boolean).join("\n\n"),
  });
}

export function formatDraftSubmissionNextAction(): string {
  return [
    "현재 ChatGPT 대화에서 systemPrompt와 userPrompt의 공유 필수 작성 계약을 적용하세요.",
    "쇼핑은 referenceImageUrls를 읽되 evidenceFacts를 자동 검증 근거로 취급하지 말고 제공된 확인 사실과 대조하세요.",
    "qualityChecklist를 내부 검수한 JSON 원고를 post_submit_draft로 제출하고 작업을 job_get으로 확인하세요.",
    "contentQuality.canPublish가 false이면 score만 보지 말고 code, blockers, 실패 signals와 compositionQualityReport를 구분하세요.",
    "본문 사실성·분량·섹션·반복·고지 등 텍스트 실패가 명시된 경우에만 해당 원인을 고쳐 새 idempotencyKey로 원고를 다시 제출하세요.",
    "composition-quality, representative-image, thumbnail 등 이미지·배치 실패만 있으면 원고를 재작성하거나 재제출하지 마세요. 기존 원고를 유지하고 이미지·구성 보완 단계로 넘기세요: post_get_draft 의 imageSlots 에서 generationMissing 이 있는 파트의 imagePrompt 로 ChatGPT 내장 이미지 생성을 실행하고 post_apply_section_image 로 붙입니다. PC 는 이미지를 생성하지 않습니다.",
    "composition-quality 안에 본문 분량·섹션 실패도 있으면 그 텍스트 항목만 보강합니다. 원인이 불명확하면 실패 상세를 조회하고 재작성을 추측하지 마세요.",
    "텍스트 QC 통과나 100점은 이미지 준비·전체 발행 가능을 의미하지 않습니다. 원고를 사용자에게 먼저 보여주고 발행은 별도 확인을 받으세요.",
  ].join(" ");
}

function normalizeEvidenceText(text: string): string {
  return text.normalize("NFC")
    // Fold full-width typography only: NFKC would also turn numeric exponents (²) into digits (2).
    .replace(/[\uFF01-\uFF5E]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
    .replace(/(?<![\d,])\d{1,3}(?:,\d{3})+(?![\d,])/gu, (number) => number.replace(/,/gu, ""))
    .trim()
    .replace(/[.!。]$/u, "")
    // A label colon is formatting; numeric colons, decimal points, signs, units and qualifiers are not.
    .replace(/(\p{L})\s*:\s*/gu, "$1")
    .replace(/\s+/gu, " ")
    .replace(/(?<!\d)\s+|\s+(?!\d)/gu, "");
}

const EVIDENCE_NEGATION_PATTERN = /안\s*함|안\s*됨|불가|없음|없습니다|미지원|미포함|않|아님|아닙니다|제외/u;

/** Split a specification row only when every slash-delimited part is a labelled pair. */
function snapshotEvidenceUnits(line: string): string[] {
  const parts = line.split(/\s+\/\s+/u);
  return parts.length > 1 && parts.every((part) => /^[^:：/]+[:：]\s*\S/u.test(part))
    ? [line, ...parts]
    : [line];
}

/** Compatibility for the existing product-name + selling-price format, not arbitrary fact recombination. */
function isGroundedSellingPrice(fact: string, snapshotLines: readonly string[]): boolean {
  const match = /^(.*?)판매가\s*[:：]?\s*([\d,]+\s*원)[.!。]?$/u.exec(fact);
  if (!match) return false;
  const price = normalizeEvidenceText(match[2]);
  const labelledPrices: string[] = [];
  const barePrices = new Set<string>();
  for (const line of snapshotLines) {
    const sourcePrice = /^(?:(가격|판매가)\s*[:：]?\s*)?([\d,]+\s*원)[.!。]?$/u.exec(line);
    if (!sourcePrice) continue;
    const value = normalizeEvidenceText(sourcePrice[2]);
    if (sourcePrice[1]) labelledPrices.push(value);
    else barePrices.add(value);
  }
  // The caller also supplies originalPrice without a label. Multiple bare prices cannot identify selling price.
  const supportedPrices = labelledPrices.length ? labelledPrices : barePrices.size === 1 ? [...barePrices] : [];
  if (!/^\d+원$/u.test(price) || !supportedPrices.includes(price)) return false;

  const identity = match[1].trim();
  if (!identity) return true;
  const productName = snapshotLines[0] || "";
  if (normalizeEvidenceText(identity) === normalizeEvidenceText(productName)) return true;

  // Legacy noun-phrase format: "BRAND 러닝 조끼 메쉬 소재" -> "메쉬 소재 러닝 조끼".
  // Move only the complete trailing material phrase; never reorder specification tokens or numbers.
  const materialName = /^(.*?)\s+([\p{L}]+\s+소재)$/u.exec(productName);
  if (!materialName || /[\d:：/]/u.test(productName) || EVIDENCE_NEGATION_PATTERN.test(productName)) return false;
  const names = [materialName[1], materialName[1].replace(/^[A-Z][A-Z0-9]*\s+/u, "")];
  return names.some((name) => normalizeEvidenceText(identity) === normalizeEvidenceText(`${materialName[2]} ${name}`));
}

/**
 * ChatGPT가 상세이미지에서 읽었다고 제출한 evidenceFacts 중 스냅샷 텍스트(상품명·설명·특징·가격)로
 * 뒷받침되는 것만 "근거가 있는" 사실로 본다. 보수적 규칙:
 * - 공백과 제한된 서식만 정규화한 뒤 완전한 원문 항목과 일치해야 한다.
 * - 속성·값·부정·조건을 함께 비교한다. 토큰 재조합, 부분 발췌, 의역은 인정하지 않는다.
 * - 기존 상품명·판매가 조합은 별도의 제한된 형식 규칙으로만 인정한다.
 * 이 결과는 이번 제출의 채점에만 쓰이고 패키지나 DB의 source features로 저장되지 않는다.
 */
export function selectGroundedEvidenceFacts(candidates: unknown, snapshotText: string): {
  grounded: string[];
  rejected: string[];
} {
  const snapshotLines = snapshotText.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const meaningfulUnits = new Set(snapshotLines.flatMap(snapshotEvidenceUnits)
    .filter(isMeaningfulProductEvidenceFeature).map(normalizeEvidenceText));
  const grounded: string[] = [];
  const rejected: string[] = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (typeof candidate !== "string") continue;
    const fact = candidate.replace(/\s+/gu, " ").trim();
    if (!fact) continue;
    if (meaningfulUnits.has(normalizeEvidenceText(fact)) || isGroundedSellingPrice(fact, snapshotLines)) grounded.push(fact);
    else rejected.push(fact);
  }
  return { grounded: Array.from(new Set(grounded)).slice(0, 12), rejected };
}

/** Conservative whole-fact matching: no substring, paraphrase, punctuation or number removal. */
export function reviewGeneratedEvidenceFacts(candidates: unknown, suppliedFacts: readonly string[]): {
  matchedSuppliedFacts: string[];
  unverifiedFacts: string[];
} {
  const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
  const supplied = new Map(suppliedFacts.map((fact) => [normalize(fact), fact]));
  const matched = new Set<string>();
  const unverified = new Set<string>();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const key = normalize(candidate);
    const source = supplied.get(key);
    if (source) matched.add(source);
    else unverified.add(candidate);
  }
  return { matchedSuppliedFacts: [...matched], unverifiedFacts: [...unverified] };
}
