import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import sharp from "sharp";
import { productOcrCandidates } from "./product-source-ocr";

export const INTRINSIC_IDENTIFIER_OCR_VERSION = "intrinsic-identifier-ocr/v1";
export type IntrinsicIdentifierBox = readonly [number, number, number, number];
type PixelBox = { left: number; top: number; width: number; height: number };
type Run = (binary: string, args: string[], timeoutMs: number) => Promise<string>;
export type IntrinsicIdentifierOcrOptions = {
  sourcePath: string; sourceSha256: string; sourceBox: IntrinsicIdentifierBox;
  candidatePath: string; candidateSha256: string; candidateBox: IntrinsicIdentifierBox;
  sourceLiteral: string; workspace: string; maximumMs?: number;
};
export type IntrinsicIdentifierOcrWord = {
  text: string; confidence: number; left: number; top: number; width: number; height: number;
};
export type IntrinsicIdentifierOcrTranscript = {
  preset: string; text: string; normalized: string; confidence: number;
  words: IntrinsicIdentifierOcrWord[]; excludedWords?: IntrinsicIdentifierOcrWord[]; cropSha256: string;
};
export type IntrinsicIdentifierOcrImageEvidence = {
  originalSha256: string; box: IntrinsicIdentifierBox; pixelBox: PixelBox; regionSha256: string;
  transcripts: IntrinsicIdentifierOcrTranscript[];
  consensus: { literal: string; normalized: string; minimumConfidence: number; presets: string[] } | null;
};
export type IntrinsicIdentifierOcrEvidence = {
  version: typeof INTRINSIC_IDENTIFIER_OCR_VERSION; nativeExecution: boolean;
  sourceLiteral: string; normalizedSourceLiteral: string;
  source: IntrinsicIdentifierOcrImageEvidence; candidate: IntrinsicIdentifierOcrImageEvidence;
  engine: { binaryPath: string; binarySha256: string; traineddataPath: string; traineddataSha256: string; configHash: string };
};
export type IntrinsicIdentifierOcrResult = {
  status: "conflict" | "match" | "unavailable" | "invalid"; reason: string;
  evidence?: IntrinsicIdentifierOcrEvidence;
};

const PRESETS = ["raw-1x", "gray-normal-invert-2x", "gray-normal-invert-threshold-2x"] as const;
const CONFIG = Object.freeze({ version: INTRINSIC_IDENTIFIER_OCR_VERSION, presets: PRESETS,
  psm: 7, fallbackPsm: 11, language: "eng", threshold: 128, confidence: 85, consensus: 2,
  dictionary: false, kernel: "lanczos3", maximumFileBytes: 16 * 1024 * 1024,
  maximumPixels: 24_000_000, maximumDimension: 12_000,
  maximumNormalizedWidth: 800, maximumNormalizedHeight: 250, maximumAreaRatio: 0.12,
  regionProcessing: "bounded-word-padding/v2", paddingHeightRatio: 0.75, minimumPaddingPixels: 3, maximumPaddingPixels: 24,
  sparseWordMinimumObservedOverlap: 0.25,
  maximumConcurrentNativeJobs: 2 });
const sha = (bytes: Buffer | string): string => crypto.createHash("sha256").update(bytes).digest("hex");
const configHash = sha(JSON.stringify(CONFIG));
export const intrinsicIdentifierOcrConfigurationSha256 = (): string => configHash;
const cache = new Map<string, Promise<IntrinsicIdentifierOcrResult>>();
const activeNativeKeys = new Set<string>();
const execute: Run = (binary, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(binary, args, { timeout: timeoutMs, killSignal: "SIGKILL", windowsHide: true,
    encoding: "utf8", maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
});

/** Literal comparison only: preserve every letter/digit; never correct to a brand. */
export function normalizeIntrinsicIdentifierLiteral(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").toLowerCase().replace(/[\p{White_Space}\p{P}]/gu, "") : "";
}

function inputBytes(file: string): Buffer {
  if (!path.isAbsolute(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > CONFIG.maximumFileBytes) throw Error("INPUT_SIZE_OR_PATH");
  const bytes = fs.readFileSync(file);
  if (bytes.length > CONFIG.maximumFileBytes) throw Error("INPUT_SIZE_OR_PATH");
  return bytes;
}
function validBox(box: IntrinsicIdentifierBox): boolean {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(n => Number.isInteger(n) && n >= 0 && n <= 1000)) return false;
  const [left, top, right, bottom] = box;
  return right > left && bottom > top && right - left <= CONFIG.maximumNormalizedWidth &&
    bottom - top <= CONFIG.maximumNormalizedHeight && (right - left) * (bottom - top) / 1_000_000 <= CONFIG.maximumAreaRatio;
}
async function prepareRegion(bytes: Buffer, box: IntrinsicIdentifierBox): Promise<{ raw: Buffer; pixelBox: PixelBox; observedBox: PixelBox }> {
  const meta = await sharp(bytes, { limitInputPixels: CONFIG.maximumPixels, animated: false }).metadata();
  if (!["jpeg", "png", "webp"].includes(meta.format || "") || (meta.pages || 1) !== 1 || !meta.width || !meta.height ||
    Math.max(meta.width, meta.height) > CONFIG.maximumDimension || meta.width * meta.height > CONFIG.maximumPixels) throw Error("INPUT_IMAGE_LIMIT");
  const swap = [5, 6, 7, 8].includes(meta.orientation || 1);
  const width = swap ? meta.height : meta.width; const height = swap ? meta.width : meta.height;
  const left = Math.floor(box[0] * width / 1000); const top = Math.floor(box[1] * height / 1000);
  const right = Math.ceil(box[2] * width / 1000); const bottom = Math.ceil(box[3] * height / 1000);
  // A model's word box can be displaced vertically by part of a glyph height.
  // Keep one deterministic local margin (at most 24 px), independent of the
  // expected literal and OCR result; never search until a desired word appears.
  const observedWidth = right - left, observedHeight = bottom - top;
  if (observedWidth < 24 || observedHeight < 8 || observedWidth > 2500 || observedHeight > 600 ||
    observedWidth / observedHeight < 1 || observedWidth / observedHeight > 35) throw Error("WORD_REGION_LIMIT");
  const padding = Math.min(CONFIG.maximumPaddingPixels, Math.max(CONFIG.minimumPaddingPixels, Math.ceil(observedHeight * CONFIG.paddingHeightRatio)));
  const paddedLeft = Math.max(0, left - padding), paddedTop = Math.max(0, top - padding);
  const paddedRight = Math.min(width, right + padding), paddedBottom = Math.min(height, bottom + padding);
  const pixelBox = { left: paddedLeft, top: paddedTop, width: paddedRight - paddedLeft, height: paddedBottom - paddedTop };
  if (pixelBox.left < 0 || pixelBox.top < 0 || paddedRight > width || paddedBottom > height ||
    pixelBox.width < 24 || pixelBox.height < 8 || pixelBox.width > 2500 || pixelBox.height > 600 ||
    pixelBox.width / pixelBox.height < 1 || pixelBox.width / pixelBox.height > 35 ||
    pixelBox.width / width > CONFIG.maximumNormalizedWidth / 1000 || pixelBox.height / height > CONFIG.maximumNormalizedHeight / 1000 ||
    pixelBox.width * pixelBox.height / (width * height) > CONFIG.maximumAreaRatio) throw Error("PADDED_WORD_REGION_LIMIT");
  return { raw: await sharp(bytes, { limitInputPixels: CONFIG.maximumPixels }).rotate().extract(pixelBox).png().toBuffer(), pixelBox,
    observedBox: { left: left - paddedLeft, top: top - paddedTop, width: observedWidth, height: observedHeight } };
}
function wordsFromTsv(tsv: string): IntrinsicIdentifierOcrWord[] {
  if (tsv.length > 1024 * 1024) throw Error("TSV_LIMIT");
  const words: IntrinsicIdentifierOcrWord[] = [];
  for (const row of tsv.split(/\r?\n/u).slice(1, 2000)) {
    const cells = row.split("\t");
    if (cells[0] !== "5" || cells.length < 12) continue;
    const text = cells.slice(11).join("\t").trim();
    if (!text) continue;
    const numeric = [cells[10], ...cells.slice(6, 10)].map(Number);
    if (!numeric.every(Number.isFinite) || numeric[0] < 0 || numeric[0] > 100 || numeric.slice(1).some(n => n < 0)) throw Error("INVALID_TSV_WORD");
    words.push({ text, confidence: numeric[0], left: numeric[1], top: numeric[2], width: numeric[3], height: numeric[4] });
    if (words.length > 32 || text.length > 128) throw Error("WORD_TRANSCRIPT_LIMIT");
  }
  return words;
}
function consensus(transcripts: IntrinsicIdentifierOcrTranscript[]): IntrinsicIdentifierOcrImageEvidence["consensus"] {
  const groups = new Map<string, IntrinsicIdentifierOcrTranscript[]>();
  for (const transcript of transcripts) {
    if (transcript.confidence < CONFIG.confidence || !transcript.normalized || transcript.normalized.length > 64) continue;
    const group = groups.get(transcript.normalized) || [];
    group.push(transcript); groups.set(transcript.normalized, group);
  }
  const winner = [...groups.values()].find(group => new Set(group.map(row => row.preset.replace(/-psm11$/u, ""))).size >= CONFIG.consensus);
  return winner ? { literal: winner[0].text, normalized: winner[0].normalized,
    minimumConfidence: Math.min(...winner.map(item => item.confidence)), presets: winner.map(item => item.preset) } : null;
}
/** Read a completed bounded observation, including a genuine non-consensus.
 * Recompute the vote from the retained transcripts: deleting an adverse vote
 * or just replacing its consensus with null cannot create an uncertainty. */
export function intrinsicIdentifierOcrTranscriptEvidenceIssue(evidence: IntrinsicIdentifierOcrEvidence): string | null {
  try {
    if (evidence.version !== INTRINSIC_IDENTIFIER_OCR_VERSION || evidence.nativeExecution !== true ||
        evidence.engine.configHash !== configHash || evidence.normalizedSourceLiteral !== normalizeIntrinsicIdentifierLiteral(evidence.sourceLiteral))
      return "OCR observation uses a different runtime/configuration or source literal";
    for (const image of [evidence.source, evidence.candidate]) {
      const rows = image.transcripts;
      if (!Array.isArray(rows) || rows.length < 3 || rows.length > 6 ||
          new Set(rows.map(row => row.preset)).size !== rows.length ||
          !PRESETS.every(preset => rows.some(row => row.preset === preset))) return "OCR preprocessing observations are incomplete";
      for (const row of rows) {
        if (!/^(raw-1x|gray-normal-invert-2x|gray-normal-invert-threshold-2x)(-psm11)?$/u.test(row.preset) ||
            !/^[a-f0-9]{64}$/u.test(row.cropSha256) || !Array.isArray(row.words) || row.words.length > 32 ||
            row.words.some(word => !word || typeof word.text !== "string" || word.text.length > 128 || !Number.isFinite(word.confidence) || word.confidence < 0 || word.confidence > 100) ||
            row.text !== row.words.map(word => word.text).join(" ") || row.normalized !== normalizeIntrinsicIdentifierLiteral(row.text) ||
            row.confidence !== (row.words.length ? Math.min(...row.words.map(word => word.confidence)) : -1)) return "OCR transcript was changed or is malformed";
      }
      if (JSON.stringify(image.consensus) !== JSON.stringify(consensus(rows))) return "OCR consensus differs from retained observations";
      if (!image.consensus && rows.length !== 6) return "An unresolved OCR observation is missing its bounded sparse fallback";
    }
    return null;
  } catch { return "OCR observation evidence is malformed"; }
}
function inside(parent: string, file: string): boolean {
  const relative = path.relative(parent, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function clone(result: IntrinsicIdentifierOcrResult): IntrinsicIdentifierOcrResult {
  return JSON.parse(JSON.stringify(result)) as IntrinsicIdentifierOcrResult;
}

/** Bounded blind OCR is negative evidence only; a match does not approve a photo.
 * Dependency injection is an offline test seam and explicitly cannot produce native authority. */
export async function reviewIntrinsicIdentifierOcr(options: IntrinsicIdentifierOcrOptions, dependencies: {
  run?: Run; candidates?: string[]; now?: () => number;
} = {}): Promise<IntrinsicIdentifierOcrResult> {
  if (!validBox(options.sourceBox) || !validBox(options.candidateBox) ||
    !/^[a-f0-9]{64}$/u.test(options.sourceSha256) || !/^[a-f0-9]{64}$/u.test(options.candidateSha256) ||
    typeof options.sourceLiteral !== "string" || options.sourceLiteral.length > 128 ||
    !/[\p{L}\p{N}]/u.test(normalizeIntrinsicIdentifierLiteral(options.sourceLiteral)) ||
    (options.maximumMs !== undefined && !Number.isFinite(options.maximumMs))) {
    return { status: "invalid", reason: "INVALID_IDENTIFIER_REGION_OR_LITERAL" };
  }
  const nativeExecution = Object.keys(dependencies).length === 0;
  const now = dependencies.now || Date.now;
  const deadline = now() + Math.max(250, Math.min(20_000, options.maximumMs ?? 12_000));
  let sourceBytes: Buffer; let candidateBytes: Buffer;
  let engine: IntrinsicIdentifierOcrEvidence["engine"]; let workspace: string;
  try {
    sourceBytes = inputBytes(options.sourcePath); candidateBytes = inputBytes(options.candidatePath);
    if (sha(sourceBytes) !== options.sourceSha256 || sha(candidateBytes) !== options.candidateSha256) return { status: "invalid", reason: "ORIGINAL_SHA_CHANGED" };
    workspace = fs.realpathSync(options.workspace);
    if (!path.isAbsolute(options.workspace) || !fs.statSync(workspace).isDirectory() ||
      inside(workspace, fs.realpathSync(options.sourcePath)) || inside(workspace, fs.realpathSync(options.candidatePath)) ||
      inside(path.dirname(fs.realpathSync(options.sourcePath)), workspace) || inside(path.dirname(fs.realpathSync(options.candidatePath)), workspace)) {
      return { status: "invalid", reason: "UNSAFE_QA_WORKSPACE" };
    }
    let found: typeof engine | undefined;
    for (const item of (dependencies.candidates || productOcrCandidates()).slice(0, 8)) {
      try {
        if (!path.isAbsolute(item)) continue;
        const binaryPath = fs.realpathSync(item); const traineddataPath = fs.realpathSync(path.join(path.dirname(binaryPath), "tessdata", "eng.traineddata"));
        if (!fs.statSync(binaryPath).isFile() || !fs.statSync(traineddataPath).isFile()) continue;
        found = { binaryPath, binarySha256: sha(fs.readFileSync(binaryPath)), traineddataPath,
          traineddataSha256: sha(fs.readFileSync(traineddataPath)), configHash }; break;
      } catch { /* Do not use an unhashable/stale executable or implicit PATH fallback. */ }
    }
    if (!found) return { status: "unavailable", reason: "OCR_RUNTIME_UNAVAILABLE" };
    engine = found;
  } catch { return { status: "invalid", reason: "UNREADABLE_OR_UNSAFE_INPUT" }; }
  const key = sha(JSON.stringify({ version: INTRINSIC_IDENTIFIER_OCR_VERSION, source: options.sourceSha256, sourceBox: options.sourceBox,
    candidate: options.candidateSha256, candidateBox: options.candidateBox, sourceLiteral: options.sourceLiteral, engine }));
  const unchanged = (): boolean => {
    try { return sha(inputBytes(options.sourcePath)) === options.sourceSha256 && sha(inputBytes(options.candidatePath)) === options.candidateSha256 &&
      sha(fs.readFileSync(engine.binaryPath)) === engine.binarySha256 && sha(fs.readFileSync(engine.traineddataPath)) === engine.traineddataSha256; }
    catch { return false; }
  };
  const work = async (): Promise<IntrinsicIdentifierOcrResult> => {
    let directory = "";
    try {
      const regions = await Promise.all([prepareRegion(sourceBytes, options.sourceBox), prepareRegion(candidateBytes, options.candidateBox)]);
      if (now() >= deadline) return { status: "unavailable", reason: "OCR_BUDGET_EXHAUSTED" };
      directory = fs.mkdtempSync(path.join(workspace, "intrinsic-identifier-"));
      const images: IntrinsicIdentifierOcrImageEvidence[] = [];
      for (const [index, region] of regions.entries()) {
        const transcripts: IntrinsicIdentifierOcrTranscript[] = [];
        // Sparse text is a bounded fallback for product edges mistaken for text.
        // It uses the same fixed region and budget, and never an expected word.
        for (const { preset, psm } of [
          ...PRESETS.map(preset => ({ preset, psm: CONFIG.psm })),
          ...PRESETS.map(preset => ({ preset, psm: CONFIG.fallbackPsm })),
        ]) {
          if (psm === CONFIG.fallbackPsm && consensus(transcripts)) break;
          const remaining = deadline - now();
          if (remaining <= 0) return { status: "unavailable", reason: "OCR_BUDGET_EXHAUSTED" };
          let image = sharp(region.raw);
          if (preset !== "raw-1x") image = image.resize(region.pixelBox.width * 2, region.pixelBox.height * 2, { kernel: "lanczos3" }).greyscale().normalize().negate();
          if (preset === "gray-normal-invert-threshold-2x") image = image.threshold(CONFIG.threshold);
          const bytes = await image.png().toBuffer();
          const transcriptPreset = psm === CONFIG.psm ? preset : `${preset}-psm11`;
          const file = path.join(directory, `${index}-${transcriptPreset}.png`);
          fs.writeFileSync(file, bytes, { flag: "wx" });
          const tsv = await (dependencies.run || execute)(engine.binaryPath, [file, "stdout", "--tessdata-dir", path.dirname(engine.traineddataPath),
            "-l", "eng", "--psm", String(psm), "-c", "load_system_dawg=0", "-c", "load_freq_dawg=0",
            "-c", "tessedit_create_tsv=1", "-c", "tessedit_create_txt=0"], Math.max(1, Math.min(4000, deadline - now())));
          const rawWords = wordsFromTsv(tsv);
          const scale = preset === "raw-1x" ? 1 : 2;
          const roi = region.observedBox;
          // Sparse mode may also see a housing edge in the added margin. Keep
          // only words intersecting the independently observed location, based
          // on geometry alone, never their letters or confidence. Retain rejects.
          const inObservedLocation = (word: IntrinsicIdentifierOcrWord): boolean => {
            const overlapWidth = Math.max(0, Math.min(word.left + word.width, (roi.left + roi.width) * scale) - Math.max(word.left, roi.left * scale));
            const overlapHeight = Math.max(0, Math.min(word.top + word.height, (roi.top + roi.height) * scale) - Math.max(word.top, roi.top * scale));
            return word.width > 0 && word.height > 0 && overlapWidth * overlapHeight / (word.width * word.height) >= CONFIG.sparseWordMinimumObservedOverlap;
          };
          const words = psm === CONFIG.fallbackPsm ? rawWords.filter(inObservedLocation) : rawWords;
          const excludedWords = psm === CONFIG.fallbackPsm ? rawWords.filter(word => !inObservedLocation(word)) : [];
          const text = words.map(word => word.text).join(" ");
          transcripts.push({ preset: transcriptPreset, text, normalized: normalizeIntrinsicIdentifierLiteral(text),
            confidence: words.length ? Math.min(...words.map(word => word.confidence)) : -1, words,
            ...(excludedWords.length ? { excludedWords } : {}), cropSha256: sha(bytes) });
        }
        images.push({ originalSha256: index === 0 ? options.sourceSha256 : options.candidateSha256,
          box: [...(index === 0 ? options.sourceBox : options.candidateBox)], pixelBox: region.pixelBox,
          regionSha256: sha(region.raw), transcripts, consensus: consensus(transcripts) });
      }
      const evidence: IntrinsicIdentifierOcrEvidence = { version: INTRINSIC_IDENTIFIER_OCR_VERSION, nativeExecution,
        sourceLiteral: options.sourceLiteral, normalizedSourceLiteral: normalizeIntrinsicIdentifierLiteral(options.sourceLiteral),
        source: images[0], candidate: images[1], engine };
      if (!unchanged()) return { status: "invalid", reason: "OCR_INPUT_OR_RUNTIME_CHANGED" };
      if (now() > deadline) return { status: "unavailable", reason: "OCR_BUDGET_EXHAUSTED" };
      if (!evidence.source.consensus || !evidence.candidate.consensus) return { status: "unavailable", reason: "OCR_CONSENSUS_UNAVAILABLE", evidence };
      if (evidence.source.consensus.normalized !== evidence.normalizedSourceLiteral) return { status: "unavailable", reason: "SOURCE_LITERAL_NOT_CONFIRMED", evidence };
      return { status: evidence.source.consensus.normalized === evidence.candidate.consensus.normalized ? "match" : "conflict",
        reason: evidence.source.consensus.normalized === evidence.candidate.consensus.normalized ? "BLIND_OCR_LITERALS_MATCH" : "BLIND_OCR_IDENTIFIER_CONFLICT", evidence };
    } catch (error) {
      return { status: now() >= deadline || /timeout|timed out|killed/iu.test(String(error)) ? "unavailable" : "invalid",
        reason: !unchanged() ? "OCR_INPUT_OR_RUNTIME_CHANGED" : "OCR_EXECUTION_OR_REGION_FAILED" };
    }
    // Crops deliberately remain in the caller's private QA workspace as evidence.
  };
  let pending = nativeExecution ? cache.get(key) : undefined;
  if (!pending) {
    if (nativeExecution && activeNativeKeys.size >= CONFIG.maximumConcurrentNativeJobs) return { status: "unavailable", reason: "OCR_NATIVE_CAPACITY_HOLD" };
    if (nativeExecution) activeNativeKeys.add(key);
    pending = work();
    if (nativeExecution) {
      if (cache.size >= 64) {
        const removable = [...cache.keys()].find(item => !activeNativeKeys.has(item));
        if (removable) cache.delete(removable);
      }
      cache.set(key, pending);
      void pending.then(result => {
        activeNativeKeys.delete(key);
        if ((result.status === "invalid" || result.status === "unavailable") && cache.get(key) === pending) cache.delete(key);
      });
    }
  }
  const result = await pending;
  if (!unchanged()) return { status: "invalid", reason: "OCR_INPUT_OR_RUNTIME_CHANGED" };
  return clone(result);
}
