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

function runCodex(prompt: string, outputFile: string): Promise<void> {
  return new Promise((resolve) => {
    const codexBin =
      process.env.CODEX_BIN ||
      "/Users/jakeshin/.nvm/versions/node/v20.19.5/bin/codex";

    const proc = spawn(
      codexBin,
      ["exec", "--full-auto", "--ephemeral", "--skip-git-repo-check", "-o", outputFile, "-"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    proc.stdin.write(prompt, "utf-8");
    proc.stdin.end();

    // Resolve on close regardless of exit code (MCP failures cause non-zero exit)
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
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

  // Timeout wrapper
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), 300000), // 5 minutes
  );

  try {
    const result = await Promise.race([runCodex(prompt, outputFile), timeout]);

    if (result === "timeout") {
      throw new Error("생성 시간 초과 (150초). 다시 시도해주세요.");
    }

    let output: string;
    try {
      output = await readFile(outputFile, "utf-8");
    } catch {
      throw new Error("Codex가 출력 파일을 생성하지 못했습니다. 다시 시도해주세요.");
    }

    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`JSON을 찾을 수 없습니다. 출력: ${output.slice(0, 300)}`);
    }

    const data = JSON.parse(jsonMatch[0]) as { topics: unknown[] };
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "생성 실패";
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    unlink(outputFile).catch(() => {});
  }
}
