export const REFERENCE_SCENE_STRATEGY_VERSION = "shopping-reference-scene/v1";
export const REFERENCE_SCENE_CAPTION = "상품 원본을 참조한 AI 연출 이미지입니다. 소품은 연출용이며 실제 촬영·사용 결과나 기능·효과를 입증하는 자료가 아닙니다.";
export const REFERENCE_SCENE_REVIEW_CHECKS = ["silhouette", "proportions", "topSeal", "capAlignment", "labelHierarchy", "color", "surface"] as const;
export interface ReferenceSceneReview {
  strategyVersion: string;
  referenceSha256: string;
  referencePath: string;
  sourceSnapshotId?: string;
  anchorSha256?: string;
  reviewStatus: "passed" | "failed" | "pending";
  reviewedOutputSha256: string;
  reviewedAt?: string;
  reason?: string;
  checks?: Partial<Record<typeof REFERENCE_SCENE_REVIEW_CHECKS[number], boolean>>;
}

export interface BrandPostImageEvidenceLike {
  provenance?: "ORIGINAL" | "LOCKED_PRODUCT" | "GENERATED_BACKGROUND" | "EDITORIAL_CARD" | "GENERATED_SCENE";
  creationMethod?: "source" | "local-composite" | "remote-generated" | "source-with-generated-background" | "reference-guided-scene";
  remoteGenerated?: boolean;
  referenceScene?: ReferenceSceneReview;
}

export function normalizeBrandPostImageIntent(value: string | undefined): string {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function brandPostSectionSlotId(sectionId: string, ordinal: number): string {
  return `${sectionId}:image:${Math.max(1, Math.floor(ordinal))}`;
}

/**
 * 상품 유형 템플릿이 정한 섹션 이미지 출처. 값이 있으면 문구 패턴 대신 이 값으로 판단한다.
 * (seller-original: 원본 대표·구성 사진, seller-crop: 상세페이지 근거 구간, staged-ai: 연출컷)
 */
export type BrandPostImageSourceHint = "seller-original" | "seller-crop" | "staged-ai" | "editorial-card" | "none";

/** Scene illustration is not evidence of a feature, measurement or actual use. */
export function isShoppingLifestyleImage(target: { imageIntent: string; imageSource?: BrandPostImageSourceHint }): boolean {
  if (target.imageSource) return target.imageSource === "staged-ai";
  const intent = normalizeBrandPostImageIntent(target.imageIntent);
  return /AI 연출 이미지/iu.test(intent) || allowsOriginalShoppingScene(target) || /추천 사용 장면/u.test(intent);
}

/** An original must show the requested scene, not merely a generic packshot. */
export function allowsOriginalShoppingScene(target: { imageIntent: string; imageSource?: BrandPostImageSourceHint }): boolean {
  // A staged-cut slot also accepts a verified original that shows the same scene.
  if (target.imageSource) return target.imageSource === "staged-ai";
  return /제품 원형을 보존한 연출컷 또는 원본 사용 장면/u.test(normalizeBrandPostImageIntent(target.imageIntent));
}

/** Generic packshots are evidence only when the requested visual is an overview. */
export function allowsGenericBrandPostProductPhoto(target: {
  sectionTitle: string;
  imageIntent: string;
  imageSource?: BrandPostImageSourceHint;
}): boolean {
  // Template-designated original slots (overview, package, representative photo)
  // accept a plain product photo; detail-crop slots require feature evidence.
  if (target.imageSource === "seller-original") return true;
  if (target.imageSource === "seller-crop") return false;
  const title = normalizeBrandPostImageIntent(target.sectionTitle);
  const intent = normalizeBrandPostImageIntent(target.imageIntent);
  // Measurements can identify a product in an overview title ("532ml 전체 구성").
  // Only that explicit overview may ignore identity attributes, never claims
  // about operation, efficacy, safety or a feature-specific visual request.
  const overviewTitle = /한눈|전체\s*(?:모습|구성|형태)|제품\s*(?:소개|개요|정체)|어떤\s*제품/u.test(title);
  const identityOnlyTitle = overviewTitle && !/선택\s*기준|차이|비교|실측|치수/u.test(title)
    ? title.replace(/용량|크기|규격/gu, "") : title;
  const featureSpecific = /기능|작동|조작|특장점|냉온풍|냉풍|온풍|센서|성능|효과|효익|용량|크기|규격|설치|세척|살균|소독|소음|전력|소비전력|소재|재질|마감|안전|보관|사용법|구조|버튼|모드|온도|속도|흡입|건조|주의|한계|비교/u.test(`${identityOnlyTitle} ${intent}`);
  const overviewSpecific = /대표\s*(?:사진|이미지|원본)?|한눈|전체\s*(?:모습|구성|형태)?|외관|패키지|구성품|어떤\s*제품|제품\s*(?:모습|정체)/u.test(intent);
  return overviewSpecific && !featureSpecific;
}

export interface BrandPostImageEvidenceClassification {
  coherent: boolean;
  generated: boolean;
  reason: string | null;
}

/**
 * Treat the three provenance fields as one signed claim. A single stale flag
 * must never turn a seller original into generated evidence.
 */
export function classifyBrandPostImageEvidence(
  asset: BrandPostImageEvidenceLike,
): BrandPostImageEvidenceClassification {
  const provenance = asset.provenance;
  const method = asset.creationMethod;
  const remote = asset.remoteGenerated;
  const valid = (generated: boolean): BrandPostImageEvidenceClassification => ({
    coherent: true,
    generated,
    reason: null,
  });
  const invalid = (): BrandPostImageEvidenceClassification => ({
    coherent: false,
    generated: false,
    reason: "이미지 생성 출처 메타데이터가 서로 모순됩니다.",
  });

  if (method === "reference-guided-scene") {
    return remote === true && provenance === "GENERATED_SCENE" ? valid(true) : invalid();
  }
  if (method === "source") {
    return remote === true || (provenance !== undefined && provenance !== "ORIGINAL" && provenance !== "LOCKED_PRODUCT")
      ? invalid()
      : valid(false);
  }
  if (method === "local-composite") {
    return remote === true || (provenance !== "EDITORIAL_CARD" && provenance !== "LOCKED_PRODUCT")
      ? invalid()
      : valid(false);
  }
  if (method === "remote-generated") {
    return remote === true && (provenance === "GENERATED_BACKGROUND" || provenance === "EDITORIAL_CARD")
      ? valid(true)
      : invalid();
  }
  if (method === "source-with-generated-background") {
    return remote === true && (provenance === "LOCKED_PRODUCT" || provenance === "EDITORIAL_CARD")
      ? valid(true)
      : invalid();
  }

  // Missing generation metadata is legacy source evidence at most. Generated
  // provenance or a positive remote flag without its creation method is stale.
  if (remote === true || provenance === "GENERATED_BACKGROUND" || provenance === "EDITORIAL_CARD" || provenance === "GENERATED_SCENE") return invalid();
  return valid(false);
}

export function brandPostImageIntentMatches(options: {
  assetIntent?: string;
  sectionTitle: string;
  sectionIntent: string;
}): boolean {
  const actual = normalizeBrandPostImageIntent(options.assetIntent);
  const expected = normalizeBrandPostImageIntent(options.sectionIntent);
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  // Initial package assembly historically stored render-node alt text here.
  return actual === normalizeBrandPostImageIntent(`${options.sectionTitle} - ${options.sectionIntent}`);
}

/** Local information card that frames a whole verified seller photo (no cutout, no generated scene). */
export function isShoppingFactCardAsset(asset: BrandPostImageEvidenceLike): boolean {
  return asset.provenance === "EDITORIAL_CARD" && asset.creationMethod === "local-composite" && asset.remoteGenerated !== true;
}

/** Full-scene generation is illustration, never source photography or feature evidence. */
export function isReferenceGuidedScene(asset: BrandPostImageEvidenceLike): boolean {
  return asset.provenance === "GENERATED_SCENE" || asset.creationMethod === "reference-guided-scene";
}

/** Review is bound to product facts, original-reference bytes and the exact final output. */
export function referenceSceneReviewIssue(asset: BrandPostImageEvidenceLike & { sha256?: string }, context: {
  referenceSha256?: string;
  sourceSnapshotId?: string;
  anchorSha256?: string;
}): string | null {
  if (!isReferenceGuidedScene(asset)) return null;
  const review = asset.referenceScene;
  if (!classifyBrandPostImageEvidence(asset).coherent) return "연출 이미지 출처가 원본/잠금 합성으로 잘못 표시되었습니다.";
  if (!review || review.reviewStatus !== "passed") return "상품 참조 연출 이미지의 원본 대조 검토가 완료되지 않았습니다.";
  if (review.strategyVersion !== REFERENCE_SCENE_STRATEGY_VERSION) return "연출 이미지의 검토 전략 버전을 확인할 수 없습니다.";
  if (!context.sourceSnapshotId || review.sourceSnapshotId !== context.sourceSnapshotId) return "연출 이미지 검토 당시 상품 근거와 현재 상품 근거가 다릅니다.";
  if (!/^[a-f0-9]{64}$/u.test(review.referenceSha256) || context.referenceSha256 !== review.referenceSha256) return "연출 이미지의 상품 원본 참조 파일이 없거나 변경되었습니다.";
  if (!asset.sha256 || review.reviewedOutputSha256 !== asset.sha256) return "원본 대조 검토가 현재 연출 이미지 픽셀과 일치하지 않습니다.";
  if (review.anchorSha256 && review.anchorSha256 !== context.anchorSha256) return "연출 이미지의 승인된 대표 장면 참조가 변경되었습니다.";
  if (!REFERENCE_SCENE_REVIEW_CHECKS.every(check => review.checks?.[check] === true)) return "상품 윤곽·비율·상단·뚜껑·라벨·색상·표면 대조 검토가 모두 통과하지 않았습니다.";
  return null;
}
