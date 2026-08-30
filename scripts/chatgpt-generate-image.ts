import "dotenv/config";
import fs from "fs";
import path from "path";
import {
  countRenderableChatGPTImages,
  createChatGPTContext,
  downloadChatGPTImages,
  openFreshChatGPTTarget,
  readAssistantMessages,
  submitPromptToChatGPT,
  waitForChatGPTImageArtifacts,
} from "./lib/chatgpt-browser";

console.log = (...args: unknown[]) => {
  console.error(...args);
};

interface CliArgs {
  prompt: string;
  outStem: string;
  gptUrl: string;
}

function parseArgs(argv: string[]): CliArgs {
  const getValue = (flag: string): string => {
    const index = argv.indexOf(flag);
    if (index < 0 || index + 1 >= argv.length) {
      throw new Error(`필수 인자가 없습니다: ${flag}`);
    }
    return argv[index + 1];
  };

  return {
    prompt: getValue("--prompt"),
    outStem: getValue("--out-stem"),
    gptUrl: getValue("--gpt-url"),
  };
}

async function maybeConfirmGeneration(page: import("playwright").Page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const latestAssistantMessage = ((await readAssistantMessages(page)).at(-1) || "").replace(/\s+/g, "");
    const pageBodyText = ((await page.textContent("body").catch(() => "")) || "").replace(/\s+/g, "");
    const confirmationText = latestAssistantMessage || pageBodyText;
    if (/생성계획미리보기|이대로진행할까요|네라고입력/i.test(confirmationText)) {
      console.error("[chatgpt-image] confirmation detected, sending follow-up.");
      await submitPromptToChatGPT(page, "네", "주제 이미지 생성 확인");
      return;
    }

    const imageCount = await countRenderableChatGPTImages(page);
    if (imageCount > 0) return;
    await page.waitForTimeout(1500);
  }

  console.error("[chatgpt-image] confirmation prompt not detected, continuing without follow-up.");
}

async function main() {
  const { prompt, outStem, gptUrl } = parseArgs(process.argv.slice(2));
  const tempDir = path.join(path.dirname(outStem), `_chatgpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const handle = await createChatGPTContext(true);

  try {
    const page = await handle.context.newPage();
    await openFreshChatGPTTarget(page, gptUrl, "주제 이미지 생성 GPT");
    await submitPromptToChatGPT(page, prompt, "주제 이미지 생성");
    await maybeConfirmGeneration(page);
    await waitForChatGPTImageArtifacts(page, 90_000);

    const downloadedPaths = await downloadChatGPTImages(page, tempDir);
    const firstImagePath = downloadedPaths.find((value) => value && value.trim().length > 0);
    if (!firstImagePath) {
      throw new Error("ChatGPT 생성 이미지 다운로드 결과가 비어 있습니다.");
    }

    const extension = path.extname(firstImagePath) || ".png";
    const finalPath = `${outStem}${extension}`;
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.copyFileSync(firstImagePath, finalPath);

    process.stdout.write(JSON.stringify({ ok: true, localPath: finalPath }));
  } finally {
    await handle.close().catch(() => {});
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
