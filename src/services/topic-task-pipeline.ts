import "server-only";

import fs from "fs";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { prisma } from "@/lib/db";
import {
  buildResearchSignals,
  collectSourceSummaries,
  discoverTopicSourceUrls,
  planSubtopics,
  parseKeywords,
  parseSourceUrls,
  type TopicResearchSignal,
  type TopicResearchPacket,
  type TopicSourceSummary,
  type TopicSubtopicRole,
  type TopicType,
} from "@/lib/topic-workflow";
import {
  parsePreparedTopicContent,
  renderTopicContentToHtml,
  serializePreparedTopicContent,
  type PreparedTopicContent,
  type PreparedTopicSection,
  type PreparedTopicSectionKind,
  type TopicVisualPlan,
  type TopicVisualPlanItem,
} from "@/lib/topic-task-contract";
import {
  getTopicTaskContentReadiness,
  type TopicTaskContentReadiness,
} from "@/lib/topic-task-content-readiness";

const TOPIC_CRAFT_GENERATE_TOPICS_URL =
  process.env.TOPIC_CRAFT_GENERATE_TOPICS_URL ||
  "https://zijskbxxpkibhtxdihvb.supabase.co/functions/v1/generate-topics";
const TOPIC_CRAFT_GENERATE_IMAGE_URL =
  process.env.TOPIC_CRAFT_GENERATE_IMAGE_URL ||
  "https://zijskbxxpkibhtxdihvb.supabase.co/functions/v1/generate-image";
const PEXELS_API_KEY = process.env.PEXELS_API_KEY?.trim() || "";
const TOPIC_PIPELINE_ALLOW_GENERIC_IMAGE_FALLBACK =
  process.env.TOPIC_PIPELINE_ALLOW_GENERIC_IMAGE_FALLBACK?.toLowerCase() === "true";
const OPENAI_MODEL = process.env.TOPIC_PIPELINE_OPENAI_MODEL || "gpt-4o-mini";
const CHATGPT_USE_CUSTOM_GPTS =
  (process.env.CHATGPT_USE_CUSTOM_GPTS || "false").toLowerCase() === "true";
const CHATGPT_BASE_URL = process.env.CHATGPT_BASE_URL || "https://chatgpt.com/";
const BROWSER_TOPIC_GPT_URL =
  CHATGPT_USE_CUSTOM_GPTS
    ? process.env.CHATGPT_GPT_URL_TOPIC || process.env.CHATGPT_GPT_URL_DRAFT || CHATGPT_BASE_URL
    : CHATGPT_BASE_URL;
const DEFAULT_CHATGPT_IMAGE_GPT_URL =
  "https://chatgpt.com/g/g-69044d98b1f08191b96ca4293c6c8156-jeongboseong-imiji-saengseong-v11-dapeojuneunnamja";
const CHATGPT_IMAGE_GPT_URL =
  process.env.CHATGPT_GPT_URL_IMAGE || DEFAULT_CHATGPT_IMAGE_GPT_URL;
const ALLOW_CHATGPT_BROWSER_MODE =
  (process.env.ALLOW_CHATGPT_BROWSER_MODE || "false").toLowerCase() === "true";
const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");
const IMAGE_ROOT = path.join(process.cwd(), "temp_images", "topic-pipeline");
const TOPIC_DAEDAL_IMAGE_ENABLED =
  process.env.TOPIC_PIPELINE_DAEDAL_ENABLED?.toLowerCase() === "true";
const HAS_OPENAI_API_KEY = /^sk-[A-Za-z0-9_-]+/.test(process.env.OPENAI_API_KEY?.trim() || "");
const TOPIC_DAEDAL_BIN =
  process.env.TOPIC_PIPELINE_DAEDAL_BIN?.trim() ||
  process.env.DAEDAL_BIN?.trim() ||
  (process.env.HOME && fs.existsSync(path.join(process.env.HOME, ".cargo", "bin", "daedal"))
    ? path.join(process.env.HOME, ".cargo", "bin", "daedal")
    : "daedal");
const TOPIC_DAEDAL_PRESET = process.env.TOPIC_PIPELINE_DAEDAL_PRESET?.trim() || "slide";
const TOPIC_DAEDAL_SIZE = process.env.TOPIC_PIPELINE_DAEDAL_SIZE?.trim() || "";
const TOPIC_DAEDAL_QUALITY = process.env.TOPIC_PIPELINE_DAEDAL_QUALITY?.trim() || "";
const TOPIC_DAEDAL_MODEL = process.env.TOPIC_PIPELINE_DAEDAL_MODEL?.trim() || "";
const PREPARE_LOCK_ROOT = path.join(IMAGE_ROOT, "_locks");
const PREPARE_LOCK_STALE_MS = 20 * 60 * 1000;
const TOPIC_CRAFT_TIMEOUT_MS = Number(process.env.TOPIC_CRAFT_TIMEOUT_MS || 300_000);
const BLOG_MOBILE_HUMAN_STYLE_PROMPT = [
  "문체 기본값:",
  "- 사람이 휴대폰으로 직접 쓰는 네이버 블로그 글처럼 부드러운 ~요체로 쓴다.",
  "- 한 문장은 25-45자 안팎으로 짧게 끊고, 1-2문장마다 줄바꿈한다.",
  "- '결론적으로', '종합적으로', '본 포스팅에서는', '최적의 선택' 같은 AI/광고 문구는 쓰지 않는다.",
  "- 같은 어미와 같은 문장 구조를 반복하지 않는다.",
  "- 과장된 보장 표현보다 실제 판단 기준, 작은 아쉬움, 참고 포인트를 자연스럽게 넣는다.",
].join("\n");
const TOPIC_CRAFT_AUTH_HEADERS: string[] = process.env.TOPIC_CRAFT_API_KEY
  ? ["-H", `Authorization: Bearer ${process.env.TOPIC_CRAFT_API_KEY}`]
  : [];
const STRUCTURED_MODEL_TIMEOUT_MS = 60_000;
const TOPIC_CODEX_FALLBACK_ENABLED =
  process.env.TOPIC_PIPELINE_CODEX_FALLBACK?.toLowerCase() === "true";
const TOPIC_CODEX_EDITOR_ENABLED =
  process.env.TOPIC_PIPELINE_CODEX_EDITOR?.toLowerCase() !== "false";
const TOPIC_EXPERIMENTAL_SUBTOPIC_PLANNER =
  process.env.TOPIC_EXPERIMENTAL_SUBTOPIC_PLANNER?.toLowerCase() === "true";
const TOPIC_CODEX_TIMEOUT_MS = Number(process.env.TOPIC_PIPELINE_CODEX_TIMEOUT_MS || 45_000);
const TOPIC_BROWSER_FALLBACK_ENABLED =
  process.env.TOPIC_PIPELINE_BROWSER_FALLBACK?.toLowerCase() === "true";
const TOPIC_BROWSER_FALLBACK_TIMEOUT_MS = Number(
  process.env.TOPIC_PIPELINE_BROWSER_FALLBACK_TIMEOUT_MS || 45_000,
);
const TOPIC_CHATGPT_IMAGE_BATCH_TIMEOUT_MS = Number(
  process.env.TOPIC_PIPELINE_CHATGPT_IMAGE_BATCH_TIMEOUT_MS || 120_000,
);
const TOPIC_DAEDAL_IMAGE_TIMEOUT_MS = Number(
  process.env.TOPIC_PIPELINE_DAEDAL_IMAGE_TIMEOUT_MS || 180_000,
);
const CURL_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = Number(process.env.TOPIC_PIPELINE_IMAGE_FETCH_TIMEOUT_MS || 15_000);
const STOCK_PROVIDER_TIMEOUT_MS = Number(process.env.TOPIC_PIPELINE_STOCK_TIMEOUT_MS || 12_000);
const execFileAsync = promisify(execFile);

export const TOPIC_TASK_PIPELINE_STAGES = [
  "READY",
  "RESEARCHING",
  "CANDIDATES_READY",
  "SELECTED",
  "POLISHING",
  "IMAGE_READY",
  "PREPARED",
  "PUBLISHING",
  "PUBLISHED",
  "SCHEDULED",
  "FAILED",
] as const;

export const TOPIC_CRAFT_CATEGORIES = [
  "기술 / IT",
  "비즈니스 / 경제",
  "라이프스타일",
  "디자인 / 크리에이티브",
  "마케팅 / 트렌드",
  "음식 / 요리",
  "여행 / 문화",
  "건강 / 운동",
  "교육 / 자기계발",
  "AI / 미래기술",
] as const;

type TopicTaskPipelineStage = (typeof TOPIC_TASK_PIPELINE_STAGES)[number];
type TopicCraftCategory = (typeof TOPIC_CRAFT_CATEGORIES)[number];

export class TopicPrepareConflictError extends Error {
  constructor(message = "이미 주제글 준비가 진행 중입니다. 잠시 후 다시 시도하세요.") {
    super(message);
    this.name = "TopicPrepareConflictError";
  }
}

interface TopicCraftSubtopic {
  subtitle?: string;
  summary?: string;
  role?: TopicSubtopicRole;
  readerPromise?: string;
  imageCue?: string;
  whyNow?: string;
}

interface TopicCraftCandidate {
  title?: string;
  content?: string;
  hashtags?: string[];
  subtopics?: TopicCraftSubtopic[];
  image_prompt?: string;
  angleBriefId?: string;
  thesis?: string;
  readerPromise?: string;
  requiredEvidence?: string[];
}

interface NarrativeAngleBrief {
  id: string;
  headline: string;
  thesis: string;
  readerPromise: string;
  heroIntent: string;
  sectionPlan: TopicCraftSubtopic[];
  requiredEvidence: string[];
}

interface TopicCraftResponse {
  topics?: unknown;
  results?: unknown;
  candidates?: unknown;
  data?: unknown;
  error?: string;
  message?: string;
}

interface SourceImageCandidate {
  sourceRefId: string;
  pageUrl: string;
  imageUrl: string;
}

interface ScoredTopicCandidate {
  index: number;
  candidate: TopicCraftCandidate;
  score: number;
  sectionCount: number;
  bodyLength: number;
  averageSectionLength: number;
  repeatedLineRatio: number;
  keywordCoverage: number;
  hookScore: number;
  blandnessPenalty: number;
  mobileCadencePenalty: number;
  inferredKinds: SectionKind[];
  normalizedSections: PreparedTopicSection[];
  preview: string[];
}

interface TopicSelectionDecision {
  selectedIndex: number;
  reason: string;
  risks: string[];
}

interface PreparedImageAsset {
  sourceUrl: string;
  localPath: string | null;
  creditName: string | null;
  creditUrl: string | null;
  role: string;
  query: string | null;
  provider: string | null;
}

interface ChatGPTImageBatchJob {
  id: string;
  prompt: string;
  outStem: string;
}

interface PreGeneratedImageAsset {
  localPath: string;
  provider: string;
  creditName: string | null;
  creditUrl: string | null;
  sourcePrefix: string;
}

interface DownloadedImageAsset {
  localPath: string;
  contentType: string | null;
}

interface ResolvedStockImage {
  downloadUrl: string;
  creditName: string | null;
  creditUrl: string | null;
  provider: string;
}

type ImageRole = NonNullable<TopicVisualPlanItem["role"]>;
type ImageStrategy = NonNullable<TopicVisualPlanItem["strategy"]>;
type VisualIntent = NonNullable<TopicVisualPlanItem["visualIntent"]>;
interface PlannedInlineImage {
  sectionIndex: number;
  priority: number;
  item: TopicVisualPlanItem;
}
type SectionKind = PreparedTopicSectionKind;

interface PrepareTaskResult {
  taskId: string;
  campaignId: string;
  selectedDraftId: string;
  content: PreparedTopicContent;
  imagePlan: TopicVisualPlan;
  imageCount: number;
}

type TaskRecord = Awaited<ReturnType<typeof getTaskForPrepare>>;

function getTaskForPrepare(taskId: string) {
  return prisma.topicPostTask.findUnique({
    where: { id: taskId },
  });
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function sanitizeEvidenceText(value: string): string {
  return normalizeText(value)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/enable javascript and cookies to continue/gi, "")
    .replace(/access denied/gi, "")
    .replace(/javascript.*cookies/gi, "")
    .replace(/로그인이 필요합니다/gi, "")
    .replace(/페이지를 찾을 수 없습니다/gi, "")
    .replace(/본문 바로가기/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isUsableSourceEvidence(value: string): boolean {
  const normalized = sanitizeEvidenceText(value);
  if (!normalized) return false;
  if (normalized.length < 18) return false;
  return !/continue|cookies|javascript|access denied|robot|captcha/i.test(normalized);
}

function sanitizeNarrativeSeed(value: string, rootTopic = ""): string {
  const topic = normalizeText(rootTopic);
  let cleaned = sanitizeEvidenceText(value);
  if (topic) {
    cleaned = cleaned.replace(
      new RegExp(topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      " ",
    );
  }
  cleaned = cleaned
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";
  if (/^(source|url|link|출처)$/i.test(cleaned)) return "";
  if (textLooksBroken(cleaned)) return "";
  return cleaned;
}

function compactTemplateKeyword(
  rootTopic: string,
  rawKeyword: string,
  heading: string,
  kind: SectionKind,
): string {
  const candidates = [rawKeyword, heading]
    .map((value) => sanitizeNarrativeSeed(value, rootTopic))
    .filter(Boolean);

  const phrasePatterns: Array<[RegExp, string]> = [
    [/첫 문장|도입/u, "첫 문장"],
    [/장면|상황|사례/u, "장면"],
    [/비교|전후|차이/u, "비교"],
    [/오해|착각|실수/u, "오해"],
    [/기준|선택/u, "선택 기준"],
    [/근거|자료|출처/u, "근거"],
  ];

  for (const candidate of candidates) {
    for (const [pattern, replacement] of phrasePatterns) {
      if (pattern.test(candidate)) return replacement;
    }

    if (candidate.length <= 12 && !/[다요]$/u.test(candidate)) {
      return candidate;
    }
  }

  switch (kind) {
    case "hook":
      return "첫 문장";
    case "scene":
      return "장면";
    case "comparison":
      return "비교";
    case "mistake":
      return "오해";
    case "proof":
      return "근거";
    case "takeaway":
      return "선택 기준";
    default:
      return "핵심 포인트";
  }
}

const GENERIC_TITLE_PATTERNS = [
  /체크리스트/i,
  /실전\s*정리/i,
  /적용\s*판단\s*프레임/i,
  /문제해결\s*적용\s*순서/i,
  /도입\s*기준/i,
  /운영\s*방식/i,
  /검증\s*방식/i,
];

const DULL_BODY_PATTERNS = [
  /요청 맥락 기반 확장/i,
  /실제 글 발행에 바로 쓸 수 있는 구조/i,
  /품질이 안정적입니다/i,
  /적용 순서가 보이도록 재구성/i,
  /핵심 내용입니다/i,
  /중심으로 묶었습니다/i,
  /바로 실행할 수 있게 풀어/i,
  /입력 키워드와 리서치 시그널을 바탕으로/i,
  /신호를 보면 .*먼저 풀어야/i,
  /글이 덜 딱딱하고 더 재밌게 읽힙니다/i,
  /억지로 끼워 넣기보다/i,
  /설명문처럼 보입니다/i,
  /이번 글에서는/i,
  /이 글은 .*구성/i,
  /도입에서는/i,
  /마무리에서는/i,
  /이 구간은/i,
  /핵심은 .*데 있/i,
  /독자는 .*궁금해합니다/i,
  /건\s+[를을이가은는]\s/iu,
  /[가-힣]+다를/iu,
  /이유에서 .* 장면/i,
];

const GENERIC_HEADING_PATTERNS = [
  /^핵심 정리$/i,
  /^실전 포인트$/i,
  /^마무리$/i,
  /^포인트 \d+$/i,
  /^정리 \d+$/i,
];

const ENGAGING_ANGLE_PATTERNS = [
  /왜/i,
  /오해/i,
  /실수/i,
  /장면/i,
  /사례/i,
  /비교/i,
  /후회/i,
  /갈리/i,
  /달라지/i,
  /막히/i,
  /첫 문장/i,
  /리듬/i,
];

const TITLE_FALLBACK_ENDINGS = [
  "처음 고르는 기준이 중요해요",
  "작은 차이에서 만족도가 갈려요",
  "알고 보면 선택이 훨씬 쉬워요",
  "미리 보면 덜 헤매게 돼요",
];

function countPatternHits(value: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

function textLooksBroken(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  return /문장가|장면가|방법가|살아 있은|차가$|건\s+[를을이가은는]|딱딱해지|밋밋해지|독자 바로|읽은 사람/u.test(
    normalized,
  );
}

function isWritingFocusedTopic(rootTopic: string, keywords: string[] = []): boolean {
  const haystack = [rootTopic, ...keywords].join(" ");
  return /(글|문장|블로그|콘텐츠|카피|초안|독자|가독성|소주제|윤문|제목|후킹|writing|content|blog)/i.test(
    haystack,
  );
}

function stableTokenIndex(seed: string, max: number): number {
  if (max <= 0) return 0;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
  }
  return hash % max;
}

function compactNarrativeAngle(rootTopic: string, leadSubtopic: string): string {
  const topic = normalizeText(rootTopic);
  const lead = normalizeText(leadSubtopic)
    .replace(new RegExp(topic, "gi"), "")
    .replace(/[,:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const focusMatch = lead.match(/(사례|비교|오해|실수|장면|훅|리듬|선택 기준|후회 포인트|동선|예산|루틴|스코어)/);
  if (focusMatch?.[1]) {
    const token = focusMatch[1];
    if (token === "장면") return "장면";
    if (token === "선택 기준") return "선택 기준";
    return `${token} 포인트`;
  }

  if (!lead) return "핵심 장면";
  if (lead.length <= 18) return lead;
  return `${lead.slice(0, 18).trim()}...`;
}

function titleNeedsCleanup(title: string, rootTopic: string): boolean {
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) return true;
  if (countPatternHits(normalizedTitle, GENERIC_TITLE_PATTERNS) > 0) return true;
  if (normalizedTitle.length > 52) return true;

  const escapedTopic = normalizeText(rootTopic).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escapedTopic) {
    const repeated = normalizedTitle.match(new RegExp(escapedTopic, "gi")) || [];
    if (repeated.length > 1) return true;
  }

  return false;
}

function countTopicMentions(value: string, topic: string): number {
  const normalizedTopic = normalizeText(topic);
  if (!normalizedTopic) return 0;

  const escaped = normalizedTopic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matched = normalizeText(value).match(new RegExp(escaped, "gi"));
  return matched?.length || 0;
}

function stripRepeatedTopicFragments(value: string, rootTopic: string): string {
  const topic = normalizeText(rootTopic);
  let next = normalizeText(value);
  if (!topic || !next) return next;

  const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  next = next.replace(new RegExp(escaped, "gi"), " ");
  next = next.replace(/[,:]/g, " ").replace(/\s+/g, " ").trim();
  return next;
}

function buildPlayfulTitle(
  rootTopic: string,
  leadSubtopic: string,
  variant: number,
  topicType: TopicType = "knowledge",
): string {
  const topic = normalizeText(rootTopic);
  const topicEndsWithReason = /이유$/.test(topic);
  const lead = sanitizeNarrativeSeed(compactNarrativeAngle(rootTopic, leadSubtopic), rootTopic);
  const strippedLead = stripRepeatedTopicFragments(lead, rootTopic);
  const safeLead =
    strippedLead &&
    strippedLead.length <= 18 &&
    countPatternHits(strippedLead, GENERIC_TITLE_PATTERNS) === 0 &&
    !/(포인트|기준)$/i.test(strippedLead)
      ? strippedLead
      : "";
  const leadPatterns =
    topicType === "travel"
      ? safeLead
        ? [
            `${topic}, 만족도는 결국 ${safeLead}에서 갈린다`,
            `${topic} 갈 때 ${safeLead}를 먼저 봐야 하는 이유`,
            `${topic}, ${safeLead} 하나로 하루 결이 달라진다`,
          ]
        : []
      : topicType === "golf"
        ? safeLead
          ? [
              `${topic}, 실전 체감은 ${safeLead}에서 갈린다`,
              `${topic}에서 ${safeLead}를 놓치면 바로 티 난다`,
              `${topic}, ${safeLead} 하나로 흐름이 달라진다`,
            ]
          : []
        : safeLead
          ? [
              `${topic}, 막상 보면 ${safeLead}에서 갈린다`,
              `${topic}를 읽히게 만드는 ${safeLead}`,
              `${topic}가 밋밋해지는 건 ${safeLead}를 놓칠 때다`,
            ]
          : [];
  const fallbackPatterns =
    topicType === "travel"
      ? [
          `${topic}, 어디를 먼저 정하느냐에 따라 만족도가 달라진다`,
          `${topic}, 다녀온 뒤 후회가 모이는 지점`,
          `${topic}, 마지막까지 분위기를 지키는 선택 기준`,
          `${topic}, 처음부터 흐름이 편한 사람들의 공통점`,
        ]
      : topicType === "golf"
        ? [
            `${topic}, 라운드 흐름은 작은 판단에서 갈린다`,
            `${topic}, 막상 가면 바로 티 나는 준비 차이`,
            `${topic}, 컨디션이 흔들릴수록 먼저 봐야 할 것`,
            `${topic}, 오늘 바로 체감되는 기준 하나`,
          ]
        : [
            topicEndsWithReason
              ? `${topic}, 대개 첫 세 문장에서 티가 난다`
              : `${topic}, ${TITLE_FALLBACK_ENDINGS[stableTokenIndex(topic, TITLE_FALLBACK_ENDINGS.length)]}`,
            topicEndsWithReason
              ? `${topic}, 정보보다 장면이 먼저 살아야 읽힌다`
              : `${topic}, 다들 비슷하게 쓰는 이유`,
            topicEndsWithReason ? `${topic}, 사람 냄새는 사례에서 난다` : `${topic}, 다들 비슷하게 쓰는 이유`,
            `${topic}가 재미없게 느껴질 때 먼저 바꿀 것`,
          ];
  const patterns = [...leadPatterns, ...fallbackPatterns];

  return patterns[variant % patterns.length];
}

function normalizeSectionKind(
  value: unknown,
  index: number,
  sectionCount: number,
  topicType: TopicType,
): SectionKind {
  const normalized = normalizeText(value);
  if (
    normalized === "hook" ||
    normalized === "scene" ||
    normalized === "mistake" ||
    normalized === "comparison" ||
    normalized === "proof" ||
    normalized === "takeaway"
  ) {
    return normalized;
  }

  const defaultKindsByCount: Record<number, SectionKind[]> = {
    1: ["hook"],
    2: ["hook", "takeaway"],
    3: ["hook", "comparison", "takeaway"],
    4: ["hook", "scene", "comparison", "takeaway"],
    5: ["hook", "scene", "mistake", "comparison", "takeaway"],
  };

  const normalizedCount = Math.max(1, Math.min(5, sectionCount));
  const defaultKinds = defaultKindsByCount[normalizedCount] || defaultKindsByCount[4];
  return defaultKinds[index] || (topicType === "travel" ? "scene" : "comparison");
}

function buildSectionHeadingByType(
  topicType: TopicType,
  topic: string,
  index: number,
  kind: SectionKind = "scene",
): string {
  const normalizedTopic = normalizeText(topic);
  const headingSets: Record<TopicType, Record<SectionKind, string[]>> = {
    knowledge: {
      hook: ["첫 세 문장에서 이미 분위기가 갈린다", "읽기 시작하자마자 흥미가 갈리는 순간"],
      scene: ["설명보다 장면이 먼저 남는 구간", "독자가 바로 자기 얘기로 받아들이는 장면"],
      mistake: ["많이 쓰지만 의외로 더 밋밋해지는 방식", "정보를 더 얹으면 좋아질 거라는 착각"],
      comparison: ["잘 읽히는 글과 심심한 글은 여기서 갈린다", "순서 하나 바꾸면 리듬이 달라지는 지점"],
      proof: ["실제 사례를 붙였을 때 갑자기 살아나는 부분", "근거가 들어오면 설득력이 달라지는 순간"],
      takeaway: ["지금 글에서 바로 먼저 바꿔볼 기준", "마지막에 남겨야 하는 건 결론보다 기준"],
    },
    travel: {
      hook: ["출발 전에 이미 판이 갈리는 이유", "여행 분위기는 의외로 여기서 먼저 정해진다"],
      scene: ["현장에서 표정이 바뀌는 순간", "그날 일정이 갑자기 편해지는 선택"],
      mistake: ["많이들 여기서 무리하다가 여행이 꼬인다", "아끼려다 오히려 더 피곤해지는 지점"],
      comparison: ["같은 코스라도 체감이 달라지는 이유", "돈보다 동선이 더 크게 갈라놓는 순간"],
      proof: ["실제 후기에서 반복되는 후회 포인트", "다녀온 사람들 말이 유독 모이는 지점"],
      takeaway: ["돌아와서 덜 후회하려면 여기부터 본다", "이번 여행에서 바로 써먹을 선택 기준"],
    },
    golf: {
      hook: ["처음 흐름이 무너지는 건 대개 여기다", "시작하자마자 샷이 흔들리는 순간"],
      scene: ["몸이 먼저 신호를 보내는 장면", "실전에서 바로 체감되는 구간"],
      mistake: ["힘을 더 쓰면 해결될 거라는 착각", "자꾸 급해질수록 더 안 맞는 이유"],
      comparison: ["준비한 샷과 대충 친 샷은 여기서 갈린다", "하나만 바꿔도 스코어가 달라지는 포인트"],
      proof: ["라운드 데이터와 후기에서 반복되는 부분", "구력자들이 유독 먼저 보는 지점"],
      takeaway: ["오늘 라운드 전에 바로 체크할 것", "당장 하나만 바꾼다면 여기부터다"],
    },
  };

  const selected = headingSets[topicType]?.[kind] || headingSets.knowledge[kind] || headingSets.knowledge.scene;
  return selected[index % selected.length] || `${normalizedTopic}에서 놓치기 쉬운 포인트 ${index + 1}`;
}

function deriveNarrativeKeyword(rootTopic: string, heading: string, fallback: string): string {
  const normalizedTopic = normalizeText(rootTopic);
  const candidates = [heading, fallback, normalizedTopic]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  for (const candidate of candidates) {
    const withoutTopic = normalizedTopic
      ? candidate.split(normalizedTopic).join(" ")
      : candidate;
    const cleaned = withoutTopic
      .replace(/놓치기 쉬운 포인트\s*\d+/g, " ")
      .replace(/[\"'“”‘’]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length >= 6 && !isGenericHeading(cleaned)) {
      return cleaned;
    }
  }

  return normalizeText(fallback) || normalizedTopic || "이 지점";
}

function buildSectionSummary(params: {
  type: TopicType;
  kind: SectionKind;
  keyword: string;
  fallback?: string | null;
}): string {
  const summaries: Record<SectionKind, Record<TopicType, string>> = {
    hook: {
      knowledge: "처음 보는 순간부터 감이 갈린다",
      travel: "출발 전에 하루 리듬이 갈린다",
      golf: "첫 샷 전에 이미 흐름이 갈린다",
    },
    scene: {
      knowledge: "상황이 보여야 바로 이해된다",
      travel: "현장 장면이 있어야 바로 감이 온다",
      golf: "몸 반응이 보여야 바로 와닿는다",
    },
    mistake: {
      knowledge: "이 지점을 놓치면 감이 끊긴다",
      travel: "이 포인트를 놓치면 일정이 더 꼬인다",
      golf: "힘으로 풀려 들면 리듬이 깨진다",
    },
    comparison: {
      knowledge: "전후 차이가 보여야 선택이 선다",
      travel: "비교가 있어야 선택이 쉬워진다",
      golf: "전후 차이가 보여야 감각이 산다",
    },
    proof: {
      knowledge: "사례 하나가 긴 설명보다 더 빨리 먹힌다",
      travel: "실제 후기와 붙을 때 믿음이 선다",
      golf: "사례가 붙을 때 체감이 훨씬 빨라진다",
    },
    takeaway: {
      knowledge: "마지막엔 바꿀 기준 하나만 남겨야 한다",
      travel: "끝에는 선택 기준 하나만 남겨야 한다",
      golf: "마지막엔 루틴 기준 하나만 남겨야 한다",
    },
  };

  return summaries[params.kind]?.[params.type] || summaries.scene.knowledge;
}

function buildSectionBullets(params: {
  type: TopicType;
  kind: SectionKind;
  keyword: string;
}): string[] {
  const keyword = normalizeText(params.keyword) || "이 포인트";
  const defaults: Record<SectionKind, Record<TopicType, string[]>> = {
    hook: {
      knowledge: [`${withSubjectParticle(keyword)} 어디서 갈리는지 먼저 본다`, "사람이 바로 떠올릴 장면을 남긴다"],
      travel: [`${keyword}가 하루 리듬을 어떻게 바꾸는지 본다`, "첫날 피로와 만족도가 갈리는 순간을 남긴다"],
      golf: [`${keyword}가 무너질 때 샷이 어떻게 흔들리는지 본다`, "설명보다 실전 장면을 먼저 둔다"],
    },
    scene: {
      knowledge: ["설명 대신 실제 상황을 붙인다", "추상어를 줄이고 감각적인 단서를 남긴다"],
      travel: ["동선과 체력 변화가 함께 보이게 쓴다", "작은 선택이 하루 분위기를 바꾸는 순간을 남긴다"],
      golf: ["몸 반응과 결과 차이를 같이 적는다", "스윙보다 리듬이 바뀌는 순간을 보여준다"],
    },
    mistake: {
      knowledge: ["배경 설명부터 길게 풀지 않는다", "오해가 생기는 지점을 먼저 끊는다"],
      travel: ["동선과 예산을 따로 떼어 설명하지 않는다", "후회가 쌓이는 패턴을 먼저 보여준다"],
      golf: ["힘으로 해결하려는 조언을 줄인다", "빼야 하는 루틴이 뭔지 먼저 본다"],
    },
    comparison: {
      knowledge: ["잘 풀리는 경우와 막히는 경우를 붙여 본다", "전후 차이를 한 화면에 묶는다"],
      travel: ["가벼운 일정과 무리한 일정을 같이 본다", "돈보다 피로가 갈리는 기준을 남긴다"],
      golf: ["루틴 전후 결과를 한 번에 보여준다", "하나만 바꾼 결과 차이를 남긴다"],
    },
    proof: {
      knowledge: ["실제 사례는 한 장면만 짧게 붙인다", "근거가 판단을 어떻게 바꾸는지 잇는다"],
      travel: ["후기나 이동 기록을 한 줄만 끌어온다", "자료를 바로 선택 기준으로 잇는다"],
      golf: ["라운드 사례를 한 장면으로 압축한다", "근거가 체감으로 이어지게 적는다"],
    },
    takeaway: {
      knowledge: ["마지막엔 결론보다 기준을 남긴다", "지금 글에서 바꿀 한 가지를 남긴다"],
      travel: ["누가 어떤 선택을 하면 덜 후회하는지 남긴다", "이번 일정에서 우선순위 하나만 남긴다"],
      golf: ["오늘 라운드 전에 볼 기준 하나를 남긴다", "지금 바로 줄일 습관 하나를 적는다"],
    },
  };

  return defaults[params.kind]?.[params.type] || defaults.scene.knowledge;
}

function isGenericHeading(value: string): boolean {
  const heading = normalizeText(value);
  return !heading || GENERIC_HEADING_PATTERNS.some((pattern) => pattern.test(heading));
}

function bodyNeedsFallback(value: string): boolean {
  const body = normalizeText(value);
  if (body.length < 120) return true;
  if (/https?:\/\/\S+/i.test(body)) return true;
  if (countPatternHits(body, DULL_BODY_PATTERNS) > 0) return true;
  if (body.length > 520) return true;
  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => normalizeText(paragraph))
    .filter(Boolean);
  if (paragraphs.some((paragraph) => paragraph.length > 170)) return true;
  if (/건\s+[를을이가은는]\s|[가-힣]+다를|이유에서 .* 장면|를 정리할 때/iu.test(body)) return true;
  return /핵심 포인트를 정리|구조화했습니다|안정적입니다|재구성했습니다|이번 글|도입에서는|마무리에서는|이 구간은/i.test(
    body,
  );
}

function countNormalizedOccurrences(haystack: string, needle: string): number {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedHaystack || !normalizedNeedle) return 0;

  let count = 0;
  let startIndex = 0;
  while (startIndex < normalizedHaystack.length) {
    const foundIndex = normalizedHaystack.indexOf(normalizedNeedle, startIndex);
    if (foundIndex === -1) break;
    count += 1;
    startIndex = foundIndex + normalizedNeedle.length;
  }

  return count;
}

function containsNonWritingMetaBody(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  return /(글이|글은|글을|문장이|문장은|읽는 사람|읽힙니다|사람 말처럼|사람 냄새|교과서처럼|독자가|본문이)/u.test(
    normalized,
  );
}

function sectionBodyLooksBrokenForPublication(value: string, params: { rootTopic: string; writingTopic: boolean }): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  if (textLooksBroken(normalized)) return true;
  if (/[가-힣]{4,}에서는\s+[가-힣]{4,}(?:에서|는|은|이|가)\b/u.test(normalized)) return true;
  if (/감이 온다 [가-힣]{4,}(?:는|은|이|가|를|을)\b/u.test(normalized)) return true;
  if (!params.writingTopic && containsNonWritingMetaBody(normalized)) return true;

  const topicEchoCount = countNormalizedOccurrences(normalized, params.rootTopic);
  if (normalizeText(params.rootTopic).length >= 12 && topicEchoCount >= 1) return true;

  return false;
}

function hasBatchim(value: string): boolean {
  const trimmed = normalizeText(value);
  if (!trimmed) return false;
  const lastChar = trimmed[trimmed.length - 1];
  const code = lastChar.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function withObjectParticle(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return `${normalized}${hasBatchim(normalized) ? "을" : "를"}`;
}

function withSubjectParticle(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return `${normalized}${hasBatchim(normalized) ? "이" : "가"}`;
}

function summaryNeedsCleanup(value: string): boolean {
  const summary = normalizeText(value);
  if (!summary) return true;
  if (summary.length < 40) return true;
  if (countPatternHits(summary, DULL_BODY_PATTERNS) > 0) return true;
  if (/동점 구간|휴리스틱|자동 점수 우세|judge_fallback/i.test(summary)) return true;
  if (/독자 반응과 검색 흐름|신호를 보면/i.test(summary)) return true;
  if (/방법를|장면를|문장를|흐름를/i.test(summary)) return true;
  const sentences = summary
    .split(/[.!?。！？]/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
  if (sentences.length >= 2 && sentences[0] === sentences[1]) return true;
  return false;
}

function buildHighlightFromSection(section: PreparedTopicSection): string {
  const heading = normalizeText(section.heading);
  const summary = normalizeText(section.summary);
  const firstSentence = normalizeText(section.body)
    .split(/(?<=[.!?])\s+|(?<=다\.)\s+/u)
    .map((sentence) => normalizeText(sentence))
    .find(Boolean);

  const seed = [summary, heading, firstSentence]
    .map((value) => normalizeText(value))
    .find((value) => value && !textLooksBroken(value) && !/https?:\/\//i.test(value)) || "";
  const clipped = truncateText(seed.replace(/[.!?]$/g, ""), 26);
  if (clipped.length >= 8) {
    return clipped;
  }

  switch (section.kind) {
    case "hook":
      return "처음 3문장에서 갈린다";
    case "mistake":
      return "많이 하는 착각부터 끊는다";
    case "comparison":
      return "전후 차이가 바로 보인다";
    case "proof":
      return "사례가 들어오면 납득이 빨라진다";
    case "takeaway":
      return "마지막엔 기준만 남긴다";
    default:
      return "장면으로 먼저 이해시킨다";
  }
}

function buildHighlightList(sections: PreparedTopicSection[], preferred: string[] = []): string[] {
  return dedupeStrings([
    ...preferred.map((value) => truncateText(normalizeText(value), 26)),
    ...sections.map((section) => buildHighlightFromSection(section)),
  ])
    .filter((item) => item.length >= 8)
    .slice(0, 3);
}

function buildMetaSummary(params: {
  rootTopic: string;
  type: TopicType;
  highlights: string[];
  sections: PreparedTopicSection[];
}): string {
  const firstSentenceByType: Record<TopicType, string> = {
    knowledge: `${params.rootTopic}에서 사람들이 실제로 막히는 장면과 이해가 빨라지는 비교 지점을 먼저 짚습니다.`,
    travel: `${params.rootTopic}에서 일정 만족도와 피로도가 갈리는 실제 선택 지점을 먼저 보여줍니다.`,
    golf: `${params.rootTopic}에서 라운드 흐름과 체감이 갈리는 순간을 먼저 붙잡아 정리합니다.`,
  };
  const secondSentenceByType: Record<TopicType, string> = {
    knowledge: "정의를 늘어놓기보다 어디서 감이 붙고 무엇부터 바꾸면 되는지 짧게 남깁니다.",
    travel: "후회가 줄어드는 기준과 현장에서 바로 체감되는 포인트만 짧게 남깁니다.",
    golf: "이론보다 바로 써먹을 수 있는 기준과 흔한 실수 지점만 짧게 남깁니다.",
  };

  return truncateText(
    `${firstSentenceByType[params.type]} ${secondSentenceByType[params.type]}`.trim(),
    180,
  );
}

function imageQueryNeedsCleanup(value: string): boolean {
  const query = normalizeText(value);
  if (!query) return true;
  if (query.length > 90) return true;
  if (countPatternHits(query, DULL_BODY_PATTERNS) > 0) return true;
  if (/먼저 풀어야|너무 .* 이유|기준으로 다시 본|지점에서 .* 갈리|글이 .* 읽힙니다/i.test(query)) return true;
  if (/방법를|장면를|문장를|흐름를/i.test(query)) return true;
  return false;
}

function pickLeadNarrativeSeed(params: {
  rootTopic: string;
  keywords: string[];
  selectedCandidate: TopicCraftCandidate;
}): string {
  const lead =
    sanitizeNarrativeSeed(params.selectedCandidate.subtopics?.[0]?.subtitle || "", params.rootTopic) ||
    sanitizeNarrativeSeed(splitCandidateContent(params.selectedCandidate.content || "")[0]?.heading || "", params.rootTopic) ||
    sanitizeNarrativeSeed(params.keywords[0] || "", params.rootTopic) ||
    normalizeText(params.rootTopic);
  return lead || normalizeText(params.rootTopic);
}

function cleanSectionBody(value: string): string {
  let body = typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
  if (!body) return "";

  body = body
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/요청 맥락 기반 확장/gi, "")
    .replace(/입력 키워드와 리서치 시그널을 바탕으로/gi, "")
    .replace(/실제 글 발행에 바로 쓸 수 있는 구조로 재구성했습니다\.?/gi, "")
    .replace(/핵심 내용입니다\.?/gi, "")
    .replace(/이번 글에서는/gi, "")
    .replace(/이 글은 [^.]*구성[^.]*\.?/gi, "")
    .replace(/도입에서는/gi, "처음에는")
    .replace(/마무리에서는/gi, "끝에서는")
    .replace(/이 구간은/gi, "여기서는")
    .replace(/장면를/g, "장면을")
    .replace(/방법를/g, "방법을")
    .replace(/문장를/g, "문장을")
    .replace(/흐름를/g, "흐름을")
    .replace(/([.!?])(?=["“'‘A-Za-z가-힣])/g, "$1 ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!body.includes("\n\n")) {
    const sentences = body
      .split(/(?<=[.!?])\s+|(?<=다\.)\s+/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    if (sentences.length >= 4) {
      const midpoint = Math.ceil(sentences.length / 2);
      body = [sentences.slice(0, midpoint).join(" "), sentences.slice(midpoint).join(" ")]
        .filter(Boolean)
        .join("\n\n");
    }
  }

  return body.trim();
}

function formatBodyForMobile(value: string): string {
  const cleaned = cleanSectionBody(value);
  if (!cleaned) return "";

  const sentences = cleaned
    .split(/(?<=[.!?])\s+|(?<=다\.)\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return cleaned;
  }

  const paragraphs: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    paragraphs.push(current.join(" ").trim());
    current = [];
  };

  for (const sentence of sentences) {
    const candidate = [...current, sentence].join(" ").trim();
    if (candidate.length > 84 || current.length >= 2) {
      flush();
    }
    current.push(sentence);
  }
  flush();

  return paragraphs.slice(0, 3).join("\n\n").trim();
}

function tightenSectionBody(value: string): string {
  const cleaned = formatBodyForMobile(value);
  if (!cleaned) return "";
  if (cleaned.length <= 300) return cleaned;

  const sentences = cleaned
    .split(/(?<=[.!?])\s+|(?<=다\.)\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= 4) {
    return truncateText(cleaned, 300);
  }

  const picked: string[] = [];
  let total = 0;
  for (const sentence of sentences) {
    const projected = total + sentence.length + (picked.length > 0 ? 1 : 0);
    if (projected > 280 && picked.length >= 3) break;
    picked.push(sentence);
    total = projected;
  }

  const midpoint = Math.ceil(picked.length / 2);
  return [picked.slice(0, midpoint).join(" "), picked.slice(midpoint).join(" ")]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractEnglishTokens(value: string): string[] {
  return Array.from(value.matchAll(/[a-z]{2,}/gi))
    .map((match) => match[0].toLowerCase())
    .filter((token, index, tokens) => tokens.indexOf(token) === index);
}

function buildStockFallbackKeywords(query: string): string {
  const normalized = normalizeText(query).toLowerCase();
  const englishTokens = extractEnglishTokens(normalized).filter(
    (token) => !["before", "after", "blog", "post", "content"].includes(token),
  );
  const preserved: string[] = [];

  if (/(ai|gpt|llm)/i.test(normalized)) preserved.push("ai");
  if (/(blog|블로그|글쓰기|writing|writer|content|콘텐츠)/i.test(normalized)) {
    preserved.push("blog", "writing", "content", "editorial");
  }
  if (/(개발|코드|api|software|saas|developer|coding)/i.test(normalized)) {
    preserved.push("developer", "software", "code");
  }
  if (/(업무|workflow|workspace|생산성|automation|자동화)/i.test(normalized)) {
    preserved.push("workflow", "workspace", "automation");
  }

  if (/(golf|골프|라운딩|티샷|스윙|퍼팅)/i.test(normalized)) {
    return dedupeStrings(["golf", "course", "swing", ...preserved, ...englishTokens])
      .slice(0, 5)
      .join(",");
  }

  if (/(travel|여행|숙소|공항|호텔|tour|trip|flight|city)/i.test(normalized)) {
    return dedupeStrings(["travel", "city", "landscape", "hotel", ...preserved, ...englishTokens])
      .slice(0, 5)
      .join(",");
  }

  if (/(health|운동|관절|스트레칭|fitness|workout|wellness)/i.test(normalized)) {
    return dedupeStrings(["fitness", "exercise", "wellness", ...preserved, ...englishTokens])
      .slice(0, 5)
      .join(",");
  }

  if (/(ai|gpt|llm|자동화|콘텐츠|글쓰기|블로그|개발|it|기술|software)/i.test(normalized)) {
    return dedupeStrings([
      ...preserved,
      "technology",
      "editorial",
      "writing",
      "workspace",
      ...englishTokens,
    ])
      .slice(0, 6)
      .join(",");
  }

  if (englishTokens.length > 0) {
    return dedupeStrings([...preserved, ...englishTokens]).slice(0, 6).join(",");
  }

  return dedupeStrings([...preserved, "editorial", "writing", "workspace", "technology"]).join(",");
}

function buildSeedSlug(value: string): string {
  const seed = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return seed || "editorial-workspace";
}

function buildDeterministicSectionBody(params: {
  type: TopicType;
  rootTopic: string;
  sectionHeading: string;
  leadSeed: string;
  keyword: string;
  kind: SectionKind;
  selectedReason: string;
  sourceExcerpt: string;
  index: number;
}): string {
  const derivedKeyword = deriveNarrativeKeyword(
    params.rootTopic,
    params.sectionHeading,
    normalizeText(params.keyword) || normalizeText(params.leadSeed) || normalizeText(params.rootTopic),
  );
  const keyword = compactTemplateKeyword(
    params.rootTopic,
    derivedKeyword,
    params.sectionHeading,
    params.kind,
  );
  const narrativeSeed = textLooksBroken(params.leadSeed)
    ? keyword
    : compactTemplateKeyword(
        params.rootTopic,
        deriveNarrativeKeyword(params.rootTopic, params.leadSeed, keyword),
        params.leadSeed,
        params.kind,
      );
  const sourceExcerpt = normalizeText(params.sourceExcerpt);
  const sourceLine = sourceExcerpt
    ? /[가-힣]/.test(sourceExcerpt)
      ? `참고 자료를 보면 "${truncateText(sourceExcerpt, 90)}" 같은 장면이 반복됩니다. 이런 근거는 길게 풀기보다 핵심 판단과 붙일 때 더 강합니다.`
      : ""
    : "";

  const paragraphsByKind: Record<SectionKind, Record<TopicType, string[]>> = {
    hook: {
      knowledge: [
        `${params.rootTopic}는 개념부터 길게 풀면 멀어지기 쉽습니다. 사람들이 실제로 ${keyword}에서 갈리고 망설이는 순간을 먼저 보여줘야 이 주제가 왜 중요한지 바로 들어옵니다.`,
        sourceLine || `${narrativeSeed}처럼 체감이 붙는 장면을 앞에 두면, 읽는 사람도 "내 경우엔 어디서 갈리나"를 훨씬 빨리 떠올리게 됩니다.`,
      ],
      travel: [
        `${params.rootTopic}는 관광지 이름을 많이 넣는다고 살아나지 않습니다. 독자가 계속 읽는 순간은 ${keyword} 때문에 하루 리듬이 어떻게 바뀌는지 보일 때입니다.`,
        sourceLine || `${narrativeSeed}처럼 현장에서 표정이 바뀌는 장면을 먼저 열어두면 여행 글은 훨씬 사람 냄새가 납니다.`,
      ],
      golf: [
        `${params.rootTopic}는 자세 설명보다 ${keyword}가 흔들릴 때 어떤 샷이 바로 무너지는지가 먼저 보여야 읽힙니다. 그래서 첫 문단은 원론보다 실전에서 티 나는 순간으로 여는 편이 훨씬 낫습니다.`,
        sourceLine || `${narrativeSeed}처럼 몸이 급해지는 장면을 먼저 꺼내면 읽는 사람도 자기 스윙을 바로 떠올립니다.`,
      ],
    },
    scene: {
      knowledge: [
        `${params.rootTopic}를 이해하는 데 도움이 되는 건 정의보다 상황입니다. ${withSubjectParticle(keyword)} 실제 선택, 대화, 화면, 판단에서 어떻게 보이는지 보여줘야 추상어가 아니라 현실 문제처럼 읽힙니다.`,
        `${narrativeSeed}를 사례처럼 붙이면 이 주제는 설명보다 체감으로 먼저 들어오고, 어디서 차이가 나는지도 훨씬 또렷해집니다.`,
      ],
      travel: [
        `${params.rootTopic}에서 ${keyword}는 따로 노는 정보가 아닙니다. 이동 시간, 체력, 식사 타이밍이 한꺼번에 엮이는 장면으로 보여줘야 여행 글이 실제처럼 읽힙니다.`,
        `막상 가보면 작은 선택 하나가 하루 분위기를 바꾸는 경우가 많습니다. 그 체감이 살아야 정보도 믿기 시작합니다.`,
      ],
      golf: [
        `${params.rootTopic}는 결국 몸의 반응으로 기억됩니다. ${keyword}를 잘 잡았을 때와 급하게 지나쳤을 때 리듬이 어떻게 달라지는지 보여줘야 글이 교본처럼 느껴지지 않습니다.`,
        `"나도 저때 저랬다" 싶은 장면이 들어가면 설명보다 체감이 먼저 옵니다.`,
      ],
    },
    mistake: {
      knowledge: [
        `많이 하는 실수는 ${params.rootTopic}를 설명 위주로만 정리하는 것입니다. 그런데 읽는 사람이 궁금한 건 용어 자체보다 ${keyword}를 잘못 잡았을 때 어디서 일이 꼬이고 판단이 늦어지는지입니다.`,
        `개념을 더 붙이는 쪽보다, 흔한 오해와 실제 실패 장면을 먼저 짚는 편이 이해도도 빠르고 기억에도 오래 남습니다.`,
      ],
      travel: [
        `여행 글이 재미없어지는 가장 흔한 이유는 동선, 체력, 예산을 각각 따로 설명하는 것입니다. 실제 현장에서는 세 가지가 동시에 움직이기 때문에 ${keyword}를 따로 떼어 말하면 금방 감이 끊깁니다.`,
        `무엇을 아끼려다 하루가 꼬이는지, 어디서 무리하면 다음 일정까지 피곤해지는지를 보여줘야 독자가 자기 여행에 바로 대입할 수 있습니다.`,
      ],
      golf: [
        `흔한 실수는 ${params.keyword}를 힘이나 의지의 문제로만 보는 것입니다. 하지만 골프는 작은 루틴 하나가 흐름을 지배할 때가 많아서, 무엇을 더 하느냐보다 무엇을 빼야 하는지가 더 중요할 때가 많습니다.`,
        `무작정 강하게 가는 조언보다 어느 타이밍에 멈추고 어떻게 리듬을 되찾는지가 훨씬 실전에 가깝습니다.`,
      ],
    },
    comparison: {
      knowledge: [
        `같은 주제라도 감이 바로 오는 설명은 상황과 비교가 붙어 있고, 안 와닿는 설명은 개념만 남습니다. ${withSubjectParticle(keyword)} 있을 때와 빠졌을 때 무엇이 달라지는지 나란히 보여줘야 차이가 한 번에 보입니다.`,
        `잘된 경우와 꼬인 경우를 붙여두면 읽는 사람도 자기 상황을 바로 대입할 수 있고, 어디를 먼저 바꿔야 하는지도 훨씬 선명해집니다.`,
      ],
      travel: [
        `잘 읽히는 여행 글은 추천 목록보다 비교가 먼저 나옵니다. 같은 코스라도 늦게 출발한 날과 일찍 움직인 날이 어떻게 다르게 흐르는지, 돈을 조금 더 썼을 때 어떤 피로를 줄일 수 있는지를 보여줘야 실제 도움이 됩니다.`,
        `${narrativeSeed}도 좋다, 편하다로 끝내지 말고 누구에게 맞고 어떤 상황에서는 오히려 아쉬운지까지 붙여야 글의 밀도가 올라갑니다.`,
      ],
      golf: [
        `잘 읽히는 골프 글은 스윙 이론보다 전후 비교가 선명합니다. 준비를 건너뛴 샷과 루틴을 넣은 샷이 어떻게 다른지, 몸이 덜 풀린 상태와 리듬이 잡힌 상태가 어떤 결과 차이를 만드는지를 보여줘야 합니다.`,
        `${narrativeSeed}를 중심에 둘 때도 "왜 먼저 무너지는지"와 "어디를 바꾸면 바로 체감되는지"를 같이 대비해주는 편이 훨씬 설득력이 있습니다.`,
      ],
    },
    proof: {
      knowledge: [
        sourceLine || `${params.rootTopic}는 추상어만으로 밀어붙이면 금방 힘이 빠집니다. 그래서 실제 사례나 소스의 한 문장을 끌어와 "이 지점이 왜 반복되는가"를 짚어주는 순간 글이 훨씬 단단해집니다.`,
        `근거를 길게 늘어놓기보다, 그 근거가 판단과 선택을 어떻게 바꾸는지 짧게 연결해주는 편이 훨씬 믿을 만하게 읽힙니다.`,
      ],
      travel: [
        sourceLine || `후기와 실제 동선 기록을 보면 사람들이 반복해서 후회하는 지점은 꽤 비슷합니다. ${keyword}를 근거와 함께 보여주면 여행 글이 감상문이 아니라 실제 팁으로 읽힙니다.`,
        `자료를 한 줄 인용하더라도 "그래서 나는 무엇을 먼저 바꿔야 하는가"로 연결해줘야 글이 더 믿을 만해집니다.`,
      ],
      golf: [
        sourceLine || `라운드 후기를 모아보면 무너지는 순간은 생각보다 비슷합니다. ${keyword}를 데이터나 사례와 같이 붙이면 감각적인 조언도 훨씬 설득력 있게 읽힙니다.`,
        `근거는 많을수록 좋은 게 아니라, 한 가지라도 오늘 플레이에 바로 연결될 때 가장 강합니다.`,
      ],
    },
    takeaway: {
      knowledge: [
        `끝에서는 결론을 길게 끌기보다 선택 기준이 남는 편이 낫습니다. ${withObjectParticle(keyword)} 실제 상황에 놓았을 때 어떤 판단이 달라지는지, 중간에 오해와 비교가 살아 있는지부터 보면 됩니다.`,
        `${params.rootTopic}는 정보량보다 체감이 중요합니다. 읽는 사람이 "그래서 내 경우엔 어떻게 보면 되지?"를 바로 떠올릴 수 있게 정리하는 쪽이 훨씬 오래 남습니다.`,
      ],
      travel: [
        `마지막에는 멋진 결론보다 선택 기준이 남아야 합니다. 일정이 빡빡한 사람인지, 걷는 시간이 긴 여행인지, 예산보다 체력 안배가 중요한지에 따라 ${keyword}의 답은 달라집니다.`,
        `${params.rootTopic} 글은 체크리스트보다 "누가 어떤 선택을 하면 덜 후회하는지"를 남길 때 끝맛이 훨씬 좋습니다.`,
      ],
      golf: [
        `끝에서는 한 번에 다 바꾸라는 말보다 오늘 라운드 전에 바로 확인할 기준 하나만 남기면 충분합니다. 몸이 굳은 아침인지, 정확도가 중요한 날인지, 피로가 누적된 상태인지에 따라 ${keyword}의 우선순위는 달라집니다.`,
        `${params.rootTopic}는 정보량보다 체감이 중요합니다. 읽고 나서 당장 하나라도 바꿔보고 싶게 만드는 쪽이 좋은 마무리입니다.`,
      ],
    },
  };

  const selected =
    paragraphsByKind[params.kind]?.[params.type] ||
    paragraphsByKind.scene.knowledge;

  return formatBodyForMobile(selected.filter(Boolean).join("\n\n"));
}

function finalizePolishedContent(
  content: PreparedTopicContent,
  params: {
    rootTopic: string;
    keywords: string[];
    selectedCandidate: TopicCraftCandidate;
    selectedReason: string;
    type: TopicType;
    style: string | null;
    sourceSummaries: TopicSourceSummary[];
  },
): PreparedTopicContent {
  const fallback = buildFallbackPolishedContent(params);
  const writingTopic = isWritingFocusedTopic(params.rootTopic, params.keywords);
  const incomingSections = Array.isArray(content.sections) ? content.sections : [];
  const desiredCount = 4;
  const leadSeed = pickLeadNarrativeSeed(params);
  const cleanedTitle = normalizeText(content.title);
  const title =
    titleNeedsCleanup(cleanedTitle, params.rootTopic)
      ? buildPlayfulTitle(params.rootTopic, leadSeed, 0, params.type)
      : cleanedTitle;

  const sections: PreparedTopicSection[] = [];
  const usedHeadings = new Set<string>();
  for (let index = 0; index < desiredCount; index += 1) {
    const candidateSection = incomingSections[index];
    const fallbackSection = fallback.sections[index];
    if (!fallbackSection) continue;

    const heading = isGenericHeading(candidateSection?.heading || "") || textLooksBroken(candidateSection?.heading || "")
      ? fallbackSection.heading
      : normalizeText(candidateSection?.heading);
    const inferredKind = candidateSection
      ? inferCandidateSectionKind(candidateSection, index, desiredCount, params.type)
      : fallbackSection.kind;
    const kind = normalizeSectionKind(
      candidateSection?.kind || inferredKind || fallbackSection.kind,
      index,
      desiredCount,
      params.type,
    );
    const finalHeading =
      heading === title || heading.length > 42 || heading.length < 5
        ? buildSectionHeadingByType(params.type, params.rootTopic, index, kind)
        : heading;
    const finalHeadingKey = normalizeText(finalHeading).toLowerCase();
    const dedupedHeading =
      !finalHeadingKey || usedHeadings.has(finalHeadingKey)
        ? buildSectionHeadingByType(params.type, params.rootTopic, index, kind)
        : finalHeading;
    usedHeadings.add(normalizeText(dedupedHeading).toLowerCase());
    const cleanedBody = tightenSectionBody(candidateSection?.body || "");
    const body = bodyNeedsFallback(cleanedBody) ||
      sectionBodyLooksBrokenForPublication(cleanedBody, {
        rootTopic: params.rootTopic,
        writingTopic,
      })
      ? formatBodyForMobile(fallbackSection.body)
      : formatBodyForMobile(cleanedBody);
    const keyword = compactTemplateKeyword(
      params.rootTopic,
      normalizeText(params.keywords[index] || params.keywords[0] || dedupedHeading || params.rootTopic),
      dedupedHeading,
      kind,
    );
    const sourceRefIds =
      Array.isArray(candidateSection?.sourceRefIds) && candidateSection.sourceRefIds.length > 0
        ? candidateSection.sourceRefIds
        : fallbackSection.sourceRefIds;
    const ensuredSourceRefIds =
      kind === "proof" && sourceRefIds.length === 0 && params.sourceSummaries.length > 0
        ? [String(Math.min(index + 1, params.sourceSummaries.length))]
        : sourceRefIds;

    sections.push({
      heading: dedupedHeading,
      body,
      kind,
      summary: buildSectionSummary({
        type: params.type,
        kind,
        keyword,
        fallback: dedupedHeading,
      }),
      bullets:
        kind === "comparison" || kind === "proof" || kind === "takeaway"
          ? buildSectionBullets({ type: params.type, kind, keyword }).slice(0, 2)
          : [],
      stockQuery: normalizeText(candidateSection?.stockQuery) || fallbackSection.stockQuery,
      sourceRefIds: ensuredSourceRefIds,
      imageSlotId:
        normalizeText(candidateSection?.imageSlotId) ||
        normalizeText(fallbackSection.imageSlotId) ||
        buildSectionImageSlotId(index),
    });
  }

  const hashtags = dedupeStrings([
    ...(content.hashtags || []).map(stripHashtagPrefix),
    ...fallback.hashtags.map(stripHashtagPrefix),
  ]).slice(0, 8);
  const lead = normalizeText(content.lead) || normalizeText(fallback.lead);
  const highlights = buildHighlightList(sections, [...(content.highlights || []), ...(fallback.highlights || [])]);
  const summary = normalizeText(content.meta?.summary);
  const safeMetaSummary = buildMetaSummary({
    rootTopic: params.rootTopic,
    type: params.type,
    highlights,
    sections,
  });

  return {
    title,
    lead,
    highlights,
    sections,
    hashtags,
    meta: {
      summary:
        !writingTopic || summaryNeedsCleanup(summary) || containsNonWritingMetaBody(summary)
          ? safeMetaSummary
          : summary,
      tone: normalizeText(content.meta?.tone) || params.style || fallback.meta.tone,
      selectedReason: normalizeText(content.meta?.selectedReason) || params.selectedReason,
    },
  };
}

function inferTopicTypeFromText(text: string): TopicType {
  const lower = normalizeText(text).toLowerCase();
  if (/(골프|라운드|티샷|퍼팅|스윙|페어웨이|그린|캐디|골프투어)/i.test(lower)) return "golf";
  if (/(여행|투어|숙소|호텔|온천|공항|비행|도시|맛집|관광|일정|동선)/i.test(lower)) return "travel";
  return "knowledge";
}

function mapTaskTypeToTopicType(
  value: string | null,
  options?: {
    topic?: string | null;
    keywords?: string | null;
    memo?: string | null;
    topicCraftCategory?: string | null;
  },
): TopicType {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "travel" || normalized === "여행") return "travel";
  if (normalized === "golf" || normalized === "골프") return "golf";
  const category = normalizeText(options?.topicCraftCategory);
  if (category === "여행 / 문화") return "travel";
  if (category === "건강 / 운동") {
    const combined = [options?.topic || "", options?.keywords || "", options?.memo || ""].join(" ");
    if (/(골프|라운드|티샷|퍼팅|스윙|골프투어)/i.test(combined)) return "golf";
  }
  return inferTopicTypeFromText([options?.topic || "", options?.keywords || "", options?.memo || ""].join(" "));
}

function normalizeTopicCraftCategory(value: string | null | undefined, topicType: TopicType, text: string) {
  const trimmed = normalizeText(value);
  if (
    trimmed &&
    TOPIC_CRAFT_CATEGORIES.includes(trimmed as TopicCraftCategory)
  ) {
    return trimmed as TopicCraftCategory;
  }

  const lower = text.toLowerCase();
  if (topicType === "travel") return "여행 / 문화";
  if (topicType === "golf") return "건강 / 운동";
  if (/(ai|llm|자동화|머신러닝|미래기술)/.test(lower)) return "AI / 미래기술";
  if (/(개발|코딩|api|saas|앱|프로그램|it|기술)/.test(lower)) return "기술 / IT";
  if (/(마케팅|브랜드|광고|콘텐츠|트렌드)/.test(lower)) return "마케팅 / 트렌드";
  if (/(돈|재테크|경제|투자|비즈니스)/.test(lower)) return "비즈니스 / 경제";
  if (/(레시피|맛집|요리|카페|음식)/.test(lower)) return "음식 / 요리";
  if (/(운동|헬스|다이어트|건강)/.test(lower)) return "건강 / 운동";
  return "교육 / 자기계발";
}

function extractSourceUrlsFromTask(task: { memo: string | null; keywords: string | null }): string[] {
  return parseSourceUrls([task.memo || "", task.keywords || ""].join("\n"));
}

function dedupeResearchSignals(signals: TopicResearchSignal[]): TopicResearchSignal[] {
  const seen = new Set<string>();
  const output: TopicResearchSignal[] = [];

  for (const signal of signals) {
    const keyword = normalizeText(signal.keyword);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ ...signal, keyword });
  }

  return output.sort((left, right) => right.score - left.score);
}

function buildSourceDerivedSignals(sourceSummaries: TopicSourceSummary[], rootTopic: string): TopicResearchSignal[] {
  const rootTokens = new Set(
    normalizeText(rootTopic)
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
  const candidates = sourceSummaries.flatMap((summary) => [
    summary.title || "",
    summary.summary || "",
    summary.snippet || "",
  ]);
  const phrases = candidates
    .flatMap((value) =>
      sanitizeEvidenceText(value)
        .split(/[,.!?·|/()\[\]{}]+|\s{2,}/)
        .map((part) => normalizeText(part))
        .filter((part) => part.length >= 3 && part.length <= 28),
    )
    .filter((part) => {
      const lowered = part.toLowerCase();
      if (/^(요약 실패|요약할 수 없습니다|주제)$/i.test(part)) return false;
      if (/https?:\/\//i.test(part)) return false;
      return !rootTokens.has(lowered);
    });

  return dedupeStrings(phrases)
    .slice(0, 6)
    .map((keyword, index) => ({
      keyword,
      source: "trend",
      score: 76 - index * 3,
    }));
}

function sanitizeSourceSummaries(sourceSummaries: TopicSourceSummary[]): TopicSourceSummary[] {
  return sourceSummaries.map((summary) => {
    const title = isUsableSourceEvidence(summary.title || "") ? sanitizeEvidenceText(summary.title || "") : "";
    const body = isUsableSourceEvidence(summary.summary || "") ? sanitizeEvidenceText(summary.summary || "") : "";
    const snippet = isUsableSourceEvidence(summary.snippet || "") ? sanitizeEvidenceText(summary.snippet || "") : "";

    return {
      ...summary,
      title: title || undefined,
      summary: body || undefined,
      snippet: snippet || undefined,
    };
  });
}

function buildTopicCraftKeyword(
  topic: string,
  keywords: string[],
  narrativeBriefs: NarrativeAngleBrief[] = [],
): string {
  const narrativeKeywords = narrativeBriefs.flatMap((brief) => [
    brief.headline,
    brief.readerPromise,
    ...brief.sectionPlan.map((section) => section.subtitle || ""),
  ]);
  const cleanKeywords = dedupeStrings(
    [topic.trim(), ...keywords, ...narrativeKeywords]
      .map((keyword) => sanitizeNarrativeSeed(keyword, topic))
      .filter(
        (keyword) =>
          keyword.length > 1 &&
          !/^https?:\/\//i.test(keyword) &&
          !/^(source|url|link|출처)$/i.test(keyword),
      ),
  );
  return cleanKeywords.slice(0, 10).join(", ");
}

function extractJsonBlocks(raw: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) {
        blocks.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return blocks;
}

function parseJsonObject<T>(raw: string): T | null {
  const blocks = extractJsonBlocks(raw);
  for (const block of blocks.length > 0 ? blocks : [raw]) {
    try {
      return JSON.parse(block) as T;
    } catch {
      continue;
    }
  }
  return null;
}

function splitCandidateContent(content: string): PreparedTopicSection[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const sections: PreparedTopicSection[] = [];
  let currentHeading = "";
  let currentBody: string[] = [];

  const flush = () => {
    const body = currentBody
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!currentHeading && !body) return;
    sections.push({
      heading: currentHeading,
      body,
      stockQuery: null,
      sourceRefIds: [],
    });
    currentHeading = "";
    currentBody = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      currentBody.push("");
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      flush();
      currentHeading = line.replace(/^#{1,3}\s+/, "").trim();
      continue;
    }

    if (/^\d+\.\s+/.test(line) && currentBody.length > 0 && currentHeading) {
      flush();
    }

    currentBody.push(line.replace(/^[-*]\s+/, ""));
  }

  flush();

  if (sections.length === 0) {
    return normalized
      .split(/\n{2,}/)
      .map((chunk, index) => ({
        heading: index === 0 ? "핵심 정리" : "",
        body: chunk.trim(),
        stockQuery: null,
        sourceRefIds: [],
      }))
      .filter((section) => section.body.length > 0);
  }

  return sections.filter((section) => section.heading.length > 0 || section.body.length > 0);
}

function inferCandidateSectionKind(
  section: PreparedTopicSection,
  index: number,
  sectionCount: number,
  topicType: TopicType,
): SectionKind {
  const haystack = `${normalizeText(section.heading)} ${normalizeText(section.body)}`.toLowerCase();
  if (index === 0 && /(왜|갑자기|처음|첫|먼저|시작)/i.test(haystack)) return "hook";
  if (/(실수|착각|오해|무리|대충|과하게|놓치|잘못)/i.test(haystack)) return "mistake";
  if (/(비교|차이|전후|vs|갈리|대비|둘|다르게)/i.test(haystack)) return "comparison";
  if (/(사례|자료|후기|근거|데이터|반복|캡처|리포트)/i.test(haystack)) return "proof";
  if (index === sectionCount - 1 || /(마지막|기준|정리|지금 바로|오늘 바로|체크)/i.test(haystack)) {
    return "takeaway";
  }
  if (/(장면|순간|현장|표정|몸|리듬|분위기|하루)/i.test(haystack)) return "scene";
  return normalizeSectionKind(section.kind, index, sectionCount, topicType);
}

function scoreTopicCandidate(
  candidate: TopicCraftCandidate,
  rootTopic: string,
  topicType: TopicType,
  keywords: string[],
  sourceSummaries: TopicSourceSummary[],
): ScoredTopicCandidate {
  const title = normalizeText(candidate.title);
  const content = normalizeText(candidate.content);
  const normalizedSections = splitCandidateContent(candidate.content || "");
  const sectionCount = normalizedSections.length;
  const bodyLength = content.length;
  const normalizedTopic = rootTopic.toLowerCase();
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const bodyLower = `${title}\n${content}`.toLowerCase();
  const coveredKeywords = normalizedKeywords.filter((keyword) => keyword && bodyLower.includes(keyword));
  const keywordCoverage = normalizedKeywords.length > 0 ? coveredKeywords.length / normalizedKeywords.length : 1;
  const lines = content
    .split(/[.!?\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 14);
  const uniqueLines = new Set(lines.map((line) => line.toLowerCase()));
  const repeatedLineRatio = lines.length > 0 ? 1 - uniqueLines.size / lines.length : 0;
  const specificHeadingCount = normalizedSections.filter((section) => {
    const heading = normalizeText(section.heading);
    return heading.length >= 6 && !GENERIC_HEADING_PATTERNS.some((pattern) => pattern.test(heading));
  }).length;
  const genericTitlePenalty = countPatternHits(title, GENERIC_TITLE_PATTERNS);
  const dullBodyPenalty = countPatternHits(content, DULL_BODY_PATTERNS);
  const firstHeading = normalizeText(normalizedSections[0]?.heading);
  const questionOrContrastBonus = countPatternHits(`${title}\n${firstHeading}`, ENGAGING_ANGLE_PATTERNS);
  const inferredKinds = normalizedSections.map((section, index) =>
    inferCandidateSectionKind(section, index, Math.max(1, sectionCount), topicType),
  );
  const kindVariety = new Set(inferredKinds).size;
  const narrativeArcBonus =
    (inferredKinds[0] === "hook" ? 4 : 0) +
    (inferredKinds.some((kind) => kind === "comparison") ? 4 : 0) +
    (inferredKinds[inferredKinds.length - 1] === "takeaway" ? 4 : 0) +
    (inferredKinds.some((kind) => kind === "scene" || kind === "proof") ? 3 : 0);
  const averageSectionLength =
    sectionCount > 0
      ? Math.round(
          normalizedSections.reduce((total, section) => total + normalizeText(section.body).length, 0) / sectionCount,
        )
      : bodyLength;
  const lengthWindowScore =
    bodyLength < 500
      ? 4
      : bodyLength <= 1600
        ? 18
        : bodyLength <= 2200
          ? 11
          : 4;
  const sectionShapeScore =
    sectionCount === 4 ? 22 : sectionCount === 5 ? 6 : sectionCount === 3 ? 7 : sectionCount === 6 ? 2 : 0;
  const conciseSectionBonus =
    averageSectionLength >= 130 && averageSectionLength <= 250
      ? 10
      : averageSectionLength <= 380
        ? 4
        : 0;
  const narrativeMetadataBonus = Math.min(
    12,
    (candidate.subtopics?.filter((section) => normalizeText(section.role || "")).length || 0) * 2 +
      (candidate.subtopics?.filter(
        (section) => normalizeText(section.readerPromise || section.whyNow || section.imageCue || ""),
      ).length || 0),
  );
  const evidenceDrivenBonus = Math.min(
    8,
    (candidate.requiredEvidence?.filter((value) => isUsableSourceEvidence(value)).length || 0) * 4,
  );
  const mobileCadencePenalty =
    averageSectionLength > 290 ? Math.min(14, Math.round((averageSectionLength - 290) / 22)) : 0;
  const topicRepeatPenalty = Math.max(0, countTopicMentions(`${title}\n${content}`, rootTopic) - 3);
  const brokenKoreanPenalty =
    (textLooksBroken(title) ? 16 : 0) +
    normalizedSections.reduce(
      (total, section) =>
        total +
        (textLooksBroken(section.heading) ? 12 : 0) +
        (textLooksBroken(section.body) ? 16 : 0) +
        (/https?:\/\//i.test(`${section.heading} ${section.body}`) ? 14 : 0),
      0,
    );
  const writingMetaPenalty =
    !isWritingFocusedTopic(rootTopic, keywords)
      ? countPatternHits(
          `${title}\n${content}`,
          [/글/i, /문장/i, /읽히/i, /심심하/i, /사람 말/i, /사람 냄새/i],
        ) * 10
      : 0;
  const blandnessPenalty =
    genericTitlePenalty * 10 +
    dullBodyPenalty * 8 +
    topicRepeatPenalty * 3 +
    brokenKoreanPenalty +
    writingMetaPenalty;

  let score = 0;
  if (title.toLowerCase().includes(normalizedTopic)) score += 14;
  score += lengthWindowScore;
  score += sectionShapeScore;
  score += Math.round(keywordCoverage * 18);
  score += Math.min(12, specificHeadingCount * 3);
  score += Math.min(16, questionOrContrastBonus * 4);
  score += Math.min(10, Math.max(0, kindVariety - 2) * 4);
  score += narrativeArcBonus;
  score += conciseSectionBonus;
  score += narrativeMetadataBonus;
  score += evidenceDrivenBonus;
  score -= Math.min(16, Math.round(repeatedLineRatio * 28));
  score -= mobileCadencePenalty;
  score -= blandnessPenalty;
  score += sourceSummaries.length > 0 ? 5 : 0;

  return {
    index: 0,
    candidate,
    score,
    sectionCount,
    bodyLength,
    averageSectionLength,
    repeatedLineRatio,
    keywordCoverage,
    hookScore: Math.min(4, questionOrContrastBonus),
    blandnessPenalty,
    mobileCadencePenalty,
    inferredKinds,
    normalizedSections,
    preview: normalizedSections.slice(0, 3).map((section) => section.heading || section.body.slice(0, 64)),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} 타임아웃 (${timeoutMs}ms)`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,#,]/)
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }
  return [];
}

function normalizeTopicCraftSubtopics(value: unknown): TopicCraftSubtopic[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): TopicCraftSubtopic | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const subtitle = normalizeText(record.subtitle ?? record.title ?? record.heading ?? record.name);
      const summary = normalizeText(record.summary ?? record.body ?? record.content ?? record.description);
      const role = normalizeSectionKind(record.role, 0, 4, "knowledge");
      const readerPromise = normalizeText(record.readerPromise);
      const imageCue = normalizeText(record.imageCue);
      const whyNow = normalizeText(record.whyNow);
      if (!subtitle && !summary) return null;
      return { subtitle, summary, role, readerPromise, imageCue, whyNow };
    })
    .filter((item): item is TopicCraftSubtopic => item !== null);
}

function normalizeTopicCraftContent(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const record = entry as Record<string, unknown>;
      const heading = normalizeText(record.heading ?? record.sectionTitle ?? record.title ?? record.name);
      const body = normalizeText(record.body ?? record.content ?? record.text ?? record.summary ?? record.description);
      return [heading ? `## ${heading}` : "", body].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function normalizeTopicCraftCandidate(raw: unknown): TopicCraftCandidate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const title = normalizeText(
    record.title ?? record.headline ?? record.name ?? record.subject ?? record.topic,
  );
  const content = normalizeTopicCraftContent(
    record.content ?? record.body ?? record.text ?? record.article ?? record.markdown ?? record.sections,
  );
  const subtopics = normalizeTopicCraftSubtopics(record.subtopics ?? record.sections ?? record.outline);
  const hashtags = normalizeStringArray(record.hashtags ?? record.tags);
  const image_prompt = normalizeText(
    record.image_prompt ?? record.imagePrompt ?? record.imageQuery ?? record.prompt,
  );

  if (!title || !content) {
    return null;
  }

  return {
    title,
    content,
    hashtags,
    subtopics,
    image_prompt,
  };
}

function extractTopicCraftError(payload: TopicCraftResponse): string | null {
  const direct = normalizeText(payload.error) || normalizeText(payload.message);
  if (direct) return direct;

  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    const record = payload.data as Record<string, unknown>;
    return normalizeText(record.error) || normalizeText(record.message) || null;
  }

  return null;
}

function extractTopicCraftCandidates(payload: TopicCraftResponse): TopicCraftCandidate[] {
  const pools: unknown[] = [];
  pools.push(payload.topics, payload.results, payload.candidates);

  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    const record = payload.data as Record<string, unknown>;
    pools.push(record.topics, record.results, record.candidates);
  }

  const merged = pools.flatMap((pool) => (Array.isArray(pool) ? pool : []));
  return merged
    .map((item) => normalizeTopicCraftCandidate(item))
    .filter((item): item is TopicCraftCandidate => item !== null);
}

function buildFallbackCandidatePlans(
  rootTopic: string,
  topicType: TopicType,
  keywords: string[],
  trendSignals: TopicResearchSignal[],
) {
  const planned = TOPIC_EXPERIMENTAL_SUBTOPIC_PLANNER
    ? planSubtopics(rootTopic, topicType, trendSignals, 5)
    : [];
  const plannedLooksUsable =
    planned.length > 0 &&
    planned.slice(0, 4).every((entry) => {
      const subtopic = normalizeText(entry.subtopic);
      const reason = normalizeText(entry.reason);
      if (!subtopic || !reason) return false;
      if (/문장가|장면가|장면이 살아 있은|차가$|건\s+[를을이가은는]|처음엔 별거|딱딱해지|밋밋해지/u.test(subtopic)) {
        return false;
      }
      if (/문장가|장면는|장면이 살아 있은|읽은 사람|독자 바로|차가$/u.test(reason)) {
        return false;
      }
      return true;
    });
  if (plannedLooksUsable) {
    return planned.slice(0, 5);
  }

  const fallbackSeeds =
    keywords.length > 0
      ? keywords
      : topicType === "travel"
        ? [rootTopic, "첫날 분위기", "동선", "후회 포인트", "선택 기준", "체력"]
        : topicType === "golf"
          ? [rootTopic, "첫홀 감각", "루틴", "실수", "비교", "컨디션"]
          : [rootTopic, "첫 문장", "장면", "오해", "비교", "선택 기준"];

  const fallbackRoles: Record<TopicType, TopicSubtopicRole[]> = {
    knowledge: ["hook", "scene", "mistake", "comparison", "takeaway"],
    travel: ["hook", "scene", "comparison", "proof", "takeaway"],
    golf: ["hook", "scene", "mistake", "comparison", "takeaway"],
  };
  const roleOrder = fallbackRoles[topicType] || fallbackRoles.knowledge;

  const buildReason = (keyword: string) => {
    if (topicType === "travel") {
      return `${rootTopic}에서는 ${keyword}에서 만족도와 후회가 크게 갈립니다. 이 장면을 먼저 열어야 글이 관광지 나열로 흐르지 않습니다.`;
    }
    if (topicType === "golf") {
      return `${rootTopic}를 다룰 때 ${keyword}가 흔들리면 실전 체감이 바로 달라집니다. 그래서 이 장면을 먼저 짚는 편이 훨씬 와닿습니다.`;
    }
    return `${rootTopic}에서는 ${keyword}에서 실제 판단과 체감이 갈립니다. 이 장면을 먼저 보여줘야 개념 설명보다 상황이 먼저 들어옵니다.`;
  };

  return fallbackSeeds.slice(0, 5).map((keyword, index) => ({
    index,
    subtopic: `${rootTopic} ${keyword}`.trim(),
    reason: buildReason(keyword),
    priority: index + 1,
    confidence: 0.62,
    role: roleOrder[index] || "comparison",
    readerPromise:
      topicType === "travel"
        ? `${keyword}에서 무엇을 먼저 정해야 덜 후회하는지 감이 온다`
        : topicType === "golf"
          ? `${keyword}에서 어떤 루틴이 실제로 도움이 되는지 바로 떠오른다`
          : `${withSubjectParticle(keyword)} 실제로 어디서 갈리는지 바로 감이 온다`,
    imageCue:
      topicType === "knowledge"
        ? `${withSubjectParticle(keyword)} 드러나는 자연스러운 실제 상황`
        : `${withSubjectParticle(keyword)} 체감되는 자연스러운 현장 장면`,
    whyNow:
      topicType === "travel"
        ? `${keyword}는 여행 하루 만족도가 확 갈리는 포인트라 먼저 볼 가치가 큽니다.`
        : topicType === "golf"
          ? `${keyword}는 라운드 들어가면 바로 결과가 보여서 미리 볼 가치가 큽니다.`
          : `${keyword}는 선택과 결과 차이를 빠르게 체감시키는 포인트라 지금 봐둘 가치가 큽니다.`,
  }));
}

function buildNarrativeAngleBriefs(params: {
  rootTopic: string;
  topicType: TopicType;
  keywords: string[];
  sourceSummaries: TopicSourceSummary[];
  trendSignals: TopicResearchSignal[];
}): NarrativeAngleBrief[] {
  const plans = buildFallbackCandidatePlans(
    params.rootTopic,
    params.topicType,
    params.keywords,
    params.trendSignals,
  );
  const roleGroups: Array<Array<TopicSubtopicRole>> = [
    ["hook", "scene", "comparison", "takeaway"],
    ["hook", "mistake", "comparison", "takeaway"],
    params.sourceSummaries.length > 0
      ? ["hook", "scene", "proof", "takeaway"]
      : ["hook", "scene", "comparison", "takeaway"],
  ];

  const usableEvidence = params.sourceSummaries
    .map((summary) => sanitizeEvidenceText(summary.summary || summary.snippet || summary.title || ""))
    .filter((value) => isUsableSourceEvidence(value));

  const pickPlansForRoles = (roles: TopicSubtopicRole[]) => {
    const used = new Set<number>();
    const selected = roles
      .map((role) => {
        const matchedIndex = plans.findIndex((plan, index) => !used.has(index) && plan.role === role);
        const nextIndex = matchedIndex >= 0 ? matchedIndex : plans.findIndex((_, index) => !used.has(index));
        if (nextIndex < 0) return null;
        used.add(nextIndex);
        return plans[nextIndex];
      })
      .filter((plan): plan is (typeof plans)[number] => Boolean(plan));

    return selected.length > 0 ? selected : plans.slice(0, 4);
  };

  return roleGroups.map((roles, index) => {
    const sectionPlan = pickPlansForRoles(roles).map((plan) => ({
      subtitle: normalizeText(plan.subtopic),
      summary: normalizeText(plan.reason),
      role: plan.role,
      readerPromise: normalizeText(plan.readerPromise),
      imageCue: normalizeText(plan.imageCue),
      whyNow: normalizeText(plan.whyNow),
    }));
    const lead = sectionPlan[0];
    const leadSeed = lead?.subtitle || params.rootTopic;
    const headline = buildPlayfulTitle(params.rootTopic, leadSeed, index, params.topicType);
    const readerPromise =
      normalizeText(lead?.readerPromise) ||
      (params.topicType === "travel"
        ? `${params.rootTopic}에서 무엇부터 정해야 덜 후회하는지 감이 온다`
        : params.topicType === "golf"
          ? `${params.rootTopic}에서 어떤 판단이 흐름을 살리는지 바로 떠오른다`
          : `${params.rootTopic}가 실제로 어디서 갈리는지 빠르게 이해하게 된다`);
    const thesis =
      params.topicType === "travel"
        ? `${params.rootTopic}는 추천 리스트보다 선택 순서가 만족도를 가릅니다. 같은 비를 만나도 누구는 여유를 챙기고, 누구는 이동만 하다 하루를 끝냅니다.`
        : params.topicType === "golf"
          ? `${params.rootTopic}는 원론보다 현장에서 무너지는 순간을 먼저 잡아야 체감이 옵니다. 샷 하나보다 루틴과 판단이 흔들릴 때 스코어가 먼저 갈립니다.`
          : `${params.rootTopic}는 정의보다 장면과 비교가 먼저 살아야 이해가 붙습니다. 어디서 막히고 무엇을 먼저 바꾸면 달라지는지 보여주는 흐름이 더 유익합니다.`;
    const heroIntent = [
      params.rootTopic,
      normalizeText(lead?.imageCue || leadSeed),
      params.topicType === "travel"
        ? "mobile editorial travel scene"
        : params.topicType === "golf"
          ? "mobile editorial golf scene"
          : "mobile editorial concept scene",
    ]
      .filter(Boolean)
      .join(", ");

    return {
      id: `angle-${index + 1}`,
      headline,
      thesis,
      readerPromise,
      heroIntent,
      sectionPlan,
      requiredEvidence: usableEvidence.slice(index, index + 2),
    };
  });
}

function buildNarrativeCandidatesFromBriefs(
  rootTopic: string,
  topicType: TopicType,
  keywords: string[],
  briefs: NarrativeAngleBrief[],
): TopicCraftCandidate[] {
  return briefs.map((brief) => {
    const contentSections = brief.sectionPlan.map((section, index) => {
      const heading = normalizeText(section.subtitle) || rootTopic;
      const kind = normalizeSectionKind(section.role, index, brief.sectionPlan.length || 4, topicType);
      const keyword =
        normalizeText(keywords[index] || section.subtitle || brief.readerPromise || rootTopic) || rootTopic;
      const body = buildDeterministicSectionBody({
        type: topicType,
        rootTopic,
        sectionHeading: heading,
        leadSeed: normalizeText(section.imageCue || section.subtitle || keyword),
        keyword,
        kind,
        selectedReason: normalizeText(brief.readerPromise || brief.thesis),
        sourceExcerpt: normalizeText(brief.requiredEvidence?.[0] || ""),
        index,
      });

      return [`## ${heading}`, body].join("\n\n");
    });

    const content = [
      `# ${brief.headline}`,
      brief.thesis,
      ...contentSections,
    ]
      .filter(Boolean)
      .join("\n\n");

    const hashtags = dedupeStrings([
      rootTopic.replace(/\s+/g, ""),
      ...keywords.slice(0, 4),
      topicType === "travel" ? "여행팁" : topicType === "golf" ? "골프팁" : "정보정리",
    ]).slice(0, 8);

    return {
      title: brief.headline,
      content,
      hashtags,
      subtopics: brief.sectionPlan,
      image_prompt: brief.heroIntent,
      angleBriefId: brief.id,
      thesis: brief.thesis,
      readerPromise: brief.readerPromise,
      requiredEvidence: brief.requiredEvidence,
    };
  });
}

function buildFallbackTopicCraftCandidates(params: {
  rootTopic: string;
  topicType: TopicType;
  keywords: string[];
  sourceSummaries: TopicSourceSummary[];
  trendSignals: TopicResearchSignal[];
}): TopicCraftCandidate[] {
  const normalizeEvidenceText = (value: string) =>
    normalizeText(value)
      .replace(/enable javascript and cookies to continue/gi, "")
      .replace(/access denied/gi, "")
      .replace(/javascript.*cookies/gi, "")
      .replace(/로그인이 필요합니다/gi, "")
      .replace(/페이지를 찾을 수 없습니다/gi, "")
      .replace(/본문 바로가기/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();

  const isUsableEvidenceText = (value: string) => {
    const normalized = normalizeEvidenceText(value);
    if (!normalized) return false;
    if (normalized.length < 18) return false;
    return !/continue|cookies|javascript|access denied|robot|captcha/i.test(normalized);
  };

  const plans = buildFallbackCandidatePlans(
    params.rootTopic,
    params.topicType,
    params.keywords,
    params.trendSignals,
  );
  const fallbackRoles: Array<Array<TopicSubtopicRole>> = [
    ["hook", "scene", "comparison", "takeaway"],
    ["hook", "mistake", "comparison", "takeaway"],
    params.sourceSummaries.length > 0
      ? ["hook", "scene", "proof", "takeaway"]
      : ["hook", "scene", "comparison", "takeaway"],
  ];
  const sourceTone = params.sourceSummaries
    .map((summary) => normalizeEvidenceText(summary.summary || summary.snippet || summary.title || ""))
    .find((value) => isUsableEvidenceText(value)) || "";
  const openingByType: Record<TopicType, string> = {
    knowledge:
      `${params.rootTopic}는 정의부터 길게 풀면 멀어지기 쉽습니다. 사람들이 실제로 부딪히는 장면과 비교를 먼저 열어야 이 주제가 왜 중요한지 바로 들어옵니다.`,
    travel:
      `${params.rootTopic}는 관광지 이름보다 하루 분위기가 어떻게 갈리는지가 먼저 보여야 읽힙니다. 동선과 후회 포인트가 보이는 장면부터 잡아야 실제 도움이 됩니다.`,
    golf:
      `${params.rootTopic}는 원론보다 실전 체감이 먼저 와야 합니다. 스코어와 리듬이 갈리는 장면이 앞쪽에 나와야 끝까지 읽힙니다.`,
  };

  const pickPlansForRoles = (roles: TopicSubtopicRole[]) => {
    const used = new Set<number>();
    const selected = roles
      .map((role) => {
        const matchedIndex = plans.findIndex((plan, index) => !used.has(index) && plan.role === role);
        const nextIndex = matchedIndex >= 0 ? matchedIndex : plans.findIndex((_, index) => !used.has(index));
        if (nextIndex < 0) return null;
        used.add(nextIndex);
        return plans[nextIndex];
      })
      .filter((plan): plan is (typeof plans)[number] => Boolean(plan));
    return selected.length > 0 ? selected : plans.slice(0, 4);
  };

  const buildFallbackSectionCopy = (
    plan: (typeof plans)[number],
    keyword: string,
    sourceSnippet: string,
  ) => {
    return buildDeterministicSectionBody({
      type: params.topicType,
      rootTopic: params.rootTopic,
      sectionHeading: normalizeText(plan.subtopic) || params.rootTopic,
      leadSeed: normalizeText(plan.imageCue || plan.subtopic || keyword || params.rootTopic),
      keyword,
      kind: normalizeSectionKind(plan.role, 0, 4, params.topicType),
      selectedReason: normalizeText(plan.readerPromise || plan.reason || ""),
      sourceExcerpt: sourceSnippet,
      index: 0,
    });
  };

  return fallbackRoles.map((roles, index) => {
    const group = pickPlansForRoles(roles);
    const lead = group[0];
    const title = buildPlayfulTitle(
      params.rootTopic,
      lead?.subtopic || params.rootTopic,
      index,
      params.topicType,
    );
    const intro = [
      openingByType[params.topicType] || openingByType.knowledge,
      sourceTone
        ? `자료를 그대로 옮기기보다 "${truncateText(sourceTone, 90)}"처럼 실제로 온도가 달라지는 장면을 앞에 두는 편이 훨씬 읽힙니다.`
        : `${params.keywords.length > 0 ? `${params.keywords.slice(0, 2).join(", ")} 같은 단어보다` : "키워드보다"} 어디서 손이 멈추고 어디서 고개가 끄덕여지는지부터 잡는 쪽이 낫습니다.`,
    ].join(" ");
    const sections = group.map((plan, planIndex) => {
      const kind = normalizeSectionKind(plan.role, planIndex, group.length, params.topicType);
      const sectionHeading =
        normalizeText(plan.subtopic) || buildSectionHeadingByType(params.topicType, params.rootTopic, planIndex, kind);
      const keyword = normalizeText(params.keywords[planIndex] || plan.subtopic || params.rootTopic);

      return [
        `## ${sectionHeading}`,
        buildFallbackSectionCopy(plan, keyword, sourceTone),
      ].join("\n");
    });
    const closing =
      params.topicType === "travel"
        ? `${params.rootTopic} 글은 마지막에 누가 어떤 선택을 하면 덜 후회하는지 남겨야 끝맛이 좋습니다. 여행 정보보다 판단 기준이 남는 쪽이 훨씬 오래 갑니다.`
        : params.topicType === "golf"
          ? `${params.rootTopic}는 마지막에 오늘 바로 바꿔볼 기준 하나만 남겨도 충분합니다. 읽고 나서 몸이 먼저 떠오르는 쪽이 좋은 골프 글입니다.`
          : `${params.rootTopic}는 결론을 길게 늘이기보다 어떤 상황에서 먼저 판단해야 하는지 기준 하나만 남겨도 훨씬 또렷하게 읽힙니다.`;
    const hashtags = dedupeStrings([
      params.rootTopic.replace(/\s+/g, ""),
      ...params.keywords,
      params.topicType === "travel" ? "여행체크리스트" : params.topicType === "golf" ? "골프가이드" : "정보정리",
    ]).slice(0, 8);

    return {
      title,
      content: [`# ${title}`, intro, ...sections, closing].join("\n\n"),
      hashtags,
      subtopics: group.map((plan) => ({
        subtitle: plan.subtopic,
        summary: plan.reason,
        role: plan.role,
        readerPromise: plan.readerPromise,
        imageCue: plan.imageCue,
        whyNow: plan.whyNow,
      })),
      image_prompt: [params.rootTopic, lead?.subtopic || "", "editorial blog hero image"].filter(Boolean).join(", "),
    };
  });
}

async function requestTopicCraftCandidates(params: {
  category: TopicCraftCategory;
  keyword: string;
  rootTopic: string;
  keywords: string[];
  topicType: TopicType;
  packet: TopicResearchPacket;
  sourceSummaries: TopicSourceSummary[];
  narrativeBriefs: NarrativeAngleBrief[];
}): Promise<TopicCraftCandidate[]> {
  const { stdout } = await withTimeout(
    execFileAsync(
      "curl",
      [
        "-sS",
        "-X",
        "POST",
        TOPIC_CRAFT_GENERATE_TOPICS_URL,
        "-H",
        "Content-Type: application/json",
        ...TOPIC_CRAFT_AUTH_HEADERS,
        "--data",
        JSON.stringify({ category: params.category, keyword: params.keyword }),
      ],
      { maxBuffer: CURL_MAX_BUFFER_BYTES },
    ),
    TOPIC_CRAFT_TIMEOUT_MS,
    "topic-craft generate-topics",
  );
  const payload = JSON.parse(stdout) as TopicCraftResponse;
  const valid = extractTopicCraftCandidates(payload);
  const narrativeCandidates = buildNarrativeCandidatesFromBriefs(
    params.rootTopic,
    params.topicType,
    params.keywords,
    params.narrativeBriefs,
  );
  if (valid.length > 0) {
    const merged = dedupeTopicCraftCandidates([...valid, ...narrativeCandidates]);
    return merged.length > 0 ? merged : valid;
  }

  const fallback = buildFallbackTopicCraftCandidates({
    rootTopic: params.rootTopic,
    topicType: params.topicType,
    keywords: params.keywords,
    sourceSummaries: params.sourceSummaries,
    trendSignals: params.packet.trendSignals,
  });
  if (fallback.length > 0) {
    const detail = extractTopicCraftError(payload);
    console.warn(
      `[topic-task-pipeline] topic-craft candidates unavailable${detail ? `: ${detail}` : ""}. using fallback candidates.`,
    );
    return dedupeTopicCraftCandidates([...narrativeCandidates, ...fallback]);
  }

  const detail = extractTopicCraftError(payload);
  if (detail) {
    throw new Error(`topic-craft 후보 생성 실패: ${detail}`);
  }

  throw new Error("topic-craft에서 유효한 초안을 반환하지 않았습니다.");
}

async function extractSourceImageCandidates(urls: string[]): Promise<SourceImageCandidate[]> {
  const assets: SourceImageCandidate[] = [];

  const decodeHtml = (value: string) =>
    value
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");

  const toAbsoluteImageUrl = (rawValue: string, pageUrl: string) => {
    const normalized = decodeHtml(rawValue.trim());
    if (!normalized || normalized.startsWith("data:")) return null;
    try {
      const absolute = new URL(normalized, pageUrl).toString();
      if (!/^https?:\/\//i.test(absolute)) return null;
      if (/\.svg(\?.*)?$/i.test(absolute)) return null;
      return absolute;
    } catch {
      return null;
    }
  };

  const parseNumericAttribute = (tag: string, name: string) => {
    const matched = tag.match(new RegExp(`${name}=["']?(\\d{2,5})["']?`, "i"));
    return matched ? Number.parseInt(matched[1], 10) : null;
  };

  const scoreImageCandidate = (imageUrl: string, hint: string, tag = "") => {
    let score = 0;
    const combined = `${imageUrl} ${hint} ${tag}`.toLowerCase();

    if (/(og:image|twitter:image|itemprop=image)/i.test(hint)) score += 120;
    if (/jsonld:image/i.test(hint)) score += 90;
    if (/(hero|cover|main|featured|representative|article|content)/i.test(combined)) score += 32;
    if (/\.(png|jpe?g|webp)(\?.*)?$/i.test(imageUrl)) score += 8;
    if (/(logo|icon|avatar|profile|sprite|spacer|blank|loader|emoji|badge|favicon|thumbnail|thumb)/i.test(combined)) {
      score -= 80;
    }

    const width = parseNumericAttribute(tag, "width");
    const height = parseNumericAttribute(tag, "height");
    if (width && height) {
      score += Math.min(Math.floor((width * height) / 40_000), 30);
      if (width < 240 || height < 160) score -= 45;
    }

    const dimensionMatch = imageUrl.match(/(?:[?&](?:w|width)=|\/)(\d{3,4})(?:x|[?&](?:h|height)=)(\d{3,4})/i);
    if (dimensionMatch) {
      const parsedWidth = Number.parseInt(dimensionMatch[1], 10);
      const parsedHeight = Number.parseInt(dimensionMatch[2], 10);
      if (Number.isFinite(parsedWidth) && Number.isFinite(parsedHeight)) {
        score += Math.min(Math.floor((parsedWidth * parsedHeight) / 70_000), 24);
      }
    }

    return score;
  };

  const extractImageCandidatesFromHtml = (html: string, pageUrl: string) => {
    const scored = new Map<string, number>();

    const addCandidate = (rawValue: string, hint: string, tag = "") => {
      const absolute = toAbsoluteImageUrl(rawValue, pageUrl);
      if (!absolute) return;
      const nextScore = scoreImageCandidate(absolute, hint, tag);
      const previous = scored.get(absolute) ?? Number.NEGATIVE_INFINITY;
      if (nextScore > previous) {
        scored.set(absolute, nextScore);
      }
    };

    const metaPatterns: Array<{ pattern: RegExp; hint: string }> = [
      {
        pattern: /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
        hint: "og:image",
      },
      {
        pattern: /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/gi,
        hint: "twitter:image",
      },
      {
        pattern: /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/gi,
        hint: "itemprop=image",
      },
    ];

    for (const { pattern, hint } of metaPatterns) {
      for (const match of html.matchAll(pattern)) {
        if (match[1]) addCandidate(match[1], hint);
      }
    }

    for (const match of html.matchAll(/"image"\s*:\s*"([^"]+)"/gi)) {
      if (match[1]) addCandidate(match[1], "jsonld:image");
    }

    for (const match of html.matchAll(/"image"\s*:\s*\[([^\]]+)\]/gi)) {
      for (const nested of match[1].matchAll(/"([^"]+)"/g)) {
        if (nested[1]) addCandidate(nested[1], "jsonld:image[]");
      }
    }

    const imgTags = html.match(/<img\b[^>]*>/gi) || [];
    for (const tag of imgTags) {
      const attrPatterns = [
        /data-src=["']([^"']+)["']/i,
        /data-lazy-src=["']([^"']+)["']/i,
        /data-original=["']([^"']+)["']/i,
        /data-image=["']([^"']+)["']/i,
        /src=["']([^"']+)["']/i,
      ];

      for (const pattern of attrPatterns) {
        const match = tag.match(pattern);
        if (match?.[1]) {
          addCandidate(match[1], pattern.source, tag);
          break;
        }
      }

      const srcsetMatch = tag.match(/srcset=["']([^"']+)["']/i);
      if (srcsetMatch?.[1]) {
        for (const part of srcsetMatch[1].split(",")) {
          const [candidateUrl] = part.trim().split(/\s+/);
          if (candidateUrl) addCandidate(candidateUrl, "srcset", tag);
        }
      }
    }

    return Array.from(scored.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([imageUrl]) => imageUrl);
  };

  for (const [index, pageUrl] of urls.entries()) {
    const sourceRefId = String(index + 1);
    if (/\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(pageUrl)) {
      assets.push({ sourceRefId, pageUrl, imageUrl: pageUrl });
      continue;
    }

    try {
      const response = await fetchWithTimeout(
        pageUrl,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
        },
        12_000,
      );
      if (!response.ok) continue;
      const html = await response.text();
      const candidateUrls = extractImageCandidatesFromHtml(html, pageUrl).slice(0, 4);
      if (candidateUrls.length === 0) continue;

      assets.push(...candidateUrls.map((imageUrl) => ({ sourceRefId, pageUrl, imageUrl })));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[topic-task-pipeline] source image extraction failed: ${pageUrl} (${message})`);
      continue;
    }
  }

  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.sourceRefId}|${asset.pageUrl.toLowerCase()}|${asset.imageUrl.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSelectionPrompt(
  rootTopic: string,
  keywords: string[],
  candidates: ScoredTopicCandidate[],
): string {
  return [
    `루트 주제: ${rootTopic}`,
    `타깃 키워드: ${keywords.join(", ") || "(없음)"}`,
    "",
    ...candidates.map((candidate, index) =>
      [
        `후보 ${index + 1}`,
        `제목: ${normalizeText(candidate.candidate.title)}`,
        `본문 길이: ${candidate.bodyLength}`,
        `평균 섹션 길이: ${candidate.averageSectionLength}`,
        `섹션 수: ${candidate.sectionCount}`,
        `섹션 역할: ${candidate.inferredKinds.join(" > ")}`,
        `키워드 커버리지: ${candidate.keywordCoverage.toFixed(2)}`,
        `반복 비율: ${candidate.repeatedLineRatio.toFixed(2)}`,
        `훅 점수: ${candidate.hookScore}`,
        `밋밋함 페널티: ${candidate.blandnessPenalty}`,
        `모바일 과밀 페널티: ${candidate.mobileCadencePenalty}`,
        `미리보기: ${candidate.preview.join(" | ")}`,
      ].join("\n"),
    ),
  ].join("\n");
}

async function runOpenAiStructured<T>(schemaName: string, _schema: Record<string, unknown>, prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const response = await withTimeout(
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    }),
    STRUCTURED_MODEL_TIMEOUT_MS,
    `OpenAI ${schemaName}`,
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI ${schemaName} 호출 실패 (${response.status}): ${detail.slice(0, 400)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string };
    }>;
  };

  const outputText = payload.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonObject<T>(outputText);
  if (!parsed) {
    throw new Error(`OpenAI 응답을 JSON으로 해석하지 못했습니다 (${schemaName})`);
  }
  return parsed;
}

async function runBrowserStructured<T>(prompt: string): Promise<T> {
  const enabled = process.env.BROWSER_GPT_MODE?.toLowerCase() === "true" && ALLOW_CHATGPT_BROWSER_MODE;
  if (!enabled) {
    throw new Error("브라우저 GPT 폴백이 비활성화되어 있습니다.");
  }

  const { createChatGPTContext, openChatGPTTarget, sendPromptToChatGPT } = await import(
    "../../scripts/lib/chatgpt-browser"
  );

  const handle = await createChatGPTContext(true);
  try {
    const page = await handle.context.newPage();
    await openChatGPTTarget(page, BROWSER_TOPIC_GPT_URL, "주제글 폴백");
    const raw = await sendPromptToChatGPT(page, prompt, "주제글 폴백");
    const parsed = parseJsonObject<T>(raw);
    if (!parsed) {
      throw new Error("브라우저 GPT 응답을 JSON으로 해석하지 못했습니다.");
    }
    return parsed;
  } finally {
    await handle.close().catch(() => {});
  }
}

const CODEX_BIN =
  process.env.CODEX_BIN || "/Users/jakeshin/.nvm/versions/node/v20.19.5/bin/codex";

async function runCodexStructured<T>(prompt: string): Promise<T | null> {
  const { readFile, unlink } = await import("fs/promises");
  const { join } = await import("path");
  const { tmpdir } = await import("os");

  const ts = Date.now();
  const outputFile = join(tmpdir(), `codex-structured-${ts}-${Math.random().toString(36).slice(2)}.txt`);
  const fullPrompt = `${prompt}\n\n반드시 JSON만 출력하라. 다른 텍스트 없음.`;

  try {
    let proc: ReturnType<typeof spawn> | null = null;
    let timeoutId: NodeJS.Timeout | null = null;

    await new Promise<void>((resolve, reject) => {
      proc = spawn(
        CODEX_BIN,
        ["exec", "--full-auto", "--ephemeral", "--skip-git-repo-check", "-o", outputFile, "-"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      const finish = (callback: () => void) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        callback();
      };

      timeoutId = setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (proc && !proc.killed) {
              proc.kill("SIGKILL");
            }
          }, 1_500).unref();
        }
        finish(() => reject(new Error(`Codex timeout (${TOPIC_CODEX_TIMEOUT_MS}ms)`)));
      }, TOPIC_CODEX_TIMEOUT_MS);

      if (!proc.stdin) {
        finish(() => reject(new Error("Codex stdin을 열 수 없습니다.")));
        return;
      }

      proc.stdin.write(fullPrompt, "utf-8");
      proc.stdin.end();
      proc.once("close", () => finish(resolve));
      proc.once("error", (error) => finish(() => reject(error)));
    });

    const output = await readFile(outputFile, "utf-8");
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  } finally {
    await unlink(outputFile).catch(() => {});
  }
}

async function runCodexEditorialPass(
  content: PreparedTopicContent,
  params: {
    rootTopic: string;
    keywords: string[];
    type: TopicType;
    sourceSummaries: TopicSourceSummary[];
  },
): Promise<PreparedTopicContent | null> {
  if (!TOPIC_CODEX_EDITOR_ENABLED) {
    return null;
  }
  const writingTopic = isWritingFocusedTopic(params.rootTopic, params.keywords);

  const sourceSummaryText =
    params.sourceSummaries.some((entry) =>
      isUsableSourceEvidence(entry.summary || entry.snippet || entry.title || ""),
    )
      ? params.sourceSummaries
          .map((entry, index) =>
            `sourceRefId=${index + 1}|title=${sanitizeEvidenceText(entry.title || "")}|summary=${sanitizeEvidenceText(entry.summary || entry.snippet || "")}`,
          )
          .filter((line) => !/title=\|summary=$/.test(line))
          .join("\n")
      : "source 없음";

  const prompt = [
    "당신은 한국어 블로그 최종 에디터다.",
    "아래 JSON 초안을 더 자연스럽고 모바일 친화적으로 다듬어라.",
    "반드시 JSON만 반환한다.",
    BLOG_MOBILE_HUMAN_STYLE_PROMPT,
    "규칙:",
    "- title, lead, highlights, sections 4개, hashtags, meta 구조를 유지한다.",
    "- sections[].kind, sourceRefIds, imageSlotId는 유지한다.",
    "- 깨진 조사, 이상한 연결, 메타 설명, 모델 티 나는 문장을 제거한다.",
    "- 각 section body는 2~3개 짧은 문단으로 읽히게 한다.",
    "- summary는 10~22자 안의 자연스러운 한 줄이어야 한다.",
    "- 모바일에서 읽히게 한 문단을 짧게 쓴다.",
    writingTopic
      ? "- 주제가 글쓰기/콘텐츠 자체이면 글쓰기 장면과 독자 반응을 남겨도 된다."
      : "- 주제가 글쓰기 자체가 아니면 '글, 문장, 읽히다, 심심하다, 사람 말처럼' 같은 메타 표현을 제거한다.",
    "",
    `루트 주제: ${params.rootTopic}`,
    `유형: ${params.type}`,
    `키워드: ${params.keywords.join(", ") || "(없음)"}`,
    "",
    "source summaries:",
    sourceSummaryText,
    "",
    "현재 초안 JSON:",
    JSON.stringify(content),
  ].join("\n");

  return await runCodexStructured<PreparedTopicContent>(prompt);
}

async function runStructuredPrompt<T>(options: {
  schemaName: string;
  schema: Record<string, unknown>;
  prompt: string;
  allowBrowserFallback?: boolean;
}): Promise<T> {
  let lastError: unknown = null;

  try {
    const openAi = await runOpenAiStructured<T>(options.schemaName, options.schema, options.prompt);
    if (openAi) return openAi;
  } catch (error) {
    lastError = error;
  }

  if (!options.allowBrowserFallback) {
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error("구조화 모델(OpenAI GPT)을 사용할 수 없습니다.");
  }

  return runBrowserStructured<T>(options.prompt);
}

async function decideSelectedCandidate(
  rootTopic: string,
  keywords: string[],
  scoredCandidates: ScoredTopicCandidate[],
): Promise<TopicSelectionDecision> {
  const [top, second] = scoredCandidates;
  if (!top) {
    throw new Error("선택할 후보가 없습니다.");
  }

  if (!second || top.score - second.score > 4) {
    return {
      selectedIndex: top.index,
      reason: `자동 점수 우세 (${top.score}점)`,
      risks: [],
    };
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["selectedIndex", "reason", "risks"],
    properties: {
      selectedIndex: { type: "integer", minimum: 0, maximum: scoredCandidates.length - 1 },
      reason: { type: "string" },
      risks: {
        type: "array",
        items: { type: "string" },
      },
    },
  };

  const prompt = [
    "당신은 한국어 블로그 초안 선택 심사관이다.",
    "가장 발행 적합한 1개를 고르고 JSON만 반환하라.",
    "",
    buildSelectionPrompt(rootTopic, keywords, scoredCandidates.slice(0, 2)),
  ].join("\n");

  try {
    return await runStructuredPrompt<TopicSelectionDecision>({
      schemaName: "topic_selection_judge",
      schema,
      prompt,
      allowBrowserFallback: false,
    });
  } catch {
    return {
      selectedIndex: top.index,
      reason: `동점 구간이지만 휴리스틱 우세 (${top.score}점)`,
      risks: ["judge_fallback"],
    };
  }
}

function pickNarrativeAngleBrief(
  candidate: TopicCraftCandidate,
  narrativeBriefs: NarrativeAngleBrief[],
): NarrativeAngleBrief | null {
  if (narrativeBriefs.length === 0) return null;

  if (candidate.angleBriefId) {
    const exact = narrativeBriefs.find((brief) => brief.id === candidate.angleBriefId);
    if (exact) return exact;
  }

  const candidateText = normalizeText(
    [
      candidate.title,
      candidate.thesis,
      candidate.readerPromise,
      candidate.content,
      ...(candidate.subtopics || []).flatMap((section) => [section.subtitle, section.summary]),
    ]
      .filter(Boolean)
      .join(" "),
  ).toLowerCase();

  let best: NarrativeAngleBrief | null = null;
  let bestScore = -1;

  for (const brief of narrativeBriefs) {
    const tokens = dedupeStrings([
      brief.headline,
      brief.readerPromise,
      ...brief.sectionPlan.flatMap((section) => [section.subtitle || "", section.readerPromise || ""]),
    ])
      .flatMap((value) => normalizeText(value).toLowerCase().split(/\s+/))
      .filter((token) => token.length >= 2);
    const score = tokens.reduce((count, token) => count + (candidateText.includes(token) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = brief;
    }
  }

  return bestScore > 0 ? best : narrativeBriefs[0];
}

function buildPolishPrompt(params: {
  rootTopic: string;
  keywords: string[];
  selectedCandidate: TopicCraftCandidate;
  selectedAngleBrief?: NarrativeAngleBrief | null;
  selectedReason: string;
  type: TopicType;
  style: string | null;
  sourceSummaries: TopicSourceSummary[];
}) {
  const writingTopic = isWritingFocusedTopic(params.rootTopic, params.keywords);
  const cleanedCandidateSections = splitCandidateContent(params.selectedCandidate.content || "")
    .map((section, index) => {
      const safeHeading = sanitizeNarrativeSeed(section.heading, params.rootTopic);
      const safeBody = sanitizeEvidenceText(section.body);
      if (!safeHeading && !safeBody) return "";
      return [
        `섹션 ${index + 1}: ${
          safeHeading ||
          buildSectionHeadingByType(
            params.type,
            params.rootTopic,
            index,
            normalizeSectionKind(section.kind, index, 4, params.type),
          )
        }`,
        safeBody,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .slice(0, 4)
    .join("\n\n");
  const sourceSummaryText =
    params.sourceSummaries.some((entry) =>
      isUsableSourceEvidence(entry.summary || entry.snippet || entry.title || ""),
    )
      ? params.sourceSummaries
          .map((entry, index) =>
            `sourceRefId=${index + 1}|url=${entry.url}|title=${sanitizeEvidenceText(entry.title || "")}|summary=${sanitizeEvidenceText(entry.summary || entry.snippet || "")}`,
          )
          .filter((line) => !/title=\|summary=$/.test(line))
          .join("\n")
      : "sourceRefId 없음";
  const selectedAngleBriefText = params.selectedAngleBrief
    ? [
        `서사 브리프 제목: ${params.selectedAngleBrief.headline}`,
        `서사 핵심 주장: ${params.selectedAngleBrief.thesis}`,
        `독자에게 남길 이득: ${params.selectedAngleBrief.readerPromise}`,
        "섹션 설계:",
        ...params.selectedAngleBrief.sectionPlan.map((section, index) =>
          [
            `${index + 1}. ${normalizeText(section.subtitle) || params.rootTopic}`,
            `role=${section.role || "comparison"}`,
            `scene=${normalizeText(section.imageCue) || normalizeText(section.summary) || "-"}`,
          ].join(" | "),
        ),
        params.selectedAngleBrief.requiredEvidence.length > 0
          ? `필수 근거: ${params.selectedAngleBrief.requiredEvidence.map((item) => truncateText(item, 60)).join(" / ")}`
          : "필수 근거: 없음",
      ].join("\n")
    : "서사 브리프 없음";

  return [
    "당신은 네이버 블로그용 한국어 콘텐츠 에디터다.",
    "반드시 JSON만 반환한다.",
    BLOG_MOBILE_HUMAN_STYLE_PROMPT,
    "컨설팅 보고서 같은 말투, 체크리스트 남발, 추상적 메타 설명을 금지한다.",
    "과장된 광고체를 피하되, 읽는 맛이 있도록 장면·오해·비교·실수 포인트를 적극적으로 사용한다.",
    "제목에는 '체크리스트', '실전 정리', '적용 판단 프레임', '문제해결 적용 순서' 같은 표현을 쓰지 않는다.",
    "섹션은 반드시 4개다. 각 heading은 비슷하게 반복하지 말고 사람이 실제로 궁금해할 표현으로 쓴다.",
    "sections[].kind는 hook, scene, mistake, comparison, proof, takeaway 중 하나다. 기본 흐름은 hook -> scene -> comparison -> takeaway 다. proof는 별도 섹션으로 늘리기보다 scene/comparison 안에 녹여도 된다.",
    "첫 섹션은 '왜 이 주제가 갑자기 재밌어지거나 중요해지는지'를 보여주는 훅 역할을 해야 한다.",
    "lead는 제목 아래에 바로 들어갈 2문장 도입부다. 90~180자 안에서 이 글이 왜 재밌는지와 어디를 봐야 하는지 짧고 강하게 잡는다.",
    "highlights는 2~3개 짧은 포인트 배열이다. 각 항목은 10~28자 안에서 짧고 강하게 쓴다.",
    "각 섹션에는 summary를 꼭 넣는다. summary는 소제목 아래에 붙는 한 줄 요약이며 10~28자 안에서 짧고 선명하게 쓴다.",
    "bullets는 comparison, proof, takeaway 섹션에서만 선택적으로 0~2개 넣는다. 각 bullet은 10~26자 안의 짧은 실전 포인트다.",
    "중간 섹션에는 최소 1개 이상 흔한 오해/실수, 비교, 실제 장면이나 사례를 넣는다.",
    "마지막 섹션은 장황한 결론 대신 선택 기준이나 바로 써먹는 팁으로 닫는다.",
    "각 섹션 body는 110~220자 정도를 목표로 하고, 정확히 2개 짧은 문단으로 쓴다.",
    "모바일에서 읽히게 써야 한다. 한 문단은 1~2문장으로 제한하고, 문단 하나가 95자를 넘지 않게 한다.",
    "같은 명사와 문형을 반복하지 말고, 한 글 전체가 너무 설명문처럼 느껴지지 않게 리듬을 준다.",
    "짧게 끊어 읽히는 문장을 섞고, 문단 첫 문장은 너무 교과서처럼 시작하지 않는다.",
    "글 자체를 설명하는 메타 문장(예: 이번 글에서는, 이 글은 ~로 구성했다, 재구성했다)은 금지한다.",
    "후보 초안보다 아래 서사 브리프가 더 구체적이면 서사 브리프를 우선 유지한다.",
    writingTopic
      ? "주제가 글쓰기/콘텐츠 자체이면 글쓰기 장면과 독자 반응을 다뤄도 된다."
      : "주제가 글쓰기 자체가 아니라면 '글, 문장, 읽히다, 심심하다, 사람 말처럼' 같은 메타 표현을 섞지 않는다.",
    "sections[].sourceRefIds에는 위 sourceRefId 라벨 숫자 문자열만 넣는다. 소스가 없으면 빈 배열이다.",
    "",
    `루트 주제: ${params.rootTopic}`,
    `타깃 키워드: ${params.keywords.join(", ") || "(없음)"}`,
    `유형: ${params.type}`,
    `스타일: ${params.style || "정보형"}`,
    `선택 사유: ${params.selectedReason}`,
    "",
    `선택 초안 제목: ${params.selectedCandidate.title || ""}`,
    "선택 초안 요약:",
    cleanedCandidateSections || sanitizeEvidenceText(params.selectedCandidate.content || ""),
    "",
    "서사 브리프:",
    selectedAngleBriefText,
    "",
    "source summaries:",
    sourceSummaryText,
  ].join("\n");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function stripHashtagPrefix(value: string): string {
  return value.replace(/^#+/, "").trim();
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function dedupeTopicCraftCandidates(candidates: TopicCraftCandidate[]): TopicCraftCandidate[] {
  const seen = new Set<string>();
  const output: TopicCraftCandidate[] = [];

  for (const candidate of candidates) {
    const title = normalizeText(candidate.title).toLowerCase();
    const sectionKey = splitCandidateContent(candidate.content || "")
      .slice(0, 3)
      .map((section) => normalizeText(section.heading || section.body.slice(0, 40)).toLowerCase())
      .filter(Boolean)
      .join("|");
    const key = `${title}::${sectionKey}`;
    if (!title && !sectionKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(candidate);
  }

  return output;
}

function buildFallbackPolishedContent(params: {
  rootTopic: string;
  keywords: string[];
  selectedCandidate: TopicCraftCandidate;
  selectedReason: string;
  type: TopicType;
  style: string | null;
  sourceSummaries: TopicSourceSummary[];
}): PreparedTopicContent {
  const content = params.selectedCandidate.content || "";
  const subtopics = Array.isArray(params.selectedCandidate.subtopics) ? params.selectedCandidate.subtopics : [];
  const seedSections = splitCandidateContent(content);
  const leadSeed = pickLeadNarrativeSeed(params);
  const sectionCount = 4;
  const sections: PreparedTopicSection[] = Array.from({ length: sectionCount }, (_, index) => {
    const seedSection = seedSections[index];
    const subtopic = sanitizeNarrativeSeed(subtopics[index]?.subtitle || "", params.rootTopic) || leadSeed;
    const rawKeyword =
      sanitizeNarrativeSeed(params.keywords[index] || params.keywords[0] || subtopic, params.rootTopic) ||
      normalizeText(params.rootTopic);
    const inferredKind = seedSection
      ? inferCandidateSectionKind(seedSection, index, sectionCount, params.type)
      : undefined;
    const kind = normalizeSectionKind(
      seedSection?.kind || subtopics[index]?.role || inferredKind,
      index,
      sectionCount,
      params.type,
    );
    const rawHeading =
      !isGenericHeading(seedSection?.heading || "")
        ? sanitizeNarrativeSeed(seedSection?.heading || "", params.rootTopic)
        : sanitizeNarrativeSeed(subtopics[index]?.subtitle || "", params.rootTopic);
    const heading =
      !rawHeading ||
      rawHeading === normalizeText(params.selectedCandidate.title) ||
      rawHeading.length > 42 ||
      rawHeading.length < 5
        ? buildSectionHeadingByType(params.type, params.rootTopic, index, kind)
        : rawHeading;
    const keyword = compactTemplateKeyword(params.rootTopic, rawKeyword, heading, kind);
    const sourceExcerpt =
      normalizeText(params.sourceSummaries[index]?.summary) ||
      normalizeText(params.sourceSummaries[index]?.snippet) ||
      normalizeText(params.sourceSummaries[0]?.summary) ||
      normalizeText(params.sourceSummaries[0]?.snippet);
    const seedBody = cleanSectionBody(
      sanitizeEvidenceText(seedSection?.body || normalizeText(subtopics[index]?.summary)),
    );
    const body = bodyNeedsFallback(seedBody)
      ? buildDeterministicSectionBody({
          type: params.type,
          rootTopic: params.rootTopic,
          sectionHeading: heading,
          leadSeed: subtopic,
          keyword,
          kind,
          selectedReason: params.selectedReason,
          sourceExcerpt,
          index,
        })
      : formatBodyForMobile(seedBody);

    return {
      heading,
      body,
      kind,
      summary: buildSectionSummary({
        type: params.type,
        kind,
        keyword,
        fallback: heading,
      }),
      bullets:
        kind === "comparison" || kind === "proof" || kind === "takeaway"
          ? buildSectionBullets({
              type: params.type,
              kind,
              keyword,
            }).slice(0, 2)
          : [],
      stockQuery:
        normalizeText(seedSection?.stockQuery) ||
        dedupeStrings([params.rootTopic, heading, keyword]).join(" "),
      sourceRefIds: params.sourceSummaries[index] ? [String(index + 1)] : [],
      imageSlotId: buildSectionImageSlotId(index),
    };
  });

  const hashtags = dedupeStrings([
    ...(params.selectedCandidate.hashtags || []).map(stripHashtagPrefix),
    ...params.keywords.map(stripHashtagPrefix),
    stripHashtagPrefix(params.rootTopic.replace(/\s+/g, "")),
  ]).slice(0, 8);
  const lead = truncateText(
    params.type === "travel"
      ? `${params.rootTopic}는 추천이 많아도 현장 장면이 늦게 나오면 금방 힘이 빠집니다. 여기서는 어디서 하루 분위기가 갈리고 무엇부터 정하면 덜 후회하는지를 짧게 짚습니다.`
      : params.type === "golf"
        ? `${params.rootTopic}는 이론보다 실전 장면이 먼저 보여야 읽힙니다. 여기서는 어디서 흐름이 무너지고 무엇부터 바꾸면 체감이 달라지는지를 짧게 짚습니다.`
        : `${params.rootTopic}는 개념만 길게 설명하면 금방 멀어집니다. 여기서는 실제로 어디서 갈리고 무엇을 먼저 보면 이해가 빨라지는지부터 짧게 짚습니다.`,
    180,
  );
  const highlights = buildHighlightList(sections);

  return {
    title:
      !titleNeedsCleanup(normalizeText(params.selectedCandidate.title), params.rootTopic)
        ? normalizeText(params.selectedCandidate.title)
        : buildPlayfulTitle(params.rootTopic, leadSeed, 0, params.type),
    lead,
    highlights,
    sections: sections.slice(0, 4).map((section) => ({
      heading: section.heading,
      body: section.body,
      kind: section.kind,
      summary: section.summary,
      bullets: section.bullets,
      stockQuery: section.stockQuery,
      sourceRefIds: section.sourceRefIds,
      imageSlotId: section.imageSlotId,
    })),
    hashtags,
    meta: {
      summary: buildMetaSummary({
        rootTopic: params.rootTopic,
        type: params.type,
        highlights,
        sections,
      }),
      tone: params.style || "정보형",
      selectedReason: params.selectedReason,
    },
  };
}

function classifyImageRole(
  section: PreparedTopicSection | undefined,
  index: number,
  hasSourceRef: boolean,
): ImageRole {
  if (index === 0) return "scene";
  if (section?.kind === "comparison") return "diagram";
  if (section?.kind === "proof") return "proof";
  if (section?.kind === "hook" || section?.kind === "scene") return "scene";
  if (section?.kind === "takeaway") return hasSourceRef ? "proof" : "scene";
  const haystack = `${normalizeText(section?.heading)} ${normalizeText(section?.body)}`.toLowerCase();
  if (hasSourceRef || /(출처|리포트|통계|데이터|근거|화면|캡처|screenshot|document|report)/i.test(haystack)) {
    return "proof";
  }
  if (/(비교|차이|전후|vs|대비|흐름|구조|정리|프레임|체크포인트)/i.test(haystack)) {
    return "diagram";
  }
  return "scene";
}

function scoreInlineImageNeed(section: PreparedTopicSection, role: ImageRole): number {
  const kindBonus: Record<SectionKind, number> = {
    hook: 1,
    scene: 2,
    mistake: 1,
    comparison: 3,
    proof: 4,
    takeaway: 1,
  };
  const roleBonus: Record<ImageRole, number> = {
    hero: 0,
    proof: 4,
    scene: 2,
    diagram: 3,
    inline: 1,
  };

  const kind = section.kind || "scene";
  return (kindBonus[kind] || 0) + (roleBonus[role] || 0) + (section.sourceRefIds.length > 0 ? 2 : 0);
}

function classifyVisualIntent(
  role: ImageRole,
  section: PreparedTopicSection | undefined,
  content: PreparedTopicContent,
): VisualIntent {
  const haystack = `${normalizeText(content.title)} ${normalizeText(section?.heading)} ${normalizeText(section?.body)}`.toLowerCase();
  if (role === "proof") return /ui|screen|서비스|대시보드|에디터|화면|캡처/i.test(haystack) ? "ui-screenshot" : "real-scene";
  if (role === "diagram") return /(비교|차이|전후|vs|구조|흐름|프레임|정리)/i.test(haystack) ? "comparison" : "concept";
  if (/(ai|자동화|미래기술|llm|콘텐츠 전략|브랜드 전략)/i.test(haystack)) return "editorial";
  return "real-scene";
}

function chooseImageStrategy(
  role: ImageRole,
  visualIntent: VisualIntent,
  hasSourceMatch: boolean,
): ImageStrategy {
  if (role === "proof") return hasSourceMatch ? "source" : "stock";
  if (role === "diagram") return "generate";
  if (visualIntent === "editorial" && !hasSourceMatch) return "generate";
  if (hasSourceMatch) return "source";
  return "stock";
}

function buildRoleAwareImageQuery(params: {
  content: PreparedTopicContent;
  section?: PreparedTopicSection;
  role: ImageRole;
  visualIntent: VisualIntent;
}): string {
  const title = normalizeText(params.content.title);
  const heading = normalizeText(params.section?.heading);
  const highlights = (params.content.highlights || []).map((value) => normalizeText(value)).filter(Boolean);

  if (params.role === "hero") {
    return dedupeStrings([title, highlights[0], "editorial blog hero image", "realistic"]).join(", ");
  }

  if (params.role === "proof") {
    return dedupeStrings([heading, title, "real example", "documented scene"]).join(", ");
  }

  if (params.role === "diagram") {
    return dedupeStrings([heading, title, params.visualIntent === "comparison" ? "comparison diagram" : "concept diagram"]).join(", ");
  }

  return dedupeStrings([heading, title, highlights[0], "real scene"]).join(", ");
}

function buildAlternativeImageQueries(params: {
  content: PreparedTopicContent;
  section?: PreparedTopicSection;
  role: ImageRole;
  visualIntent: VisualIntent;
}): string[] {
  const title = normalizeText(params.content.title);
  const heading = normalizeText(params.section?.heading);
  const firstHighlight = normalizeText(params.content.highlights?.[0]);

  return dedupeStrings([
    [heading, title].filter(Boolean).join(", "),
    [firstHighlight, heading, params.visualIntent].filter(Boolean).join(", "),
    [title, params.role, params.visualIntent].filter(Boolean).join(", "),
  ]).slice(0, 3);
}

function buildImageReason(role: ImageRole, strategy: ImageStrategy, visualIntent: VisualIntent): string {
  const roleText =
    role === "hero" ? "도입 분위기" : role === "proof" ? "근거/신뢰" : role === "diagram" ? "비교/구조" : "장면";
  const strategyText =
    strategy === "source" ? "출처 이미지 우선" : strategy === "stock" ? "리서치 스톡 우선" : strategy === "generate" ? "직접 생성 우선" : "이미지 생략";
  return `${roleText} 역할이며 ${strategyText}으로 처리합니다. 시각 의도는 ${visualIntent}입니다.`;
}

function buildChatGPTImagePrompt(item: TopicVisualPlanItem, query: string): string {
  const role = item.role || "inline";
  const subject = normalizeText(item.subject) || normalizeText(query) || "블로그 이미지";
  const scene = normalizeText(item.scene);
  const intent = item.visualIntent || "editorial";
  const roleText =
    role === "hero"
      ? "글 첫 화면에 들어갈 대표 이미지"
      : role === "diagram"
        ? "비교 설명에 들어갈 시각 비교 이미지"
        : role === "proof"
          ? "근거/신뢰를 보강하는 이미지"
          : "본문 중간에 자연스럽게 들어갈 장면 이미지";

  return [
    "아래 조건으로 블로그용 이미지를 1장만 바로 생성해줘.",
    "설명문이나 사족 없이 이미지 생성만 진행해줘.",
    `역할: ${roleText}`,
    `핵심 주제: ${subject}`,
    scene ? `보여줄 장면: ${scene}` : "",
    `보조 힌트: ${normalizeText(query)}`,
    `시각 톤: ${intent}`,
    "모바일에서 한눈에 읽히는 단일 구도로 만들어줘.",
    "글자, 캡션, 로고, 워터마크, 브랜드 UI, 콜라주 느낌은 금지.",
    role === "diagram"
      ? "비교가 바로 보이도록 단순하고 선명한 에디토리얼 일러스트 또는 콘셉트 이미지를 만들어줘."
      : "과한 스톡 이미지 느낌 없이 자연스럽고 세련된 에디토리얼 이미지를 만들어줘.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function polishTopicCandidate(params: {
  rootTopic: string;
  keywords: string[];
  selectedCandidate: TopicCraftCandidate;
  selectedAngleBrief?: NarrativeAngleBrief | null;
  selectedReason: string;
  type: TopicType;
  style: string | null;
  sourceSummaries: TopicSourceSummary[];
}): Promise<PreparedTopicContent> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "lead", "highlights", "sections", "hashtags", "meta"],
    properties: {
      title: { type: "string" },
      lead: { type: "string", minLength: 60 },
      highlights: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: { type: "string", minLength: 6 },
      },
      sections: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["heading", "summary", "body", "kind", "stockQuery", "sourceRefIds"],
          properties: {
            heading: { type: "string", minLength: 3 },
            summary: { type: "string", minLength: 8, maxLength: 32 },
            body: { type: "string", minLength: 110 },
            kind: {
              type: "string",
              enum: ["hook", "scene", "mistake", "comparison", "proof", "takeaway"],
            },
            bullets: {
              type: "array",
              maxItems: 2,
              items: { type: "string", minLength: 6, maxLength: 28 },
            },
            stockQuery: { type: "string" },
            sourceRefIds: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
      hashtags: {
        type: "array",
        items: { type: "string" },
      },
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "tone", "selectedReason"],
        properties: {
          summary: { type: "string" },
          tone: { type: "string" },
          selectedReason: { type: "string" },
        },
      },
    },
  };

  const prompt = buildPolishPrompt(params);
  let polished: PreparedTopicContent;

  try {
    polished = await runStructuredPrompt<PreparedTopicContent>({
      schemaName: "topic_polish_writer",
      schema,
      prompt,
      allowBrowserFallback: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[topic-task-pipeline] structured polish failed:", message);

    if (TOPIC_CODEX_FALLBACK_ENABLED) {
      try {
        const fromCodex = await runCodexStructured<PreparedTopicContent>(prompt);
        if (fromCodex && Array.isArray(fromCodex.sections) && fromCodex.sections.length >= 3) {
          polished = fromCodex;
          const parsed = parsePreparedTopicContent(serializePreparedTopicContent(polished));
          if (!parsed || parsed.sections.length === 0) {
            throw new Error("codex 결과를 구조화 JSON으로 정규화하지 못했습니다.");
          }
          return finalizePolishedContent(parsed, params);
        }
        throw new Error("codex 응답이 유효하지 않습니다.");
      } catch (codexError) {
        const codexMsg = codexError instanceof Error ? codexError.message : String(codexError);
        console.warn("[topic-task-pipeline] codex polish failed:", codexMsg);
      }
    }

    if (TOPIC_BROWSER_FALLBACK_ENABLED) {
      try {
        polished = await withTimeout(
          runBrowserStructured<PreparedTopicContent>(prompt),
          TOPIC_BROWSER_FALLBACK_TIMEOUT_MS,
          "topic browser polish fallback",
        );
      } catch (browserError) {
        const browserMsg = browserError instanceof Error ? browserError.message : String(browserError);
        console.warn(
          "[topic-task-pipeline] browser polish fallback failed, using deterministic fallback:",
          browserMsg,
        );
        polished = buildFallbackPolishedContent(params);
      }
    } else {
      polished = buildFallbackPolishedContent(params);
    }
  }

  const parsed = parsePreparedTopicContent(serializePreparedTopicContent(polished));
  if (!parsed || parsed.sections.length === 0) {
    throw new Error("polish 단계가 유효한 구조화 JSON을 반환하지 않았습니다.");
  }
  let editorial = parsed;
  const codexEdited = await runCodexEditorialPass(parsed, {
    rootTopic: params.rootTopic,
    keywords: params.keywords,
    type: params.type,
    sourceSummaries: params.sourceSummaries,
  }).catch(() => null);
  if (codexEdited) {
    const reparsed = parsePreparedTopicContent(serializePreparedTopicContent(codexEdited));
    if (reparsed?.sections.length) {
      editorial = reparsed;
    }
  }
  return finalizePolishedContent(editorial, params);
}

function buildVisualPlan(
  content: PreparedTopicContent,
  sourceImages: SourceImageCandidate[],
  topicCraftImagePrompt: string | undefined,
): TopicVisualPlan {
  const heroSource = sourceImages[0] ?? null;
  const heroPreferred = heroSource?.pageUrl ?? null;
  const heroIntent = classifyVisualIntent("hero", content.sections[0], content);
  const heroStrategy = chooseImageStrategy("hero", heroIntent, Boolean(heroSource));
  const fallbackHeroQuery = buildRoleAwareImageQuery({
    content,
    section: content.sections[0],
    role: "hero",
    visualIntent: heroIntent,
  });
  const heroQuery =
    imageQueryNeedsCleanup(normalizeText(topicCraftImagePrompt))
      ? fallbackHeroQuery || normalizeText(content.sections[0]?.stockQuery)
      : normalizeText(topicCraftImagePrompt);

  const hero: TopicVisualPlanItem | null = heroQuery
    ? {
        query: heroQuery,
        preferredSource: heroPreferred,
        fallbackToAi: heroStrategy !== "none",
        sourceRefIds: heroSource ? [heroSource.sourceRefId] : [],
        slotId: "hero",
        sectionIndex: 0,
        role: "hero",
        strategy: heroStrategy,
        visualIntent: heroIntent,
        subject: normalizeText(content.title),
        scene: normalizeText(content.highlights?.[0] || content.sections[0]?.heading) || null,
        why: buildImageReason("hero", heroStrategy, heroIntent),
        altQueries: buildAlternativeImageQueries({
          content,
          section: content.sections[0],
          role: "hero",
          visualIntent: heroIntent,
        }),
        confidence: heroSource ? 0.82 : heroStrategy === "generate" ? 0.68 : 0.62,
      }
    : null;

  const inlineCandidates: PlannedInlineImage[] = content.sections
    .slice(1)
    .flatMap((section, sectionOffset) => {
      if (section.kind === "hook" || section.kind === "takeaway") {
        return [];
      }
      const sectionIndex = sectionOffset + 1;
      const sourceRefIds =
        section.sourceRefIds.length > 0
          ? section.sourceRefIds
          : sourceImages[sectionIndex]?.sourceRefId
            ? [sourceImages[sectionIndex].sourceRefId]
            : [];
      const role = classifyImageRole(section, sectionIndex, sourceRefIds.length > 0);
      const visualIntent = classifyVisualIntent(role, section, content);
      const strategy = chooseImageStrategy(role, visualIntent, sourceRefIds.length > 0);
      const query = imageQueryNeedsCleanup(normalizeText(section.stockQuery))
        ? buildRoleAwareImageQuery({ content, section, role, visualIntent })
        : normalizeText(section.stockQuery);

      if (!query) {
        return [];
      }

      return [{
        sectionIndex,
        priority: scoreInlineImageNeed(section, role),
        item: {
          query,
          preferredSource: sourceImages[sectionIndex]?.pageUrl ?? null,
          fallbackToAi: strategy !== "none",
          sourceRefIds,
          slotId: normalizeText(section.imageSlotId) || buildSectionImageSlotId(sectionIndex),
          sectionIndex,
          role,
          strategy,
          visualIntent,
          subject: normalizeText(section.heading) || normalizeText(content.title),
          scene: truncateText(normalizeText(section.body), 90) || null,
          why: buildImageReason(role, strategy, visualIntent),
          altQueries: buildAlternativeImageQueries({ content, section, role, visualIntent }),
          confidence: sourceRefIds.length > 0 ? 0.82 : strategy === "generate" ? 0.68 : 0.61,
        },
      }];
    });

  const inline = inlineCandidates
    .sort((a, b) => b.priority - a.priority || a.sectionIndex - b.sectionIndex)
    .slice(0, 3)
    .sort((a, b) => a.sectionIndex - b.sectionIndex)
    .map((entry) => entry.item);

  return {
    hero,
    inline: inline.filter((item) => item.query.length > 0),
  };
}

function buildSectionImageSlotId(index: number): string {
  return `section-${index}`;
}

function attachSectionImageSlots(content: PreparedTopicContent): PreparedTopicContent {
  return {
    ...content,
    sections: content.sections.map((section, index) => ({
      ...section,
      imageSlotId: normalizeText(section.imageSlotId) || buildSectionImageSlotId(index),
    })),
  };
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function acquirePrepareLock(taskId: string): () => void {
  ensureDir(PREPARE_LOCK_ROOT);
  const lockPath = path.join(PREPARE_LOCK_ROOT, `${taskId}.lock`);

  if (fs.existsSync(lockPath)) {
    try {
      const stats = fs.statSync(lockPath);
      if (Date.now() - stats.mtimeMs > PREPARE_LOCK_STALE_MS) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // Ignore and fall through to lock acquisition.
    }
  }

  let fd: number | null = null;
  try {
    fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(
      fd,
      JSON.stringify({
        taskId,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new TopicPrepareConflictError();
    }
    throw error;
  }

  return () => {
    try {
      if (fd !== null) {
        fs.closeSync(fd);
      }
    } catch {
      // Ignore cleanup failures.
    }
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // Ignore cleanup failures.
    }
  };
}

function getImageExtensionFromContentType(contentType: string | null | undefined): string | null {
  const normalized = normalizeText(contentType).toLowerCase();
  if (!normalized.startsWith("image/")) return null;
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return null;
}

function getImageExtensionFromUrl(rawUrl: string): string | null {
  try {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
    const matched = pathname.match(/\.(png|jpe?g|webp|gif)$/i);
    if (!matched?.[1]) return null;
    return matched[1].toLowerCase() === "jpeg" ? "jpg" : matched[1].toLowerCase();
  } catch {
    return null;
  }
}

async function downloadRemoteFile(url: string, destStem: string): Promise<DownloadedImageAsset | null> {
  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
      },
      IMAGE_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type");
    if (contentType && !contentType.toLowerCase().startsWith("image/")) {
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const extension =
      getImageExtensionFromContentType(contentType) ||
      getImageExtensionFromUrl(response.url) ||
      getImageExtensionFromUrl(url) ||
      "jpg";
    const localPath = `${destStem}.${extension}`;
    ensureDir(path.dirname(localPath));
    fs.writeFileSync(localPath, buffer);
    return {
      localPath,
      contentType,
    };
  } catch {
    return null;
  }
}

async function generateTopicCraftImage(query: string, destStem: string): Promise<string | null> {
  const { stdout } = await withTimeout(
    execFileAsync(
      "curl",
      [
        "-sS",
        "-X",
        "POST",
        TOPIC_CRAFT_GENERATE_IMAGE_URL,
        "-H",
        "Content-Type: application/json",
        ...TOPIC_CRAFT_AUTH_HEADERS,
        "--data",
        JSON.stringify({ prompt: query }),
      ],
      { maxBuffer: CURL_MAX_BUFFER_BYTES },
    ),
    TOPIC_CRAFT_TIMEOUT_MS,
    "topic-craft generate-image",
  );
  const payload = JSON.parse(stdout) as { image_url?: string; imageUrl?: string; url?: string };
  const imageUrl = normalizeText(payload.image_url || payload.imageUrl || payload.url);
  if (/^https?:\/\//i.test(imageUrl)) {
    const downloaded = await downloadRemoteFile(imageUrl, destStem);
    return downloaded?.localPath || null;
  }
  if (!imageUrl.startsWith("data:image/")) return null;

  const commaIndex = imageUrl.indexOf(",");
  if (commaIndex < 0) return null;
  const base64 = imageUrl.slice(commaIndex + 1);
  const buffer = Buffer.from(base64, "base64");
  const extension = getImageExtensionFromContentType(imageUrl.slice(5, commaIndex).split(";")[0]) || "png";
  const localPath = `${destStem}.${extension}`;
  ensureDir(path.dirname(localPath));
  fs.writeFileSync(localPath, buffer);
  return localPath;
}

function addDaedalOption(args: string[], flag: string, value: string) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.toLowerCase() === "none") return;
  args.push(flag, normalized);
}

async function generateDaedalImage(prompt: string, destStem: string): Promise<string | null> {
  if (!TOPIC_DAEDAL_IMAGE_ENABLED || !HAS_OPENAI_API_KEY) return null;

  const outPath = `${destStem}.png`;
  ensureDir(path.dirname(outPath));

  const args = [prompt, "--quiet", "-o", outPath];
  addDaedalOption(args, "--preset", TOPIC_DAEDAL_PRESET);
  addDaedalOption(args, "--size", TOPIC_DAEDAL_SIZE);
  addDaedalOption(args, "--quality", TOPIC_DAEDAL_QUALITY);
  addDaedalOption(args, "--model", TOPIC_DAEDAL_MODEL);

  try {
    const { stdout } = await withTimeout(
      execFileAsync(TOPIC_DAEDAL_BIN, args, {
        maxBuffer: CURL_MAX_BUFFER_BYTES,
        timeout: TOPIC_DAEDAL_IMAGE_TIMEOUT_MS,
      }),
      TOPIC_DAEDAL_IMAGE_TIMEOUT_MS,
      "Daedal image generation",
    );
    const printedPath = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    const localPath = printedPath || outPath;
    if (fs.existsSync(localPath)) return localPath;
    if (fs.existsSync(outPath)) return outPath;
    return null;
  } catch (error) {
    console.warn("[topic-task-pipeline] Daedal image generation failed:", error);
    return null;
  }
}

async function generateDaedalImagesBatch(
  jobs: ChatGPTImageBatchJob[],
): Promise<Map<string, PreGeneratedImageAsset>> {
  const result = new Map<string, PreGeneratedImageAsset>();
  if (!TOPIC_DAEDAL_IMAGE_ENABLED || !HAS_OPENAI_API_KEY || jobs.length === 0) return result;

  for (const job of jobs) {
    const localPath = await generateDaedalImage(job.prompt, job.outStem);
    if (localPath) {
      result.set(job.id, {
        localPath,
        provider: "daedal",
        creditName: "Daedal",
        creditUrl: "https://github.com/Hostingglobal-Tech/daedal",
        sourcePrefix: "daedal",
      });
    }
  }

  return result;
}

async function generateChatGPTBrowserImage(
  item: TopicVisualPlanItem,
  query: string,
  destStem: string,
): Promise<string | null> {
  if (!ALLOW_CHATGPT_BROWSER_MODE) return null;

  try {
    const { stdout } = await withTimeout(
      execFileAsync(
        process.execPath,
        [
          TS_NODE_BIN,
          "--project",
          "tsconfig.scripts.json",
          "scripts/chatgpt-generate-image.ts",
          "--prompt",
          buildChatGPTImagePrompt(item, query),
          "--out-stem",
          destStem,
          "--gpt-url",
          CHATGPT_IMAGE_GPT_URL,
        ],
        { maxBuffer: CURL_MAX_BUFFER_BYTES },
      ),
      180_000,
      `ChatGPT OAuth image generation (${item.role || "inline"})`,
    );
    const payload = JSON.parse(stdout) as { ok?: boolean; localPath?: string };
    const localPath = normalizeText(payload.localPath);
    return localPath || null;
  } catch (error) {
    console.warn("[topic-task-pipeline] ChatGPT browser image generation failed:", error);
    return null;
  }
}

async function generateChatGPTBrowserImagesBatch(
  jobs: ChatGPTImageBatchJob[],
): Promise<Map<string, string>> {
  if (!ALLOW_CHATGPT_BROWSER_MODE) {
    return new Map();
  }

  if (jobs.length === 0) {
    return new Map();
  }

  const batchDir = path.join(IMAGE_ROOT, "_chatgpt-batch");
  ensureDir(batchDir);
  const jobsFile = path.join(
    batchDir,
    `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`,
  );

  try {
    fs.writeFileSync(jobsFile, JSON.stringify(jobs), "utf8");
    const timeoutMs = Math.min(
      TOPIC_CHATGPT_IMAGE_BATCH_TIMEOUT_MS,
      Math.max(75_000, jobs.length * 45_000),
    );
    const { stdout } = await withTimeout(
      execFileAsync(
        process.execPath,
        [
          TS_NODE_BIN,
          "--project",
          "tsconfig.scripts.json",
          "scripts/chatgpt-generate-image-batch.ts",
          "--jobs-file",
          jobsFile,
          "--gpt-url",
          CHATGPT_IMAGE_GPT_URL,
        ],
        { maxBuffer: CURL_MAX_BUFFER_BYTES },
      ),
      timeoutMs,
      `ChatGPT OAuth image batch (${jobs.length})`,
    );

    const payload = JSON.parse(stdout) as {
      jobs?: Array<{ id?: string; localPath?: string | null }>;
    };
    const result = new Map<string, string>();
    for (const item of payload.jobs || []) {
      const id = normalizeText(item.id);
      const localPath = normalizeText(item.localPath);
      if (id && localPath) {
        result.set(id, localPath);
      }
    }
    return result;
  } catch (error) {
    console.warn("[topic-task-pipeline] ChatGPT browser image batch failed:", error);
    return new Map();
  } finally {
    if (fs.existsSync(jobsFile)) {
      fs.unlinkSync(jobsFile);
    }
  }
}

async function resolveStockImageUrl(query: string): Promise<ResolvedStockImage | null> {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;

  if (PEXELS_API_KEY) {
    try {
      const response = await fetchWithTimeout(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(normalizedQuery)}&per_page=6&orientation=landscape`,
        {
          headers: {
            Authorization: PEXELS_API_KEY,
          },
        },
        STOCK_PROVIDER_TIMEOUT_MS,
      );
      if (response.ok) {
        const payload = (await response.json()) as {
          photos?: Array<{
            src?: { large2x?: string; large?: string; original?: string };
            photographer?: string;
            photographer_url?: string;
            url?: string;
          }>;
        };
        const photo = payload.photos?.find((entry) =>
          normalizeText(entry.src?.large2x || entry.src?.large || entry.src?.original),
        );
        const resolvedUrl = normalizeText(photo?.src?.large2x || photo?.src?.large || photo?.src?.original);
        if (resolvedUrl) {
          return {
            downloadUrl: resolvedUrl,
            creditName: normalizeText(photo?.photographer) || "Pexels",
            creditUrl: normalizeText(photo?.photographer_url || photo?.url) || "https://www.pexels.com/",
            provider: "pexels",
          };
        }
      }
    } catch {
      // fall through to the next provider
    }
  }

  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!unsplashKey) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(
        normalizedQuery,
      )}&orientation=landscape&client_id=${encodeURIComponent(unsplashKey)}`,
      {},
      STOCK_PROVIDER_TIMEOUT_MS,
    );
    if (response.ok) {
      const payload = (await response.json()) as {
        urls?: { regular?: string };
        user?: { name?: string; links?: { html?: string } };
      };
      const resolvedUrl = normalizeText(payload.urls?.regular);
      if (resolvedUrl) {
        return {
          downloadUrl: resolvedUrl,
          creditName: normalizeText(payload.user?.name) || "Unsplash",
          creditUrl: normalizeText(payload.user?.links?.html) || "https://unsplash.com/",
          provider: "unsplash",
        };
      }
    }
  } catch {
    // Let the caller decide whether to continue to AI or generic fallback.
  }

  return null;
}

async function downloadStockImage(
  query: string,
  destStem: string,
): Promise<(ResolvedStockImage & { localPath: string }) | null> {
  const stock = await resolveStockImageUrl(query);
  if (!stock) return null;
  const downloaded = await downloadRemoteFile(stock.downloadUrl, destStem);
  if (downloaded) {
    return {
      ...stock,
      localPath: downloaded.localPath,
    };
  }

  const fallbackKeywords = buildStockFallbackKeywords(query);
  const seedSlug = buildSeedSlug(fallbackKeywords);
  const fallbackCandidates: ResolvedStockImage[] = [
    {
      downloadUrl: `https://picsum.photos/seed/${encodeURIComponent(seedSlug)}/1200/800`,
      creditName: "Picsum",
      creditUrl: "https://picsum.photos/",
      provider: "picsum",
    },
    {
      downloadUrl: `https://dummyimage.com/1200x800/0f172a/f8fafc.png&text=${encodeURIComponent(
        fallbackKeywords.replace(/,/g, " "),
      )}`,
      creditName: "DummyImage",
      creditUrl: "https://dummyimage.com/",
      provider: "dummyimage",
    },
  ];

  for (const fallback of fallbackCandidates) {
    const fallbackDownloaded = await downloadRemoteFile(fallback.downloadUrl, destStem);
    if (fallbackDownloaded) {
      return {
        ...fallback,
        localPath: fallbackDownloaded.localPath,
      };
    }
  }

  return null;
}

async function downloadGenericFallbackImage(
  query: string,
  destStem: string,
): Promise<(ResolvedStockImage & { localPath: string }) | null> {
  const fallbackKeywords = buildStockFallbackKeywords(query);
  const seedSlug = buildSeedSlug(fallbackKeywords);
  const fallbackCandidates: ResolvedStockImage[] = [
    {
      downloadUrl: `https://loremflickr.com/1200/800/${encodeURIComponent(fallbackKeywords)}`,
      creditName: "LoremFlickr",
      creditUrl: "https://loremflickr.com/",
      provider: "loremflickr",
    },
    {
      downloadUrl: `https://picsum.photos/seed/${encodeURIComponent(seedSlug)}/1200/800`,
      creditName: "Picsum",
      creditUrl: "https://picsum.photos/",
      provider: "picsum",
    },
    {
      downloadUrl: `https://dummyimage.com/1200x800/0f172a/f8fafc.png&text=${encodeURIComponent(
        fallbackKeywords.replace(/,/g, " "),
      )}`,
      creditName: "DummyImage",
      creditUrl: "https://dummyimage.com/",
      provider: "dummyimage",
    },
  ];

  for (const fallback of fallbackCandidates) {
    const fallbackDownloaded = await downloadRemoteFile(fallback.downloadUrl, destStem);
    if (fallbackDownloaded) {
      return {
        ...fallback,
        localPath: fallbackDownloaded.localPath,
      };
    }
  }

  return null;
}

function findMatchingSourceImage(
  item: TopicVisualPlanItem,
  sourceImages: SourceImageCandidate[],
  usedUrls: Set<string>,
) {
  const normalizedRefs = new Set(item.sourceRefIds.map((value) => normalizeText(value)).filter(Boolean));
  const directUnusedMatch = sourceImages.find(
    (source) =>
      !usedUrls.has(source.imageUrl) &&
      (normalizedRefs.has(source.sourceRefId) ||
        normalizedRefs.has(source.pageUrl) ||
        normalizeText(item.preferredSource) === source.pageUrl),
  );
  if (directUnusedMatch) return directUnusedMatch;

  const directReusableMatch = sourceImages.find(
    (source) =>
      normalizedRefs.has(source.sourceRefId) ||
      normalizedRefs.has(source.pageUrl) ||
      normalizeText(item.preferredSource) === source.pageUrl,
  );
  if (directReusableMatch) return directReusableMatch;

  return sourceImages.find((source) => !usedUrls.has(source.imageUrl)) || null;
}

async function resolveImageAsset(
  draftId: string,
  item: TopicVisualPlanItem,
  role: string,
  sourceImages: SourceImageCandidate[],
  usedSourceUrls: Set<string>,
  index: number,
  options: {
    allowGenerated?: boolean;
    preGenerated?: PreGeneratedImageAsset | null;
    skipChatGPTBrowser?: boolean;
  } = {},
): Promise<PreparedImageAsset> {
  const draftDir = path.join(IMAGE_ROOT, draftId);
  ensureDir(draftDir);
  const fileStem = path.join(draftDir, `${role}-${index + 1}`);
  const strategy = item.strategy || "stock";
  const stockQueries = dedupeStrings([item.query, ...(item.altQueries || [])]);
  const allowGenerated = options.allowGenerated !== false;
  const preGenerated = options.preGenerated?.localPath ? options.preGenerated : null;
  const skipChatGPTBrowser = Boolean(options.skipChatGPTBrowser);

  const trySource = async (): Promise<PreparedImageAsset | null> => {
    const sourceMatch = findMatchingSourceImage(item, sourceImages, usedSourceUrls);
    if (!sourceMatch) return null;
    const downloaded = await downloadRemoteFile(sourceMatch.imageUrl, fileStem);
    if (!downloaded) return null;
    usedSourceUrls.add(sourceMatch.imageUrl);
    return {
      sourceUrl: sourceMatch.imageUrl,
      localPath: downloaded.localPath,
      creditName: safeHost(sourceMatch.pageUrl),
      creditUrl: sourceMatch.pageUrl,
      role,
      query: item.query,
      provider: "source",
    };
  };

  const tryStock = async (): Promise<PreparedImageAsset | null> => {
    for (const stockQuery of stockQueries) {
      const stockDownloaded = await downloadStockImage(stockQuery, fileStem);
      if (stockDownloaded) {
        return {
          sourceUrl: stockDownloaded.downloadUrl,
          localPath: stockDownloaded.localPath,
          creditName: stockDownloaded.creditName,
          creditUrl: stockDownloaded.creditUrl,
          role,
          query: stockQuery,
          provider: stockDownloaded.provider,
        };
      }
    }
    return null;
  };

  const tryGenerated = async (): Promise<PreparedImageAsset | null> => {
    if (!allowGenerated || !item.fallbackToAi) return null;
    if (preGenerated) {
      return {
        sourceUrl: `${preGenerated.sourcePrefix}:${stockQueries[0] || item.query || role}`,
        localPath: preGenerated.localPath,
        creditName: preGenerated.creditName,
        creditUrl: preGenerated.creditUrl,
        role,
        query: stockQueries[0] || item.query,
        provider: preGenerated.provider,
      };
    }
    for (const generatedQuery of stockQueries) {
      const daedalDownloaded = await generateDaedalImage(
        buildChatGPTImagePrompt(item, generatedQuery),
        fileStem,
      );
      if (daedalDownloaded) {
        return {
          sourceUrl: `daedal:${generatedQuery}`,
          localPath: daedalDownloaded,
          creditName: "Daedal",
          creditUrl: "https://github.com/Hostingglobal-Tech/daedal",
          role,
          query: generatedQuery,
          provider: "daedal",
        };
      }

      if (!skipChatGPTBrowser) {
        const chatgptDownloaded = await generateChatGPTBrowserImage(item, generatedQuery, fileStem);
        if (chatgptDownloaded) {
          return {
            sourceUrl: `chatgpt:${generatedQuery}`,
            localPath: chatgptDownloaded,
            creditName: "ChatGPT",
            creditUrl: "https://chatgpt.com/",
            role,
            query: generatedQuery,
            provider: "chatgpt-oauth-image",
          };
        }
      }

      const topicCraftDownloaded = await generateTopicCraftImage(generatedQuery, fileStem);
      if (topicCraftDownloaded) {
        return {
          sourceUrl: `topic-craft:${generatedQuery}`,
          localPath: topicCraftDownloaded,
          creditName: "topic-craft",
          creditUrl: null,
          role,
          query: generatedQuery,
          provider: "topic-craft-ai",
        };
      }
    }
    return null;
  };

  const orderedResolvers =
    strategy === "source"
      ? [trySource, tryStock, tryGenerated]
      : strategy === "generate"
        ? [tryGenerated, tryStock, trySource]
        : [tryStock, trySource, tryGenerated];

  const enabledResolvers = allowGenerated ? orderedResolvers : orderedResolvers.filter((resolver) => resolver !== tryGenerated);

  for (const resolver of enabledResolvers) {
    const resolved = await resolver();
    if (resolved) return resolved;
  }

  if (TOPIC_PIPELINE_ALLOW_GENERIC_IMAGE_FALLBACK) {
    const genericDownloaded = await downloadGenericFallbackImage(item.query, fileStem);
    if (genericDownloaded) {
      return {
        sourceUrl: genericDownloaded.downloadUrl,
        localPath: genericDownloaded.localPath,
        creditName: genericDownloaded.creditName,
        creditUrl: genericDownloaded.creditUrl,
        role,
        query: item.query,
        provider: genericDownloaded.provider,
      };
    }
  }

  return {
    sourceUrl: item.preferredSource || `unresolved:${item.query}`,
    localPath: null,
    creditName: null,
    creditUrl: item.preferredSource,
    role,
    query: item.query,
    provider: "unresolved",
  };
}

async function resolveDraftImages(
  draftId: string,
  imagePlan: TopicVisualPlan,
  sourceImages: SourceImageCandidate[],
): Promise<PreparedImageAsset[]> {
  const usedSourceUrls = new Set<string>();
  const entries: Array<{
    key: string;
    item: TopicVisualPlanItem;
    role: string;
    index: number;
  }> = [];

  if (imagePlan.hero) {
    entries.push({
      key: "hero-0",
      item: imagePlan.hero,
      role: "hero",
      index: 0,
    });
  }

  for (const [index, item] of imagePlan.inline.entries()) {
    entries.push({
      key: `inline-${index}`,
      item,
      role: "inline",
      index,
    });
  }

  const resolvedByKey = new Map<string, PreparedImageAsset>();
  const pendingGenerated = new Map<
    string,
    {
      item: TopicVisualPlanItem;
      role: string;
      index: number;
    }
  >();

  for (const entry of entries) {
    if (entry.item.strategy === "generate") {
      pendingGenerated.set(entry.key, {
        item: entry.item,
        role: entry.role,
        index: entry.index,
      });
      continue;
    }

    const resolved = await resolveImageAsset(
      draftId,
      entry.item,
      entry.role,
      sourceImages,
      usedSourceUrls,
      entry.index,
      { allowGenerated: false },
    );

    if (resolved.provider === "unresolved" && entry.item.fallbackToAi) {
      pendingGenerated.set(entry.key, {
        item: entry.item,
        role: entry.role,
        index: entry.index,
      });
      continue;
    }

    resolvedByKey.set(entry.key, resolved);
  }

  if (pendingGenerated.size > 0) {
    const batchJobs: ChatGPTImageBatchJob[] = Array.from(pendingGenerated.entries()).map(([key, entry]) => ({
      id: key,
      prompt: buildChatGPTImagePrompt(entry.item, entry.item.query),
      outStem: path.join(IMAGE_ROOT, draftId, `${entry.role}-${entry.index + 1}`),
    }));
    const preGeneratedMap = await generateDaedalImagesBatch(batchJobs);
    const remainingJobs = batchJobs.filter((job) => !preGeneratedMap.has(job.id));
    const chatgptGeneratedMap = await generateChatGPTBrowserImagesBatch(remainingJobs);
    for (const [id, localPath] of chatgptGeneratedMap.entries()) {
      preGeneratedMap.set(id, {
        localPath,
        provider: "chatgpt-oauth-image",
        creditName: "ChatGPT",
        creditUrl: "https://chatgpt.com/",
        sourcePrefix: "chatgpt",
      });
    }

    for (const [key, entry] of pendingGenerated.entries()) {
      const resolved = await resolveImageAsset(
        draftId,
        entry.item,
        entry.role,
        sourceImages,
        usedSourceUrls,
        entry.index,
        {
          allowGenerated: true,
          preGenerated: preGeneratedMap.get(key) ?? null,
          skipChatGPTBrowser: true,
        },
      );
      resolvedByKey.set(key, resolved);
    }
  }

  return entries
    .map((entry) => resolvedByKey.get(entry.key))
    .filter((value): value is PreparedImageAsset => Boolean(value));
}

function safeHost(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

async function setTaskStage(
  taskId: string,
  stage: TopicTaskPipelineStage,
  data: Record<string, unknown> = {},
) {
  await prisma.topicPostTask.update({
    where: { id: taskId },
    data: {
      status: stage,
      pipelineStage: stage,
      ...data,
    },
  });
}

function buildDraftSeed(candidate: TopicCraftCandidate, selection: TopicSelectionDecision, score: ScoredTopicCandidate) {
  return JSON.stringify({
    title: candidate.title || "",
    imagePrompt: candidate.image_prompt || "",
    subtopics: candidate.subtopics || [],
    angleBriefId: candidate.angleBriefId || "",
    thesis: candidate.thesis || "",
    readerPromise: candidate.readerPromise || "",
    requiredEvidence: candidate.requiredEvidence || [],
    selectionReason: selection.reason,
    score: score.score,
  });
}

function scoreContentReadiness(readiness: TopicTaskContentReadiness): number {
  if (Number.isFinite(readiness.score)) return Math.max(0, Math.min(100, readiness.score));

  const baseScoreByCode: Record<TopicTaskContentReadiness["code"], number> = {
    ok: 100,
    "not-prepared": 0,
    "missing-lead": 35,
    "missing-highlights": 45,
    "too-few-sections": 40,
    "weak-keyword-coverage": 46,
    "meta-writing-contamination": 50,
    "broken-copy": 48,
    "repeated-structure": 55,
    "unsupported-factual-claim": 0,
    "missing-affiliate-disclosure": 0,
    "broken-critical-media": 0,
    "quality-score-below-threshold": 60,
    "manual-review-required": 85,
  };
  const sectionCredit = Math.min(readiness.sectionCount, 5) * 5;
  const highlightCredit = Math.min(readiness.highlightCount, 3) * 5;

  return Math.min(95, baseScoreByCode[readiness.code] + sectionCredit + highlightCredit);
}

async function upsertCampaignForTask(
  task: NonNullable<TaskRecord>,
  packet: TopicResearchPacket,
  sourceUrls: string[],
  type: TopicType,
) {
  if (task.campaignId) {
    return prisma.topicCampaign.update({
      where: { id: task.campaignId },
      data: {
        rootTopic: task.topic,
        type,
        style: null,
        sourceUrls: JSON.stringify(sourceUrls),
        researchPackJson: JSON.stringify(packet),
        status: "RESEARCH_DONE",
      },
    });
  }

  return prisma.topicCampaign.create({
    data: {
      rootTopic: task.topic,
      type,
      style: null,
      sourceUrls: JSON.stringify(sourceUrls),
      researchPackJson: JSON.stringify(packet),
      status: "RESEARCH_DONE",
    },
  });
}

async function resetCampaignDrafts(campaignId: string) {
  const existingDrafts = await prisma.topicDraft.findMany({
    where: { campaignId },
    select: { id: true },
  });

  const draftIds = existingDrafts.map((draft) => draft.id);
  if (draftIds.length > 0) {
    await prisma.topicDraftImage.deleteMany({
      where: { draftId: { in: draftIds } },
    });
  }

  await prisma.topicDraft.deleteMany({
    where: { campaignId },
  });
}

function buildCandidateDraftContent(candidate: TopicCraftCandidate): PreparedTopicContent {
  const sections = splitCandidateContent(candidate.content || "");
  return {
    title: normalizeText(candidate.title) || "주제 초안",
    sections,
    hashtags: Array.isArray(candidate.hashtags) ? candidate.hashtags.map((item) => item.replace(/^#/, "")) : [],
    meta: {
      summary: normalizeText(candidate.subtopics?.map((item) => item.summary).join(" ")) || "topic-craft 초안",
      tone: "초안",
      selectedReason: "",
    },
  };
}

export async function prepareTopicTask(taskId: string): Promise<PrepareTaskResult> {
  const task = await getTaskForPrepare(taskId);
  if (!task) {
    throw new Error("주제 태스크를 찾을 수 없습니다.");
  }
  const releaseLock = acquirePrepareLock(task.id);

  const topicType = mapTaskTypeToTopicType(task.type, {
    topic: task.topic,
    keywords: task.keywords,
    memo: task.memo,
    topicCraftCategory: task.topicCraftCategory,
  });
  const keywordList = parseKeywords(task.keywords || "");
  const explicitSourceUrls = extractSourceUrlsFromTask(task);
  const autoResearchSourceUrls =
    explicitSourceUrls.length > 0
      ? []
      : await discoverTopicSourceUrls(task.topic, topicType, keywordList).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[topic-task-pipeline] auto research source discovery failed: ${message}`);
          return [];
        });
  const sourceUrls = dedupeStrings([...explicitSourceUrls, ...autoResearchSourceUrls]);
  const topicCraftCategory = normalizeTopicCraftCategory(
    task.topicCraftCategory,
    topicType,
    [task.topic, task.keywords || "", task.memo || ""].join(" "),
  );
  let activeCampaignId = task.campaignId;

  try {
    await setTaskStage(task.id, "RESEARCHING", {
      topicCraftCategory,
      errorMessage: null,
      postUrl: null,
      publishedAt: null,
      selectedDraftId: null,
      preparedTitle: null,
      preparedContentJson: null,
      preparedContentHtml: null,
      preparedHashtags: null,
      narrativeAngleBriefsJson: null,
      imagePlanJson: null,
      contentReadinessReportJson: null,
      contentReadinessScore: null,
      contentReadinessPublishable: false,
    });

    const packetBase = await buildResearchSignals(task.topic, topicType, keywordList);
    const sourceSummaries = sanitizeSourceSummaries(
      sourceUrls.length > 0 ? await collectSourceSummaries(sourceUrls) : packetBase.sourceSummaries,
    );
    const sourceImages = sourceUrls.length > 0 ? await extractSourceImageCandidates(sourceUrls) : [];
    const packet: TopicResearchPacket = {
      ...packetBase,
      sourceUrls,
      sourceSummaries,
      trendSignals: dedupeResearchSignals([
        ...packetBase.trendSignals,
        ...buildSourceDerivedSignals(sourceSummaries, task.topic),
      ]).slice(0, 24),
    };
    const narrativeBriefs = buildNarrativeAngleBriefs({
      rootTopic: task.topic,
      topicType,
      keywords: keywordList,
      sourceSummaries,
      trendSignals: packet.trendSignals,
    });

    const campaign = await upsertCampaignForTask(task, packet, sourceUrls, topicType);
    activeCampaignId = campaign.id;
    await resetCampaignDrafts(campaign.id);

    await prisma.topicPostTask.update({
      where: { id: task.id },
      data: {
        campaignId: campaign.id,
      },
    });

    const topicCraftKeyword = buildTopicCraftKeyword(task.topic, [
      ...keywordList,
      ...packet.trendSignals.slice(0, 4).map((signal) => signal.keyword),
      ...sourceSummaries
        .map((summary) => normalizeText(summary.title || ""))
        .filter(Boolean)
        .slice(0, 2),
    ], narrativeBriefs);
    const rawCandidates = await requestTopicCraftCandidates({
      category: topicCraftCategory,
      keyword: topicCraftKeyword,
      rootTopic: task.topic,
      keywords: keywordList,
      topicType,
      packet,
      sourceSummaries,
      narrativeBriefs,
    });
    const scored = rawCandidates.map((candidate, index) => ({
      ...scoreTopicCandidate(candidate, task.topic, topicType, keywordList, sourceSummaries),
      index,
    }));

    const sorted = scored.slice().sort((left, right) => right.score - left.score);
    await setTaskStage(task.id, "CANDIDATES_READY");

    const createdDrafts = [];
    for (const candidate of scored) {
      const draft = await prisma.topicDraft.create({
        data: {
          campaignId: campaign.id,
          subTopic: normalizeText(candidate.candidate.title) || `${task.topic} 후보 ${candidate.index + 1}`,
          reason: candidate.preview.join(" | "),
          priority: candidate.index + 1,
          selectionScore: candidate.score,
          titleCandidates: JSON.stringify(
            [
              normalizeText(candidate.candidate.title),
              ...candidate.preview,
            ].filter(Boolean),
          ),
          contentJson: serializePreparedTopicContent(buildCandidateDraftContent(candidate.candidate)),
          citations: JSON.stringify(sourceSummaries),
          status: "DRAFT_READY",
          topicSeedJson: JSON.stringify({
            title: candidate.candidate.title,
            imagePrompt: candidate.candidate.image_prompt,
            subtopics: candidate.candidate.subtopics || [],
            angleBriefId: candidate.candidate.angleBriefId || "",
            thesis: candidate.candidate.thesis || "",
            readerPromise: candidate.candidate.readerPromise || "",
            requiredEvidence: candidate.candidate.requiredEvidence || [],
          }),
        },
      });
      createdDrafts.push(draft);
    }

    const selection = await decideSelectedCandidate(task.topic, keywordList, sorted);
    const selectedScore = scored.find((entry) => entry.index === selection.selectedIndex) || sorted[0];
    if (!selectedScore) {
      throw new Error("선택된 후보를 찾을 수 없습니다.");
    }
    const selectedAngleBrief = pickNarrativeAngleBrief(selectedScore.candidate, narrativeBriefs);

    await setTaskStage(task.id, "SELECTED");

    await prisma.topicDraft.update({
      where: { id: createdDrafts[selectedScore.index].id },
      data: {
        selectionReason: selection.reason,
        status: "REVIEW",
        topicSeedJson: buildDraftSeed(selectedScore.candidate, selection, selectedScore),
      },
    });

    await setTaskStage(task.id, "POLISHING");

    const polished = attachSectionImageSlots(await polishTopicCandidate({
      rootTopic: task.topic,
      keywords: keywordList,
      selectedCandidate: selectedScore.candidate,
      selectedAngleBrief,
      selectedReason: selection.reason,
      type: topicType,
      style: null,
      sourceSummaries,
    }));
    const preparedHtml = renderTopicContentToHtml(polished);
    const imagePlan = buildVisualPlan(polished, sourceImages, selectedScore.candidate.image_prompt);
    const selectedDraft = createdDrafts[selectedScore.index];

    await prisma.topicDraft.update({
      where: { id: selectedDraft.id },
      data: {
        selectionReason: selection.reason,
        titleCandidates: JSON.stringify(
          [polished.title, normalizeText(selectedScore.candidate.title)].filter(Boolean),
        ),
        contentJson: serializePreparedTopicContent(polished),
        citations: JSON.stringify(sourceSummaries),
        sourceImagesJson: JSON.stringify(sourceImages.map((image) => image.pageUrl)),
        status: "APPROVED",
        topicSeedJson: buildDraftSeed(selectedScore.candidate, selection, selectedScore),
        errorMessage: null,
      },
    });

    const imageAssets = await resolveDraftImages(selectedDraft.id, imagePlan, sourceImages);
    const preparedContentJson = serializePreparedTopicContent(polished);
    const preparedHashtags = JSON.stringify(polished.hashtags);
    const narrativeAngleBriefsJson = JSON.stringify(narrativeBriefs);
    const imagePlanJson = JSON.stringify(imagePlan);
    const contentReadiness = getTopicTaskContentReadiness({
      topic: task.topic,
      keywords: task.keywords,
      type: task.type,
      topicCraftCategory,
      preparedContentJson,
      sourceUrls,
      affiliateDisclosureRequired: /(쇼핑|여행|브랜드)\s*커넥트|affiliate|제휴|파트너스/iu.test(
        [task.topic, task.type, topicCraftCategory].filter(Boolean).join(" "),
      ),
      maxRepairAttempts: 3,
    });
    const contentReadinessReportJson = JSON.stringify(contentReadiness);
    const contentReadinessScore = scoreContentReadiness(contentReadiness);

    await prisma.$transaction(
      async (tx) => {
        await tx.topicDraftImage.deleteMany({
          where: { draftId: selectedDraft.id },
        });
        if (imageAssets.length > 0) {
          await tx.topicDraftImage.createMany({
            data: imageAssets.map((asset) => ({
              draftId: selectedDraft.id,
              sourceUrl: asset.sourceUrl,
              localPath: asset.localPath,
              creditName: asset.creditName,
              creditUrl: asset.creditUrl,
              role: asset.role,
              query: asset.query,
              provider: asset.provider,
            })),
          });
        }

        await tx.topicCampaign.update({
          where: { id: campaign.id },
          data: { status: "REVIEW" },
        });

        await tx.topicPostTask.update({
          where: { id: task.id },
          data: {
            status: "PREPARED",
            pipelineStage: "PREPARED",
            selectedDraftId: selectedDraft.id,
            preparedTitle: polished.title,
            preparedContentJson,
            preparedContentHtml: preparedHtml,
            preparedHashtags,
            narrativeAngleBriefsJson,
            imagePlanJson,
            contentReadinessReportJson,
            contentReadinessScore,
            contentReadinessPublishable: contentReadiness.canPublish,
            errorMessage: null,
          },
        });
      },
      {
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    return {
      taskId: task.id,
      campaignId: campaign.id,
      selectedDraftId: selectedDraft.id,
      content: polished,
      imagePlan,
      imageCount: imageAssets.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "주제 준비 중 오류가 발생했습니다.";
    await prisma.topicCampaign
      .updateMany({
        where: { id: activeCampaignId || "" },
        data: { status: "FAILED" },
      })
      .catch(() => {});
    await prisma.topicPostTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        pipelineStage: "FAILED",
        narrativeAngleBriefsJson: null,
        contentReadinessReportJson: null,
        contentReadinessScore: null,
        contentReadinessPublishable: false,
        errorMessage: message,
      },
    });
    throw error;
  } finally {
    releaseLock();
  }
}

export function taskHasPreparedContent(task: {
  preparedContentJson: string | null;
  selectedDraftId: string | null;
}) {
  return Boolean(parsePreparedTopicContent(task.preparedContentJson) && task.selectedDraftId);
}
