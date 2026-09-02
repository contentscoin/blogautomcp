/**
 * 초안 품질 공용 신호.
 *
 * 쇼핑·여행 판정기와 spec-first 검증기가 같은 기준으로 "반복"과 "일반론"을 세도록
 * 한곳에 모았다. 정규식 하나로 정확히 같은 문장만 잡던 방식 대신, 토큰 집합의
 * 유사도로 "숫자만 바뀐 문장", "어미만 다른 문장"까지 반복으로 본다.
 */

export interface RepetitionReport {
  /** 정확히 같은 문장(정규화 후) 중복 수 */
  exactDuplicateCount: number;
  /** 근사 중복(토큰 유사도 기준) 문장 수. exact 포함. */
  nearDuplicateCount: number;
  /** 같은 첫 문장(앞 24자)으로 시작하는 섹션 수 */
  duplicateOpeningCount: number;
  /** 근사 중복으로 묶인 문장 쌍의 예시 */
  samples: Array<{ a: string; b: string; similarity: number }>;
}

export interface GenericLanguageReport {
  sentenceCount: number;
  /** "확인해보세요·살펴보세요" 같은 확인 안내 문장 수 */
  guidanceCount: number;
  /** 근거·수치·고유명 없이 누구에게나 맞는 말로만 된 문장 수 */
  generalStatementCount: number;
  guidanceRatio: number;
  generalRatio: number;
  /** 두 비율을 합친 "정보 없는 문장" 비율 */
  emptyRatio: number;
  samples: string[];
}

export const GUIDANCE_SENTENCE_PATTERN =
  /(?:확인(?:해|하|해야|하세요|해보|이\s*필요|하는\s*편)|살펴보|비교해보|체크해|참고하(?:세요|시면)|다시\s*(?:보|볼|확인)|보는\s*게\s*좋|알기\s*어렵|판단하기\s*어렵|단정하기\s*어렵|확정하기\s*어렵|현재\s*(?:정보|수집)|공개되지\s*않|담겨\s*있지\s*않|안전해요|권장(?:해요|합니다|드려요))/u;

/**
 * 근거 없이 어느 상품·여행지에나 붙일 수 있는 문장의 단서.
 * 이 패턴에 걸리더라도 문장 안에 상품 토큰·수치·고유 근거가 있으면 일반론으로 세지 않는다.
 */
export const GENERAL_STATEMENT_PATTERN =
  /(?:상황에\s*따라|환경에\s*따라|사람마다|개인차|경우가\s*많|기준으로\s*보면|먼저(?:예요|입니다)|중요(?:해요|합니다)$|판단이\s*쉬워|도움이\s*(?:돼요|됩니다)|달라질\s*수\s*있|변동될\s*수\s*있|고려(?:해\s*볼|할)\s*(?:만|수)|좋을\s*수\s*있|나쁘지\s*않|편리할\s*수\s*있|충분히\s*가능|무난(?:해요|합니다)|기본적으로|일반적으로|대체로)/u;

const SENTENCE_SPLIT = /[\n.!?。]+/u;

export function normalizeSentence(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function splitSentences(text: string, minLength = 8): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map(normalizeSentence)
    .filter((item) => item.length >= minLength);
}

/** 조사·어미 차이를 눌러 비교하기 위한 토큰화. 2글자 이상 한글·영문·숫자 덩어리를 쓴다. */
export function sentenceTokens(sentence: string): string[] {
  const stripped = sentence
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/(?:은|는|이|가|을|를|의|에|에서|으로|로|과|와|도|만|까지|부터|이나|나|께|한테|에게|이라|라)\b/gu, " ");
  const tokens = stripped.split(/\s+/u).filter((token) => token.length >= 2);
  // 4글자 이상 토큰은 앞 3글자로도 넣어 어미 변화("확인해요/확인합니다")를 같은 토큰으로 본다.
  const stems = tokens.map((token) => (/^[가-힣]{4,}$/u.test(token) ? token.slice(0, 3) : token));
  return Array.from(new Set(stems));
}

export function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let overlap = 0;
  for (const token of a) if (setB.has(token)) overlap += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : overlap / union;
}

export interface RepetitionOptions {
  /** 이 이상이면 근사 중복으로 본다. 기본 0.72 */
  similarityThreshold?: number;
  /** 이 길이 미만 문장은 무시한다. 기본 12 */
  minSentenceLength?: number;
}

/**
 * 섹션 배열을 받아 문장 반복을 센다. 섹션 안·섹션 간 모두 본다.
 */
export function assessRepetition(sections: string[], options: RepetitionOptions = {}): RepetitionReport {
  const threshold = options.similarityThreshold ?? 0.72;
  const minLength = options.minSentenceLength ?? 12;
  const entries: Array<{ text: string; key: string; tokens: string[] }> = [];
  for (const section of sections) {
    for (const sentence of splitSentences(section, minLength)) {
      entries.push({
        text: sentence,
        key: sentence.replace(/[^\p{L}\p{N}]/gu, ""),
        tokens: sentenceTokens(sentence),
      });
    }
  }

  const exactCounts = new Map<string, number>();
  for (const entry of entries) exactCounts.set(entry.key, (exactCounts.get(entry.key) || 0) + 1);
  const exactDuplicateCount = Array.from(exactCounts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);

  // 근사 중복: 앞선 문장 중 하나라도 threshold 이상이면 이 문장은 반복이다.
  let nearDuplicateCount = 0;
  const samples: RepetitionReport["samples"] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const current = entries[i];
    if (current.tokens.length < 3) continue;
    for (let j = 0; j < i; j += 1) {
      const earlier = entries[j];
      if (earlier.tokens.length < 3) continue;
      const similarity = current.key === earlier.key ? 1 : tokenSimilarity(current.tokens, earlier.tokens);
      if (similarity >= threshold) {
        nearDuplicateCount += 1;
        if (samples.length < 5) samples.push({ a: earlier.text, b: current.text, similarity: Number(similarity.toFixed(2)) });
        break;
      }
    }
  }

  const openings = sections
    .map((section) => {
      const body = section.split("\n").slice(1).join("\n") || section;
      const first = splitSentences(body, 1)[0] || "";
      return first.slice(0, 24);
    })
    .filter((value) => value.length >= 10);
  const openingCounts = new Map<string, number>();
  for (const opening of openings) openingCounts.set(opening, (openingCounts.get(opening) || 0) + 1);
  const duplicateOpeningCount = Array.from(openingCounts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);

  return { exactDuplicateCount, nearDuplicateCount, duplicateOpeningCount, samples };
}

export interface GenericLanguageOptions {
  /** 문장에 있으면 "근거가 있는 문장"으로 보는 토큰(상품명 토큰, 확인 신호, 지명 등) */
  evidenceTokens?: string[];
}

/**
 * 확인 안내 문장과 일반론 문장을 센다.
 * 일반론은 패턴에 걸리면서 수치·근거 토큰이 하나도 없는 문장만 센다.
 */
export function assessGenericLanguage(text: string, options: GenericLanguageOptions = {}): GenericLanguageReport {
  const sentences = splitSentences(text, 8);
  const sentenceCount = Math.max(1, sentences.length);
  const evidenceTokens = (options.evidenceTokens || [])
    .map((token) => token.toLowerCase().replace(/\s+/g, ""))
    .filter((token) => token.length >= 2);
  const hasEvidence = (sentence: string): boolean => {
    if (/\d/u.test(sentence)) return true;
    const loose = sentence.toLowerCase().replace(/\s+/g, "");
    return evidenceTokens.some((token) => loose.includes(token));
  };
  let guidanceCount = 0;
  let generalStatementCount = 0;
  const samples: string[] = [];
  for (const sentence of sentences) {
    const guidance = GUIDANCE_SENTENCE_PATTERN.test(sentence);
    if (guidance) guidanceCount += 1;
    if (!guidance && GENERAL_STATEMENT_PATTERN.test(sentence) && !hasEvidence(sentence)) {
      generalStatementCount += 1;
      if (samples.length < 5) samples.push(sentence);
    }
  }
  const guidanceRatio = guidanceCount / sentenceCount;
  const generalRatio = generalStatementCount / sentenceCount;
  return {
    sentenceCount,
    guidanceCount,
    generalStatementCount,
    guidanceRatio,
    generalRatio,
    emptyRatio: guidanceRatio + generalRatio,
    samples,
  };
}

/** 근거 줄에서 본문 대조용 토큰을 뽑는다 ("배터리 3,800mAh, 충전시간 약 6시간" → ["배터리","3,800mah","충전시간","6시간"]). */
export function evidenceTokensOf(line: string): string[] {
  const withoutLabel = line.replace(/^[^:：]{1,12}[:：]\s*/u, "");
  return Array.from(
    new Set(
      withoutLabel
        .toLowerCase()
        .split(/[^\p{L}\p{N},.]+/u)
        .map((token) => token.replace(/^[,.]+|[,.]+$/gu, ""))
        .filter((token) => token.length >= 2 && !/^(?:상품|제품|기능|표기|판매페이지|카테고리|방식|구조|기준|최대|약|기준|사용|가능|포함|확인)$/u.test(token)),
    ),
  );
}

/** 근거 줄이 본문에 쓰였는지: 수치 토큰이 있으면 수치 하나 + 설명 토큰 하나, 없으면 설명 토큰 2개(또는 전부). */
export function evidenceUsedIn(line: string, text: string): boolean {
  const tokens = evidenceTokensOf(line);
  if (tokens.length === 0) return false;
  const loose = text.toLowerCase().replace(/\s+/g, "");
  const numeric = tokens.filter((token) => /\d/u.test(token));
  const descriptive = tokens.filter((token) => !/\d/u.test(token));
  const has = (token: string) => loose.includes(token.replace(/\s+/g, ""));
  if (numeric.length > 0) {
    return numeric.some(has) && (descriptive.length === 0 || descriptive.some(has));
  }
  const required = Math.min(2, descriptive.length);
  return descriptive.filter(has).length >= required;
}
