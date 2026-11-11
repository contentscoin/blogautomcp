/**
 * 브랜드커넥트 목록 동기화 결과를 사람이 읽을 이유로 설명한다.
 * "0개 등록됨"만 보고는 로그인 문제인지, 검색어가 범위 밖인지, 전부 중복인지 알 수 없기 때문이다.
 */
export interface ListSyncCounts {
  /** 필터 적용 전, 목록 API에서 받은 서로 다른 상품 수 */
  collected: number;
  /** 브랜드·프로모션·카테고리 필터를 통과한 상품 수 */
  matched: number;
  /** 최근 등록분과의 중복을 뺀 뒤 남은 후보 수 */
  selectable: number;
  requested: number;
  registered: number;
  duplicates: number;
  linkFailures: number;
  scannedCategories: number;
  filters: { brand: string[]; promotion: string[]; category: string[] };
  /** 브랜드 검색어 때문에 탐색 범위를 넓혔는지 */
  widened?: boolean;
}

export type ListSyncDiagnosisCode =
  | "OK" | "PARTIAL" | "NO_PRODUCTS_COLLECTED" | "FILTER_MATCHED_NONE" | "ALL_DUPLICATES" | "LINK_ISSUE_FAILED";

export interface ListSyncDiagnosis extends ListSyncCounts { code: ListSyncDiagnosisCode; message: string }

export const LIST_SYNC_DIAGNOSIS_PREFIX = "SYNC_DIAGNOSIS: ";

function filterLabel(filters: ListSyncCounts["filters"]): string {
  return [
    filters.brand.length ? `브랜드·스토어 "${filters.brand.join(", ")}"` : "",
    filters.promotion.length ? `프로모션 "${filters.promotion.join(", ")}"` : "",
    filters.category.length ? `카테고리 "${filters.category.join(", ")}"` : "",
  ].filter(Boolean).join(", ");
}

export function diagnoseListSync(counts: ListSyncCounts): ListSyncDiagnosis {
  const filters = filterLabel(counts.filters);
  const scope = `카테고리 ${counts.scannedCategories}개에서 상품 ${counts.collected}개를 확인했습니다`;
  let code: ListSyncDiagnosisCode;
  let message: string;
  if (counts.collected === 0) {
    code = "NO_PRODUCTS_COLLECTED";
    message = "브랜드커넥트 목록에서 상품을 하나도 받지 못했습니다. 네이버 로그인 상태와 쇼핑커넥트 이용 권한, 설정된 카테고리 주소를 확인하세요.";
  } else if (counts.matched === 0) {
    code = "FILTER_MATCHED_NONE";
    message = `${scope}. 그중 ${filters || "지정한 조건"}에 맞는 상품이 없습니다. 목록은 카테고리별 상위 상품만 훑으므로 검색어를 스토어명이나 상품명에 실제로 들어가는 낱말로 바꾸거나 카테고리를 지정해 보세요.`;
  } else if (counts.registered === 0 && counts.linkFailures > 0) {
    code = "LINK_ISSUE_FAILED";
    message = `조건에 맞는 상품 ${counts.matched}개를 찾았지만 제휴 링크를 발급하지 못했습니다(${counts.linkFailures}건). 네이버 로그인이 유지되는지 확인한 뒤 다시 시도하세요.`;
  } else if (counts.registered === 0) {
    code = "ALL_DUPLICATES";
    message = `조건에 맞는 상품 ${counts.matched}개는 모두 이미 등록되어 있습니다. 새로 가져올 상품이 없습니다.`;
  } else if (counts.registered < counts.requested) {
    code = "PARTIAL";
    message = `요청 ${counts.requested}개 중 ${counts.registered}개를 가져왔습니다. ${scope}. 조건에 맞는 상품 ${counts.matched}개, 이미 등록된 상품 ${counts.duplicates}개, 링크 발급 실패 ${counts.linkFailures}건입니다.`;
  } else {
    code = "OK";
    message = `${counts.registered}개를 가져왔습니다.`;
  }
  if (counts.widened && code !== "OK") message += " 검색어에 맞는 상품이 적어 탐색 범위를 넓혀 다시 확인한 결과입니다.";
  return { ...counts, code, message };
}

/** 동기화 로그에서 마지막 진단 줄을 읽는다. 없거나 깨졌으면 null. */
export function readListSyncDiagnosis(log: string): ListSyncDiagnosis | null {
  const line = log.split(/\r?\n/u).reverse().find((item) => item.includes(LIST_SYNC_DIAGNOSIS_PREFIX));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(line.indexOf(LIST_SYNC_DIAGNOSIS_PREFIX) + LIST_SYNC_DIAGNOSIS_PREFIX.length)) as ListSyncDiagnosis;
    return typeof parsed?.code === "string" && typeof parsed.message === "string" ? parsed : null;
  } catch { return null; }
}

const IMAGE_KEYS = ["representativeImageUrl", "representImageUrl", "productImageUrl", "imageUrl", "thumbnailUrl", "image"];
const URL_KEYS = ["productUrl", "productLink", "linkUrl", "url", "mobileProductUrl"];

function httpUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : value && typeof value === "object"
    ? String((value as { url?: unknown }).url || "").trim() : "";
  const url = raw.startsWith("//") ? `https:${raw}` : raw;
  return /^https?:\/\/[^\s"'<>]+$/iu.test(url) ? url : "";
}

/** 목록 API 항목이 들고 있는 대표 이미지와 상품 주소. 키 이름은 후보로 찾고, 없으면 빈 값이다. */
export function extractListItemMedia(item: Record<string, unknown>): { imageUrl: string; productUrl: string } {
  const pick = (keys: readonly string[]) => keys.map((key) => httpUrl(item[key])).find(Boolean) || "";
  return { imageUrl: pick(IMAGE_KEYS), productUrl: pick(URL_KEYS) };
}
