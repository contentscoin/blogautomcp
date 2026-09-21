"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { MaterialLibrary, type MaterialSelectionRequest } from "@/components/MaterialLibrary";
import SessionStatus from "@/components/SessionStatus";
import SavedDraftAutoReview from "@/components/SavedDraftAutoReview";
import TopicTaskPanel from "@/components/TopicTaskPanel";
import ProductThumbnailStudio from "@/components/ProductThumbnailStudio";
import { ThemeToggle } from "@/components/ThemeProvider";
import { getTopicTaskContentReadiness } from "@/lib/topic-task-content-readiness";
import { getTopicTaskPublishReadiness } from "@/lib/topic-task-publish-readiness";
import { isDraftEditorialQualityPassed } from "@/lib/brand-post-quality-display";
import { getDraftApprovalBlockers, getRepairStatus, getDraftRecheckError } from "./draft-approval-ui";

type ContentMode = "product" | "topic" | "review";
type ReviewCategory = "place" | "food" | "travel" | "parenting" | "product";
interface BrandLink {
  id: string;
  url: string;
  productName: string | null;
  productPrice: string | null;
  storeName: string | null;
  imageUrls: string | null;
  status: string;
  publishedAt: string | null;
  postUrl: string | null;
  errorMessage: string | null;
  memo: string | null;
  categoryNo: string | null;
  useSectionHeading: boolean;
  scheduledPublishAt: string | null;
  createdAt: string;
  connectKind?: "SHOPPING" | "TRAVEL";
  draftPrepared?: boolean;
  draftApproved?: boolean;
  draftTitle?: string | null;
  draftPreparedAt?: string | null;
  draftRevision?: string | null;
}

interface BrandPostDraftPreview {
  qualityConvergence?: {
    action?: string;
    reason?: string;
    targets?: Array<{ instruction?: string }>;
  };
  approval?: { contentScore: number; canApprove: boolean; contentPassed: boolean; compositionPassed: boolean; blockers: Array<{ code: string; reason: string; sectionId?: string }> };
  version?: "brand-post-package/v1" | "brand-post-package/v2";
  brandLinkId: string;
  connectKind: "SHOPPING" | "TRAVEL";
  title: string;
  markdown: string;
  heroImagePath: string;
  bodyImagePaths: string[];
  imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" | "TRAVEL_EDITORIAL";
  approvedAt: string | null;
  generationSource?: "AI" | "PREPARED_APPROVED";
  heroPreviewDataUrl?: string | null;
  imageAssets?: Array<{
    path: string;
    sourcePath: string;
    sha256: string;
    assetKey: string;
    previewUrl: string;
    role: "hero" | "body";
    sectionId?: string | null;
    imageIntent?: string;
    provenance?: "ORIGINAL" | "LOCKED_PRODUCT" | "GENERATED_BACKGROUND" | "EDITORIAL_CARD";
  }>;
  imageSlots?: Array<{
    sectionId: string;
    title: string;
    intent: string;
    minimum: number;
    recommended: number;
    maximum: number;
    count: number;
    missing: number;
    originalCount: number;
    generatedCount: number;
    generationMissing: number;
    assets: Array<{
      path: string;
      sourcePath: string;
      sha256: string;
      assetKey: string;
      previewUrl: string;
      role: "hero" | "body";
      sectionId?: string | null;
      imageIntent?: string;
      provenance?: "ORIGINAL" | "LOCKED_PRODUCT" | "GENERATED_BACKGROUND" | "EDITORIAL_CARD";
    }>;
  }>;
  contentQuality?: {
    canPublish: boolean;
    code: string;
    reason: string | null;
    score: number;
    quality?: { score: number; passScore?: number; categories?: Array<{ key: string; label: string; status: string; notes?: string[] }> };
    blockers?: Array<{ code: string; tier: string; reason: string }>;
    summary: string;
    signals: Array<{ key: string; label: string; status: "pass" | "warn" | "fail" }>;
  } | null;
  qualityRepair?: {
    attempted: boolean;
    applied: boolean;
    beforeScore: number;
    afterScore: number;
    beforeCode: string;
    afterCode: string;
    note: string;
  } | null;
  imageGeneration?: { status: "running" | "complete" | "incomplete"; applied: number; remaining: number; errors: string[] };
  thumbnailSpec?: {
    canvas: { width: number; height: number; aspect: string };
    style: string;
    sourcePolicy: string;
  };
  composition?: {
    contractVersion: string;
    qualityPreset: "STANDARD" | "PREMIUM";
    experienceMode: "AI_ASSISTED_INFORMATION" | "VERIFIED_EXPERIENCE";
    sections: Array<{
      id: string;
      title: string;
      imagePaths: string[];
      imageIntent: string;
      characterCount: number;
    }>;
    renderNodes: Array<{ kind: string; placement?: string; role?: string; sectionId?: string | null }>;
    qualityReport: {
      preset: "STANDARD" | "PREMIUM";
      canAutoPublish: boolean;
      score: number;
      actual: { characters: number; sections: number; images: number };
      target: {
        characters: { min: number; max: number };
        sections: { min: number; max: number };
        images: { min: number; recommended?: number; max: number };
      };
      imageCoverage?: {
        requiredSlots: number;
        filledRequiredSlots: number;
        missingSectionIds: string[];
      };
      blockers: string[];
      warnings: string[];
    };
  };
}

interface ChatGptDraftHandoff {
  productId: string;
  productLabel: string;
  connectKind: "SHOPPING" | "TRAVEL";
  chatgptUrl: string;
  prompt: string;
}

type DraftCreationMode = "checking" | "codex" | "local-ai" | "browser-chatgpt" | "chatgpt";

export interface TopicPostTask {
  id: string;
  topic: string;
  keywords: string | null;
  type: string | null;
  topicCraftCategory: string | null;
  campaignId: string | null;
  selectedDraftId: string | null;
  pipelineStage: string;
  preparedTitle: string | null;
  preparedContentJson: string | null;
  preparedContentHtml: string | null;
  preparedHashtags: string | null;
  narrativeAngleBriefsJson: string | null;
  imagePlanJson: string | null;
  contentReadinessReportJson: string | null;
  contentReadinessScore: number | null;
  contentReadinessPublishable: boolean;
  preparedImages?: Array<{
    sourceUrl: string;
    localPath: string | null;
    creditName: string | null;
    creditUrl: string | null;
    role: string;
    query: string | null;
    provider: string | null;
    createdAt: string;
  }>;
  status: string;
  publishedAt: string | null;
  scheduledPublishAt: string | null;
  postUrl: string | null;
  errorMessage: string | null;
  memo: string | null;
  categoryNo: string | null;
  createdAt: string;
}

interface PlaceSearchResult {
  title: string;
  roadAddress?: string;
  address?: string;
}

interface PlaceSearchResponse {
  success?: boolean;
  data?: {
    places?: PlaceSearchResult[];
  };
}

interface ReviewResult {
  title?: string;
  published?: boolean;
}

interface BlogCategoryOption {
  categoryNo: string;
  categoryName: string;
  parentCategoryNo: string | null;
  depth: number;
  displayName: string;
}

interface BlogCategoryResponse {
  success?: boolean;
  error?: string;
  data?: {
    blogId?: string;
    defaultCategoryNo?: string | null;
    categories?: BlogCategoryOption[];
  };
}

interface BulkActionResponse {
  success?: boolean;
  error?: string;
  message?: string;
  data?: {
    count?: number;
    intervalDays?: number;
    startDate?: string;
    endDate?: string;
    targetCount?: number;
    targetDate?: string;
    delayMs?: number;
    scheduleMode?: string;
    collectCount?: number;
    todayCount?: number;
    scheduledCount?: number;
    dailyQuota?: number;
    promotionFilter?: string | null;
    categoryFilter?: string | null;
    duplicateWindowDays?: number;
    logFile?: string;
    completed?: boolean;
    synchronizedCount?: number;
    importedCount?: number;
    totalCount?: number;
    jobId?: string;
    targetIds?: string[];
  };
}

interface BrandConnectCategoryOption {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  productCount: number;
}

interface BrandConnectPromotionOption {
  value: string;
  label: string;
  count: number;
}

interface BrandConnectSelectionOptionsResponse {
  success?: boolean;
  error?: string | { message?: string; code?: string; captureRequired?: boolean };
  data?: {
    categoryUrl?: string;
    categories?: BrandConnectCategoryOption[];
    promotions?: BrandConnectPromotionOption[];
    itemCount?: number;
    registrationAvailable?: boolean;
    /** 시간 예산을 넘겨 일부만 채워진 응답. */
    truncated?: boolean;
  };
}

type BrandConnectKind = "shopping" | "travel";

function toStoredBrandConnectKind(kind: BrandConnectKind): "SHOPPING" | "TRAVEL" {
  return kind === "travel" ? "TRAVEL" : "SHOPPING";
}

function isBrandLinkForKind(link: BrandLink, kind: BrandConnectKind): boolean {
  return (link.connectKind ?? "SHOPPING") === toStoredBrandConnectKind(kind);
}

function getBrandConnectErrorMessage(
  error: BrandConnectSelectionOptionsResponse["error"]
): string {
  if (typeof error === "string") return error;
  return error?.message || "BrandConnect 옵션을 불러오지 못했습니다.";
}

function isCaptureRequiredError(
  error: BrandConnectSelectionOptionsResponse["error"]
): boolean {
  return typeof error === "object" && error !== null && error.code === "CONNECT_CONTRACT_CAPTURE_REQUIRED";
}

const SEASONAL_REGISTER_COUNT_10 = 10;
const SEASONAL_REGISTER_COUNT_50 = 50;
const SUPER_PUBLISH_COLLECT_COUNT = 200;
const SUPER_PUBLISH_DAILY_QUOTA = 50;
const MAX_BULK_SCHEDULE_LIMIT = 200;
const MAX_BULK_DRAFT_PREPARE_LIMIT = 50;
const MAX_TODAY_PUBLISH_LIMIT = 100;

function getFirstImageUrl(imageUrls: string | null): string | null {
  if (!imageUrls) return null;

  try {
    const parsed = JSON.parse(imageUrls);
    if (!Array.isArray(parsed)) return null;

    const first = parsed.find((value): value is string => typeof value === "string" && value.trim().length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

function formatDateInputLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(raw: string | null): string {
  if (!raw) return "-";
  const normalized = raw.trim();
  const plainDate = normalized.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (plainDate) return plainDate[1];

  const isoDate = normalized.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoDate) return isoDate[1];

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 10);
}

function canBulkScheduleTopicTask(task: TopicPostTask): boolean {
  if (task.status !== "PREPARED" && task.status !== "FAILED") return false;
  if (formatDateDisplay(task.scheduledPublishAt) === "-") return false;

  const publishReadiness = getTopicTaskPublishReadiness({
    status: task.status,
    selectedDraftId: task.selectedDraftId,
    preparedContentJson: task.preparedContentJson,
    preparedImages: task.preparedImages,
  });
  if (!publishReadiness.canPublish) return false;

  const contentReadiness = getTopicTaskContentReadiness({
    topic: task.topic,
    keywords: task.keywords,
    type: task.type,
    topicCraftCategory: task.topicCraftCategory,
    preparedContentJson: task.preparedContentJson,
  });

  return contentReadiness.canPublish;
}

function toggleStringSelection(current: string[], value: string): string[] {
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
}

function isChatGptDraftHandoff(value: unknown): value is ChatGptDraftHandoff {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const handoff = value as Partial<ChatGptDraftHandoff>;
  return (
    typeof handoff.productId === "string" &&
    typeof handoff.productLabel === "string" &&
    (handoff.connectKind === "SHOPPING" || handoff.connectKind === "TRAVEL") &&
    typeof handoff.chatgptUrl === "string" &&
    typeof handoff.prompt === "string"
  );
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("클립보드 복사를 지원하지 않는 환경입니다.");
}

const waitForMilliseconds = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

function brandImageProvenanceLabel(value?: string): string {
  if (value === "LOCKED_PRODUCT") return "원본 상품 잠금";
  if (value === "ORIGINAL") return "수집 원본";
  if (value === "EDITORIAL_CARD") return "에디토리얼 합성";
  if (value === "GENERATED_BACKGROUND") return "AI 생성 배경 이미지";
  return "이미지";
}

export default function Dashboard() {
  const [links, setLinks] = useState<BrandLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUrl, setNewUrl] = useState("");
  const [newMemo, setNewMemo] = useState("");
  const [newCategoryNo, setNewCategoryNo] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<BlogCategoryOption[]>([]);
  const [defaultCategoryNo, setDefaultCategoryNo] = useState<string | null>(null);
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [updatingCategoryId, setUpdatingCategoryId] = useState<string | null>(null);
  const [newUseSectionHeading, setNewUseSectionHeading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [materialSelectionRequest, setMaterialSelectionRequest] = useState<MaterialSelectionRequest | null>(null);
  const [topicScheduleDialog, setTopicScheduleDialog] = useState<{ id: string; date: string } | null>(null);
  const openMaterials = (productId?: string, mode: "now" | "schedule" | "prepare" = "now") => {
    setMaterialSelectionRequest({ productId, mode, nonce: Date.now() });
    document.getElementById("material-library")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [thumbnailStudioLink, setThumbnailStudioLink] = useState<BrandLink | null>(null);
  const [draftGeneratingId, setDraftGeneratingId] = useState<string | null>(null);
  const [draftPreview, setDraftPreview] = useState<BrandPostDraftPreview | null>(null);
  const [draftPreviewTab, setDraftPreviewTab] = useState<"post" | "images" | "thumbnail" | "quality">("post");
  const [draftApproving, setDraftApproving] = useState(false);
  const [draftRechecking, setDraftRechecking] = useState(false);
  const [draftImageActionKey, setDraftImageActionKey] = useState<string | null>(null);
  const previewId = draftPreview?.brandLinkId;
  const draftImagesRunning = draftPreview?.imageGeneration?.status === "running";
  useEffect(() => {
    if (!previewId || (!draftImageActionKey && !draftImagesRunning)) return;
    let cancelled = false;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/brandlinks/${previewId}/draft`, { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled && response.ok && payload.success && payload.data) {
          setDraftPreview((current) => current?.brandLinkId === previewId ? payload.data : current);
        }
      } catch { /* The owning POST reports errors; progress polling is best effort. */ }
      finally { inFlight = false; }
    }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [previewId, draftImageActionKey, draftImagesRunning]);
  const [draftCreationMode, setDraftCreationMode] = useState<DraftCreationMode>("checking");
  const [chatGptDraftHandoff, setChatGptDraftHandoff] = useState<ChatGptDraftHandoff | null>(null);
  const [chatGptDraftHandoffReason, setChatGptDraftHandoffReason] = useState<string | null>(null);
  const [stoppingPosting, setStoppingPosting] = useState(false);
  const [bulkSeasonalRunning, setBulkSeasonalRunning] = useState(false);
  const [bulkScheduleRunning, setBulkScheduleRunning] = useState(false);
  const [bulkDraftPreparing, setBulkDraftPreparing] = useState(false);
  const [bulkDraftProgress, setBulkDraftProgress] = useState({ completed: 0, total: 0 });
  const [bulkTodayRunning, setBulkTodayRunning] = useState(false);
  const [superPublishingRunning, setSuperPublishingRunning] = useState(false);
  const [brandConnectCategoryUrl, setBrandConnectCategoryUrl] = useState("");
  const [brandConnectKind, setBrandConnectKind] = useState<BrandConnectKind>("shopping");
  const [brandConnectDuplicateWindowDays, setBrandConnectDuplicateWindowDays] = useState("30");
  const [brandConnectCategoryOptions, setBrandConnectCategoryOptions] = useState<BrandConnectCategoryOption[]>([]);
  const [brandConnectPromotionOptions, setBrandConnectPromotionOptions] = useState<BrandConnectPromotionOption[]>([]);
  const [selectedBrandConnectCategoryIds, setSelectedBrandConnectCategoryIds] = useState<string[]>([]);
  const [selectedBrandConnectPromotions, setSelectedBrandConnectPromotions] = useState<string[]>([]);
  const [brandConnectOptionsLoading, setBrandConnectOptionsLoading] = useState(false);
  const [brandConnectOptionsLoaded, setBrandConnectOptionsLoaded] = useState(false);
  const [brandConnectOptionsError, setBrandConnectOptionsError] = useState<string | null>(null);
  const [brandConnectOptionsNotice, setBrandConnectOptionsNotice] = useState<string | null>(null);
  const [brandConnectCaptureRequired, setBrandConnectCaptureRequired] = useState(false);
  const [brandConnectRegistrationAvailable, setBrandConnectRegistrationAvailable] = useState(true);
  const brandConnectAbortRef = useRef<AbortController | null>(null);
  const brandConnectRequestGenerationRef = useRef(0);
  const [travelContractCapturing, setTravelContractCapturing] = useState(false);
  const [travelContractMessage, setTravelContractMessage] = useState<string | null>(null);

  // V5: 콘텐츠 모드
  const [contentMode, setContentMode] = useState<ContentMode>("product");

  // V5: 리뷰 모드
  const [reviewPlaceName, setReviewPlaceName] = useState("");
  const [reviewAddress, setReviewAddress] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewKeywords, setReviewKeywords] = useState("");
  const [reviewCategory, setReviewCategory] = useState<ReviewCategory>("place");
  const [reviewTips, setReviewTips] = useState("");
  const [placeSearchResults, setPlaceSearchResults] = useState<PlaceSearchResult[]>([]);
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);

  // V5: 주제(간편) 모드
  const [topicTasks, setTopicTasks] = useState<TopicPostTask[]>([]);
  const [topicLoading, setTopicLoading] = useState(true);
  const [newTopic, setNewTopic] = useState("");
  const [newTopicKeywords, setNewTopicKeywords] = useState("");
  const [newTopicType, setNewTopicType] = useState("정보성");
  const [newTopicCraftCategory, setNewTopicCraftCategory] = useState<string>("교육 / 자기계발");
  const [newTopicMemo, setNewTopicMemo] = useState("");
  const [newTopicCategoryNo, setNewTopicCategoryNo] = useState("");
  const [newTopicScheduledDate, setNewTopicScheduledDate] = useState("");
  const [addingTopic, setAddingTopic] = useState(false);
  const [topicPreparingId, setTopicPreparingId] = useState<string | null>(null);
  const [topicPublishingId, setTopicPublishingId] = useState<string | null>(null);
  const [topicBulkScheduleRunning, setTopicBulkScheduleRunning] = useState(false);

  const [dashboardNotice, setDashboardNotice] = useState<{
    tone: "info" | "success" | "error";
    text: string;
  } | null>(null);

  const getBusyMessage = useCallback((): string | null => {
    if (publishingId) return "현재 발행 작업이 진행 중입니다. 완료 후 다시 시도하세요.";
    if (topicPublishingId) return "현재 주제글 발행 작업이 진행 중입니다. 완료 후 다시 시도하세요.";
    if (bulkSeasonalRunning) return "시즌·히트·인기 상품 등록 작업이 이미 실행 중입니다.";
    if (bulkScheduleRunning) return "예약발행 일괄 실행 작업이 이미 실행 중입니다.";
    if (bulkDraftPreparing) return "소재 미리 작성 작업이 이미 실행 중입니다.";
    if (bulkTodayRunning) return "바로 일괄발행 작업이 이미 실행 중입니다.";
    if (superPublishingRunning) return "수퍼 퍼블리싱 작업이 이미 실행 중입니다.";
    if (topicBulkScheduleRunning) return "주제글 예약배포 일괄 실행 작업이 이미 실행 중입니다.";
    return null;
  }, [
    publishingId,
    topicPublishingId,
    bulkSeasonalRunning,
    bulkScheduleRunning,
    bulkDraftPreparing,
    bulkTodayRunning,
    superPublishingRunning,
    topicBulkScheduleRunning,
  ]);

  const getBrandConnectSelectionPayload = useCallback(() => {
    const duplicateWindowDays = Number.parseInt(brandConnectDuplicateWindowDays, 10);
    const promotionFilter = selectedBrandConnectPromotions.join(",");
    const categoryFilter = selectedBrandConnectCategoryIds.join(",");
    return {
      connectKind: brandConnectKind,
      ...(promotionFilter ? { promotionFilter } : {}),
      ...(categoryFilter ? { categoryFilter } : {}),
      ...(brandConnectCategoryUrl.trim()
        ? { categoryUrl: brandConnectCategoryUrl.trim() }
        : {}),
      duplicateWindowDays: Number.isFinite(duplicateWindowDays)
        ? Math.min(3650, Math.max(0, duplicateWindowDays))
        : 30,
    };
  }, [
    selectedBrandConnectPromotions,
    selectedBrandConnectCategoryIds,
    brandConnectKind,
    brandConnectCategoryUrl,
    brandConnectDuplicateWindowDays,
  ]);

  const selectBrandConnectKind = (nextKind: BrandConnectKind) => {
    if (nextKind === brandConnectKind) return;
    // Invalidate immediately, before the next effect/request can run.
    brandConnectRequestGenerationRef.current += 1;
    brandConnectAbortRef.current?.abort();
    setBrandConnectOptionsLoading(false);
    setBrandConnectKind(nextKind);
    setBrandConnectCategoryUrl("");
    setBrandConnectCategoryOptions([]);
    setBrandConnectPromotionOptions([]);
    setSelectedBrandConnectCategoryIds([]);
    setSelectedBrandConnectPromotions([]);
    setBrandConnectOptionsLoaded(false);
    setBrandConnectOptionsError(null);
    setBrandConnectRegistrationAvailable(nextKind === "shopping");
    setTravelContractMessage(null);
  };

  const fetchLinks = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) setLoading(true);
      const res = await fetch("/api/brandlinks", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setLinks(data.data);
      }
    } catch (error) {
      console.error("링크 조회 실패:", error);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  const fetchTopicTasks = useCallback(async () => {
    try {
      setTopicLoading(true);
      const res = await fetch("/api/topic-tasks", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setTopicTasks(data.data);
      }
    } catch (error) {
      console.error("주제 포스팅 조회 실패:", error);
    } finally {
      setTopicLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      setCategoryLoading(true);
      setCategoryError(null);

      const res = await fetch("/api/blog/categories", { cache: "no-store" });
      const data = (await res.json()) as BlogCategoryResponse;

      if (!res.ok || !data.success) {
        setCategoryOptions([]);
        setDefaultCategoryNo(null);
        setCategoryError(data.error || "게시판 목록을 불러오지 못했습니다.");
        return;
      }

      const categories = Array.isArray(data.data?.categories)
        ? data.data?.categories
        : [];
      setCategoryOptions(categories);
      setDefaultCategoryNo(data.data?.defaultCategoryNo ?? null);
    } catch (error) {
      console.error("게시판 목록 조회 실패:", error);
      setCategoryOptions([]);
      setDefaultCategoryNo(null);
      setCategoryError("게시판 목록 조회 중 오류가 발생했습니다.");
    } finally {
      setCategoryLoading(false);
    }
  }, []);

  const fetchDraftCreationMode = useCallback(async () => {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error("AI 설정을 확인하지 못했습니다.");
      const mode = payload.data?.draftCreationMode;
      setDraftCreationMode(
        mode === "codex" || mode === "local-ai" || mode === "browser-chatgpt" || mode === "chatgpt"
          ? mode
          : payload.data?.desktopDraftProviderConfigured
            ? "local-ai"
            : payload.data?.browserDraftAutomationEnabled !== false
              ? "browser-chatgpt"
              : "chatgpt",
      );
    } catch {
      // 앱 기본값과 동일하게 로그인된 ChatGPT 웹 자동작성 경로를 우선 표시한다.
      setDraftCreationMode("browser-chatgpt");
    }
  }, []);

  const loadBrandConnectSelectionOptions = useCallback(async () => {
    // 요청마다 세대 번호를 올린다. 늦게 도착한 이전 요청은 상태를 건드리지 못한다.
    // (예전에는 늦은 응답이 로딩 완료 플래그만 세워서, 커넥트 종류를 바꾸면
    //  새 목록을 영영 불러오지 않고 빈 화면에 머물렀다.)
    const generation = brandConnectRequestGenerationRef.current + 1;
    brandConnectRequestGenerationRef.current = generation;
    const isCurrent = () => brandConnectRequestGenerationRef.current === generation;

    brandConnectAbortRef.current?.abort();
    const controller = new AbortController();
    brandConnectAbortRef.current = controller;

    try {
      setBrandConnectOptionsLoading(true);
      setBrandConnectOptionsError(null);
      setBrandConnectOptionsNotice(null);

      const params = new URLSearchParams();
      params.set("connectKind", brandConnectKind);
      if (brandConnectCategoryUrl.trim()) {
        params.set("categoryUrl", brandConnectCategoryUrl.trim());
      }

      const res = await fetch(`/api/brandlinks/selection-options?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await res.json()) as BrandConnectSelectionOptionsResponse;
      if (!isCurrent()) return;

      if (!res.ok || !data.success) {
        setBrandConnectCategoryOptions([]);
        setBrandConnectPromotionOptions([]);
        setBrandConnectOptionsError(getBrandConnectErrorMessage(data.error));
        setBrandConnectCaptureRequired(isCaptureRequiredError(data.error));
        setBrandConnectRegistrationAvailable(brandConnectKind === "shopping");
        return;
      }

      const categories = Array.isArray(data.data?.categories) ? data.data.categories : [];
      const promotions = Array.isArray(data.data?.promotions) ? data.data.promotions : [];
      const categoryIds = new Set(categories.map((category) => category.id));
      const promotionValues = new Set(promotions.map((promotion) => promotion.value));

      setBrandConnectCaptureRequired(false);
      setBrandConnectRegistrationAvailable(data.data?.registrationAvailable !== false);
      setBrandConnectCategoryOptions(categories);
      setBrandConnectPromotionOptions(promotions);
      setSelectedBrandConnectCategoryIds((current) =>
        current.filter((value) => categoryIds.has(value))
      );
      setSelectedBrandConnectPromotions((current) =>
        current.filter((value) => promotionValues.has(value))
      );
      if (data.data?.truncated) {
        setBrandConnectOptionsNotice(
          "시간이 오래 걸려 일부 옵션만 불러왔습니다. 다시 불러오면 더 채워질 수 있습니다."
        );
      } else if (typeof data.data?.itemCount === "number") {
        setBrandConnectOptionsNotice(`항목 ${data.data.itemCount}개를 확인했습니다.`);
      }
      if (data.data?.categoryUrl) {
        setBrandConnectCategoryUrl(data.data.categoryUrl);
      }
    } catch (error) {
      // 새 요청이 이전 요청을 취소한 경우는 오류가 아니다.
      if (controller.signal.aborted || !isCurrent()) return;
      console.error("BrandConnect 옵션 로드 실패:", error);
      setBrandConnectCategoryOptions([]);
      setBrandConnectPromotionOptions([]);
      setBrandConnectOptionsError("BrandConnect 옵션 로드 중 오류가 발생했습니다.");
    } finally {
      if (isCurrent()) {
        setBrandConnectOptionsLoaded(true);
        setBrandConnectOptionsLoading(false);
      }
    }
  }, [brandConnectCategoryUrl, brandConnectKind]);

  const captureTravelContract = useCallback(async () => {
    const categoryUrl = brandConnectCategoryUrl.trim();
    setTravelContractCapturing(true);
    setTravelContractMessage("브라우저 창에서 여행커넥트 목록을 여는 중입니다. 최대 1분 정도 걸릴 수 있습니다.");
    try {
      const response = await fetch("/api/brandlinks/travel-contract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(categoryUrl ? { categoryUrl } : {}),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(typeof payload.error === "string" ? payload.error : "여행커넥트 계약 캡처에 실패했습니다.");
      setTravelContractMessage(payload.data.message);
      // 계약이 저장됐으니 곧바로 목록을 불러와 캡처 결과를 눈으로 확인시켜 준다.
      setBrandConnectCaptureRequired(false);
      await loadBrandConnectSelectionOptions();
    } catch (error) {
      setTravelContractMessage(error instanceof Error ? error.message : "여행커넥트 계약 캡처에 실패했습니다.");
    } finally {
      setTravelContractCapturing(false);
    }
  }, [brandConnectCategoryUrl, loadBrandConnectSelectionOptions]);

  useEffect(() => {
    fetchLinks();
    fetchTopicTasks();
  }, [fetchLinks, fetchTopicTasks]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    void fetchDraftCreationMode();
  }, [fetchDraftCreationMode]);

  useEffect(() => {
    const handleBlogIdChanged = () => void fetchCategories();
    window.addEventListener("blogautomcp:blog-id-changed", handleBlogIdChanged);
    return () => window.removeEventListener("blogautomcp:blog-id-changed", handleBlogIdChanged);
  }, [fetchCategories]);

  useEffect(() => {
    const handleDraftModeChanged = () => void fetchDraftCreationMode();
    window.addEventListener("blogautomcp:draft-mode-changed", handleDraftModeChanged);
    return () => window.removeEventListener("blogautomcp:draft-mode-changed", handleDraftModeChanged);
  }, [fetchDraftCreationMode]);

  useEffect(() => {
    if (brandConnectOptionsLoaded || brandConnectOptionsLoading) return;
    void loadBrandConnectSelectionOptions();
  }, [
    brandConnectOptionsLoaded,
    brandConnectOptionsLoading,
    loadBrandConnectSelectionOptions,
  ]);

  // 화면을 떠날 때 진행 중인 옵션 요청을 정리한다.
  useEffect(() => () => brandConnectAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!publishingId) return;
    const current = links.find((link) => link.id === publishingId);
    if (!current) {
      setPublishingId(null);
      return;
    }
    if (["PUBLISHED", "SCHEDULED"].includes(current.status)) {
      setPublishingId(null);
    }
  }, [links, publishingId]);

  useEffect(() => {
    if (!topicPublishingId) return;
    const current = topicTasks.find((task) => task.id === topicPublishingId);
    if (!current) {
      setTopicPublishingId(null);
      return;
    }
    if (current.status !== "PUBLISHING") {
      setTopicPublishingId(null);
    }
  }, [topicTasks, topicPublishingId]);

  useEffect(() => {
    if (newTopicType === "여행") {
      setNewTopicCraftCategory("여행 / 문화");
      return;
    }
    if (newTopicType === "골프") {
      setNewTopicCraftCategory("건강 / 운동");
      return;
    }
    setNewTopicCraftCategory((current) =>
      current === "여행 / 문화" || current === "건강 / 운동" ? "교육 / 자기계발" : current,
    );
  }, [newTopicType]);

  // 링크 추가
  const handleAddLink = async () => {
    if (!newUrl.trim()) {
      alert("브랜드커넥트 URL을 입력하세요.");
      return;
    }

    try {
      setAdding(true);
      const res = await fetch("/api/brandlinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: newUrl.trim(),
          memo: newMemo.trim(),
          categoryNo: newCategoryNo.trim() || null,
          useSectionHeading: newUseSectionHeading,
          connectKind: brandConnectKind,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setNewUrl("");
        setNewMemo("");
        setNewCategoryNo("");
        setNewUseSectionHeading(true);
        fetchLinks();
        alert("링크가 추가되었습니다!");
      } else {
        alert(`오류: ${data.error}`);
      }
    } catch (error) {
      console.error("링크 추가 실패:", error);
      alert("링크 추가 중 오류가 발생했습니다.");
    } finally {
      setAdding(false);
    }
  };

  // 링크 삭제
  const handleDeleteLink = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;

    try {
      const res = await fetch(`/api/brandlinks/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchLinks();
      }
    } catch (error) {
      console.error("삭제 실패:", error);
    }
  };

  const handleUpdateLinkSettings = async (
    id: string,
    payload: {
      memo?: string | null;
      categoryNo?: string | null;
      useSectionHeading?: boolean;
    }
  ) => {
    try {
      const res = await fetch(`/api/brandlinks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        alert(`설정 저장 실패: ${data.error || "알 수 없는 오류"}`);
        return;
      }

      fetchLinks();
    } catch (error) {
      console.error("설정 저장 실패:", error);
      alert("설정 저장 중 오류가 발생했습니다.");
    }
  };

  const getCategoryLabel = useCallback((categoryNo: string | null): string => {
    if (!categoryNo) return "기본";
    const matched = categoryOptions.find((item) => item.categoryNo === categoryNo);
    if (!matched) return `번호 ${categoryNo}`;
    return matched.categoryName;
  }, [categoryOptions]);

  const handleSelectCategoryNo = async (link: BrandLink, selectedCategoryNo: string) => {
    const nextCategoryNo = selectedCategoryNo.trim() || null;
    const current = link.categoryNo ?? null;
    if (current === nextCategoryNo) return;

    try {
      setUpdatingCategoryId(link.id);
      await handleUpdateLinkSettings(link.id, {
        categoryNo: nextCategoryNo,
      });
    } finally {
      setUpdatingCategoryId((prev) => (prev === link.id ? null : prev));
    }
  };

  const handleToggleSectionHeading = async (link: BrandLink) => {
    await handleUpdateLinkSettings(link.id, {
      useSectionHeading: !link.useSectionHeading,
    });
  };
  const handlePrepareBrandDraft = async (
    link: BrandLink,
    options?: {
      forceQualityRepair?: boolean;
      returnTab?: "post" | "images" | "thumbnail" | "quality";
      autoApprove?: boolean;
      silentPreview?: boolean;
    },
  ): Promise<boolean> => {
    let completed = false;
    setDraftGeneratingId(link.id);
    setChatGptDraftHandoff(null);
    setChatGptDraftHandoffReason(null);
    setDashboardNotice({
      tone: "info",
      text: options?.forceQualityRepair
        ? "품질검사에서 발견한 약한 부분을 AI가 자동 보강하고 있습니다."
        : draftCreationMode === "chatgpt"
        ? "ChatGPT에서 사용할 상품별 요청문을 준비하고 있습니다."
        : draftCreationMode === "codex"
          ? "GPT가 백그라운드에서 상품을 분석하고 고품질 원고를 작성하고 있습니다."
        : draftCreationMode === "browser-chatgpt"
          ? "ChatGPT 백그라운드 작업으로 고품질 글과 이미지 패키지를 자동 작성하고 있습니다."
          : "고품질 글과 이미지 패키지를 만들고 있습니다. 잠시만 기다려 주세요.",
    });
    try {
      const waitForChatGptLogin = async (jobId: string) => {
        const deadline = Date.now() + 10 * 60_000;
        while (Date.now() < deadline) {
          await waitForMilliseconds(3_000);
          const statusResponse = await fetch(`/api/session/login?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
          const statusPayload = await statusResponse.json();
          if (!statusResponse.ok || !statusPayload.success) continue;
          if (statusPayload.data?.status === "succeeded") return;
          if (statusPayload.data?.status === "failed") {
            throw new Error(statusPayload.data?.error || "ChatGPT 로그인에 실패했습니다.");
          }
        }
        throw new Error("ChatGPT 로그인 확인 시간이 초과되었습니다.");
      };

      const waitForCodexLogin = async (jobId: string) => {
        const deadline = Date.now() + 10 * 60_000;
        while (Date.now() < deadline) {
          await waitForMilliseconds(2_000);
          const statusResponse = await fetch(`/api/codex?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
          const statusPayload = await statusResponse.json();
          if (!statusResponse.ok || !statusPayload.success) continue;
          if (statusPayload.data?.job?.status === "succeeded") return;
          if (statusPayload.data?.job?.status === "failed") {
            throw new Error(statusPayload.data?.job?.error || "GPT 로그인에 실패했습니다.");
          }
        }
        throw new Error("GPT 로그인 확인 시간이 초과되었습니다.");
      };

      const requestDraft = async (allowLoginRetry: boolean): Promise<void> => {
        const response = await fetch(`/api/brandlinks/${link.id}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            qualityPreset: "premium",
            experienceMode: "ai_assisted_information",
            forceQualityRepair: options?.forceQualityRepair === true,
            autoApprove: options?.autoApprove === true,
          }),
        });
        const payload = await response.json();
        const handoff = payload?.data?.handoff;

        if (response.status === 409 && payload?.code === "CODEX_LOGIN_REQUIRED" && allowLoginRetry) {
          setDashboardNotice({ tone: "info", text: "GPT 로그인 창을 열었습니다. 로그인 후 원고 작성을 자동으로 이어갑니다." });
          const loginResponse = await fetch("/api/codex", { method: "POST" });
          const loginPayload = await loginResponse.json();
          if (!loginResponse.ok || !loginPayload.success) throw new Error(loginPayload.error || "GPT 로그인을 시작하지 못했습니다.");
          const jobId = loginPayload.data?.job?.id as string | undefined;
          if (jobId) await waitForCodexLogin(jobId);
          await fetchDraftCreationMode();
          setDashboardNotice({ tone: "info", text: "GPT 연결이 확인됐습니다. 원고를 작성하고 있습니다." });
          await requestDraft(false);
          return;
        }

        if (response.status === 409 && payload?.code === "CHATGPT_BROWSER_LOGIN_REQUIRED" && allowLoginRetry) {
          setDashboardNotice({ tone: "info", text: "ChatGPT 로그인·보안 확인 창을 열었습니다. 확인 후 초안 생성을 자동으로 이어갑니다." });
          const loginResponse = await fetch("/api/session/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "chatgpt", force: false }),
          });
          const loginPayload = await loginResponse.json();
          if (!loginResponse.ok || !loginPayload.success) {
            throw new Error(loginPayload.error || "ChatGPT 로그인 창을 열지 못했습니다.");
          }
          const jobId = loginPayload.data?.jobId as string | undefined;
          if (!jobId) throw new Error("ChatGPT 로그인 작업 번호가 없습니다.");
          await waitForChatGptLogin(jobId);
          setDashboardNotice({ tone: "info", text: "ChatGPT 로그인이 확인됐습니다. 초안을 자동 작성하고 있습니다." });
          await requestDraft(false);
          return;
        }

        const shouldHandoff = response.status === 409 && [
          "CHATGPT_MCP_DRAFT_REQUIRED",
          "CHATGPT_BROWSER_FALLBACK_REQUIRED",
          "CHATGPT_BROWSER_UNREACHABLE",
          "CHATGPT_BROWSER_LOGIN_REQUIRED",
        ].includes(payload?.code);
        if (shouldHandoff && isChatGptDraftHandoff(handoff)) {
          setChatGptDraftHandoffReason(typeof payload.error === "string" ? payload.error : null);
          setChatGptDraftHandoff(handoff);
          setDashboardNotice({
            tone: "info",
            text: payload?.code === "CHATGPT_MCP_DRAFT_REQUIRED"
              ? "상품별 요청문이 준비됐습니다. 복사한 뒤 ChatGPT에서 이어서 작성하세요."
              : payload?.code === "CHATGPT_BROWSER_UNREACHABLE"
                ? "ChatGPT 웹 페이지에 연결하지 못했습니다. 네트워크를 확인하거나 상품별 요청문으로 ChatGPT에서 이어서 작성하세요."
                : "웹 자동작성을 완료하지 못했습니다. 상품별 요청문으로 ChatGPT에서 이어서 작성할 수 있습니다.",
          });
          return;
        }
        if (!response.ok || !payload.success) throw new Error(payload.error || "초안 생성 실패");
        if (!options?.silentPreview) {
          setDraftPreview(payload.data as BrandPostDraftPreview);
          setDraftPreviewTab(options?.returnTab || "post");
        }
        if (options?.autoApprove && payload.autoApproved !== true) {
          throw new Error(payload.approvalWarning || "소재는 작성됐지만 품질검사를 통과하지 못해 자동 승인되지 않았습니다.");
        }
        completed = true;
        const imageRepairNote = typeof payload.imageRepairWarning === "string" && payload.imageRepairWarning.trim()
          ? ` ${payload.imageRepairWarning.trim()}`
          : "";
        setDashboardNotice({
          tone: getDraftApprovalBlockers(payload.data as BrandPostDraftPreview).length ? "info" : "success",
          text: (options?.forceQualityRepair
            ? getRepairStatus((payload.data as BrandPostDraftPreview).qualityRepair)
            : "초안이 저장됐습니다. 원고와 이미지의 남은 승인 조건을 확인해 주세요.") + imageRepairNote,
        });
      };

      await requestDraft(true);
    } catch (error) {
      setDashboardNotice({ tone: "error", text: error instanceof Error ? error.message : "초안 생성 중 오류가 발생했습니다." });
    } finally {
      setDraftGeneratingId(null);
    }
    return completed;
  };

  const handleCopyChatGptDraftPrompt = async () => {
    if (!chatGptDraftHandoff) return;
    try {
      await copyText(chatGptDraftHandoff.prompt);
      setDashboardNotice({ tone: "success", text: "요청문을 복사했습니다. ChatGPT 대화창에 붙여넣어 주세요." });
    } catch (error) {
      setDashboardNotice({ tone: "error", text: error instanceof Error ? error.message : "요청문을 복사하지 못했습니다." });
    }
  };

  const handleCopyAndOpenChatGpt = () => {
    if (!chatGptDraftHandoff) return;
    const copyPromise = copyText(chatGptDraftHandoff.prompt);
    window.open(chatGptDraftHandoff.chatgptUrl, "_blank", "noopener,noreferrer");
    void copyPromise.then(
      () => setDashboardNotice({ tone: "success", text: "요청문을 복사하고 ChatGPT를 열었습니다. 대화창에 붙여넣어 실행하세요." }),
      () => setDashboardNotice({ tone: "error", text: "ChatGPT를 열었지만 요청문 복사에 실패했습니다. 요청문을 직접 선택해 복사해 주세요." }),
    );
  };
  const handleOpenOrPrepareBrandDraft = async (link: BrandLink) => {
    setDashboardNotice(null);
    try {
      const response = await fetch(`/api/brandlinks/${link.id}/draft`, { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.success && payload.data) {
        setDraftPreview(payload.data as BrandPostDraftPreview);
        setDraftPreviewTab("post");
        return;
      }
    } catch {
      // Reading a saved material never starts a new generation.
    }
    setDashboardNotice({ tone: "error", text: "저장된 소재를 읽지 못했습니다. 소재 보관함에서 준비 상태를 확인하세요." });
  };

  const handleBulkPrepareBrandDrafts = async () => { openMaterials(undefined, "prepare"); };

  const handleApproveBrandDraft = async () => {
    if (!draftPreview || draftRechecking || draftApproving || draftGeneratingId || draftImageActionKey || getDraftApprovalBlockers(draftPreview).length) return;
    setDraftApproving(true);
    try {
      const response = await fetch(`/api/brandlinks/${draftPreview.brandLinkId}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "초안 승인 실패");
      setDraftPreview(payload.data as BrandPostDraftPreview);
      setDashboardNotice({ tone: "success", text: "승인됐습니다. 발행 시 이 글과 이미지가 그대로 사용됩니다." });
    } catch (error) {
      setDashboardNotice({ tone: "error", text: error instanceof Error ? error.message : "초안 승인 중 오류가 발생했습니다." });
    } finally {
      setDraftApproving(false);
    }
  };

  const handleRecheckBrandDraft = async () => {
    if (!draftPreview || draftRechecking || draftApproving || draftGeneratingId || draftImageActionKey || draftImagesRunning) return;
    const id = draftPreview.brandLinkId;
    setDraftRechecking(true);
    setDashboardNotice({ tone: "info", text: "저장된 원고를 최신 기준으로 재검사하고 있습니다." });
    try {
      const response = await fetch(`/api/brandlinks/${id}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recheck" }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success || !payload.data) throw new Error(getDraftRecheckError(payload, id));
      setDraftPreview((current) => current?.brandLinkId === id ? payload.data : current);
      setDashboardNotice({ tone: "info", text: "최신 기준 재검사 완료 · 갱신된 승인 조건을 확인하세요." });
    } catch (error) {
      setDashboardNotice({ tone: "error", text: error instanceof Error ? error.message : "품질 재검사 실패" });
    } finally {
      setDraftRechecking(false);
    }
  };

  const handleRepairBrandDraft = async () => {
    if (!draftPreview || draftRechecking || draftApproving || draftGeneratingId || draftImageActionKey || draftImagesRunning) return;
    const id = draftPreview.brandLinkId;
    setDraftRechecking(true);
    setDashboardNotice({ tone: "info", text: "저장된 원고를 재검사한 뒤 필요한 문단만 보강하고 있습니다." });
    try {
      const recheckResponse = await fetch(`/api/brandlinks/${id}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recheck" }),
      });
      const recheckPayload = await recheckResponse.json() as {
        success?: boolean;
        data?: BrandPostDraftPreview;
        code?: string;
        error?: string;
      };
      if (!recheckResponse.ok || !recheckPayload.success || !recheckPayload.data) {
        throw new Error(getDraftRecheckError(recheckPayload, id));
      }
      setDraftPreview(recheckPayload.data);
      const plan = recheckPayload.data.qualityConvergence;
      if (!plan || plan.action === "complete") {
        setDashboardNotice({ tone: "success", text: "원고가 이미 최신 승인 기준을 통과했습니다." });
        return;
      }
      if (plan.action !== "repair-text") {
        throw new Error(plan.reason || "원고 재작성보다 이미지 또는 상품 근거 보강이 먼저 필요합니다.");
      }
      const instructions = [
        plan.reason,
        ...(plan.targets || []).map(target => target.instruction),
        "기존 문단 제목, 순서, 이미지 의도와 검수 완료 이미지는 유지하세요.",
      ].filter((value): value is string => Boolean(value?.trim())).join("\n");
      const reviseResponse = await fetch(`/api/brandlinks/${id}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revise", qualityConvergence: true, instructions }),
      });
      const revisePayload = await reviseResponse.json() as { success?: boolean; data?: BrandPostDraftPreview; error?: string };
      if (!reviseResponse.ok || !revisePayload.success || !revisePayload.data) {
        throw new Error(revisePayload.error || "원고 보강에 실패했습니다. 기존 소재는 보존했습니다.");
      }
      setDraftPreview(revisePayload.data);
      setDraftPreviewTab("quality");
      setDashboardNotice({ tone: "success", text: "필요한 원고 문단만 보강했습니다. 기존 검수 이미지는 그대로 유지했습니다." });
    } catch (error) {
      setDashboardNotice({ tone: "error", text: error instanceof Error ? error.message : "원고 보강에 실패했습니다." });
    } finally {
      setDraftRechecking(false);
    }
  };

  const requestDraftImageAction = async (body: {
    action: "generate_missing" | "generate_section" | "regenerate";
    sectionId?: string;
    assetKey?: string;
    batchSize?: number;
  }) => {
    if (!draftPreview) throw new Error("열린 초안이 없습니다.");
    const response = await fetch(`/api/brandlinks/${draftPreview.brandLinkId}/draft/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as {
      success?: boolean;
      data?: BrandPostDraftPreview;
      generatedCount?: number;
      remainingMissing?: number;
      errors?: string[];
      error?: string;
      message?: string;
    };
    if (payload.data) setDraftPreview(payload.data);
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || payload.errors?.join(" ") || "이미지 생성에 실패했습니다.");
    }
    return payload;
  };

  const handleGenerateMissingDraftImages = async () => {
    if (!draftPreview || draftImageActionKey || draftRechecking || draftApproving || draftGeneratingId || draftImagesRunning) return;
    setDraftImageActionKey("missing");
    setDashboardNotice({ tone: "info", text: "생성 이미지가 없는 파트를 자동 보충하고 있습니다." });
    try {
      const payload = await requestDraftImageAction({ action: "generate_missing" });
      const generatedTotal = payload.generatedCount || 0;
      const remaining = payload.remainingMissing ?? payload.data?.imageGeneration?.remaining;
      setDraftPreviewTab("images");
      setDashboardNotice({
        tone: remaining === 0 ? "success" : "info",
        text: remaining === 0
          ? `섹션별 생성 이미지 보충 완료 · ${generatedTotal}장 반영`
          : `${generatedTotal}장을 반영했습니다. ${remaining == null ? "남은 수량은 상태를 새로 확인하세요." : `필요한 이미지 ${remaining}장이 남았습니다.`} ${(payload.errors || []).join(" ")}`,
      });
    } catch (error) {
      setDashboardNotice({ tone: "error", text: error instanceof Error ? error.message : "필수 이미지 보충에 실패했습니다." });
    } finally {
      setDraftImageActionKey(null);
    }
  };

  const handleGenerateDraftSectionImage = async (sectionId: string) => {
    if (!draftPreview || draftImageActionKey || draftRechecking || draftApproving || draftGeneratingId || draftImagesRunning) return;
    setDraftImageActionKey(`section:${sectionId}`);
    setDashboardNotice({ tone: "info", text: "선택한 파트의 이미지를 한 장 더 만들고 있습니다." });
    try {
      const payload = await requestDraftImageAction({ action: "generate_section", sectionId });
      setDraftPreviewTab("images");
      setDashboardNotice({ tone: "success", text: payload.message || "파트 이미지 한 장을 추가했습니다." });
    } catch (error) {
      setDashboardNotice({ tone: "error", text: error instanceof Error ? error.message : "파트 이미지 생성에 실패했습니다." });
    } finally {
      setDraftImageActionKey(null);
    }
  };

  const handleRegenerateDraftImage = async (assetKey: string) => {
    if (!draftPreview || draftImageActionKey || draftRechecking || draftApproving || draftGeneratingId || draftImagesRunning) return;
    setDraftImageActionKey(`asset:${assetKey}`);
    setDashboardNotice({ tone: "info", text: "선택한 이미지만 새로 만들고 있습니다." });
    try {
      const payload = await requestDraftImageAction({ action: "regenerate", assetKey });
      setDashboardNotice({ tone: "success", text: payload.message || "선택한 이미지를 교체했습니다." });
    } catch (error) {
      setDashboardNotice({ tone: "error", text: error instanceof Error ? error.message : "이미지 재생성에 실패했습니다." });
    } finally {
      setDraftImageActionKey(null);
    }
  };

  const startPublish = async (id: string, payload?: { publishMode?: "now" | "schedule"; scheduledDate?: string }) => {
    openMaterials(id, payload?.publishMode || "now");
  };

  // 즉시 발행 - SSE 방식
  const handlePublish = async (id: string) => {
    const busyMessage = getBusyMessage();
    if (busyMessage) {
      setDashboardNotice({
        tone: "info",
        text: busyMessage,
      });
      return;
    }

    await startPublish(id, { publishMode: "now" });
  };

  // 모든 포스팅 정지 — 실행 중 발행 프로세스 종료 + 대기열(PUBLISHING) 복구
  const handleStopPosting = async () => {
    if (!confirm("진행 중인 모든 포스팅을 정지할까요?\n실행 중인 발행이 중단되고, 자동화 브라우저가 닫힙니다.")) {
      return;
    }
    try {
      setStoppingPosting(true);
      const res = await fetch("/api/posting/stop", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setDashboardNotice({ tone: "info", text: data.message || "포스팅을 정지했습니다." });
        setPublishingId(null);
        setTopicPublishingId(null);
        fetchLinks();
        fetchTopicTasks();
      } else {
        setDashboardNotice({ tone: "error", text: data.error || "포스팅 정지에 실패했습니다." });
      }
    } catch (error) {
      console.error("포스팅 정지 실패:", error);
      setDashboardNotice({ tone: "error", text: "포스팅 정지 중 오류가 발생했습니다." });
    } finally {
      setStoppingPosting(false);
    }
  };

  const handleSchedulePublish = async (link: BrandLink) => { openMaterials(link.id, "schedule"); };

  const handleBulkSeasonalRegister = async (count: number) => {
    const busyMessage = getBusyMessage();
    if (busyMessage) {
      setDashboardNotice({
        tone: "info",
        text: busyMessage,
      });
      return;
    }

    try {
      setBulkSeasonalRunning(true);
      setDashboardNotice({
        tone: "info",
        text: `시즌·히트·인기 상품 ${count}개 등록 요청을 시작했습니다...`,
      });

      const res = await fetch("/api/brandlinks/bulk-seasonal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count,
          intervalDays: 1,
          waitForCompletion: true,
          ...getBrandConnectSelectionPayload(),
        }),
      });
      const data = (await res.json()) as BulkActionResponse;

      if (!res.ok || !data.success) {
        setDashboardNotice({
          tone: "error",
          text: `시즌·히트·인기 자동등록 시작 실패: ${data.error || "알 수 없는 오류"}`,
        });
        return;
      }

      setDashboardNotice({
        tone: "success",
        text: data.data?.completed
          ? `${brandConnectKind === "travel" ? "여행" : "쇼핑"}상품 동기화 완료: ${data.data.synchronizedCount ?? data.data.importedCount ?? 0}건 반영, 현재 ${data.data.totalCount ?? 0}건`
          : `상품 동기화 시작: ${data.data?.startDate ?? "-"} ~ ${data.data?.endDate ?? "-"}`,
      });
      await fetchLinks();
    } catch (error) {
      console.error("시즌·히트·인기 자동등록 시작 실패:", error);
      setDashboardNotice({
        tone: "error",
        text: "시즌·히트·인기 자동등록 시작 중 오류가 발생했습니다.",
      });
    } finally {
      setBulkSeasonalRunning(false);
    }
  };

  const handleBulkSchedulePublish = async (_requestedLimit = MAX_BULK_SCHEDULE_LIMIT) => { openMaterials(undefined, "schedule"); };

  const handleBulkTodayPublish = async (_requestedLimit = MAX_TODAY_PUBLISH_LIMIT) => { openMaterials(); };

  const handleSuperPublishing = async () => { openMaterials(); };

  // 발행 완료 핸들러
  const handlePublishComplete = () => {
    fetchLinks();
    setPublishingId(null);
    setDashboardNotice({
      tone: "success",
      text: "발행이 완료되었습니다.",
    });
  };

  // 발행 에러 핸들러
  const handlePublishError = (error: string) => {
    setDashboardNotice({
      tone: "error",
      text: `발행 실패: ${error}`,
    });
    fetchLinks();
    setPublishingId(null);
  };

  const visibleLinks = links.filter((link) => isBrandLinkForKind(link, brandConnectKind));
  const activeConnectLabel = brandConnectKind === "travel" ? "여행커넥트" : "쇼핑커넥트";
  const travelPublishingUnavailable =
    brandConnectKind === "travel" && !brandConnectRegistrationAvailable;

  // 현재 선택한 커넥트 통계 계산
  const stats = {
    total: visibleLinks.length,
    ready: visibleLinks.filter((l) => l.status === "READY").length,
    scheduled: visibleLinks.filter((l) => l.status === "SCHEDULED").length,
    published: visibleLinks.filter((l) => l.status === "PUBLISHED").length,
    failed: visibleLinks.filter((l) => l.status === "FAILED").length,
  };

  // 상태 배지 색상
  const getStatusColor = (status: string) => {
    switch (status) {
      case "READY": return "bg-blue-100 text-blue-800";
      case "RESEARCHING": return "bg-sky-100 text-sky-800";
      case "CANDIDATES_READY": return "bg-violet-100 text-violet-800";
      case "SELECTED": return "bg-fuchsia-100 text-fuchsia-800";
      case "POLISHING": return "bg-purple-100 text-purple-800";
      case "IMAGE_READY": return "bg-amber-100 text-amber-800";
      case "PREPARED": return "bg-emerald-100 text-emerald-800";
      case "DRAFTING": return "bg-violet-100 text-violet-800";
      case "PUBLISHING": return "bg-yellow-100 text-yellow-800";
      case "SCHEDULED": return "bg-indigo-100 text-indigo-800";
      case "PUBLISHED": return "bg-green-100 text-green-800";
      case "FAILED": return "bg-red-100 text-red-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "READY": return "대기";
      case "RESEARCHING": return "리서치";
      case "CANDIDATES_READY": return "후보 확보";
      case "SELECTED": return "후보 선택";
      case "POLISHING": return "윤문중";
      case "IMAGE_READY": return "이미지 확보";
      case "PREPARED": return "준비완료";
      case "DRAFTING": return "초안 작성중";
      case "PUBLISHING": return "발행중";
      case "SCHEDULED": return "예약완료";
      case "PUBLISHED": return "발행완료";
      case "FAILED": return "실패";
      default: return status;
    }
  };

  const readyScheduledCount = visibleLinks.filter(
    (link) => link.status === "READY" && formatDateDisplay(link.scheduledPublishAt) !== "-"
  ).length;
    const readyImmediateCount = visibleLinks.filter(link => link.status === "READY").length;
  const draftPrepareCandidateCount = visibleLinks.filter(
    (link) => ["READY", "FAILED"].includes(link.status) && !link.draftApproved,
  ).length;
  const readyTopicScheduledCount = topicTasks.filter(canBulkScheduleTopicTask).length;
  const busyMessageForUi = getBusyMessage();

  // V5: 리뷰 생성
  const handleReview = async (publish: boolean) => {
    if (!reviewPlaceName || !reviewNotes) {
      alert("장소명과 메모는 필수입니다.");
      return;
    }

    try {
      setReviewLoading(true);
      setReviewResult(null);

      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeName: reviewPlaceName,
          address: reviewAddress,
          rawNotes: reviewNotes,
          keywords: reviewKeywords,
          tips: reviewTips,
          category: reviewCategory,
          publish,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setReviewResult(data.data);
        if (publish) {
          alert("블로그 글이 발행되었습니다!");
        }
      } else {
        alert(`오류: ${data.error}`);
      }
    } catch (error) {
      console.error("리뷰 생성 실패:", error);
      alert("리뷰 생성 중 오류가 발생했습니다.");
    } finally {
      setReviewLoading(false);
    }
  };

  const handleAddTopicTask = async () => {
    if (!newTopic.trim()) {
      alert("주제를 입력하세요.");
      return;
    }

    try {
      setAddingTopic(true);
      const res = await fetch("/api/topic-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: newTopic.trim(),
          keywords: newTopicKeywords.trim() || null,
          type: newTopicType.trim() || null,
          topicCraftCategory: newTopicCraftCategory,
          memo: newTopicMemo.trim() || null,
          categoryNo: newTopicCategoryNo.trim() || null,
          scheduledPublishAt: newTopicScheduledDate.trim() || null,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setNewTopic("");
        setNewTopicKeywords("");
        setNewTopicType("정보성");
        setNewTopicCraftCategory("교육 / 자기계발");
        setNewTopicMemo("");
        setNewTopicCategoryNo("");
        setNewTopicScheduledDate("");
        fetchTopicTasks();
        alert("주제 포스팅 태스크가 추가되고 준비까지 완료되었습니다.");
      } else {
        fetchTopicTasks();
        alert(`오류: ${data.error}`);
      }
    } catch (error) {
      console.error("주제 추가 실패:", error);
      alert("주제 추가 중 오류가 발생했습니다.");
    } finally {
      setAddingTopic(false);
    }
  };

  const handlePrepareTopicTask = async (id: string) => {
    try {
      setTopicPreparingId(id);
      setDashboardNotice({
        tone: "info",
        text: "주제글 prepare 파이프라인을 실행 중입니다...",
      });

      const res = await fetch(`/api/topic-tasks/${id}/prepare`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setDashboardNotice({
          tone: "error",
          text: `주제글 준비 실패: ${data.error || "알 수 없는 오류"}`,
        });
        fetchTopicTasks();
        return;
      }

      setDashboardNotice({
        tone: "success",
        text: "주제글 준비가 완료되었습니다. 미리보기와 이미지 상태를 확인한 뒤 발행하세요.",
      });
      fetchTopicTasks();
    } catch (error) {
      console.error("주제글 준비 실패:", error);
      setDashboardNotice({
        tone: "error",
        text: "주제글 준비 중 오류가 발생했습니다.",
      });
      fetchTopicTasks();
    } finally {
      setTopicPreparingId(null);
    }
  };

  const handleDeleteTopicTask = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;

    try {
      const res = await fetch(`/api/topic-tasks/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchTopicTasks();
      }
    } catch (error) {
      console.error("삭제 실패:", error);
    }
  };

  const startTopicPublish = async (
    id: string,
    payload?: { publishMode?: "now" | "schedule"; scheduledDate?: string }
  ) => {
    setTopicPublishingId(id);
    setDashboardNotice({
      tone: "info",
      text:
        payload?.publishMode === "schedule"
          ? "예약 발행 요청을 시작했습니다..."
          : "즉시 발행 요청을 시작했습니다...",
    });
    try {
      const res = await fetch(`/api/topic-tasks/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? { publishMode: "now" }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setDashboardNotice({
          tone: "error",
          text: `발행 시작 실패: ${data.error || "알 수 없는 오류"}`,
        });
        setTopicPublishingId((prev) => (prev === id ? null : prev));
        fetchTopicTasks();
        return;
      }

      fetchTopicTasks();

      setDashboardNotice({
        tone: "success",
        text: "발행 백그라운드 작업이 시작되었습니다. 터미널 로그를 확인하세요.",
      });
    } catch (error) {
      console.error("발행 시작 실패:", error);
      setDashboardNotice({
        tone: "error",
        text: "발행 시작 중 오류가 발생했습니다.",
      });
      setTopicPublishingId((prev) => (prev === id ? null : prev));
      fetchTopicTasks();
    }
  };

  const handleTopicPublish = async (id: string) => {
    await startTopicPublish(id, { publishMode: "now" });
  };

  const handleUpdateTopicTask = async (id: string, updates: Partial<TopicPostTask>) => {
    try {
      const res = await fetch(`/api/topic-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.success) {
        fetchTopicTasks();
        if (updates.topic || updates.keywords || updates.type || updates.memo || updates.topicCraftCategory) {
          setDashboardNotice({
            tone: "info",
            text: "주제 설정이 바뀌어 prepared 콘텐츠가 초기화되었습니다. 다시 준비를 실행하세요.",
          });
        }
      } else {
        alert(`오류: ${data.error}`);
      }
    } catch (error) {
      console.error("태스크 업데이트 실패:", error);
      alert("업데이트 중 오류가 발생했습니다.");
    }
  };

  const handleTopicSchedulePublish = async (task: TopicPostTask) => {
    setTopicScheduleDialog({ id: task.id, date: new Date(Date.now() + 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) });
  };

  const handleTopicBulkSchedulePublish = async () => {
    const busyMessage = getBusyMessage();
    if (busyMessage) {
      setDashboardNotice({
        tone: "info",
        text: busyMessage,
      });
      return;
    }

    const targetableCount = topicTasks.filter(canBulkScheduleTopicTask).length;

    if (targetableCount === 0) {
      setDashboardNotice({
        tone: "info",
        text: "예약일이 지정된 준비완료 주제글이 없습니다.",
      });
      return;
    }

    const limit = Math.min(10, targetableCount);

    try {
      setTopicBulkScheduleRunning(true);
      setDashboardNotice({
        tone: "info",
        text: `주제글 예약배포 일괄 실행 요청 시작 (${limit}건)...`,
      });

      const res = await fetch("/api/topic-tasks/bulk-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit,
          delayMs: 1500,
        }),
      });
      const data = (await res.json()) as BulkActionResponse;

      if (!res.ok || !data.success) {
        setDashboardNotice({
          tone: "error",
          text: `주제글 예약배포 일괄 실행 실패: ${data.error || "알 수 없는 오류"}`,
        });
        return;
      }

      if ((data.data?.targetCount ?? 0) === 0) {
        setDashboardNotice({
          tone: "info",
          text: data.message || "실행할 주제글 예약배포 대상이 없습니다.",
        });
        return;
      }

      setDashboardNotice({
        tone: "success",
        text: `주제글 예약배포 일괄 실행 시작: ${data.data?.targetCount ?? limit}건${
          data.data?.logFile ? ` / 로그: ${data.data.logFile}` : ""
        }`,
      });
      setTimeout(() => {
        void fetchTopicTasks();
      }, 1500);
    } catch (error) {
      console.error("주제글 예약배포 일괄 실행 실패:", error);
      setDashboardNotice({
        tone: "error",
        text: "주제글 예약배포 일괄 실행 중 오류가 발생했습니다.",
      });
    } finally {
      setTopicBulkScheduleRunning(false);
    }
  };

  const draftImageMinimum = draftPreview?.composition?.qualityReport.target.images.min || 0;
  const draftImageRecommended = draftPreview?.composition?.qualityReport.target.images.recommended
    || draftImageMinimum;
  const draftImageActual = draftPreview?.composition?.qualityReport.actual.images
    || (draftPreview ? draftPreview.bodyImagePaths.length + 1 : 0);
  const draftMissingImageCount = draftPreview?.imageSlots?.reduce(
    (sum, slot) => sum + Math.max(slot.missing, slot.generationMissing),
    0,
  ) || 0;
  const draftCompositionQualityPassed = draftPreview?.composition?.qualityReport.canAutoPublish !== false;
  const draftContentQualityPassed = draftPreview?.approval?.contentPassed ?? isDraftEditorialQualityPassed(draftPreview?.contentQuality);
  const draftApprovalBlockers = draftPreview ? getDraftApprovalBlockers(draftPreview) : [];
  const draftBusy = Boolean(draftGeneratingId || draftImageActionKey || draftApproving || draftRechecking || draftImagesRunning);
  const draftApprovalBlocked = draftBusy || draftApprovalBlockers.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* 헤더 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                📝 네이버 블로그 자동화
              </h1>
              <p className="text-sm text-slate-500">브랜드커넥트 링크 관리 &amp; 발행</p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/topic-candidates"
                className="px-4 py-2 text-sm bg-orange-100 text-orange-600 rounded-lg hover:bg-orange-200 transition-colors"
              >
                📝 소재발굴
              </Link>
              <Link
                href="/keywords"
                className="px-4 py-2 text-sm bg-purple-100 text-purple-600 rounded-lg hover:bg-purple-200 transition-colors"
              >
                🔍 키워드
              </Link>
              <Link
                href="/history"
                className="px-4 py-2 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
              >
                📊 히스토리
              </Link>
              <Link
                href="/settings"
                className="px-4 py-2 text-sm bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors"
              >
                ⚙️ 설정
              </Link>
              <button
                onClick={() => fetchLinks()}
                className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                title="새로고침"
              >
                🔄
              </button>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* 세션 상태 */}
        <SessionStatus />

        {dashboardNotice && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              dashboardNotice.tone === "success"
                ? "bg-green-50 border-green-200 text-green-800"
                : dashboardNotice.tone === "error"
                ? "bg-red-50 border-red-200 text-red-700"
                : "bg-amber-50 border-amber-200 text-amber-800"
            }`}
          >
            {dashboardNotice.tone === "success"
              ? "✅ "
              : dashboardNotice.tone === "error"
              ? "❌ "
              : "⏳ "}
            {dashboardNotice.text}
          </div>
        )}

        {/* 통계 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-slate-800">{stats.total}</div>
            <div className="text-sm text-slate-500">전체</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-blue-600">{stats.ready}</div>
            <div className="text-sm text-blue-600">대기중</div>
          </div>
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-indigo-600">{stats.scheduled}</div>
            <div className="text-sm text-indigo-600">예약완료</div>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-emerald-600">{stats.published}</div>
            <div className="text-sm text-emerald-600">발행완료</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-red-600">{stats.failed}</div>
            <div className="text-sm text-red-600">실패</div>
          </div>
        </div>

        {/* V5: 콘텐츠 생성 모드 탭 */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setContentMode("product")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${contentMode === "product"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
            >
              🛒 상품 리뷰
            </button>
            <button
              onClick={() => setContentMode("review")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${contentMode === "review"
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
            >
              📝 장소/제품 리뷰
            </button>
            <button
              onClick={() => setContentMode("topic")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${contentMode === "topic"
                ? "bg-purple-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
            >
              🎯 주제 콘텐츠
            </button>
          </div>

          {/* 리뷰 모드 폼 */}
          {contentMode === "review" && (
            <div className="space-y-4 border-t pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">장소/제품명 *</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={reviewPlaceName}
                      onChange={(e) => setReviewPlaceName(e.target.value)}
                      placeholder="예: 뽀로로테마파크 다산"
                      className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      onClick={async () => {
                        if (!reviewPlaceName) return;
                        setSearchingPlace(true);
                        try {
                          const res = await fetch(`/api/place?q=${encodeURIComponent(reviewPlaceName)}`);
                          const data: PlaceSearchResponse = await res.json();
                          const places = data.data?.places;

                          if (data.success && Array.isArray(places) && places.length > 0) {
                            setPlaceSearchResults(places);
                          } else {
                            setPlaceSearchResults([]);
                          }
                        } catch (e) {
                          console.error(e);
                        } finally {
                          setSearchingPlace(false);
                        }
                      }}
                      disabled={!reviewPlaceName || searchingPlace}
                      className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 disabled:opacity-50"
                    >
                      {searchingPlace ? "⏳" : "🔍"}
                    </button>
                  </div>
                  {placeSearchResults.length > 0 && (
                    <div className="mt-2 border border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                      {placeSearchResults.map((place, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setReviewPlaceName(place.title);
                            setReviewAddress(place.roadAddress || place.address || "");
                            setPlaceSearchResults([]);
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-emerald-50 border-b last:border-b-0"
                        >
                          <div className="font-medium">{place.title}</div>
                          <div className="text-slate-500 text-xs">{place.roadAddress || place.address}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">주소</label>
                  <input
                    type="text"
                    value={reviewAddress}
                    onChange={(e) => setReviewAddress(e.target.value)}
                    placeholder="예: 경기 남양주시 다산지금로 202"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">카테고리</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: "place", label: "📍 장소" },
                    { value: "food", label: "🍽️ 맛집" },
                    { value: "travel", label: "✈️ 여행" },
                    { value: "parenting", label: "👶 육아" },
                    { value: "product", label: "📦 제품" },
                  ].map((cat) => (
                    <button
                      key={cat.value}
                      onClick={() => setReviewCategory(cat.value as ReviewCategory)}
                      className={`px-3 py-1 rounded-lg text-sm ${reviewCategory === cat.value
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">메모/경험 *</label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="방문 경험, 느낀점, 장점, 특이사항 등을 자유롭게 작성해주세요..."
                  rows={4}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">키워드 (쉼표로 구분)</label>
                  <input
                    type="text"
                    value={reviewKeywords}
                    onChange={(e) => setReviewKeywords(e.target.value)}
                    placeholder="남양주, 아이와가볼만한곳, 실내놀이터"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">TIP (쉼표로 구분)</label>
                  <input
                    type="text"
                    value={reviewTips}
                    onChange={(e) => setReviewTips(e.target.value)}
                    placeholder="주차 무료, 평일 방문 추천"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleReview(false)}
                  disabled={reviewLoading}
                  className="px-6 py-2 bg-slate-600 text-white font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50"
                >
                  {reviewLoading ? "생성 중..." : "✨ 미리보기"}
                </button>
                <button
                  onClick={() => handleReview(true)}
                  disabled={reviewLoading}
                  className="px-6 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {reviewLoading ? "발행 중..." : "🚀 바로 발행"}
                </button>
              </div>

              {/* 리뷰 결과 */}
              {reviewResult && (
                <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <h3 className="font-semibold text-emerald-800 mb-2">📄 생성된 리뷰</h3>
                  <p className="text-lg font-medium text-slate-800">{reviewResult.title || reviewPlaceName}</p>
                  {reviewResult.published && (
                    <p className="text-sm text-emerald-600 mt-2">✅ 블로그에 발행되었습니다!</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 주제(간편) 모드 폼 */}
          {contentMode === "topic" && (
            <TopicTaskPanel
              addingTopic={addingTopic}
              categoryLoading={categoryLoading}
              categoryOptions={categoryOptions}
              defaultCategoryNo={defaultCategoryNo}
              getCategoryLabel={getCategoryLabel}
              newTopic={newTopic}
              newTopicCategoryNo={newTopicCategoryNo}
              newTopicCraftCategory={newTopicCraftCategory}
              newTopicKeywords={newTopicKeywords}
              newTopicMemo={newTopicMemo}
              newTopicScheduledDate={newTopicScheduledDate}
              newTopicType={newTopicType}
              onAddTopicTask={handleAddTopicTask}
              onDeleteTopicTask={handleDeleteTopicTask}
              onBulkSchedulePublish={handleTopicBulkSchedulePublish}
              onPrepareTopicTask={handlePrepareTopicTask}
              onTopicPublish={handleTopicPublish}
              onTopicSchedulePublish={handleTopicSchedulePublish}
              onUpdateTopicTask={handleUpdateTopicTask}
              setNewTopic={setNewTopic}
              setNewTopicCategoryNo={setNewTopicCategoryNo}
              setNewTopicCraftCategory={setNewTopicCraftCategory}
              setNewTopicKeywords={setNewTopicKeywords}
              setNewTopicMemo={setNewTopicMemo}
              setNewTopicScheduledDate={setNewTopicScheduledDate}
              setNewTopicType={setNewTopicType}
              tasks={topicTasks}
              readyScheduledTopicCount={readyTopicScheduledCount}
              topicBulkScheduleRunning={topicBulkScheduleRunning}
              topicLoading={topicLoading}
              topicPreparingId={topicPreparingId}
              topicPublishingId={topicPublishingId}
            />
          )}
        </div>

        {/* 링크 추가 폼 - 상품 모드에서만 표시 */}
        {contentMode === "product" && (
          <>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h2 className="font-semibold text-slate-800 mb-3">➕ 브랜드커넥트 링크 추가</h2>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <input
                    type="url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://naver.me/xxx 또는 브랜드커넥트 URL"
                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={newMemo}
                    onChange={(e) => setNewMemo(e.target.value)}
                    placeholder="메모 (선택)"
                    className="w-48 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-center gap-3">
                  {categoryOptions.length > 0 || categoryLoading ? (
                    <select
                      value={newCategoryNo}
                      onChange={(e) => setNewCategoryNo(e.target.value)}
                      className="w-56 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      disabled={categoryLoading || categoryOptions.length === 0}
                    >
                      {categoryLoading && categoryOptions.length === 0 ? (
                        <option value="">게시판 목록 불러오는 중...</option>
                      ) : (
                        <>
                          <option value="">
                            {defaultCategoryNo
                              ? `기본 게시판 (${getCategoryLabel(defaultCategoryNo)})`
                              : "기본 게시판"}
                          </option>
                          {categoryOptions.map((category) => (
                            <option key={category.categoryNo} value={category.categoryNo}>
                              {category.displayName}
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={newCategoryNo}
                      onChange={(e) => setNewCategoryNo(e.target.value.replace(/[^\d]/g, ""))}
                      placeholder="게시판 번호 (예: 7)"
                      className="w-56 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                  {categoryError && (
                    <span className="text-xs text-amber-600">
                      게시판 목록 조회 실패: 번호 직접 입력
                    </span>
                  )}
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={newUseSectionHeading}
                      onChange={(e) => setNewUseSectionHeading(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    소제목 스타일 적용
                  </label>
                  <button
                    onClick={handleAddLink}
                    disabled={adding}
                    className="ml-auto px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {adding ? "추가 중..." : "추가"}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex flex-col gap-3 mb-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-slate-800">⚙️ 커넥트별 일괄 작업</h2>
                  <span className="text-xs font-medium text-slate-500">현재 목록 {visibleLinks.length}건</span>
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="브랜드커넥트 종류">
                  {([
                    { kind: "shopping" as const, label: "🛍️ 쇼핑커넥트", count: links.filter((link) => isBrandLinkForKind(link, "shopping")).length },
                    { kind: "travel" as const, label: "✈️ 여행커넥트", count: links.filter((link) => isBrandLinkForKind(link, "travel")).length },
                  ]).map((tab) => {
                    const selected = brandConnectKind === tab.kind;
                    return (
                      <button
                        key={tab.kind}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => selectBrandConnectKind(tab.kind)}
                        className={`rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${
                          selected
                            ? tab.kind === "travel"
                              ? "bg-amber-500 text-white shadow-sm"
                              : "bg-blue-600 text-white shadow-sm"
                            : "text-slate-600 hover:bg-white hover:text-slate-900"
                        }`}
                      >
                        {tab.label} <span className={selected ? "text-white/80" : "text-slate-400"}>({tab.count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-full space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_auto] gap-3 items-end">
                    <label className="block">
                      <span className="block text-xs font-medium text-slate-600 mb-1">
                        {brandConnectKind === "travel" ? "여행커넥트 목록 URL (선택)" : "브랜드커넥트 카테고리 URL"}
                      </span>
                      <input
                        type="text"
                        value={brandConnectCategoryUrl}
                        onChange={(e) => setBrandConnectCategoryUrl(e.target.value)}
                        placeholder={
                          brandConnectKind === "travel"
                            ? "비워두면 로그인 세션에서 자동 탐색"
                            : "https://brandconnect.naver.com/.../category/..."
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-xs font-medium text-slate-600 mb-1">중복 제외</span>
                      <input
                        type="number"
                        min="0"
                        max="3650"
                        value={brandConnectDuplicateWindowDays}
                        onChange={(e) => setBrandConnectDuplicateWindowDays(e.target.value.replace(/[^\d]/g, ""))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void loadBrandConnectSelectionOptions()}
                      disabled={brandConnectOptionsLoading}
                      className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {brandConnectOptionsLoading ? "불러오는 중..." : "옵션 불러오기"}
                    </button>
                  </div>

                  {brandConnectOptionsError && (
                    <p className="text-xs text-red-600">{brandConnectOptionsError}</p>
                  )}
                  {!brandConnectOptionsError && brandConnectOptionsNotice && (
                    <p className="text-xs text-slate-500">{brandConnectOptionsNotice}</p>
                  )}
                  {brandConnectKind === "travel" && (
                    <div className="flex flex-col md:flex-row md:items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs text-amber-800 flex-1">
                        {brandConnectCaptureRequired
                          ? "여행커넥트 목록 계약이 아직 없습니다. 아래 버튼으로 1회 캡처하면 이후에는 목록 조회와 등록·발행이 열립니다."
                          : "여행커넥트는 로그인된 세션에서 화면과 응답 구조를 자동 탐색해 1회 캡처합니다. 원문 개인정보는 저장하지 않습니다."}
                        {" "}
                        발행 시 에디터 삽입 결과를 검증해, 올바른 여행 상품이 첨부되지 않으면 발행을 중단합니다.
                      </p>
                      <button
                        type="button"
                        onClick={() => void captureTravelContract()}
                        disabled={travelContractCapturing}
                        className="px-3 py-2 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {travelContractCapturing ? "진단 캡처 중..." : "여행 응답 진단 캡처"}
                      </button>
                    </div>
                  )}
                  {travelContractMessage && <p className="text-xs text-amber-700">{travelContractMessage}</p>}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="border border-slate-200 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-sm font-medium text-slate-700">
                          {brandConnectKind === "travel" ? "여행 조건 선택" : "카테고리 선택"} ({selectedBrandConnectCategoryIds.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedBrandConnectCategoryIds([])}
                          className="text-xs text-slate-500 hover:text-slate-800"
                        >
                          초기화
                        </button>
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {brandConnectCategoryOptions.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            {brandConnectOptionsLoading
                              ? brandConnectKind === "travel" ? "여행 조건 로드 중..." : "카테고리 로드 중..."
                              : brandConnectKind === "travel" ? "로드된 여행 조건이 없습니다." : "로드된 카테고리가 없습니다."}
                          </p>
                        ) : (
                          brandConnectCategoryOptions.map((category) => (
                            <label
                              key={category.id}
                              className="flex items-center gap-2 text-sm text-slate-700"
                              style={{ paddingLeft: `${Math.min(category.depth, 3) * 12}px` }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedBrandConnectCategoryIds.includes(category.id)}
                                onChange={() =>
                                  setSelectedBrandConnectCategoryIds((current) =>
                                    toggleStringSelection(current, category.id)
                                  )
                                }
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="flex-1 truncate">{category.name}</span>
                              <span className="text-xs text-slate-400">{category.productCount}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-sm font-medium text-slate-700">
                          {brandConnectKind === "travel" ? "여행 혜택 선택" : "프로모션/이벤트 카테고리"} ({selectedBrandConnectPromotions.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedBrandConnectPromotions([])}
                          className="text-xs text-slate-500 hover:text-slate-800"
                        >
                          초기화
                        </button>
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {brandConnectPromotionOptions.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            {brandConnectOptionsLoading
                              ? brandConnectKind === "travel" ? "여행 혜택 로드 중..." : "이벤트 카테고리 로드 중..."
                              : brandConnectKind === "travel" ? "감지된 여행 혜택이 없습니다." : "로드된 이벤트 카테고리가 없습니다."}
                          </p>
                        ) : (
                          brandConnectPromotionOptions.map((promotion) => (
                            <label
                              key={promotion.value}
                              className="flex items-center gap-2 text-sm text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={selectedBrandConnectPromotions.includes(promotion.value)}
                                onChange={() =>
                                  setSelectedBrandConnectPromotions((current) =>
                                    toggleStringSelection(current, promotion.value)
                                  )
                                }
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="flex-1 truncate">{promotion.label}</span>
                              <span className="text-xs text-slate-400">{promotion.count}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className={`w-full rounded-xl border p-3 ${brandConnectKind === "travel" ? "border-amber-200 bg-amber-50/60" : "border-blue-200 bg-blue-50/50"}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">{activeConnectLabel} 기능</h3>
                      <p className="text-xs text-slate-500">아래 작업과 상품 목록은 {activeConnectLabel} 항목에만 적용됩니다.</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${brandConnectKind === "travel" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
                      {visibleLinks.length}개
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleBulkSeasonalRegister(SEASONAL_REGISTER_COUNT_10)}
                      disabled={bulkDraftPreparing || bulkSeasonalRunning || bulkScheduleRunning || bulkTodayRunning || superPublishingRunning || topicBulkScheduleRunning || Boolean(publishingId)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {bulkSeasonalRunning ? "상품 동기화 중..." : `${brandConnectKind === "travel" ? "여행" : "쇼핑"} 인기상품 10개 동기화`}
                    </button>
                    <button
                      onClick={() => handleBulkSeasonalRegister(SEASONAL_REGISTER_COUNT_50)}
                      disabled={bulkDraftPreparing || bulkSeasonalRunning || bulkScheduleRunning || bulkTodayRunning || superPublishingRunning || topicBulkScheduleRunning || Boolean(publishingId)}
                      className="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {bulkSeasonalRunning ? "상품 동기화 중..." : `${brandConnectKind === "travel" ? "여행" : "쇼핑"} 인기상품 50개 동기화`}
                    </button>
                    <button
                      onClick={handleSuperPublishing}
                      disabled={travelPublishingUnavailable || bulkDraftPreparing || bulkSeasonalRunning || bulkScheduleRunning || bulkTodayRunning || superPublishingRunning || topicBulkScheduleRunning || Boolean(publishingId)}
                      title={travelPublishingUnavailable ? "여행 계약 자동 캡처 후 사용할 수 있습니다." : undefined}
                      className="px-4 py-2 bg-fuchsia-600 text-white rounded-lg hover:bg-fuchsia-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {superPublishingRunning ? "소재 보관함 여는 중..." : "소재 보관함"}
                    </button>
                    <button
                      onClick={() => void handleBulkPrepareBrandDrafts()}
                      disabled={travelPublishingUnavailable || bulkDraftPreparing || bulkSeasonalRunning || bulkScheduleRunning || bulkTodayRunning || superPublishingRunning || topicBulkScheduleRunning || Boolean(publishingId) || draftPrepareCandidateCount === 0}
                      title="리서치·원고·썸네일·본문 이미지를 미리 만들고 품질 통과본을 자동 승인합니다"
                      className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {bulkDraftPreparing
                        ? `소재 작성 중 ${bulkDraftProgress.completed}/${bulkDraftProgress.total}`
                        : `미리작성할 상품 선택 (최대 ${Math.min(MAX_BULK_DRAFT_PREPARE_LIMIT, draftPrepareCandidateCount)}개)`}
                    </button>
                    <button
                      onClick={() => void handleBulkSchedulePublish()}
                      disabled={travelPublishingUnavailable || bulkDraftPreparing || bulkSeasonalRunning || bulkScheduleRunning || bulkTodayRunning || superPublishingRunning || topicBulkScheduleRunning || Boolean(publishingId) || false}
                      title={travelPublishingUnavailable ? "여행 계약 자동 캡처 후 사용할 수 있습니다." : undefined}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {bulkScheduleRunning ? "예약발행 일괄 실행 중..." : "준비된 소재 선택 · 예약발행"}
                    </button>
                    <button
                      onClick={() => void handleBulkTodayPublish()}
                      disabled={travelPublishingUnavailable || bulkDraftPreparing || bulkSeasonalRunning || bulkScheduleRunning || bulkTodayRunning || superPublishingRunning || topicBulkScheduleRunning || Boolean(publishingId) || false}
                      title={travelPublishingUnavailable ? "여행 계약 자동 캡처 후 사용할 수 있습니다." : undefined}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {bulkTodayRunning ? "바로 일괄발행 중..." : "준비된 소재 선택 · 바로발행"}
                    </button>

                  </div>
                  {travelPublishingUnavailable && (
                    <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
                      여행상품 계약이 아직 확인되지 않았습니다. 위의 “여행 계약 자동 캡처”를 실행하면 목록 확인 후 발행 버튼이 열립니다.
                    </p>
                  )}
                  {!travelPublishingUnavailable && (
                    <p className="mt-3 text-xs text-slate-500">
                      소재 미리작성과 발행을 별도 단계로 진행합니다. 준비된 소재를 확인하고 선택해 주세요.
                    </p>
                  )}
                </div>
                <div className="flex w-full items-center gap-3 border-t border-slate-200 pt-3">
                  <button
                    onClick={handleStopPosting}
                    disabled={stoppingPosting}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
                    title="진행 중인 모든 포스팅을 즉시 정지하고 대기열을 복구합니다"
                  >
                    {stoppingPosting ? "정지 중..." : "⛔ 전체 포스팅 정지"}
                  </button>
                  <p className="text-xs text-slate-500">정지 기능은 쇼핑·여행 작업 전체에 적용됩니다.</p>
                </div>
              </div>
              {busyMessageForUi && (
                <p className="mt-2 text-xs text-amber-700">
                  ⏳ {busyMessageForUi}
                </p>
              )}
            </div>

            <MaterialLibrary connectKind={brandConnectKind}
              candidates={visibleLinks.filter(link => ["READY", "FAILED"].includes(link.status))}
              selectionRequest={materialSelectionRequest}
              onPreview={id => { void fetch(`/api/brandlinks/${id}/draft`, { cache: "no-store" }).then(response => response.json()).then(result => {
                if (!result.success || !result.data) throw new Error(result.error || "저장된 소재가 없습니다.");
                setDraftPreview(result.data); setDraftPreviewTab("post");
              }).catch(error => setDashboardNotice({ tone: "error", text: error.message })); }}
              onChanged={() => { void fetchLinks({ silent: true }); }} />

            {/* 간결한 상품 작업 목록 */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="font-semibold text-slate-800">{activeConnectLabel} 상품 목록</h2>
                  <p className="text-xs text-slate-500">다른 커넥트 상품은 해당 탭에서 확인할 수 있습니다.</p>
                </div>
                <span className="text-sm font-semibold text-slate-600">{visibleLinks.length}건</span>
              </div>
              <table className="w-full min-w-[1080px] table-fixed">
                <colgroup>
                  <col className="w-[44%]" />
                  <col className="w-[10%]" />
                  <col className="w-[20%]" />
                  <col className="w-[26%]" />
                </colgroup>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">상품</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">상태</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">설정</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">자동 발행</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        로딩 중...
                      </td>
                    </tr>
                  ) : visibleLinks.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        등록된 {activeConnectLabel} 상품이 없습니다. 위에서 상품을 동기화하거나 링크를 추가하세요.
                      </td>
                    </tr>
                  ) : (
                    visibleLinks.map((link) => {
                      const thumbnailUrl = getFirstImageUrl(link.imageUrls);

                      return (
                        <tr key={link.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="flex min-w-0 items-center gap-3">
                              {/* 이미지 썸네일 */}
                              {thumbnailUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={thumbnailUrl}
                                  alt=""
                                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                                />
                              )}
                              <div className="min-w-0">
                                <div className="line-clamp-2 break-keep font-medium leading-6 text-slate-800">
                                  {link.productName || "(상품 정보 없음)"}
                                </div>
                                {link.productPrice && (
                                  <div className="text-sm text-slate-500">{link.productPrice}</div>
                                )}
                                <div className="mt-1 flex gap-2 text-xs"><a href={link.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">상품 보기</a>{link.postUrl && <a href={link.postUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">발행 글</a>}</div>
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-center">
                            <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${getStatusColor(link.status)}`}>
                              {getStatusText(link.status)}
                            </span>
                            {link.draftApproved ? (
                              <div className="mt-1 text-[11px] font-semibold text-emerald-700">소재 준비완료</div>
                            ) : link.draftPrepared ? (
                              <SavedDraftAutoReview id={link.id} revision={link.draftRevision || link.draftPreparedAt || "saved"} enabled={["READY", "FAILED"].includes(link.status) && !busyMessageForUi} />
                            ) : null}
                            {link.errorMessage && (
                              <div className="text-xs text-red-500 mt-1" title={link.errorMessage}>
                                ⚠️
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <div className="space-y-1">
                              <div className="whitespace-nowrap text-xs text-slate-500">
                                게시판: {getCategoryLabel(link.categoryNo)}
                                {link.categoryNo ? ` (${link.categoryNo})` : ""}
                              </div>
                              <div className="whitespace-nowrap text-xs text-slate-500">
                                소제목: {link.useSectionHeading ? "ON" : "OFF"}
                              </div>
                              <div className="whitespace-nowrap text-xs text-slate-500">
                                예약발행일: {formatDateDisplay(link.scheduledPublishAt)}
                              </div>
                              <div className="flex items-center justify-center gap-2">
                                {categoryOptions.length > 0 || categoryLoading ? (
                                  <select
                                    value={link.categoryNo ?? ""}
                                    onChange={(e) => {
                                      void handleSelectCategoryNo(link, e.target.value);
                                    }}
                                    className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                                    disabled={
                                      updatingCategoryId === link.id ||
                                      categoryLoading ||
                                      categoryOptions.length === 0
                                    }
                                  >
                                    {categoryLoading && categoryOptions.length === 0 ? (
                                      <option value="">게시판 로딩중...</option>
                                    ) : (
                                      <>
                                        <option value="">
                                          {defaultCategoryNo
                                            ? `기본 (${getCategoryLabel(defaultCategoryNo)})`
                                            : "기본"}
                                        </option>
                                        {categoryOptions.map((category) => (
                                          <option key={category.categoryNo} value={category.categoryNo}>
                                            {category.displayName}
                                          </option>
                                        ))}
                                      </>
                                    )}
                                  </select>
                                ) : (
                                  <span className="px-2 py-1 text-xs bg-slate-100 text-slate-500 rounded">
                                    게시판 로드 실패
                                  </span>
                                )}
                                <button
                                  onClick={() => handleToggleSectionHeading(link)}
                                  className={`shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs transition-colors ${
                                    link.useSectionHeading
                                      ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                                      : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                                  }`}
                                >
                                  소제목
                                </button>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex flex-wrap items-center justify-center gap-2">
                              <button
                                onClick={() => setThumbnailStudioLink(link)}
                                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${link.connectKind === "TRAVEL" ? "bg-amber-100 text-amber-800 hover:bg-amber-200" : "bg-blue-100 text-blue-700 hover:bg-blue-200"}`}
                                title="실제 상품 사진으로 카피 썸네일 만들기"
                              >
                                2. 썸네일
                              </button>
                              <button onClick={() => void handlePublish(link.id)} disabled={Boolean(getBusyMessage()) || !["READY", "FAILED"].includes(link.status) || (link.connectKind === "TRAVEL" && travelPublishingUnavailable)} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">발행 소재 선택</button>
                              <button onClick={() => void handleSchedulePublish(link)} disabled={Boolean(getBusyMessage()) || !["READY", "FAILED"].includes(link.status) || (link.connectKind === "TRAVEL" && travelPublishingUnavailable)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">예약 소재 선택</button>
                              {link.draftPrepared && <button onClick={() => void handleOpenOrPrepareBrandDraft(link)} title="저장된 초안과 이미지를 확인합니다" className="rounded-lg border px-3 py-2 text-sm">저장 원고 보기</button>}
                              {/* 여행 계약 잠금만 목록에서 표시하고, 실제 발행은 승인 창에서 진행 */}
                              {link.status === "READY" && link.connectKind === "TRAVEL" && travelPublishingUnavailable && (
                                <span
                                  className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800"
                                  title="여행 계약 자동 캡처 후 사용할 수 있습니다."
                                >
                                  🔒 여행 계약 확인 필요
                                </span>
                              )}

                              {/* 재발행 */}
                              {link.status === "FAILED" && link.connectKind === "TRAVEL" && travelPublishingUnavailable && (
                                <span
                                  className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800"
                                  title="여행 계약 자동 캡처 후 사용할 수 있습니다."
                                >
                                  🔒 여행 계약 확인 필요
                                </span>
                              )}

                              {/* 삭제 */}
                              <button
                                onClick={() => handleDeleteLink(link.id)}
                                className="rounded-lg px-2 py-2 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                                title="삭제"
                              >
                                삭제
                              </button>
                            </div>
                            {/* 발행 진행률 */}
                            {publishingId === link.id && (
                              <p role="status" className="mt-2 text-sm text-indigo-700">초안 준비·자동 검수·발행 진행 중 — 완료 결과를 기다리고 있습니다.</p>
                            )}
                            {/* 발행된 글 URL */}
                            {link.status === "PUBLISHED" && link.postUrl && (
                              <a
                                href={link.postUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 block text-xs text-blue-600 hover:underline"
                              >
                                📎 발행된 글 보기
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* 사용 안내 */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <h3 className="font-medium text-slate-800 mb-2">💡 사용 방법</h3>
          <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
            <li>네이버 로그인 상태를 확인하고 쇼핑 또는 여행 탭을 선택합니다.</li>
            <li>여러 상품은 <strong>소재 미리 작성</strong>으로 글·썸네일·본문 이미지를 먼저 준비할 수 있습니다.</li>
            <li><strong>소재 보관함</strong>에서 준비된 항목을 선택하고 바로 발행하거나 예약일을 지정합니다.</li>
            <li><strong>2. 썸네일</strong>에서 실제 사진과 디자인 스타일을 고릅니다.</li>
            <li>미리작성 단계에서 이미지 보충·검수·보강을 처리합니다. 발행 단계는 선택한 저장 소재만 사용하며, 미완성 소재는 사유를 표시합니다.</li>
          </ol>
        </div>
      </main>

      {thumbnailStudioLink && (
        <ProductThumbnailStudio
          brandLinkId={thumbnailStudioLink.id}
          productName={thumbnailStudioLink.productName || "추천 상품"}
          onClose={() => setThumbnailStudioLink(null)}
        />
      )}

      {chatGptDraftHandoff && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="chatgpt-draft-title">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl">
            <div className="bg-gradient-to-br from-violet-700 via-indigo-700 to-slate-950 px-6 py-6 text-white sm:px-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-bold ring-1 ring-white/20">API 키 없이 이용</span>
                  <h2 id="chatgpt-draft-title" className="mt-3 text-2xl font-black tracking-tight">ChatGPT에서 이 상품의 초안을 완성하세요</h2>
                  <p className="mt-2 text-sm leading-6 text-indigo-100">사이트 OAuth는 안전한 MCP 연결을 인증합니다. 실제 원고는 연결된 ChatGPT 대화에서 만들어 PC 앱으로 다시 저장됩니다.</p>
                </div>
                <button type="button" onClick={() => { setChatGptDraftHandoff(null); setChatGptDraftHandoffReason(null); }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-2xl font-light leading-none text-white hover:bg-white/20" aria-label="ChatGPT 초안 안내 닫기">×</button>
              </div>
            </div>

            <div className="space-y-5 px-6 py-6 sm:px-8">
              <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
                <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${chatGptDraftHandoff.connectKind === "TRAVEL" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-700"}`}>{chatGptDraftHandoff.connectKind === "TRAVEL" ? "여행커넥트" : "쇼핑커넥트"}</span>
                <p className="truncate font-bold text-slate-950" title={chatGptDraftHandoff.productLabel}>{chatGptDraftHandoff.productLabel}</p>
              </div>

              {chatGptDraftHandoffReason ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                  <strong className="block text-xs font-black uppercase tracking-wide text-amber-700">웹 자동작성 실패 안내</strong>
                  {chatGptDraftHandoffReason}
                </div>
              ) : null}

              <ol className="grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
                {["요청문 자동 복사", "ChatGPT에서 붙여넣기", "완성 초안을 PC에서 승인"].map((label, index) => (
                  <li key={label} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-black text-white">{index + 1}</span>
                    <span className="font-semibold">{label}</span>
                  </li>
                ))}
              </ol>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="chatgpt-draft-prompt" className="text-sm font-bold text-slate-900">상품별 실행 요청문</label>
                  <span className="text-xs text-slate-400">발행은 포함하지 않음</span>
                </div>
                <textarea id="chatgpt-draft-prompt" readOnly value={chatGptDraftHandoff.prompt} className="h-48 w-full resize-none rounded-2xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:ring-2 focus:ring-violet-400" />
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => void handleCopyChatGptDraftPrompt()} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">요청문만 복사</button>
                <button type="button" onClick={handleCopyAndOpenChatGpt} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-violet-200 hover:bg-violet-700">복사하고 ChatGPT 열기 ↗</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {topicScheduleDialog && <div role="dialog" aria-modal="true" aria-label="예약 발행일" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6"><h3 className="text-lg font-bold">예약 발행일 (한국시간)</h3><input aria-label="예약일" autoFocus type="date" value={topicScheduleDialog.date} onChange={event => setTopicScheduleDialog({ ...topicScheduleDialog, date: event.target.value })} className="w-full rounded border p-2" /><div className="flex justify-end gap-2"><button onClick={() => setTopicScheduleDialog(null)} className="rounded border px-4 py-2">취소</button><button onClick={() => { const selected = topicScheduleDialog; setTopicScheduleDialog(null); void startTopicPublish(selected.id, { publishMode: "schedule", scheduledDate: selected.date }); }} className="rounded bg-indigo-700 px-4 py-2 text-white">예약 발행</button></div></div></div>}
      {draftPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="고품질 초안 미리보기">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-xs font-semibold text-violet-600">{draftPreview.connectKind === "SHOPPING" ? "쇼핑커넥트" : "여행커넥트"} 고품질 패키지</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">{draftPreview.title}</h2>
                <p className="mt-1 text-xs text-slate-500">{draftPreview.imagePolicy === "LOCKED_PRODUCT_OR_ORIGINAL" ? "상품 원본 잠금 적용 · 변형 금지" : "여행 전용 에디토리얼 이미지"} · {draftPreview.composition?.contractVersion || "호환 초안"}</p>
              </div>
              <button onClick={() => setDraftPreview(null)} className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100">닫기</button>
            </div>
            <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-6 pt-3">
              {([
                ["post", "글"],
                ["images", `이미지 ${draftImageActual}장`],
                ["thumbnail", "썸네일"],
                ["quality", draftApprovalBlockers.length ? `승인 조건 · ${draftApprovalBlockers.length}개 확인` : "품질검사"],
              ] as const).map(([tab, label]) => (
                <button key={tab} type="button" onClick={() => setDraftPreviewTab(tab)} className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${draftPreviewTab === tab ? "bg-white text-violet-700 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-900"}`}>{label}</button>
              ))}
            </div>
            <div className="flex-1 overflow-auto px-6 py-5">
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm" aria-live="polite">
                <p className="font-semibold text-slate-800">{draftPreview.approvedAt ? "승인된 초안" : draftApprovalBlockers.length ? "아직 승인할 수 없습니다" : "내용 확인 후 승인 요청 가능 · 서버에서 최종 검사"}</p>
                <p className="mt-1 text-slate-600">원고: {draftContentQualityPassed ? "검사 통과" : "검사 결과 확인 필요"} · 구성·이미지: {draftCompositionQualityPassed && !draftMissingImageCount && !draftImagesRunning ? "저장된 검사 결과 확인" : "준비 필요"}. 점수 100점도 전체 준비 완료를 뜻하지 않습니다.</p>
                {draftApprovalBlockers.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-red-700">{draftApprovalBlockers.map((message) => <li key={message}>{message}</li>)}</ul>}
                {dashboardNotice && <p className={`mt-2 ${dashboardNotice.tone === "error" ? "text-red-700" : "text-slate-700"}`}>{dashboardNotice.text}</p>}
                {draftGeneratingId === draftPreview.brandLinkId && <p className="mt-2 text-violet-700">원고 요청 처리 중 · 서버 응답 대기 중입니다. 세부 진행률은 제공되지 않습니다.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!draftContentQualityPassed && !draftPreview.approvedAt && <button type="button" disabled={draftBusy || !links.some((link) => link.id === draftPreview.brandLinkId)} onClick={() => void handleRepairBrandDraft()} className="rounded-lg border border-violet-300 px-3 py-2 font-semibold text-violet-700 disabled:opacity-40">원고 보강 요청</button>}
                  {draftMissingImageCount > 0 && <button type="button" disabled={draftBusy} onClick={() => void handleGenerateMissingDraftImages()} className="rounded-lg border border-violet-300 px-3 py-2 font-semibold text-violet-700 disabled:opacity-40">누락 이미지 보충</button>}
                  <button type="button" disabled={draftBusy} onClick={() => void handleRecheckBrandDraft()} className="rounded-lg border border-slate-300 px-3 py-2 text-slate-700 disabled:opacity-40">{draftRechecking ? "재검사 중…" : "최신 기준 재검사"}</button>
                </div>
              </div>
              {draftPreviewTab === "post" && (
                <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{draftPreview.markdown}</pre>
              )}
              {draftPreviewTab === "images" && (
                <div className="space-y-5">
                  <div className="flex flex-col gap-4 rounded-2xl border border-violet-200 bg-violet-50 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-violet-600">Image coverage</p>
                      <p className="mt-1 text-lg font-black text-slate-950">현재 {draftImageActual}장 · 최소 {draftImageMinimum}장 · 권장 {draftImageRecommended}장</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {draftMissingImageCount > 0
                          ? `적합한 이미지가 부족한 파트가 ${draftMissingImageCount}개입니다. 확인된 원본을 재사용하고 부족한 이미지만 보충합니다.`
                          : "이미지가 필요한 모든 파트에 원본 또는 생성 이미지가 연결됐습니다."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleGenerateMissingDraftImages()}
                      disabled={draftBusy || draftMissingImageCount === 0}
                      className="shrink-0 rounded-xl bg-violet-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-violet-200 hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {draftImageActionKey === "missing" ? "섹션 이미지 생성 중…" : "섹션별 이미지 자동 생성"}
                    </button>
                  </div>

                  {(draftPreview.imageAssets || []).filter((asset) => asset.role === "hero").map((asset) => (
                    <div key={`hero-${asset.assetKey}`} className="rounded-2xl border border-slate-200 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div><p className="text-xs font-bold text-violet-600">대표 썸네일</p><p className="mt-1 text-sm font-semibold text-slate-700">{brandImageProvenanceLabel(asset.provenance)}</p></div>
                        <button
                          type="button"
                          onClick={() => void handleRegenerateDraftImage(asset.assetKey)}
                          disabled={draftBusy}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                        >
                          {draftImageActionKey === `asset:${asset.assetKey}` ? "재생성 중…" : "이 썸네일 다시 생성"}
                        </button>
                      </div>
                      <div className="max-w-xs overflow-hidden rounded-xl bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={asset.previewUrl} alt={`${draftPreview.title} 대표 썸네일`} className="aspect-square w-full object-cover" />
                      </div>
                    </div>
                  ))}

                  {draftPreview.imageSlots?.length ? draftPreview.imageSlots.map((slot, index) => (
                    <div key={slot.sectionId} className={`rounded-2xl border p-4 ${Math.max(slot.missing, slot.generationMissing) > 0 ? "border-amber-300 bg-amber-50/50" : "border-slate-200"}`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-bold text-violet-600">{index + 1}. {slot.sectionId}</p>
                          <h3 className="mt-1 font-semibold text-slate-900">{slot.title}</h3>
                          <p className="mt-2 text-sm text-slate-600">{slot.intent}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${Math.max(slot.missing, slot.generationMissing) > 0 ? "bg-amber-200 text-amber-900" : "bg-emerald-100 text-emerald-700"}`}>
                            원본 {slot.originalCount} · 생성 {slot.generatedCount}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleGenerateDraftSectionImage(slot.sectionId)}
                            disabled={draftBusy || slot.maximum === 0 || (slot.count >= slot.maximum && slot.generationMissing === 0)}
                            className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {draftImageActionKey === `section:${slot.sectionId}` ? "추가 중…" : "+ 이미지 추가"}
                          </button>
                        </div>
                      </div>
                      {slot.assets.length > 0 ? (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {slot.assets.map((asset, assetIndex) => (
                            <figure key={`${asset.assetKey}-${assetIndex}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                              <div className="aspect-[4/3] overflow-hidden bg-slate-100">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={asset.previewUrl} alt={`${slot.title} 이미지 ${assetIndex + 1}`} className="h-full w-full object-cover" />
                              </div>
                              <figcaption className="flex items-center justify-between gap-2 p-3">
                                <span className="truncate text-xs font-semibold text-slate-500">{brandImageProvenanceLabel(asset.provenance)}</span>
                                <button
                                  type="button"
                                  onClick={() => void handleRegenerateDraftImage(asset.assetKey)}
                                  disabled={draftBusy}
                                  className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-40"
                                >
                                  {draftImageActionKey === `asset:${asset.assetKey}` ? "생성 중…" : "다시 생성"}
                                </button>
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-4 flex min-h-28 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-400">
                          아직 배치된 이미지가 없습니다.
                        </div>
                      )}
                    </div>
                  )) : <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">기존 v1 초안입니다. 다시 만들면 이미지 미리보기와 파트별 추가 생성을 사용할 수 있습니다.</p>}
                </div>
              )}
              {draftPreviewTab === "thumbnail" && (
                <div className="grid gap-6 md:grid-cols-[minmax(0,520px)_1fr]">
                  <div className="aspect-square overflow-hidden rounded-2xl bg-slate-950">
                    {draftPreview.heroPreviewDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={draftPreview.heroPreviewDataUrl} alt="초안 대표 썸네일" className="h-full w-full object-contain" />
                    ) : <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-400">대표 이미지 미리보기를 불러올 수 없습니다.</div>}
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">캔버스</p><p className="mt-1 font-bold text-slate-900">{draftPreview.thumbnailSpec ? `${draftPreview.thumbnailSpec.canvas.width}×${draftPreview.thumbnailSpec.canvas.height} · ${draftPreview.thumbnailSpec.canvas.aspect}` : "기존 비율"}</p></div>
                    <div className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">스타일</p><p className="mt-1 font-bold text-slate-900">{draftPreview.thumbnailSpec?.style || "호환 스타일"}</p></div>
                    <div className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">소스 정책</p><p className="mt-1 text-sm font-semibold text-slate-900">{draftPreview.thumbnailSpec?.sourcePolicy || draftPreview.imagePolicy}</p></div>
                    <p className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">작은 라벨·메인 카피·실사 피사체 3요소만 사용합니다. 쇼핑 상품은 원본 RGB와 비율을 잠그고 배경만 연출합니다.</p>
                    {(draftPreview.imageAssets || []).some((asset) => asset.role === "hero") && (
                      <button
                        type="button"
                        onClick={() => {
                          const hero = (draftPreview.imageAssets || []).find((asset) => asset.role === "hero");
                          if (hero) void handleRegenerateDraftImage(hero.assetKey);
                        }}
                        disabled={draftBusy}
                        className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-black text-white hover:bg-violet-700 disabled:opacity-40"
                      >
                        {draftImageActionKey?.startsWith("asset:") ? "썸네일 생성 중…" : "이 썸네일 다시 생성"}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {draftPreviewTab === "quality" && (
                draftPreview.composition ? (
                  <div className="space-y-4">
                    <div className={`rounded-2xl p-5 ${draftContentQualityPassed ? "bg-emerald-50" : "bg-red-50"}`}>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-600">원고 내용 QC</p>
                          <p className="mt-1 text-3xl font-black text-slate-950">{draftPreview.approval?.contentScore ?? draftPreview.contentQuality?.quality?.score ?? draftPreview.contentQuality?.score ?? "-"}점</p>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">{draftContentQualityPassed ? "원고 내용 품질검사 통과 · 이미지 준비 상태는 아래 게이트에서 별도로 확인합니다." : draftPreview.approval?.blockers.filter(item => item.code === "content-quality").map(item => item.reason).join(" ") || draftPreview.contentQuality?.reason || draftPreview.contentQuality?.summary || "원고 내용을 재검사하세요."}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <span className={`rounded-full px-3 py-1 text-sm font-bold ${draftContentQualityPassed ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
                            {draftContentQualityPassed ? "내용 통과" : "내용 보강 필요"}
                          </span>
                        </div>
                      </div>
                    </div>
                    {draftPreview.qualityRepair && (
                      <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${draftPreview.qualityRepair.applied ? "bg-blue-50 text-blue-800" : "bg-slate-100 text-slate-700"}`}>
                        {getRepairStatus(draftPreview.qualityRepair)}
                        <p className="mt-1 font-normal">{draftPreview.qualityRepair.note}</p>
                      </div>
                    )}
                    {draftPreview.imageGeneration && (
                      <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        섹션 이미지 · {draftPreview.imageGeneration.status === "running" ? "서버 작업 진행 중 · 3초마다 상태 확인" : draftPreview.imageGeneration.status === "complete" ? "완료" : "일부 미완료"}
                        {` · ${draftPreview.imageGeneration.applied}장 반영 · ${draftPreview.imageGeneration.remaining}장 남음`}
                        {draftPreview.imageGeneration.errors.map((error, index) => <p key={index}>{error}</p>)}
                      </div>
                    )}
                    <div className={`rounded-2xl border p-5 ${draftCompositionQualityPassed ? "border-emerald-200" : "border-amber-300 bg-amber-50"}`}>
                      <div className="flex items-end justify-between gap-4">
                        <div><p className="text-sm font-semibold text-slate-600">구성·이미지 게이트</p><p className="mt-1 text-2xl font-black text-slate-950">{draftPreview.composition.qualityReport.score}점</p></div>
                        <span className={`rounded-full px-3 py-1 text-sm font-bold ${draftCompositionQualityPassed ? "bg-emerald-100 text-emerald-700" : "bg-amber-500 text-white"}`}>{draftCompositionQualityPassed ? "구성 통과" : "구성 보완 필요"}</span>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {([
                        ["본문", draftPreview.composition.qualityReport.actual.characters, `${draftPreview.composition.qualityReport.target.characters.min}~${draftPreview.composition.qualityReport.target.characters.max}자`],
                        ["섹션", draftPreview.composition.qualityReport.actual.sections, `${draftPreview.composition.qualityReport.target.sections.min}~${draftPreview.composition.qualityReport.target.sections.max}개`],
                        ["이미지", draftPreview.composition.qualityReport.actual.images, `최소 ${draftImageMinimum} · 권장 ${draftImageRecommended}장`],
                      ] as const).map(([label, actual, target]) => <div key={label} className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-900">{actual}</p><p className="text-xs text-slate-400">목표 {target}</p></div>)}
                    </div>
                    {draftPreview.contentQuality?.signals.filter((signal) => signal.status !== "pass").map((signal) => (
                      <p key={signal.key} className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                        {signal.status === "fail" ? "검사 실패" : "권고"} · {signal.label}
                      </p>
                    ))}
                    {draftPreview.composition.qualityReport.blockers.map((message) => <p key={message} className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">차단 · {message}</p>)}
                    {draftPreview.composition.qualityReport.warnings.map((message) => <p key={message} className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">확인 · {message}</p>)}
                    <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">작성 모드: {draftPreview.composition.experienceMode === "VERIFIED_EXPERIENCE" ? "검증된 실제 체험" : "AI 보조 정보형 · 실제 체험 후기 아님"}</p>
                  </div>
                ) : <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">기존 v1 초안입니다. 다시 만들면 품질 점수와 차단 사유를 확인할 수 있습니다.</p>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
              <span className={`text-sm font-semibold ${draftPreview.approvedAt ? "text-emerald-600" : "text-amber-600"}`}>
                {draftPreview.approvedAt ? "승인 완료 · 발행 결과 고정" : "승인 전 · 아직 발행되지 않음"}
              </span>
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={() => { const link = links.find((item) => item.id === draftPreview.brandLinkId); if (link) void handlePrepareBrandDraft(link); }} disabled={draftBusy || !links.some((link) => link.id === draftPreview.brandLinkId)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">전체 다시 만들기</button>
                {!draftPreview.approvedAt && <button onClick={() => void handleApproveBrandDraft()} disabled={draftApproving || draftApprovalBlocked} title={draftApprovalBlocked ? "품질검사 탭의 차단 항목을 먼저 보완하세요." : undefined} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">{draftApproving ? "승인 중..." : "이 초안 승인"}</button>}
                {draftPreview.approvedAt && <button onClick={() => { const link = links.find((item) => item.id === draftPreview.brandLinkId); if (link) { setDraftPreview(null); void handleSchedulePublish(link); } }} className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">예약 발행</button>}
                {draftPreview.approvedAt && <button onClick={() => { const id = draftPreview.brandLinkId; setDraftPreview(null); void handlePublish(id); }} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">3. 승인본 바로 발행</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 푸터 */}
      <footer className="border-t border-slate-800 bg-slate-950 mt-8 text-white">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-lime-300 mb-2">CONTACT &amp; CUSTOM DEVELOPMENT</p>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight">기타 문의나 프로그램 개발이 필요하신가요?</h2>
            <p className="mt-2 text-sm text-slate-400">프로그램 사용 문의부터 업무 자동화·맞춤 프로그램 개발 상담까지 텔레그램으로 연락해 주세요.</p>
          </div>
          <a
            href="https://t.me/Jake_shin"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="텔레그램으로 문의하기 (새 창)"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-[5px_5px_0_#bef264] transition-transform hover:-translate-y-0.5"
          >
            텔레그램 문의 <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="max-w-6xl mx-auto border-t border-slate-800 px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-slate-500">
          <span>네이버 블로그 자동화 시스템 • 브랜드커넥트</span>
          <span>기타 문의 · 프로그램 개발 문의</span>
        </div>
      </footer>
    </div>
  );
}
