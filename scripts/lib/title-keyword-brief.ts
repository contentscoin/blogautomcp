/** Source-grounded title inputs. This module neither measures demand nor calls a provider. */
import { extractTravelProductFacts } from "./travel-content";

export interface TitleKeywordBriefContext {
  kind?: "SHOPPING" | "TRAVEL";
  productName: string;
  primaryKeyword?: string | null;
  sourceDescription?: string | null;
  sourceFeatures?: readonly string[];
  bodySections?: readonly string[];
  searchSuggestions?: readonly string[];
  categoryKeywords?: readonly string[];
}

export interface TitleKeywordBrief {
  cleanIdentity: string;
  shortIdentity: string;
  categorySeed: string;
  primaryKeyword: string;
  searchExpressions: string[];
  decisionAxes: Array<{ label: string; keywords: string[]; evidence: string }>;
  destination?: string;
  duration?: string;
}

const PROMOTION = /특가|핫딜|쿠폰|증정|이벤트|할인|평점|리뷰\s*\d|별점|무료|최저가|최고|1위|베스트셀러|구매혜택|적립|출발확정|무조건출발|출발임박|마감임박|잡티|주름\s*개선|미백\s*효과|치료|완치|예방|특효|\d+\s*(?:주|일)\s*만/iu;
const PROMOTION_WORD = /^(?:출발확정|무조건출발|여행핫딜|핫딜|특가|단독|최저가|노쇼핑|노옵션|노팁|시내숙박|무료|증정|이벤트|할인|공식|정품|신상|NEW|평점|별점|추천|스테디셀러|베스트셀러|고성능|프리미엄|\d+(?:\.\d+)?(?:점|%|위)?)$/iu;
const CLAIM_QUERY = /후기|내돈내산|실사용|비교|장단점|효과|효능|개선|치료|완치|예방|특효|부작용|최저가|할인|평점|별점|\d+위|인생템/iu;
const CATEGORY_WORDS = [
  "음식물처리기", "로봇청소기", "공기청정기", "드라이기", "에어프라이어", "식기세척기", "밥솥", "청소기", "헤어드라이어",
  "바디로션", "바디워시", "선크림", "마스크팩", "클렌징", "캡슐세럼", "토너", "세럼", "앰플", "크림", "로션", "샴푸",
  "무선이어폰", "이어폰", "헤드폰", "스마트워치", "충전기", "노트북", "태블릿", "모니터", "스피커", "보조배터리",
  "러닝조끼", "반바지", "티셔츠", "원피스", "팬츠", "바지", "조끼", "셔츠", "신발", "운동화", "가방", "레깅스",
  "비데", "가습기", "제습기", "전기포트", "선풍기", "냉장고", "세탁기", "건조기", "면도기", "고데기",
  "한우", "밀키트", "커피", "유산균", "비타민", "영양제", "텀블러", "베개", "매트리스", "수납함",
] as const;

function compact(value: string): string { return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }

export function titleModelTokens(value: string): string[] {
  return [...value.matchAll(/\b[a-z][a-z\d-]*\d[a-z\d-]*\b/giu)].map((match) => match[0].toLocaleLowerCase());
}

/** Remove entire promotional clauses before tokenization; short brand brackets are retained. */
export function cleanTitleProductIdentity(productName: string): string {
  return productName
    .replace(/\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\}/gu, (whole, square: string, round: string, brace: string) => {
      const inner = (square ?? round ?? brace ?? "").trim();
      if (!inner || PROMOTION.test(inner) || /^\d+(?:\.\d+)?(?:점|%|위)?$/u.test(inner)) return " ";
      return square !== undefined && /^[\p{L}\s]{2,20}$/u.test(inner) ? whole : ` ${inner} `;
    })
    .replace(/\d+\s*(?:주|일)\s*(?:만에\s*)?(?:잡티|주름|피부|미백|탄력)[^|,]*?(?:개선|효과|완화)/gu, " ")
    .replace(/(?:평점|별점)\s*\d+(?:\.\d+)?(?:점)?|\d+\.\d+\s*(?:평점|별점|점)(?![\p{L}\p{N}])/gu, " ")
    .replace(/[|/,+]/gu, " ")
    .split(/\s+/u).filter((word) => word && !PROMOTION_WORD.test(word))
    .join(" ").trim();
}

/** Numeric ratings/quantities/grades are facts at most, never product identity anchors. */
export function titleIdentityTokens(value: string): string[] {
  return cleanTitleProductIdentity(value).replace(/[()[\]{}]/gu, " ").split(/\s+/u)
    .filter((word) => word.length >= 2 && /\p{L}/u.test(word)
      && !/^\d+(?:\.\d+)?\s*(?:등급|박|일|개|종|세트|ml|g|kg|l|GB|TB|cm|mm|인치)$/iu.test(word)
      && !PROMOTION.test(word));
}

function categorySeed(identity: string, extra: readonly string[]): string {
  // Homonyms/accessories are not the product family named inside the accessory title.
  if (/프린터.*토너|토너.*카트리지/u.test(identity)) return "토너 카트리지";
  if (/헤드폰\s*스탠드/u.test(identity)) return "헤드폰 스탠드";
  if (/크림색/u.test(identity)) return titleIdentityTokens(identity).find((word) => /커튼|의류|셔츠|바지|소파/u.test(word)) || "";
  if (/한우/u.test(identity) && /선물/u.test(identity) && /세트/u.test(identity)) return "한우 선물세트";
  return [...new Set([...CATEGORY_WORDS, ...extra])].filter((word) => word.length >= 2 && !CLAIM_QUERY.test(word) && identity.includes(word))
    .sort((a, b) => b.length - a.length)[0] || "";
}

const AXES: Array<{ label: string; keywords: string[]; pattern: RegExp }> = [
  { label: "구성", keywords: ["구성", "구성품"], pattern: /구성품|세트|단품|\d+\s*(?:종|개입)|구성/u },
  { label: "사이즈·핏", keywords: ["사이즈", "핏"], pattern: /사이즈|허리|기장|착용감|핏|남녀공용/u },
  { label: "소재", keywords: ["소재", "원단"], pattern: /소재|원단|메쉬|면\s*\d|폴리에스터/u },
  { label: "용량", keywords: ["용량"], pattern: /용량|\d+(?:\.\d+)?\s*(?:ml|mL|L|리터)/u },
  { label: "규격", keywords: ["규격", "크기"], pattern: /규격|크기|\d+\s*(?:cm|mm|인치)/u },
  { label: "연결·호환", keywords: ["연결", "호환"], pattern: /연결|호환|블루투스|USB|무선/u },
  { label: "관리", keywords: ["관리", "세척"], pattern: /세척|청소법|관리법|보관법/u },
  { label: "제형", keywords: ["제형"], pattern: /제형|로션|크림|젤\s*타입/u },
  { label: "원재료", keywords: ["원재료"], pattern: /원재료|부위|등심|안심|갈비/u },
];

export function buildTitleKeywordBrief(context: TitleKeywordBriefContext): TitleKeywordBrief {
  const cleanIdentity = cleanTitleProductIdentity(context.productName);
  const tokens = titleIdentityTokens(cleanIdentity);
  const sourceLines = [cleanIdentity, context.sourceDescription || "", ...(context.sourceFeatures || []), ...(context.bodySections || [])].filter(Boolean);
  const category = categorySeed(cleanIdentity, context.categoryKeywords || []);
  let destination: string | undefined;
  let duration: string | undefined;
  if (context.kind === "TRAVEL") {
    const travelFacts = extractTravelProductFacts(context.productName, context.sourceDescription || "", [...(context.sourceFeatures || [])]);
    // A source-present country wins a retailer token returned by legacy token parsing.
    // Parse original punctuation: bracketed hotel promotion/departure tails carry exclusion meaning.
    destination = context.productName.match(/튀르키예|터키/u)?.[0]
      || travelFacts.destinations
        .find((word) => !/월드체인|여행사|투어사|트래블|travel|tour|패키지/iu.test(word));
    duration = travelFacts.duration || undefined;
  }
  const rawPrimary = cleanTitleProductIdentity(context.primaryKeyword || "");
  const primaryValid = rawPrimary && !CLAIM_QUERY.test(rawPrimary) && titleIdentityTokens(rawPrimary).length > 0
    && (compact(cleanIdentity).includes(compact(rawPrimary)) || (destination && rawPrimary === destination));
  const primaryKeyword = context.kind === "TRAVEL" ? destination || "" : primaryValid ? rawPrimary : category || tokens[0] || "";
  const shortTokens = tokens.slice(0, 4);
  // Preserve source-present model codes even when marketing descriptors precede them.
  for (const token of tokens.filter((word) => /^(?=.*[a-z])(?=.*\d)[a-z\d-]{3,24}$/iu.test(word))) {
    if (!shortTokens.includes(token) && shortTokens.length < 6) shortTokens.push(token);
  }
  if (category && !shortTokens.some((word) => word.includes(category))) shortTokens.push(category);
  const shortIdentity = context.kind === "TRAVEL" ? [destination, duration].filter(Boolean).join(" ") : shortTokens.map((word) =>
    cleanIdentity.includes(`[${word}]`) ? `[${word}]` : word).join(" ");
  const allowedQueryWords = /^(?:추천|선택|구매|기준|정보|종류|고르기|사용법|사이즈|핏|용량|구성|소재|호환|연결|관리|세척)$/u;
  const sourceModels = new Set(titleModelTokens(cleanIdentity));
  const searchExpressions = [...new Set((context.searchSuggestions || []).map((value) => value.trim()))]
    .filter((value) => value.length >= 2 && value.length <= 60 && !CLAIM_QUERY.test(value)
      && titleModelTokens(value).every((model) => sourceModels.has(model))
      && (primaryKeyword && compact(value).includes(compact(primaryKeyword)))
      && value.replace(/[()[\]{}|/,+]/gu, " ").split(/\s+/u).every((word) =>
        allowedQueryWords.test(word) || compact(cleanIdentity).includes(compact(word))))
    .slice(0, 3);
  const decisionAxes = AXES.flatMap((axis) => {
    const evidence = sourceLines.find((line) => axis.pattern.test(line));
    return evidence ? [{ label: axis.label, keywords: axis.keywords, evidence: evidence.slice(0, 180) }] : [];
  }).slice(0, 4);
  return { cleanIdentity, shortIdentity, categorySeed: context.kind === "TRAVEL" ? destination || "" : category,
    primaryKeyword, searchExpressions, decisionAxes, ...(destination ? { destination } : {}), ...(duration ? { duration } : {}) };
}
