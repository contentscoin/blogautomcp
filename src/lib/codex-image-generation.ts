/**
 * Codex 로그인(ChatGPT OAuth)으로 이미지를 만드는 전송 경로. API 키가 필요 없다.
 * Codex CLI 내장 image_generation 도구의 서버 모델은 gpt-image-2 다(모델을 따로 지정할 수 없다).
 *
 * 작업마다 독립 Codex 스레드를 연다. 스레드는 작업 전용 폴더에서만 쓰기가 가능하고 네트워크 명령은 꺼져 있다.
 * 결과는 작업 폴더와 CODEX_HOME/generated_images/<threadId>/ 에서 찾는다. 상품은 서로 다른 결과가 있으면 채택하지 않는다.
 * 찾은 파일은 브라우저 경로와 같은 `${outStem}.png` 로 옮겨, 이어서 생성·중복 방지 규칙을 그대로 쓴다.
 * 생성 뒤 photoreal 점검표로 1회 확인하고, 걸린 항목만 긍정문으로 보강해 1회만 다시 만든다.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import crypto from "node:crypto";
import { atomicWriteTextFile } from "./atomic-text-file";
import draftRuntimePolicy from "../../scripts/lib/draft-runtime-policy.json";
import {
  classifyCodexDraftFailure,
  codexDraftTerminalFailureCode,
  runCodexDraft,
} from "../../scripts/lib/codex-draft-provider";
import { imageJobBudgetMs } from "../../scripts/lib/image-timeout-policy";
import { buildPhotorealQcPrompt, parsePhotorealQc, reinforcePhotorealPrompt } from "../../scripts/lib/photoreal/checklist";
import { resolveCodexTextModel, resolveTextReasoningEffort } from "../../scripts/lib/text-model-policy";

export const CODEX_IMAGE_MODEL_LABEL = "gpt-image-2";
export const CODEX_IMAGE_CONCURRENCY = 3;
const RESULT_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
const MIN_IMAGE_BYTES = 1024;

export type BrandPostImageEngine = "codex" | "browser";

export interface ImageBatchJob {
  id: string;
  prompt: string;
  outStem: string;
  referenceImagePaths: string[];
  referenceMode?: "product";
  requiredReferenceHashes?: string[];
  /** Only the coordinator may verify and consume an existing result; transports cannot generate it. */
  reviewOnly?: { outputSha256: string; slotId: string; sourceSnapshotId: string; referenceHashes: string[];
    candidateSet?: CompletedProductCandidateSet };
}

export interface CompletedProductCandidateSet {
  receiptSha256: string;
  completion: { source: "receipt" | "rollout"; completedAtMs: number; rolloutPath?: string; rolloutSha256?: string };
  candidates: Array<{ path: string; sha256: string }>;
}

export interface ImageBatchResult {
  id: string;
  localPath: string | null;
  error?: string;
  /** Only an explicit failure before provider submission allows another transport. */
  submissionState?: "not-submitted" | "uncertain";
  /** 점검표에서 보강 재생성 뒤에도 남은 항목(경고만, 채택은 한다) */
  qcWarnings?: string[];
}

/** 정책 JSON(BRAND_POST_IMAGE_ENGINE) → env 덮어쓰기. 기본은 codex. */
export function resolveBrandPostImageEngine(env: Readonly<Record<string, string | undefined>> = process.env): BrandPostImageEngine {
  const policy = (draftRuntimePolicy as Record<string, string>).BRAND_POST_IMAGE_ENGINE;
  const value = String(env.BRAND_POST_IMAGE_ENGINE || policy || "codex").trim().toLowerCase();
  return value === "browser" || value === "chatgpt-browser" ? "browser" : "codex";
}

/** A Codex-image result is already on disk for this job identity (resume without regenerating). */
export function existingJobResult(outStem: string): string | null {
  for (const extension of RESULT_EXTENSIONS) {
    const file = `${outStem}${extension}`;
    try {
      if (fs.statSync(file).size >= MIN_IMAGE_BYTES) return file;
    } catch { /* not generated yet */ }
  }
  return null;
}

/** 브라우저 경로가 이미 요청을 보낸 작업. 같은 작업을 Codex 로 다시 보내면 중복 생성이 된다. */
export function hasBrowserSubmission(outStem: string): boolean {
  return fs.existsSync(`${outStem}.checkpoint.jsonl`);
}

interface CodexThreadLike {
  runStreamed(input: unknown, options?: { signal?: AbortSignal }): Promise<{ events: AsyncIterable<Record<string, unknown>> }>;
}
interface CodexLike {
  startThread(options: Record<string, unknown>): CodexThreadLike;
}

export interface CodexImageBatchOptions {
  onResult: (result: ImageBatchResult, index: number) => Promise<void>;
  signal?: AbortSignal;
  concurrency?: number;
  /** 사람이 주인공인 컷이면 true(점검표 인물 항목까지 본다). 블로그 컷은 기본 false. */
  people?: boolean;
  /** 생성 후 점검표 QC. 기본 켬(BRAND_POST_IMAGE_QC=false 로 끔). */
  qc?: boolean;
  /** Test hooks */
  createCodex?: () => Promise<CodexLike>;
  runQc?: (imagePath: string, people: boolean) => Promise<string[]>;
  codexHome?: string;
  jobTimeoutMs?: number;
}

const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<typeof import("@openai/codex-sdk")>;

async function defaultCreateCodex(): Promise<CodexLike> {
  const { Codex } = await nativeImport("@openai/codex-sdk");
  return new Codex({
    config: {
      project_doc_max_bytes: 0,
      features: { image_generation: true },
      skills: {
        config: [{
          path: path.join(codexHomeDir(), "skills", "opus-fable", "SKILL.md"),
          enabled: false,
        }],
      },
    },
    configOverrides: ['plugins."opus-fable-performance@local-opencrab".enabled=false'],
  }) as unknown as CodexLike;
}

function codexHomeDir(override?: string): string {
  return override || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export async function defaultPhotorealQc(imagePath: string, people: boolean): Promise<string[]> {
  const prompt = buildPhotorealQcPrompt({ people });
  const text = await runCodexDraft({
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    imagePaths: [imagePath],
    maxImages: 1,
    preserveImageOrder: true,
    timeoutMs: 120_000,
  });
  return parsePhotorealQc(text, { people });
}

export function buildCodexImageInstruction(prompt: string, referenceCount: number, referenceMode?: "product"): string {
  return [
    "이미지 생성 도구(image_generation)로 아래 장면의 사진을 정확히 1장 생성하고, 현재 작업 폴더에 ./out.png 로 저장하세요.",
    referenceMode === "product"
      ? "기존 생성 결과의 파일 경로 확인과 out.png로의 파일 복사에 필요한 명령만 허용합니다. 경로 조회를 위해 이미지 생성 도구를 호출하지 마세요. 추가 생성·코드 수정·웹 검색을 하지 마세요. 다른 파일을 만들지 마세요."
      : "이미지 저장에 필요한 파일 복사 외에는 명령 실행·코드 수정·웹 검색을 하지 마세요. 다른 파일을 만들지 마세요.",
    referenceMode === "product"
      ? "이 작업 전체에서 이미지 생성 도구는 정확히 1회만 호출하세요. 이미 생성한 파일의 경로나 저장 방법을 알아내기 위해 이미지 생성 도구를 다시 호출하지 마세요. 두 번째 호출은 조회가 아니라 새로운 이미지 생성입니다."
      : "",
    referenceMode === "product"
      ? "도구의 실제 반환값(image_url, output_hint 등)을 읽으세요. 반환값을 MCP content[] 배열이라고 가정하지 마세요. 이미지가 이미 저장됐다면 반환 힌트나 이 생성 스레드의 generated_images 폴더에서 그 파일만 찾아 out.png로 복사하세요. image_url의 base64 데이터나 전체 반환값을 텍스트로 출력하지 마세요. 기존 파일을 찾지 못하면 추가 생성 없이 실패를 보고하세요."
      : "",
    referenceCount > 0
      ? referenceMode === "product"
        ? `첨부한 ${referenceCount}장을 이미지 생성 도구의 실제 참조 이미지로 모두 전달하세요. 첫 사진은 상품의 형상·비율·원래 라벨의 기준이고 두 번째가 있으면 승인된 동일 글의 장면 기준입니다. 참조 없이 새 상품을 그리지 마세요.`
        : `첨부한 ${referenceCount}장은 장소 분위기 참고용입니다. 그대로 복제하지 말고, 글자·로고를 옮기지 마세요.`
      : "",
    "저장이 끝나면 저장한 파일 경로만 한 줄로 보고하세요.",
    "",
    "[이미지 프롬프트]",
    prompt,
  ].filter(Boolean).join("\n");
}

interface CodexImageSubmission { state: "submitting" | "completed" | "not-submitted"; workspace: string; startedAtMs: number; threadId: string | null; completedAtMs?: number }
function readCodexSubmission(outStem: string): CodexImageSubmission | null {
  try {
    const receipt = JSON.parse(fs.readFileSync(`${outStem}.codex-submission.json`, "utf8")) as CodexImageSubmission;
    return ["submitting", "completed", "not-submitted"].includes(receipt.state) && typeof receipt.workspace === "string" &&
      Number.isFinite(receipt.startedAtMs) && (receipt.threadId === null || typeof receipt.threadId === "string") &&
      (receipt.completedAtMs === undefined || Number.isFinite(receipt.completedAtMs) && receipt.completedAtMs >= receipt.startedAtMs) ? receipt : null;
  } catch { return null; }
}
export function hasUnresolvedCodexSubmission(outStem: string): boolean {
  if (!fs.existsSync(`${outStem}.codex-submission.json`)) return false;
  return readCodexSubmission(outStem)?.state !== "not-submitted" && !existingJobResult(outStem);
}

export function assertProductImageReferences(job: ImageBatchJob): void {
  if (job.referenceMode !== "product") return;
  if (!job.referenceImagePaths.length || job.referenceImagePaths.length > 3 ||
      job.requiredReferenceHashes?.length !== job.referenceImagePaths.length)
    throw new Error("PRODUCT_REFERENCE_REQUIRED: 상품 참조와 검증 해시가 모두 필요합니다.");
  for (const [index, file] of job.referenceImagePaths.entries()) {
    if (!isImageFile(file) || crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== job.requiredReferenceHashes[index])
      throw new Error("PRODUCT_REFERENCE_CHANGED: 실제 전달할 상품 참조가 누락되거나 변경되었습니다.");
  }
}

function isImageFile(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < MIN_IMAGE_BYTES) return false;
    const head = Buffer.alloc(12);
    const fd = fs.openSync(file, "r");
    try { fs.readSync(fd, head, 0, 12, 0); } finally { fs.closeSync(fd); }
    const png = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = head[0] === 0xff && head[1] === 0xd8;
    const webp = head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
    return png || jpeg || webp;
  } catch {
    return false;
  }
}

/** Product jobs require one unique result across the exact thread, workspace and any saved raw output. */
export function locateCodexImage(workspace: string, codexHome: string, threadId: string | null, startedAtMs: number,
  options: { referenceMode?: "product"; existingOutput?: string } = {}): string | null {
  if (options.referenceMode === "product") {
    const generated = threadId ? safeList(path.join(codexHome, "generated_images", threadId))
      .filter((file) => RESULT_EXTENSIONS.includes(path.extname(file).toLowerCase()) && isImageFile(file))
      .filter((file) => fs.statSync(file).mtimeMs >= startedAtMs - 1000) : [];
    const candidates = [
      ...RESULT_EXTENSIONS.map((extension) => path.join(workspace, `out${extension}`)),
      ...safeList(workspace),
      ...generated,
      ...(options.existingOutput ? [options.existingOutput] : []),
    ].filter(isImageFile);
    const unique = new Map<string, string>();
    for (const file of new Set(candidates)) {
      const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      if (!unique.has(hash)) unique.set(hash, file);
    }
    if (unique.size > 1) throw new Error("IMAGE_OUTPUT_AMBIGUOUS: 같은 상품 이미지 요청에서 서로 다른 생성 결과가 발견됐습니다. 기존 파일을 보존했으며 채택하거나 재전송하지 않았습니다.");
    return unique.values().next().value ?? null;
  }
  const direct = RESULT_EXTENSIONS.map((extension) => path.join(workspace, `out${extension}`)).find(isImageFile);
  if (direct) return direct;
  const inWorkspace = safeList(workspace).filter(isImageFile);
  if (inWorkspace.length === 1) return inWorkspace[0]!;
  if (!threadId) return null;
  const generated = safeList(path.join(codexHome, "generated_images", threadId))
    .filter((file) => RESULT_EXTENSIONS.includes(path.extname(file).toLowerCase()) && isImageFile(file))
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .filter((entry) => entry.mtime >= startedAtMs - 1000)
    .sort((a, b) => b.mtime - a.mtime);
  return generated[0]?.file ?? null;
}

function safeList(directory: string): string[] {
  try {
    return fs.readdirSync(directory).map((name) => path.join(directory, name));
  } catch {
    return [];
  }
}

/** Read-only cache guard shared by every transport, including an explicit switch to browser. */
export function checkedExistingJobResult(job: ImageBatchJob, options: CodexImageBatchOptions): string | null {
  const existing = existingJobResult(job.outStem);
  if (!existing || job.referenceMode !== "product") return existing;
  const receiptPath = `${job.outStem}.codex-submission.json`;
  if (!fs.existsSync(receiptPath)) return existing;
  const prior = readCodexSubmission(job.outStem);
  if (!prior) throw new Error("IMAGE_RESUME_REQUIRED: 이전 상품 이미지 요청 기록을 읽을 수 없습니다. 기존 결과를 보존했으며 재전송하지 않았습니다.");
  const found = locateCodexImage(prior.workspace, codexHomeDir(options.codexHome), prior.threadId, prior.startedAtMs,
    { referenceMode: "product", existingOutput: existing });
  if (!found) throw new Error("IMAGE_RESUME_REQUIRED: 이전 상품 이미지 요청의 유효한 결과를 확인할 수 없습니다. 기존 결과를 보존했으며 재전송하지 않았습니다.");
  if (prior.state !== "completed") throw new Error("IMAGE_RESUME_REQUIRED: 이전 상품 이미지 요청의 완료를 확인할 수 없습니다. 기존 결과를 보존했으며 채택하거나 재전송하지 않았습니다.");
  return existing;
}

/** Native outputs of one proven completed request. Workspace helpers and references are never candidates. */
function completedProductRollout(prior: CodexImageSubmission, codexHome: string, exactRolloutPath?: string): CompletedProductCandidateSet["completion"] | null {
  const matching: string[] = [];
  if (exactRolloutPath) matching.push(exactRolloutPath);
  else for (const offset of [-1, 0, 1]) {
    const date = new Date(prior.startedAtMs + offset * 86_400_000).toISOString().slice(0, 10).split("-");
    const directory = path.join(codexHome, "sessions", ...date);
    matching.push(...safeList(directory).filter(file => path.basename(file).startsWith("rollout-") && path.basename(file).endsWith(`-${prior.threadId}.jsonl`)));
  }
  if (!matching.length) return null;
  const refused = () => new Error("IMAGE_RESUME_REQUIRED: 기존 이미지 요청의 실제 완료 기록을 확인할 수 없습니다. 기록을 보존했으며 후보를 채택하지 않았습니다.");
  if (matching.length !== 1) throw refused();
  const rolloutPath = matching[0];
  if (path.resolve(fs.realpathSync(rolloutPath)) !== path.resolve(rolloutPath) || fs.statSync(rolloutPath).size > 32 * 1024 * 1024) throw refused();
  const bytes = fs.readFileSync(rolloutPath);
  try {
    const records = bytes.toString("utf8").split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
    const metadata = records.filter(record => record.type === "session_meta");
    if (metadata.length !== 1 || metadata[0].payload?.id !== prior.threadId || metadata[0].payload?.thread_source !== "blogautomcp-image" ||
        typeof metadata[0].payload?.cwd !== "string" || path.resolve(metadata[0].payload.cwd) !== path.resolve(prior.workspace) ||
        Date.parse(metadata[0].timestamp) < prior.startedAtMs - 1000 || !Number.isFinite(Date.parse(metadata[0].timestamp)) ||
        (exactRolloutPath && Date.parse(metadata[0].timestamp) > prior.startedAtMs + 60_000)) throw refused();
    const lifecycle = records.filter(record => record.type === "event_msg" &&
      /^(?:task_started|task_complete|task_failed|task_cancelled|turn_failed|turn_aborted)$/u.test(record.payload?.type || ""));
    if (lifecycle.length !== 2 || lifecycle[0].payload.type !== "task_started" || lifecycle[1].payload.type !== "task_complete" ||
        typeof lifecycle[0].payload.turn_id !== "string" || !lifecycle[0].payload.turn_id ||
        lifecycle[0].payload.turn_id !== lifecycle[1].payload.turn_id) throw refused();
    const startedAtMs = Date.parse(lifecycle[0].timestamp), completedAtMs = Date.parse(lifecycle[1].timestamp);
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs) || startedAtMs < prior.startedAtMs - 1000 || completedAtMs < startedAtMs) throw refused();
    return { source: "rollout", completedAtMs, rolloutPath, rolloutSha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  } catch { throw refused(); }
}

export interface LegacyCodexImageCompletionProof {
  outputSha256: string;
  workspaces: Array<{ workspace: string; threadId: string; completion: CompletedProductCandidateSet["completion"]; nativePath: string; nativeSha256: string }>;
}

function firstRolloutMetadata(file: string): { id?: string; cwd?: string; thread_source?: string } | null {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(file, "r");
    const chunks: Buffer[] = [];
    // Only inspect the first metadata line of nearby filenames, never another session's conversation.
    for (let offset = 0; offset < 128 * 1024; offset += 4096) {
      const chunk = Buffer.alloc(4096), count = fs.readSync(descriptor, chunk, 0, chunk.length, offset);
      if (!count) break;
      const newline = chunk.subarray(0, count).indexOf(10);
      chunks.push(chunk.subarray(0, newline >= 0 ? newline : count));
      if (newline >= 0) {
        const record = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        return record.type === "session_meta" ? record.payload : null;
      }
    }
  } catch { /* Metadata absence or corruption never proves completion. */ }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  return null;
}

/** Read-only retirement proof for versions which saved raw bytes before durable submission receipts existed. */
export function readLegacyCodexImageCompletion(outStem: string, options: { codexHome?: string } = {}): LegacyCodexImageCompletionProof | null {
  try {
    // A real receipt, checkpoint or lock must retain its own stricter admission/resume semantics.
    if ([".codex-submission.json", ".checkpoint.jsonl", ".lock", ".lock.recovery", ".resolution.lock", ".resolution.lock.recovery"]
      .some(extension => fs.existsSync(`${outStem}${extension}`))) return null;
    const rawPaths = RESULT_EXTENSIONS.map(extension => `${outStem}${extension}`).filter(file => fs.existsSync(file));
    if (!rawPaths.length || rawPaths.some(file => !isImageFile(file) || path.resolve(fs.realpathSync(file)) !== path.resolve(file))) return null;
    const hashes = new Set(rawPaths.map(file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")));
    if (hashes.size !== 1) return null;
    const outputSha256 = [...hashes][0], codexHome = codexHomeDir(options.codexHome);
    const parent = path.dirname(outStem), name = path.basename(outStem);
    const workspaces = fs.readdirSync(parent).filter(entry => entry.startsWith(`${name}.codex-`) && /^\d+$/u.test(entry.slice(`${name}.codex-`.length)))
      .map(entry => path.join(parent, entry));
    if (!workspaces.length) return null;
    const proofs: LegacyCodexImageCompletionProof["workspaces"] = [];
    for (const workspace of workspaces) {
      const createdAtMs = fs.statSync(workspace).birthtimeMs;
      if (!fs.statSync(workspace).isDirectory() || !Number.isFinite(createdAtMs) || createdAtMs <= 0 ||
          path.resolve(fs.realpathSync(workspace)) !== path.resolve(workspace)) return null;
      const dayDirectories = new Set<string>();
      for (const offset of [-1, 0, 1]) {
        const date = new Date(createdAtMs + offset * 86_400_000);
        dayDirectories.add(path.join(codexHome, "sessions", ...date.toISOString().slice(0, 10).split("-")));
        dayDirectories.add(path.join(codexHome, "sessions", String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")));
      }
      const matching: Array<{ path: string; threadId: string }> = [];
      for (const directory of dayDirectories) for (const file of safeList(directory)) {
        const match = /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-([a-z0-9_-]+)\.jsonl$/iu.exec(path.basename(file));
        if (!match) continue;
        const stamp = `${match[1].slice(0, 13)}:${match[1].slice(14, 16)}:${match[1].slice(17, 19)}`;
        if (![Date.parse(stamp), Date.parse(`${stamp}Z`)].some(value => Number.isFinite(value) && Math.abs(value - createdAtMs) <= 30_000) ||
            path.resolve(fs.realpathSync(file)) !== path.resolve(file)) continue;
        const metadata = firstRolloutMetadata(file);
        if (metadata?.cwd && path.resolve(metadata.cwd) === path.resolve(workspace) && metadata.id === match[2] && metadata.thread_source === "blogautomcp-image")
          matching.push({ path: file, threadId: match[2] });
      }
      if (matching.length !== 1) return null;
      const match = matching[0];
      const completion = completedProductRollout({ state: "completed", workspace, startedAtMs: createdAtMs, threadId: match.threadId }, codexHome, match.path);
      if (!completion || completion.completedAtMs > Date.now() + 1000 || fs.statSync(workspace).mtimeMs > completion.completedAtMs + 1000) return null;
      const nativeDirectory = path.join(codexHome, "generated_images", match.threadId);
      if (path.resolve(fs.realpathSync(nativeDirectory)) !== path.resolve(nativeDirectory)) return null;
      const native = safeList(nativeDirectory).filter(file => RESULT_EXTENSIONS.includes(path.extname(file).toLowerCase()));
      if (native.some(file => !isImageFile(file) || fs.statSync(file).mtimeMs < createdAtMs - 1000 ||
          fs.statSync(file).mtimeMs > completion.completedAtMs + 1000)) return null;
      const nativeHashes = new Map<string, string>();
      for (const file of native) {
        if (path.dirname(fs.realpathSync(file)) !== fs.realpathSync(nativeDirectory)) return null;
        nativeHashes.set(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), file);
      }
      const out = path.join(workspace, "out.png");
      if (nativeHashes.size !== 1 || !isImageFile(out) || path.dirname(fs.realpathSync(out)) !== fs.realpathSync(workspace) ||
          fs.statSync(out).mtimeMs < createdAtMs - 1000 || fs.statSync(out).mtimeMs > completion.completedAtMs + 1000) return null;
      const nativeSha256 = [...nativeHashes.keys()][0];
      if (crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex") !== nativeSha256) return null;
      proofs.push({ workspace, threadId: match.threadId, completion, nativePath: nativeHashes.get(nativeSha256)!, nativeSha256 });
    }
    return proofs.some(proof => proof.nativeSha256 === outputSha256) ? { outputSha256, workspaces: proofs } : null;
  } catch { return null; }
}

export function collectCompletedProductCandidates(job: ImageBatchJob, options: { codexHome?: string } = {}): CompletedProductCandidateSet | null {
  assertProductImageReferences(job);
  const refused = () => new Error("IMAGE_RESUME_REQUIRED: 완료된 상품 이미지 요청과 실제 생성 후보를 확인할 수 없습니다. 기존 기록을 보존했으며 새 생성 요청을 보내지 않았습니다.");
  if (job.referenceMode !== "product") throw refused();
  const prior = readCodexSubmission(job.outStem);
  if (!prior || prior.state !== "completed" || !prior.threadId || !/^[a-z0-9_-]+$/iu.test(prior.threadId) || prior.startedAtMs <= 0 ||
      !path.resolve(prior.workspace).startsWith(`${path.resolve(job.outStem)}.codex-`) ||
      !/^\d+$/u.test(path.resolve(prior.workspace).slice(`${path.resolve(job.outStem)}.codex-`.length))) throw refused();
  const codexHome = codexHomeDir(options.codexHome);
  const completion = prior.completedAtMs !== undefined ? { source: "receipt" as const, completedAtMs: prior.completedAtMs }
    : completedProductRollout(prior, codexHome);
  const directory = path.join(codexHome, "generated_images", prior.threadId);
  const files = safeList(directory).filter(file => RESULT_EXTENSIONS.includes(path.extname(file).toLowerCase()) && isImageFile(file) &&
    fs.statSync(file).mtimeMs >= prior.startedAtMs - 1000 &&
    (!completion || fs.statSync(file).mtimeMs <= completion.completedAtMs + 1000));
  const unique = new Map<string, { path: string; sha256: string }>();
  if (files.length && path.resolve(fs.realpathSync(directory)) !== path.resolve(directory)) throw refused();
  for (const file of files.sort()) {
    if (path.dirname(fs.realpathSync(file)) !== fs.realpathSync(directory)) throw refused();
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (job.requiredReferenceHashes?.includes(sha256)) continue;
    if (!unique.has(sha256)) unique.set(sha256, { path: file, sha256 });
  }
  if (!unique.size) {
    if (files.length) throw refused(); // A native reference copy is not a generated artifact.
    return null; // Legacy single-file transports retain their existing fail-closed checks.
  }
  if (!completion) {
    if (unique.size > 1) throw refused();
    return null; // Preserve the old proven-single raw route; it cannot resolve native alternatives.
  }
  if (unique.size > 8) throw refused();
  for (const file of RESULT_EXTENSIONS.map(extension => `${job.outStem}${extension}`).filter(file => fs.existsSync(file))) {
    if (!isImageFile(file) || !unique.has(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"))) throw refused();
  }
  return { receiptSha256: crypto.createHash("sha256").update(fs.readFileSync(`${job.outStem}.codex-submission.json`)).digest("hex"),
    completion, candidates: [...unique.values()] };
}

function codexImageError(error: unknown): string {
  const code = codexDraftTerminalFailureCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const kind = classifyCodexDraftFailure(error);
  const hint = kind === "authentication"
    ? " 설정에서 Codex 로그인을 확인하세요."
    : kind === "model-version"
      ? " Codex 버전을 업데이트하세요."
      : "";
  return `CODEX_IMAGE_FAILED${code ? `(${code})` : ""}: ${message.replace(/\s+/gu, " ").trim().slice(0, 400)}${hint}`;
}

async function generateOnce(
  codex: CodexLike,
  job: ImageBatchJob,
  prompt: string,
  options: { codexHome: string; timeoutMs: number; signal?: AbortSignal; attempt: number },
): Promise<string> {
  const workspace = `${job.outStem}.codex-${options.attempt}`;
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  assertProductImageReferences(job);
  const references = job.referenceImagePaths.filter(isImageFile).slice(0, 3);
  const instruction = buildCodexImageInstruction(prompt, references.length, job.referenceMode);
  const input = references.length
    ? [{ type: "text", text: instruction }, ...references.map((file) => ({ type: "local_image", path: file }))]
    : instruction;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs);
  const startedAtMs = Date.now();
  let threadId: string | null = null;
  let providerCompleted = false;
  const submission: CodexImageSubmission = { state: "submitting", workspace, startedAtMs, threadId };
  const saveSubmission = () => atomicWriteTextFile(`${job.outStem}.codex-submission.json`, JSON.stringify(submission));
  try {
    const model = resolveCodexTextModel();
    const thread = codex.startThread({
      model,
      modelReasoningEffort: resolveTextReasoningEffort(),
      sandboxMode: "workspace-write",
      workingDirectory: workspace,
      skipGitRepoCheck: true,
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      threadSource: "blogautomcp-image",
    });
    saveSubmission(); // Persist before a remote request can be accepted.
    const { events } = await thread.runStreamed(input, { signal: controller.signal });
    for await (const event of events) {
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        threadId = event.thread_id;
        submission.threadId = threadId;
        saveSubmission();
      }
      else if (event.type === "turn.failed") {
        const error = event.error as { message?: string } | undefined;
        throw new Error(error?.message || "Codex 이미지 생성이 실패했습니다.");
      } else if (event.type === "error") throw new Error(String(event.message || "Codex 실행 중 오류가 발생했습니다."));
      else if (event.type === "turn.completed") providerCompleted = true;
    }
    if (providerCompleted && !controller.signal.aborted) {
      submission.state = "completed";
      submission.completedAtMs = Date.now();
      saveSubmission();
    } else if (job.referenceMode === "product") throw new Error("IMAGE_RESUME_REQUIRED: 상품 이미지 요청의 완료 이벤트를 확인하지 못했습니다. 파일을 보존했으며 채택하거나 재전송하지 않았습니다.");
    const found = locateCodexImage(workspace, options.codexHome, threadId, startedAtMs, { referenceMode: job.referenceMode });
    if (!found) throw new Error("Codex 응답에서 생성 이미지를 찾지 못했습니다(image_generation 기능이 꺼져 있을 수 있습니다).");
    submission.state = "completed";
    saveSubmission();
    return found;
  } catch (error) {
    if (!threadId && !safeList(workspace).some(isImageFile) && ["authentication", "model-version"].includes(classifyCodexDraftFailure(error))) {
      submission.state = "not-submitted";
      saveSubmission();
    }
    if (controller.signal.aborted) {
      throw Object.assign(new Error(options.signal?.aborted
        ? "사용자가 이미지 생성을 중지했습니다."
        : `Codex 이미지 생성 시간이 ${Math.round(options.timeoutMs / 1000)}초를 초과했습니다.`, { cause: error }), { code: "CODEX_TIMEOUT" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

function adopt(found: string, outStem: string): string {
  const extension = path.extname(found).toLowerCase() || ".png";
  const finalPath = `${outStem}${RESULT_EXTENSIONS.includes(extension) ? extension : ".png"}`;
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const temp = `${finalPath}.tmp-${process.pid}`;
  fs.copyFileSync(found, temp);
  fs.renameSync(temp, finalPath);
  return finalPath;
}

async function runJob(codex: CodexLike, job: ImageBatchJob, options: CodexImageBatchOptions): Promise<ImageBatchResult> {
  try { assertProductImageReferences(job); }
  catch (error) { return { id: job.id, localPath: null, error: codexImageError(error) }; }
  try {
    const existing = checkedExistingJobResult(job, options);
    if (existing) return { id: job.id, localPath: existing };
    if (hasUnresolvedCodexSubmission(job.outStem)) {
      const prior = readCodexSubmission(job.outStem);
      const recovered = prior && locateCodexImage(prior.workspace, codexHomeDir(options.codexHome), prior.threadId, prior.startedAtMs,
        { referenceMode: job.referenceMode });
      if (recovered && (job.referenceMode !== "product" || prior?.state === "completed")) return { id: job.id, localPath: adopt(recovered, job.outStem) };
      return { id: job.id, localPath: null, submissionState: "uncertain",
        error: "IMAGE_RESUME_REQUIRED: 이전 Codex 이미지 요청의 완료 여부를 확인해야 합니다. 기존 결과를 보존했으며 재전송하지 않았습니다." };
    }
  } catch (error) {
    return { id: job.id, localPath: null, submissionState: "uncertain", error: codexImageError(error) };
  }
  const context = {
    codexHome: codexHomeDir(options.codexHome),
    timeoutMs: options.jobTimeoutMs ?? imageJobBudgetMs(process.env),
    signal: options.signal,
  };
  const people = options.people ?? false;
  let finalPath: string;
  try {
    finalPath = adopt(await generateOnce(codex, job, job.prompt, { ...context, attempt: 1 }), job.outStem);
  } catch (error) {
    return { id: job.id, localPath: null, error: codexImageError(error),
      submissionState: hasUnresolvedCodexSubmission(job.outStem) ? "uncertain" : "not-submitted" };
  }
  // Product scenes must pass the separate reference + output fidelity comparison.
  // The permissive generated-only checklist and its auto-regeneration cannot authorize them.
  if (job.referenceMode === "product") return { id: job.id, localPath: finalPath };
  const qcEnabled = options.qc ?? process.env.BRAND_POST_IMAGE_QC !== "false";
  if (!qcEnabled) return { id: job.id, localPath: finalPath };
  const runQc = options.runQc ?? defaultPhotorealQc;
  // QC 자체가 실패하면 통과로 본다(검수가 생성을 막지 않게).
  const failed = await runQc(finalPath, people).catch(() => [] as string[]);
  if (failed.length === 0) return { id: job.id, localPath: finalPath };
  try {
    const retryPath = await generateOnce(codex, job, reinforcePhotorealPrompt(job.prompt, failed), { ...context, attempt: 2 });
    const stillFailed = await runQc(retryPath, people).catch(() => [] as string[]);
    // 보강본이 더 나쁘지 않을 때만 교체한다.
    if (stillFailed.length <= failed.length) {
      finalPath = adopt(retryPath, job.outStem);
      return { id: job.id, localPath: finalPath, ...(stillFailed.length ? { qcWarnings: stillFailed } : {}) };
    }
  } catch { /* 재생성이 실패하면 첫 결과를 경고와 함께 채택한다. */ }
  return { id: job.id, localPath: finalPath, qcWarnings: failed };
}

/** 최대 CODEX_IMAGE_CONCURRENCY 개를 동시에 돌린다. 결과는 끝나는 대로 onResult 로 넘긴다. */
export async function runCodexImageBatch(jobs: ImageBatchJob[], options: CodexImageBatchOptions): Promise<ImageBatchResult[]> {
  const results: ImageBatchResult[] = new Array(jobs.length);
  let codex: CodexLike | null = null;
  let setupError: string | null = null;
  if (jobs.some((job) => !job.reviewOnly)) {
    try {
      codex = await (options.createCodex ?? defaultCreateCodex)();
    } catch (error) {
      setupError = codexImageError(error);
    }
  }
  const limit = Math.max(1, Math.min(5, options.concurrency ?? CODEX_IMAGE_CONCURRENCY));
  let next = 0;
  let deliveries = Promise.resolve();
  const worker = async () => {
    while (next < jobs.length) {
      const index = next;
      next += 1;
      const job = jobs[index]!;
      let result: ImageBatchResult;
      if (job.reviewOnly) result = { id: job.id, localPath: null, submissionState: "uncertain",
        error: "IMAGE_RESUME_REQUIRED: 검수 전용 이미지 결과는 조립 단계에서 확인해야 합니다. 이미지 생성 전송 경로에서는 채택하거나 재전송하지 않았습니다." };
      else if (options.signal?.aborted) result = { id: job.id, localPath: null, error: "사용자가 이미지 생성을 중지했습니다." };
      else if (codex) result = await runJob(codex, job, options);
      else {
        try {
          assertProductImageReferences(job);
          const existing = checkedExistingJobResult(job, options);
          result = existing ? { id: job.id, localPath: existing } : { id: job.id, localPath: null,
            submissionState: hasUnresolvedCodexSubmission(job.outStem) ? "uncertain" : "not-submitted", error: setupError || "Codex를 시작하지 못했습니다." };
        } catch (error) { result = { id: job.id, localPath: null, error: codexImageError(error),
          ...(job.referenceMode === "product" && fs.existsSync(`${job.outStem}.codex-submission.json`) ? { submissionState: "uncertain" as const } : {}) }; }
      }
      results[index] = result;
      deliveries = deliveries.then(() => options.onResult(result, index)).catch(() => { /* The caller records its own failure. */ });
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  await deliveries;
  return results;
}
