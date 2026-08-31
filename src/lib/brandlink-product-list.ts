export type BrandLinkProductListRow = {
  id: string;
  connectKind: string;
  externalItemId: string | null;
  url: string;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CollapsedBrandLinkProduct<T extends BrandLinkProductListRow> = T & {
  duplicateCount: number;
  canCreateDraft: boolean;
  statusMeaning: string;
};

const STATUS_PRIORITY: Record<string, number> = {
  PUBLISHED: 60,
  SCHEDULED: 50,
  PUBLISHING: 40,
  DRAFTING: 35,
  READY: 30,
  FAILED: 10,
};

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/u, "").toLowerCase();
  } catch {
    return value.trim().replace(/\/$/u, "").toLowerCase();
  }
}

function identityKey(row: BrandLinkProductListRow): string {
  const kind = row.connectKind.trim().toUpperCase();
  const externalItemId = row.externalItemId?.trim();
  if (externalItemId) return `${kind}:external:${externalItemId}`;
  return `${kind}:url:${normalizedUrl(row.url)}`;
}

function statusPriority(status: string): number {
  return STATUS_PRIORITY[status.toUpperCase()] ?? 0;
}

function isPreferred<T extends BrandLinkProductListRow>(candidate: T, current: T): boolean {
  const priorityDelta = statusPriority(candidate.status) - statusPriority(current.status);
  if (priorityDelta !== 0) return priorityDelta > 0;
  const updatedDelta = candidate.updatedAt.getTime() - current.updatedAt.getTime();
  if (updatedDelta !== 0) return updatedDelta > 0;
  return candidate.createdAt.getTime() > current.createdAt.getTime();
}

function statusMeaning(status: string): string {
  switch (status.toUpperCase()) {
    case "FAILED":
      return "이전 작업이 실패한 기록입니다. 상품이 잠긴 상태가 아니며 초안 생성을 다시 시도할 수 있습니다.";
    case "READY":
      return "초안 생성 또는 재생성을 시작할 수 있습니다.";
    case "PUBLISHING":
      return "현재 발행 작업 중이라 새 초안 생성을 기다려야 합니다.";
    case "DRAFTING":
      return "현재 ChatGPT에서 초안을 작성하고 있습니다.";
    case "SCHEDULED":
      return "예약 발행이 설정된 상품입니다.";
    case "PUBLISHED":
      return "이미 발행된 상품입니다.";
    default:
      return "현재 상태를 확인한 뒤 작업하세요.";
  }
}

/**
 * 같은 커넥트 상품이 동기화 재시도 과정에서 여러 DB 행으로 남더라도 MCP에는
 * 한 항목만 노출한다. 발행 이력을 우선하고, 그 외에는 READY를 FAILED보다
 * 우선해 과거 실패 행을 현재 상품으로 오인하지 않게 한다.
 */
export function collapseBrandLinkProducts<T extends BrandLinkProductListRow>(
  rows: T[],
): Array<CollapsedBrandLinkProduct<T>> {
  const groups = new Map<string, { item: T; count: number; latestAt: number }>();

  for (const row of rows) {
    const key = identityKey(row);
    const latestAt = Math.max(row.createdAt.getTime(), row.updatedAt.getTime());
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { item: row, count: 1, latestAt });
      continue;
    }
    current.count += 1;
    current.latestAt = Math.max(current.latestAt, latestAt);
    if (isPreferred(row, current.item)) current.item = row;
  }

  return Array.from(groups.values())
    .sort((left, right) => right.latestAt - left.latestAt)
    .map(({ item, count }) => ({
      ...item,
      duplicateCount: count,
      canCreateDraft: item.status === "READY" || item.status === "FAILED",
      statusMeaning: statusMeaning(item.status),
    }));
}
