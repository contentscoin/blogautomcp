import * as fs from "fs";
import * as path from "path";

export interface OpenCrabCompetitorPost {
  rank: number;
  title: string;
  url: string;
  imageCount: number | null;
  bodyCharCount: number | null;
  headings: string[];
  structure: string[];
  tone: string[];
  thumbnail: string | null;
}

export interface OpenCrabSeoBrief {
  source: "opencrab-local-pack";
  packName: string;
  workflowName: string;
  workflowVersion: string | null;
  packVersion: string | null;
  sourceDate: string;
  sourcePath: string | null;
  productId: string | null;
  anchor: string | null;
  evidenceNote: string[];
  guardRule: string | null;
  guardStatus: "pass" | "warn" | "fail" | null;
  confidence: number;
  matchType: "product" | "category" | "aggregate";
  matchedProductName: string | null;
  categoryLabel: string | null;
  searchQueries: string[];
  competitors: OpenCrabCompetitorPost[];
  titleCandidates: string[];
  recommendedSectionTitles: string[];
  mediaTargetImageCount: number;
  thumbnailGuidance: string[];
  writingGuidance: string[];
  qaChecklist: string[];
  hashtags: string[];
}

interface OpenCrabBriefInput {
  productId?: string | null;
  productName: string;
  storeName?: string | null;
  description?: string | null;
  features?: string[];
  targetSectionCount?: number;
}

interface ResearchData {
  generatedAt?: string;
  summary?: ResearchSummary;
  research?: ResearchItem[];
}

interface ResearchSummary {
  productCount?: number;
  postCardCount?: number;
  medianImageCount?: number;
  p75ImageCount?: number;
  medianBodyCharCount?: number;
  p75BodyCharCount?: number;
  titleWordCounts?: Record<string, number>;
  structures?: Record<string, number>;
  tones?: Record<string, number>;
  categories?: Record<string, CategorySummary>;
}

interface CountName {
  name?: string;
  count?: number;
}

interface CategorySummary {
  products?: number;
  fetchedPosts?: number;
  medianImages?: number;
  commonStructures?: CountName[];
  commonTones?: CountName[];
}

interface ResearchItem {
  product?: ResearchProduct;
  topPosts?: ResearchTopPost[];
}

interface ResearchProduct {
  productName?: string;
  storeName?: string;
  inferredBrand?: string;
  categoryKey?: string;
  categoryLabel?: string;
  searchQuery?: string;
  searchQueries?: string[];
  categoryMatches?: string[];
}

interface ResearchTopPost {
  rank?: number;
  url?: string;
  title?: string;
  imageCount?: number;
  thumbnail?: string;
  post?: {
    title?: string;
    bodyCharCount?: number;
    imageCount?: number;
    headings?: string[];
    structureType?: string[];
    tone?: string[];
  };
}

interface WorkflowFile {
  workflow_id?: string;
  workflow_name?: string;
  pack_name?: string;
  local_version?: string;
  pack_version?: string;
  opencrab_updated_at?: string;
  recommended_top_k_per_node?: number;
  preflight_direct_project_query_required?: boolean;
  split_run_required_for_long_form?: boolean;
  release_gate?: Record<string, boolean>;
}

interface MatchResult {
  item: ResearchItem | null;
  score: number;
}

const DEFAULT_PROJECT_DIR = path.join(
  process.cwd(),
  "opencrab-projects",
  "naver-brandconnect-seo"
);
const DEFAULT_RESEARCH_JSON = path.join(
  process.cwd(),
  "docs",
  "naver-brandconnect-seo-research-2026-07-01.json"
);
const DEFAULT_WORKFLOW_JSON = path.join(
  DEFAULT_PROJECT_DIR,
  "workflows",
  "naver-brandconnect-seo-posting-workflow-v2.json"
);
const DEFAULT_SOLO_PAYLOADS_DIR = path.join(
  process.cwd(),
  "docs",
  "opencrab-saas-solo-payloads-2026-07-01"
);
const DEFAULT_PACK_NAME = "naver-brandconnect-seo-ontology-2026-07-01";
const DEFAULT_WORKFLOW_NAME = "Naver BrandConnect SEO Posting Workflow v2";
const EXACT_PID_GUARD_RULE = "RULE_NO_SIMILAR_PID_SUBSTITUTION_V2_3_2";

const CATEGORY_KEYWORDS: Array<{ label: string; keywords: string[] }> = [
  { label: "가전/청소/주방가전", keywords: ["청소기", "로봇청소기", "드라이기", "선풍기", "에어컨", "냉장고", "가전", "주방"] },
  { label: "디지털/IT/모바일", keywords: ["노트북", "태블릿", "충전기", "케이블", "모니터", "이어폰", "스마트", "USB"] },
  { label: "뷰티/헤어/바디", keywords: ["뷰티", "헤어", "바디", "트리머", "샴푸", "스킨", "크림", "마스크"] },
  { label: "생활/건강/욕실", keywords: ["건강", "욕실", "생활", "침구", "매트리스", "살균", "수납"] },
  { label: "식품/건강식품", keywords: ["식품", "건강식품", "영양제", "간식", "커피", "차"] },
  { label: "스포츠/레저/골프", keywords: ["골프", "스포츠", "운동", "레저", "라운드", "캠핑"] },
  { label: "패션/잡화/의류", keywords: ["패션", "가방", "신발", "의류", "지갑", "선글라스"] },
  { label: "육아/반려/가족", keywords: ["육아", "아기", "유아", "반려", "강아지", "고양이"] },
];

let cachedData: ResearchData | null | undefined;
let cachedWorkflow: WorkflowFile | null | undefined;

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function loadResearchData(): ResearchData | null {
  if (cachedData !== undefined) return cachedData;
  const filePath = process.env.OPENCRAB_SEO_RESEARCH_JSON || DEFAULT_RESEARCH_JSON;
  cachedData = readJsonFile<ResearchData>(filePath);
  return cachedData;
}

function loadWorkflowFile(): WorkflowFile | null {
  if (cachedWorkflow !== undefined) return cachedWorkflow;
  const filePath = process.env.OPENCRAB_SEO_WORKFLOW_JSON || DEFAULT_WORKFLOW_JSON;
  cachedWorkflow = readJsonFile<WorkflowFile>(filePath);
  return cachedWorkflow;
}

interface CanonicalPipeRow {
  type: string;
  fields: Record<string, string>;
}

interface CanonicalSoloEvidence {
  sourcePath: string;
  rawText: string;
  anchor: string | null;
  product: CanonicalPipeRow | null;
  competitors: CanonicalPipeRow[];
  discovery: CanonicalPipeRow | null;
}

function normalizeProductId(productId: string | null | undefined): string | null {
  const normalized = (productId || "").trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\")) return null;
  return normalized;
}

function findSoloPayloadPath(productId: string | null | undefined): string | null {
  const normalizedProductId = normalizeProductId(productId);
  if (!normalizedProductId) return null;

  const rootDir = process.env.OPENCRAB_SEO_SOLO_DIR || DEFAULT_SOLO_PAYLOADS_DIR;
  if (!fs.existsSync(rootDir)) return null;

  const targetFile = `${normalizedProductId}.md`.toLowerCase();
  const directPath = path.join(rootDir, targetFile);
  if (fs.existsSync(directPath)) return directPath;

  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === targetFile) {
        return entryPath;
      }
    }
  }

  return null;
}

function parseCanonicalPipeRow(line: string): CanonicalPipeRow | null {
  const parts = line.trim().split("|");
  if (parts.length < 2) return null;

  const fields: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) fields[key] = value;
  }

  return { type: parts[0].trim(), fields };
}

function loadCanonicalSoloEvidence(productId: string | null | undefined): CanonicalSoloEvidence | null {
  const sourcePath = findSoloPayloadPath(productId);
  if (!sourcePath) return null;

  try {
    const rawText = fs.readFileSync(sourcePath, "utf8");
    const rows = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const parsedRows = rows
      .map(parseCanonicalPipeRow)
      .filter((row): row is CanonicalPipeRow => Boolean(row));

    return {
      sourcePath,
      rawText,
      anchor: rows.find((line) => line.startsWith("ANCHOR|")) || null,
      product: parsedRows.find((row) => row.type === "P") || null,
      competitors: parsedRows.filter((row) => /^R\d+$/i.test(row.type)).slice(0, 3),
      discovery: parsedRows.find((row) => row.type === "D") || null,
    };
  } catch {
    return null;
  }
}

function parseCanonicalImageCount(value: string | null | undefined): number | null {
  const matches = (value || "").match(/\d+/g);
  if (!matches?.length) return null;
  return Math.max(...matches.map((match) => Number(match)).filter((count) => Number.isFinite(count)));
}

function parseCanonicalNumber(value: string | null | undefined): number | null {
  const parsed = Number((value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function splitCanonicalList(value: string | null | undefined): string[] {
  return uniqueStrings((value || "").split(/[;,]/).map((item) => item.trim()));
}

function canonicalRowsToCompetitors(rows: CanonicalPipeRow[]): OpenCrabCompetitorPost[] {
  return rows.map((row, index) => ({
    rank: Number(row.type.replace(/[^\d]/g, "")) || index + 1,
    title: row.fields.t || "",
    url: row.fields.u || "",
    imageCount: parseCanonicalImageCount(row.fields.i),
    bodyCharCount: parseCanonicalNumber(row.fields.b),
    headings: [],
    structure: splitCanonicalList(row.fields.st),
    tone: splitCanonicalList(row.fields.tn),
    thumbnail: null,
  }));
}

function cleanText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return cleanText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      matches += 1;
      continue;
    }
    for (const other of rightTokens) {
      if (token.length >= 3 && other.length >= 3 && (token.includes(other) || other.includes(token))) {
        matches += 0.6;
        break;
      }
    }
  }
  return Math.min(1, matches / Math.max(1, Math.min(leftTokens.size, rightTokens.size)));
}

function findCategoryLabel(productName: string, summary?: ResearchSummary): string | null {
  for (const candidate of CATEGORY_KEYWORDS) {
    if (candidate.keywords.some((keyword) => productName.includes(keyword))) {
      return candidate.label;
    }
  }

  const categories = Object.keys(summary?.categories || {});
  return categories.length > 0 ? categories[0] : null;
}

function findCategoryStats(label: string | null, summary?: ResearchSummary): CategorySummary | null {
  if (!label || !summary?.categories) return null;
  if (summary.categories[label]) return summary.categories[label];
  const normalizedLabel = cleanText(label);
  const match = Object.entries(summary.categories).find(([key]) => cleanText(key) === normalizedLabel);
  return match?.[1] || null;
}

function findBestResearchMatch(input: OpenCrabBriefInput, data: ResearchData): MatchResult {
  const research = data.research || [];
  let best: MatchResult = { item: null, score: 0 };

  for (const item of research) {
    const product = item.product;
    if (!product?.productName) continue;

    const productNameScore = tokenOverlapScore(input.productName, product.productName);
    const exactish =
      cleanText(product.productName).includes(cleanText(input.productName)) ||
      cleanText(input.productName).includes(cleanText(product.productName));
    const storeScore =
      input.storeName && (product.storeName || product.inferredBrand)
        ? Math.max(
            tokenOverlapScore(input.storeName, product.storeName || ""),
            tokenOverlapScore(input.storeName, product.inferredBrand || "")
          )
        : 0;
    const categoryScore = (product.categoryMatches || []).some((keyword) => input.productName.includes(keyword))
      ? 0.12
      : 0;
    const score = Math.min(1, (exactish ? 0.5 : 0) + productNameScore * 0.42 + storeScore * 0.18 + categoryScore);

    if (score > best.score) {
      best = { item, score };
    }
  }

  return best;
}

function topRecordKeys(record: Record<string, number> | undefined, count: number): string[] {
  return Object.entries(record || {})
    .filter(([key, value]) => key.trim().length > 0 && Number.isFinite(value))
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key]) => key);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => (value || "").trim()).filter((value) => value.length > 0))
  );
}

function toCompetitors(posts: ResearchTopPost[] | undefined): OpenCrabCompetitorPost[] {
  return (posts || []).slice(0, 3).map((post, index) => ({
    rank: post.rank || index + 1,
    title: post.title || post.post?.title || "",
    url: post.url || "",
    imageCount: post.post?.imageCount ?? post.imageCount ?? null,
    bodyCharCount: post.post?.bodyCharCount ?? null,
    headings: post.post?.headings || [],
    structure: post.post?.structureType || [],
    tone: post.post?.tone || [],
    thumbnail: post.thumbnail || null,
  }));
}

function mapStructureToSectionTitle(structure: string): string | null {
  if (structure.includes("사용")) return "사용 장면별 체크";
  if (structure.includes("구매")) return "구매 전 확인 포인트";
  if (structure.includes("추천")) return "이런 분께 잘 맞아요";
  if (structure.includes("장단점")) return "장점과 아쉬운 점";
  if (structure.includes("언박싱") || structure.includes("구성")) return "구성 및 패키지 확인";
  if (structure.includes("비교")) return "비교해서 보면 좋은 부분";
  if (structure.includes("결론") || structure.includes("요약")) return "마무리 요약";
  return null;
}

function buildSectionTitles(
  productName: string,
  categoryStats: CategorySummary | null,
  competitors: OpenCrabCompetitorPost[],
  targetCount: number
): string[] {
  const competitorStructures = competitors.flatMap((post) => post.structure);
  const categoryStructures = (categoryStats?.commonStructures || []).map((item) => item.name || "");
  const mapped = [...competitorStructures, ...categoryStructures].map(mapStructureToSectionTitle);
  const fallback = [
    "구매 전 확인 포인트",
    "제품 식별과 첫인상",
    "구성 및 패키지 확인",
    "사용 장면별 체크",
    "주요 기능과 장점",
    "비교해서 보면 좋은 부분",
    "장점과 아쉬운 점",
    "이런 분께 잘 맞아요",
    "마무리 요약",
  ];
  const titleFromProduct = productName.includes("선풍기")
    ? ["바람 세기와 휴대성 체크", "냉각 기능 확인 포인트"]
    : [];
  return uniqueStrings([...mapped, ...titleFromProduct, ...fallback]).slice(0, Math.max(4, Math.min(10, targetCount)));
}

function inferCategoryKeyword(productName: string, categoryLabel: string | null): string {
  const tokens = tokenize(productName);
  const categoryToken = CATEGORY_KEYWORDS.flatMap((item) => item.keywords).find((keyword) =>
    productName.includes(keyword)
  );
  return categoryToken || tokens.slice(0, 2).join(" ") || categoryLabel || "상품";
}

function buildTitleCandidates(
  productName: string,
  categoryLabel: string | null,
  summary?: ResearchSummary
): string[] {
  const categoryKeyword = inferCategoryKeyword(productName, categoryLabel);
  const modifiers = uniqueStrings([
    ...topRecordKeys(summary?.titleWordCounts, 6),
    "후기",
    "추천",
    "사용",
    "비교",
    "장단점",
    "가성비",
  ]).slice(0, 6);

  return uniqueStrings([
    `${categoryKeyword} ${productName} 구매 전 체크`,
    `${productName} 후기, 구매 전 확인할 포인트`,
    `${categoryKeyword} 추천 ${productName} 비교 포인트`,
    `${productName} 장단점과 사용 장면 체크`,
    `${productName} ${modifiers.slice(0, 2).join(" ")} 정리`,
  ]).slice(0, 5);
}

function buildHashtags(productName: string, categoryLabel: string | null, summary?: ResearchSummary): string[] {
  const productTokens = tokenize(productName).slice(0, 5);
  const categoryKeyword = inferCategoryKeyword(productName, categoryLabel).replace(/\s+/g, "");
  const seoTokens = topRecordKeys(summary?.titleWordCounts, 7);
  return uniqueStrings([
    ...productTokens,
    categoryKeyword,
    ...seoTokens,
    "추천",
    "후기",
    "리뷰",
    "비교",
    "장단점",
    "구매전확인",
    "네이버쇼핑",
  ])
    .map((tag) => tag.replace(/^#/, "").replace(/\s+/g, ""))
    .filter((tag) => tag.length > 0)
    .slice(0, 20);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function buildExactSoloEvidenceBrief(
  input: OpenCrabBriefInput,
  data: ResearchData | null,
  workflow: WorkflowFile | null
): OpenCrabSeoBrief | null {
  const productId = normalizeProductId(input.productId);
  if (!productId) return null;

  const evidence = loadCanonicalSoloEvidence(productId);
  if (!evidence?.product) return null;

  const productRow = evidence.product.fields;
  const discoveryRow = evidence.discovery?.fields || {};
  const competitors = canonicalRowsToCompetitors(evidence.competitors);
  const categoryLabel = productRow.cat || findCategoryLabel(input.productName, data?.summary);
  const categoryStats = findCategoryStats(categoryLabel, data?.summary);
  const targetCount = input.targetSectionCount || 8;
  const discoverySections = splitCanonicalList(discoveryRow.h)
    .map(mapStructureToSectionTitle)
    .filter((title): title is string => Boolean(title));
  const recommendedSectionTitles = uniqueStrings([
    ...discoverySections,
    ...buildSectionTitles(input.productName, categoryStats, competitors, targetCount),
  ]).slice(0, Math.max(4, Math.min(10, targetCount)));
  const competitorImageMax = Math.max(0, ...competitors.map((post) => post.imageCount || 0));
  const discoveryImageTarget = parseCanonicalNumber(discoveryRow.img) || 0;
  const aggregateImageTarget = data?.summary?.p75ImageCount || data?.summary?.medianImageCount || 8;
  const mediaTargetImageCount = clampNumber(
    Math.max(discoveryImageTarget, competitorImageMax, aggregateImageTarget),
    6,
    12
  );
  const searchQuery = productRow.q || input.productName;
  const matchedProductName =
    productRow.name && !productRow.name.includes("...") ? productRow.name : input.productName;
  const sourceDate =
    data?.generatedAt ||
    workflow?.opencrab_updated_at?.slice(0, 10) ||
    "2026-07-01";
  const guardStatus =
    evidence.anchor?.includes(`pid=${productId}`) && productRow.pid === productId ? "pass" : "warn";

  return {
    source: "opencrab-local-pack",
    packName: workflow?.pack_name || DEFAULT_PACK_NAME,
    workflowName: workflow?.workflow_name || DEFAULT_WORKFLOW_NAME,
    workflowVersion: workflow?.local_version || null,
    packVersion: workflow?.pack_version || null,
    sourceDate,
    sourcePath: evidence.sourcePath,
    productId,
    anchor: evidence.anchor,
    evidenceNote: [
      `source=${path.relative(process.cwd(), evidence.sourcePath)}`,
      `anchor=${evidence.anchor ? "present" : "missing"}`,
      `product_row=${productRow.pid || "missing"}`,
      `top_rows=${competitors.length}`,
      `image_target=${mediaTargetImageCount}`,
      `guard=${guardStatus}`,
    ],
    guardRule: EXACT_PID_GUARD_RULE,
    guardStatus,
    confidence: guardStatus === "pass" ? 1 : 0.86,
    matchType: "product",
    matchedProductName,
    categoryLabel,
    searchQueries: uniqueStrings([
      searchQuery,
      `${input.productName} 후기`,
      `${input.productName} 추천`,
      `${input.productName} 비교`,
      `${input.productName} 구매 전 체크`,
    ]).slice(0, 6),
    competitors,
    titleCandidates: uniqueStrings([
      `${input.productName} 구매 전 체크`,
      `${input.productName} 후기처럼 보는 포인트`,
      `${input.productName} 장점과 아쉬운점 정리`,
      `${inferCategoryKeyword(input.productName, categoryLabel)} 추천 ${input.productName} 비교 포인트`,
      ...buildTitleCandidates(input.productName, categoryLabel, data?.summary),
    ]).slice(0, 5),
    recommendedSectionTitles,
    mediaTargetImageCount,
    thumbnailGuidance: [
      "판매페이지에서 확보한 대표 제품 이미지를 최우선으로 사용",
      "제품이 가려지지 않도록 텍스트 박스는 작고 여백 있는 위치에 배치",
      "상세페이지 조각, 배송/쿠폰/이벤트 배너, 리뷰 캡처 이미지는 대표 썸네일 소스로 제외",
    ],
    writingGuidance: uniqueStrings([
      "동일 상품 ID의 로컬 CRAB_MICRO_TOP3 근거만 참고하고 유사 상품 근거로 대체하지 않기",
      "상위 글에서 반복되는 구조는 본문에 노출하지 말고 섹션 흐름으로만 반영하기",
      "사용후기, 장점, 아쉬운점, 추천대상, 구매전체크 흐름을 자연스럽게 배치하기",
      "직접 사용했다는 단정은 피하고 상세페이지와 이미지에서 확인 가능한 정보 기준으로 쓰기",
      "가격, 쿠폰, 배송 조건은 최종 확인 포인트로 다루기",
      ...(categoryStats?.commonTones || []).slice(0, 3).map((tone) => `${tone.name} 톤 참고`),
    ]),
    qaChecklist: [
      "상품명 또는 핵심 모델명이 제목에 포함됨",
      "첫 문단에 상품명이 자연스럽게 1회 들어감",
      `본문 이미지 목표 ${mediaTargetImageCount}개 안팎`,
      "본문에 OpenCrab, 상위노출, 브리프, 워크플로우 같은 내부 용어가 없음",
      "대표 썸네일이 첫 이미지로 삽입됨",
      "과장/직접사용 단정 없이 확인 가능한 정보 중심으로 작성됨",
    ],
    hashtags: buildHashtags(input.productName, categoryLabel, data?.summary),
  };
}

export function buildOpenCrabSeoBrief(input: OpenCrabBriefInput): OpenCrabSeoBrief | null {
  if ((process.env.OPENCRAB_SEO_BRIEF_ENABLED || "true").toLowerCase() === "false") {
    return null;
  }

  const data = loadResearchData();
  const workflow = loadWorkflowFile();
  const exactSoloBrief = buildExactSoloEvidenceBrief(input, data, workflow);
  if (exactSoloBrief) return exactSoloBrief;

  if (!data?.summary) return null;

  const targetCount = input.targetSectionCount || 8;
  const match = findBestResearchMatch(input, data);
  const productMatch = match.score >= 0.32 ? match.item : null;
  const matchedProduct = productMatch?.product || null;
  const categoryLabel =
    matchedProduct?.categoryLabel || findCategoryLabel(input.productName, data.summary);
  const categoryStats = findCategoryStats(categoryLabel, data.summary);
  const competitors = toCompetitors(productMatch?.topPosts);
  const matchType: OpenCrabSeoBrief["matchType"] = productMatch ? "product" : categoryStats ? "category" : "aggregate";
  const competitorImageMax = Math.max(0, ...competitors.map((post) => post.imageCount || 0));
  const categoryImageTarget = categoryStats?.medianImages ? categoryStats.medianImages + 2 : 0;
  const aggregateImageTarget = data.summary.p75ImageCount || data.summary.medianImageCount || 8;
  const mediaTargetImageCount = clampNumber(
    Math.max(competitorImageMax, categoryImageTarget, aggregateImageTarget),
    6,
    12
  );

  const recommendedSectionTitles = buildSectionTitles(
    input.productName,
    categoryStats,
    competitors,
    targetCount
  );

  return {
    source: "opencrab-local-pack",
    packName: workflow?.pack_name || DEFAULT_PACK_NAME,
    workflowName: workflow?.workflow_name || DEFAULT_WORKFLOW_NAME,
    workflowVersion: workflow?.local_version || null,
    packVersion: workflow?.pack_version || null,
    sourceDate: data.generatedAt || "2026-07-01",
    sourcePath: process.env.OPENCRAB_SEO_RESEARCH_JSON || DEFAULT_RESEARCH_JSON,
    productId: normalizeProductId(input.productId),
    anchor: null,
    evidenceNote: [
      "source=aggregate_research_json",
      `match_score=${Number(match.score.toFixed(2))}`,
      `match_type=${matchType}`,
    ],
    guardRule: normalizeProductId(input.productId) ? EXACT_PID_GUARD_RULE : null,
    guardStatus: productMatch ? "pass" : normalizeProductId(input.productId) ? "warn" : null,
    confidence: Number(match.score.toFixed(2)),
    matchType,
    matchedProductName: matchedProduct?.productName || null,
    categoryLabel,
    searchQueries: uniqueStrings([
      matchedProduct?.searchQuery,
      ...(matchedProduct?.searchQueries || []),
      `${input.productName} 후기`,
      `${input.productName} 추천`,
      `${input.productName} 비교`,
    ]).slice(0, 6),
    competitors,
    titleCandidates: buildTitleCandidates(input.productName, categoryLabel, data.summary),
    recommendedSectionTitles,
    mediaTargetImageCount,
    thumbnailGuidance: [
      "첫 이미지는 제품 실물이 크게 보이는 대표 썸네일로 배치",
      "제품명 또는 핵심 카테고리 의도를 큰 한글 문구로 명확히 표시",
      "후기/리뷰 이미지보다 판매페이지 대표 상품 이미지를 우선 사용",
    ],
    writingGuidance: uniqueStrings([
      "제품별 Top3 경쟁글 근거가 있으면 제목, 구조, 이미지 수를 우선 반영",
      "도입부에 상품명과 카테고리 키워드를 자연스럽게 포함",
      "사용 장면, 구매 전 체크, 추천 대상, 장단점/비교 섹션을 분산 배치",
      "직접 사용했다고 단정하지 말고 상세페이지와 확인 가능한 정보 기준으로 표현",
      ...(categoryStats?.commonTones || []).slice(0, 3).map((tone) => `${tone.name} 톤 참고`),
    ]),
    qaChecklist: [
      "제목에 제품명 또는 핵심 모델명 포함",
      "첫 문단에 상품명 1회 자연 삽입",
      `본문 이미지 목표 ${mediaTargetImageCount}장 안팎`,
      "소제목 반복 과다 금지, 키워드 분산 배치",
      "구매 유도는 가격/옵션/쿠폰 확인 중심으로 완곡하게 처리",
      "썸네일은 본문 첫 이미지로 삽입",
    ],
    hashtags: buildHashtags(input.productName, categoryLabel, data.summary),
  };
}

export function formatOpenCrabSeoBriefForPrompt(brief: OpenCrabSeoBrief | null): string {
  if (!brief) return "";

  const competitorLines =
    brief.competitors.length > 0
      ? brief.competitors.map((post) =>
          [
            `#${post.rank} ${post.title}`,
            post.imageCount ? `이미지 ${post.imageCount}장` : "이미지 수 미확인",
            post.bodyCharCount ? `본문 ${post.bodyCharCount}자` : "본문 길이 미확인",
            post.structure.length > 0 ? `구조: ${post.structure.join(", ")}` : "구조 미확인",
            post.tone.length > 0 ? `톤: ${post.tone.join(", ")}` : "톤 미확인",
          ].join(" | ")
        )
      : ["제품별 Top3 직접 매칭 없음. 카테고리/전체 집계 규칙을 보조 근거로 사용."];

  return [
    "[내부 SEO 참고자료]",
    "- 아래 자료의 라벨, 도구명, 근거 설명 문구는 본문에 쓰지 말고 구성과 선택 기준에만 반영",
    `- 기준일: ${brief.sourceDate}`,
    `- 매칭: ${brief.matchType}, confidence=${brief.confidence}`,
    brief.workflowVersion ? `- 워크플로우 버전: ${brief.workflowVersion}` : "",
    brief.packVersion ? `- 팩 버전: ${brief.packVersion}` : "",
    brief.productId ? `- 상품 ID: ${brief.productId}` : "",
    brief.guardStatus ? `- 상품 근거 가드: ${brief.guardStatus}` : "",
    brief.matchedProductName ? `- 매칭 상품: ${brief.matchedProductName}` : "",
    brief.categoryLabel ? `- 카테고리: ${brief.categoryLabel}` : "",
    `- 추천 검색어: ${brief.searchQueries.join(" / ")}`,
    "",
    "참고 글 흐름:",
    ...competitorLines.map((line) => `- ${line}`),
    "",
    "제목 후보:",
    ...brief.titleCandidates.map((title) => `- ${title}`),
    "",
    "본문 섹션 후보:",
    ...brief.recommendedSectionTitles.map((title, index) => `${index + 1}. ${title}`),
    "",
    "사진/썸네일:",
    `- 본문 이미지 목표: ${brief.mediaTargetImageCount}장 안팎`,
    ...brief.thumbnailGuidance.map((line) => `- ${line}`),
    "",
    "작성 규칙:",
    ...brief.writingGuidance.map((line) => `- ${line}`),
    "",
    "발행 QA:",
    ...brief.qaChecklist.map((line) => `- ${line}`),
    "",
    "본문 금지 표현:",
    "- OpenCrab, 오픈크랩, 상위노출 글, 상위 리서치, 브리프, 워크플로우, 내부 참고자료",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
