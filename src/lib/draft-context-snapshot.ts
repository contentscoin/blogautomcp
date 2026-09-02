import { createHash } from "node:crypto";

export const DRAFT_CONTEXT_VERSION = "brand-draft-context/v2" as const;
export const PRODUCT_SNAPSHOT_VERSION = "brand-product-snapshot/v1" as const;

export type DraftConnectKind = "SHOPPING" | "TRAVEL";

export type ProductSnapshotIdentity = {
  productId: string;
  connectKind: DraftConnectKind;
  externalProductId: string | null;
  sourceUrl: string | null;
};

export type ProductSnapshot = ProductSnapshotIdentity & {
  version: typeof PRODUCT_SNAPSHOT_VERSION;
  snapshotId: string;
  capturedAt: string;
  product: Record<string, unknown>;
};

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalized(item)]),
  );
}

function snapshotDigest(value: Omit<ProductSnapshot, "snapshotId" | "capturedAt">): string {
  return createHash("sha256").update(JSON.stringify(normalized(value))).digest("hex");
}

export function createProductSnapshot(input: ProductSnapshotIdentity & { product: Record<string, unknown>; capturedAt?: string }): ProductSnapshot {
  const base = {
    version: PRODUCT_SNAPSHOT_VERSION,
    productId: input.productId,
    connectKind: input.connectKind,
    externalProductId: input.externalProductId || null,
    sourceUrl: input.sourceUrl || null,
    product: input.product,
  } satisfies Omit<ProductSnapshot, "snapshotId" | "capturedAt">;
  return {
    ...base,
    snapshotId: snapshotDigest(base),
    capturedAt: input.capturedAt || new Date().toISOString(),
  };
}

export function readProductSnapshot(
  value: unknown,
  expected?: Partial<Pick<ProductSnapshotIdentity, "productId" | "connectKind">>,
): ProductSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const product = input.product;
  if (
    input.version !== PRODUCT_SNAPSHOT_VERSION ||
    typeof input.productId !== "string" || !input.productId.trim() ||
    (input.connectKind !== "SHOPPING" && input.connectKind !== "TRAVEL") ||
    typeof input.snapshotId !== "string" || !/^[a-f0-9]{64}$/.test(input.snapshotId) ||
    typeof input.capturedAt !== "string" ||
    !product || typeof product !== "object" || Array.isArray(product)
  ) return null;
  const snapshot = input as ProductSnapshot;
  if (expected?.productId && snapshot.productId !== expected.productId) return null;
  if (expected?.connectKind && snapshot.connectKind !== expected.connectKind) return null;
  const base = {
    version: PRODUCT_SNAPSHOT_VERSION,
    productId: snapshot.productId,
    connectKind: snapshot.connectKind,
    externalProductId: typeof snapshot.externalProductId === "string" ? snapshot.externalProductId : null,
    sourceUrl: typeof snapshot.sourceUrl === "string" ? snapshot.sourceUrl : null,
    product: snapshot.product,
  } satisfies Omit<ProductSnapshot, "snapshotId" | "capturedAt">;
  return snapshotDigest(base) === snapshot.snapshotId ? snapshot : null;
}
