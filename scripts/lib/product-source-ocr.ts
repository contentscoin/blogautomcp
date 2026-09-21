import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { extractExplicitProductFacts } from "./product-source-facts";

type Run = (binary: string, args: string[], timeoutMs: number) => Promise<string>;
const run: Run = (binary, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(binary, args, { timeout: timeoutMs, killSignal: "SIGKILL", windowsHide: true,
    encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
});
const ocrFactCache = new Map<string, string[]>();
function imageCacheKey(image: string): string | null {
  try {
    if (fs.statSync(image).size > 15 * 1024 * 1024) return null;
    return crypto.createHash("sha256").update(fs.readFileSync(image)).digest("hex");
  } catch { return null; }
}

export function productOcrCandidates(
  env: Readonly<Record<string, string | undefined>> = process.env,
  resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
): string[] {
  const exe = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  const roots = [resourcesPath, env.DESKTOP_PROJECT_ROOT && path.dirname(env.DESKTOP_PROJECT_ROOT),
    env.DESKTOP_PROJECT_ROOT && path.join(env.DESKTOP_PROJECT_ROOT, "resources"), path.dirname(process.execPath)].filter((value): value is string => Boolean(value));
  return [...new Set([env.TESSERACT_PATH, ...roots.map(root => path.join(root, "tesseract", exe)),
    env.ProgramFiles && path.join(env.ProgramFiles, "Tesseract-OCR", exe),
    env.USERPROFILE && path.join(env.USERPROFILE, "scoop", "apps", "tesseract", "current", exe),
  ].filter((value): value is string => Boolean(value)))];
}

/** Retain complete high-confidence lines, not isolated words that could lose a
 * negation or combine separate columns. Raw image provenance stays with caller. */
export function confidentOcrLines(tsv: string): string[] {
  const lines = new Map<string, { words: string[]; reliable: boolean }>();
  for (const row of tsv.split(/\r?\n/u).slice(1, 12_000)) {
    const cells = row.split("\t");
    if (cells[0] !== "5" || cells.length < 12) continue;
    const word = cells.slice(11).join(" ").trim();
    if (!word) continue;
    const key = cells.slice(1, 5).join("/");
    const line = lines.get(key) || { words: [], reliable: true };
    line.words.push(word);
    line.reliable = line.reliable && Number.isFinite(Number(cells[10])) && Number(cells[10]) >= 65;
    lines.set(key, line);
  }
  // kor TSV frequently emits one Hangul syllable per word ("자 동 세 척").
  // Rejoin only Hangul within the same reliable line, never across line/block
  // boundaries. This also retains negations such as "미 지 원" as "미지원".
  return [...lines.values()].filter(line => line.reliable)
    .map(line => line.words.join(" ").replace(/(?<=[가-힣])\s+(?=[가-힣])/gu, ""))
    .filter(line => line.length <= 500);
}

/** Only pass local crops whose source URL was a seller detail image, never
 * generated photos, reviews or arbitrary files. Missing OCR stays fail-closed. */
export async function readSellerDetailOcrFacts(imagePaths: string[], options: {
  run?: Run; exists?: (file: string) => boolean; now?: () => number;
  candidates?: string[]; maximumMs?: number;
  cacheKey?: (file: string) => string | null;
} = {}): Promise<{ facts: string[]; imagePaths: string[]; scannedImageCount: number; status: "complete" | "unavailable" | "timeout" }> {
  const execute = options.run || run;
  const exists = options.exists || fs.existsSync;
  const now = options.now || Date.now;
  const deadline = now() + Math.max(1, Math.min(35_000, options.maximumMs ?? 35_000));
  const binaries = [...new Set([...(options.candidates || productOcrCandidates()).filter(exists).slice(0, 5), "tesseract"])];
  let binary = ""; let dataArgs: string[] = [];
  const facts = new Set<string>(); const used: string[] = [];
  let scannedImageCount = 0;
  // Materialization preserves up to eight seller crops. Do not silently ignore
  // their latter half (often the ingredient, usage or specification panel).
  const images = [...new Set(imagePaths)].filter(exists).slice(0, 8);
  if (!images.length) return { facts: [], imagePaths: [], scannedImageCount, status: "unavailable" };
  for (const candidate of binaries) {
    if (deadline <= now()) return { facts: [], imagePaths: [], scannedImageCount, status: "timeout" };
    const tessdata = path.join(path.dirname(candidate), "tessdata");
    const args = exists(path.join(tessdata, "kor.traineddata")) && exists(path.join(tessdata, "eng.traineddata"))
      ? ["--tessdata-dir", tessdata] : [];
    try {
      const languages = await execute(candidate, [...args, "--list-langs"], Math.max(1, Math.min(3_000, deadline - now())));
      if (/^kor\s*$/mu.test(languages) && /^eng\s*$/mu.test(languages)) { binary = candidate; dataArgs = args; break; }
    } catch { /* A stale system installation must not hide a working packaged/PATH runtime. */ }
  }
  if (!binary) return { facts: [], imagePaths: [], scannedImageCount, status: "unavailable" };
  for (const image of images) {
    const remaining = deadline - now();
    if (remaining <= 0) return { facts: [...facts], imagePaths: used, scannedImageCount, status: "timeout" };
    try {
      const key = (options.cacheKey || imageCacheKey)(image);
      const cached = key ? ocrFactCache.get(key) : undefined;
      if (cached) {
        scannedImageCount += 1;
        cached.forEach(fact => facts.add(fact));
        if (cached.length) used.push(image);
        continue;
      }
      // Do not depend on the optional tessdata/configs/tsv file. The packaged
      // runtime intentionally carries only the Korean/English trained data, so
      // request TSV explicitly and disable the default text renderer. PSM 6 is
      // stable for the seller detail panels we crop (one coherent text block).
      const tsv = await execute(binary, [
        image, "stdout", ...dataArgs, "-l", "kor+eng", "--psm", "6",
        "-c", "tessedit_create_tsv=1", "-c", "tessedit_create_txt=0",
      ], Math.min(8_000, remaining));
      const extracted = extractExplicitProductFacts(confidentOcrLines(tsv).join("\n"), "ocr");
      scannedImageCount += 1;
      if (key) {
        if (ocrFactCache.size >= 64) ocrFactCache.delete(ocrFactCache.keys().next().value!);
        ocrFactCache.set(key, extracted);
      }
      if (extracted.length) { extracted.forEach(fact => facts.add(fact)); used.push(image); }
    } catch { /* One unreadable crop cannot turn missing evidence into a fact. */ }
  }
  return { facts: [...facts].slice(0, 16), imagePaths: used, scannedImageCount,
    status: now() >= deadline ? "timeout" : scannedImageCount > 0 ? "complete" : "unavailable" };
}
