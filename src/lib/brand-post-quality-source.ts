import { createHash } from "node:crypto";
import type { ProductSnapshot } from "./draft-context-snapshot";

export const BRAND_POST_QUALITY_SOURCE_VERSION = "brand-post-quality-source/v1" as const;

export interface BrandPostQualitySource {
  version: typeof BRAND_POST_QUALITY_SOURCE_VERSION;
  productName: string;
  sourceDescription: string;
  sourceFeatures: string[];
  fingerprint: string;
}

const clean = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";

const cleanFeatures = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(clean).filter(Boolean))).slice(0, 40)
    : [];

/**
 * Canonical text-QC evidence. Keep this limited to seller/provider facts that
 * are present in the frozen source snapshot. Generated evidence candidates,
 * prices and promotional metadata must not become product-function evidence.
 */
export function buildBrandPostQualitySource(input: {
  productName: unknown;
  description: unknown;
  features: unknown;
}): BrandPostQualitySource {
  const productName = clean(input.productName);
  const sourceDescription = clean(input.description);
  const sourceFeatures = cleanFeatures(input.features);
  const canonical = {
    version: BRAND_POST_QUALITY_SOURCE_VERSION,
    productName,
    sourceDescription,
    sourceFeatures,
  };
  return {
    ...canonical,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}

export function brandPostQualitySourceFromSnapshot(snapshot: ProductSnapshot): BrandPostQualitySource {
  return buildBrandPostQualitySource({
    productName: snapshot.product.name,
    description: snapshot.product.description,
    features: snapshot.product.features,
  });
}

/** Used only to avoid replacing a richer frozen source with a transiently sparse refresh. */
export function brandPostQualitySourceInformationSize(source: BrandPostQualitySource): number {
  return source.sourceDescription.length + source.sourceFeatures.reduce((sum, feature) => sum + feature.length, 0);
}
