export interface ProductImageCandidate {
  url: string;
  index?: number;
  source?: "og" | "gallery" | "dom" | "stored";
  width?: number;
  height?: number;
  top?: number;
  alt?: string;
  className?: string;
  parentClassName?: string;
}

function keywordHaystack(rawUrl: string): string {
  try {
    return `${rawUrl} ${decodeURIComponent(rawUrl)}`.toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}

export function containsBadImageKeyword(url: string): boolean {
  const target = keywordHaystack(url);
  return /icon|logo|banner|sprite|coupon|benefit|guide|notice|delivery|event|ads?|detail|이벤트|배너|쿠폰|혜택|공지|배송|상세|상세페이지|기획전|증정|사은품/i.test(
    target
  );
}

export function normalizeCandidateImageUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  if (/^\/\//.test(trimmed)) {
    return normalizeCandidateImageUrl(`https:${trimmed}`);
  }

  // 상세/리뷰 업로드 이미지(checkout.phinf 등)는 ?type= 리사이즈를 지원하지 않아
  // ?type=w860을 붙이면 404가 난다. 원본 URL을 그대로 사용한다.
  if (/checkout\.phinf|blogfiles|postfiles|cafefiles/i.test(trimmed)) {
    return trimmed.replace(/\?type=.*/i, "");
  }

  // 여행커넥트 원본 서버는 쇼핑 이미지와 달리 ?type=w860 변환을 지원하지 않아 404를 반환한다.
  if (/pkgtour-phinf\.pstatic\.net/i.test(trimmed)) {
    return trimmed.replace(/\?type=.*/i, "");
  }

  if (/shop-phinf\.pstatic\.net|shopping-phinf\.pstatic\.net|phinf\.pstatic\.net/i.test(trimmed)) {
    return trimmed.replace(/\?type=.*/i, "?type=w860");
  }

  return trimmed;
}

export function isReviewImageUrl(rawUrl: string): boolean {
  const url = rawUrl.toLowerCase();
  return /checkout\.phinf|blogfiles|postfiles|cafefiles|review|reviews/.test(url);
}

export function isSalesPageProductImageUrl(rawUrl: string): boolean {
  const url = rawUrl.toLowerCase();
  if (isReviewImageUrl(url)) return false;
  return (
    url.includes("shop-phinf.pstatic.net") ||
    url.includes("shopping-phinf.pstatic.net") ||
    url.includes("pkgtour-phinf.pstatic.net") ||
    url.includes("sitem.ssgcdn.com") ||
    url.includes("cdn.011st.com")
  );
}

export function isTravelProductImageUrl(rawUrl: string): boolean {
  return rawUrl.toLowerCase().includes("pkgtour-phinf.pstatic.net");
}

export function isPreferredThumbnailImageUrl(rawUrl: string): boolean {
  const url = normalizeCandidateImageUrl(rawUrl).toLowerCase();
  return isSalesPageProductImageUrl(url) && !isReviewImageUrl(url) && !containsBadImageKeyword(url);
}

export function isCandidateProductImageUrl(rawUrl: string): boolean {
  const url = rawUrl.toLowerCase();
  if (!url) return false;
  const isImageDomain =
    url.includes("shop-phinf.pstatic.net") ||
    url.includes("shopping-phinf.pstatic.net") ||
    url.includes("phinf.pstatic.net") ||
    url.includes("sitem.ssgcdn.com") ||
    url.includes("cdn.011st.com");

  if (!isImageDomain) return false;
  if (containsBadImageKeyword(url)) return false;
  if (url.includes("1x1")) return false;
  return true;
}

export function isUsableBlogProductImageDimension(width: number, height: number): boolean {
  if (width < 360 || height < 360) return false;
  const ratio = width / height;
  return ratio >= 0.72 && ratio <= 1.55;
}

export function isRepresentativeProductImageDimension(width: number, height: number): boolean {
  if (width < 500 || height < 500) return false;
  const ratio = width / height;
  return ratio >= 0.78 && ratio <= 1.28;
}

export function isRepresentativeTravelImageDimension(width: number, height: number): boolean {
  if (width < 640 || height < 420) return false;
  const ratio = width / height;
  return ratio >= 0.72 && ratio <= 2.15;
}

export function scoreProductImageDimensions(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  const area = width * height;
  const ratio = width / height;
  let score = Math.min(220, area / 4000);
  if (isRepresentativeProductImageDimension(width, height)) score += 240;
  else if (isUsableBlogProductImageDimension(width, height)) score += 80;
  if (ratio > 1.8 || ratio < 0.58) score -= 360;
  return score;
}

export function scoreProductImageCandidate(candidate: ProductImageCandidate, fallbackIndex = 0): number {
  const normalizedUrl = normalizeCandidateImageUrl(candidate.url);
  const lower = normalizedUrl.toLowerCase();
  const index = candidate.index ?? fallbackIndex;
  let score = 0;

  if (!isCandidateProductImageUrl(lower)) return Number.NEGATIVE_INFINITY;

  if (isSalesPageProductImageUrl(lower)) score += 1200;
  if (isReviewImageUrl(lower)) score -= 900;
  if (candidate.source === "gallery") score += 520;
  if (candidate.source === "og") score += 280;
  if (candidate.source === "stored") score += 120;

  if (/\.(jpe?g)(\?|$)/i.test(lower)) score += 100;
  if (/\.png(\?|$)/i.test(lower)) score -= 80;
  if (/\?type=w\d+/i.test(lower)) score += 45;
  if (containsBadImageKeyword(lower)) score -= 500;

  const width = candidate.width ?? 0;
  const height = candidate.height ?? 0;
  if (width > 0 && height > 0) {
    const area = width * height;
    const ratio = width / height;
    score += Math.min(280, area / 2400);
    if (width >= 280 && height >= 280) score += 120;
    if (ratio >= 0.75 && ratio <= 1.35) score += 180;
    if (!isUsableBlogProductImageDimension(width, height)) score -= 420;
    score += scoreProductImageDimensions(width, height);
  }

  if (typeof candidate.top === "number" && Number.isFinite(candidate.top)) {
    if (candidate.top >= -80 && candidate.top <= 1400) {
      score += Math.max(0, 260 - Math.max(0, candidate.top) / 5);
    } else if (candidate.top > 2200) {
      score -= 220;
    }
  }

  const context = `${candidate.alt || ""} ${candidate.className || ""} ${
    candidate.parentClassName || ""
  }`.toLowerCase();
  if (/대표|main|product|goods|상품|prd|gallery|viewer|image/i.test(context)) score += 160;
  if (/review|후기|구매평|detail|상세|banner|event|coupon|benefit/i.test(context)) score -= 220;

  score += Math.max(0, 120 - index * 6);
  return score;
}

export function prioritizeImageCandidates(candidates: ProductImageCandidate[]): string[] {
  const bestByUrl = new Map<string, { url: string; score: number; index: number }>();

  candidates.forEach((candidate, fallbackIndex) => {
    const url = normalizeCandidateImageUrl(candidate.url);
    if (!url || !isCandidateProductImageUrl(url)) return;
    const score = scoreProductImageCandidate({ ...candidate, url }, fallbackIndex);
    const existing = bestByUrl.get(url);
    if (!existing || score > existing.score) {
      bestByUrl.set(url, { url, score, index: candidate.index ?? fallbackIndex });
    }
  });

  return Array.from(bestByUrl.values())
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.url);
}

export function prioritizeImageUrls(urls: string[]): string[] {
  return prioritizeImageCandidates(
    urls.map((url, index) => ({
      url,
      index,
      source: "stored",
    }))
  );
}
