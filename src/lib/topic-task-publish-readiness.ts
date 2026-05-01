import { parsePreparedTopicContent } from "@/lib/topic-task-contract";

const GENERIC_IMAGE_PROVIDERS = new Set(["loremflickr", "picsum", "dummyimage", "stock-generic"]);

export interface TopicTaskPreparedImageLike {
  localPath: string | null;
  provider: string | null;
  role: string | null;
}

export interface TopicTaskPublishReadinessInput {
  status?: string | null;
  selectedDraftId: string | null;
  preparedContentJson: string | null;
  preparedImages?: TopicTaskPreparedImageLike[] | null;
}

export interface TopicTaskPublishReadiness {
  canPublish: boolean;
  code:
    | "ok"
    | "publishing"
    | "not-prepared"
    | "missing-images"
    | "generic-images";
  reason: string | null;
  needsPrepare: boolean;
  resolvedImageCount: number;
  genericResolvedImageCount: number;
  hasHero: boolean;
  heroIsGeneric: boolean;
  allImagesAreGeneric: boolean;
}

function normalizeProvider(provider: string | null | undefined): string {
  const normalized = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  if (!normalized) return "unknown";
  if (normalized === "stock") return "stock-generic";
  if (normalized === "topic-craft-ai") return "ai";
  return normalized;
}

function isResolvedImage(image: TopicTaskPreparedImageLike): boolean {
  return Boolean(image.localPath) && normalizeProvider(image.provider) !== "unresolved";
}

export function getTopicTaskPublishReadiness(
  task: TopicTaskPublishReadinessInput,
): TopicTaskPublishReadiness {
  if ((task.status || "").toUpperCase() === "PUBLISHING") {
    return {
      canPublish: false,
      code: "publishing",
      reason: "이미 발행이 진행 중입니다.",
      needsPrepare: false,
      resolvedImageCount: 0,
      genericResolvedImageCount: 0,
      hasHero: false,
      heroIsGeneric: false,
      allImagesAreGeneric: false,
    };
  }

  if (!parsePreparedTopicContent(task.preparedContentJson) || !task.selectedDraftId) {
    return {
      canPublish: false,
      code: "not-prepared",
      reason: "발행 전에 prepare 단계가 완료되어야 합니다. 먼저 주제글 준비를 다시 실행하세요.",
      needsPrepare: true,
      resolvedImageCount: 0,
      genericResolvedImageCount: 0,
      hasHero: false,
      heroIsGeneric: false,
      allImagesAreGeneric: false,
    };
  }

  const resolvedImages = (task.preparedImages || []).filter(isResolvedImage);
  const hasHero = resolvedImages.some((image) => (image.role || "").toLowerCase() === "hero");
  const heroImage = resolvedImages.find((image) => (image.role || "").toLowerCase() === "hero");
  const genericResolvedImages = resolvedImages.filter((image) =>
    GENERIC_IMAGE_PROVIDERS.has(normalizeProvider(image.provider)),
  );
  const heroIsGeneric = heroImage ? GENERIC_IMAGE_PROVIDERS.has(normalizeProvider(heroImage.provider)) : false;
  const allImagesAreGeneric =
    resolvedImages.length > 0 &&
    resolvedImages.every((image) => GENERIC_IMAGE_PROVIDERS.has(normalizeProvider(image.provider)));

  if (resolvedImages.length === 0 || !hasHero) {
    return {
      canPublish: false,
      code: "missing-images",
      reason:
        "준비된 이미지가 부족합니다. hero 포함 이미지가 실제 파일로 확보된 뒤에만 발행할 수 있습니다. 먼저 재준비를 실행하세요.",
      needsPrepare: true,
      resolvedImageCount: resolvedImages.length,
      genericResolvedImageCount: genericResolvedImages.length,
      hasHero,
      heroIsGeneric,
      allImagesAreGeneric,
    };
  }

  if (heroIsGeneric || allImagesAreGeneric) {
    return {
      canPublish: false,
      code: "generic-images",
      reason:
        genericResolvedImages.length === resolvedImages.length
          ? "준비된 이미지가 전부 generic fallback 입니다. 글과 어울리는 소스/스톡/생성 이미지로 다시 준비한 뒤 발행하세요."
          : "대표(hero) 이미지가 generic fallback 입니다. 대표 이미지를 더 어울리는 소스/스톡/생성 이미지로 다시 준비한 뒤 발행하세요.",
      needsPrepare: true,
      resolvedImageCount: resolvedImages.length,
      genericResolvedImageCount: genericResolvedImages.length,
      hasHero,
      heroIsGeneric,
      allImagesAreGeneric,
    };
  }

  return {
    canPublish: true,
    code: "ok",
    reason: null,
    needsPrepare: false,
    resolvedImageCount: resolvedImages.length,
    genericResolvedImageCount: genericResolvedImages.length,
    hasHero,
    heroIsGeneric,
    allImagesAreGeneric,
  };
}
