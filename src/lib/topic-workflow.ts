import { generateKeywordSuggestions } from "../../scripts/lib/seo";
import type { KeywordSuggestion } from "../../scripts/lib/seo";

export type TopicType = "travel" | "golf" | "knowledge";
export type TopicSubtopicRole = "hook" | "scene" | "mistake" | "comparison" | "proof" | "takeaway";

export type TopicCampaignStatus =
  | "RESEARCHING"
  | "RESEARCH_DONE"
  | "SUBTOPIC_READY"
  | "DRAFT_READY"
  | "REVIEW"
  | "QUEUED"
  | "FAILED";

export type TopicDraftStatus =
  | "SUBTOPIC_READY"
  | "DRAFTING"
  | "DRAFT_READY"
  | "REVIEW"
  | "APPROVED"
  | "QUEUED"
  | "PUBLISHED"
  | "FAILED";

export type TopicImageRole = "hero" | "inline" | "thumbnail";

export interface TopicResearchSignal {
  keyword: string;
  source: "autocomplete" | "related" | "template" | "trend" | "input";
  score: number;
}

export interface TopicSourceSummary {
  url: string;
  title?: string;
  summary?: string;
  snippet?: string;
  error?: string;
}

export interface TopicResearchPacket {
  topic: string;
  type: TopicType;
  intent?: string | null;
  audience?: string | null;
  style?: string | null;
  generatedAt: string;
  trendSignals: TopicResearchSignal[];
  sourceUrls: string[];
  sourceSummaries: TopicSourceSummary[];
}

export interface TopicCampaignPayload {
  id: string;
  rootTopic: string;
  type: TopicType;
  intent: string | null;
  audience: string | null;
  style: string | null;
  sourceUrls: string[];
  researchPackJson: string;
  status: TopicCampaignStatus;
  createdAt: string;
}

export interface TopicSubtopicPlan {
  index: number;
  subtopic: string;
  reason: string;
  priority: number;
  confidence: number;
  role?: TopicSubtopicRole;
  readerPromise?: string;
  imageCue?: string;
  whyNow?: string;
}

export interface TopicDraftPlan {
  id: string;
  subTopic: string;
  reason: string | null;
  priority: number;
  status: TopicDraftStatus;
  titleCandidates: string[];
  contentJson: string | null;
  citations: string | null;
  thumbnailImageJson: string | null;
  sourceImagesJson: string | null;
  topicSeedJson: string | null;
  scheduledAt: string | null;
  postId: string | null;
  createdAt: string;
  errorMessage: string | null;
}

export interface TopicDraftCandidate {
  title?: string;
  sections?: string[];
  hashtags?: string[];
}

export interface TopicImageAsset {
  sourceUrl: string;
  localPath?: string | null;
  creditName?: string | null;
  creditUrl?: string | null;
  role: TopicImageRole;
}

export interface ParsedDateResult {
  requestedDate: string;
  effectiveDate: Date;
  effectiveDateInput: string;
  adjustedFromPast: boolean;
}

const STOPWORDS = new Set([
  "이후",
  "방법",
  "추천",
  "베스트",
  "가장",
  "핵심",
  "완벽한",
  "초보자",
  "여행",
  "가이드",
  "리뷰",
  "후기",
]);

const SUBTOPIC_NOISE_WORDS = new Set([
  "가이드",
  "정리",
  "체크리스트",
  "체크포인트",
  "핵심",
  "완벽",
  "완벽한",
  "실전",
  "입문자",
  "초보자",
  "중요",
  "기준",
  "팁",
  "요령",
  "주의",
  "장점",
  "단점",
  "유의점",
  "동선",
  "일정",
  "장단점",
  "방식",
  "절차",
  "개인여행",
  "경험담",
  "직접입력",
  "개인",
  "실제",
]);

const SUBTOPIC_GRAMMAR_NOISE = new Set([
  "에서",
  "에게",
  "에게서",
  "으로",
  "로",
  "처럼",
  "보다",
  "까지",
  "부터",
  "만",
  "조차",
  "마저",
  "순간",
  "이유",
  "지점",
  "포인트",
  "장면이다",
  "정리할",
  "놓치면",
  "놓칠",
  "늦게",
  "중요해지는",
  "바꾸면",
  "살아나는지",
  "죽는지",
  "갈린다",
]);

type SubtopicSource = TopicResearchSignal["source"] | "topic";

interface WeightedSubtopicCandidate {
  subtopic: string;
  reason: string;
  source: SubtopicSource;
  score: number;
  role?: TopicSubtopicRole;
  readerPromise?: string;
  imageCue?: string;
  whyNow?: string;
}

function getTopicTokenSet(topic: string): Set<string> {
  return new Set(tokenize(topic).map((token) => token.toLowerCase()));
}

function buildSubtopicSignature(topic: string, text: string): string {
  const topicTokens = getTopicTokenSet(topic);
  const filtered = tokenize(text)
    .map((token) => token.toLowerCase())
    .filter((token) => !STOPWORDS.has(token) && !SUBTOPIC_NOISE_WORDS.has(token) && !topicTokens.has(token));

  return uniqueText(filtered, 3).join("|").toLowerCase();
}

function buildTopicContext(topic: string, keyword: string): string {
  const normalizedTopic = normalizeText(topic).toLowerCase();
  const normalizedKeyword = sanitizeNarrativeKeyword(topic, keyword).toLowerCase();

  if (!normalizedTopic || !normalizedKeyword) {
    return topic;
  }

  const topicTokens = tokenize(normalizedTopic).map((token) => token.toLowerCase());
  const keywordTokens = tokenize(normalizedKeyword).map((token) => token.toLowerCase());
  const hasKeywordOverlap = topicTokens.some((token) => keywordTokens.includes(token));
  const keywordContainsTopic = normalizedKeyword.includes(normalizedTopic);

  if (hasKeywordOverlap || keywordContainsTopic) {
    return keyword;
  }

  return topic;
}

function removeTopicPrefix(topic: string, keyword: string): string {
  const normalizedKeyword = normalizeText(keyword);
  const normalizedTopic = normalizeText(topic);

  if (!normalizedKeyword || !normalizedTopic) {
    return normalizedKeyword;
  }

  const lowerKeyword = normalizedKeyword.toLowerCase();
  const lowerTopic = normalizedTopic.toLowerCase();
  const escapedTopic = lowerTopic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const leadingPattern = new RegExp(`^${escapedTopic}[\\s\\-_/|:;,]*`, "i");
  const trailingPattern = new RegExp(`[\\s\\-_/|:;,]*${escapedTopic}$`, "i");
  const hasPrefix = leadingPattern.test(lowerKeyword);
  const hasSuffix = trailingPattern.test(lowerKeyword);

  if (!hasPrefix && !hasSuffix) {
    return normalizedKeyword;
  }

  let trimmed = normalizedKeyword;
  if (hasPrefix) {
    trimmed = trimmed.replace(leadingPattern, "").trim();
  }
  if (hasSuffix) {
    trimmed = trimmed.replace(trailingPattern, "").trim();
  }

  return trimmed.length >= 2 ? trimmed : normalizedKeyword;
}

function stripParticleSuffix(token: string): string {
  return token.replace(
    /(으로는|으로|에게서|에게는|에게|에서는|에서|에는|에선|에|까지는|까지|부터는|부터|처럼|보다|만은|만|조차|마저|은|는|이|가|을|를)$/u,
    "",
  );
}

function sanitizeNarrativeKeyword(topic: string, keyword: string): string {
  const normalized = normalizeText(keyword)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const topicTokens = getTopicTokenSet(topic);
  const cleanedTokens = normalized
    .split(" ")
    .map((token) => stripParticleSuffix(token.trim()))
    .map((token) => token.trim())
    .filter((token) => {
      if (token.length < 2) return false;
      const lowered = token.toLowerCase();
      if (topicTokens.has(lowered)) return false;
      if (STOPWORDS.has(lowered) || SUBTOPIC_NOISE_WORDS.has(lowered) || SUBTOPIC_GRAMMAR_NOISE.has(lowered)) {
        return false;
      }
      if (/^(놓치|늦게|중요해지|정리하|붙이|바꾸|읽히|심심|갈리|느껴지|들킨)/u.test(token)) {
        return false;
      }
      return true;
    });

  const cleaned = uniqueText(cleanedTokens, 2).join(" ").trim();
  return cleaned || normalized;
}

function extractKeywordRoot(topic: string, keyword: string): string {
  const stripped = sanitizeNarrativeKeyword(topic, removeTopicPrefix(topic, keyword))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .toLowerCase();
  if (!stripped) return "topic-less";

  const topicTokens = new Set(tokenize(topic).map((token) => token.toLowerCase()));
  const tokens = stripped
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !SUBTOPIC_NOISE_WORDS.has(token) && !topicTokens.has(token));

  return uniqueText(tokens, 2).join("|");
}

const SUBTOPIC_ANGLE_TEMPLATES: Record<TopicType, string[]> = {
  travel: [
    "{topic}에서 {keyword} 하나 때문에 하루 리듬이 무너지는 순간",
    "{topic} 갈 때 {keyword}를 늦게 정하면 바로 꼬이는 장면",
    "{topic} 여행이 갑자기 편해지는 건 {keyword}를 먼저 잡을 때다",
    "{keyword}가 바뀌면 {topic}의 체력 배분이 어떻게 달라지는가",
    "{topic}에서 {keyword}를 아끼다 오히려 더 쓰게 되는 순간",
    "{topic}에서 {keyword}를 잘 고른 사람과 급하게 고른 사람의 차이",
    "{topic} 다녀온 뒤 가장 자주 남는 후회는 결국 {keyword}였다",
    "{topic} 일정이 매끈하게 이어지는 사람들은 {keyword}부터 다르다",
  ],
  golf: [
    "{topic}에서 {keyword}가 흔들리면 바로 티 나는 장면",
    "{topic} 라운드 전에 {keyword}를 놓치면 스코어가 무너지는 이유",
    "{keyword} 하나만 바꿔도 {topic} 체감이 달라지는 순간",
    "{topic}에서 {keyword}를 과하게 잡다가 생기는 실수",
    "{topic} 골퍼들이 {keyword}에서 유독 급해지는 이유",
    "{keyword}를 줄였더니 오히려 {topic}가 편해진 사례",
    "{topic} 직전 {keyword} 판단이 샷 리듬을 갈라놓는 순간",
    "{topic}에서 {keyword}가 맞아떨어질 때 몸이 보내는 신호",
  ],
  knowledge: [
    "{topic}가 갑자기 재미없어지는 건 {keyword}를 놓칠 때다",
    "{topic}를 볼 때 독자가 가장 먼저 막히는 지점은 {keyword}다",
    "{keyword} 하나 바꾸면 {topic}가 훨씬 사람 말처럼 읽힌다",
    "{topic}를 설명문으로 만들지 않는 사람들은 {keyword}부터 다르다",
    "{topic}에서 {keyword}를 너무 늦게 넣었을 때 생기는 문제",
    "{topic}를 읽다 멈추게 되는 순간을 보면 결국 {keyword}였다",
    "{keyword} 관점에서 다시 보면 {topic}의 장면이 살아난다",
    "{topic}에서 {keyword}를 살린 글이 유독 오래 남는 이유",
  ],
};

const SUBTOPIC_FALLBACK_KEYWORDS: Record<TopicType, string[]> = {
  travel: ["첫날", "체력", "동선", "이동", "숙소", "예산", "날씨", "복장", "식사", "공항", "환전", "보험", "야경", "대기시간"],
  golf: ["첫홀", "티샷", "리듬", "퍼팅", "비거리", "컨디션", "장비", "루틴", "예약", "연습장", "클럽핏", "피로", "날씨", "복기"],
  knowledge: ["첫 문장", "사례", "오해", "비교", "흐름", "장면", "실수", "선택 기준", "우선순위", "검증", "반례", "도입부"],
};

const SUBTOPIC_PERSONA_HINTS: Record<TopicType, string[]> = {
  travel: ["예산", "일행", "체력", "이동시간", "첫날 분위기"],
  golf: ["첫홀 긴장", "컨디션", "장비", "회복", "날씨"],
  knowledge: ["첫 문장", "오해", "사례", "비교", "선택 기준"],
};

const SUBTOPIC_HINT_TEMPLATES: Record<TopicType, string[]> = {
  travel: [
    "{topic}에서 {hint} 하나로 분위기가 갈리는 장면",
    "{topic} 다녀온 뒤 {hint}에서 후회가 남는 이유",
    "{topic}에서 {hint}를 먼저 본 사람들이 덜 지치는 이유",
  ],
  golf: [
    "{topic}에서 {hint}가 흔들릴 때 스코어가 무너지는 순간",
    "{topic} 라운딩 전에 {hint}부터 봐야 하는 이유",
    "{topic} 루틴에서 {hint}를 살리면 달라지는 장면",
  ],
  knowledge: [
    "{topic}에서 {hint}를 놓치면 글이 밋밋해지는 이유",
    "{topic}를 정리할 때 {hint}가 갑자기 중요해지는 순간",
    "{topic} 이야기에서 {hint}가 살아나는 장면",
  ],
};

const SUBTOPIC_SUFFIX_BY_TYPE: Record<TopicType, string[]> = {
  travel: ["첫 장면", "후회 포인트", "갈림길", "실제 선택", "체력 포인트", "돈 새는 지점", "현장 변수", "다시 간다면 바꿀 것"],
  golf: ["첫홀 감각", "흔한 실수", "급해지는 순간", "루틴 변화", "몸 반응", "스코어 분기점", "회복 포인트", "라운드 직전 판단"],
  knowledge: ["첫 문장", "막히는 지점", "흔한 오해", "살아나는 사례", "비교 장면", "실패 신호", "선택 기준", "끝까지 읽히는 이유"],
};

const SUBTOPIC_ROLE_TEMPLATES: Record<TopicType, Record<TopicSubtopicRole, string[]>> = {
  knowledge: {
    hook: [
      "{topic}, 처음엔 별거 아닌데 {keyword}에서 갑자기 읽는 맛이 갈린다",
      "{topic}가 딱딱해지는 건 {keyword}를 너무 늦게 꺼낼 때다",
      "{topic}, 첫 문장보다 {keyword} 장면에서 더 빨리 들킨다",
    ],
    scene: [
      "{topic}, {keyword}가 보이는 순간 갑자기 사람 말처럼 읽힌다",
      "{topic}에서 독자가 바로 자기 얘기처럼 느끼는 건 {keyword}가 살아 있는 순간이다",
      "{topic}, 설명보다 {keyword} 순간이 먼저 떠오를 때 끝까지 읽힌다",
    ],
    mistake: [
      "다들 {keyword}부터 설명하려다 {topic}를 더 심심하게 만든다",
      "{topic}를 쓸 때 흔한 실수, {keyword}를 정보처럼만 다루는 것",
      "{topic}, {keyword}를 잘못 잡으면 문장이 갑자기 교본처럼 보인다",
    ],
    comparison: [
      "{keyword}를 넣은 글과 뺀 글, {topic}의 온도 차이",
      "{topic}, {keyword} 하나로 설명문과 읽히는 글이 갈린다",
      "{topic}에서 {keyword}가 살아 있는 문장과 죽은 문장의 차이",
    ],
    proof: [
      "{topic}를 살리는 실제 장면, {keyword}가 들어갈 자리",
      "{topic}에서 {keyword}가 체감되는 순간을 사례로 보면 쉬워진다",
      "{topic}, {keyword}를 붙이면 독자가 바로 납득하는 장면",
    ],
    takeaway: [
      "{topic}, 오늘 바로 바꿔볼 {keyword} 한 가지",
      "{topic}가 밋밋하다면 {keyword}부터 손보면 된다",
      "{topic}, 읽는 맛을 살릴 때 마지막에 남겨야 할 {keyword}",
    ],
  },
  travel: {
    hook: [
      "{topic}, {keyword}에서 하루 기분이 먼저 갈린다",
      "{topic} 여행이 기대보다 심심해지는 건 {keyword}에서 판이 갈릴 때다",
      "{topic}, 출발 전에 {keyword}만 잘못 잡아도 하루 리듬이 무너진다",
    ],
    scene: [
      "{topic}, {keyword} 때문에 현장에서 표정이 바뀌는 순간",
      "{topic}에서 {keyword}가 맞아떨어질 때 하루가 훨씬 편해진다",
      "{topic}, {keyword}를 잘 잡은 일정은 현장 분위기부터 다르다",
    ],
    mistake: [
      "{topic} 갈 때 다들 {keyword}를 뒤로 미뤘다가 더 피곤해진다",
      "{topic} 여행에서 흔한 실수, {keyword}를 비용 문제로만 보는 것",
      "{topic}, {keyword}를 대충 정하면 현장에서 표정이 달라진다",
    ],
    comparison: [
      "{keyword}를 먼저 정한 일정과 아닌 일정, {topic} 만족도 차이",
      "{topic}, {keyword} 하나로 체력과 돈이 같이 갈린다",
      "{topic}에서 {keyword} 선택이 여행 분위기를 얼마나 바꾸는가",
    ],
    proof: [
      "{topic}에서 {keyword}가 체감되는 실제 장면",
      "{topic}, {keyword}를 잘 고른 사람들이 덜 후회하는 이유",
      "{topic}에서 {keyword}가 바로 티 나는 순간들",
    ],
    takeaway: [
      "{topic} 가기 전 마지막으로 볼 {keyword} 기준",
      "{topic}, 지금 다시 짠다면 {keyword}부터 바꾼다",
      "{topic} 여행이 덜 힘들어지는 {keyword} 한 가지",
    ],
  },
  golf: {
    hook: [
      "{topic}, {keyword}에서 흐름이 무너지면 바로 티가 난다",
      "{topic}가 답답하게 느껴지는 건 {keyword} 타이밍이 흔들릴 때다",
      "{topic}, {keyword} 하나로 샷의 분위기가 달라진다",
    ],
    scene: [
      "{topic}, {keyword}가 맞을 때 몸이 먼저 편해지는 장면",
      "{topic}에서 {keyword} 하나로 샷 감각이 달라지는 순간",
      "{topic}, {keyword}가 자연스럽게 이어질 때 리듬이 살아난다",
    ],
    mistake: [
      "{topic}에서 흔한 실수, {keyword}를 더 세게 하려는 것",
      "{topic}, 다들 {keyword}를 의욕으로만 풀다가 리듬을 잃는다",
      "{topic} 라운드에서 {keyword}를 잘못 만지면 더 꼬인다",
    ],
    comparison: [
      "{keyword}를 넣은 루틴과 아닌 루틴, {topic} 체감 차이",
      "{topic}, {keyword} 하나로 스코어가 덜 흔들리는 이유",
      "{topic}에서 {keyword}가 있을 때와 없을 때의 결과 차이",
    ],
    proof: [
      "{topic}에서 {keyword}가 바로 보이는 실제 장면",
      "{topic}, {keyword}가 맞을 때 몸이 먼저 반응하는 순간",
      "{topic}에서 {keyword}를 체감하는 가장 쉬운 예시",
    ],
    takeaway: [
      "{topic} 전에 오늘 바로 점검할 {keyword}",
      "{topic}, 당장 줄여도 되는 {keyword} 한 가지",
      "{topic} 라운드 전에 마지막으로 확인할 {keyword} 기준",
    ],
  },
};

function formatSubtopicTemplate(template: string, topic: string, keyword: string): string {
  return repairKoreanParticles(
    template
    .replace(/\{topic\}/g, topic)
    .replace(/\{keyword\}/g, keyword)
    .replace(/\s+/g, " ")
    .trim(),
  );
}

function hasBatchim(value: string): boolean {
  const trimmed = normalizeText(value);
  if (!trimmed) return false;
  const lastChar = trimmed[trimmed.length - 1];
  const code = lastChar.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function repairKoreanParticles(value: string): string {
  return value
    .replace(/([가-힣]{1,20})([이가])(?=[\s,.;:!?)]|$)/gu, (_, word: string) =>
      `${word}${hasBatchim(word) ? "이" : "가"}`,
    )
    .replace(/([가-힣]{1,20})([은는])(?=[\s,.;:!?)]|$)/gu, (_, word: string) =>
      `${word}${hasBatchim(word) ? "은" : "는"}`,
    )
    .replace(/([가-힣]{1,20})([을를])(?=[\s,.;:!?)]|$)/gu, (_, word: string) =>
      `${word}${hasBatchim(word) ? "을" : "를"}`,
    );
}

function buildNarrativeRoleOrder(count: number): TopicSubtopicRole[] {
  const normalized = Math.max(1, Math.min(5, count));
  switch (normalized) {
    case 1:
      return ["hook"];
    case 2:
      return ["hook", "takeaway"];
    case 3:
      return ["hook", "comparison", "takeaway"];
    case 4:
      return ["hook", "scene", "comparison", "takeaway"];
    default:
      return ["hook", "scene", "mistake", "comparison", "takeaway"];
  }
}

function extractRoleFocusKeyword(topic: string, subtopic: string, fallback: string): string {
  const extracted = sanitizeNarrativeKeyword(topic, removeTopicPrefix(topic, subtopic))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (extracted.length >= 2) {
    return extracted;
  }
  const fallbackKeyword = sanitizeNarrativeKeyword(topic, removeTopicPrefix(topic, fallback)).trim();
  return fallbackKeyword || normalizeText(topic);
}

function buildRoleAwareSubtopic(
  topic: string,
  type: TopicType,
  keyword: string,
  role: TopicSubtopicRole,
  variant: number,
): string {
  const templates = SUBTOPIC_ROLE_TEMPLATES[type]?.[role] || SUBTOPIC_ROLE_TEMPLATES.knowledge[role];
  const template = templates[variant % templates.length] || templates[0];
  return formatSubtopicTemplate(template, normalizeText(topic), normalizeText(keyword) || normalizeText(topic));
}

function normalizeGeneratedSubtopic(topic: string, value: string): string {
  const normalizedTopic = normalizeText(topic);
  let next = normalizeText(value)
    .replace(/문장를/g, "문장을")
    .replace(/방법를/g, "방법을")
    .replace(/장면를/g, "장면을")
    .replace(/건\s+를/g, "건")
    .replace(/건\s+을/g, "건")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedTopic || !next) {
    return next;
  }

  const escapedTopic = normalizedTopic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const repeated = next.match(new RegExp(escapedTopic, "gi")) || [];
  if (repeated.length > 1) {
    next = next.replace(new RegExp(`(${escapedTopic})[\\s,]+(${escapedTopic})`, "i"), "$1");
  }

  return next.trim();
}

function subtopicLooksBroken(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  return /문장를|방법를|장면를|건\s+[를을이가은는]|딱딱해지\s|밋밋해지\s|너무는|,\s*,/iu.test(normalized);
}

function buildRoleAwareReason(
  topic: string,
  keyword: string,
  role: TopicSubtopicRole,
  type: TopicType,
  source: string,
): string {
  const sourcePrefix = source === "template" ? "검색 흐름" : `${source} 신호`;
  const normalizedKeyword = normalizeText(keyword) || normalizeText(topic);

  switch (role) {
    case "hook":
      return repairKoreanParticles(`${sourcePrefix}를 보면 독자는 ${normalizedKeyword}가 실제로 어떻게 갈리는지부터 궁금해합니다. 그래서 첫머리는 설명보다 장면을 먼저 여는 편이 훨씬 강합니다.`);
    case "scene":
      return repairKoreanParticles(`${sourcePrefix}를 보면 ${normalizedKeyword}는 실제 장면으로 보여줄 때 가장 빨리 이해됩니다. 이 구간은 독자가 자기 상황을 바로 떠올릴 수 있어야 합니다.`);
    case "mistake":
      return repairKoreanParticles(`${sourcePrefix} 기준으로 보면 ${normalizedKeyword}에서 흔한 오해를 먼저 짚을 때 독자가 자기 이야기처럼 읽습니다.`);
    case "comparison":
      return repairKoreanParticles(`${normalizedKeyword}는 전후 차이나 선택 기준을 붙였을 때 정보가 훨씬 살아납니다. 중간에 비교 축이 하나 있어야 글의 리듬이 생깁니다.`);
    case "proof":
      return type === "travel" || type === "golf"
        ? repairKoreanParticles(`${normalizedKeyword}는 실제 장면이나 체감 예시를 붙였을 때 믿음이 생깁니다. 이 구간은 근거와 사례를 담당해야 합니다.`)
        : repairKoreanParticles(`${normalizedKeyword}는 사례나 캡처, 실제 흐름을 붙였을 때 설명문 티가 덜 납니다. 이 구간에서 독자가 납득할 장면을 보여줘야 합니다.`);
    case "takeaway":
      return repairKoreanParticles(`${normalizedKeyword}는 마지막에 선택 기준이나 바로 바꿀 한 가지로 닫아야 글이 길게 늘어지지 않습니다.`);
    default:
      return buildSubtopicReason(topic, keyword, topic, type, source);
  }
}

function buildReaderPromise(role: TopicSubtopicRole, keyword: string): string {
  const normalizedKeyword = normalizeText(keyword);
  switch (role) {
    case "hook":
      return repairKoreanParticles(`${normalizedKeyword}가 왜 갑자기 중요해지는지 바로 감이 온다`);
    case "scene":
      return repairKoreanParticles(`${normalizedKeyword}가 실제 장면에서는 어떻게 느껴지는지 떠오른다`);
    case "mistake":
      return repairKoreanParticles(`${normalizedKeyword}에서 많이 하는 착각을 빨리 끊게 된다`);
    case "comparison":
      return repairKoreanParticles(`${normalizedKeyword}를 기준으로 전후 차이를 한 번에 보게 된다`);
    case "proof":
      return repairKoreanParticles(`${normalizedKeyword}가 실제로 어떻게 체감되는지 납득하게 된다`);
    case "takeaway":
      return repairKoreanParticles(`${normalizedKeyword}에서 바로 적용할 기준 하나가 남는다`);
    default:
      return repairKoreanParticles(`${normalizedKeyword}를 더 쉽게 이해하게 된다`);
  }
}

function buildImageCue(role: TopicSubtopicRole, keyword: string, type: TopicType): string {
  const normalizedKeyword = normalizeText(keyword);
  if (role === "scene") {
    return repairKoreanParticles(
      type === "knowledge"
        ? `${normalizedKeyword}가 자연스럽게 체감되는 작업/대화 장면`
        : `${normalizedKeyword} 분위기가 바로 느껴지는 자연스러운 현장 장면`,
    );
  }
  if (role === "proof") {
    return repairKoreanParticles(
      type === "knowledge"
        ? `${normalizedKeyword}가 보이는 실제 화면, 문서, 사례 장면`
        : `${normalizedKeyword}가 바로 체감되는 현장 장면`,
    );
  }
  if (role === "comparison") {
    return repairKoreanParticles(`${normalizedKeyword} 전후 차이가 보이는 비교 이미지`);
  }
  if (role === "takeaway") {
    return repairKoreanParticles(`${normalizedKeyword}를 한눈에 정리하는 단정한 요약 장면`);
  }
  return repairKoreanParticles(`${normalizedKeyword} 분위기가 느껴지는 자연스러운 장면`);
}

function buildWhyNow(role: TopicSubtopicRole, topic: string, keyword: string, type: TopicType): string {
  const normalizedKeyword = normalizeText(keyword) || normalizeText(topic);
  switch (role) {
    case "hook":
      return repairKoreanParticles(
        type === "travel"
          ? `${normalizedKeyword}는 출발 전에 놓치면 하루 기분이 바로 갈리기 때문에 지금 먼저 볼 가치가 큽니다.`
          : type === "golf"
            ? `${normalizedKeyword}는 라운드 들어가면 바로 티가 나서 미리 점검할 가치가 큽니다.`
            : `${normalizedKeyword}는 글 첫인상과 직결돼서 지금 읽는 사람에게 바로 체감됩니다.`,
      );
    case "scene":
      return repairKoreanParticles(`${normalizedKeyword}는 설명보다 장면으로 볼 때 훨씬 빨리 이해되는 포인트입니다.`);
    case "mistake":
      return repairKoreanParticles(`${normalizedKeyword}는 많은 사람이 비슷하게 잘못 잡기 때문에 오해를 먼저 끊는 가치가 있습니다.`);
    case "comparison":
      return repairKoreanParticles(`${normalizedKeyword}는 선택 기준이 갈리는 포인트라 비교로 볼 때 가장 도움이 됩니다.`);
    case "proof":
      return repairKoreanParticles(`${normalizedKeyword}는 실제 근거나 사례가 붙는 순간 판단이 쉬워집니다.`);
    case "takeaway":
      return repairKoreanParticles(`${normalizedKeyword}는 마지막에 행동 기준으로 남겨야 글이 오래 기억됩니다.`);
    default:
      return repairKoreanParticles(`${normalizedKeyword}는 지금 읽는 사람 입장에서 바로 체감되는 포인트입니다.`);
  }
}

function stableTokenIndex(seed: string, max: number): number {
  if (max <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 9973;
  }
  return hash % max;
}

function diversifyKeyword(topic: string, keyword: string, index: number, type: TopicType): string {
  const normalizedKeyword = sanitizeNarrativeKeyword(topic, removeTopicPrefix(topic, keyword));
  const topicTokens = tokenize(topic);
  const hasTopicAnchor = normalizedKeyword.toLowerCase().includes(topic.toLowerCase());
  if (!hasTopicAnchor && topicTokens.length > 0 && index % 2 === 0) {
    return normalizedKeyword;
  }

  const suffixes = SUBTOPIC_SUFFIX_BY_TYPE[type] || SUBTOPIC_SUFFIX_BY_TYPE.knowledge;
  const suffix = suffixes[index % suffixes.length];
  return `${normalizedKeyword} ${suffix}`;
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0.55;
  return Number(Math.min(1, Math.max(0.55, value)).toFixed(2));
}

function buildSubtopicReason(
  topic: string,
  keyword: string,
  subtopic: string,
  type: TopicType,
  source: string,
): string {
  const normalizedKeyword = normalizeText(keyword) || normalizeText(topic);
  const sourcePrefix = source === "template" ? "검색 흐름" : `${source} 자료`;

  switch (type) {
    case "travel":
      return `${sourcePrefix}를 보면 ${normalizedKeyword}에서 여행 분위기가 크게 갈립니다. 그래서 ${subtopic}처럼 실제 선택이 갈리는 장면을 먼저 다루는 편이 훨씬 와닿습니다.`;
    case "golf":
      return `${sourcePrefix} 기준으로 ${normalizedKeyword}가 흔들릴 때 실전 체감이 바로 달라집니다. ${subtopic}처럼 몸 반응이 바뀌는 순간을 먼저 짚어야 글이 더 살아납니다.`;
    default:
      return `${sourcePrefix}를 보면 ${normalizedKeyword}에서 독자가 가장 자주 멈춥니다. 그래서 ${subtopic}처럼 읽는 맛이 갈리는 지점을 앞에 두는 편이 글 흐름을 훨씬 살려줍니다.`;
  }
}

function buildWeightedSubtopics(
  topic: string,
  type: TopicType,
  signals: TopicResearchSignal[],
  requestedCount: number,
  options?: { intent?: string | null; audience?: string | null; style?: string | null },
): WeightedSubtopicCandidate[] {
  const sortedSignals = [...signals].sort((a, b) => b.score - a.score);
  const maxRootRepeat = Math.max(1, Math.ceil(requestedCount / 3));
  const rootUsage = new Map<string, number>();
  const templateUsage = new Map<string, number>();
  const signalIndex = new Map(
    sortedSignals.map((signal) => [signal.keyword.toLowerCase().trim(), signal]),
  );
  const rankedSignals = uniqueText(
    sortedSignals.map((signal) => signal.keyword.toLowerCase().trim()),
  ).slice(0, Math.max(10, requestedCount * 3));

  const roleTemplates = SUBTOPIC_ROLE_TEMPLATES[type] || SUBTOPIC_ROLE_TEMPLATES.knowledge;
  const roleOrder = buildNarrativeRoleOrder(Math.min(5, requestedCount));
  const fallbackKeywords = SUBTOPIC_FALLBACK_KEYWORDS[type] || SUBTOPIC_FALLBACK_KEYWORDS.knowledge;

  const candidates: WeightedSubtopicCandidate[] = [];

  const fallbackTokens = tokenize(topic)
    .filter(Boolean)
    .slice(0, 3);
  const fallbackPool = uniqueText([
    ...fallbackTokens,
    ...fallbackKeywords,
    topic,
  ]);

  const seededSignals =
    rankedSignals.length > 0
      ? rankedSignals
      : uniqueText([...fallbackPool, ...fallbackTokens], Math.max(12, requestedCount * 4));

  const signalRecords = uniqueText(seededSignals, Math.max(12, requestedCount * 4)).map((keyword) => {
    const normalizedKeyword = removeTopicPrefix(topic, keyword);
    const sourceSignal =
      signalIndex.get(normalizedKeyword.toLowerCase()) ?? {
        keyword: normalizedKeyword,
        source: rankedSignals.length > 0 ? "template" : "input",
        score: rankedSignals.length > 0 ? 78 : 72,
      };
    return { keyword: normalizedKeyword, signal: sourceSignal };
  });

  if (signalRecords.length === 0) {
    return candidates.slice(0, Math.max(1, Math.min(requestedCount, candidates.length)));
  }

  const contextHints = uniqueText(
    [options?.intent, options?.audience, options?.style, ...(SUBTOPIC_PERSONA_HINTS[type] ?? [])].filter(
      (value): value is string => isMeaningfulSubtopicHint(value ?? ""),
    ),
    4,
  );
  const hintTemplates = SUBTOPIC_HINT_TEMPLATES[type] || SUBTOPIC_HINT_TEMPLATES.knowledge;
  const topicText = normalizeText(topic);

  for (let i = 0; i < signalRecords.length; i++) {
    const { keyword, signal } = signalRecords[i];
    const role = roleOrder[i % roleOrder.length] || "comparison";
    const roleScopedTemplates = roleTemplates[role] || roleTemplates.comparison;
    const diversifiedKeyword = diversifyKeyword(topic, keyword, i, type);
    const topicContext = buildTopicContext(topic, diversifiedKeyword);
    const rotationOffset = stableTokenIndex(
      `${topic}|${keyword}|${signal.source}|${role}`,
      roleScopedTemplates.length,
    );
    const root = extractKeywordRoot(topic, diversifiedKeyword);
    const rootKey = root.length >= 2 ? `${role}:${root}` : `${role}:${diversifiedKeyword}`;
    const usedRoot = rootUsage.get(rootKey) ?? 0;
    if (usedRoot >= maxRootRepeat) {
      continue;
    }
    rootUsage.set(rootKey, usedRoot + 1);

    for (let t = 0; t < roleScopedTemplates.length; t++) {
      const template = roleScopedTemplates[(i + t + rotationOffset) % roleScopedTemplates.length];
      const templateKey = `${role}:${template}`;
      const usedTemplate = templateUsage.get(templateKey) ?? 0;
      const templateCap = Math.max(1, Math.ceil(requestedCount / 2));
      if (usedTemplate >= templateCap) {
        continue;
      }

      const subtopic = formatSubtopicTemplate(template, topicContext, diversifiedKeyword);
      if (subtopic.length < 3) continue;
      if (normalizeText(subtopic).toLowerCase() === topicText.toLowerCase()) continue;

      candidates.push({
        subtopic,
        reason: buildRoleAwareReason(topicText, diversifiedKeyword, role, type, signal.source),
        source: signal.source,
        score: clampConfidence(signal.score / 100 - i * 0.035 - t * 0.01 + (role === "hook" ? 0.05 : 0)),
        role,
        readerPromise: buildReaderPromise(role, diversifiedKeyword),
        imageCue: buildImageCue(role, diversifiedKeyword, type),
        whyNow: buildWhyNow(role, topicText, diversifiedKeyword, type),
      });
      templateUsage.set(templateKey, usedTemplate + 1);

      if (candidates.length >= requestedCount * 9) break;
    }
    if (candidates.length >= requestedCount * 9) break;
  }

  for (let i = 0; i < contextHints.length; i++) {
    const hint = contextHints[i];
    if (!hint) continue;
    const hintTemplate = hintTemplates[i % hintTemplates.length] || hintTemplates[0];
    const hintRole: TopicSubtopicRole =
      /비교|차이|사례/.test(hint) ? "comparison" : /기준|우선순위/.test(hint) ? "takeaway" : "proof";
    const subtopic = hintTemplate
      .replace(/\{topic\}/g, topicText)
      .replace(/\{hint\}/g, normalizeText(hint));
    candidates.push({
      subtopic,
      reason: buildRoleAwareReason(topicText, hint, hintRole, type, "topic"),
      source: "topic",
      score: clampConfidence(0.78),
      role: hintRole,
      readerPromise: buildReaderPromise(hintRole, hint),
      imageCue: buildImageCue(hintRole, hint, type),
      whyNow: buildWhyNow(hintRole, topicText, hint, type),
    });
  }

  return candidates;
}

function dedupeSubtopicCandidates(
  candidates: WeightedSubtopicCandidate[],
  limit: number,
  topic = "",
  allowRepeatedRoot = false,
): WeightedSubtopicCandidate[] {
  const deduped: WeightedSubtopicCandidate[] = [];
  const seenSignatures = new Set<string>();
  const seenKeys = new Set<string>();
  const seenRoots = new Set<string>();

  for (const candidate of candidates) {
    const text = candidate.subtopic.trim();
    if (!text) continue;
    const signature = buildSubtopicSignature(topic, text);
    const key = normalizeText(text).toLowerCase();
    const signatureKey = normalizeText(signature).toLowerCase();
    const rootKey = signatureKey.length > 0 ? signatureKey : key;

    let duplicated = false;
    for (const existing of deduped) {
      if (jaccard(existing.subtopic, text) >= 0.76) {
        duplicated = true;
        break;
      }
    }
    if (duplicated) continue;
    if (!allowRepeatedRoot && seenRoots.has(rootKey)) {
      continue;
    }
    if (seenSignatures.has(signatureKey)) continue;
    if (seenKeys.has(key)) continue;

    deduped.push(candidate);
    if (rootKey) {
      seenRoots.add(rootKey);
    }
    if (signature) {
      seenSignatures.add(signatureKey);
    }
    seenKeys.add(key);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

function toLowerNoSpaces(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\p{P}\p{S}]+/gu, "")
    .trim();
}

function isMeaningfulSubtopicHint(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  if (normalized.length < 2) {
    return false;
  }

  const hasToken = /[\p{L}\p{N}]/u.test(normalized);
  if (!hasToken) {
    return false;
  }

  if (/^\d/.test(normalized) || /^\d+[가-힣]$/u.test(normalized)) {
    return false;
  }

  const lowered = normalized.toLowerCase();
  if (STOPWORDS.has(lowered) || SUBTOPIC_NOISE_WORDS.has(lowered)) {
    return false;
  }

  return true;
}

function tokenize(value: string): string[] {
  return toLowerNoSpaces(value)
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 1 && !STOPWORDS.has(part));
}

function jaccard(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));

  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection / Math.max(1, union);
}

export function normalizeText(value: string): string {
  return value.trim();
}

export function uniqueText(values: string[], max = 30): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= max) break;
  }

  return result;
}

export function dedupeUrls(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function parseSourceUrls(input?: string | string[]): string[] {
  if (!input) return [];

  const sourceText = Array.isArray(input) ? input.join("\n") : input;
  const matches = sourceText.match(/https?:\/\/[^\s<>"']+/gi) || [];
  const candidates = [
    ...matches,
    ...sourceText.split(/[\n,]/),
  ];

  return dedupeUrls(
    candidates
      .map((value) => value.trim().replace(/[)\].,!?]+$/g, ""))
      .filter((value) => /^https?:\/\//i.test(value)),
  );
}

export function parseSourceJson(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") return parseSourceUrls(raw);
  if (!Array.isArray(raw)) return [];

  return dedupeUrls(
    raw
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => /^https?:\/\//i.test(value)),
  );
}

export function parseKeywords(raw: string): string[] {
  return uniqueText(
    raw
      .split(/[\n,]/)
      .map((value) => value.replace(/https?:\/\/\S+/gi, " ").trim())
      .map((value) => value.replace(/[|/]+/g, " ").replace(/\s+/g, " ").trim())
      .filter((value) => !/^(source|url|link|출처)$/i.test(value))
      .filter(Boolean),
    50,
  );
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateInput(raw: string, fallbackDate = new Date()): ParsedDateResult {
  const trimmed = raw.trim();
  const fallback = setDefaultScheduleTime(fallbackDate);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(trimmed)) {
    fallback.setDate(fallback.getDate() + 1);
    return {
      requestedDate: "",
      effectiveDate: fallback,
      effectiveDateInput: formatDateInput(fallback),
      adjustedFromPast: false,
    };
  }

  const now = new Date();
  const [yearText, monthText, dayText] = trimmed.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(year, month - 1, day, 9, 0, 0, 0);

  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    throw new Error("예약발행일 형식이 올바르지 않습니다.");
  }

  const nowYmd = formatDateInput(now);
  const candidateYmd = formatDateInput(candidate);
  if (candidateYmd <= nowYmd) {
    const next = setDefaultScheduleTime(new Date(now));
    next.setDate(next.getDate() + 1);
    return {
      requestedDate: trimmed,
      effectiveDate: next,
      effectiveDateInput: formatDateInput(next),
      adjustedFromPast: true,
    };
  }

  return {
    requestedDate: trimmed,
    effectiveDate: candidate,
    effectiveDateInput: formatDateInput(candidate),
    adjustedFromPast: false,
  };
}

function setDefaultScheduleTime(date: Date): Date {
  const cloned = new Date(date);
  cloned.setHours(9, 0, 0, 0);
  return cloned;
}

export function buildEmptyResearchPacket(
  topic: string,
  type: TopicType,
  sourceUrls: string[],
  options: { intent?: string | null; audience?: string | null; style?: string | null },
): TopicResearchPacket {
  return {
    topic,
    type,
    intent: options.intent ?? null,
    audience: options.audience ?? null,
    style: options.style ?? null,
    generatedAt: new Date().toISOString(),
    trendSignals: [],
    sourceUrls,
    sourceSummaries: sourceUrls.length > 0
      ? sourceUrls.map((url) => ({
        url,
        snippet: "요약되지 않음",
      }))
      : [],
  };
}

function extractSourceFromHtml(url: string, rawHtml: string): TopicSourceSummary {
  const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const stripped = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    url,
    title: titleMatch?.[1]?.trim() || undefined,
    summary: stripped.slice(0, 280) || "요약할 수 없습니다.",
  };
}

interface AutoResearchSearchResult {
  url: string;
  title?: string;
  snippet?: string;
  provider: string;
}

const AUTO_RESEARCH_MAX_SOURCES = Math.max(
  0,
  Number.parseInt(process.env.TOPIC_AUTO_RESEARCH_MAX_SOURCES || "4", 10) || 4,
);
const AUTO_RESEARCH_TIMEOUT_MS = Math.max(
  2500,
  Number.parseInt(process.env.TOPIC_AUTO_RESEARCH_TIMEOUT_MS || "7000", 10) || 7000,
);

function isAutoResearchEnabled(): boolean {
  return process.env.TOPIC_AUTO_RESEARCH_ENABLED?.toLowerCase() !== "false";
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 10)));
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCandidateUrl(rawUrl: string): string | null {
  const decoded = decodeHtmlEntities(rawUrl.trim());
  if (!decoded) return null;

  try {
    const url = new URL(decoded);
    const nested = url.searchParams.get("uddg") || url.searchParams.get("url");
    if (nested && /^https?:\/\//i.test(nested)) {
      return normalizeCandidateUrl(nested);
    }
  } catch {
    // Continue with direct URL parsing below.
  }

  try {
    const url = new URL(decoded);
    if (!/^https?:$/i.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isUsefulResearchUrl(rawUrl: string, rootTopic: string): boolean {
  const normalized = normalizeCandidateUrl(rawUrl);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const topicTokens = tokenize(rootTopic).filter((token) => token.length >= 2);

    if (
      /(^|\.)google\./.test(host) ||
      /(^|\.)bing\./.test(host) ||
      /(^|\.)duckduckgo\.com$/.test(host) ||
      /(^|\.)naver\.com$/.test(host) && pathname.startsWith("/search") ||
      /(^|\.)youtube\.com$/.test(host) ||
      /(^|\.)youtu\.be$/.test(host) ||
      /(^|\.)instagram\.com$/.test(host) ||
      /(^|\.)facebook\.com$/.test(host) ||
      /(^|\.)x\.com$/.test(host) ||
      /(^|\.)twitter\.com$/.test(host) ||
      /(^|\.)pinterest\./.test(host)
    ) {
      return false;
    }

    if (/\.(pdf|zip|hwp|docx?|xlsx?|pptx?)(\?|$)/i.test(pathname)) {
      return false;
    }

    if (topicTokens.length > 0) {
      const haystack = decodeURIComponent(`${host} ${pathname}`).toLowerCase();
      const matchedTokenCount = topicTokens.filter((token) => haystack.includes(token.toLowerCase())).length;
      if (matchedTokenCount === 0 && topicTokens.length >= 2 && /\/(login|auth|member|account)/i.test(pathname)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

function buildAutoResearchQueries(topic: string, type: TopicType, keywords: string[]): string[] {
  const typeHints: Record<TopicType, string[]> = {
    travel: ["후기", "일정", "비용", "주의점"],
    golf: ["후기", "코스", "준비", "실수"],
    knowledge: ["사례", "비교", "가이드", "트렌드"],
  };
  const base = normalizeText(topic);
  const keywordHints = keywords.slice(0, 3);

  return uniqueText([
    [base, ...keywordHints].filter(Boolean).join(" "),
    [base, typeHints[type]?.[0]].filter(Boolean).join(" "),
    [base, typeHints[type]?.[1]].filter(Boolean).join(" "),
    [base, "블로그"].filter(Boolean).join(" "),
  ], 4);
}

async function fetchTextWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("auto-research-timeout"), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) return "";
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function searchNaverOpenApi(query: string): Promise<AutoResearchSearchResult[]> {
  const clientId = process.env.NAVER_SEARCH_CLIENT_ID?.trim();
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return [];

  const responseText = await fetchTextWithTimeout(
    `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(query)}&display=8&sort=sim`,
    {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
    },
    AUTO_RESEARCH_TIMEOUT_MS,
  );
  if (!responseText) return [];

  const payload = JSON.parse(responseText) as {
    items?: Array<{ link?: string; title?: string; description?: string }>;
  };

  return (payload.items || [])
    .map((item) => ({
      url: normalizeCandidateUrl(item.link || "") || "",
      title: stripHtml(item.title || ""),
      snippet: stripHtml(item.description || ""),
      provider: "naver-openapi",
    }))
    .filter((item) => item.url);
}

async function searchDuckDuckGoHtml(query: string): Promise<AutoResearchSearchResult[]> {
  const html = await fetchTextWithTimeout(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    },
    AUTO_RESEARCH_TIMEOUT_MS,
  );
  if (!html) return [];

  const results: AutoResearchSearchResult[] = [];
  const resultPattern =
    /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>|<div[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>)([\s\S]*?)(?:<\/a>|<\/div>)/gi;

  for (const match of html.matchAll(resultPattern)) {
    const normalizedUrl = normalizeCandidateUrl(match[1] || "");
    if (!normalizedUrl) continue;
    results.push({
      url: normalizedUrl,
      title: stripHtml(match[2] || ""),
      snippet: stripHtml(match[3] || ""),
      provider: "duckduckgo-html",
    });
  }

  return results;
}

export async function discoverTopicSourceUrls(
  topic: string,
  type: TopicType,
  keywords: string[],
  maxSources = AUTO_RESEARCH_MAX_SOURCES,
): Promise<string[]> {
  if (!isAutoResearchEnabled() || maxSources <= 0) return [];

  const queries = buildAutoResearchQueries(topic, type, keywords);
  const results: AutoResearchSearchResult[] = [];

  for (const query of queries) {
    try {
      const naverResults = await searchNaverOpenApi(query);
      results.push(...naverResults);
    } catch {
      // Optional provider. Fall through to DuckDuckGo HTML.
    }

    try {
      const ddgResults = await searchDuckDuckGoHtml(query);
      results.push(...ddgResults);
    } catch {
      // Auto research is best-effort; deterministic fallbacks still produce content.
    }

    const usableCount = dedupeUrls(results.map((result) => result.url).filter((url) => isUsefulResearchUrl(url, topic))).length;
    if (usableCount >= maxSources) break;
  }

  return dedupeUrls(results.map((result) => result.url).filter((url) => isUsefulResearchUrl(url, topic))).slice(
    0,
    maxSources,
  );
}

export async function collectSourceSummaries(urls: string[]): Promise<TopicSourceSummary[]> {
  if (urls.length === 0) {
    return [
      {
        url: "",
        title: "주제",
        summary: "입력된 주제를 기준으로 생성합니다.",
      },
    ];
  }

  const summaries: TopicSourceSummary[] = [];
  for (const rawUrl of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort("topic-source-timeout");
      }, 8000);
      let body = "";
      try {
        const response = await fetch(rawUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
          },
          redirect: "follow",
        });
        body = await response.text();
      } finally {
        clearTimeout(timeout);
      }

      if (!body) {
        summaries.push({
          url: rawUrl,
          summary: "요약 실패",
          error: "페이지 응답이 비어 있습니다.",
        });
        continue;
      }

      summaries.push(extractSourceFromHtml(rawUrl, body));
    } catch (error) {
      summaries.push({
        url: rawUrl,
        summary: "요약 실패",
        error: error instanceof Error ? error.message : "요약 중 오류가 발생했습니다.",
      });
    }
  }

  return summaries;
}

export async function buildResearchSignals(
  topic: string,
  type: TopicType,
  sourceKeywords: string[],
): Promise<TopicResearchPacket> {
  const defaultSignals: TopicResearchSignal[] = sourceKeywords.map((keyword) => ({
    keyword,
    source: "template",
    score: 70,
  }));

  try {
    const suggestions = await generateKeywordSuggestions(topic, type);
    const signalFromSuggestions: TopicResearchSignal[] = suggestions.map((entry: KeywordSuggestion) => ({
      keyword: entry.keyword,
      source: entry.source,
      score: entry.score || 70,
    }));

    return {
      topic,
      type,
      generatedAt: new Date().toISOString(),
      intent: null,
      audience: null,
      style: null,
      trendSignals: [...signalFromSuggestions, ...defaultSignals].slice(0, 20),
      sourceUrls: [],
      sourceSummaries: [],
    };
  } catch {
    return {
      topic,
      type,
      generatedAt: new Date().toISOString(),
      intent: null,
      audience: null,
      style: null,
      trendSignals: defaultSignals.slice(0, 20),
      sourceUrls: [],
      sourceSummaries: [],
    };
  }
}

export function normalizeSubtopics(items: string[], maxItems: number): string[] {
  const normalized: string[] = [];
  const used = new Set<string>();
  for (const item of items) {
    const text = uniqueText([item])[0];
    if (!text) continue;

    let duplicated = false;
    for (const existing of normalized) {
    const score = jaccard(existing, text);
      if (score >= 0.84) {
        duplicated = true;
        break;
      }
    }

    if (duplicated) continue;

    const key = normalizeText(text).toLowerCase();
    if (used.has(key)) continue;

    used.add(key);
    normalized.push(text);
    if (normalized.length >= maxItems) break;
  }

  return normalized;
}

export function planSubtopics(
  topic: string,
  type: TopicType,
  signals: TopicResearchSignal[],
  requestedCount?: number,
  options?: { intent?: string | null; audience?: string | null; style?: string | null },
): TopicSubtopicPlan[];
export function planSubtopics(
  topic: string,
  signals: TopicResearchSignal[],
  requestedCount?: number,
): TopicSubtopicPlan[];
export function planSubtopics(
  topic: string,
  typeOrSignals: TopicType | TopicResearchSignal[],
  signalsOrCount: TopicResearchSignal[] | number = 5,
  requestedCount = 5,
  options?: { intent?: string | null; audience?: string | null; style?: string | null },
): TopicSubtopicPlan[] {
  const type = typeof typeOrSignals === "string" ? typeOrSignals : "knowledge";
  const signals =
    typeof typeOrSignals === "string"
      ? (signalsOrCount as TopicResearchSignal[])
      : (typeOrSignals as TopicResearchSignal[]);
  const normalizedCount =
    typeof signalsOrCount === "number" ? Math.max(1, signalsOrCount) : requestedCount;

  if (normalizedCount <= 0) {
    return [];
  }

  const normalizedOptions =
    typeof typeOrSignals === "string" ? options : undefined;

  const candidates = buildWeightedSubtopics(
    topic,
    type,
    signals,
    normalizedCount,
    normalizedOptions,
  );
  const ranked = candidates.sort((a, b) => b.score - a.score);
  const deduped = dedupeSubtopicCandidates(ranked, normalizedCount * 2, topic);
  const selected = deduped.slice(0, normalizedCount);

  if (selected.length < normalizedCount) {
    const fallback = dedupeSubtopicCandidates(ranked, normalizedCount * 3, topic, true);
    for (const candidate of fallback) {
      if (selected.length >= normalizedCount) {
        break;
      }
      if (selected.some((entry) => entry.subtopic === candidate.subtopic)) {
        continue;
      }
      selected.push(candidate);
    }
  }

  const roleOrder = buildNarrativeRoleOrder(selected.length);

  return selected.map((entry, index) => {
    const role = roleOrder[index] || "comparison";
    const seedKeyword = sanitizeNarrativeKeyword(
      topic,
      signals[index]?.keyword || entry.subtopic || topic,
    ) || normalizeText(topic);
    const rewrittenSubtopic = buildRoleAwareSubtopic(topic, type, seedKeyword, role, index);
    const fallbackSubtopic = normalizeGeneratedSubtopic(topic, entry.subtopic);
    const subtopic = subtopicLooksBroken(rewrittenSubtopic) ? fallbackSubtopic : rewrittenSubtopic;
    const focusKeyword = seedKeyword;

    return {
      index,
      subtopic,
      reason: buildRoleAwareReason(topic, focusKeyword, role, type, entry.source),
      priority: index + 1,
      confidence: clampConfidence(entry.score - index * 0.02),
      role,
      readerPromise: buildReaderPromise(role, focusKeyword),
      imageCue: buildImageCue(role, focusKeyword, type),
      whyNow: buildWhyNow(role, topic, focusKeyword, type),
    };
  });
}

const TOPIC_OUTPUT_JSON_BLOCK_RE = /\{[\s\S]*?\}/g;

function normalizeTextOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractJsonObjectBlocks(raw: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (ch === "}") {
      if (depth > 0) {
        depth -= 1;
      }
      if (depth === 0 && start >= 0) {
        blocks.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return blocks;
}

function parsePossibleSections(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    const sections: string[] = [];

    for (const entry of value) {
      if (typeof entry === "string") {
        const text = entry.trim();
        if (text) sections.push(text);
        continue;
      }

      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const heading = normalizeTextOrEmpty(
          record.heading ?? record.sectionTitle ?? record.title ?? record.name
        );
        const body = normalizeTextOrEmpty(
          record.body ?? record.text ?? record.content ?? record.description
        );
        const merged = [heading, body].filter(Boolean).join("\n\n");
        if (merged.length > 0) {
          sections.push(merged);
        }
      }
    }

    return sections;
  }

  const fallback = normalizeTextOrEmpty(value);
  if (!fallback) return [];

  return fallback
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parsePossibleHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeTextOrEmpty(entry))
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.replace(/^#/, ""));
}

export function parseTopicAgentOutput(raw: string): TopicDraftCandidate | null {
  const blocks = extractJsonObjectBlocks(raw).filter((block) => {
    const trim = block.trim();
    return trim.startsWith("{") && trim.endsWith("}");
  });

  for (const block of blocks.length ? blocks : [raw]) {
    let parsed: unknown;
    try {
      const matched = block.match(TOPIC_OUTPUT_JSON_BLOCK_RE);
      if (matched) {
        for (const candidate of matched) {
          const candidateText = candidate.trim();
          if (!candidateText.startsWith("{") || !candidateText.endsWith("}")) continue;
          try {
            parsed = JSON.parse(candidateText);
            break;
          } catch {
            parsed = null;
          }
        }
      } else {
        parsed = JSON.parse(block);
      }
    } catch {
      parsed = null;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const title = normalizeTextOrEmpty(record.title ?? record.headline ?? record.name);
    const sections = parsePossibleSections(record.sections ?? record.body ?? record.content);
    const hashtags = parsePossibleHashtags(record.hashtags ?? record.tags);

    if (!title && sections.length === 0 && hashtags.length === 0) {
      continue;
    }

    return {
      title,
      sections,
      hashtags,
    };
  }

  return null;
}
