import { createHash } from "node:crypto";
import fs from "node:fs";
import { getBrandLinkContentReadiness } from "../../scripts/lib/brandlink-content-readiness";
import { createProductSnapshot, readProductSnapshot, type ProductSnapshot, type ProductSnapshotIdentity } from "./draft-context-snapshot";
import type { BrandPostPackageManifestV2 } from "./brand-post-package";
import { brandPostQualitySourceFromSnapshot, BRAND_POST_QUALITY_SOURCE_VERSION } from "./brand-post-quality-source";
import { buildProductReviewAnalysis } from "../../scripts/lib/product-editorial-plan";
import { buildTravelReviewAnalysis } from "../../scripts/lib/travel-content";

// Bump when the revalidation input contract changes. Every explicit recheck still
// runs the current evaluator; this is audit metadata, never a cached pass token.
export const SAVED_TEXT_QC_VERSION = "saved-text-qc/v3";
export interface SavedTextQcMetadata {
  version: typeof SAVED_TEXT_QC_VERSION;
  checkedAt: string;
  inputFingerprint: string;
  sourceSnapshotId: string;
  sourceOrigin: "package" | "saved-context" | "legacy-post-spec";
}
export type RecheckIdentity = ProductSnapshotIdentity & { productName: string; brandLink: string };

export class SavedTextRevalidationError extends Error {
  constructor(message: string, readonly code = "QC_SOURCE_REQUIRED") { super(message); }
}

type SnapshotEvidenceProfile = {
  level: number;
  facts: number;
  reviewFacts: number;
};

const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
const evidenceKey = (value: string) => normalized(value)
  .normalize("NFKC")
  .toLocaleLowerCase("ko-KR")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

function normalizedProductName(value: unknown): string {
  if (typeof value !== "string") return "";
  return evidenceKey(value
    .replace(/^\s*\[[^\]]{1,80}\]\s*/u, "")
    .replace(/(?:EVENT|이벤트|프로모션|특가|단독)\s*/giu, ""));
}

function sameProductName(left: unknown, right: unknown): boolean {
  const a = normalizedProductName(left);
  const b = normalizedProductName(right);
  if (!a || !b) return false;
  if (a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a)))) return true;
  const aTokens = new Set(a.split(" ").filter((token) => token.length >= 2));
  const bTokens = new Set(b.split(" ").filter((token) => token.length >= 2));
  if (!aTokens.size || !bTokens.size) return false;
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap / Math.min(aTokens.size, bTokens.size) >= 0.75;
}

function sourceLocator(value: string | null): string {
  try {
    const url = new URL(value || "");
    // URL.pathname preserves percent escapes. Normalize only characters whose
    // escaped and literal forms identify the same path segment here; never
    // decode slash, question mark or hash because that would change structure.
    const pathname = url.pathname.replace(/%([0-9a-f]{2})/giu, (encoded, hex: string) => {
      const character = String.fromCharCode(Number.parseInt(hex, 16));
      return /^[a-z0-9._~|\-]$/iu.test(character) ? character : `%${hex.toUpperCase()}`;
    }).replace(/\/$/u, "");
    const stable = new URLSearchParams();
    for (const key of ["productId", "productNo", "itemId", "id"]) {
      const item = url.searchParams.get(key);
      if (item) stable.set(key.toLocaleLowerCase(), item);
    }
    const query = stable.toString();
    return `${url.origin.toLocaleLowerCase()}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return normalized(value || "");
  }
}

function isGenericConnectUrl(value: string | null): boolean {
  try {
    const url = new URL(value || "");
    // Tracking parameters such as ?reqChannel=brandconnect do not turn a real
    // seller detail URL into a generic connect listing.
    const locator = `${url.hostname}${url.pathname}`;
    const connectSurface = /(?:brandconnect|shopping-connect|travel-connect)(?:[./_-]|$)/iu.test(locator);
    const detailPath = /(?:products?|items?|details?|goods)\/(?:[^/?#]+\/?)+/iu.test(url.pathname);
    const stableId = ["productId", "productNo", "itemId", "id"].some((key) => Boolean(url.searchParams.get(key)));
    return connectSurface && !detailPath && !stableId;
  } catch { return false; }
}

function compatibleSourceUrl(candidate: string | null, current: string | null): boolean {
  if (!candidate || !current) return candidate === current;
  if (sourceLocator(candidate) === sourceLocator(current)) return true;
  // Older packages could accidentally freeze a connect category URL. Permit a
  // one-way move only inside the same trusted origin. Product name and an item
  // ID cannot authenticate an arbitrary cross-origin replacement page.
  try {
    return new URL(candidate).origin.toLocaleLowerCase() === new URL(current).origin.toLocaleLowerCase() &&
      isGenericConnectUrl(current) && !isGenericConnectUrl(candidate);
  } catch { return false; }
}

export function productSnapshotEvidenceKeys(snapshot: ProductSnapshot): Set<string> {
  const source = brandPostQualitySourceFromSnapshot(snapshot);
  if (snapshot.connectKind === "TRAVEL") {
    const analysis = buildTravelReviewAnalysis({
      name: source.productName,
      description: source.sourceDescription,
      features: source.sourceFeatures,
      price: "",
    });
    return new Set([
      ...analysis.routeScope,
      ...analysis.verifiedConditions,
      ...analysis.highlightReviews.map((item) => item.name),
    ].map(evidenceKey).filter(Boolean));
  }
  const analysis = buildProductReviewAnalysis({
    productName: source.productName,
    description: source.sourceDescription,
    features: source.sourceFeatures,
    targetSectionCount: 11,
  });
  return new Set([
    ...analysis.verifiedSignals,
    ...analysis.reviewEvidence,
  ].map(evidenceKey).filter(Boolean));
}

/**
 * A freshly collected context may replace the frozen generation source only
 * when the evaluator can see strictly more substantive evidence. Prices,
 * coupons and a longer marketing description do not make a shopping source
 * richer. Keeping this comparison pure also makes the refresh transaction
 * independently testable.
 */
export function productSnapshotEvidenceProfile(snapshot: ProductSnapshot): SnapshotEvidenceProfile {
  const source = brandPostQualitySourceFromSnapshot(snapshot);
  if (snapshot.connectKind === "TRAVEL") {
    const analysis = buildTravelReviewAnalysis({
      name: source.productName,
      description: source.sourceDescription,
      features: source.sourceFeatures,
      price: "",
    });
    const facts = new Set([
      ...analysis.routeScope,
      ...analysis.verifiedConditions,
      ...analysis.highlightReviews.map((item) => item.name),
    ].map(normalized).filter(Boolean)).size;
    return { level: facts >= 8 ? 2 : facts >= 3 ? 1 : 0, facts, reviewFacts: 0 };
  }
  const analysis = buildProductReviewAnalysis({
    productName: source.productName,
    description: source.sourceDescription,
    features: source.sourceFeatures,
    targetSectionCount: 11,
  });
  return {
    level: analysis.evidenceLevel === "rich" ? 2 : analysis.evidenceLevel === "usable" ? 1 : 0,
    facts: analysis.verifiedSignals.length,
    reviewFacts: analysis.reviewEvidence.length,
  };
}

export function isProductSnapshotEvidenceRicher(candidate: ProductSnapshot, current: ProductSnapshot): boolean {
  if (candidate.snapshotId === current.snapshotId) return false;
  if (
    candidate.productId !== current.productId ||
    candidate.connectKind !== current.connectKind ||
    candidate.externalProductId !== current.externalProductId ||
    !sameProductName(candidate.product.name, current.product.name) ||
    !compatibleSourceUrl(candidate.sourceUrl, current.sourceUrl)
  ) return false;
  const previousEvidence = productSnapshotEvidenceKeys(current);
  const candidateEvidence = productSnapshotEvidenceKeys(candidate);
  if ([...previousEvidence].some((key) => !candidateEvidence.has(key))) return false;
  const next = productSnapshotEvidenceProfile(candidate);
  const before = productSnapshotEvidenceProfile(current);
  if (next.level !== before.level) return next.level > before.level;
  if (next.facts !== before.facts) return next.facts > before.facts;
  return next.reviewFacts > before.reviewFacts;
}

function fail(message: string): never {
  throw new SavedTextRevalidationError(message);
}
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

/** Only server-owned saved inputs may be passed here. A digest is integrity,
 * not authentication: never pass a request body's snapshot as savedContext. */
export function resolveSavedQcSource(manifest: BrandPostPackageManifestV2, identity: RecheckIdentity, savedContext?: unknown): {
  snapshot: ProductSnapshot; origin: SavedTextQcMetadata["sourceOrigin"];
} {
  if (manifest.brandLinkId !== identity.productId || manifest.connectKind !== identity.connectKind || manifest.composition.connectKind !== identity.connectKind) fail("저장 초안과 상품 신원이 일치하지 않습니다.");
  const validate = (value: unknown) => {
    const snapshot = readProductSnapshot(value, identity);
    if (!snapshot || snapshot.externalProductId !== identity.externalProductId) fail("저장 출처의 상품 ID가 현재 상품과 일치하지 않습니다.");
    // The database item ID alone is insufficient because an untrusted page can
    // be relabelled with that value. Bind the saved source to its concrete URL
    // and product name as well.
    if (!snapshot.sourceUrl || !compatibleSourceUrl(snapshot.sourceUrl, identity.sourceUrl)) {
      throw new SavedTextRevalidationError("원본 URL이 변경되어 저장 출처의 상품을 확인할 수 없습니다. 원본 컨텍스트를 다시 수집하세요.", "PRODUCT_SNAPSHOT_CHANGED");
    }
    const product = snapshot.product;
    if (typeof product.name !== "string" || !product.name.trim()) fail("저장 출처의 상품명이 없습니다.");
    if (!sameProductName(product.name, identity.productName)) {
      throw new SavedTextRevalidationError("저장 출처의 상품명이 현재 상품과 일치하지 않습니다. 원본 컨텍스트를 다시 수집하세요.", "PRODUCT_SNAPSHOT_CHANGED");
    }
    if (typeof product.finalUrl === "string" && product.finalUrl.trim() && !compatibleSourceUrl(product.finalUrl, snapshot.sourceUrl)) {
      throw new SavedTextRevalidationError("저장 출처의 상세 URL과 스냅샷 URL이 일치하지 않습니다.", "PRODUCT_SNAPSHOT_CHANGED");
    }
    if (typeof product.description !== "string" || !strings(product.features) || (!product.description.trim() && !product.features.some((item) => item.trim()))) fail("재검사에 필요한 실제 저장 출처 설명·특징이 없습니다.");
    return snapshot;
  };
  if (manifest.sourceSnapshot != null) return { snapshot: validate(manifest.sourceSnapshot), origin: "package" };
  if (savedContext != null) {
    const context = savedContext as Record<string, unknown>;
    if (context.version !== "brand-draft-context/v2" || context.productId !== identity.productId || context.connectKind !== identity.connectKind) fail("저장 컨텍스트의 상품 신원을 검증할 수 없습니다.");
    return { snapshot: validate(context.snapshot), origin: "saved-context" };
  }
  const spec = manifest.postSpec as { version?: string; productId?: string; connectKind?: string; productName?: string; facts?: { lines?: unknown } } | undefined;
  // Legacy specs are server-created, pre-generation fact ledgers. Require both
  // their identity and the saved outbound card identity; never use draft lines.
  const cards = manifest.composition.renderNodes.filter((node) => node.kind === "connectCard");
  if (spec?.version === "post-spec/v1" && spec.productId === identity.productId && spec.connectKind === identity.connectKind &&
      spec.productName && normalized(spec.productName) === normalized(identity.productName) &&
      cards.length > 0 && cards.every((node) => node.kind === "connectCard" && node.url === identity.brandLink && node.connectKind === identity.connectKind) &&
      strings(spec.facts?.lines) && spec.facts.lines.some((line) => line.trim())) {
    return { origin: "legacy-post-spec", snapshot: createProductSnapshot({
      ...identity, product: { name: spec.productName, description: "", features: spec.facts.lines, provenance: "legacy-post-spec-facts" },
      capturedAt: manifest.createdAt,
    }) };
  }
  return fail("상품 신원이 검증된 저장 출처가 없어 재검사할 수 없습니다. 원본 컨텍스트를 다시 수집한 뒤 재검사하세요.");
}

/** Pure with respect to packages: evaluates actual saved text, never writes or approves. */
export function savedBrandPostTextSections(manifest: BrandPostPackageManifestV2): string[] {
  const nodes = manifest.composition.renderNodes;
  const renderedSections: string[] = [];
  // The renderer and section source must agree before replacing an old verdict.
  for (const section of manifest.composition.sections) {
    const rendered = nodes.filter((node) => (node.kind === "heading" || node.kind === "quotation" || node.kind === "paragraph") && node.sectionId === section.id)
      .map((node) => "text" in node ? node.text : "").join("\n");
    if (normalized(rendered) !== normalized([section.title, ...section.body].join("\n"))) fail("저장 본문과 렌더 문서가 달라 안전하게 재검사할 수 없습니다.");
    renderedSections.push(rendered);
  }
  const extraText = nodes.filter((node) => ((node.kind === "paragraph" || node.kind === "heading" || node.kind === "quotation") && !manifest.composition.sections.some((section) => section.id === node.sectionId)) || node.kind === "disclosure")
    .map((node) => "text" in node ? node.text : "").join("\n");
  renderedSections.push(extraText); // Do not invent a missing disclosure.
  if (manifest.title !== manifest.composition.title) fail("저장 제목과 렌더 제목이 일치하지 않습니다.");
  return renderedSections;
}

export function revalidateSavedBrandPostText(manifest: BrandPostPackageManifestV2, identity: RecheckIdentity, savedContext?: unknown): BrandPostPackageManifestV2 {
  const { snapshot, origin } = resolveSavedQcSource(manifest, identity, savedContext);
  const sections = savedBrandPostTextSections(manifest);
  const qualitySource = brandPostQualitySourceFromSnapshot(snapshot);
  const input = {
    productName: qualitySource.productName, title: manifest.title, sections, hashtags: manifest.hashtags,
    brandLink: identity.brandLink, generationSource: manifest.generationSource || "UNKNOWN" as const,
    // A legacy mode flag alone is not proof of a personal experience.
    experienceMode: "AI_ASSISTED_INFORMATION" as const,
    connectKind: manifest.connectKind,
    sourceDescription: qualitySource.sourceDescription, sourceFeatures: qualitySource.sourceFeatures,
    hasRepresentativeImage: (() => { try { return fs.statSync(manifest.heroImagePath).isFile(); } catch { return false; } })(),
    compositionQualityReport: manifest.composition.qualityReport,
  };
  const contentQuality = getBrandLinkContentReadiness(input);
  return { ...manifest, sourceSnapshot: snapshot, contentQuality, approvedAt: null,
    // Old specValidation describes generation-time text; preview must show this evaluation.
    specValidation: null,
    textQualityRevalidation: {
      version: SAVED_TEXT_QC_VERSION, checkedAt: new Date().toISOString(), sourceOrigin: origin,
      sourceSnapshotId: snapshot.snapshotId,
      inputFingerprint: createHash("sha256").update(JSON.stringify({ input, snapshotId: snapshot.snapshotId,
        qualitySourceVersion: BRAND_POST_QUALITY_SOURCE_VERSION, qualitySourceFingerprint: qualitySource.fingerprint })).digest("hex"),
    },
  };
}
