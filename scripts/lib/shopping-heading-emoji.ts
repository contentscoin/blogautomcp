/**
 * 쇼핑 글 소제목 앞에 내용에 맞는 이모지 1개를 붙인다.
 *
 * 모델이 붙인 이모지가 있으면 맨 앞 1개만 남기고, 없으면 소제목의 낱말로 고른다.
 * 제목(글 제목)과 본문 문장에는 쓰지 않는다. 여행 글은 대상이 아니다.
 */
const EMOJI = /[\p{Extended_Pictographic}️‍]/gu;
const LEADING_EMOJI = /^\s*(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/u;

// 위에서부터 먼저 맞는 규칙을 쓴다. 구체적인 주제가 일반적인 주제보다 앞에 온다.
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/자주\s*묻|질문|궁금|FAQ|Q\s*&\s*A/iu, "❓"],
  [/주의|단점|아쉬|한계|유의|조심|피해야/u, "⚠️"],
  [/가격|할인|혜택|쿠폰|가성비|비용|구매\s*조건/u, "💰"],
  [/배송|도착|교환|반품/u, "🚚"],
  [/세척|청소|관리|보관|세탁|손질/u, "🧼"],
  [/사용법|사용\s*방법|쓰는\s*법|설치|조립|조작|충전|활용/u, "🛠️"],
  [/크기|사이즈|치수|규격|용량|무게|길이/u, "📏"],
  [/구성|구성품|옵션|색상|종류|라인업/u, "📦"],
  [/비교|차이|고르는|선택\s*기준|기준/u, "⚖️"],
  [/추천|맞는|어울리|이런\s*분|대상|누구/u, "🙋"],
  [/후기|리뷰|평점|반응/u, "💬"],
  [/성분|원재료|소재|재질|함량/u, "🧪"],
  [/기능|특징|장점|성능|원리|구조/u, "✨"],
  [/한눈|요약|정리|결론|마무리|총평/u, "📝"],
  [/고민|불편|문제|해결|필요한\s*이유|왜/u, "💡"],
];
const FALLBACKS = ["✅", "📌", "🔎", "👍"];

export function stripHeadingEmoji(title: string): string {
  return title.replace(EMOJI, "").replace(/\s+/gu, " ").trim();
}

export function pickShoppingHeadingEmoji(title: string, index = 0): string {
  const plain = stripHeadingEmoji(title);
  return RULES.find(([pattern]) => pattern.test(plain))?.[1] || FALLBACKS[Math.abs(index) % FALLBACKS.length];
}

/** 소제목 한 줄을 `이모지 제목` 형태로 만든다. 이미 붙어 있으면 맨 앞 1개만 남긴다. */
export function decorateShoppingHeading(title: string, index = 0): string {
  const plain = stripHeadingEmoji(title);
  if (!plain) return plain;
  const own = title.match(LEADING_EMOJI)?.[1];
  return `${own || pickShoppingHeadingEmoji(plain, index)} ${plain}`;
}

/** `소제목\n\n본문` 섹션의 첫 줄만 꾸민다. 본문은 그대로 둔다. */
export function decorateShoppingSection(section: string, index = 0): string {
  const lineEnd = section.indexOf("\n");
  if (lineEnd < 0) return decorateShoppingHeading(section, index);
  return `${decorateShoppingHeading(section.slice(0, lineEnd), index)}${section.slice(lineEnd)}`;
}
