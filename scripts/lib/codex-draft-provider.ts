import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getWritingTimeoutPolicy, writingTimeoutMs } from "./writing-timeout-policy";

type CodexSdkModule = typeof import("@openai/codex-sdk");

export interface CodexDraftOptions {
  systemPrompt: string;
  userPrompt: string;
  imagePaths?: string[];
  timeoutMs?: number;
  model?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  researchMode?: "disabled" | "cached" | "live";
  onProgress?: (message: string) => void;
}
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<CodexSdkModule>;

function readableImages(imagePaths: string[]): string[] {
  const readable = Array.from(new Set(imagePaths.map((item) => path.resolve(item))))
    .filter((item) => {
      try {
        return fs.statSync(item).isFile();
      } catch {
        return false;
      }
    });
  const detailImages = readable.filter((item) => /(?:^|[_-])detail(?:[_-]|$)/iu.test(path.basename(item)));
  const regularImages = readable.filter((item) => !detailImages.includes(item));
  return Array.from(new Set([
    ...detailImages.slice(0, 2),
    ...regularImages.slice(0, 2),
    ...detailImages.slice(2),
    ...regularImages.slice(2),
  ])).slice(0, 4);
}

function buildWritingPrompt(
  systemPrompt: string,
  userPrompt: string,
  researchMode: NonNullable<CodexDraftOptions["researchMode"]>,
): string {
  return [
    "당신은 BlogAutoMCP의 한국어 블로그 원고 작성 엔진입니다.",
    researchMode === "disabled"
      ? "이 작업은 글쓰기 전용입니다. 명령 실행, 코드 수정, 파일 생성, MCP 호출, 웹 검색을 하지 마세요."
      : "이 작업은 여행 리서치와 글쓰기 전용입니다. 명령 실행, 코드 수정, 파일 생성, MCP 호출은 하지 말고 웹 검색은 여행지 사실 확인에만 사용하세요.",
    researchMode === "disabled"
      ? "제공된 자료와 첨부 이미지 안에서만 사실을 판단하고, 지시에 지정된 최종 형식만 반환하세요."
      : "상품 일정에 등장하는 여행지만 공식 관광청·공공기관·신뢰할 수 있는 여행 자료로 교차 확인하세요. 검색 출처나 URL은 최종 원고에 노출하지 말고 확인된 사실만 반영하세요.",
    "첨부 이미지는 제품 또는 여행 상품의 시각적 근거로만 사용하며 보이지 않는 성능이나 체험을 추정하지 마세요.",
    "",
    "[시스템 지시사항]",
    systemPrompt,
    "",
    "[사용자 요청]",
    userPrompt,
  ].join("\n");
}

export async function runCodexDraft(options: CodexDraftOptions): Promise<string> {
  const { Codex } = await nativeImport("@openai/codex-sdk");
  const timeoutMs = writingTimeoutMs(options.timeoutMs, getWritingTimeoutPolicy().codexMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const workingDirectory = path.join(os.tmpdir(), "blogautomcp-codex-drafts");
  fs.mkdirSync(workingDirectory, { recursive: true });

  const researchMode = options.researchMode ?? "disabled";
  const codex = new Codex();
  const thread = codex.startThread({
    ...(options.model ? { model: options.model } : {}),
    modelReasoningEffort: options.reasoningEffort ?? "medium",
    sandboxMode: "read-only",
    workingDirectory,
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: researchMode,
    threadSource: "blogautomcp-draft",
  });

  const prompt = buildWritingPrompt(options.systemPrompt, options.userPrompt, researchMode);
  const images = readableImages(options.imagePaths ?? []);
  const input = images.length > 0
    ? [
        { type: "text" as const, text: prompt },
        ...images.map((imagePath) => ({ type: "local_image" as const, path: imagePath })),
      ]
    : prompt;

  let finalResponse = "";
  try {
    options.onProgress?.(`Codex 원고 작성 시작${images.length ? ` · 이미지 ${images.length}장` : ""}`);
    const { events } = await thread.runStreamed(input, { signal: controller.signal });
    for await (const event of events) {
      if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalResponse = event.item.text.trim() || finalResponse;
        options.onProgress?.("Codex 원고 응답 수신");
      } else if (event.type === "turn.failed") {
        throw new Error(event.error.message || "Codex 원고 작성이 실패했습니다.");
      } else if (event.type === "error") {
        throw new Error(event.message || "Codex 실행 중 오류가 발생했습니다.");
      }
    }
    if (!finalResponse) {
      throw new Error("Codex 응답에서 원고 본문을 찾지 못했습니다.");
    }
    return finalResponse;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Codex 원고 작성 시간이 ${Math.round(timeoutMs / 1000)}초를 초과했습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
