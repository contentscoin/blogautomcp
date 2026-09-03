import { buildProductVerifiedFactLines } from "../../scripts/lib/product-editorial-plan";

/**
 * post_create_draft(= POST_PREPARE_DRAFT) 작업 결과.
 *
 * brand-draft-context/v2 는 최상위에 그대로 펼친다(snapshot·snapshotId·version·product·generation·
 * nextAction·externalProductId·sourceUrl·generatedAt). 1.3.10 은 이것을 `context` 아래로 내렸고,
 * 사이트의 post_submit_draft 검증과 PC 의 스냅샷 무결성 검사가 모두 최상위 `snapshot` 을 읽기 때문에
 * 모든 제출이 PRODUCT_SNAPSHOT_CHANGED 로 막혔다. 여기에 ChatGPT 가 바로 읽을
 * verifiedFacts / sourceImages / harness / systemPrompt / userPrompt / imageIntents 만 더한다.
 */

/** 사이트 complete 본문 한도(900KB) 아래에서만 프롬프트 중복을 허용한다. */
export const PREPARED_DRAFT_VIEW_BUDGET_BYTES = 850 * 1024;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildPreparedDraftView(
  data: Record<string, unknown>,
  productId: string,
  contextJobId: string,
  warnings: string[],
): Record<string, unknown> {
  const product = asRecord(data.product);
  const generation = asRecord(data.generation);
  const features = Array.isArray(product.features) ? product.features.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const factLines = buildProductVerifiedFactLines({
    productName: stringOrEmpty(product.name),
    description: stringOrEmpty(product.description),
    features,
    price: stringOrEmpty(product.price),
    originalPrice: stringOrEmpty(product.originalPrice),
    discountRate: stringOrEmpty(product.discountRate),
    couponInfo: stringOrEmpty(product.couponInfo),
    deliveryInfo: stringOrEmpty(product.deliveryInfo),
    reviewCount: stringOrEmpty(product.reviewCount),
    rating: stringOrEmpty(product.rating),
    targetSectionCount: 11,
  });
  const storeName = stringOrEmpty(product.storeName);
  const verifiedFacts = Array.from(new Set([
    ...factLines,
    ...(storeName ? [`판매처: ${storeName}`] : []),
    ...(features.length > 0 ? [`상품 태그: ${features.slice(0, 24).join(", ")}`] : []),
  ]));
  const sourceImages = Array.isArray(product.referenceImageUrls)
    ? product.referenceImageUrls.filter((item): item is string => typeof item === "string" && /^https:\/\//u.test(item)).slice(0, 20)
    : [];
  const harness: Record<string, unknown> = {
    writingContract: generation.writingContract ?? null,
    qualityChecklist: generation.qualityChecklist ?? null,
    outputSchema: generation.outputSchema ?? null,
    minimumSectionCount: generation.minimumSectionCount ?? null,
    maximumSectionCount: generation.maximumSectionCount ?? null,
    targetCharacters: generation.targetCharacters ?? null,
    qualityPreset: generation.qualityPreset ?? null,
    experienceMode: generation.experienceMode ?? null,
  };
  const view: Record<string, unknown> = {
    ...data,
    productId,
    contextJobId,
    verifiedFacts,
    sourceImages,
    harness,
    systemPrompt: generation.systemPrompt ?? null,
    userPrompt: generation.userPrompt ?? null,
    imageIntents: Array.isArray(data.imageIntents) ? data.imageIntents : [],
  };
  if (Buffer.byteLength(JSON.stringify(view), "utf8") > PREPARED_DRAFT_VIEW_BUDGET_BYTES) {
    harness.outputSchema = null;
  }
  if (Buffer.byteLength(JSON.stringify(view), "utf8") > PREPARED_DRAFT_VIEW_BUDGET_BYTES) {
    view.systemPrompt = null;
    view.userPrompt = null;
    warnings.push("컨텍스트가 커서 systemPrompt·userPrompt 는 generation 안에서만 제공합니다.");
  }
  return view;
}
