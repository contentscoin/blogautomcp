/**
 * 포스팅 각도 — 상품 하나로 "전체 리뷰" 1편과 "특정 주제" 글 여러 편을 쓴다.
 *
 * 글 구조 = 상품 유형 템플릿 × 포스팅 각도. 각도는 근거 조건을 가진다. 근거가 부족한 각도는
 * 목록에 보이지 않는다(없는 내용을 지어내지 않기 위해). 형제 글끼리는 대표 키워드·섹션 골격·
 * 이미지·문장이 겹치지 않도록 프롬프트와 겹침 검사로 관리한다.
 */

import { sentenceTokens, splitSentences, tokenSimilarity } from "../draft-quality-signals";
import type { TopicConnectKind } from "./types";

export type ShoppingPostAngleId =
  | "full-review"
  | "how-to"
  | "problem-solve"
  | "deep-dive"
  | "compare"
  | "situation-gift"
  | "care-longterm";

export type TravelPostAngleId =
  | "full-review"
  | "day-highlight"
  | "prep-tips"
  | "who-fits"
  | "food-spot"
  | "season";

export type PostAngleId = ShoppingPostAngleId | TravelPostAngleId;

export const DEFAULT_POST_ANGLE: PostAngleId = "full-review";

export interface PostAngleEvidence {
  kind: TopicConnectKind;
  productName: string;
  description?: string | null;
  features?: readonly string[] | null;
  /** 사용자가 체험 메모를 입력했는지 */
  hasExperienceNotes?: boolean;
}

interface EvidenceView {
  kind: TopicConnectKind;
  name: string;
  lines: string[];
  corpus: string;
  hasExperienceNotes: boolean;
}

export interface PostAngleDefinition {
  id: PostAngleId;
  kind: TopicConnectKind;
  label: string;
  /** 이 각도의 글이 답하는 질문 */
  goal: string;
  /** 대표 검색어 방향. 형제 글끼리 서로 달라야 한다. {상품명} {여행지} 자리표시자 */
  keywordPattern: string;
  /** 짧은 글 골격(소제목 방향). 전체 리뷰는 상품 유형 템플릿 전체를 쓴다. */
  skeleton: readonly string[];
  /** 이미지 우선순위 */
  imageFocus: string;
  /** 추천 우선순위(높을수록 먼저) */
  priority: number;
  requires: (evidence: EvidenceView) => { ok: boolean; reason: string };
}

const count = (lines: readonly string[], pattern: RegExp) => lines.filter((line) => pattern.test(line)).length;
const always = (reason: string) => () => ({ ok: true, reason });

const SHOPPING_ANGLES: PostAngleDefinition[] = [
  {
    id: "full-review", kind: "SHOPPING", label: "전체 리뷰",
    goal: "이 제품을 살지 말지 한 번에 판단할 수 있게 전체를 정리한다.",
    keywordPattern: "{상품명} 후기", skeleton: [], imageFocus: "대표컷·구성·사용 장면을 고르게",
    priority: 100, requires: always("기본 글"),
  },
  {
    id: "how-to", kind: "SHOPPING", label: "사용법·루틴",
    goal: "처음 쓰는 사람이 개봉부터 설치·사용·관리까지 순서대로 따라 할 수 있게 한다.",
    keywordPattern: "{상품명} 사용법",
    skeleton: ["사용법 한눈에 보기", "개봉하면 먼저 할 일", "설치·세팅 순서", "매일 쓰는 방법", "관리·세척 방법", "처음 쓸 때 헷갈리는 점 FAQ"],
    imageFocus: "조작부·사용 순서가 보이는 상세페이지 근거 구간과 사용 단계 연출컷",
    priority: 80,
    requires: (e) => {
      const hits = count(e.lines, /사용|설치|조작|세척|관리|충전|방법|루틴|바르|섭취|먹는|착용|연결|페어링/u);
      return hits >= 1 ? { ok: true, reason: `사용·관리 근거 ${hits}건` } : { ok: false, reason: "사용·설치·관리 근거가 없음" };
    },
  },
  {
    id: "problem-solve", kind: "SHOPPING", label: "고민 해결",
    goal: "특정 생활 고민 하나를 이 제품이 어떻게 줄여주는지 보여준다.",
    keywordPattern: "{고민} 해결 {카테고리}",
    skeleton: ["이런 고민 있으셨죠", "고민이 생기는 이유", "이 제품이 해결하는 방식", "실제로 달라지는 장면", "해결되지 않는 부분", "이런 분께 맞아요"],
    imageFocus: "고민 상황과 해결 장면 연출컷, 해결 기능의 상세페이지 근거 구간",
    priority: 70,
    requires: (e) => e.lines.length >= 2 ? { ok: true, reason: `기능 근거 ${e.lines.length}건` } : { ok: false, reason: "기능 근거가 2건 미만" },
  },
  {
    id: "deep-dive", kind: "SHOPPING", label: "성분·스펙 집중",
    goal: "성분·소재·스펙 하나를 깊게 풀어 그 수치가 무엇을 뜻하는지 설명한다.",
    keywordPattern: "{상품명} {핵심 스펙}",
    skeleton: ["핵심 스펙 한눈에 보기", "이 수치가 뜻하는 것", "비슷한 제품 기준과 비교", "사용 장면에서의 차이", "확인이 필요한 부분"],
    imageFocus: "스펙표·성분표 상세페이지 근거 구간 위주",
    priority: 60,
    requires: (e) => {
      const hits = count(e.lines, /\d|성분|소재|함량|원재료|mAh|\bW\b|ml|mm|cm|kg|인치|해상도|용량/u);
      return hits >= 3 ? { ok: true, reason: `스펙·성분 근거 ${hits}건` } : { ok: false, reason: "스펙·성분 근거가 3건 미만" };
    },
  },
  {
    id: "compare", kind: "SHOPPING", label: "옵션·구성 비교",
    goal: "옵션·구성·대안 중 무엇을 골라야 하는지 기준을 세운다.",
    keywordPattern: "{상품명} 옵션 비교",
    skeleton: ["비교 결론 먼저", "옵션별 차이 정리", "이런 분은 이 옵션", "구성·가격 조건", "고르기 전 확인할 점"],
    imageFocus: "옵션·사이즈·구성 비교 상세페이지 근거 구간",
    priority: 55,
    requires: (e) => /(?:옵션|구성|사이즈|색상|컬러|용량|타입)[^\n]{0,30}(?:\d+\s*종|\/|,|·|또는|중\s*선택)/u.test(e.corpus)
      ? { ok: true, reason: "옵션·구성 선택지 확인" }
      : { ok: false, reason: "비교할 옵션·구성이 2개 이상 확인되지 않음" },
  },
  {
    id: "situation-gift", kind: "SHOPPING", label: "선물·시즌·상황",
    goal: "특정 상황(선물·시즌·캠핑 등)에서 이 제품이 맞는지 판단하게 한다.",
    keywordPattern: "{상황} {카테고리} 추천",
    skeleton: ["이 상황에 먼저 볼 것", "이 제품이 맞는 이유", "구성·포장 확인", "함께 쓰면 좋은 장면", "고르기 전 체크리스트"],
    imageFocus: "상황 연출컷(선물 포장·시즌 장면)",
    priority: 45,
    requires: (e) => {
      const hit = e.corpus.match(/선물|세트|기념일|부모님|명절|여름|겨울|캠핑|여행용|휴대용|사무실|출장/u)?.[0];
      return hit ? { ok: true, reason: `상황 근거: ${hit}` } : { ok: false, reason: "선물·시즌·상황 근거가 없음" };
    },
  },
  {
    id: "care-longterm", kind: "SHOPPING", label: "관리·장기 사용",
    goal: "오래 쓰면서 확인한 관리·보관·변화를 정리한다.",
    keywordPattern: "{상품명} 관리법",
    skeleton: ["오래 써보니 달라진 점", "관리·세척 루틴", "보관 방법", "소모품·교체 주기", "오래 쓰려면 피할 것"],
    imageFocus: "관리·보관 장면 연출컷, 관리법 상세페이지 근거 구간",
    priority: 40,
    requires: (e) => e.hasExperienceNotes
      ? { ok: true, reason: "체험 메모 있음" }
      : { ok: false, reason: "장기 사용 글은 체험 메모가 필요함" },
  },
];

const TRAVEL_ANGLES: PostAngleDefinition[] = [
  {
    id: "full-review", kind: "TRAVEL", label: "전체 일정 리뷰",
    goal: "이 여행 상품을 예약할지 한 번에 판단할 수 있게 일정·조건·꿀팁을 정리한다.",
    keywordPattern: "{여행지} {기간} 여행", skeleton: [], imageFocus: "대표 풍경·핵심 코스·포함사항을 고르게",
    priority: 100, requires: always("기본 글"),
  },
  {
    id: "prep-tips", kind: "TRAVEL", label: "준비 꿀팁",
    goal: "이 여행을 떠나기 전 챙길 것(환전·결제·유심·짐·입국·공항 이동)을 꿀팁 체크리스트로 정리한다.",
    keywordPattern: "{여행지} 여행 준비물",
    skeleton: ["준비 꿀팁 한눈에 보기", "환전·결제 꿀팁", "유심·eSIM·데이터", "옷차림과 짐 싸기", "입국 서류와 공항 이동", "현지에서 바로 쓰는 꿀팁", "자주 묻는 질문"],
    imageFocus: "여행 준비물·공항·교통 연출컷",
    priority: 85,
    requires: (e) => e.name.trim() ? { ok: true, reason: "여행지 확인" } : { ok: false, reason: "여행지가 확인되지 않음" },
  },
  {
    id: "food-spot", kind: "TRAVEL", label: "맛집·스폿 꿀팁",
    goal: "일정 중 먹고 보고 사는 스폿(식사·시장·야경·쇼핑)을 꿀팁 위주로 정리한다.",
    keywordPattern: "{여행지} 맛집 꿀팁",
    skeleton: ["먹고 보는 꿀팁 한눈에", "일정 속 식사 포인트", "시장·거리 먹거리", "야경·사진 스폿", "쇼핑 스폿과 팁", "자유시간 활용 꿀팁", "자주 묻는 질문"],
    imageFocus: "음식·야경·거리 풍경",
    priority: 75,
    requires: (e) => {
      const hit = e.corpus.match(/식사|조식|중식|석식|특식|맛집|시장|야시장|쇼핑|야경|카페|먹거리/u)?.[0];
      return hit ? { ok: true, reason: `스폿 근거: ${hit}` } : { ok: false, reason: "식사·시장·쇼핑·야경 근거가 없음" };
    },
  },
  {
    id: "day-highlight", kind: "TRAVEL", label: "일차·장소 집중",
    goal: "하루 또는 한 장소를 깊게 다뤄 동선과 볼거리, 현지 꿀팁을 보여준다.",
    keywordPattern: "{여행지} {장소} 코스",
    skeleton: ["이 날(장소) 한눈에 보기", "도착과 첫 장면", "꼭 볼 것", "천천히 즐기는 방법", "사진 포인트", "현지 꿀팁", "이동과 마무리"],
    imageFocus: "해당 일차·장소 풍경 여러 장",
    priority: 65,
    requires: (e) => {
      const days = count(e.lines, /\d+\s*일차/u);
      const places = e.lines.find((line) => /핵심 방문지|방문지/u.test(line))?.split(/[,·]/u).length ?? 0;
      return days >= 2 || places >= 2
        ? { ok: true, reason: days >= 2 ? `일차 일정 ${days}건` : `방문지 ${places}곳` }
        : { ok: false, reason: "일차별 일정이나 방문지가 2개 이상 확인되지 않음" };
    },
  },
  {
    id: "who-fits", kind: "TRAVEL", label: "동반자별 적합도",
    goal: "부모님·아이 동반·커플 등 동반자별로 이 일정이 맞는지, 포함·불포함 조건과 함께 판단하게 한다.",
    keywordPattern: "{여행지} {동반자} 여행",
    skeleton: ["결론: 이런 여행자에게 맞아요", "부모님과 간다면", "아이와 간다면", "커플·친구라면", "포함·불포함 조건", "체력·이동 부담", "예약 전 체크"],
    imageFocus: "여행자와 풍경, 포함사항 상세 구간",
    priority: 55,
    requires: (e) => {
      const hit = e.corpus.match(/불포함|포함|선택관광|동반|아동|어린이|노쇼핑|노옵션|자유시간|가이드/u)?.[0];
      return hit ? { ok: true, reason: `조건 근거: ${hit}` } : { ok: false, reason: "포함·동반 조건 근거가 없음" };
    },
  },
  {
    id: "season", kind: "TRAVEL", label: "시기별 여행",
    goal: "출발 시기에 맞는 날씨·옷차림·성수기 꿀팁을 정리한다.",
    keywordPattern: "{여행지} {시기} 여행",
    skeleton: ["이 시기 한눈에 보기", "날씨와 옷차림", "이 시기에 좋은 코스", "성수기·혼잡 피하는 꿀팁", "준비물", "예약 전 체크", "자주 묻는 질문"],
    imageFocus: "계절감이 드러나는 풍경",
    priority: 45,
    requires: (e) => {
      const hit = e.corpus.match(/\d+\s*월|봄|여름|가을|겨울|시즌|성수기|출발일|연휴/u)?.[0];
      return hit ? { ok: true, reason: `시기 근거: ${hit}` } : { ok: false, reason: "출발 시기 근거가 없음" };
    },
  },
];

export const POST_ANGLES: readonly PostAngleDefinition[] = [...SHOPPING_ANGLES, ...TRAVEL_ANGLES];

export function getPostAngle(kind: TopicConnectKind, id: string | null | undefined): PostAngleDefinition {
  return POST_ANGLES.find((angle) => angle.kind === kind && angle.id === (id || DEFAULT_POST_ANGLE))
    ?? POST_ANGLES.find((angle) => angle.kind === kind && angle.id === DEFAULT_POST_ANGLE)!;
}

export function isPostAngleId(kind: TopicConnectKind, value: unknown): value is PostAngleId {
  return typeof value === "string" && POST_ANGLES.some((angle) => angle.kind === kind && angle.id === value);
}

function evidenceView(evidence: PostAngleEvidence): EvidenceView {
  const lines = [...(evidence.features || [])].map((line) => line.trim()).filter(Boolean);
  return {
    kind: evidence.kind,
    name: evidence.productName || "",
    lines,
    corpus: [evidence.productName, evidence.description || "", ...lines].join("\n"),
    hasExperienceNotes: Boolean(evidence.hasExperienceNotes),
  };
}

export interface PostAngleSuggestion {
  id: PostAngleId;
  label: string;
  goal: string;
  available: boolean;
  reason: string;
  recommended: boolean;
  /** 이미 이 각도의 글(초안 포함)이 있는지 */
  existing: boolean;
}

/**
 * 쓸 수 있는 각도와 추천 순서. 결정론적이며 모델을 호출하지 않는다.
 * 기본 추천: 전체 리뷰 + 근거가 충분한 주제 글 2편.
 */
export function suggestPostAngles(
  evidence: PostAngleEvidence,
  existingAngles: readonly string[] = [],
  topicCount = 2,
): PostAngleSuggestion[] {
  const view = evidenceView(evidence);
  const existing = new Set(existingAngles.map((angle) => angle || DEFAULT_POST_ANGLE));
  const rows = POST_ANGLES
    .filter((angle) => angle.kind === evidence.kind)
    .map((angle) => ({ angle, check: angle.requires(view) }))
    .sort((a, b) => b.angle.priority - a.angle.priority);
  let remainingTopics = topicCount;
  return rows.map(({ angle, check }) => {
    const isExisting = existing.has(angle.id);
    let recommended = false;
    if (check.ok && !isExisting) {
      if (angle.id === DEFAULT_POST_ANGLE) recommended = true;
      else if (remainingTopics > 0) { recommended = true; remainingTopics -= 1; }
    }
    return {
      id: angle.id,
      label: angle.label,
      goal: angle.goal,
      available: check.ok,
      reason: check.reason,
      recommended,
      existing: isExisting,
    };
  });
}

export interface SiblingPostSummary {
  angle: string;
  title?: string | null;
  headings?: readonly string[];
  /** 겹침 검사용 본문 섹션(소제목 포함 가능) */
  sections?: readonly string[];
}

/** 원고 프롬프트에 넣는 각도 블록. 전체 리뷰이고 형제 글이 없으면 빈 문자열. */
export function formatPostAngleForPrompt(
  kind: TopicConnectKind,
  angleId: string | null | undefined,
  siblings: readonly SiblingPostSummary[] = [],
): string {
  const angle = getPostAngle(kind, angleId);
  if (angle.id === DEFAULT_POST_ANGLE && siblings.length === 0) return "";
  const siblingLines = siblings.slice(0, 6).map((sibling) => {
    const label = getPostAngle(kind, sibling.angle).label;
    const headings = sibling.headings?.length ? ` / 다룬 소제목: ${sibling.headings.slice(0, 8).join(", ")}` : "";
    return `  · [${label}] ${sibling.title || "(제목 미정)"}${headings}`;
  });
  return [
    `[포스팅 각도: ${angle.label} (${angle.id})]`,
    `- 이 글의 목표: ${angle.goal}`,
    `- 대표 검색어 방향: ${angle.keywordPattern} (제목 앞쪽과 첫 섹션에 자연스럽게 한 번씩)`,
    angle.skeleton.length
      ? `- 글 골격(소제목 방향, 근거가 없으면 병합·생략): ${angle.skeleton.join(" → ")}`
      : "- 글 골격: 상품 유형 템플릿 전체 흐름을 따릅니다.",
    angle.id === DEFAULT_POST_ANGLE
      ? ""
      : "- 특정 주제 글입니다. 전체 리뷰처럼 모든 기능을 나열하지 말고 위 목표 하나에 집중합니다. 섹션 수·분량 기준은 공유 작성 계약을 따릅니다.",
    `- 이미지 우선순위: ${angle.imageFocus}`,
    siblingLines.length
      ? ["- 같은 상품의 다른 글(형제 글)이 이미 있습니다. 제목·대표 검색어·소제목·문장·예시를 겹치지 않게 쓰고, 이 글만의 새 정보로 채웁니다:", ...siblingLines].join("\n")
      : "",
  ].filter(Boolean).join("\n");
}

/** 글자 예산이 빡빡한 프롬프트용 한 줄 요약. 전체 리뷰는 빈 문자열. */
export function formatPostAngleSummary(kind: TopicConnectKind, angleId: string | null | undefined): string {
  const angle = getPostAngle(kind, angleId);
  if (angle.id === DEFAULT_POST_ANGLE) return "";
  return `- 포스팅 주제: ${angle.label}. ${angle.goal} 대표 검색어 방향: ${angle.keywordPattern}. 같은 상품의 다른 글과 제목·소제목·문장을 겹치지 않습니다.`;
}

export interface SiblingOverlapReport {
  /** 형제 글 문장과 거의 같은 문장 수 */
  overlappingSentenceCount: number;
  sentenceCount: number;
  /** 겹침이 많은 본문 섹션 인덱스(0부터) */
  overlappingSectionIndexes: number[];
  samples: string[];
  /** 유사문서 위험이 있어 재작성할지 */
  needsRewrite: boolean;
}

export const SIBLING_SENTENCE_SIMILARITY = 0.72;

/**
 * 형제 글과 문장 단위 겹침을 잰다. 섹션에서 겹치는 문장이 2개 이상이거나 30% 이상이면
 * 해당 섹션을 재작성 대상으로 표시한다. 차단 판단은 하지 않는다(경고·1회 재작성용).
 */
export function assessSiblingOverlap(
  sections: readonly string[],
  siblingSections: readonly (readonly string[])[],
): SiblingOverlapReport {
  const siblingTokens = siblingSections.flat().flatMap((section) => splitSentences(section, 12).map(sentenceTokens))
    .filter((tokens) => tokens.length >= 3);
  let sentenceCount = 0;
  let overlappingSentenceCount = 0;
  const overlappingSectionIndexes: number[] = [];
  const samples: string[] = [];
  sections.forEach((section, index) => {
    const sentences = splitSentences(section, 12);
    let hits = 0;
    for (const sentence of sentences) {
      const tokens = sentenceTokens(sentence);
      if (tokens.length < 3) continue;
      sentenceCount += 1;
      if (siblingTokens.some((other) => tokenSimilarity(tokens, other) >= SIBLING_SENTENCE_SIMILARITY)) {
        hits += 1;
        if (samples.length < 5) samples.push(sentence);
      }
    }
    overlappingSentenceCount += hits;
    if (hits >= 2 || (sentences.length > 0 && hits / sentences.length >= 0.3)) overlappingSectionIndexes.push(index);
  });
  return {
    overlappingSentenceCount,
    sentenceCount,
    overlappingSectionIndexes,
    samples,
    needsRewrite: overlappingSectionIndexes.length > 0,
  };
}

/** 형제 글 제목과 너무 비슷한 제목 후보를 거른다. */
export function isTitleTooSimilarToSiblings(title: string, siblingTitles: readonly (string | null | undefined)[]): boolean {
  const tokens = sentenceTokens(title);
  return siblingTitles.some((other) => other && tokenSimilarity(tokens, sentenceTokens(other)) >= 0.6);
}
