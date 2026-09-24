/**
 * SEO 제목 기획 — 상품 유형 템플릿·포스팅 각도의 제목 공식으로 후보를 만들고, 모델이 쓴 제목을 점수화한다.
 * 모델 제목이 필수 규칙(길이·핵심어 위치·체험 표현·형제 글 유사)을 어기면 규칙을 통과하는 후보로 바꾼다.
 * 결정론적이며 모델을 호출하지 않는다.
 */

import { sentenceTokens, tokenSimilarity } from "../draft-quality-signals";
import { extractTravelProductFacts } from "../travel-content";
import { DEFAULT_POST_ANGLE, getPostAngle } from "./angles";
import { SHOPPING_TOPIC_TEMPLATES, getTopicTemplate, type TopicTemplateId } from "./index";

export interface TitlePlanContext {
  kind: "SHOPPING" | "TRAVEL";
  productName: string;
  topicId: TopicTemplateId;
  angleId?: string | null;
  verifiedExperience: boolean;
  /** 핵심 검색어(카테고리·여행지). 없으면 상품명에서 추정한다. */
  primaryKeyword?: string | null;
  siblingTitles?: readonly (string | null | undefined)[];
  minChars?: number;
  maxChars?: number;
}

export interface TitleScore {
  title: string;
  score: number;
  hardFailures: string[];
}

const PROMOTION_TOKENS = /^(?:\[.*\]|출발확정|여행핫딜|핫딜|특가|단독|최저가|노쇼핑|노옵션|노팁|시내숙박|무료|증정|이벤트|할인|\d+%|공식|정품|신상|NEW)$/iu;
/** 체험 메모가 없을 때 제목에 쓰면 안 되는 체험 표현 */
const EXPERIENCE_TITLE = /후기|내돈내산|실사용|직접\s*(?:써본|다녀온|가본)|써본|먹어본|입어본|솔직\s*리뷰|체험기/u;
const CLICKBAIT = /완벽\s*가이드|총정리|완전\s*정복|핵\s*꿀팁|꿀팁\s*(?:zip|집)|역대급|최저가|1위|인생템/iu;
const EMOJI = /[\p{Extended_Pictographic}️]/u;

function cleanTokens(value: string): string[] {
  return value.replace(/[()[\]{}|/,+]/gu, " ").split(/\s+/u).map((token) => token.trim())
    .filter((token) => token.length >= 2 && !PROMOTION_TOKENS.test(token));
}

export function shortProductName(productName: string, maxTokens = 3): string {
  return cleanTokens(productName).slice(0, maxTokens).join(" ");
}

function travelSlots(productName: string): { destination: string; duration: string } {
  const facts = extractTravelProductFacts(productName);
  const destination = facts.destinations[0] || cleanTokens(productName)[0] || "";
  const duration = facts.duration || productName.match(/\d+\s*박\s*\d+\s*일|\d+\s*일/u)?.[0]?.replace(/\s+/gu, "") || "";
  return { destination, duration };
}

/** 핵심 검색어 기본값: 쇼핑은 상품 종류 단어(보통 두 번째 토큰), 여행은 여행지. */
function defaultPrimaryKeyword(context: Pick<TitlePlanContext, "kind" | "productName" | "primaryKeyword">): string {
  if (context.primaryKeyword?.trim()) return context.primaryKeyword.trim();
  if (context.kind === "TRAVEL") return travelSlots(context.productName).destination;
  // 상품 종류 단어: 템플릿 키워드 중 상품명에 들어 있는 가장 긴 단어(예: "드라이기", "러닝조끼"는 두 번째 토큰).
  // 키워드가 들어 있는 토큰 전체를 쓴다("러닝조끼"에서 "조끼"만 떼지 않는다).
  const tokens = cleanTokens(context.productName);
  const keywords = Object.values(SHOPPING_TOPIC_TEMPLATES).flatMap((template) => template.keywords).filter((word) => word.length >= 2);
  const typeToken = tokens
    .map((token) => ({ token, match: Math.max(0, ...keywords.filter((word) => token.includes(word)).map((word) => word.length)) }))
    .filter((item) => item.match > 0)
    .sort((left, right) => right.match - left.match)[0]?.token;
  return typeToken || tokens[1] || tokens[0] || "";
}

/** 같은 단어가 두 번 나오면 뒤의 것을 지운다(예: "러닝조끼 RNRN 러닝조끼" → "러닝조끼 RNRN"). */
function dedupeWords(value: string): string {
  const seen = new Set<string>();
  return value.split(" ").filter((word) => {
    const key = word.replace(/[,|·]/gu, "");
    if (!key || key === "|") return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(" ");
}

function fill(formula: string, slots: Record<string, string>): string {
  const filled = formula
    .replace(/\{([^}]+)\}/gu, (_, key: string) => slots[key] ?? "")
    .replace(/\s*\|\s*/gu, " | ")
    .replace(/\s+,/gu, ",")
    .replace(/\s{2,}/gu, " ")
    .replace(/\s*\|\s*$/u, "")
    .trim();
  return dedupeWords(filled).replace(/\s*\|\s*\|/gu, " |").replace(/^\|\s*/u, "").trim();
}

/** 정보형 모드(체험 메모 없음)에서 쓸 중립 제목 공식 */
const INFORMATION_FORMULAS = {
  SHOPPING: ["{키워드} {상품명} 특징과 선택 기준", "{상품명} {키워드} 장단점과 사용법 정리"],
  TRAVEL: ["{여행지} {기간} 여행 꿀팁 | 일정·포함사항 정리", "{여행지} {기간} 코스와 준비 꿀팁"],
} as const;

const ANGLE_TITLE_SUFFIX: Record<string, string> = {
  "how-to": "처음 쓰는 순서와 관리법",
  "problem-solve": "고민이 줄어드는 이유",
  "deep-dive": "수치가 뜻하는 것 정리",
  compare: "옵션별 차이와 고르는 기준",
  "situation-gift": "상황별로 고르는 기준",
  "care-longterm": "오래 쓰는 관리법",
  "prep-tips": "가기 전 챙길 꿀팁 체크리스트",
  "food-spot": "일정 속 먹거리와 야경 스폿",
  "day-highlight": "하루 동선과 현지 꿀팁",
  "who-fits": "동반자별로 맞는지 정리",
  season: "시기별 날씨와 옷차림 꿀팁",
};

/** 후보 제목을 만든다(중복 제거, 최대 6개). */
export function buildTitleCandidates(context: TitlePlanContext): string[] {
  const template = getTopicTemplate(context.topicId);
  const product = shortProductName(context.productName);
  const travel = context.kind === "TRAVEL" ? travelSlots(context.productName) : { destination: "", duration: "" };
  const keyword = defaultPrimaryKeyword(context);
  const slots: Record<string, string> = {
    키워드: keyword, 상품명: product, 여행지: travel.destination, 기간: travel.duration,
    카테고리: keyword, 고민: "", 상황: "", 핵심: "", "핵심 스펙": "", 장소: "", 동반자: "", 시기: "",
  };
  const angle = getPostAngle(context.kind, context.angleId);
  const formulas: string[] = [];
  if (angle.id !== DEFAULT_POST_ANGLE) {
    const head = fill(angle.keywordPattern, slots);
    const suffix = ANGLE_TITLE_SUFFIX[angle.id];
    if (head && suffix) formulas.push(`${head} | ${suffix}`);
  }
  const templateFormulas = template.titleFormulas.filter((formula) => context.verifiedExperience || !EXPERIENCE_TITLE.test(formula));
  formulas.push(...templateFormulas, ...INFORMATION_FORMULAS[context.kind]);
  return [...new Set(formulas.map((formula) => fill(formula, slots)).filter((title) => title.length >= 8))].slice(0, 6);
}

/** 제목 점수와 필수 규칙 위반. 위반이 하나라도 있으면 교체 대상이다. */
export function scoreTitle(title: string, context: TitlePlanContext): TitleScore {
  const min = context.minChars ?? 25;
  const max = context.maxChars ?? 35;
  const hardFailures: string[] = [];
  let score = 0;
  const length = title.replace(/\s+/gu, " ").trim().length;
  if (length < min - 5 || length > max + 8) hardFailures.push(`길이 ${length}자`);
  else if (length >= min && length <= max) score += 2;
  const travel = context.kind === "TRAVEL" ? travelSlots(context.productName) : null;
  const keyword = defaultPrimaryKeyword(context);
  if (keyword && title.slice(0, 15).includes(keyword)) score += 2;
  // 추정 핵심어가 빗나갈 수 있으므로, 상품·여행지 식별어가 하나도 없을 때만 필수 위반으로 본다.
  const identities = context.kind === "TRAVEL"
    ? [keyword, travel?.destination || ""]
    : [keyword, ...cleanTokens(context.productName).slice(0, 2)];
  const present = identities.filter((word) => word && title.includes(word));
  if (present.length > 0) score += 2;
  else if (identities.some(Boolean)) hardFailures.push(`상품·여행지 식별어 누락: ${identities.filter(Boolean).join("/")}`);
  if (EMOJI.test(title) || CLICKBAIT.test(title)) hardFailures.push("낚시성 문구·이모지");
  if (!context.verifiedExperience && EXPERIENCE_TITLE.test(title)) hardFailures.push("체험 메모 없는 체험 표현");
  const tokens = sentenceTokens(title);
  const sibling = (context.siblingTitles || []).find((other) => other && tokenSimilarity(tokens, sentenceTokens(other)) >= 0.6);
  if (sibling) hardFailures.push(`형제 글 제목과 유사: ${sibling}`);
  const angle = getPostAngle(context.kind, context.angleId);
  if (angle.id !== DEFAULT_POST_ANGLE) {
    const angleWords = (ANGLE_TITLE_SUFFIX[angle.id] || "").split(/\s+/u).filter((word) => word.length >= 2);
    if (angleWords.some((word) => title.includes(word.slice(0, 2)))) score += 1;
  }
  return { title, score: score - hardFailures.length * 5, hardFailures };
}

/**
 * 모델 제목을 유지하되 필수 규칙을 어기면 통과하는 최고 점수 후보로 바꾼다.
 * 통과하는 후보가 없으면 모델 제목을 그대로 둔다(게이트가 최종 판단).
 */
export function planTitle(modelTitle: string, context: TitlePlanContext): { title: string; replaced: boolean; reason: string; candidates: TitleScore[] } {
  const current = scoreTitle(modelTitle, context);
  const candidates = buildTitleCandidates(context).map((title) => scoreTitle(title, context))
    .sort((left, right) => right.score - left.score);
  if (current.hardFailures.length === 0) return { title: modelTitle, replaced: false, reason: "모델 제목 유지", candidates };
  const best = candidates.find((candidate) => candidate.hardFailures.length === 0);
  if (!best) return { title: modelTitle, replaced: false, reason: `규칙 위반(${current.hardFailures.join(", ")})이나 통과 후보 없음`, candidates };
  return { title: best.title, replaced: true, reason: current.hardFailures.join(", "), candidates };
}

export function formatTitleCandidatesForPrompt(context: TitlePlanContext): string {
  const candidates = buildTitleCandidates(context).map((title) => scoreTitle(title, context))
    .filter((candidate) => candidate.hardFailures.length === 0)
    .slice(0, 4);
  if (candidates.length === 0) return "";
  return [
    "[SEO 제목 후보(참고)]",
    ...candidates.map((candidate) => `- ${candidate.title}`),
    "- 후보를 그대로 복사하지 말고 핵심 검색어를 앞 15자 안에 두어 본문 내용에 맞게 자연스럽게 다듬습니다.",
  ].join("\n");
}
