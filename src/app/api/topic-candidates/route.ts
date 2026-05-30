import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { requireAdminApiKey } from "@/lib/api-auth";

const CATEGORIES: Record<string, string> = {
  tech: "기술/IT",
  business: "비즈니스/경제",
  lifestyle: "라이프스타일",
  design: "디자인/크리에이티브",
  marketing: "마케팅/트렌드",
  food: "음식/요리",
  travel: "여행/문화",
  health: "건강/운동",
  education: "교육/자기계발",
  ai: "AI/미래기술",
};

interface Subtopic {
  subtitle: string;
  summary: string;
}

interface TopicCandidate {
  title: string;
  subtopics: Subtopic[];
  content: string;
  image_prompt: string;
  hashtags: string[];
}

interface CodexRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut?: boolean;
}

const DEFAULT_CODEX_TIMEOUT_MS = 15000;

function getCodexTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.TOPIC_CANDIDATE_CODEX_TIMEOUT_MS || "", 10);
  if (Number.isFinite(parsed) && parsed >= 1000) {
    return Math.min(parsed, 300000);
  }
  return DEFAULT_CODEX_TIMEOUT_MS;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHashTagNoise(value: string): string {
  return normalizeSpace(value)
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_가-힣]+/gu, "");
}

function buildHashtags(keyword: string, categoryLabel: string, index: number): string[] {
  const compactKeyword = stripHashTagNoise(keyword) || "블로그소재";
  const compactCategory = stripHashTagNoise(categoryLabel) || "콘텐츠";
  const rotation = [
    "실전팁",
    "체크리스트",
    "경험정리",
    "트렌드",
    "입문가이드",
    "비교분석",
    "노하우",
    "추천",
    "활용법",
    "콘텐츠기획",
  ];

  return Array.from(
    new Set([
      `#${compactKeyword}`,
      `#${compactCategory}`,
      `#${rotation[index % rotation.length]}`,
      "#네이버블로그",
      "#블로그주제",
      "#정보정리",
      "#일상기록",
    ]),
  ).slice(0, 7);
}

function buildFallbackTopics(categoryLabel: string, keyword: string): TopicCandidate[] {
  const topic = normalizeSpace(keyword);
  const category = normalizeSpace(categoryLabel);
  const angles = [
    {
      label: "처음 시작 전 체크리스트",
      en: "starter checklist",
      subtitles: ["처음 막히는 지점", "먼저 정할 기준", "바로 써먹는 순서"],
    },
    {
      label: "사람들이 자주 놓치는 포인트",
      en: "common overlooked details",
      subtitles: ["겉으로 쉬워 보이는 이유", "놓치면 불편한 부분", "확인하면 좋은 신호"],
    },
    {
      label: "선택 기준 비교",
      en: "decision criteria comparison",
      subtitles: ["비교가 필요한 순간", "기준을 세우는 법", "나에게 맞는 결론"],
    },
    {
      label: "실전 루틴 만들기",
      en: "practical daily routine",
      subtitles: ["작게 시작하는 방법", "반복하기 쉬운 장치", "꾸준함을 확인하는 법"],
    },
    {
      label: "후회 줄이는 준비법",
      en: "preparation to reduce regrets",
      subtitles: ["미리 보면 좋은 변수", "시간과 비용의 균형", "마지막 점검 목록"],
    },
    {
      label: "요즘 트렌드 정리",
      en: "current trend overview",
      subtitles: ["최근 달라진 분위기", "사람들이 반응하는 이유", "앞으로 볼 포인트"],
    },
    {
      label: "초보자 관점 설명",
      en: "beginner friendly guide",
      subtitles: ["어렵게 느껴지는 말", "쉽게 이해하는 예시", "첫 시도에 필요한 것"],
    },
    {
      label: "경험담형 후기 구성",
      en: "personal review story",
      subtitles: ["처음 기대했던 점", "직접 느낀 차이", "다시 한다면 바꿀 점"],
    },
    {
      label: "문제 해결 가이드",
      en: "problem solving guide",
      subtitles: ["문제가 생기는 장면", "원인을 나누는 법", "빠르게 정리하는 순서"],
    },
    {
      label: "한눈에 보는 요약",
      en: "clear editorial summary",
      subtitles: ["핵심만 먼저 보기", "상황별 추천 기준", "마무리 체크포인트"],
    },
  ];

  return angles.map((angle, index) => {
    const title = `${topic} ${angle.label}`.slice(0, 30);
    const subtopics = angle.subtitles.map((subtitle, subIndex) => ({
      subtitle,
      summary: `${topic}를 ${category} 관점에서 볼 때 ${subtitle}을 먼저 정리합니다.`,
      body:
        subIndex === 0
          ? `${topic}를 떠올리면 처음에는 정보가 많아서 오히려 기준이 흐려질 때가 있습니다. 그래서 ${subtitle}부터 잡아두면 글의 방향이 분명해지고, 읽는 사람도 자기 상황에 바로 대입하기 쉬워집니다.`
          : subIndex === 1
            ? `${subtitle}은 실제 선택에서 차이를 만드는 부분입니다. 단순한 장점 나열보다 언제 필요하고 어떤 경우에는 맞지 않는지까지 같이 적으면 글이 더 믿음 있게 읽힙니다.`
            : `${subtitle}까지 정리하면 독자가 바로 행동으로 옮길 수 있습니다. 마지막에는 체크할 항목을 짧게 묶어 주면 저장하고 다시 보는 블로그 글로 만들기 좋습니다.`,
    }));

    return {
      title,
      subtopics: subtopics.map(({ subtitle, summary }) => ({ subtitle, summary })),
      content: subtopics.map((item) => `## ${item.subtitle}\n${item.body}`).join("\n\n"),
      image_prompt: `Realistic Korean lifestyle blog photo about ${topic}, ${angle.en}, warm natural lighting, editorial composition, no text`,
      hashtags: buildHashtags(topic, category, index),
    };
  });
}

function summarizeCodexFailure(result: CodexRunResult | null, fallbackMessage: string): string {
  if (result?.timedOut) {
    return "Codex 생성 시간이 초과되었습니다.";
  }

  const stderr = normalizeSpace(result?.stderr || "");
  if (stderr) return stderr.slice(0, 240);

  const stdout = normalizeSpace(result?.stdout || "");
  if (stdout) return stdout.slice(0, 240);

  if (typeof result?.exitCode === "number") {
    return `Codex exited with code ${result.exitCode}`;
  }

  return fallbackMessage;
}

function runCodex(prompt: string, outputFile: string): Promise<CodexRunResult> {
  return new Promise((resolve) => {
    // PATH 기반 'codex' 기본값(이식성). 필요 시 CODEX_BIN으로 절대경로 지정.
    const codexBin = process.env.CODEX_BIN || "codex";

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finish = (result: CodexRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };
    const proc = spawn(
      codexBin,
      ["exec", "--full-auto", "--ephemeral", "--skip-git-repo-check", "-o", outputFile, "-"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          OTEL_SDK_DISABLED: process.env.OTEL_SDK_DISABLED || "true",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (proc.pid) {
        try {
          proc.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
      finish({ stdout, stderr, exitCode: null, timedOut: true });
    }, getCodexTimeoutMs());

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.stdin.write(prompt, "utf-8");
    proc.stdin.end();

    proc.on("close", (exitCode) => finish({ stdout, stderr, exitCode, timedOut }));
    proc.on("error", (error) =>
      finish({ stdout, stderr: `${stderr}\n${error.message}`.trim(), exitCode: null, timedOut }),
    );
  });
}

export async function POST(req: NextRequest) {
  const authError = requireAdminApiKey(req);
  if (authError) return authError;

  const body = await req.json();
  const { category, keyword } = body as { category: string; keyword: string };

  if (!category || !keyword) {
    return NextResponse.json({ error: "category와 keyword는 필수입니다" }, { status: 400 });
  }

  // 입력 검증: 한글, 영숫자, 공백, 하이픈, 슬래시만 허용
  const SAFE_INPUT = /^[가-힣a-zA-Z0-9\s\-_/.,]+$/;
  if (!SAFE_INPUT.test(category) || !SAFE_INPUT.test(keyword)) {
    return NextResponse.json({ error: "유효하지 않은 입력입니다" }, { status: 400 });
  }

  const categoryLabel = CATEGORIES[category] || category;
  const ts = Date.now();
  const outputFile = join(tmpdir(), `topic-output-${ts}.txt`);

  const prompt = `당신은 네이버 블로그 전문 작가입니다. 아래 JSON만 출력하세요 (코드블록, 설명 없이 raw JSON만).

카테고리: ${categoryLabel}
키워드: ${keyword}

형식:
{"topics":[{"title":"제목(30자이내)","subtopics":[{"subtitle":"소주제1","summary":"한줄설명"},{"subtitle":"소주제2","summary":"한줄설명"},{"subtitle":"소주제3","summary":"한줄설명"}],"content":"## 소주제1\\n내용(각소주제별100~200자, 1인칭, 감성적)\\n\\n## 소주제2\\n내용\\n\\n## 소주제3\\n내용","image_prompt":"English photo prompt (warm natural lighting, lifestyle, bokeh)","hashtags":["#태그1","#태그2","#태그3","#태그4","#태그5","#태그6","#태그7"]}]}

위 형식으로 서로 다른 각도의 소재 10개를 담은 JSON을 출력하세요. JSON만 출력, 다른 텍스트 없음.`;

  try {
    const result = await runCodex(prompt, outputFile);
    if (result.timedOut) throw new Error(summarizeCodexFailure(result, "생성 시간 초과"));

    let output: string;
    try {
      output = await readFile(outputFile, "utf-8");
    } catch {
      output = result.stdout;
    }

    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(summarizeCodexFailure(result, `JSON을 찾을 수 없습니다. 출력: ${output.slice(0, 300)}`));
    }

    const data = JSON.parse(jsonMatch[0]) as { topics: unknown[] };
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "생성 실패";
    console.warn(`[topic-candidates] Codex generation failed; using local fallback: ${msg}`);
    return NextResponse.json({
      topics: buildFallbackTopics(categoryLabel, keyword),
      fallback: true,
      warning: "Codex 생성이 실패해 로컬 후보 생성으로 대체했습니다.",
    });
  } finally {
    unlink(outputFile).catch(() => {});
  }
}
