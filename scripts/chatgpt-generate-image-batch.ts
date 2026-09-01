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
  startFreshChat,
  waitForChatGPTImageArtifacts,
} from "./lib/chatgpt-browser";

console.log = (...args: unknown[]) => {
  console.error(...args);
};

interface BatchJob {
  id: string;
  prompt: string;
  outStem: string;
  referenceImagePaths?: string[];
}

interface CliArgs {
  jobsFile: string;
  gptUrl: string;
}

interface BatchResult {
  id: string;
  localPath: string | null;
  error?: string;
}

const CHATGPT_IMAGE_WAIT_MS = Number(process.env.CHATGPT_IMAGE_WAIT_MS || 60_000);
const CHATGPT_IMAGE_INPUT_SELECTORS = [
  'input#upload-photos[type="file"]',
  'input[type="file"][accept*="image"]',
];
const CHATGPT_PLUS_BUTTON_SELECTORS = [
  '#composer-plus-btn',
  'button[data-testid="composer-plus-btn"]',
  'button[aria-label*="파일 추가"]',
  'button[aria-label*="Attach"]',
];

async function attachReferenceImages(page: import("playwright").Page, paths: string[]) {
  const references = paths.filter((value) => value && fs.existsSync(value)).slice(0, 3);
  if (references.length === 0) return;
  let input = page.locator(CHATGPT_IMAGE_INPUT_SELECTORS.join(", ")).first();
  if (!(await input.count())) {
    for (const selector of CHATGPT_PLUS_BUTTON_SELECTORS) {
      const button = page.locator(selector).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click().catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(250);
  }
  input = page.locator(CHATGPT_IMAGE_INPUT_SELECTORS.join(", ")).first();
  if (!(await input.count())) throw new Error("GPT Image 레퍼런스 첨부 입력창을 찾지 못했습니다.");
  await input.setInputFiles(references);
  await page.waitForTimeout(700);
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
    jobsFile: getValue("--jobs-file"),
    gptUrl: getValue("--gpt-url"),
  };
}

async function maybeConfirmGeneration(page: import("playwright").Page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const latestAssistantMessage = ((await readAssistantMessages(page)).at(-1) || "").replace(/\s+/g, "");
    const pageBodyText = ((await page.textContent("body").catch(() => "")) || "").replace(/\s+/g, "");
    const confirmationText = latestAssistantMessage || pageBodyText;
    if (/생성계획미리보기|이대로진행할까요|네라고입력/i.test(confirmationText)) {
      console.error("[chatgpt-image-batch] confirmation detected, sending follow-up.");
      await submitPromptToChatGPT(page, "네", "주제 이미지 생성 확인");
      return;
    }

    const imageCount = await countRenderableChatGPTImages(page);
    if (imageCount > 0) return;
    await page.waitForTimeout(1500);
  }

  console.error("[chatgpt-image-batch] confirmation prompt not detected, continuing without follow-up.");
}

async function waitForImageCompletion(page: import("playwright").Page) {
  await waitForChatGPTImageArtifacts(page, CHATGPT_IMAGE_WAIT_MS);
}

async function runJob(
  page: import("playwright").Page,
  job: BatchJob,
  gptUrl: string,
  isFirst: boolean,
): Promise<BatchResult> {
  const tempDir = path.join(
    path.dirname(job.outStem),
    `_chatgpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    if (isFirst) {
      await openFreshChatGPTTarget(page, gptUrl, "주제 이미지 생성 GPT");
    } else {
      await startFreshChat(page, gptUrl, `이미지 슬롯 ${job.id}`);
    }

    await attachReferenceImages(page, job.referenceImagePaths || []);
    await submitPromptToChatGPT(page, job.prompt, `주제 이미지 생성 ${job.id}`);
    await maybeConfirmGeneration(page);
    await waitForImageCompletion(page);

    const downloadedPaths = await downloadChatGPTImages(page, tempDir);
    const firstImagePath = downloadedPaths.find((value) => value && value.trim().length > 0);
    if (!firstImagePath) {
      throw new Error("ChatGPT 생성 이미지 다운로드 결과가 비어 있습니다.");
    }

    const extension = path.extname(firstImagePath) || ".png";
    const finalPath = `${job.outStem}${extension}`;
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.copyFileSync(firstImagePath, finalPath);

    return {
      id: job.id,
      localPath: finalPath,
    };
  } catch (error) {
    return {
      id: job.id,
      localPath: null,
      error: error instanceof Error ? error.stack || error.message : String(error),
    };
  }
}

async function main() {
  const { jobsFile, gptUrl } = parseArgs(process.argv.slice(2));
  const jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8")) as BatchJob[];
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("jobs-file 에 유효한 작업이 없습니다.");
  }

  const handle = await createChatGPTContext(true);
  try {
    const page = await handle.context.newPage();
    const results: BatchResult[] = [];
    for (const [index, job] of jobs.entries()) {
      results.push(await runJob(page, job, gptUrl, index === 0));
    }
    process.stdout.write(JSON.stringify({ ok: true, jobs: results }));
  } finally {
    await handle.close().catch(() => {});
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
