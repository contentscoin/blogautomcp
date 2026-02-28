"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import SessionStatus from "@/components/SessionStatus";
import PublishProgress from "@/components/PublishProgress";
import { ThemeToggle } from "@/components/ThemeProvider";

type ContentMode = "product" | "topic" | "review";
type ReviewCategory = "place" | "food" | "travel" | "parenting" | "product";
type TopicType = "travel" | "golf" | "knowledge";
type TopicCampaignStatus =
  | "RESEARCHING"
  | "RESEARCH_DONE"
  | "SUBTOPIC_READY"
  | "DRAFT_READY"
  | "REVIEW"
  | "QUEUED"
  | "FAILED";
type TopicDraftStatus =
  | "SUBTOPIC_READY"
  | "DRAFTING"
  | "DRAFT_READY"
  | "REVIEW"
  | "APPROVED"
  | "QUEUED"
  | "PUBLISHED"
  | "FAILED";
type TopicApiAction =
  | "research"
  | "subtopics"
  | "draft"
  | "approve"
  | "queue"
  | "run-queue"
  | "publish-now"
  | "schedule";
type TopicActionLoading = TopicApiAction | null;

const TOPIC_ACTION_TIMEOUT_MS = {
  research: 240_000,
  subtopics: 300_000,
  draft: 1_200_000,
  approve: 180_000,
  queue: 180_000,
  "run-queue": 300_000,
  "publish-now": 180_000,
  schedule: 300_000,
} as const satisfies Record<TopicApiAction, number>;

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
    delayMs?: number;
    logFile?: string;
  };
}

interface TopicSnippet {
  url: string;
  title?: string;
  summary?: string;
  snippet?: string;
  error?: string;
}

type TopicSourceSummary = TopicSnippet;

interface TopicResearchSignal {
  keyword: string;
  source: "autocomplete" | "related" | "template" | "trend" | "input";
  score: number;
}

interface TopicResearchResult {
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

interface TopicCampaignPayload {
  id: string;
  rootTopic: string;
  type: TopicType;
  intent: string | null;
  audience: string | null;
  style: string | null;
  sourceUrls: string[];
  status: TopicCampaignStatus;
  createdAt: string;
}

interface TopicCampaignSummary {
  id: string;
  rootTopic: string;
  type: TopicType;
  status: TopicCampaignStatus;
  createdAt: string;
  draftCount: number;
}

interface TopicCampaignListResponse {
  campaigns: TopicCampaignSummary[];
}

interface TopicDraftPayload {
  id: string;
  campaignId: string;
  subTopic: string;
  reason: string | null;
  priority: number;
  titleCandidates: string[];
  contentJson: string | null;
  status: TopicDraftStatus;
  citations: string | null;
  thumbnailImageJson: string | null;
  sourceImagesJson: string | null;
  topicSeedJson: string | null;
  scheduledAt: string | null;
  postId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface TopicCampaignLoadResponse {
  campaign: TopicCampaignPayload;
  drafts: TopicDraftPayload[];
  research?: TopicResearchResult;
}

interface TopicQueueCreated {
  draftId: string;
  postId: string;
  scheduledAt: string;
}

interface TopicQueueRunResult {
  draftId: string;
  postId: string;
  success: boolean;
}

function formatDateFromIsoOrYmd(raw: string | null): string {
  if (!raw) return "-";
  const plainDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (plainDate) return plainDate[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().slice(0, 10);
}

interface TopicQueueRunStarted {
  campaignId: string;
  requestedCount: number;
  queuedCount: number;
  started: boolean;
  deferredCount: number;
  dueCount: number;
  nextRunAt: string | null;
}

interface TopicActionResponse {
  action: TopicApiAction;
  campaignId?: string;
  campaign?: TopicCampaignPayload;
  research?: TopicResearchResult;
  drafts?: TopicDraftPayload[];
  failedDraftIds?: string[];
  approvedCount?: number;
  requestedAt?: string;
  effectiveAt?: string;
  adjustedFromPast?: boolean;
  created?: TopicQueueCreated[];
  results?: TopicQueueRunResult[];
  runQueue?: TopicQueueRunStarted;
  combinedKeywords?: string[];
  snippets?: TopicSourceSummary[];
  keywords?: string[];
  keywordsSuggestions?: string[];
}

interface TopicApiResponse<T = unknown> {
  success?: boolean;
  error?: string;
  stderr?: string;
  data?: T;
}

interface TopicDraftContent {
  title: string;
  sections: string[];
  hashtags: string[];
}

type DraftSectionLike = {
  heading?: unknown;
  sectionTitle?: unknown;
  body?: unknown;
  content?: unknown;
};

function uniqueText(values: string[]): string[] {
  const seen = new Set<string>();
  return values.reduce<string[]>((acc, value) => {
    const v = value.trim();
    if (!v) return acc;
    const key = v.toLowerCase();
    if (seen.has(key)) return acc;
    seen.add(key);
    acc.push(v);
    return acc;
  }, []);
}

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

function parseTopicSourceUrls(listText: string): string[] {
  return uniqueText(
    listText
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter((item) => /^https?:\/\/\S+/i.test(item)),
  );
}

function getTomorrowDateInput(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatDateInputLocal(tomorrow);
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
  const [bulkSeasonalRunning, setBulkSeasonalRunning] = useState(false);
  const [bulkScheduleRunning, setBulkScheduleRunning] = useState(false);

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

  // V5: 주제 모드
  const [topicType, setTopicType] = useState<TopicType>("knowledge");
  const [topicTitle, setTopicTitle] = useState("");
  const [topicKeywords, setTopicKeywords] = useState("");
  const [topicStyle, setTopicStyle] = useState("개인적인 경험공유형");
  const [topicCategory, setTopicCategory] = useState("");
  const [topicBoard, setTopicBoard] = useState("");
  const [topicCreateUrl, setTopicCreateUrl] = useState("");
  const [topicSourceUrlsText, setTopicSourceUrlsText] = useState("");
  const [topicResearch, setTopicResearch] = useState<TopicResearchResult | null>(null);
  const [topicCampaigns, setTopicCampaigns] = useState<TopicCampaignSummary[]>([]);
  const [topicCampaignLoading, setTopicCampaignLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [topicCampaignDetails, setTopicCampaignDetails] = useState<TopicCampaignLoadResponse | null>(null);
  const [topicDrafts, setTopicDrafts] = useState<TopicDraftPayload[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [topicQueueDate, setTopicQueueDate] = useState(() => getTomorrowDateInput());
  const [topicQueueIntervalDays, setTopicQueueIntervalDays] = useState(1);
  const [topicActionLoading, setTopicActionLoading] =
    useState<TopicActionLoading>(null);

  const queuedDraftIds = topicDrafts
    .filter((draft) => draft.status === "QUEUED")
    .map((draft) => draft.id);

  useEffect(() => {
    setSelectedCampaignId(null);
    setTopicCampaignDetails(null);
    setTopicDrafts([]);
    setSelectedDraftIds([]);
    setTopicResearch(null);
    setTopicActionLoading(null);
  }, [
    topicTitle,
    topicKeywords,
    topicStyle,
    topicCategory,
    topicBoard,
    topicCreateUrl,
    topicSourceUrlsText,
    topicType,
  ]);

  const [dashboardNotice, setDashboardNotice] = useState<{
    tone: "info" | "success" | "error";
    text: string;
  } | null>(null);

  const getBusyMessage = useCallback((): string | null => {
    if (publishingId) return "현재 발행 작업이 진행 중입니다. 완료 후 다시 시도하세요.";
    if (bulkSeasonalRunning) return "시즌 추천 등록 작업이 이미 실행 중입니다.";
    if (bulkScheduleRunning) return "예약발행 일괄 실행 작업이 이미 실행 중입니다.";
    return null;
  }, [publishingId, bulkSeasonalRunning, bulkScheduleRunning]);

  const parseTopicDraftContent = useCallback((raw: string | null): TopicDraftContent => {
    if (!raw) {
      return { title: "", sections: [], hashtags: [] };
    }

    try {
      const parsed = JSON.parse(raw) as {
        title?: unknown;
        sections?: unknown;
        hashtags?: unknown;
        content?: unknown;
      };
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return { title: "", sections: [], hashtags: [] };
      }

      const rawSections = parsed.sections ?? parsed.content;

      return {
        title: typeof parsed.title === "string" ? parsed.title : "",
        sections: Array.isArray(rawSections)
          ? rawSections
              .map((section): string => {
                if (typeof section === "string") {
                  return section.trim();
                }
                if (!section || typeof section !== "object") {
                  return "";
                }
                const draftSection = section as DraftSectionLike;
                const heading = typeof draftSection.heading === "string"
                  ? draftSection.heading.trim()
                  : typeof draftSection.sectionTitle === "string"
                    ? draftSection.sectionTitle.trim()
                    : "";
                const body = typeof draftSection.body === "string"
                  ? draftSection.body.trim()
                  : typeof draftSection.content === "string"
                    ? draftSection.content.trim()
                    : "";
                return heading && body
                  ? `${heading}\n\n${body}`
                  : heading || body;
              })
              .filter((section) => section.length > 0)
          : typeof rawSections === "string"
            ? rawSections
                .split(/\n{2,}/)
                .map((section) => section.trim())
                .filter((section) => section.length > 0)
            : [],
        hashtags: Array.isArray(parsed.hashtags)
          ? parsed.hashtags
              .filter((value): value is string => typeof value === "string")
              .map((hashtag) => hashtag.trim())
              .filter(Boolean)
          : [],
      };
    } catch {
      return { title: "", sections: [], hashtags: [] };
    }
  }, []);

  const getDraftStatusLabel = useCallback((status: TopicDraftStatus): string => {
    switch (status) {
      case "SUBTOPIC_READY":
        return "소주제 확정";
      case "DRAFTING":
        return "초안 생성중";
      case "DRAFT_READY":
        return "초안 완료";
      case "REVIEW":
        return "검수 대기";
      case "APPROVED":
        return "승인됨";
      case "QUEUED":
        return "예약 큐 대기";
      case "PUBLISHED":
        return "발행 완료";
      case "FAILED":
        return "실패";
      default:
        return "미정";
    }
  }, []);

  const getDraftStatusClass = (status: TopicDraftStatus): string => {
    switch (status) {
      case "SUBTOPIC_READY":
        return "bg-blue-100 text-blue-700";
      case "DRAFTING":
        return "bg-purple-100 text-purple-700";
      case "DRAFT_READY":
        return "bg-emerald-100 text-emerald-700";
      case "REVIEW":
        return "bg-amber-100 text-amber-700";
      case "APPROVED":
        return "bg-cyan-100 text-cyan-700";
      case "QUEUED":
        return "bg-indigo-100 text-indigo-700";
      case "PUBLISHED":
        return "bg-green-100 text-green-700";
      case "FAILED":
        return "bg-red-100 text-red-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  const getCampaignStatusLabel = useCallback((status: TopicCampaignStatus): string => {
    switch (status) {
      case "RESEARCHING":
        return "연구중";
      case "RESEARCH_DONE":
        return "연구완료";
      case "SUBTOPIC_READY":
        return "소주제 준비";
      case "DRAFT_READY":
        return "초안 준비";
      case "REVIEW":
        return "검수";
      case "QUEUED":
        return "예약 큐 등록";
      case "FAILED":
        return "실패";
      default:
        return status;
    }
  }, []);

  const normalizeTopicDrafts = useCallback((drafts: TopicDraftPayload[]) => {
    return drafts
      .slice()
      .sort((a, b) => (a.priority - b.priority) || (a.createdAt < b.createdAt ? -1 : 1))
      .map((draft) => draft);
  }, []);

  const buildTopicApiUrl = useCallback((query?: string) => {
    if (typeof window === "undefined") {
      return `/api/topic${query ?? ""}`;
    }
    const base = "/api/topic";
    if (!query) return base;
    if (query.startsWith("?") || query.startsWith("/")) return `${base}${query}`;
    return `${base}/${query}`;
  }, []);

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

  const syncTopicCampaigns = useCallback(async () => {
    try {
      setTopicCampaignLoading(true);
      const res = await fetch(buildTopicApiUrl(), { cache: "no-store" });
      const response = (await res.json()) as TopicApiResponse<TopicCampaignListResponse>;

      if (response.success) {
        setTopicCampaigns((response.data as TopicCampaignListResponse)?.campaigns ?? []);
      } else {
        setTopicCampaigns([]);
        setDashboardNotice({
          tone: "error",
          text: `주제 캠페인 목록 조회 실패 (${res.status}): ${response.error || "알 수 없습니다."}`,
        });
      }
      if (!res.ok) {
        return;
      }
    } catch (error) {
      console.error("주제 캠페인 목록 조회 실패:", error);
      setTopicCampaigns([]);
      setDashboardNotice({
        tone: "error",
        text: "주제 캠페인 목록을 불러오지 못했습니다.",
      });
    } finally {
      setTopicCampaignLoading(false);
    }
  }, [buildTopicApiUrl]);

  const loadTopicCampaign = useCallback(
    async (campaignId: string) => {
      if (!campaignId) return;
      try {
        setTopicCampaignLoading(true);
        const res = await fetch(buildTopicApiUrl(`?campaignId=${encodeURIComponent(campaignId)}`), {
          cache: "no-store",
        });
        const response = (await res.json()) as TopicApiResponse<TopicCampaignLoadResponse>;

        if (!response.success || !response.data) {
          throw new Error(response.error || "주제 캠페인을 불러올 수 없습니다.");
        }

        const details = response.data;
        setTopicCampaignDetails(details);
        setSelectedCampaignId(details.campaign.id);
        setTopicDrafts(normalizeTopicDrafts(details.drafts));
        setTopicResearch(details.research ?? null);
      } catch (error) {
        console.error("주제 캠페인 상세 조회 실패:", error);
        setDashboardNotice({
          tone: "error",
          text: error instanceof Error ? error.message : "주제 캠페인 상세 조회 실패",
        });
      } finally {
        setTopicCampaignLoading(false);
      }
    },
    [buildTopicApiUrl, normalizeTopicDrafts],
  );

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    if (contentMode === "topic") {
      void syncTopicCampaigns();
    }
  }, [contentMode, syncTopicCampaigns]);

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

  const handleBulkSeasonalRegister = async () => {
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
        text: "시즌 추천 10개 등록 요청을 시작했습니다...",
      });

      const res = await fetch("/api/brandlinks/bulk-seasonal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: 10,
          intervalDays: 1,
        }),
      });
      const data = (await res.json()) as BulkActionResponse;

      if (!res.ok || !data.success) {
        setDashboardNotice({
          tone: "error",
          text: `시즌성 자동등록 시작 실패: ${data.error || "알 수 없는 오류"}`,
        });
        return;
      }

      setDashboardNotice({
        tone: "success",
        text: `시즌성 자동등록 시작: ${data.data?.startDate ?? "-"} ~ ${data.data?.endDate ?? "-"}${
          data.data?.logFile ? ` / 로그: ${data.data.logFile}` : ""
        }`,
      });
      setTimeout(() => {
        void fetchLinks();
      }, 1500);
    } catch (error) {
      console.error("시즌성 자동등록 시작 실패:", error);
      setDashboardNotice({
        tone: "error",
        text: "시즌성 자동등록 시작 중 오류가 발생했습니다.",
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
      (link) => link.status === "READY" && formatDateDisplay(link.scheduledPublishAt) !== "-"
    ).length;

    if (readyScheduledCount === 0) {
      setDashboardNotice({
        tone: "info",
        text: "예약발행일이 지정된 대기 링크(READY)가 없습니다.",
      });
      return;
    }

    const limit = Math.min(10, readyScheduledCount);

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

  // 통계 계산
  const stats = {
    total: links.length,
    ready: links.filter((l) => l.status === "READY").length,
    scheduled: links.filter((l) => l.status === "SCHEDULED").length,
    published: links.filter((l) => l.status === "PUBLISHED").length,
    failed: links.filter((l) => l.status === "FAILED").length,
  };

  // 상태 배지 색상
  const getStatusColor = (status: string) => {
    switch (status) {
      case "READY": return "bg-blue-100 text-blue-800";
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
      case "PUBLISHING": return "발행중";
      case "SCHEDULED": return "예약완료";
      case "PUBLISHED": return "발행완료";
      case "FAILED": return "실패";
      default: return status;
    }
  };

  const readyScheduledCount = links.filter(
    (link) => link.status === "READY" && formatDateDisplay(link.scheduledPublishAt) !== "-"
  ).length;
  const busyMessageForUi = getBusyMessage();

  const topicSelectedCampaign = selectedCampaignId
    ? topicCampaigns.find((campaign) => campaign.id === selectedCampaignId)
    : null;
  const topicCurrentCampaign = topicCampaignDetails?.campaign ?? (topicSelectedCampaign ?? null);
  const topicCurrentCampaignSourceCount =
    topicCampaignDetails?.campaign.sourceUrls.length ?? 0;

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

  const getSourceUrlInput = (): string[] =>
    parseTopicSourceUrls([topicCreateUrl, topicSourceUrlsText].join("\\n"));

  const handleSelectTopicCampaign = async (campaignId: string) => {
    await loadTopicCampaign(campaignId);
  };

  const handleTopicDraftToggle = (draftId: string, checked: boolean) => {
    setSelectedDraftIds((prev) =>
      checked ? [...prev, draftId] : prev.filter((item) => item !== draftId),
    );
  };

  const setAllTopicDraftSelection = (checked: boolean) => {
    setSelectedDraftIds(checked ? topicDrafts.map((draft) => draft.id) : []);
  };

  const handleTopicAction = async (
    action: TopicApiAction,
    targetDraftIds?: string[],
  ) => {
    const draftedIds = targetDraftIds ?? selectedDraftIds;
    const timeoutReason = "topic-action-timeout";

    if (action === "research") {
      if (!topicTitle.trim()) {
        setDashboardNotice({
          tone: "error",
          text: "주제는 필수 입력 항목입니다.",
        });
        return;
      }
    } else if (!selectedCampaignId) {
      setDashboardNotice({
        tone: "error",
        text: "먼저 캠페인을 생성/선택해야 합니다.",
      });
      return;
    }

    if (topicActionLoading) {
      setDashboardNotice({
        tone: "info",
        text: "현재 주제 작업이 진행 중입니다. 완료 후 다시 시도하세요.",
      });
      return;
    }

    const validQueueDate = topicQueueDate.trim();
    if (action === "queue" && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(validQueueDate)) {
      setDashboardNotice({
        tone: "error",
        text: "예약 시작일 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력하세요.",
      });
      return;
    }

    setTopicActionLoading(action);
    setDashboardNotice({ tone: "info", text: `${action} 처리 중입니다...` });

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(timeoutReason);
    }, TOPIC_ACTION_TIMEOUT_MS[action]);

    try {
      const payload: Record<string, unknown> = {
        action,
        type: topicType,
      };

      if (action === "research") {
        payload.topic = topicTitle.trim();
        payload.keywords = topicKeywords.trim();
        payload.style = topicStyle.trim() || undefined;
        payload.category = topicCategory.trim() || undefined;
        payload.board = topicBoard.trim() || undefined;
        payload.sourceUrls = getSourceUrlInput();
      } else if (selectedCampaignId) {
        payload.campaignId = selectedCampaignId;
        payload.keywords = topicKeywords.trim();
        if (action === "subtopics") {
          payload.count = 5;
        } else if (action === "draft") {
          if (draftedIds.length > 0) {
            payload.draftIds = draftedIds;
          }
        } else if (action === "approve") {
          if (draftedIds.length === 0) {
            setDashboardNotice({
              tone: "error",
              text: "승인할 초안을 1개 이상 선택하세요.",
            });
            return;
          }
          if (draftedIds.length > 0) {
            payload.draftIds = draftedIds;
          }
        } else if (action === "queue") {
          if (draftedIds.length === 0) {
            setDashboardNotice({
              tone: "error",
              text: "큐에 등록할 초안을 1개 이상 선택하세요.",
            });
            return;
          }
          if (draftedIds.length > 0) {
            payload.draftIds = draftedIds;
          }
          payload.scheduleDate = validQueueDate;
          payload.intervalDaysPerDraft = topicQueueIntervalDays;
        } else if (action === "run-queue") {
          const activeQueuedIds = queuedDraftIds;
          const queuedSet = new Set(activeQueuedIds);

          if (draftedIds.length === 0) {
            if (activeQueuedIds.length === 0) {
              setDashboardNotice({
                tone: "error",
                text: "실행할 큐 항목이 없습니다. 먼저 초안을 큐에 등록하세요.",
              });
              return;
            }
            payload.draftIds = activeQueuedIds;
          } else {
            const selectedQueuedIds = draftedIds.filter((id) => queuedSet.has(id));
            if (selectedQueuedIds.length === 0) {
              setDashboardNotice({
                tone: "error",
                text: "선택한 초안은 큐 대기 상태가 아닙니다. 먼저 큐 등록 후 실행하세요.",
              });
              return;
            }
            payload.draftIds = selectedQueuedIds;
          }
        } else if (action === "publish-now" || action === "schedule") {
          payload.style = topicStyle.trim() || undefined;
          if (action === "schedule") {
            payload.scheduledAt = validQueueDate;
          }
        }
      }

      const response = await fetch(buildTopicApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as TopicApiResponse<TopicActionResponse>;

      if (!response.ok || !data.success) {
        setDashboardNotice({
          tone: "error",
          text: `주제 ${action} 실패: ${data.error || "알 수 없는 오류"}`,
        });
        if (data.stderr) {
          console.error("주제 액션 stderr:", data.stderr);
        }
        return;
      }

      const result = data.data as TopicActionResponse | null;
      if (!result) {
        setDashboardNotice({
          tone: "info",
          text: "작업이 완료되었지만 응답 데이터가 비어있습니다.",
        });
        return;
      }

      if (result.action === "research") {
        if (result.campaign) {
          setSelectedCampaignId(result.campaign.id);
          await loadTopicCampaign(result.campaign.id);
        }
        setTopicResearch(
          result.research ?? {
            topic: topicTitle.trim(),
            type: topicType,
            generatedAt: new Date().toISOString(),
            trendSignals: (result.combinedKeywords ?? []).map((keyword) => ({
              keyword,
              source: "input",
              score: 70,
            })),
            sourceUrls: getSourceUrlInput(),
            sourceSummaries: [],
          },
        );
        setDashboardNotice({
          tone: "success",
          text: `연구 완료: 키워드 ${result.combinedKeywords?.length || 0}개, 소스 ${result.snippets?.length || 0}개`,
        });
        return;
      }

      await syncTopicCampaigns();
      const campaignToLoad = result.campaignId || selectedCampaignId;
      if (campaignToLoad) {
        await loadTopicCampaign(campaignToLoad);
      }

      if (result.action === "subtopics") {
        setDashboardNotice({
          tone: "success",
          text: `소주제 생성 완료: ${result.drafts?.length || 0}건`,
        });
        if (result.drafts && result.drafts.length > 0) {
          setSelectedDraftIds(result.drafts.map((draft) => draft.id));
        }
        return;
      }

      if (result.action === "draft") {
        const draftRows = result.drafts ?? [];
        const failedCount = result.failedDraftIds?.length ?? 0;
        const successCount = draftRows.length - failedCount;

        if (draftRows.length > 0) {
          setTopicDrafts((prevDrafts) => {
            const nextById = new Map(prevDrafts.map((draft) => [draft.id, draft]));
            for (const draft of draftRows) {
              nextById.set(draft.id, draft);
            }
            return normalizeTopicDrafts(Array.from(nextById.values()));
          });
        }

        setDashboardNotice({
          tone: failedCount > 0 ? "error" : "success",
          text: `초안 생성 완료: 성공 ${Math.max(0, successCount)}건 / 실패 ${failedCount}건`,
        });
        setSelectedDraftIds([]);
        return;
      }

      if (result.action === "approve") {
        setDashboardNotice({
          tone: "success",
          text: `검수 승인 등록 완료 (${result.approvedCount || 0}건)`,
        });
        setSelectedDraftIds([]);
        return;
      }

      if (result.action === "queue") {
        const count = result.created?.length || 0;
        setDashboardNotice({
          tone: "success",
          text: `발행 큐 등록 완료: ${count}건`,
        });
        setSelectedDraftIds([]);
        return;
      }

      if (result.action === "run-queue") {
        let queuedNotice = "";

        if (result.runQueue) {
          const requestedCount = result.runQueue.requestedCount || 0;
          const queuedCount = result.runQueue.queuedCount || 0;
          const dueCount = result.runQueue.dueCount || 0;
          const deferredCount =
            result.runQueue.deferredCount ?? Math.max(0, requestedCount - dueCount);
          const nextRunAt = formatDateFromIsoOrYmd(result.runQueue.nextRunAt);
          const hasQueued = queuedCount > 0;
          const hasDeferred = deferredCount > 0;
          const waitingCount = hasDeferred ? deferredCount : 0;

          let noticeText = `발행 큐 실행 요청 완료: `;
          if (requestedCount === 0) {
            noticeText += "실행할 큐 항목이 없습니다.";
          } else if (hasQueued) {
            noticeText += `요청 ${requestedCount}건 중 ${queuedCount}건 순차 실행 시작`;
            if (hasDeferred) {
              const nextRunLabel =
                nextRunAt === "-" ? "즉시" : `${nextRunAt}에`;
              noticeText += `. 예약일이 설정된 ${waitingCount}건도 즉시 예약등록 처리되며, ${nextRunLabel} 상태 반영됩니다.`;
            }
            queuedNotice = "선택 항목은 순차적으로 처리됩니다.";
          } else if (hasDeferred) {
            const nextRunLabel = nextRunAt === "-" ? "즉시" : nextRunAt;
            noticeText += `선택 항목 ${requestedCount}건이 예약 등록 대상입니다. 현재 대기열에 반영 중입니다 (${nextRunLabel}까지).`;
          } else {
            noticeText += "큐 실행 조건에 맞는 항목이 없어 대기 상태로 유지됩니다.";
          }

          setDashboardNotice({
            tone: hasQueued ? "success" : "info",
            text: queuedNotice ? `${noticeText} ${queuedNotice}` : noticeText,
          });
        } else {
          const results = result.results || [];
          const succeed = results.filter((entry) => entry.success).length;
          const failed = results.length - succeed;
          setDashboardNotice({
            tone: succeed === results.length ? "success" : "error",
            text: `발행 큐 실행: 성공 ${succeed}건 / 실패 ${failed}건`,
          });
        }

        setSelectedDraftIds([]);
        return;
      }
    } catch (error) {
      const isAbortError = error instanceof DOMException && error.name === "AbortError";
      if (isAbortError) {
        const reason = (error as DOMException & { reason?: string }).reason;
        setDashboardNotice({
          tone: "error",
          text:
            reason === timeoutReason
              ? "요청이 타임아웃되어 중단되었습니다. 초안 생성은 15분 이상 걸릴 수 있으니 다시 시도하거나 단계별로 진행해 주세요."
              : "요청이 사용자 또는 브라우저에서 취소되었습니다.",
        });
      } else {
        console.error("주제 처리 실패:", error);
        setDashboardNotice({
          tone: "error",
          text: "주제 처리 중 오류가 발생했습니다.",
        });
      }
      return;
    } finally {
      clearTimeout(timeout);
      setTopicActionLoading(null);
    }
  };

  const handleTopicResearch = () => handleTopicAction("research");
  const handleTopicSubtopics = () => handleTopicAction("subtopics");
  const handleTopicDraft = () => handleTopicAction("draft");
  const handleTopicApprove = () => handleTopicAction("approve");
  const handleTopicQueue = () => handleTopicAction("queue");
  const handleTopicRunQueue = () => handleTopicAction("run-queue");

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

          {/* 주제 모드 폼 */}
          {contentMode === "topic" && (
            <div className="space-y-4 border-t pt-4">
              <div className="rounded-lg border border-violet-100 bg-violet-50 p-4">
                <p className="font-semibold text-violet-900 mb-2">주제콘텐츠 파이프라인</p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 text-sm rounded-full bg-violet-200 text-violet-900">1. 연구</span>
                  <span className="px-2 py-1 text-sm rounded-full bg-violet-200 text-violet-900">2. 소주제 생성</span>
                  <span className="px-2 py-1 text-sm rounded-full bg-violet-200 text-violet-900">3. 초안 생성</span>
                  <span className="px-2 py-1 text-sm rounded-full bg-violet-200 text-violet-900">4. 검수 승인</span>
                  <span className="px-2 py-1 text-sm rounded-full bg-violet-200 text-violet-900">5. 큐 등록/실행</span>
                </div>
                <p className="text-xs text-violet-700 mt-2">
                  기본 말투는 4번(직접입력 샘플, 경험공유형)으로 고정합니다.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">주제 타입</label>
                <div className="flex gap-2">
                  {[
                    { value: "knowledge", label: "🧠 지식/일반" },
                    { value: "travel", label: "✈️ 여행" },
                    { value: "golf", label: "⛳ 골프" },
                  ].map((item) => (
                    <button
                      key={item.value}
                      onClick={() => setTopicType(item.value as TopicType)}
                      className={`px-3 py-1 rounded-lg text-sm ${
                        topicType === item.value
                          ? "bg-purple-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <div className="space-y-4 border border-slate-200 rounded-lg p-4">
                  <h3 className="font-medium text-slate-900">1~3단계 입력</h3>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">주제 *</label>
                    <input
                      type="text"
                      value={topicTitle}
                      onChange={(e) => setTopicTitle(e.target.value)}
                      placeholder="예: 2026년 여름에 가기 좋은 제주도 숙소 추천"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">기본 키워드 (쉼표 구분)</label>
                    <input
                      type="text"
                      value={topicKeywords}
                      onChange={(e) => setTopicKeywords(e.target.value)}
                      placeholder="키워드1, 키워드2, ..."
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">말투(고정: 4번 샘플)</label>
                    <input
                      type="text"
                      value={topicStyle}
                      onChange={(e) => setTopicStyle(e.target.value)}
                      placeholder="개인적인 경험공유형"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">카테고리</label>
                    <input
                      type="text"
                      value={topicCategory}
                      onChange={(e) => setTopicCategory(e.target.value)}
                      placeholder="예: 숙소 리뷰"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">게시판</label>
                    {categoryOptions.length > 0 || categoryLoading ? (
                      <select
                        value={topicBoard}
                        onChange={(e) => setTopicBoard(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        disabled={categoryLoading}
                      >
                        <option value="">기본 게시판</option>
                        {categoryOptions.map((category) => (
                          <option key={category.categoryNo} value={category.categoryNo}>
                            {category.displayName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={topicBoard}
                        onChange={(e) => setTopicBoard(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="게시판 번호 직접 입력"
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">생성 링크(선택 URL)</label>
                    <input
                      type="url"
                      value={topicCreateUrl}
                      onChange={(e) => setTopicCreateUrl(e.target.value)}
                      placeholder="https://example.com/reference"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">소스 URL 리스트 입력</label>
                    <textarea
                      value={topicSourceUrlsText}
                      onChange={(e) => setTopicSourceUrlsText(e.target.value)}
                      rows={4}
                      placeholder="https://example.com/article1\nhttps://example.com/article2"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={handleTopicResearch}
                      disabled={topicActionLoading === "research"}
                      className="px-4 py-2 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 disabled:opacity-50"
                    >
                      {topicActionLoading === "research" ? "연구 중..." : "🔎 주제 연구"}
                    </button>
                    <button
                      onClick={handleTopicSubtopics}
                      disabled={!selectedCampaignId || topicActionLoading === "subtopics"}
                      className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50"
                    >
                      {topicActionLoading === "subtopics" ? "생성 중..." : "🧭 소주제 생성"}
                    </button>
                    <button
                      onClick={handleTopicDraft}
                      disabled={!selectedCampaignId || topicActionLoading === "draft"}
                      className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 disabled:opacity-50"
                    >
                      {topicActionLoading === "draft" ? "작성 중..." : "📝 초안 생성"}
                    </button>
                  </div>
                </div>

                <div className="space-y-4 border border-slate-200 rounded-lg p-4">
                  <h3 className="font-medium text-slate-900">캠페인/연구 조회</h3>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">캠페인 선택</label>
                    {topicCampaignLoading ? (
                      <div className="text-sm text-slate-500">조회 중...</div>
                    ) : (
                      <select
                        value={selectedCampaignId ?? ""}
                        onChange={(e) => void handleSelectTopicCampaign(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="">선택하지 않음</option>
                        {topicCampaigns.map((campaign) => (
                          <option key={campaign.id} value={campaign.id}>
                            [{getCampaignStatusLabel(campaign.status)}] {campaign.rootTopic}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {selectedCampaignId && topicCurrentCampaign && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
                      <p className="font-semibold text-slate-800">
                        캠페인 상태: {getCampaignStatusLabel(topicCurrentCampaign.status)}
                      </p>
                      <p className="text-slate-600">주제: {topicCurrentCampaign.rootTopic}</p>
                      <p className="text-slate-600">
                        소스 URL: {topicCurrentCampaignSourceCount}건
                      </p>
                    </div>
                  )}
                  {topicResearch && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-slate-700">연구 결과 미리보기</h4>
                          <p className="text-sm text-slate-700">트렌드 신호: {topicResearch.trendSignals.length}건</p>
                          {(topicResearch.trendSignals || []).length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {topicResearch.trendSignals.reduce((acc, item) => {
                                const trimmed = item.keyword.trim();
                                if (!trimmed) {
                                  return acc;
                                }
                                const key = trimmed.toLowerCase();
                                if (acc.seen.has(key)) {
                                  return acc;
                                }
                                acc.seen.add(key);
                                acc.items.push({
                                  key: `${trimmed}-${acc.items.length}`,
                                  label: trimmed,
                                });
                                return acc;
                              }, { seen: new Set<string>(), items: [] as { key: string; label: string }[] }).items.map((entry) => (
                                <span
                                  key={`topic-trend-${entry.key}`}
                                  className="px-2 py-1 text-xs rounded-full bg-slate-100 text-slate-700"
                                >
                                  {entry.label}
                                </span>
                              ))}
                            </div>
                          )}
                      {(topicResearch.sourceSummaries || []).length > 0 && (
                        <div className="space-y-2 max-h-56 overflow-y-auto">
                          {(topicResearch.sourceSummaries || []).map((snippet, index) => (
                            <div
                              key={`${snippet.url}-${index}`}
                              className="p-2 border border-slate-200 rounded-lg"
                            >
                              <a
                                href={snippet.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline break-all text-xs"
                              >
                                {snippet.title || snippet.url}
                              </a>
                              <p className="text-xs text-slate-600 mt-1">
                                {snippet.summary || snippet.snippet || "-"}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4 border border-slate-200 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-medium text-slate-900">검수 큐 & 발행 큐</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleTopicApprove}
                      disabled={!selectedCampaignId || selectedDraftIds.length === 0 || topicActionLoading === "approve"}
                      className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50"
                    >
                      {topicActionLoading === "approve" ? "승인 처리 중..." : "✅ 선택 초안 승인"}
                    </button>
                    <button
                      onClick={handleTopicQueue}
                      disabled={!selectedCampaignId || selectedDraftIds.length === 0 || topicActionLoading === "queue"}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {topicActionLoading === "queue" ? "큐 등록 중..." : "🗓️ 선택 초안 큐 등록"}
                    </button>
                    <button
                      onClick={handleTopicRunQueue}
                      disabled={
                        !selectedCampaignId ||
                        (selectedDraftIds.length === 0 && queuedDraftIds.length === 0) ||
                        topicActionLoading === "run-queue"
                      }
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      {topicActionLoading === "run-queue" ? "발행 중..." : "🚀 큐 실행"}
                    </button>
                    <button
                      onClick={() => setAllTopicDraftSelection(true)}
                      className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                    >
                      전체선택
                    </button>
                    <button
                      onClick={() => setAllTopicDraftSelection(false)}
                      className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                    >
                      전체해제
                    </button>
                  </div>
                </div>

                <div className="grid md:grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      큐 시작일 (YYYY-MM-DD)
                    </label>
                    <input
                      type="date"
                      value={topicQueueDate}
                      min={getTomorrowDateInput()}
                      onChange={(e) => setTopicQueueDate(e.target.value)}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="text-xs text-slate-500 mt-1">과거/당일은 자동 다음날로 조정됩니다.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">간격(일)</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={topicQueueIntervalDays}
                      onChange={(e) =>
                        setTopicQueueIntervalDays(
                          Math.max(1, Math.min(30, Number.parseInt(e.target.value || "1", 10))),
                        )
                      }
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border border-slate-200 rounded-lg">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-3 py-2 text-left text-sm text-slate-700">선택</th>
                        <th className="px-3 py-2 text-left text-sm text-slate-700">소주제</th>
                        <th className="px-3 py-2 text-left text-sm text-slate-700">상태</th>
                        <th className="px-3 py-2 text-left text-sm text-slate-700">우선순위</th>
                        <th className="px-3 py-2 text-left text-sm text-slate-700">제목 후보</th>
                        <th className="px-3 py-2 text-left text-sm text-slate-700">예약발행일</th>
                        <th className="px-3 py-2 text-left text-sm text-slate-700">작업</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {topicDrafts.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                            초안/큐 항목이 없습니다. 연구 후 소주제 생성/초안 생성 단계를 진행하세요.
                          </td>
                        </tr>
                      ) : (
                        topicDrafts.map((draft) => {
                          const content = parseTopicDraftContent(draft.contentJson);
                          const statusClass = getDraftStatusClass(draft.status);
                          return (
                            <tr key={draft.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedDraftIds.includes(draft.id)}
                                  onChange={(e) => handleTopicDraftToggle(draft.id, e.target.checked)}
                                />
                              </td>
                              <td className="px-3 py-2 text-sm text-slate-700">
                                <p className="font-medium">{draft.subTopic}</p>
                                <p className="text-xs text-slate-500">{formatDateDisplay(draft.createdAt)}</p>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`px-2 py-1 rounded-full text-xs ${statusClass}`}>
                                  {getDraftStatusLabel(draft.status)}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-sm text-slate-700">{draft.priority}</td>
                              <td className="px-3 py-2 text-sm text-slate-700">
                                <p className="font-medium">
                                  {content.title || draft.titleCandidates[0] || draft.subTopic}
                                </p>
                                {content.sections[0] ? (
                                  <p className="text-xs text-slate-500 truncate max-w-[260px]">
                                    {content.sections[0]}
                                  </p>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-sm text-slate-700">{formatDateDisplay(draft.scheduledAt)}</td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => handleTopicAction("draft", [draft.id])}
                                  disabled={topicActionLoading === "draft"}
                                  className="px-2 py-1 text-xs rounded bg-violet-100 text-violet-700 hover:bg-violet-200"
                                >
                                  재생성
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
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
              <h2 className="font-semibold text-slate-800 mb-3">⚙️ 일괄 작업</h2>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleBulkSeasonalRegister}
                  disabled={bulkSeasonalRunning || bulkScheduleRunning || Boolean(publishingId)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {bulkSeasonalRunning
                    ? "시즌 상품 등록 시작 중..."
                    : "시즌 추천 10개 등록"}
                </button>
                <button
                  onClick={handleBulkSchedulePublish}
                  disabled={
                    bulkSeasonalRunning ||
                    bulkScheduleRunning ||
                    Boolean(publishingId) ||
                    readyScheduledCount === 0
                  }
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {bulkScheduleRunning
                    ? "예약발행 일괄 실행 중..."
                    : `예약발행 일괄 실행 (${Math.min(10, readyScheduledCount)}건)`}
                </button>
                <p className="text-xs text-slate-500">
                  시즌 등록은 마지막 예약발행일 다음날부터 10일치로 자동 배치됩니다.
                </p>
              </div>
              {busyMessageForUi && (
                <p className="mt-2 text-xs text-amber-700">
                  ⏳ {busyMessageForUi}
                </p>
              )}
            </div>

            {/* 링크 테이블 */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
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
                  ) : links.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        등록된 링크가 없습니다. 위에서 브랜드커넥트 링크를 추가하세요.
                      </td>
                    </tr>
                  ) : (
                    links.map((link) => {
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
                              {/* 발행하기 버튼 */}
                              {link.status === "READY" && (
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
                              {link.status === "FAILED" && (
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
            <li>⚙️ 시즌 추천 10개 등록 버튼으로 마지막 예약발행일 다음날부터 10일치 자동 등록</li>
            <li>⚙️ 예약발행 일괄 실행 버튼으로 예약발행일이 있는 READY 글을 순차 예약발행</li>
            <li>🚀 즉시 버튼은 바로 발행, 📅 예약 버튼은 예약 발행</li>
            <li>예약발행일이 과거 또는 당일이면 자동으로 다음날로 조정됩니다.</li>
          </ol>
        </div>
      </main>

      {/* 푸터 */}
      <footer className="border-t border-slate-200 bg-white mt-8">
        <div className="max-w-6xl mx-auto px-4 py-4 text-center text-sm text-slate-500">
          네이버 블로그 자동화 시스템 • 브랜드커넥트
        </div>
      </footer>
    </div>
  );
}
