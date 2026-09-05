import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import { imagePageSignals, keepFailedDiagnosticOpen, imageBatchSucceeded } from "./lib/image-batch-diagnostics";
import {
  countRenderableChatGPTImages,
  createChatGPTContext,
  isChatGPTGenerating,
  downloadChatGPTImages,
  openFreshChatGPTTarget,
  readAssistantMessages,
  submitPromptToChatGPT,
  waitForChatGPTImageArtifacts,
} from "./lib/chatgpt-browser";
import {
  imageWaitPolicy, isSessionWideImageFailure, withinImageDeadline,
  IMAGE_PREPARATION_MS, IMAGE_DOWNLOAD_ATTEMPT_MS, IMAGE_DOWNLOAD_ATTEMPTS, IMAGE_RETRY_DELAY_MS,
} from "./lib/image-timeout-policy";

interface BatchJob {
  id: string;
  prompt: string;
  outStem: string;
  referenceImagePaths?: string[];
}

interface CliArgs {
  jobsFile: string;
  gptUrl: string;
  resultsFile: string;
}

interface BatchResult {
  id: string;
  localPath: string | null;
  error?: string;
  retryable?: boolean;
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
}

export function acquireImageCheckpointLock(lockPath: string): () => void {
  const token = crypto.randomUUID();
  const create = () => {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }), "utf8");
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  };
  try { create(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Serialize orphan inspection/unlink. Unknown/permission-denied owners stay locked.
    const recoveryPath = `${lockPath}.recovery`;
    const guard = fs.openSync(recoveryPath, "wx", 0o600);
    try {
      let owner: { pid?: number };
      try { owner = JSON.parse(fs.readFileSync(lockPath, "utf8")); }
      catch { throw error; }
      if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0) throw error;
      try { process.kill(owner.pid!, 0); throw error; }
      catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      fs.unlinkSync(lockPath);
      create();
    } finally { fs.closeSync(guard); fs.unlinkSync(recoveryPath); }
  }
  return () => {
    const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (owner.token === token) fs.unlinkSync(lockPath);
  };
}

export function imageJobFingerprint(job: BatchJob): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    prompt: job.prompt, outStem: path.resolve(job.outStem),
    references: (job.referenceImagePaths || []).map(file => ({
      path: path.resolve(file),
      digest: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    })),
  })).digest("hex");
}

/** Ambiguous attempts must be recovered manually, never silently regenerated. */
export function readImageBatchResume(resultsFile: string, jobs: BatchJob[]): Map<string, BatchResult> {
  const resumed = new Map<string, BatchResult>();
  if (!fs.existsSync(resultsFile)) return resumed;
  const records = fs.readFileSync(resultsFile, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
  for (const job of jobs) {
    const matches = records.filter(record => record.id === job.id);
    if (!matches.length) continue;
    const fingerprint = imageJobFingerprint(job);
    if (matches.some(record => record.fingerprint !== fingerprint)) {
      throw new Error(`Image checkpoint does not match job ${job.id}; refusing to resend.`);
    }
    const last = matches[matches.length - 1];
    if (last.retryable === true) continue;
    let valid = false;
    if (typeof last.localPath === "string" && typeof last.sha256 === "string") {
      try {
        const bytes = fs.readFileSync(last.localPath);
        valid = bytes.length > 0 && crypto.createHash("sha256").update(bytes).digest("hex") === last.sha256;
      } catch { /* Missing output is not permission to generate again. */ }
    }
    resumed.set(job.id, valid ? { id: job.id, localPath: last.localPath } : {
      id: job.id, localPath: null,
      error: "IMAGE_RESUME_REQUIRED: 이전 요청 또는 결과를 확인해야 합니다. 자동 재전송하지 않았습니다.",
    });
  }
  return resumed;
}

/** Fail-fast only applies to explicitly observed session-wide authentication/security errors. */
export function isBatchFailFastEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.BRAND_POST_IMAGE_BATCH_FAIL_FAST || "true").trim().toLowerCase() !== "false";
}
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
    resultsFile: argv.includes("--results-file")
      ? getValue("--results-file")
      : `${getValue("--jobs-file")}.results.jsonl`,
  };
}

async function maybeConfirmGeneration(page: import("playwright").Page, beforeSend: () => void) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await isChatGPTGenerating(page) || await countRenderableChatGPTImages(page) > 0) return;
    const latestAssistantMessage = ((await readAssistantMessages(page)).at(-1) || "").replace(/\s+/g, "");
    const pageBodyText = ((await page.textContent("body").catch(() => "")) || "").replace(/\s+/g, "");
    const confirmationText = latestAssistantMessage || pageBodyText;
    if (/생성계획미리보기|이대로진행할까요|네라고입력/i.test(confirmationText)) {
      console.error("[chatgpt-image-batch] confirmation detected, sending follow-up.");
      await submitPromptToChatGPT(page, "네", "주제 이미지 생성 확인", beforeSend);
      return;
    }

    const imageCount = await countRenderableChatGPTImages(page);
    if (imageCount > 0) return;
    await page.waitForTimeout(1500);
  }

  console.error("[chatgpt-image-batch] confirmation prompt not detected, continuing without follow-up.");
}

async function waitForImageCompletion(page: import("playwright").Page) {
  const policy = imageWaitPolicy();
  const observed = await waitForChatGPTImageArtifacts(page, policy.baseMs, { hardTimeoutMs: policy.hardMs });
  // The wait returns 0 on timeout. Downloading anyway only produces an empty result later.
  if (typeof observed === "number" && observed === 0) {
    throw new Error(
      "IMAGE_TIMEOUT: 이미지 대기시간 내 완료된 결과를 확인하지 못했습니다. " +
      "요청을 재전송하지 않았습니다. 기존 대화의 생성 결과를 먼저 확인하세요.",
    );
  }
}

async function runJob(
  page: import("playwright").Page,
  job: BatchJob,
  gptUrl: string,
  beforeSend: () => void,
): Promise<BatchResult> {
  const tempDir = path.join(
    path.dirname(job.outStem),
    `_chatgpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(tempDir, { recursive: true });
  const started = Date.now();
  let phase = "preparation";
  let phaseStarted = started;
  let transmitted = false;
  let cancelled = false;
  const trace = async (stage: string) => {
    try {
      const signals = await withinImageDeadline(async () => ({
        ...await imagePageSignals(page),
        generating: await isChatGPTGenerating(page),
        renderableImages: await countRenderableChatGPTImages(page),
      }), 5_000, "diagnostic signals");
      fs.appendFileSync(path.join(tempDir, "progress.jsonl"), JSON.stringify({
        stage, elapsedMs: Date.now() - started, ...signals,
      }) + "\n", { encoding: "utf8", mode: 0o600 });
    } catch { /* Observation must not change the generation outcome. */ }
  };

  try {
    await withinImageDeadline(async () => {
      await openFreshChatGPTTarget(page, gptUrl, "주제 이미지 생성 GPT");

      await attachReferenceImages(page, job.referenceImagePaths || []);
      await trace("before-submit");
      await submitPromptToChatGPT(page, job.prompt, `주제 이미지 생성 ${job.id}`, () => {
        if (cancelled) throw new Error("Image preparation already ended");
        beforeSend();
        transmitted = true;
      });
      await trace("after-submit");
      await maybeConfirmGeneration(page, () => {
        if (cancelled) throw new Error("Image preparation already ended");
      });
      await trace("after-confirmation-check");
    }, IMAGE_PREPARATION_MS, phase);
    phase = "generation";
    phaseStarted = Date.now();
    await waitForImageCompletion(page);
    await trace("image-detected");

    phase = "download";
    phaseStarted = Date.now();
    let downloadedPaths: string[] = [];
    // Retry only retrieval of existing artifacts, never submit/regenerate a prompt.
    for (let attempt = 0; attempt < IMAGE_DOWNLOAD_ATTEMPTS; attempt += 1) {
      downloadedPaths = await withinImageDeadline(() => downloadChatGPTImages(page, tempDir), IMAGE_DOWNLOAD_ATTEMPT_MS, phase);
      if (downloadedPaths.length) break;
      if (attempt + 1 < IMAGE_DOWNLOAD_ATTEMPTS) await page.waitForTimeout(IMAGE_RETRY_DELAY_MS);
    }
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
    cancelled = true;
    await trace("failed");
    const sessionWide = isSessionWideImageFailure(error);
    const timedOut = error instanceof Error && /IMAGE_TIMEOUT:/.test(error.message);
    const elapsedSeconds = Math.round((Date.now() - phaseStarted) / 1000);
    const phaseLabel = phase === "generation" ? "이미지 생성 대기" : phase === "download" ? "이미지 다운로드" : "이미지 준비";
    const budgetMs = phase === "generation" ? imageWaitPolicy().hardMs : phase === "download" ? IMAGE_DOWNLOAD_ATTEMPT_MS : IMAGE_PREPARATION_MS;
    const message = sessionWide
      ? "CHATGPT_BROWSER_AUTH_REQUIRED: 명시적인 로그인 또는 보안 확인이 필요합니다."
      : `${timedOut ? "IMAGE_TIMEOUT" : "IMAGE_SLOT_FAILED"}: ${phaseLabel} ${timedOut ? "시간 초과" : "실패"} ` +
        `(경과 ${elapsedSeconds}초 / 최대 ${Math.round(budgetMs / 1000)}초). 요청을 재전송하지 않았습니다.`;
    // No raw exception, URLs, prompt, DOM, screenshot, cookies or account identifiers.
    try {
      fs.writeFileSync(path.join(tempDir, "failure.json"), JSON.stringify({
        version: 1, phase, elapsedMs: Date.now() - started,
        category: sessionWide ? "session-auth-security" : "individual",
        timedOut,
        ...imageWaitPolicy(),
      }, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch { /* Diagnostics must not mask the slot failure. */ }
    return {
      id: job.id,
      localPath: null,
      error: message,
      retryable: !transmitted,
    };
  }
}

async function runBatch() {
  const { jobsFile, gptUrl, resultsFile } = parseArgs(process.argv.slice(2));
  const jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8")) as BatchJob[];
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("jobs-file 에 유효한 작업이 없습니다.");
  }
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error("Duplicate image job IDs.");
  const fingerprints = new Map(jobs.map(job => [job.id, imageJobFingerprint(job)]));

  fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
  // Append preserves evidence and supports retrying the same jobs-file safely.
  const checkpoint = fs.openSync(resultsFile, "a", 0o600);
  const results: BatchResult[] = [];
  const journalPath = (job: BatchJob) => `${job.outStem}.checkpoint.jsonl`;
  const journal = (job: BatchJob, value: object) => {
    const fd = fs.openSync(journalPath(job), "a", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ recordedAt: new Date().toISOString(), ...value, id: "slot", fingerprint: fingerprints.get(job.id) }) + "\n", "utf8");
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  };
  const record = (result: BatchResult, persist = true) => {
    const line = `${JSON.stringify(result)}\n`;
    // Retain the raw result for final stdout recovery even if the checkpoint disk fails.
    results.push(result);
    if (persist) journal(jobs.find(job => job.id === result.id)!, { ...result,
      sha256: result.localPath ? crypto.createHash("sha256").update(fs.readFileSync(result.localPath)).digest("hex") : undefined });
    fs.writeFileSync(checkpoint, line, "utf8");
    fs.fsyncSync(checkpoint);
    // Keep stdout as the single legacy JSON document; progress is explicitly framed on stderr.
    process.stderr.write(`[chatgpt-image-batch:result] ${line}`);
  };
  let handle: Awaited<ReturnType<typeof createChatGPTContext>> | undefined;
  let failure: unknown;
  try {
    const failFast = isBatchFailFastEnabled();
    for (const [index, job] of jobs.entries()) {
      const recovered = readImageBatchResume(journalPath(job), [{ ...job, id: "slot" }]).get("slot");
      if (recovered) { record({ ...recovered, id: job.id }, false); continue; }
      const slotStarted = Date.now();
      handle ||= await createChatGPTContext(true);
      // Isolate timed-out operations from later slots. Closing this page cancels local
      // preparation/download actions, but never retries the remote generation request.
      const page = await handle.context.newPage();
      const result = await runJob(page, job, gptUrl, () => journal(job, { state: "attempted" }));
      record({ ...result, startedAt: new Date(slotStarted).toISOString(), completedAt: new Date().toISOString(), elapsedMs: Date.now() - slotStarted });
      if (result.error && keepFailedDiagnosticOpen(process.env, jobs.length) && !page.isClosed()) {
        console.error("[chatgpt-image-batch] 진단 실패: 브라우저를 유지합니다. 확인 후 이 탭/창을 닫으면 진단이 종료됩니다. 추가 생성 요청은 보내지 않습니다.");
        await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
      }
      await withinImageDeadline(() => page.close(), 10_000, "page cleanup").catch(() => {});
      if (result.error && failFast && isSessionWideImageFailure(result.error)) {
        const reason = result.error.split("\n")[0].trim().slice(0, 200);
        for (const remaining of jobs.slice(index + 1)) {
          // Do not overwrite another slot's successful/uncertain prior journal.
          record({ id: remaining.id, localPath: null, retryable: true, error: `fail-fast: 세션 인증/보안 확인이 필요해 중단했습니다 (${reason})` }, false);
        }
        failure = new Error(`이미지 생성 배치를 세션 인증/보안 오류로 중단했습니다: ${reason}`);
        break;
      }
    }
  } catch (error) {
    failure = error;
    for (const job of jobs.slice(results.length)) {
      record({ id: job.id, localPath: null, retryable: true, error: error instanceof Error ? error.message : String(error) }, false);
    }
  } finally {
    fs.closeSync(checkpoint);
    const ok = imageBatchSucceeded(failure, results);
    process.stdout.write(JSON.stringify({ ok, jobs: results }));
    if (!ok) process.exitCode = 1;
    await handle?.close().catch(() => {});
  }
  if (failure) throw failure;
}

export async function main() {
  const { resultsFile, jobsFile } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
  const releases: Array<() => void> = [];
  try {
    releases.push(acquireImageCheckpointLock(`${resultsFile}.lock`));
    const jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8")) as BatchJob[];
    for (const stem of [...new Set(jobs.map(job => path.resolve(job.outStem)))].sort()) {
      fs.mkdirSync(path.dirname(stem), { recursive: true });
      releases.push(acquireImageCheckpointLock(`${stem}.lock`));
    }
    await runBatch();
  } finally { for (const release of releases.reverse()) release(); }
}

if (require.main === module) console.log = (...args: unknown[]) => console.error(...args);
if (require.main === module) main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
