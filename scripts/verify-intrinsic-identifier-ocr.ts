import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { reviewIntrinsicIdentifierOcr, normalizeIntrinsicIdentifierLiteral,
  type IntrinsicIdentifierOcrOptions } from "./lib/intrinsic-identifier-ocr";

const hash = (bytes: Buffer): string => crypto.createHash("sha256").update(bytes).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-intrinsic-identifier-"));
let assertions = 0;
function check(condition: unknown, message: string): void { assert.ok(condition, message); assertions += 1; }
const tsv = (text: string, confidence = 91): string => "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
  text.split(" ").map((word, index) => `5\t1\t1\t1\t1\t${index + 1}\t10\t10\t50\t20\t${confidence}\t${word}`).join("\n");

async function main(): Promise<void> {
  const inputDir = path.join(root, "inputs"); const workspace = path.join(root, "qa"); const runtime = path.join(root, "runtime");
  fs.mkdirSync(inputDir); fs.mkdirSync(workspace); fs.mkdirSync(path.join(runtime, "tessdata"), { recursive: true });
  const sourcePath = path.join(inputDir, "source.png"); const candidatePath = path.join(inputDir, "candidate.png");
  const image = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } }).png().toBuffer();
  fs.writeFileSync(sourcePath, image); fs.writeFileSync(candidatePath, image);
  const binary = path.join(runtime, process.platform === "win32" ? "tesseract.exe" : "tesseract");
  const traineddata = path.join(runtime, "tessdata", "eng.traineddata");
  fs.writeFileSync(binary, "offline fake binary"); fs.writeFileSync(traineddata, "offline fake trained data");
  const options: IntrinsicIdentifierOcrOptions = { sourcePath, sourceSha256: hash(image), sourceBox: [100, 100, 400, 200],
    candidatePath, candidateSha256: hash(image), candidateBox: [100, 100, 400, 200], sourceLiteral: "Brandium", workspace };
  const originalArgs: string[][] = [];
  const mock = (source: string[], candidate: string[], confidences: number[] = []): { candidates: string[]; run: (file: string, args: string[]) => Promise<string> } => ({
    candidates: [binary], run: async (_file, args) => {
      originalArgs.push(args);
      const sourceSide = path.basename(args[0]).startsWith("0-");
      const preset = args[0].includes("threshold") ? 2 : args[0].includes("gray-normal") ? 1 : 0;
      return tsv((sourceSide ? source : candidate)[preset] || "", confidences[preset] ?? 91);
    },
  });
  const conflict = await reviewIntrinsicIdentifierOcr(options, mock(["Brandium", "Brandium", "Brandium"], ["Brandum", "Brandum", "Brandum"]));
  check(conflict.status === "conflict", "a letter deletion must be a conflict without an expected candidate literal");
  check(conflict.evidence?.nativeExecution === false, "test seams cannot mint native OCR evidence");
  check(conflict.evidence?.source.consensus?.presets.length === 3 && conflict.evidence.candidate.consensus?.normalized === "brandum", "all blind transcripts and consensus retained");
  check(conflict.evidence?.source.originalSha256 === options.sourceSha256 && /^[a-f0-9]{64}$/u.test(conflict.evidence.engine.configHash), "exact originals/config bound");
  check(conflict.evidence?.engine.binarySha256 === hash(fs.readFileSync(binary)) && conflict.evidence.engine.traineddataSha256 === hash(fs.readFileSync(traineddata)), "runtime/data hashes retained");
  check(conflict.evidence?.source.transcripts.every(row => row.words[0]?.confidence === 91 && /^[a-f0-9]{64}$/u.test(row.cropSha256)), "raw confidence and crop hashes retained");
  assert.deepEqual(conflict.evidence?.source.box, options.sourceBox); assertions++;
  assert.deepEqual(conflict.evidence?.source.pixelBox, { left: 85, top: 85, width: 330, height: 130 }); assertions++;
  check(conflict.evidence?.engine.configHash !== "e6ce0e3c79e00a6e9df0da2f5f137f1dcf92cd927d9fd6dba625b6da486b6360", "padding policy/config changes the pre-padding evidence/cache hash");
  check(originalArgs.length === 6 && originalArgs.every(args => args.includes("load_system_dawg=0") && args.includes("load_freq_dawg=0") && args.includes("7")), "six bounded blind PSM7 calls, dictionaries off");
  check(!originalArgs.flat().some(arg => /Brandium|Brandum|whitelist/iu.test(arg)), "expected literals never passed to OCR");
  for (const [box, expectedPixel] of [
    [[0, 0, 300, 100], { left: 0, top: 0, width: 315, height: 115 }],
    [[700, 900, 1000, 1000], { left: 685, top: 885, width: 315, height: 115 }],
    [[100, 100, 150, 108], { left: 97, top: 97, width: 56, height: 14 }],
    [[100, 100, 300, 280], { left: 76, top: 76, width: 248, height: 228 }],
  ] as const) {
    const padded = await reviewIntrinsicIdentifierOcr({ ...options, candidateBox: box }, mock(["Brandium", "Brandium", "Brandium"], ["Brandum", "Brandum", "Brandum"]));
    check(padded.status === "conflict", "bounded padding remains usable at image edges/minimum/capped margin");
    assert.deepEqual(padded.evidence?.candidate.box, box); assert.deepEqual(padded.evidence?.candidate.pixelBox, expectedPixel); assertions += 2;
  }
  for (const box of [[100, 100, 850, 250], [100, 100, 400, 340], [100, 100, 880, 200]] as const) {
    let paddedCalls = 0;
    const padded = await reviewIntrinsicIdentifierOcr({ ...options, candidateBox: box }, { candidates: [binary], run: async () => { paddedCalls++; return tsv("Brandium"); } });
    check(padded.status === "invalid" && paddedCalls === 0, "expanded area/height/width bounds rechecked before OCR");
  }
  for (const [name, width, height, box] of [
    ["wide", 4000, 1000, [0, 100, 625, 200]], ["tall", 2000, 3000, [100, 100, 400, 300]],
  ] as const) {
    const large = await sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const largePath = path.join(inputDir, `${name}.png`); fs.writeFileSync(largePath, large); let largeCalls = 0;
    const limited = await reviewIntrinsicIdentifierOcr({ ...options, candidatePath: largePath, candidateSha256: hash(large), candidateBox: box },
      { candidates: [binary], run: async () => { largeCalls++; return tsv("Brandium"); } });
    check(limited.status === "invalid" && largeCalls === 0, "expanded absolute pixel width/height limits still block");
  }
  check(normalizeIntrinsicIdentifierLiteral(" ＢＲＡＮＤ-ium. ") === "brandium", "NFKC case/punctuation/whitespace normalization");
  check(normalizeIntrinsicIdentifierLiteral("BℝAND+ium") === "brand+ium", "symbols are not silently removed");
  check(normalizeIntrinsicIdentifierLiteral("Voltum") !== normalizeIntrinsicIdentifierLiteral("Voltium"), "letter omission cannot normalize away");
  check(normalizeIntrinsicIdentifierLiteral(null) === "", "nonliteral input rejected");
  check((await reviewIntrinsicIdentifierOcr({ ...options, maximumMs: Number.NaN }, mock([], []))).status === "invalid", "nonfinite budget cannot disable the deadline");
  check((await reviewIntrinsicIdentifierOcr({ ...options, sourceLiteral: "+" }, mock([], []))).status === "invalid", "symbol-only observation is not an identifier");
  const match = await reviewIntrinsicIdentifierOcr(options, mock(["BRAND-ium", "Brand ium", "x"], ["brandium", "Brandium", "y"], [92, 87, 40]));
  check(match.status === "match", "two reliable identical literals suffice; low confidence third doesn't control");
  check(match.evidence?.source.consensus?.minimumConfidence === 87, "minimum winning preset confidence retained");
  const low = await reviewIntrinsicIdentifierOcr(options, mock(["Brandium", "Brandium", "Brandium"], ["Brandum", "Brandum", "Brandum"], [84.99, 84, 83]));
  check(low.status === "unavailable" && low.reason === "OCR_CONSENSUS_UNAVAILABLE", "low confidence gives no conflict authority");
  const divided = await reviewIntrinsicIdentifierOcr(options, mock(["Brandium", "Brandium", "Brandium"], ["Brandum", "Branium", "Brandem"]));
  check(divided.status === "unavailable", "different reliable readings cannot invent a consensus");
  const sourceMismatch = await reviewIntrinsicIdentifierOcr({ ...options, sourceLiteral: "SomeOtherBrand" }, mock(["Brandium", "Brandium", "Brandium"], ["Brandum", "Brandum", "Brandum"]));
  check(sourceMismatch.status === "unavailable" && sourceMismatch.reason === "SOURCE_LITERAL_NOT_CONFIRMED", "source OCR must independently confirm native source literal");
  const empty = await reviewIntrinsicIdentifierOcr(options, mock(["", "", ""], ["Brandum", "Brandum", "Brandum"]));
  check(empty.status === "unavailable", "unreadable source gives no conflict");
  for (const box of [[0, 0, 1000, 1000], [100, 100, 400, 99], [-1, 0, 200, 100], [0, 0, 900, 100], [0.5, 0, 200, 100], [0, 0, 800, 250]] as const) {
    let calls = 0;
    const result = await reviewIntrinsicIdentifierOcr({ ...options, candidateBox: box }, { candidates: [binary], run: async () => { calls += 1; return ""; } });
    check(result.status === "invalid" && calls === 0, `invalid/full/wide ROI must not execute: ${box.join(",")}`);
  }
  check((await reviewIntrinsicIdentifierOcr({ ...options, candidateBox: [100, 100, 101, 101] }, mock([], []))).status === "invalid", "too tiny pixel region blocked");
  check((await reviewIntrinsicIdentifierOcr({ ...options, sourceSha256: "0".repeat(64) }, mock([], []))).reason === "ORIGINAL_SHA_CHANGED", "wrong source SHA blocked before execution");
  check((await reviewIntrinsicIdentifierOcr({ ...options, candidateSha256: "0".repeat(64) }, mock([], []))).reason === "ORIGINAL_SHA_CHANGED", "wrong candidate SHA blocked before execution");
  check((await reviewIntrinsicIdentifierOcr(options, { candidates: [path.join(root, "missing.exe")] })).status === "unavailable", "missing binary cannot produce authority");
  check((await reviewIntrinsicIdentifierOcr({ ...options, workspace: inputDir }, mock([], []))).reason === "UNSAFE_QA_WORKSPACE", "do not write QA files in original asset directory");
  check((await reviewIntrinsicIdentifierOcr({ ...options, workspace: root }, mock([], []))).reason === "UNSAFE_QA_WORKSPACE", "do not write QA files in an original asset ancestor");
  const timeout = await reviewIntrinsicIdentifierOcr(options, { candidates: [binary], run: async () => { throw Error("timeout"); } });
  check(timeout.status === "unavailable" && !timeout.evidence, "timeout fails without evidence authority");
  let clock = 0; let budgetCalls = 0;
  const budget = await reviewIntrinsicIdentifierOcr({ ...options, maximumMs: 250 }, { candidates: [binary], now: () => clock, run: async () => { budgetCalls += 1; clock += 251; return tsv("Brandium"); } });
  check(budget.status === "unavailable" && budgetCalls === 1, "bounded total execution budget");
  let raceCalls = 0;
  const race = await reviewIntrinsicIdentifierOcr(options, { candidates: [binary], run: async () => { if (++raceCalls === 3) fs.writeFileSync(candidatePath, Buffer.concat([image, Buffer.from("changed")])); return tsv(raceCalls <= 3 ? "Brandium" : "Brandum"); } });
  check(race.status === "invalid" && race.reason === "OCR_INPUT_OR_RUNTIME_CHANGED" && !race.evidence, "original race cannot issue OCR evidence");
  fs.writeFileSync(candidatePath, image);
  const engineBefore = fs.readFileSync(binary); let engineCalls = 0;
  const engineRace = await reviewIntrinsicIdentifierOcr(options, { candidates: [binary], run: async () => { if (++engineCalls === 4) fs.appendFileSync(binary, "changed"); return tsv(engineCalls <= 3 ? "Brandium" : "Brandum"); } });
  check(engineRace.status === "invalid" && !engineRace.evidence, "changed binary cannot issue OCR evidence"); fs.writeFileSync(binary, engineBefore);
  const dataBefore = fs.readFileSync(traineddata); let dataCalls = 0;
  const dataRace = await reviewIntrinsicIdentifierOcr(options, { candidates: [binary], run: async () => { if (++dataCalls === 4) fs.appendFileSync(traineddata, "changed"); return tsv(dataCalls <= 3 ? "Brandium" : "Brandum"); } });
  check(dataRace.status === "invalid" && !dataRace.evidence, "changed traineddata cannot issue OCR evidence"); fs.writeFileSync(traineddata, dataBefore);
  const malformed = await reviewIntrinsicIdentifierOcr(options, { candidates: [binary], run: async () => tsv("Brandium", Number.NaN) });
  check(malformed.status === "invalid", "nonfinite confidence rejected");
  const imageBefore = hash(fs.readFileSync(sourcePath));
  const again = await reviewIntrinsicIdentifierOcr(options, mock(["Brandium", "Brandium", "Brandium"], ["Brandum", "Brandum", "Brandum"]));
  check(again.status === "conflict" && hash(fs.readFileSync(sourcePath)) === imageBefore && hash(fs.readFileSync(candidatePath)) === options.candidateSha256, "test execution preserves original source and candidate bytes");
  check(fs.readdirSync(workspace).every(entry => entry.startsWith("intrinsic-identifier-")), "QA writes remain inside designated workspace");

  if (process.argv.includes("--actual-fixture")) {
    // Manual ROIs belong exclusively to this historical regression fixture.
    const base = path.join(process.env.APPDATA || "", "brandconnect-automation", "data", "prepared-brand-posts", "f9de2542-23a0-44bf-88bb-6c0f829f9a0e");
    const actualSource = path.join(base, "product-sources", "04e6247cdc9d8a399aa80b42a4c55dba1193216ab2b970f7a1c29c1ec65c05a9.jpg");
    const actualCandidate = path.join(base, "images", "generated-1792425873554-ba735ecd-b532-4226-93dc-19fe8ef7c0a2.png");
    const previousPath = process.env.TESSERACT_PATH;
    process.env.TESSERACT_PATH = path.resolve("resources/tesseract/tesseract.exe");
    try {
      const realOptions: IntrinsicIdentifierOcrOptions = { sourcePath: actualSource, sourceSha256: hash(fs.readFileSync(actualSource)), sourceBox: [285, 418, 669, 535],
        candidatePath: actualCandidate, candidateSha256: hash(fs.readFileSync(actualCandidate)), candidateBox: [407, 598, 495, 634], sourceLiteral: "Voltium", workspace };
      const native = await reviewIntrinsicIdentifierOcr(realOptions);
      fs.writeFileSync(path.join(workspace, "actual-fixture-result.json"), JSON.stringify(native, null, 2), { flag: "wx" });
      check(native.status === "conflict" && native.evidence?.nativeExecution === true, "real packaged blind OCR finds the historical printed-letter defect");
      check(native.evidence?.source.consensus?.normalized === "voltium" && native.evidence.candidate.consensus?.normalized === "voltum", "real blind source/candidate transcripts differ by the missing i");
      check(hash(fs.readFileSync(actualSource)) === realOptions.sourceSha256 && hash(fs.readFileSync(actualCandidate)) === realOptions.candidateSha256, "actual originals unchanged");
      const [cachedOne, cachedTwo] = await Promise.all([reviewIntrinsicIdentifierOcr(realOptions), reviewIntrinsicIdentifierOcr(realOptions)]);
      check(cachedOne.status === "conflict" && cachedTwo.status === "conflict", "native singleflight cache preserves exact conflict");
      if (cachedOne.evidence?.candidate.consensus) cachedOne.evidence.candidate.consensus.normalized = "tampered-return";
      check(cachedTwo.evidence?.candidate.consensus?.normalized === "voltum" && (await reviewIntrinsicIdentifierOcr(realOptions)).evidence?.candidate.consensus?.normalized === "voltum", "cached evidence not mutable through caller return values");
      // Exact bounding boxes from the independent native observer in v2. The
      // candidate's tight top cut through visible strokes before bounded padding.
      const clippedOptions: IntrinsicIdentifierOcrOptions = { ...realOptions, sourceBox: [297, 416, 668, 509], candidateBox: [414, 608, 488, 635] };
      const clipped = await reviewIntrinsicIdentifierOcr(clippedOptions);
      fs.writeFileSync(path.join(workspace, "actual-clipped-observer-result.json"), JSON.stringify(clipped, null, 2), { flag: "wx" });
      check(clipped.status === "conflict" && clipped.evidence?.nativeExecution === true, "exact automatic clipped ROI recovers with fixed bounded pixel margin");
      check(clipped.evidence?.source.consensus?.normalized === "voltium" && clipped.evidence.candidate.consensus?.normalized === "voltum", "automatic ROI independent letters remain different without an expected candidate word");
      assert.deepEqual(clipped.evidence?.source.box, clippedOptions.sourceBox); assert.deepEqual(clipped.evidence?.candidate.box, clippedOptions.candidateBox); assertions += 2;
      assert.deepEqual(clipped.evidence?.source.pixelBox, { left: 242, top: 344, width: 346, height: 107 });
      assert.deepEqual(clipped.evidence?.candidate.pixelBox, { left: 513, top: 756, width: 105, height: 47 }); assertions += 2;
      check((clipped.evidence?.source.consensus?.minimumConfidence || 0) >= 85 && (clipped.evidence?.candidate.consensus?.minimumConfidence || 0) >= 85,
        "the original confidence/consensus gates are preserved");
      check(hash(fs.readFileSync(actualSource)) === clippedOptions.sourceSha256 && hash(fs.readFileSync(actualCandidate)) === clippedOptions.candidateSha256, "actual clipped-ROI test preserves both original files");
    } finally { if (previousPath === undefined) delete process.env.TESSERACT_PATH; else process.env.TESSERACT_PATH = previousPath; }
  }
  console.log(JSON.stringify({ status: "PASS", assertions, workspace, providerCalls: 0, originalWrites: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
