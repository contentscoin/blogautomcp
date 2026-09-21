export interface BrandPostImageEvidenceLike {
  provenance?: "ORIGINAL" | "LOCKED_PRODUCT" | "GENERATED_BACKGROUND" | "EDITORIAL_CARD";
  creationMethod?: "source" | "local-composite" | "remote-generated" | "source-with-generated-background";
  remoteGenerated?: boolean;
}

export function normalizeBrandPostImageIntent(value: string | undefined): string {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function brandPostSectionSlotId(sectionId: string, ordinal: number): string {
  return `${sectionId}:image:${Math.max(1, Math.floor(ordinal))}`;
}

/** Scene illustration is not evidence of a feature, measurement or actual use. */
export function isShoppingLifestyleImage(target: { imageIntent: string }): boolean {
  const intent = normalizeBrandPostImageIntent(target.imageIntent);
  return /AI 연출 이미지/iu.test(intent) || allowsOriginalShoppingScene(target) || /추천 사용 장면/u.test(intent);
}

/** An original must show the requested scene, not merely a generic packshot. */
export function allowsOriginalShoppingScene(target: { imageIntent: string }): boolean {
  return /제품 원형을 보존한 연출컷 또는 원본 사용 장면/u.test(normalizeBrandPostImageIntent(target.imageIntent));
}

/** Generic packshots are evidence only when the requested visual is an overview. */
export function allowsGenericBrandPostProductPhoto(target: {
  sectionTitle: string;
  imageIntent: string;
}): boolean {
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
  if (remote === true || provenance === "GENERATED_BACKGROUND" || provenance === "EDITORIAL_CARD") return invalid();
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
