"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import SessionStatus from "@/components/SessionStatus";
import PublishProgress from "@/components/PublishProgress";
import TopicTaskPanel from "@/components/TopicTaskPanel";
import ProductThumbnailStudio from "@/components/ProductThumbnailStudio";
import { ThemeToggle } from "@/components/ThemeProvider";
import { getTopicTaskContentReadiness } from "@/lib/topic-task-content-readiness";
import { getTopicTaskPublishReadiness } from "@/lib/topic-task-publish-readiness";

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
}

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
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [thumbnailStudioLink, setThumbnailStudioLink] = useState<BrandLink | null>(null);
  const [stoppingPosting, setStoppingPosting] = useState(false);
  const [bulkSeasonalRunning, setBulkSeasonalRunning] = useState(false);
  const [bulkScheduleRunning, setBulkScheduleRunning] = useState(false);
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
    if (bulkTodayRunning) return "바로 일괄발행 작업이 이미 실행 중입니다.";
    if (superPublishingRunning) return "수퍼 퍼블리싱 작업이 이미 실행 중입니다.";
    if (topicBulkScheduleRunning) return "주제글 예약배포 일괄 실행 작업이 이미 실행 중입니다.";
    return null;
  }, [
    publishingId,
    topicPublishingId,
    bulkSeasonalRunning,
    bulkScheduleRunning,
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

  const fetchLinks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/brandlinks", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setLinks(data.data);
      }
    } catch (error) {
      console.error("링크 조회 실패:", error);
    } finally {
      setLoading(false);
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
    const handleBlogIdChanged = () => void fetchCategories();
    window.addEventListener("blogautomcp:blog-id-changed", handleBlogIdChanged);
    return () => window.removeEventListener("blogautomcp:blog-id-changed", handleBlogIdChanged);
  }, [fetchCategories]);

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
    if (current.status !== "PUBLISHING") {
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
  const startPublish = async (
    id: string,
    payload?: { publishMode?: "now" | "schedule"; scheduledDate?: string }
  ) => {
    setPublishingId(id);
    setDashboardNotice({
      tone: "info",
      text:
        payload?.publishMode === "schedule"
          ? "예약 발행 요청을 시작했습니다..."
          : "즉시 발행 요청을 시작했습니다...",
    });
    try {
      const requestedMode = payload?.publishMode ?? "now";
      const res = await fetch(`/api/brandlinks/${id}/publish`, {
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
        setPublishingId((prev) => (prev === id ? null : prev));
        fetchLinks();
        return;
      }

      const actualMode = data?.data?.publishMode as "now" | "schedule" | undefined;
      if (actualMode && actualMode !== requestedMode) {
        setDashboardNotice({
          tone: "error",
          text: `발행 모드 불일치: 요청=${requestedMode}, 서버=${actualMode}`,
        });
        setPublishingId((prev) => (prev === id ? null : prev));
        fetchLinks();
        return;
      }

      const logFile = data?.data?.logFile as string | undefined;

      fetchLinks();

      if (payload?.publishMode === "schedule") {
        const requested = data?.data?.requestedScheduledDate as string | undefined;
        const effective = data?.data?.effectiveScheduledDate as string | undefined;
        const adjusted = Boolean(data?.data?.adjustedFromPast);
        if (adjusted && effective) {
          setDashboardNotice({
            tone: "success",
            text: `예약발행 시작: 입력일(${requested ?? "-"}) → 자동조정(${effective})${logFile ? ` / 로그: ${logFile}` : ""}`,
          });
        } else if (effective) {
          setDashboardNotice({
            tone: "success",
            text: `예약발행 시작: 예약발행일 ${effective}${logFile ? ` / 로그: ${logFile}` : ""}`,
          });
        }
      } else if (logFile) {
        setDashboardNotice({
          tone: "success",
          text: `즉시발행 시작 / 로그: ${logFile}`,
        });
      }
    } catch (error) {
      console.error("발행 시작 실패:", error);
      setDashboardNotice({
        tone: "error",
        text: "발행 시작 중 오류가 발생했습니다.",
      });
      setPublishingId((prev) => (prev === id ? null : prev));
      fetchLinks();
    }
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

  const handleSchedulePublish = async (link: BrandLink) => {
    const busyMessage = getBusyMessage();
    if (busyMessage) {
      setDashboardNotice({
        tone: "info",
        text: busyMessage,
      });
      return;
    }

    const presetDate = formatDateDisplay(link.scheduledPublishAt);
    let defaultDate = presetDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(defaultDate)) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      defaultDate = formatDateInputLocal(tomorrow);
    }
    const input = prompt(
      "예약 발행일을 입력하세요. (YYYY-MM-DD)\n과거 또는 당일 날짜를 입력하면 자동으로 다음날로 조정됩니다.",
      defaultDate
    );

    if (input === null) {
      setDashboardNotice({
        tone: "info",
        text: "예약발행일 입력이 취소되었거나 브라우저에서 입력창(prompt)이 차단되었습니다.",
      });
      return;
    }
    const scheduledDate = input.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      setDashboardNotice({
        tone: "error",
        text: "날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력하세요.",
      });
      return;
    }

    await startPublish(link.id, {
      publishMode: "schedule",
      scheduledDate,
    });
  };

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
        text: `시즌·히트·인기 자동등록 시작: ${data.data?.startDate ?? "-"} ~ ${data.data?.endDate ?? "-"}${
          data.data?.logFile ? ` / 로그: ${data.data.logFile}` : ""
        }`,
      });
      setTimeout(() => {
        void fetchLinks();
      }, 1500);
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

  const handleBulkSchedulePublish = async () => {
    const busyMessage = getBusyMessage();
    if (busyMessage) {
      setDashboardNotice({
        tone: "info",
        text: busyMessage,
      });
      return;
    }

    const readyScheduledCount = links.filter(
      (link) => isBrandLinkForKind(link, brandConnectKind) && link.status === "READY" && formatDateDisplay(link.scheduledPublishAt) !== "-"
    ).length;

    if (readyScheduledCount === 0) {
      setDashboardNotice({
        tone: "info",
        text: "예약발행일이 지정된 대기 링크(READY)가 없습니다.",
      });
      return;
    }

    const limit = Math.min(MAX_BULK_SCHEDULE_LIMIT, readyScheduledCount);

    try {
      setBulkScheduleRunning(true);
      setDashboardNotice({
        tone: "info",
        text: `예약발행 일괄 실행 요청 시작 (${limit}건)...`,
      });

      const res = await fetch("/api/brandlinks/bulk-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit,
          delayMs: 1500,
          connectKind: brandConnectKind,
        }),
      });
      const data = (await res.json()) as BulkActionResponse;

      if (!res.ok || !data.success) {
        setDashboardNotice({
          tone: "error",
          text: `예약발행 일괄 실행 실패: ${data.error || "알 수 없는 오류"}`,
        });
        return;
      }

      if ((data.data?.targetCount ?? 0) === 0) {
        setDashboardNotice({
          tone: "info",
          text: data.message || "실행할 예약발행 대상이 없습니다.",
        });
        return;
      }

      setDashboardNotice({
        tone: "success",
        text: `예약발행 일괄 실행 시작: ${data.data?.targetCount ?? limit}건${
          data.data?.startDate && data.data?.endDate ? ` (${data.data.startDate} ~ ${data.data.endDate})` : ""
        }${
          data.data?.scheduleMode === "preserve-existing-dates" ? " (저장된 예약일 기준)" : ""
        }${
          data.data?.logFile ? ` / 로그: ${data.data.logFile}` : ""
        }`,
      });
      setTimeout(() => {
        void fetchLinks();
      }, 1500);
    } catch (error) {
      console.error("예약발행 일괄 실행 실패:", error);
      setDashboardNotice({
        tone: "error",
        text: "예약발행 일괄 실행 중 오류가 발생했습니다.",
      });
    } finally {
      setBulkScheduleRunning(false);
    }
  };

  const handleBulkTodayPublish = async () => {
    const busyMessage = getBusyMessage();
    if (busyMessage) {
      setDashboardNotice({
        tone: "info",
        text: busyMessage,
      });
      return;
    }

    const readyImmediateCount = links.filter(
      (link) => isBrandLinkForKind(link, brandConnectKind) && link.status === "READY" && formatDateDisplay(link.scheduledPublishAt) !== "-"
    ).length;

    if (readyImmediateCount === 0) {
      setDashboardNotice({
        tone: "info",
        text: "바로 발행할 예약 대기 링크(READY)가 없습니다.",
      });
      return;
    }

    const limit = Math.min(MAX_TODAY_PUBLISH_LIMIT, readyImmediateCount);

    try {
      setBulkTodayRunning(true);
      setDashboardNotice({
        tone: "info",
        text: `바로 일괄발행 요청 시작 (${limit}건)...`,
      });

      const res = await fetch("/api/brandlinks/bulk-today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit,
          delayMs: 1500,
          allScheduled: true,
          connectKind: brandConnectKind,
        }),
      });
      const data = (await res.json()) as BulkActionResponse;

      if (!res.ok || !data.success) {
        setDashboardNotice({
          tone: "error",
          text: `바로 일괄발행 실패: ${data.error || "알 수 없는 오류"}`,
        });
        return;
      }

      if ((data.data?.targetCount ?? 0) === 0) {
        setDashboardNotice({
          tone: "info",
          text: data.message || "바로 발행할 대상이 없습니다.",
        });
        return;
      }

      setDashboardNotice({
        tone: "success",
        text: `바로 일괄발행 시작: ${data.data?.targetCount ?? limit}건${
          data.data?.targetDate ? ` (${data.data.targetDate})` : ""
        }${data.data?.logFile ? ` / 로그: ${data.data.logFile}` : ""}`,
      });
      setTimeout(() => {
        void fetchLinks();
      }, 1500);
    } catch (error) {
      console.error("바로 일괄발행 실패:", error);
      setDashboardNotice({
        tone: "error",
        text: "바로 일괄발행 중 오류가 발생했습니다.",
      });
    } finally {
      setBulkTodayRunning(false);
    }
  };

  const handleSuperPublishing = async () => {
    const busyMessage = getBusyMessage();
    if (busyMessage) {
      setDashboardNotice({
        tone: "info",
        text: busyMessage,
      });
      return;
    }

    try {
      setSuperPublishingRunning(true);
      setDashboardNotice({
        tone: "info",
        text: `수퍼 퍼블리싱 시작 요청 중입니다. 링크 ${SUPER_PUBLISH_COLLECT_COUNT}개 수집 후 ${SUPER_PUBLISH_DAILY_QUOTA}개씩 처리합니다...`,
      });

      const res = await fetch("/api/brandlinks/super-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectCount: SUPER_PUBLISH_COLLECT_COUNT,
          todayCount: SUPER_PUBLISH_DAILY_QUOTA,
          dailyQuota: SUPER_PUBLISH_DAILY_QUOTA,
          delayMs: 1500,
          ...getBrandConnectSelectionPayload(),
        }),
      });
      const data = (await res.json()) as BulkActionResponse;

      if (!res.ok || !data.success) {
        setDashboardNotice({
          tone: "error",
          text: `수퍼 퍼블리싱 시작 실패: ${data.error || "알 수 없는 오류"}`,
        });
        return;
      }

      setDashboardNotice({
        tone: "success",
        text: `수퍼 퍼블리싱 시작: 수집 ${data.data?.collectCount ?? SUPER_PUBLISH_COLLECT_COUNT}건, 바로발행 ${
          data.data?.todayCount ?? SUPER_PUBLISH_DAILY_QUOTA
        }건, 예약발행 ${data.data?.scheduledCount ?? SUPER_PUBLISH_COLLECT_COUNT - SUPER_PUBLISH_DAILY_QUOTA}건${
          data.data?.startDate && data.data?.endDate ? ` (${data.data.startDate} ~ ${data.data.endDate})` : ""
        }${data.data?.logFile ? ` / 로그: ${data.data.logFile}` : ""}`,
      });
      setTimeout(() => {
        void fetchLinks();
      }, 3000);
    } catch (error) {
      console.error("수퍼 퍼블리싱 시작 실패:", error);
      setDashboardNotice({
        tone: "error",
        text: "수퍼 퍼블리싱 시작 중 오류가 발생했습니다.",
      });
    } finally {
      setSuperPublishingRunning(false);
    }
  };

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
  const readyImmediateCount = readyScheduledCount;
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
    const presetDate = formatDateDisplay(task.scheduledPublishAt);
    let defaultDate = presetDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(defaultDate)) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      defaultDate = formatDateInputLocal(tomorrow);
    }
    const input = prompt(
      "예약 발행일을 입력하세요. (YYYY-MM-DD)",
      defaultDate
    );

    if (input === null) return;

    const scheduledDate = input.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      setDashboardNotice({
        tone: "error",
        text: "날짜 형식이 올바르지 않습니다.",
      });
      return;
    }

    await startTopicPublish(task.id, {
      publishMode: "schedule",
      scheduledDate,
    });
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
                          카테고리 선택 ({selectedBrandConnectCategoryIds.length})
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
                            {brandConnectOptionsLoading ? "카테고리 로드 중..." : "로드된 카테고리가 없습니다."}
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
                          프로모션/이벤트 카테고리 ({selectedBrandConnectPromotions.length})
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
                            {brandConnectOptionsLoading ? "이벤트 카테고리 로드 중..." : "로드된 이벤트 카테고리가 없습니다."}
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
                      disabled={bulkSeasonalRunning || bulkScheduleRunning || bulkTodayRunning || superPublishingRunning || topicBulkScheduleRunning || Boolean(publishingId)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {bulkSeasonalRunning ? "상품 동기화 중..." : `${brandConnectKind === "travel" ? "여행" : "쇼핑"} 인기상품 10개 동기화`}
                    </button>
                    <button
                      onClick={() => handleBulkSeasonalRegister(SEASONAL_REGISTER_COUNT_50)}
                      disabled={bulkSeasonalRunning || bulkScheduleRunning || bulkTodayRunning || superPublishingRunning || topicBulkScheduleRunning || Boolean(publishingId)}
                      className="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {bulkSeasonalRunning ? "상품 동기화 중..." : `${brandConnectKind === "travel" ? "여행" : "쇼핑"} 인기상품 50개 동기화`}
                    </button>
                    <button
                      onClick={handleSuperPublishing}
                      disabled={travelPublishingUnavailable || bulkSeasonalRunning || bulkScheduleRunning || bulkTodayRunning || superPublishingRunning || topicBulkScheduleRunning || Boolean(publishingId)}
                      title={travelPublishingUnavailable ? "여행 계약 자동 캡처 후 사용할 수 있습니다." : undefined}
                      className="px-4 py-2 bg-fuchsia-600 text-white rounded-lg hover:bg-fuchsia-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {superPublishingRunning ? "수퍼 퍼블리싱 시작 중..." : `${activeConnectLabel} 수퍼 퍼블리싱 ${SUPER_PUBLISH_COLLECT_COUNT}개`}
                    </button>
                    <button
                      onClick={handleBulkSchedulePublish}
                      disabled={travelPublishingUnavailable || bulkSeasonalRunning || bulkScheduleRunning || bulkTodayRunning || superPublishingRunning || topicBulkScheduleRunning || Boolean(publishingId) || readyScheduledCount === 0}
                      title={travelPublishingUnavailable ? "여행 계약 자동 캡처 후 사용할 수 있습니다." : undefined}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {bulkScheduleRunning ? "예약발행 일괄 실행 중..." : `${activeConnectLabel} 예약발행 (${Math.min(MAX_BULK_SCHEDULE_LIMIT, readyScheduledCount)}건)`}
                    </button>
                    <button
                      onClick={handleBulkTodayPublish}
                      disabled={travelPublishingUnavailable || bulkSeasonalRunning || bulkScheduleRunning || bulkTodayRunning || superPublishingRunning || topicBulkScheduleRunning || Boolean(publishingId) || readyImmediateCount === 0}
                      title={travelPublishingUnavailable ? "여행 계약 자동 캡처 후 사용할 수 있습니다." : undefined}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {bulkTodayRunning ? "바로 일괄발행 중..." : `${activeConnectLabel} 바로발행 (${Math.min(MAX_TODAY_PUBLISH_LIMIT, readyImmediateCount)}건)`}
                    </button>
                  </div>
                  {travelPublishingUnavailable && (
                    <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
                      여행상품 계약이 아직 확인되지 않았습니다. 위의 “여행 계약 자동 캡처”를 실행하면 목록 확인 후 발행 버튼이 열립니다.
                    </p>
                  )}
                  {!travelPublishingUnavailable && (
                    <p className="mt-3 text-xs text-slate-500">
                      수퍼 퍼블리싱은 {brandConnectKind === "travel" ? "여행상품" : "쇼핑상품"} 200개 수집 후 당일 50개 바로발행, 이후 50개씩 예약발행합니다.
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

            {/* 링크 테이블 */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="font-semibold text-slate-800">{activeConnectLabel} 상품 목록</h2>
                  <p className="text-xs text-slate-500">다른 커넥트 상품은 해당 탭에서 확인할 수 있습니다.</p>
                </div>
                <span className="text-sm font-semibold text-slate-600">{visibleLinks.length}건</span>
              </div>
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">상품</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">URL</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">상태</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">메모</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">설정</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        로딩 중...
                      </td>
                    </tr>
                  ) : visibleLinks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        등록된 {activeConnectLabel} 상품이 없습니다. 위에서 상품을 동기화하거나 링크를 추가하세요.
                      </td>
                    </tr>
                  ) : (
                    visibleLinks.map((link) => {
                      const thumbnailUrl = getFirstImageUrl(link.imageUrls);

                      return (
                        <tr key={link.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              {/* 이미지 썸네일 */}
                              {thumbnailUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={thumbnailUrl}
                                  alt=""
                                  className="w-12 h-12 object-cover rounded-lg"
                                />
                              )}
                              <div>
                                <div className="font-medium text-slate-800">
                                  {link.productName || "(상품 정보 없음)"}
                                </div>
                                {link.productPrice && (
                                  <div className="text-sm text-slate-500">{link.productPrice}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline text-sm"
                            >
                              {link.url.length > 40 ? link.url.substring(0, 40) + "..." : link.url}
                            </a>
                            {link.postUrl && (
                              <div className="mt-1">
                                <a
                                  href={link.postUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-green-600 hover:underline text-xs"
                                >
                                  📄 발행된 글 보기
                                </a>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(link.status)}`}>
                              {getStatusText(link.status)}
                            </span>
                            {link.errorMessage && (
                              <div className="text-xs text-red-500 mt-1" title={link.errorMessage}>
                                ⚠️
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-slate-500">
                            {link.memo || "-"}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="space-y-1">
                              <div className="text-xs text-slate-500">
                                게시판: {getCategoryLabel(link.categoryNo)}
                                {link.categoryNo ? ` (${link.categoryNo})` : ""}
                              </div>
                              <div className="text-xs text-slate-500">
                                소제목: {link.useSectionHeading ? "ON" : "OFF"}
                              </div>
                              <div className="text-xs text-slate-500">
                                예약발행일: {formatDateDisplay(link.scheduledPublishAt)}
                              </div>
                              <div className="flex items-center justify-center gap-1">
                                {categoryOptions.length > 0 || categoryLoading ? (
                                  <select
                                    value={link.categoryNo ?? ""}
                                    onChange={(e) => {
                                      void handleSelectCategoryNo(link, e.target.value);
                                    }}
                                    className="max-w-36 px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-700"
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
                                  className={`px-2 py-1 text-xs rounded transition-colors ${
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
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => setThumbnailStudioLink(link)}
                                className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                                title="실제 상품 사진으로 카피 썸네일 만들기"
                              >
                                🖼️ 썸네일
                              </button>
                              {/* 발행하기 버튼 */}
                              {link.status === "READY" && link.connectKind === "TRAVEL" && travelPublishingUnavailable && (
                                <span
                                  className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800"
                                  title="여행 계약 자동 캡처 후 사용할 수 있습니다."
                                >
                                  🔒 여행 계약 확인 필요
                                </span>
                              )}
                              {link.status === "READY" && (link.connectKind !== "TRAVEL" || !travelPublishingUnavailable) && (
                                <>
                                  <button
                                    onClick={() => handlePublish(link.id)}
                                    disabled={publishingId === link.id}
                                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                                  >
                                    {publishingId === link.id ? "⏳" : "🚀 즉시"}
                                  </button>
                                  <button
                                    onClick={() => handleSchedulePublish(link)}
                                    disabled={publishingId === link.id}
                                    className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                  >
                                    {publishingId === link.id ? "⏳" : "📅 예약"}
                                  </button>
                                </>
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
                              {link.status === "FAILED" && (link.connectKind !== "TRAVEL" || !travelPublishingUnavailable) && (
                                <>
                                  <button
                                    onClick={() => handlePublish(link.id)}
                                    disabled={publishingId === link.id}
                                    className="px-3 py-1 text-sm bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50 transition-colors"
                                  >
                                    🔄 즉시 재시도
                                  </button>
                                  <button
                                    onClick={() => handleSchedulePublish(link)}
                                    disabled={publishingId === link.id}
                                    className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                  >
                                    📅 예약 재시도
                                  </button>
                                </>
                              )}

                              {/* 삭제 */}
                              <button
                                onClick={() => handleDeleteLink(link.id)}
                                className="px-3 py-1 text-sm bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors"
                                title="삭제"
                              >
                                🗑️
                              </button>
                            </div>
                            {/* 발행 진행률 */}
                            {publishingId === link.id && (
                              <PublishProgress
                                linkId={link.id}
                                isPublishing={publishingId === link.id}
                                onComplete={handlePublishComplete}
                                onError={handlePublishError}
                              />
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
            <li>먼저 <code className="bg-slate-200 px-1 rounded">npm run login</code>으로 네이버 로그인</li>
            <li>브랜드커넥트 링크를 추가 (https://naver.me/xxx 형태)</li>
            <li>⚙️ 시즌·히트·인기 10개/50개 등록 버튼으로 예약발행 대상 링크를 자동 등록</li>
            <li>⚙️ 수퍼 퍼블리싱 200개 버튼으로 당일 50개 바로발행, 1~3일 뒤 50개씩 예약발행</li>
            <li>⚙️ 예약발행 일괄 실행 버튼으로 READY 글을 저장된 예약발행일 기준으로 순차 예약발행</li>
            <li>⚙️ 바로 일괄발행 버튼으로 예약 READY 글 전체를 즉시 순차 발행</li>
            <li>🚀 즉시 버튼은 바로 발행, 📅 예약 버튼은 예약 발행</li>
            <li>단건 예약에서 과거 또는 당일 날짜를 입력하면 자동으로 다음날로 조정됩니다.</li>
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
