/** Conservative, deterministic extraction of seller facts. Never runs a model.
 * Callers must keep the original seller title/description or OCR image alongside
 * these features in the source snapshot; generated prose is not an input.
 */
const clean = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();

const LABEL_ALIASES: Record<string, string> = {
  "원재료명": "원재료", "원재료명및함량": "원재료", "원재료및함량": "원재료",
  "보관및취급방법": "보관조건", "보관및취급시주의사항": "보관조건", "보관방법": "보관조건",
  "식품의유형": "식품유형", "식품유형": "식품유형", "부위": "부위",
  "포장단위별내용물의용량(중량),수량": "구성", "포장단위별용량(중량),수량": "구성",
  "내용량": "중량", "내용물의중량": "중량", "총내용량": "중량",
  "알레르기유발물질": "알레르기", "영양성분": "영양정보", "영양정보": "영양정보",
  "에너지소비효율등급": "효율등급", "에너지효율등급": "효율등급",
  "정격전압": "전압", "정격전압,소비전력": "전원규격", "정격전압및소비전력": "전원규격",
  "배터리용량": "배터리", "흡입력": "흡입력", "흡입압력": "흡입력",
};
const LABELS = new Set(("용량 규격 표시규격 크기 사이즈 가로 세로 높이 폭 깊이 두께 지름 직경 무게 중량 소재 재질 원재료 성분 함량 구성품 구성 수량 개수 색상 전압 정격 소비전력 출력 배터리 충전시간 사용시간 작동시간 풍량 온도 모드 단계 회전각도 방수 방진 호환 원산지 제조국 보관조건 유통기한 소비기한 알레르기 세탁방법 세척방법 기능 식품유형 부위 영양정보 효율등급 전원규격 흡입력").split(" "));

export function normalizeProductFactLabel(label: string): string {
  const key = clean(label).replace(/\s+/gu, "");
  return LABEL_ALIASES[key] || (LABELS.has(key) ? key : "");
}

export function isUnusableProductFactValue(value: string): boolean {
  const text = clean(value);
  return !text || text.length > 220 || /^[-:：|/\s]+$/u.test(text) ||
    /(?:상세\s*(?:페이지|설명|정보|참조)|상품\s*(?:페이지|상세)|별도\s*문의|판매자\s*문의|직접\s*문의|옵션\s*(?:참조|선택)|제품별\s*상이|상품별\s*상이|해당\s*없음|미기재|확인\s*불가)/u.test(text) ||
    /(?:할인|쿠폰|적립|프로모션|최저가|무료배송|평점|리뷰|후기|증정|이벤트|광고|추천|프리미엄|최고의|베스트|프롬프트|이전\s*지시|ignore\s+.*instructions)/iu.test(text);
}

/** Normalize aliases before grading. A typed label without an actual value is not a fact. */
export function normalizeTypedProductFact(value: string): string {
  const text = clean(value);
  const separator = text.search(/[:：]/u);
  if (separator <= 0) return "";
  const label = normalizeProductFactLabel(text.slice(0, separator));
  const fact = text.slice(separator + 1).trim();
  if (!label || isUnusableProductFactValue(fact)) return "";
  // Typed DOM/OCR facts pass through the same polarity guard as title facts.
  // A trusted-looking label must not turn "기능: 자동세척 미지원" into evidence.
  if (label === "기능" && (hasPrefixFunctionNegation(fact) || hasSuffixFunctionNegation(fact))) return "";
  return `${label}: ${fact}`;
}

// One unit policy for feature recognition and evidence scoring. Word boundaries
// prevent a model number (e.g. 16LCD) being treated as a measured capacity.
export const PRODUCT_MEASUREMENT_PATTERN = /\d[\d,.]*\s*(?:mAh|rpm|mL|L|mm|cm|kg|g|kW|mW|W|kPa|Pa|V|m|시간|분|단|도|개|엽|%)(?![a-z])/iu;

const FOOD_NAME_PATTERN = /(?:소갈비살|갈비살|늑간살|소갈비|LA\s*갈비|소곱창|통대창|곱창|막창|대창|특양|소고기|돼지고기|닭고기|김치|밀키트|볶음밥|냉동만두)/iu;
const APPLIANCE_PATTERN = /(?:청소기|에어프라이어|오븐|그릴|냄비|프라이팬|보관함|용기|가습기|건조기|선풍기|서큘레이터|써큘레이터|드라이기|드라이어|고데기)/u;
const UNSUPPORTED_CONTEXT = /(?:추측|예상|가능할|같아요|할까요|\?)/u;
const UNSUPPORTED_FOOD_CONTEXT = /(?:미포함|불포함|제외|아니[가-힣]*|아닌|아닙[가-힣]*|없(?:음|는|다)|옵션|선택|예정|미확인|여부)/u;

/** Exact functional phrases only; preserve their spelling, never infer a model's specs. */
const FUNCTION_PATTERNS = [
  /자동\s*온수\s*세척/gu, /자동\s*세척/gu, /열풍\s*건조/gu,
  /엉킴\s*방지\s*(?:시스템)?/gu, /모서리\s*밀착\s*청소\s*브러시/gu,
  /습건식\s*동시\s*청소/gu, /물자국\s*방지/gu,
  /건\s*[·ㆍ.]\s*습식\s*동시\s*청소/gu, /건조\s*기능/gu,
  /\d{2,3}\s*도\s*플랫\s*핸들/gu,
  /(?:분리형|분리식)\s*(?:트레이|필터|물통|탱크|커버|칸막이)/gu,
  /(?:온도|풍량|풍속|높이|각도)\s*조절/gu,
  /로티세리/gu, /BLDC/giu, /살균/gu, /냉온풍/gu, /자동\s*센서/gu, /가열/gu,
  /무선/gu,
];

interface ExplicitFunctionMatch { start: number; end: number; value: string }

function collectFunctionMatches(line: string): ExplicitFunctionMatch[] {
  const found = FUNCTION_PATTERNS.flatMap(pattern => [...line.matchAll(pattern)].map(match => ({
    start: match.index ?? -1,
    end: (match.index ?? -1) + match[0].length,
    value: match[0],
  }))).filter(match => match.start >= 0)
    .sort((left, right) => left.start - right.start || right.value.length - left.value.length);
  const selected: ExplicitFunctionMatch[] = [];
  for (const match of found) {
    if (!selected.some(existing => match.start < existing.end && match.end > existing.start)) selected.push(match);
  }
  return selected;
}

function clauseBounds(line: string, start: number, end: number): { start: number; end: number } {
  const delimiters = [",", ";", "|", "/", "·", "\n"];
  const prior = delimiters.map(delimiter => line.lastIndexOf(delimiter, start - 1));
  const following = delimiters.map(delimiter => line.indexOf(delimiter, end)).filter(index => index >= 0);
  return { start: Math.max(-1, ...prior) + 1, end: following.length ? Math.min(...following) : line.length };
}

function hasPrefixFunctionNegation(value: string): boolean {
  return /(?:^|\s|[:(])(?:(?:미|비|불)\s*(?:지원|적용|탑재|포함|제공|구현|사용|대응)[가-힣]*|(?:지원|기능|모드)\s*안\s*(?:됨|되|함|하)[가-힣]*|아님|아닌|아니[가-힣]*|아닙[가-힣]*|않[가-힣]*|못[가-힣]*|NO|X|×)(?=$|\s|[:)])/iu.test(value);
}

function hasSuffixFunctionNegation(value: string): boolean {
  return /(?:미|비|불)\s*(?:지원|적용|탑재|포함|제공|구현|사용|대응)[가-힣]*/u.test(value)
    || /(?:아님|아닌|아니|아닙|않|못|무관|해당하지|미확인|미정|여부|대신|대비|보다|유사|같|처럼|흉내|가능성|예정|계획|옵션|선택|제외|불가|불필요|없)[가-힣]*/u.test(value)
    || /안\s*(?:됨|되|함|하)[가-힣]*/u.test(value)
    || /(?:지원|기능|모드)\s*[:：]?\s*(?:안\s*(?:됨|함|되)|X|×|NO)(?=$|\s|[,.|/])/iu.test(value)
    || /(?:^|[:：])\s*(?:X|×|NO)(?=$|\s|[,.|/])/iu.test(value);
}

/**
 * A trailing predicate can govern more than one coordinated feature. Korean
 * seller copy commonly writes "자동세척과 건조기능을 지원하지 않습니다" or
 * "자동세척, 건조기능 없음". The local suffix check sees the denial only on
 * the final feature, so walk a coordination-only chain and apply that denial
 * to every unqualified feature in the chain. An explicit predicate such as
 * "자동세척 지원, 건조기능 미지원" breaks the chain and remains accepted.
 */
function hasCoordinatedTrailingFunctionNegation(
  line: string,
  matches: ExplicitFunctionMatch[],
  index: number,
): boolean {
  let current = matches[index];
  for (let nextIndex = index + 1; nextIndex < matches.length; nextIndex += 1) {
    const next = matches[nextIndex];
    const bridge = line.slice(current.end, next.start);
    if (!/^(?:(?:과|와|및|하고|그리고|또는)|[\s,;|/·ㆍ&+])+$/u.test(bridge)) return false;
    const nextBounds = clauseBounds(line, next.start, next.end);
    if (hasSuffixFunctionNegation(line.slice(next.end, nextBounds.end))) return true;
    current = next;
  }
  return false;
}

function hasUnsupportedFunctionContext(
  line: string,
  match: ExplicitFunctionMatch,
  previous: ExplicitFunctionMatch | undefined,
  next: ExplicitFunctionMatch | undefined,
): boolean {
  const { start, end, value: matched } = match;
  const bounds = clauseBounds(line, start, end);
  const previousInClause = previous && previous.start >= bounds.start;
  const nextInClause = next && next.start < bounds.end;
  const before = line.slice(Math.max(bounds.start, start - 12), start);
  const prefix = previousInClause ? "" : line.slice(bounds.start, start);
  const after = line.slice(end, nextInClause ? next!.start : bounds.end);
  const left = line[start - 1] || "";
  const right = line[end] || "";
  // Hangul has no JavaScript word boundary. Reject negated prefixes and words
  // that merely contain the phrase (비무선, 살균력), as well as comparison or
  // denial suffixes (무선처럼, 무선 기능 아님).
  if (/(?:비|미|불|非)\s*$/u.test(before)) return true;
  if (/^\s*(?:처럼|같은|급|력|효과|효능|느낌|스타일)/u.test(after)) return true;
  if (prefix && hasPrefixFunctionNegation(prefix)) return true;
  if (hasSuffixFunctionNegation(after)) return true;
  // Latin feature tokens such as BLDC must be standalone seller terms.
  if (/^[a-z0-9]$/iu.test(matched[0]) && (/^[a-z0-9]$/iu.test(left) || /^[a-z0-9]$/iu.test(right))) return true;
  if (/^[a-z0-9]/iu.test(matched) && /^[-_.]\s*\d/u.test(after)) return true;
  return false;
}

/** A concrete functional pair carries useful detail without requiring a number.
 * Exact phrase validation excludes generic typed '기능: 편리함' assertions. */
export function explicitProductFunctionKey(feature: string): string {
  const fact = normalizeTypedProductFact(feature);
  if (!fact.startsWith("기능: ")) return "";
  const value = fact.slice(4).trim();
  const recognized = FUNCTION_PATTERNS.some(pattern => {
    const match = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(value);
    return match?.[0] === value;
  });
  if (!recognized) return "";
  const key = value.replace(/\s+/gu, "").toLowerCase();
  if (/자동(?:온수)?세척/u.test(key)) return "자동세척";
  if (/열풍건조|건조기능/u.test(key)) return "건조";
  return key;
}

export function extractExplicitProductFacts(text: string, source: "title" | "description" | "ocr"): string[] {
  if (!text || text.length > 30_000 || /(?:ignore\s+.*instructions|이전\s*지시.{0,10}무시|<\|(?:system|assistant))/iu.test(text)) return [];
  // Promotions in brackets are not the product identity. Outside those brackets
  // a promotional/OCR review line is discarded whole, including its numbers.
  const input = text.replace(/\[[^\]]*(?:프로모션|이벤트|특가|할인)[^\]]*\]/gu, " ");
  const lines = source === "title" ? [clean(input)] : input.split(/[\r\n]+/u).map(clean);
  const facts: string[] = [];
  for (const line of lines) {
    if (!line || line.length > 500 || isUnusableProductFactValue(line) || UNSUPPORTED_CONTEXT.test(line)) continue;
    const typed = normalizeTypedProductFact(line);
    if (typed) { facts.push(typed); continue; }
    const food = !APPLIANCE_PATTERN.test(line) && !UNSUPPORTED_FOOD_CONTEXT.test(line) && line.match(FOOD_NAME_PATTERN)?.[0];
    const weights = [...line.matchAll(/(?<![\d.])\d[\d,.]*\s*(?:kg|g)(?![a-z])/giu)].map(match => match[0]);
    if (food && weights.length === 1) {
      // The first food identity in a title does not establish every ingredient
      // in a keyword list. In particular never claim all listed cuts are included.
      facts.push(`식품유형: ${food}`, `중량: ${weights[0]}`);
      const processing = line.match(/(?:비양념|무양념|양념|초벌)/u)?.[0];
      if (processing) facts.push(`구성: ${processing}`);
    }
    if (source === "title" && APPLIANCE_PATTERN.test(line)) {
      // Keep a bare seller-listed unit literal. 3.5kg does not prove whether it
      // means laundry capacity or the appliance's weight; model IDs are excluded.
      for (const match of line.matchAll(/(?<![\p{L}\p{N}_.-])\d[\d,.]*\s*(?:mAh|mL|L|mm|cm|kg|g|W|V|kPa|Pa)(?![\p{L}\p{N}])/giu)) {
        facts.push(`표시규격: ${match[0]}`);
      }
    }
    for (const match of line.matchAll(/(?:올스텐|스테인리스)/gu)) facts.push(`소재: ${match[0]}`);
    const functionMatches = collectFunctionMatches(line);
    for (const [index, match] of functionMatches.entries()) {
      if (!hasUnsupportedFunctionContext(line, match, functionMatches[index - 1], functionMatches[index + 1]) &&
          !hasCoordinatedTrailingFunctionNegation(line, functionMatches, index)) {
        facts.push(`기능: ${match.value}`);
      }
    }
    // Measurements need their semantic label; never relabel 160g as appliance
    // weight, or a monetary/model number as performance.
    for (const match of line.matchAll(/(?:용량|소비전력|전압|흡입력|중량|무게|온도)\s*[:：]?\s*(\d[\d,.]*(?:\s*[~∼-]\s*\d[\d,.]*)?\s*(?:mL|L|kW|W|V|kPa|Pa|kg|g|도))(?![a-z])/giu)) {
      const label = match[0].match(/^(?:용량|소비전력|전압|흡입력|중량|무게|온도)/u)![0];
      facts.push(`${label}: ${match[1]}`);
    }
  }
  return [...new Set(facts.map(normalizeTypedProductFact).filter(Boolean))].slice(0, 16);
}
