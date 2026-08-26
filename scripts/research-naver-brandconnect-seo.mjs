import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

const OUT_DIR = path.resolve("docs");
const STAMP = "2026-07-01";
const JSON_OUT = path.join(OUT_DIR, `naver-brandconnect-seo-research-${STAMP}.json`);
const CSV_OUT = path.join(OUT_DIR, `naver-brandconnect-seo-products-${STAMP}.csv`);
const MD_OUT = path.join(OUT_DIR, `naver-brandconnect-seo-research-${STAMP}.md`);

const CATEGORY_RULES = [
  {
    key: "home_appliance",
    label: "가전/청소/주방가전",
    keywords: [
      "청소기",
      "로봇청소기",
      "침구청소기",
      "냉장고",
      "냉동고",
      "세탁기",
      "건조기",
      "음식물처리기",
      "계란찜기",
      "전기포트",
      "살균기",
      "제습기",
      "히터",
      "선풍기",
      "공기청정기",
      "에어워셔",
      "드리미",
      "로보락",
      "디베아",
      "샤크",
      "보아르",
      "보만",
      "JMW",
    ],
  },
  {
    key: "digital_it",
    label: "디지털/IT/모바일",
    keywords: [
      "노트북",
      "이어폰",
      "헤드셋",
      "마우스",
      "키보드",
      "모니터",
      "충전기",
      "맥세이프",
      "카플레이",
      "블루투스",
      "와이파이",
      "eSIM",
      "태블릿",
      "스마트워치",
      "라벨프린터",
      "게이밍",
      "카메라",
    ],
  },
  {
    key: "beauty_body",
    label: "뷰티/헤어/바디",
    keywords: [
      "세럼",
      "크림",
      "토너",
      "선크림",
      "샴푸",
      "트리트먼트",
      "헤어",
      "바디로션",
      "알로에",
      "드라이기",
      "드라이어",
      "트리머",
      "제모",
      "브러시",
      "마스크팩",
      "클렌징",
      "립",
      "쿠션",
      "스킨",
      "로션",
      "바디워시",
      "화장품",
    ],
  },
  {
    key: "living_health",
    label: "생활/건강/욕실",
    keywords: [
      "방향제",
      "디퓨저",
      "탈취제",
      "매트",
      "칫솔",
      "수건",
      "주방",
      "욕실",
      "세제",
      "마스크",
      "보호대",
      "베개",
      "매트리스",
      "필터",
      "구강",
      "치약",
      "수납",
      "손목보호대",
      "분무기",
      "살림",
    ],
  },
  {
    key: "food_supplement",
    label: "식품/건강식품",
    keywords: [
      "커피",
      "김치",
      "단백질",
      "유산균",
      "비타민",
      "영양제",
      "닭가슴살",
      "간식",
      "홍삼",
      "오메가",
      "콜라겐",
      "즙",
      "쌀",
      "떡",
      "라면",
      "소스",
      "캡슐",
      "분말",
    ],
  },
  {
    key: "sports_leisure",
    label: "스포츠/레저/골프",
    keywords: [
      "골프",
      "팔토시",
      "러닝",
      "압박밴드",
      "배드민턴",
      "헬멧",
      "캠핑",
      "자전거",
      "등산",
      "운동",
      "스포츠",
      "레저",
      "낚시",
      "요가",
      "수영",
      "쿨맥스",
      "카프",
    ],
  },
  {
    key: "fashion_goods",
    label: "패션/잡화/의류",
    keywords: [
      "바지",
      "티셔츠",
      "상의",
      "가방",
      "신발",
      "슬리퍼",
      "선글라스",
      "모자",
      "양말",
      "벨트",
      "자켓",
      "원피스",
      "패션",
      "의류",
      "냉감",
      "작업복",
    ],
  },
  {
    key: "baby_pet",
    label: "육아/반려/가족",
    keywords: [
      "아기",
      "키즈",
      "유아",
      "출산",
      "육아",
      "임산부",
      "산모",
      "강아지",
      "고양이",
      "펫",
      "반려",
      "정수기",
      "기저귀",
      "장난감",
      "베이비",
    ],
  },
];

const STOP_TOKENS = new Set([
  "무료배송",
  "당일배송",
  "예약구매",
  "슈퍼적립",
  "넾다세일",
  "스테디셀러",
  "품질보증",
  "단일노즐",
  "본품",
  "세트",
  "1개",
  "2개",
  "3개",
  "4개",
  "5개",
  "옵션",
  "선택",
  "정품",
  "공식",
  "국내산",
  "대용량",
  "최신형",
  "고품질",
  "프리미엄",
]);

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function cleanHtml(value = "") {
  return value
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<mark>|<\/mark>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#xA0;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanProductName(name = "") {
  return name
    .replace(/\b(?:brand|smartstore)\.naver\.com\b/gi, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*(?:만|할인|적립|예약|행사|원)[^)]*\)/g, " ")
    .replace(/\b\d+\+\d+\b/g, " ")
    .replace(/\b\d+(?:ml|mL|ML|g|kg|GB|TB|L|개|팩|매|일)\b/g, " ")
    .replace(/[,+/｜|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTokens(text = "") {
  return cleanProductName(text)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !STOP_TOKENS.has(token))
    .filter((token) => token.length > 1 || /^[A-Z0-9]+$/.test(token));
}

function inferCategory(product) {
  const haystack = `${product.productName || ""} ${product.storeName || ""}`.toLowerCase();
  let best = null;
  for (const category of CATEGORY_RULES) {
    const matches = category.keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
    if (!matches.length) continue;
    if (!best || matches.length > best.matches.length) {
      best = { category, matches };
    }
  }
  return best;
}

function inferBrand(productName = "", storeName = "") {
  const cleanStore = cleanStoreName(storeName);
  const firstToken = getTokens(productName).find((token) => !/\.naver\.com$/i.test(token)) || "";
  return cleanStore || firstToken || "미확인";
}

function cleanStoreName(storeName = "") {
  if (!storeName || /\.naver\.com$/i.test(storeName.trim())) return "";
  return storeName
    .replace(/(공식|브랜드스토어|브랜드 스토어|공식몰|스토어|샵|판매점|대리점|파트너|코리아|한국|몰)$/g, "")
    .trim();
}

function makeSearchQuery(product) {
  return makeSearchQueries(product)[0];
}

function getCategoryTerms(productName = "") {
  const terms = [];
  for (const term of [
    "무선청소기",
    "로봇청소기",
    "침구청소기",
    "냉장고",
    "제습기",
    "선풍기",
    "노트북",
    "이어폰",
    "헤드셋",
    "드라이기",
    "고데기",
    "바디로션",
    "샴푸",
    "디퓨저",
    "방향제",
    "골프",
    "팔토시",
    "러닝",
    "강아지",
    "고양이",
    "유산균",
    "비타민",
    "영양제",
    "바지",
    "티셔츠",
    "구명조끼",
  ]) {
    if (productName.includes(term)) terms.push(term);
  }
  return [...new Set(terms)];
}

function makeSearchQueries(product) {
  const tokens = getTokens(product.productName || "");
  const brand = inferBrand(product.productName, product.storeName);
  const categoryTerms = getCategoryTerms(product.productName || "");
  const usefulTokens = tokens
    .filter((token) => !/^\d/.test(token))
    .filter((token) => !/(무료배송|최종|옵션|본품|세트|단품|제공)/.test(token));
  const modelTokens = tokens.filter((token) => /[A-Za-z0-9]/.test(token)).slice(0, 3);
  const chosen = [...new Set([brand, ...usefulTokens.slice(0, 6), ...categoryTerms])]
    .filter(Boolean)
    .filter((token) => token.length < 28);
  const exact = chosen.slice(0, 8).join(" ");
  const categoryTerm = categoryTerms[0] || usefulTokens.find((token) => token.length >= 3) || "";
  const compact = [...new Set([brand, ...modelTokens, categoryTerm])].filter(Boolean).join(" ");
  const shortProduct = [...new Set([brand, ...usefulTokens.slice(0, 3)])].filter(Boolean).join(" ");
  const categoryReview = [...new Set([brand, categoryTerm, "후기"])].filter(Boolean).join(" ");
  const shortReview = [...new Set([shortProduct, "후기"])].filter(Boolean).join(" ");
  return [...new Set([exact, compact, categoryReview, shortReview].filter((query) => query.length >= 3))];
}

function scoreProduct(product) {
  const name = product.productName || "";
  let score = 0;
  if (product.status === "READY") score += 8;
  if (product.storeName) score += 5;
  if (product.finalUrl) score += 3;
  if (/공식|브랜드|파트너|대리점/.test(product.storeName || "")) score += 3;
  if (/청소기|노트북|드라이기|이어폰|방향제|골프|강아지|유산균|비타민|바지|티셔츠/.test(name)) score += 4;
  score += Math.max(0, 10 - Math.abs(getTokens(name).length - 7));
  return score;
}

function buildProductPools(rows, perCategory = 45) {
  const seenStrict = new Set();
  const pools = new Map(CATEGORY_RULES.map((category) => [category.key, []]));

  for (const product of rows) {
    if (!product.productName || product.productName.length < 5) continue;
    const inferred = inferCategory(product);
    if (!inferred) continue;
    const brand = inferBrand(product.productName, product.storeName);
    const strictKey = `${inferred.category.key}:${brand}:${cleanProductName(product.productName)
      .replace(/\s+/g, "")
      .slice(0, 32)}`;
    if (seenStrict.has(strictKey)) continue;
    seenStrict.add(strictKey);
    pools.get(inferred.category.key).push({
      ...product,
      categoryKey: inferred.category.key,
      categoryLabel: inferred.category.label,
      categoryMatches: inferred.matches,
      inferredBrand: brand,
      searchQuery: makeSearchQuery(product),
      searchQueries: makeSearchQueries(product),
      selectionScore: scoreProduct(product),
    });
  }

  const selected = new Map();
  for (const category of CATEGORY_RULES) {
    const sorted = pools
      .get(category.key)
      .sort((a, b) => b.selectionScore - a.selectionScore || new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, perCategory);
    selected.set(category.key, sorted.map((item, index) => ({ ...item, poolRank: index + 1 })));
  }
  return selected;
}

async function fetchText(url, headers, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers,
      });
      const text = await res.text();
      if (res.ok && text.length > 1000) {
        return { ok: true, status: res.status, url: res.url, text };
      }
      if (attempt === retries) {
        return { ok: false, status: res.status, url: res.url, text: text.slice(0, 500) };
      }
    } catch (error) {
      if (attempt === retries) return { ok: false, error: error.message };
    }
    await sleep(500 + attempt * 800);
  }
}

function parseSearchResults(html) {
  const results = [];
  let idx = 0;
  while ((idx = html.indexOf('"contentHref":"https://blog.naver.com/', idx)) >= 0) {
    const segment = html.slice(Math.max(0, idx - 2500), Math.min(html.length, idx + 5000));
    const url = (segment.match(/"contentHref":"([^"]+)"/) || [])[1];
    if (!url || results.some((item) => item.url === url)) {
      idx += 20;
      continue;
    }
    const title =
      (segment.match(/"title":"((?:\\.|[^"])*)","titleEllipsis"/) ||
        segment.match(/"title":"((?:\\.|[^"])*)","titleHref"/) ||
        [])[1] || "";
    const content = (segment.match(/"content":"((?:\\.|[^"])*)"/) || [])[1] || "";
    const date = (segment.match(/"createdDate":"([^"]+)"/) || [])[1] || "";
    const imageCount = Number((segment.match(/"imageCount":(\d+)/) || [])[1] || 0);
    const thumbnail = (segment.match(/"imageSrc":"([^"]+)"/) || [])[1] || "";
    const profileTitle = (segment.match(/"sourceProfile":[\s\S]*?"title":"([^"]+)"/) || [])[1] || "";
    results.push({
      rank: results.length + 1,
      url,
      title: cleanHtml(title),
      snippet: cleanHtml(content),
      date,
      imageCount,
      thumbnail,
      blogName: cleanHtml(profileTitle),
    });
    idx += 20;
  }
  return results.slice(0, 3);
}

function toMobilePostUrl(url) {
  const match = url.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/);
  if (!match) return url.replace("https://blog.naver.com/", "https://m.blog.naver.com/");
  return `https://m.blog.naver.com/PostView.naver?blogId=${encodeURIComponent(match[1])}&logNo=${match[2]}`;
}

function parseBlogPost(html) {
  const ogTitle = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || "";
  const ogImage = (html.match(/<meta property="og:image" content="([^"]*)"/) || [])[1] || "";
  const category = cleanHtml((html.match(/<div class="blog_category">([\s\S]*?)<\/div>/) || [])[1] || "");
  const title = cleanHtml(
    (html.match(/<div class="se-module se-module-text se-title-text">([\s\S]*?)<\/div>/) || [])[1] || ogTitle,
  );
  const modules = [...html.matchAll(/<div class="se-module se-module-text[^"]*">([\s\S]*?)<\/div>/g)]
    .map((match) => cleanHtml(match[1]))
    .filter(Boolean);
  const textModules = modules.filter((text) => text !== title);
  const headings = textModules
    .filter((text) => {
      const compact = text.replace(/\s+/g, "");
      return compact.length >= 6 && compact.length <= 42 && !/[.!?。]$/.test(text);
    })
    .slice(0, 8);
  const body = textModules.join("\n");
  const imageUrls = new Set(
    [...html.matchAll(/data-linkdata='[^']*"src"\s*:\s*"([^"]+)"/g)]
      .map((match) => match[1])
      .filter(Boolean),
  );
  if (!imageUrls.size) {
    for (const match of html.matchAll(/<img[^>]+(?:src|data-lazy-src)="([^"]+)"/g)) {
      const url = match[1];
      if (/mblogthumb|blogthumb|blogfiles|postfiles/.test(url)) imageUrls.add(url);
    }
  }
  const paragraphs = textModules.filter((text) => text.length >= 20);
  return {
    title,
    ogTitle: cleanHtml(ogTitle),
    ogImage,
    category,
    textModuleCount: textModules.length,
    paragraphCount: paragraphs.length,
    bodyCharCount: body.length,
    imageCount: imageUrls.size,
    headings,
    keywordDensityHint: keywordDensity(body),
    structureType: inferStructure(textModules, headings, imageUrls.size),
    tone: inferTone(body, title),
  };
}

function keywordDensity(text) {
  const normalized = text.replace(/\s+/g, " ");
  const keywords = [
    "추천",
    "후기",
    "내돈내산",
    "장점",
    "단점",
    "비교",
    "사용",
    "구성",
    "가격",
    "가성비",
    "원룸",
    "성분",
    "효과",
    "선물",
    "구매",
  ];
  return Object.fromEntries(
    keywords
      .map((keyword) => [keyword, (normalized.match(new RegExp(keyword, "g")) || []).length])
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
  );
}

function inferTone(body, title) {
  const text = `${title}\n${body}`;
  const markers = [];
  if (/내돈내산|직접|써보|사용해보|구매/.test(text)) markers.push("체험형");
  if (/추천|가성비|좋|만족|괜찮/.test(text)) markers.push("추천형");
  if (/방법|분해|관리|사용법|청소방법|정리/.test(text)) markers.push("정보형");
  if (/장점|단점|비교|스펙|성능/.test(text)) markers.push("비교형");
  if (/ㅋㅋ|ㅎㅎ|용|랍니다|했어요|네요/.test(text)) markers.push("친근체");
  return markers.slice(0, 4);
}

function inferStructure(textModules, headings, imageCount) {
  const text = textModules.join(" ");
  const signals = [];
  if (/한 줄|결론|요약|마무리/.test(text)) signals.push("결론/요약");
  if (/구성품|언박싱|포장|배송/.test(text)) signals.push("언박싱");
  if (/사용|써보|착용|발라|먹어|청소/.test(text)) signals.push("사용 장면");
  if (/장점|단점|아쉬/.test(text)) signals.push("장단점");
  if (/추천|이런 분|잘 맞/.test(text)) signals.push("추천 대상");
  if (/가격|구매|링크|naver\.me|스토어/.test(text)) signals.push("구매 유도");
  if (headings.length >= 3) signals.push("소제목 반복");
  if (imageCount >= 8) signals.push("사진 다량");
  return signals.slice(0, 6);
}

function analyzeTitle(title, product) {
  const tokens = getTokens(product.productName);
  const titleNoSpace = title.replace(/\s+/g, "");
  const matched = tokens.filter((token) => titleNoSpace.includes(token.replace(/\s+/g, ""))).slice(0, 8);
  return {
    length: title.length,
    matchedTokens: matched,
    hasReviewWord: /후기|리뷰|내돈내산|추천|장단점|총정리|사용/.test(title),
    startsWithBrand: matched.length > 0 && titleNoSpace.indexOf(matched[0].replace(/\s+/g, "")) <= 8,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withConcurrency(items, limit, mapper) {
  const output = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      output[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return output;
}

async function findSearchResults(product) {
  const queries = product.searchQueries?.length ? product.searchQueries : [product.searchQuery];
  let best = null;
  for (const query of queries) {
    const queryUrl = `https://search.naver.com/search.naver?where=post&sm=tab_jum&query=${encodeURIComponent(query)}`;
    const search = await fetchText(queryUrl, {
      "User-Agent": DESKTOP_UA,
      "Accept-Language": "ko-KR,ko;q=0.9",
      Referer: "https://www.naver.com/",
    });
    const searchResults = search.ok ? parseSearchResults(search.text) : [];
    const candidate = {
      query,
      search: {
        ok: search.ok,
        status: search.status || null,
        resultCount: searchResults.length,
      },
      searchResults,
    };
    if (!best || candidate.searchResults.length > best.searchResults.length) best = candidate;
    if (searchResults.length >= 3) return candidate;
    await sleep(250);
  }
  return best || { query: product.searchQuery, search: { ok: false, status: null, resultCount: 0 }, searchResults: [] };
}

async function enrichProduct(product, index) {
  const found = await findSearchResults(product);
  const searchResults = found.searchResults;
  await sleep(300);
  const posts = await withConcurrency(searchResults, 2, async (result) => {
    const post = await fetchText(toMobilePostUrl(result.url), {
      "User-Agent": MOBILE_UA,
      "Accept-Language": "ko-KR,ko;q=0.9",
      Referer: "https://m.naver.com/",
    });
    if (!post.ok) return { ...result, postFetchOk: false, postStatus: post.status || null };
    const parsed = parseBlogPost(post.text);
    return {
      ...result,
      postFetchOk: true,
      post: parsed,
      titleAnalysis: analyzeTitle(parsed.title || result.title, product),
    };
  });
  console.log(
    `[${index + 1}] ${product.categoryLabel} | ${product.searchQuery} | results=${searchResults.length} | posts=${
      posts.filter((post) => post.postFetchOk).length
    }`,
  );
  return {
    product: {
      id: product.id,
      categoryKey: product.categoryKey,
      categoryLabel: product.categoryLabel,
      categoryRank: product.categoryRank,
      poolRank: product.poolRank,
      productName: product.productName,
      storeName: cleanStoreName(product.storeName) || product.storeName,
      inferredBrand: product.inferredBrand,
      brandLink: product.url,
      finalUrl: product.finalUrl,
      status: product.status,
      searchQuery: found.query,
      searchQueries: product.searchQueries,
      categoryMatches: product.categoryMatches,
    },
    search: found.search,
    topPosts: posts,
  };
}

function aggregate(research) {
  const allPosts = research.flatMap((item) => item.topPosts.map((post) => ({ ...post, product: item.product })));
  const fetched = allPosts.filter((post) => post.postFetchOk && post.post);
  const titleWords = [
    "후기",
    "추천",
    "내돈내산",
    "장단점",
    "총정리",
    "사용",
    "비교",
    "방법",
    "가성비",
    "원룸",
  ];
  const titleWordCounts = Object.fromEntries(
    titleWords.map((word) => [word, fetched.filter((post) => (post.post.title || post.title).includes(word)).length]),
  );
  const imageCounts = fetched.map((post) => post.post.imageCount || post.imageCount || 0).sort((a, b) => a - b);
  const charCounts = fetched.map((post) => post.post.bodyCharCount || 0).sort((a, b) => a - b);
  const structures = {};
  const tones = {};
  for (const post of fetched) {
    for (const item of post.post.structureType || []) structures[item] = (structures[item] || 0) + 1;
    for (const item of post.post.tone || []) tones[item] = (tones[item] || 0) + 1;
  }
  return {
    productCount: research.length,
    postCardCount: allPosts.length,
    fetchedPostCount: fetched.length,
    titleWordCounts,
    medianImageCount: percentile(imageCounts, 0.5),
    p75ImageCount: percentile(imageCounts, 0.75),
    medianBodyCharCount: percentile(charCounts, 0.5),
    p75BodyCharCount: percentile(charCounts, 0.75),
    structures: sortObject(structures),
    tones: sortObject(tones),
    categories: Object.fromEntries(
      CATEGORY_RULES.map((category) => {
        const categoryItems = research.filter((item) => item.product.categoryKey === category.key);
        const categoryPosts = categoryItems.flatMap((item) => item.topPosts).filter((post) => post.postFetchOk && post.post);
        return [
          category.label,
          {
            products: categoryItems.length,
            fetchedPosts: categoryPosts.length,
            medianImages: percentile(
              categoryPosts.map((post) => post.post.imageCount || 0).sort((a, b) => a - b),
              0.5,
            ),
            commonStructures: topCounts(categoryPosts.flatMap((post) => post.post.structureType || []), 5),
            commonTones: topCounts(categoryPosts.flatMap((post) => post.post.tone || []), 5),
          },
        ];
      }),
    ),
    brands: topCounts(research.map((item) => item.product.inferredBrand), 30),
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function sortObject(obj) {
  return Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
}

function topCounts(values, limit = 10) {
  const counts = {};
  for (const value of values.filter(Boolean)) counts[value] = (counts[value] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function makeCsv(research) {
  const rows = [
    [
      "category",
      "category_rank",
      "product_name",
      "brand_or_store",
      "search_query",
      "top_rank",
      "top_title",
      "top_url",
      "blog_name",
      "date",
      "search_image_count",
      "post_image_count",
      "post_chars",
      "headings",
      "tone",
      "structure",
    ],
  ];
  for (const item of research) {
    for (const post of item.topPosts) {
      rows.push([
        item.product.categoryLabel,
        item.product.categoryRank,
        item.product.productName,
        item.product.storeName || item.product.inferredBrand,
        item.product.searchQuery,
        post.rank,
        post.post?.title || post.title,
        post.url,
        post.blogName,
        post.date,
        post.imageCount,
        post.post?.imageCount ?? "",
        post.post?.bodyCharCount ?? "",
        (post.post?.headings || []).join(" / "),
        (post.post?.tone || []).join(", "),
        (post.post?.structureType || []).join(", "),
      ]);
    }
  }
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function makeMarkdown(research, summary) {
  const lines = [];
  lines.push("# 네이버 블로그 브랜드커넥트 SEO 상위노출 리서치");
  lines.push("");
  lines.push(`- 수집일: ${STAMP}`);
  lines.push(`- 대상: 로컬 BrandLink 후보 ${summary.productCount}개(8개 카테고리 x 10개)`);
  lines.push(`- 네이버 블로그 탭 상위 카드: ${summary.postCardCount}개, 모바일 본문 확인: ${summary.fetchedPostCount}개`);
  lines.push("- 방법: `search.naver.com?where=post` PC 블로그 탭 결과를 수집하고, `m.blog.naver.com/PostView.naver`로 본문 메트릭을 확인");
  lines.push("");
  lines.push("## 핵심 SEO 로직 가설");
  lines.push("");
  lines.push("1. 제목은 `브랜드/모델명 + 카테고리 키워드 + 후기성 의도어` 조합이 가장 반복된다.");
  lines.push("2. 본문 초반 300자 안에 제품명, 카테고리명, 사용 맥락을 다시 넣은 글이 많이 노출된다.");
  lines.push("3. 사진은 검색 카드 기준 4~17장, 본문 기준 중앙값 " + summary.medianImageCount + "장 수준이다. 제품 실사용 컷과 과정 컷이 함께 있는 글이 강하다.");
  lines.push("4. 소제목은 `구성/사용법/장점/추천 대상/마무리`처럼 짧은 명사형 또는 질문형이 반복된다.");
  lines.push("5. 검색 썸네일은 첫 이미지 또는 대표 이미지가 정사각형에 가깝고, 제품 실물 또는 사용 장면이 분명한 경우가 많다.");
  lines.push("6. 문체는 친근한 체험형이 기본이고, 고관여 제품은 비교형/정보형 문단을 섞는다.");
  lines.push("");
  lines.push("## 전체 패턴");
  lines.push("");
  lines.push(`- 제목 키워드 빈도: ${Object.entries(summary.titleWordCounts)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ")}`);
  lines.push(`- 본문 글자 수 중앙값: ${summary.medianBodyCharCount}, 상위 75% 기준: ${summary.p75BodyCharCount}`);
  lines.push(`- 사진 수 중앙값: ${summary.medianImageCount}, 상위 75% 기준: ${summary.p75ImageCount}`);
  lines.push(`- 구조 신호: ${summary.structures.map ? "" : Object.entries(summary.structures).map(([key, value]) => `${key} ${value}`).join(", ")}`);
  lines.push(`- 문체 신호: ${Object.entries(summary.tones).map(([key, value]) => `${key} ${value}`).join(", ")}`);
  lines.push("");
  lines.push("## 카테고리별 요약");
  lines.push("");
  lines.push("| 카테고리 | 상품 수 | 본문 확인 | 사진 중앙값 | 많이 보인 구조 | 많이 보인 문체 |");
  lines.push("|---|---:|---:|---:|---|---|");
  for (const [category, stats] of Object.entries(summary.categories)) {
    lines.push(
      `| ${category} | ${stats.products} | ${stats.fetchedPosts} | ${stats.medianImages} | ${stats.commonStructures
        .map((item) => `${item.name}(${item.count})`)
        .join(", ")} | ${stats.commonTones.map((item) => `${item.name}(${item.count})`).join(", ")} |`,
    );
  }
  lines.push("");
  lines.push("## 카테고리별 선정 상품과 상위 3개");
  for (const category of CATEGORY_RULES) {
    const items = research.filter((item) => item.product.categoryKey === category.key);
    lines.push("");
    lines.push(`### ${category.label}`);
    lines.push("");
    for (const item of items) {
      lines.push(
        `#### ${item.product.categoryRank}. ${item.product.productName} (${item.product.storeName || item.product.inferredBrand})`,
      );
      lines.push(`- 검색어: ${item.product.searchQuery}`);
      if (!item.topPosts.length) {
        lines.push("- 상위 블로그 결과: 수집 실패 또는 결과 없음");
        continue;
      }
      for (const post of item.topPosts) {
        const postTitle = post.post?.title || post.title || "(제목 없음)";
        const headingPreview = (post.post?.headings || []).slice(0, 4).join(" / ") || "소제목 감지 적음";
        const metrics = post.post
          ? `본문 ${post.post.bodyCharCount}자, 이미지 ${post.post.imageCount}장, ${post.post.tone.join("/") || "문체 미분류"}`
          : "본문 확인 실패";
        lines.push(`- ${post.rank}위: ${postTitle}`);
        lines.push(`  - URL: ${post.url}`);
        lines.push(`  - 지표: ${metrics}`);
        lines.push(`  - 소제목/구성 힌트: ${headingPreview}`);
      }
    }
  }
  lines.push("");
  lines.push("## 브랜드/스토어 리서치 메모");
  lines.push("");
  lines.push("브랜드명은 상품명 첫 토큰과 스토어명을 함께 보고 추정했다. `공식`, `브랜드스토어`, `공식몰`, `파트너`, `대리점` 표기가 있으면 신뢰 신호로 분류했다.");
  lines.push("");
  lines.push("| 브랜드/스토어 | 등장 수 | 리서치 메모 |");
  lines.push("|---|---:|---|");
  for (const brand of summary.brands.slice(0, 20)) {
    const examples = research
      .filter((item) => item.product.inferredBrand === brand.name)
      .slice(0, 2)
      .map((item) => item.product.productName)
      .join(" / ");
    lines.push(`| ${brand.name} | ${brand.count} | 대표 후보: ${examples} |`);
  }
  lines.push("");
  lines.push("## 실행용 SEO 템플릿");
  lines.push("");
  lines.push("- 제목: `[브랜드/모델명] [핵심 카테고리] 후기, [사용 맥락/문제 해결]까지 확인`");
  lines.push("- 첫 문단: 제품명 전체 1회, 짧은 카테고리 키워드 1회, 사용 상황 1회를 250~350자 안에 배치");
  lines.push("- 소제목 순서: 첫인상/구성 → 실제 사용 장면 → 장점 3개 → 아쉬운 점 → 추천 대상 → 구매 전 체크");
  lines.push("- 사진: 대표 썸네일 1장 + 언박싱/구성 2~3장 + 사용 장면 5장 이상 + 디테일/비교 2장 이상");
  lines.push("- 썸네일: 제품 실물 중심, 제품명 또는 카테고리 의도어가 크게 보이는 정사각형/세로형 첫 이미지");
  lines.push("- 반복 키워드: 정확한 제품명은 과밀 반복보다 제목/첫문단/중간 소제목/마무리에 자연스럽게 분산");
  lines.push("");
  lines.push("## 산출 파일");
  lines.push("");
  lines.push(`- JSON: ${JSON_OUT}`);
  lines.push(`- CSV: ${CSV_OUT}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const rows = await prisma.brandLink.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      productName: true,
      storeName: true,
      finalUrl: true,
      url: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const pools = buildProductPools(rows, 60);
  const research = [];
  let counter = 0;
  for (const category of CATEGORY_RULES) {
    const categoryResults = [];
    const pool = pools.get(category.key) || [];
    console.log(`Scanning ${category.label}: ${pool.length} candidates`);
    for (const candidate of pool) {
      const enriched = await enrichProduct({ ...candidate, categoryRank: categoryResults.length + 1 }, counter);
      counter += 1;
      if (enriched.topPosts.length >= 3) {
        enriched.product.categoryRank = categoryResults.length + 1;
        categoryResults.push(enriched);
      }
      if (categoryResults.length >= 10) break;
    }
    if (categoryResults.length < 10) {
      console.warn(`${category.label}: only ${categoryResults.length} products had 3 blog results`);
    }
    research.push(...categoryResults);
  }
  console.log(`Selected ${research.length} products with search evidence`);
  const summary = aggregate(research);
  await fs.writeFile(JSON_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), summary, research }, null, 2), "utf8");
  await fs.writeFile(CSV_OUT, makeCsv(research), "utf8");
  await fs.writeFile(MD_OUT, makeMarkdown(research, summary), "utf8");
  console.log(JSON.stringify({ summary, JSON_OUT, CSV_OUT, MD_OUT }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
