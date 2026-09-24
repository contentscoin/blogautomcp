/**
 * 검색 수요 — 네이버 자동완성에서 실제 검색 질문을 모아 FAQ·질문형 소제목 후보로 쓴다.
 * 자동완성은 수요 신호일 뿐 사실 근거가 아니다. 답이 확인된 질문만 본문에 쓰도록 프롬프트에 명시한다.
 */

import { getNaverAutocomplete } from "./seo";
import { extractTravelProductFacts } from "./travel-content";

const PROMOTION_TOKENS = /^(?:\[.*\]|출발확정|여행핫딜|핫딜|특가|단독|최저가|노쇼핑|노옵션|노팁|시내숙박|직항|무료|증정|사은품|이벤트|할인|\d+%|공식|정품|신상|NEW|best|베스트)$/iu;

/** 상품명에서 자동완성 질의어를 만든다. 결정론적이며 최대 3개. */
export function buildSearchDemandQueries(kind: "SHOPPING" | "TRAVEL", productName: string, typeKeyword?: string | null): string[] {
  const tokens = productName
    .replace(/[()[\]{}|/,+]/gu, " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !PROMOTION_TOKENS.test(token) && !/^\d+(?:개|종|입|매|ml|g|kg|박|일)?$/iu.test(token));
  const queries: string[] = [];
  if (kind === "TRAVEL") {
    const destination = extractTravelProductFacts(productName).destinations[0] || tokens[0];
    if (destination) queries.push(`${destination} 여행`, `${destination} 여행 준비물`);
  } else {
    const brandAndType = tokens.slice(0, 2).join(" ");
    if (brandAndType) queries.push(brandAndType);
    if (typeKeyword && !brandAndType.includes(typeKeyword)) queries.push(typeKeyword);
    if (tokens[1]) queries.push(`${tokens[1]} 추천`);
  }
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 3);
}

type Fetcher = (query: string) => Promise<string[]>;

/** 질의어별 자동완성을 짧은 시간 안에 모은다. 실패·지연은 빈 결과로 처리한다. */
export async function collectSearchDemand(
  queries: readonly string[],
  options: { fetcher?: Fetcher; timeoutMs?: number; limit?: number } = {},
): Promise<string[]> {
  const fetcher = options.fetcher || getNaverAutocomplete;
  const timeoutMs = options.timeoutMs ?? 4_000;
  const results = await Promise.all(queries.map((query) => Promise.race([
    fetcher(query).catch(() => [] as string[]),
    new Promise<string[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
  ])));
  const seen = new Set<string>();
  const suggestions: string[] = [];
  results.forEach((items, index) => {
    const query = queries[index]!;
    for (const item of items) {
      const value = String(item).replace(/\s+/gu, " ").trim();
      if (!value || value === query || value.length > 40 || seen.has(value)) continue;
      seen.add(value);
      suggestions.push(value);
    }
  });
  return suggestions.slice(0, options.limit ?? 10);
}

export function formatSearchDemandForPrompt(kind: "SHOPPING" | "TRAVEL", suggestions: readonly string[]): string {
  if (suggestions.length === 0) return "";
  return [
    "[검색 수요: 네이버 자동완성]",
    `- 독자가 실제로 검색하는 표현: ${suggestions.join(" / ")}`,
    kind === "TRAVEL"
      ? "- 이 중 확인된 여행 정보로 답할 수 있는 것만 질문형 소제목·FAQ·꿀팁 주제로 씁니다."
      : "- 이 중 확인된 상품 정보로 답할 수 있는 것만 질문형 소제목·FAQ로 씁니다.",
    "- 자동완성은 수요 신호이며 사실 근거가 아닙니다. 다른 모델·브랜드 이름이 섞인 표현은 쓰지 않고, 핵심 검색어는 본문 다섯 번 이하로 씁니다.",
  ].join("\n");
}
