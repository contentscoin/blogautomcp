/** Blind single-image observer contract tests. Provider module is mocked throughout. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import sharp from "sharp";
import { observeIntrinsicIdentifier, parseIntrinsicIdentifierObserverResponse, intrinsicIdentifierObserverRequestSha256,
  type IntrinsicIdentifierObservation } from "./lib/intrinsic-identifier-observer";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-blind-identifier-"));
const hash = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
let checks = 0;
function check(condition: unknown, reason: string) { assert.ok(condition, reason); checks++; }
async function main(): Promise<void> {
  const file = path.join(root, "unlabelled-image.png");
  const bytes = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } }).png().toBuffer();
  fs.writeFileSync(file, bytes);
  const options = { path: file, sha256: hash(bytes) };
  const observation: IntrinsicIdentifierObservation = { literal: "Brandum", box: [100, 100, 400, 200], identifierRole: "brand", location: "intrinsic", readability: "legible" };
  const raw = JSON.stringify(observation);
  let calls = 0;
  const result = await observeIntrinsicIdentifier(options, { review: async request => {
    calls++;
    check(request.imagePaths?.length === 1 && request.imagePaths[0] === file, "exactly one image, never a reference/candidate pair");
    check(request.publicationPhotoInput?.sha256 === options.sha256 && request.maxImages === 1 && request.preserveImageOrder === true, "exact immutable image1 role");
    check(request.noTransientRetry === true && request.researchMode === "disabled", "no search and no transient second turn");
    check(!/Brandum|Brandium|Voltium|Voltum/u.test(request.systemPrompt + request.userPrompt), "no expected brand/literal/near-spelling hint");
    check(request.userPrompt.includes("Never insert/delete a letter") && request.userPrompt.includes("COMPLETE word"), "independent raw letters and full-word ROI requested");
    check((request.outputSchema as { additionalProperties: boolean }).additionalProperties === false, "strict observation schema");
    return raw;
  } });
  check(calls === 1 && result.status === "observed", "one observation with no automatic corrective retry");
  check(result.evidence?.nativeExecution === false, "DI observations cannot produce native authority");
  check(result.evidence?.requestSha256 === intrinsicIdentifierObserverRequestSha256(options.sha256), "server request hash reproducible");
  check(result.evidence?.rawResponse === raw && result.evidence.responseSha256 === hash(raw), "bounded exact raw response and hash retained");
  assert.deepEqual(result.evidence?.observation, observation); checks++;
  check(intrinsicIdentifierObserverRequestSha256(options.sha256) !== intrinsicIdentifierObserverRequestSha256("0".repeat(64)), "image SHA changes request binding");
  for (const invalid of ["not json", "[]", "{}", raw + " commentary", "```json\n" + raw + "\n```", JSON.stringify({ ...observation, extra: "brand hint" }),
    JSON.stringify({ ...observation, literal: "Volt(i)um (not certain)" }), JSON.stringify({ ...observation, literal: "Brandum or Brandium" }),
    JSON.stringify({ ...observation, literal: "Brandum\nBrandium" }), JSON.stringify({ ...observation, literal: "Brandum?" }),
    JSON.stringify({ ...observation, literal: "Brandum ", box: [0, 0, 1000, 1000] }),
    JSON.stringify({ ...observation, box: [0, 0, 900, 100] }), JSON.stringify({ ...observation, box: [0, 0, 800, 250] }),
    JSON.stringify({ ...observation, box: [100.1, 100, 400, 200] }), JSON.stringify({ ...observation, location: "not-observed" }),
    JSON.stringify({ ...observation, readability: "unreadable" }), JSON.stringify({ ...observation, identifierRole: "none" }),
    " ".repeat(4097) + raw]) {
    check(parseIntrinsicIdentifierObserverResponse(invalid) === null, "ambiguous/annotated/malformed/unbounded observations cannot become word evidence");
  }
  for (const readability of ["unreadable", "absent", "ambiguous"] as const) {
    const unread = JSON.stringify({ literal: "", box: null, identifierRole: "none", location: "not-observed", readability });
    const held = await observeIntrinsicIdentifier(options, { review: async () => unread });
    check(held.status === "unreadable" && held.evidence?.observation.literal === "", "no readable word stays a neutral observation, not a defect");
  }
  let invalidCalls = 0;
  const reviewer = async () => { invalidCalls++; return raw; };
  check((await observeIntrinsicIdentifier({ ...options, sha256: "0".repeat(64) }, { review: reviewer })).status === "invalid" && invalidCalls === 0, "SHA mismatch before provider");
  check((await observeIntrinsicIdentifier({ ...options, maximumMs: Number.NaN }, { review: reviewer })).status === "invalid" && invalidCalls === 0, "NaN deadline rejected before provider");
  check((await observeIntrinsicIdentifier({ ...options, expectedBrand: "Brandium" } as typeof options, { review: reviewer })).status === "invalid" && invalidCalls === 0, "no source/main/expected-word side channel accepted");
  let errorCalls = 0;
  const unavailable = await observeIntrinsicIdentifier(options, { review: async () => { errorCalls++; throw Error("503"); } });
  check(unavailable.status === "unavailable" && errorCalls === 1, "provider error does not start another observation");
  let clock = 0;
  const late = await observeIntrinsicIdentifier(options, { now: () => clock, review: async () => { clock = 60_001; return raw; } });
  check(late.status === "unavailable" && late.reason === "OBSERVER_TIMEOUT", "bounded observer deadline");
  const mutation = await observeIntrinsicIdentifier(options, { review: async () => { fs.appendFileSync(file, "changed"); return raw; } });
  check(mutation.status === "invalid" && !mutation.evidence, "SHA race cannot issue observation evidence"); fs.writeFileSync(file, bytes);
  const requestMutation = await observeIntrinsicIdentifier(options, { review: async request => { request.imagePaths!.push("unexpected-second-image"); return raw; } });
  check(requestMutation.status === "invalid" && !requestMutation.evidence, "request/image-order mutation blocked");
  const bad = await observeIntrinsicIdentifier(options, { review: async () => JSON.stringify({ ...observation, literal: "maybe Brandium" }) });
  check(bad.status === "invalid", "malformed literal never triggers repair/retry");
  const second = await observeIntrinsicIdentifier(options, { review: async () => JSON.stringify({ ...observation, literal: "Brandium" }) });
  check(second.evidence?.observation.literal === "Brandium" && second.evidence.nativeExecution === false, "DI never consumes/reuses native cache");

  const observerFile = path.resolve("scripts/lib/intrinsic-identifier-observer.ts"); const require = createRequire(observerFile);
  const code = ts.transpileModule(fs.readFileSync(observerFile, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const vmNative = (review: (request: CodexDraftOptions) => Promise<string>) => {
    const loaded = { exports: {} };
    vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Buffer, process, Error, console,
      require: (name: string) => name === "./codex-draft-provider" ? { runCodexDraft: review } : require(name) }, { filename: observerFile });
    return loaded.exports as { observeIntrinsicIdentifier: typeof observeIntrinsicIdentifier };
  };
  let nativeCalls = 0;
  const native = vmNative(async () => { nativeCalls++; return raw; });
  const [one, two] = await Promise.all([native.observeIntrinsicIdentifier(options), native.observeIntrinsicIdentifier(options)]);
  check(nativeCalls === 1 && one.status === "observed" && two.status === "observed" && one.evidence?.nativeExecution === true, "native singleflight shares a single exact-image provider turn");
  one.evidence!.observation.literal = "tampered";
  check(two.evidence?.observation.literal === "Brandum" && (await native.observeIntrinsicIdentifier(options)).evidence?.observation.literal === "Brandum", "cache cannot be mutated through returned evidence");
  let failedNativeCalls = 0;
  const failedNative = vmNative(async () => { failedNativeCalls++; throw Error("unknown provider outcome"); });
  check((await failedNative.observeIntrinsicIdentifier(options)).status === "unavailable" &&
    (await failedNative.observeIntrinsicIdentifier(options)).status === "unavailable" && failedNativeCalls === 1,
  "failed native blind task remains consumed instead of automatically resending");
  let invalidNativeCalls = 0;
  const invalidNative = vmNative(async () => { invalidNativeCalls++; return "unknown malformed output"; });
  check((await invalidNative.observeIntrinsicIdentifier(options)).status === "invalid" &&
    (await invalidNative.observeIntrinsicIdentifier(options)).status === "invalid" && invalidNativeCalls === 1,
  "malformed native observation remains consumed for exact image/policy");
  let release: (() => void) | undefined; const pending = new Promise<void>(resolve => { release = resolve; });
  let started = 0;
  const limited = vmNative(async () => { started++; await pending; return raw; });
  const files = await Promise.all(["#eeeeee", "#dddddd", "#cccccc"].map(async (background, index) => {
    const content = await sharp({ create: { width: 1000, height: 1000, channels: 3, background } }).png().toBuffer();
    const target = path.join(root, `capacity-${index}.png`); fs.writeFileSync(target, content); return { path: target, sha256: hash(content) };
  }));
  const first = limited.observeIntrinsicIdentifier(files[0]); const next = limited.observeIntrinsicIdentifier(files[1]);
  while (started < 2) await new Promise(resolve => setTimeout(resolve, 1));
  const third = await limited.observeIntrinsicIdentifier(files[2]);
  check(third.status === "unavailable" && third.reason === "OBSERVER_CAPACITY_HOLD" && started === 2, "native concurrency capped at two, excess calls hold");
  release!(); await Promise.all([first, next]);
  check(hash(fs.readFileSync(file)) === options.sha256, "all original pixels preserved");
  console.log(`PASS intrinsic identifier observer: ${checks} offline checks; one image/no expected word/no transient retry, immutable request/raw response bindings, ambiguity holds, bounded native singleflight/concurrency; actual provider calls 0`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
