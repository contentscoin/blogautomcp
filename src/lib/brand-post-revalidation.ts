import { createHash } from "node:crypto";
import fs from "node:fs";
import { getBrandLinkContentReadiness } from "../../scripts/lib/brandlink-content-readiness";
import { createProductSnapshot, readProductSnapshot, type ProductSnapshot, type ProductSnapshotIdentity } from "./draft-context-snapshot";
import type { BrandPostPackageManifestV2 } from "./brand-post-package";

// Bump when the revalidation input contract changes. Every explicit recheck still
// runs the current evaluator; this is audit metadata, never a cached pass token.
export const SAVED_TEXT_QC_VERSION = "saved-text-qc/v1";
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

function fail(message: string): never {
  throw new SavedTextRevalidationError(message);
}
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const normalized = (value: string) => value.replace(/\s+/g, " ").trim();

/** Only server-owned saved inputs may be passed here. A digest is integrity,
 * not authentication: never pass a request body's snapshot as savedContext. */
export function resolveSavedQcSource(manifest: BrandPostPackageManifestV2, identity: RecheckIdentity, savedContext?: unknown): {
  snapshot: ProductSnapshot; origin: SavedTextQcMetadata["sourceOrigin"];
} {
  if (manifest.brandLinkId !== identity.productId || manifest.connectKind !== identity.connectKind || manifest.composition.connectKind !== identity.connectKind) fail("저장 초안과 상품 신원이 일치하지 않습니다.");
  const validate = (value: unknown) => {
    const snapshot = readProductSnapshot(value, identity);
    if (!snapshot || snapshot.externalProductId !== identity.externalProductId) fail("저장 출처의 상품 ID가 현재 상품과 일치하지 않습니다.");
    // Provider item ID is stable while display names, prices and dated URLs can
    // change. Without that ID, retain an exact URL identity check (minus fragment).
    const canonicalUrl = (value: string | null) => {
      try { const url = new URL(value || ""); url.hash = ""; url.pathname = url.pathname.replace(/\/$/, ""); return url.toString(); } catch { return value; }
    };
    if (!snapshot.externalProductId && (!snapshot.sourceUrl || canonicalUrl(snapshot.sourceUrl) !== canonicalUrl(identity.sourceUrl))) {
      throw new SavedTextRevalidationError("원본 URL이 변경되어 저장 출처의 상품을 확인할 수 없습니다. 원본 컨텍스트를 다시 수집하세요.", "PRODUCT_SNAPSHOT_CHANGED");
    }
    const product = snapshot.product;
    if (typeof product.name !== "string" || !product.name.trim()) fail("저장 출처의 상품명이 없습니다.");
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
  // The renderer and section source must agree before replacing an old verdict.
  for (const section of manifest.composition.sections) {
    const rendered = nodes.filter((node) => (node.kind === "heading" || node.kind === "quotation" || node.kind === "paragraph") && node.sectionId === section.id)
      .map((node) => "text" in node ? node.text : "").join("\n");
    if (normalized(rendered) !== normalized([section.title, ...section.body].join("\n"))) fail("저장 본문과 렌더 문서가 달라 안전하게 재검사할 수 없습니다.");
  }
  const sections = manifest.composition.sections.map((section) => [section.title, ...section.body].join("\n"));
  const extraText = nodes.filter((node) => ((node.kind === "paragraph" || node.kind === "heading" || node.kind === "quotation") && !manifest.composition.sections.some((section) => section.id === node.sectionId)) || node.kind === "disclosure")
    .map((node) => "text" in node ? node.text : "").join("\n");
  sections.push(extraText); // Do not invent a missing disclosure.
  if (manifest.title !== manifest.composition.title) fail("저장 제목과 렌더 제목이 일치하지 않습니다.");
  return sections;
}

export function revalidateSavedBrandPostText(manifest: BrandPostPackageManifestV2, identity: RecheckIdentity, savedContext?: unknown): BrandPostPackageManifestV2 {
  const { snapshot, origin } = resolveSavedQcSource(manifest, identity, savedContext);
  const sections = savedBrandPostTextSections(manifest);
  const input = {
    productName: snapshot.product.name as string, title: manifest.title, sections, hashtags: manifest.hashtags,
    brandLink: identity.brandLink, generationSource: manifest.generationSource || "UNKNOWN" as const,
    // A legacy mode flag alone is not proof of a personal experience.
    experienceMode: "AI_ASSISTED_INFORMATION" as const,
    connectKind: manifest.connectKind,
    sourceDescription: snapshot.product.description as string, sourceFeatures: snapshot.product.features as string[],
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
      inputFingerprint: createHash("sha256").update(JSON.stringify({ input, snapshotId: snapshot.snapshotId })).digest("hex"),
    },
  };
}
