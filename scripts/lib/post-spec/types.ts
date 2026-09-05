/**
 * Spec-first 콘텐츠 파이프라인 타입.
 *
 * 글을 쓰기 전에 결정할 수 있는 것(섹션 순서·역할·헤더·이미지 슬롯·글자 범위·SEO/GEO 목표)은
 * 전부 PostSpec 으로 먼저 고정하고, LLM 은 그 스펙을 채우기만 한다. 생성 후 보정은
 * "타깃 섹션 재생성" 하나로 제한하며, 상투문 패딩·전체 재작성·기본 해시태그 주입은 하지 않는다.
 */

import type { OpenCrabSeoBrief } from "../opencrab-seo-brief";
import type { TravelProductFacts } from "../travel-content";

export type ConnectKind = "SHOPPING" | "TRAVEL";
export type HeaderFormat = "quotation" | "sectionTitle" | "none";
export type SectionShape = "prose" | "lines-3" | "facts-list" | "qa-3" | "checklist";

export type SectionRole =
  // 공통 GEO 블록
  | "summary-glance"
  | "key-facts"
  | "faq"
  | "fit-checklist"
  // 쇼핑
  | "hook-problem"
  | "product-reveal"
  | "benefit"
  | "proof"
  | "use-case"
  | "comparison"
  | "offer-check"
  // 여행
  | "itinerary-overview"
  | "day-course"
  | "inclusions"
  | "reasons-3"
  | "booking-check"
  | "closing";

export type ImageStrategy = "hero" | "source" | "crop" | "card" | "stock" | "collage";

export interface ImageCandidateInput {
  path: string;
  /** hero=대표(썸네일 자리), source=판매/상품 페이지 원본, crop=상세 이미지 크롭, card=요약 카드 */
  kind: "hero" | "source" | "crop" | "card";
  score?: number;
}

export interface ImageSlot {
  id: string;
  /** -1 = 본문 앞 hero */
  sectionIndex: number;
  intent: string;
  strategy: ImageStrategy;
  path: string;
  score: number;
}

export interface ImagePlan {
  policy: "LOCKED_PRODUCT_OR_ORIGINAL" | "TRAVEL_EDITORIAL";
  hero: ImageSlot | null;
  slots: ImageSlot[];
  /** 스펙이 목표로 한 본문 이미지 수 */
  targetBody: number;
  /** 실제로 확보한 본문 이미지 수 (hero 제외) */
  resolvedBody: number;
  minBody: number;
  shortfall: number;
  shrinkApplied: boolean;
  notes: string[];
}

export interface SectionSpec {
  index: number;
  role: SectionRole;
  title: string;
  headerFormat: HeaderFormat;
  shape: SectionShape;
  purpose: string;
  evidenceRule: string;
  /** 이 섹션이 사용할 수 있는 확인된 근거 줄 (전용 + 공용) */
  evidence: string[];
  /** 이 섹션 전용 근거. 최소 1개는 본문에 구체적으로 써야 하고 다른 섹션은 재사용하지 않는다. */
  mustUseEvidence: string[];
  requiredKeywords: string[];
  minChars: number;
  maxChars: number;
  minLines: number;
  maxLines: number;
  imageSlotIds: string[];
  imageIntent: string;
  /** 이 섹션이 받을 수 있는 본문 이미지 [최소, 최대]. 구버전 스펙에는 없을 수 있다. */
  imageCount?: [number, number];
  /** 모델에게 주는 작성 힌트 (형식·관점) */
  hints: string[];
}

export interface SeoTargets {
  primaryKeyword: string;
  secondaryKeywords: string[];
  title: {
    minChars: number;
    maxChars: number;
    keywordFirst: boolean;
    mustIncludeTokens: string[];
  };
  firstSentenceMustInclude: string;
  /** 본문 1,000자당 핵심 키워드 언급 수 목표 */
  keywordMentionsPer1000: [number, number];
  hashtags: { count: number; required: string[]; banned: string[] };
}

export interface GeoTargets {
  summaryLines: number;
  factsMinLines: number;
  faqCount: number;
  checklistMin: number;
  sourceLine: string;
}

/** 섹션별 근거표: 생성 전에 어떤 근거를 어느 섹션이 전담하는지 고정한다. */
export interface EvidenceLedgerEntry {
  sectionIndex: number;
  role: SectionRole;
  /** 이 섹션만 쓰는 근거 */
  exclusive: string[];
  /** 여러 섹션이 함께 참조해도 되는 근거(가격·상품명 등) */
  shared: string[];
}

export interface PostSpec {
  editorial?: import("../editorial-templates").EditorialSelection;
  version: "post-spec/v1";
  connectKind: ConnectKind;
  productId: string | null;
  productName: string;
  facts: {
    lines: string[];
    travel: TravelProductFacts | null;
    blockedClaimRules: string[];
  };
  brief: OpenCrabSeoBrief | null;
  sections: SectionSpec[];
  evidenceLedger: EvidenceLedgerEntry[];
  imagePlan: ImagePlan;
  seo: SeoTargets;
  geo: GeoTargets;
  totalChars: [number, number];
  disclosure: string;
  generation: {
    mode: "single" | "chunked";
    chunks: number[][];
    maxOutputTokens: number;
    temperature: number;
  };
}

export interface GeneratedSection {
  index: number;
  role: SectionRole;
  title: string;
  lines: string[];
}

export interface GeneratedDraft {
  title: string;
  sections: GeneratedSection[];
  hashtags: string[];
  source: "openai" | "local-template";
  model: string | null;
  attempts: number;
}

export type RepairPriority = "P0" | "P1" | "P2";

export interface RepairTarget {
  /** null = 제목/전체 */
  sectionIndex: number | null;
  code: string;
  reason: string;
  priority: RepairPriority;
  instruction: string;
}

export interface ValidationSignal {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  sectionIndex?: number;
  detail?: string;
}

export interface ValidationQualitySummary {
  /** 판정기의 순수 품질 점수(0~100). 하드 차단과 분리된 값. */
  score: number;
  passScore: number;
  categories: Array<{ key: string; label: string; score: number; maxScore: number; status: "pass" | "warn" | "fail"; notes: string[] }>;
  /** 판정기가 잡은 하드 차단(안전·구조) */
  blockers: Array<{ code: string; tier: "safety" | "structure"; reason: string }>;
}

export interface ValidationReport {
  canPublish: boolean;
  /** BLOCKED: 하드 차단 / NEEDS_REVIEW: 수리 대상 또는 품질 미달 / READY: 차단 없음 + 품질 기준 충족 */
  status: "READY" | "NEEDS_REVIEW" | "BLOCKED";
  /** 품질 점수 60% + 스펙 준수 점수 40% */
  score: number;
  quality: ValidationQualitySummary;
  signals: ValidationSignal[];
  metrics: {
    totalChars: number;
    keywordMentions: number;
    keywordMentionsPer1000: number;
    imageCount: number;
    aiTellScore: number;
  };
  repair: { strategy: "targeted"; maxAttempts: number; targets: RepairTarget[] };
  summary: string;
}

/** 에디터 입력 계약: 섹션마다 헤더 형식·이미지·구분선을 지정한다. */
export interface SectionSlot {
  index: number;
  role: SectionRole;
  headerFormat: HeaderFormat;
  headerText: string;
  imagePaths: string[];
  dividerBefore: boolean;
}

export interface PostCompositionContract {
  version: "post-composition/v1";
  kind: ConnectKind;
  sections: SectionSlot[];
  connectCard: "SHOPPING_CONNECT" | "EXTERNAL_LINK";
}

export interface AssembledPost {
  title: string;
  /** 기존 GeneratedPostPreview 호환: "제목\n\n줄\n줄…" 문자열, 마지막은 고지 섹션 */
  sections: string[];
  hashtags: string[];
  spec: PostSpec;
  draft: GeneratedDraft;
  validation: ValidationReport;
  composition: PostCompositionContract;
  /** 렌더 계약(resolvePostDocument)에 넘길 섹션별 이미지 플랜 — 팔레트 순서 대신 실제 슬롯 배정을 따르게 한다. */
  sectionPlan: CompositionSectionPlan[];
  heroImagePath: string | null;
  bodyImagePaths: string[];
  uploadImagePaths: string[];
  attempts: number;
  generationSource: GeneratedDraft["source"];
}

export interface CompositionSectionPlan {
  role: SectionRole;
  imagePaths: string[];
  imageIntent: string;
  imageMin: number;
  imageMax: number;
  headingStyle: "quotation" | "sectionTitle" | "plain";
  earlyConnectCard?: boolean;
}
