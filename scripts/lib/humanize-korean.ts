/**
 * 한국어 "AI 티" 제거 룰셋 — 글쓰기 문장 고도화.
 *
 * 출처/참고: im-not-ai (humanize-korean) AI-tell taxonomy v2.0
 *   https://github.com/epoko77-ai/im-not-ai
 * LLM이 생성한 한국어가 드러내는 번역투·기계적 구조·AI 상투구·리듬 평탄화 등을
 * 탐지/회피하기 위한 규칙을 이 프로젝트(네이버 블로그 자동 포스팅)에 맞게 포팅했다.
 *
 * 두 가지 용도:
 *  1) HUMANIZE_RULES         — 생성/윤문 프롬프트에 주입해 "예방적"으로 AI 티를 줄임.
 *  2) scanAiTells(text)      — 코드 기반 정규식 스캐너로 생성 후 AI 티를 "측정"(게이팅용).
 *  3) buildHumanizeRewritePrompt(text) — 전용 재작성 패스용 지시문.
 *
 * 심각도: S1(결정적, 한 번만 나와도 AI 확실) / S2(반복 시 티남) / S3(중첩 시 인상 강화)
 */

/**
 * 생성·윤문 프롬프트에 그대로 끼워 넣는 한국어 규칙 블록.
 * 네이버 블로그(친근한 해요체, 모바일 가독성)에 맞춰 핵심 S1/S2 패턴만 추렸다.
 */
export const HUMANIZE_RULES = `[자연스러운 한국어 — AI 티 제거 규칙 (필수 준수)]
아래는 사람이 쓴 글처럼 읽히게 하기 위한 규칙입니다. "AI가 쓴 티"가 나는 표현을 피하세요.

1) 번역투 금지(가장 중요):
   - "~에 대해(서)", "~를/을 통해", "~에 있어서", "~와 관련하여" 남발 금지 → 목적격(를/을)이나 "~로, ~해서"로 직결.
   - "가지고 있다" → 형용사로("경쟁력을 가지고 있다" → "경쟁력이 강하다").
   - 이중 피동("되어진다", "~지게 된다") 금지 → "된다/한다".
   - "~에 의해" 피동 → 행위자를 주어로("AI에 의해 생성된" → "AI가 만든").
   - "그/그녀/그들/그것" 같은 대명사 반복 금지 → 대부분 생략하거나 이름·호칭으로.

2) AI 상투구 절대 금지:
   - 종결/요약 상투구: "결론적으로", "요약하면", "종합하면", "정리하자면", "~라고 할 수 있다".
   - 과장 상투구: "시사하는 바가 크다", "주목할 만하다", "간과할 수 없다", "의미심장하다".
   - 과장 형용사(hype): "혁신적인", "획기적인", "전례 없는", "압도적", "폭발적", "파격적", "강력한".
   - 의인화 추상 주어("AI 대전이 끝나지 않습니다") → 실제 행위자/구체 서술로.

3) 기계적 구조 금지:
   - "첫째~ 둘째~ 셋째~", "1) 2) 3)", "먼저~ 반면~ 결국~" 같은 도식 나열을 산문으로 녹이기.
   - 연결어미(-고/-며/-지만/-면서/-아서·어서) 바로 뒤에 쉼표 찍지 않기(예: "발전하지만," → "발전하지만").
   - 한 문장에 쉼표를 여러 개 박지 않기. 문장의 절반 이상에 쉼표가 있으면 과함.
   - 이모지는 본문 강조용으로 남발하지 말 것(꼭 필요한 한두 개만).

4) 문장 리듬(중요):
   - 모든 문장을 비슷한 길이로 쓰지 말 것. 짧은 문장(10~15자)과 긴 문장을 의도적으로 섞기.
   - 같은 종결어미("~습니다. ~습니다. ~습니다." / "~예요. ~예요.")를 4번 이상 연속하지 말 것.
   - 단문만 늘어놓지 말고 연결어미로 묶어 복문도 섞기.

5) 헤지(완곡) 줄이기:
   - "~할 수 있을 것으로 보인다", "~인 것으로 판단된다", "~인 듯하다"를 남발하지 말 것. 단언할 곳은 단언.
   - "것이다/것입니다" 종결 남발 금지 → 확정 서술("~다/~예요")로 끝맺기.

6) 접속사·수식 절제:
   - 문두 "또한/따라서/즉/나아가/게다가/더욱이"를 대부분 빼기(흐름은 내용으로).
   - "매우/정말/대단히" 같은 정도부사, "중요하고 핵심적인" 같은 동의어 이중 수식 줄이기.
   - "~적", "~성", "~화" 한자 접미사 남발 금지.

핵심 원칙: 사실·숫자·고유명사·상품명·인용은 절대 바꾸지 말고, 위 "티" 나는 표현만 자연스럽게 고치세요.`;

export type AiTellSeverity = "S1" | "S2";

export interface AiTellFinding {
  id: string;
  label: string;
  severity: AiTellSeverity;
  count: number;
  samples: string[];
}

export interface AiTellScanResult {
  /** 가중 점수(S1=5, S2=2 합산). 0이 가장 자연스러움. */
  score: number;
  /** 탐지 span 글자수 / 전체 글자수. */
  density: number;
  totalChars: number;
  findings: AiTellFinding[];
  /** 사람이 읽는 한 줄 요약. */
  summary: string;
}

interface PatternDef {
  id: string;
  label: string;
  severity: AiTellSeverity;
  regex: RegExp;
  /** 이 횟수를 초과해야 finding으로 집계(밀도 기반 S2 패턴용). 기본 0(=1회부터). */
  threshold?: number;
}

// 이모지(주요 블록). 'g'로 카운트.
const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F02F}\u{2190}-\u{21FF}\u{2B05}-\u{2B07}]/gu;

const PATTERNS: PatternDef[] = [
  // --- S1: 한 번만 나와도 AI 티 ---
  { id: "D-1", label: "종결 상투구(결론적으로/요약하면 등)", severity: "S1", regex: /결론적으로|요약하면|종합하면|정리하자면|정리하면/g },
  { id: "D-2", label: "과장 상투구(시사하는 바가 크다 등)", severity: "S1", regex: /시사하는\s*바가\s*크다|주목할\s*만하다|간과할\s*수\s*없|무시할\s*수\s*없|의미심장/g },
  { id: "D-4", label: "hype 형용사(혁신적/획기적 등)", severity: "S1", regex: /혁신적|획기적|전례\s*없는|압도적|폭발적|파격적|대대적/g },
  { id: "A-7", label: '"가지고 있다" 번역투', severity: "S1", regex: /가지고\s*있(다|습니다|어요|는|었)/g },
  { id: "A-8", label: "이중 피동(되어진다/지게 된다)", severity: "S1", regex: /되어지(다|는|ㄴ다|며)|지게\s*된다/g },
  { id: "C-5", label: "이모지 남발", severity: "S1", regex: EMOJI_REGEX, threshold: 4 },
  { id: "C-11", label: "연결어미 뒤 쉼표", severity: "S1", regex: /(고|며|지만|면서|아서|어서|는데|으며),/g, threshold: 5 },

  // --- S2: 반복 시 티남(임계 초과만 집계) ---
  { id: "A-2", label: '"~를/을 통해" 남발', severity: "S2", regex: /(을|를)\s*통(해|하여|한)/g, threshold: 2 },
  { id: "A-1", label: '"~에 대해/대한" 남발', severity: "S2", regex: /에\s*대(해|한|하여|해서)/g, threshold: 2 },
  { id: "A-10", label: '"~할 수 있다" 남발', severity: "S2", regex: /수\s*있(다|습니다|어요|었|는)/g, threshold: 4 },
  { id: "I-1", label: '"것이다/것입니다" 종결 남발', severity: "S2", regex: /것(이다|입니다|이에요|이었|일\s)/g, threshold: 3 },
  { id: "D-2b", label: '"~라고 할 수 있다" 식 단정 회피', severity: "S2", regex: /라고\s*(할|볼)\s*수\s*있/g, threshold: 1 },
  { id: "C-1", label: "기계적 병렬(첫째/둘째/셋째)", severity: "S2", regex: /첫째|둘째|셋째|넷째/g, threshold: 2 },
  { id: "C-9", label: '숫자 괄호 인덱싱(1) 2) 3))', severity: "S2", regex: /(^|\s)[1-9]\)\s/g, threshold: 1 },
  { id: "H-1", label: "문두 접속사 과다", severity: "S2", regex: /(^|\n)\s*(또한|따라서|게다가|더욱이|나아가|아울러)\b/g, threshold: 2 },
  { id: "F-1", label: "정도부사 중독(매우/정말 등)", severity: "S2", regex: /매우|대단히|극히|굉장히/g, threshold: 3 },
];

function uniqueSamples(matches: string[], max = 3): string[] {
  return [...new Set(matches.map((m) => m.trim()).filter(Boolean))].slice(0, max);
}

/**
 * 정규식 기반 AI-tell 스캐너. LLM 없이 코드로 "AI 티"를 측정한다.
 * 게이팅(content-readiness)·모니터링·재작성 트리거에 사용.
 */
export function scanAiTells(text: string): AiTellScanResult {
  const totalChars = Math.max(1, text.replace(/\s/g, "").length);
  const findings: AiTellFinding[] = [];
  let matchedChars = 0;

  for (const p of PATTERNS) {
    const matches = text.match(p.regex) || [];
    const count = matches.length;
    const threshold = p.threshold ?? 0;
    if (count <= threshold) continue;

    matchedChars += matches.reduce((n, m) => n + m.replace(/\s/g, "").length, 0);
    findings.push({
      id: p.id,
      label: p.label,
      severity: p.severity,
      count,
      samples: uniqueSamples(matches),
    });
  }

  const score = findings.reduce((s, f) => s + (f.severity === "S1" ? 5 : 2) * Math.min(f.count, 8), 0);
  const density = matchedChars / totalChars;

  const s1 = findings.filter((f) => f.severity === "S1").length;
  const summary =
    findings.length === 0
      ? "AI 티 신호 없음 — 자연스러움"
      : `AI 티 ${findings.length}종(S1 ${s1}건), 점수 ${score}, 밀도 ${(density * 100).toFixed(1)}%`;

  return { score, density, totalChars, findings, summary };
}

/** 전용 재작성(휴머나이징) 패스용 지시문. 생성된 text를 자연스럽게 고쳐쓰게 한다. */
export function buildHumanizeRewritePrompt(text: string): string {
  return `${HUMANIZE_RULES}

[작업] 아래 글을 위 규칙에 따라 "AI 티"만 자연스럽게 고쳐 다시 쓰세요.
- 사실·숫자·고유명사·상품명·인용·해시태그·소제목 구조는 절대 바꾸지 말 것.
- 의미를 보존하고 문장 표현만 다듬을 것(전체 변경은 30%를 넘기지 말 것).
- 결과는 원문과 같은 구조(소제목+본문)로만 출력하고, 설명/주석은 붙이지 말 것.

[원문]
${text}`;
}
