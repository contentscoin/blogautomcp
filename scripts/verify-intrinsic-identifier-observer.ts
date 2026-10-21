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
import Ajv from "ajv";
import { observeIntrinsicIdentifier, parseIntrinsicIdentifierObserverResponse, intrinsicIdentifierObserverRequestSha256,
  serializeIntrinsicIdentifierObserverResponse, intrinsicIdentifierObserverResponseIssue, INTRINSIC_IDENTIFIER_OBSERVER_SCHEMA, INTRINSIC_IDENTIFIER_LITERAL_PATTERN, INTRINSIC_IDENTIFIER_OBSERVER_VERSION, type IntrinsicIdentifierObservation } from "./lib/intrinsic-identifier-observer";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-blind-identifier-"));
const hash = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
const wire = (value: unknown) => {
  const observation = value as IntrinsicIdentifierObservation;
  return observation && (observation.box === null || Array.isArray(observation.box))
    ? serializeIntrinsicIdentifierObserverResponse(observation) : JSON.stringify({ observation });
};
let checks = 0;
function check(condition: unknown, reason: string) { assert.ok(condition, reason); checks++; }
async function main(): Promise<void> {
  const file = path.join(root, "unlabelled-image.png");
  const bytes = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } }).png().toBuffer();
  fs.writeFileSync(file, bytes);
  const options = { path: file, sha256: hash(bytes) };
  const observation: IntrinsicIdentifierObservation = { literal: "Brandum", box: [100, 100, 400, 200], identifierRole: "brand", location: "intrinsic", readability: "legible" };
  const raw = wire(observation);
  check(INTRINSIC_IDENTIFIER_OBSERVER_VERSION === "intrinsic-identifier-observer/v3", "new wire protocol has its own version, never relabeled v1/v2 evidence");
  check(!("anyOf" in INTRINSIC_IDENTIFIER_OBSERVER_SCHEMA) && INTRINSIC_IDENTIFIER_OBSERVER_SCHEMA.required.join() === "observation", "structured output root remains a strict object, union is nested");
  const [legibleBranch, neutralBranch] = INTRINSIC_IDENTIFIER_OBSERVER_SCHEMA.properties.observation.anyOf;
  check(legibleBranch.properties.location.enum.join() === "intrinsic" && legibleBranch.properties.readability.enum.join() === "legible" &&
    !legibleBranch.properties.identifierRole.enum.includes("none" as never), "legible branch cannot emit not-observed/none fields");
  check(neutralBranch.properties.literal.enum.join() === "" && neutralBranch.properties.box.type === "null" &&
    neutralBranch.properties.identifierRole.enum.join() === "none" && neutralBranch.properties.location.enum.join() === "not-observed" &&
    !neutralBranch.properties.readability.enum.includes("legible" as never), "non-legible branch structurally fixes all empty neutral fields");
  // AJV6 defaults to legacy non-Unicode JS regexes. Its documented regExp
  // hook supplies the Unicode semantics required by the actual L/N/M schema.
  const schemaValid = new Ajv({ regExp: pattern => new RegExp(pattern, "u") }).compile(INTRINSIC_IDENTIFIER_OBSERVER_SCHEMA);
  check(schemaValid(JSON.parse(raw)), "extent-based legible wire satisfies the exact native schema");
  check(legibleBranch.properties.literal.pattern === INTRINSIC_IDENTIFIER_LITERAL_PATTERN && !/[\(][?][=!<]/u.test(INTRINSIC_IDENTIFIER_LITERAL_PATTERN),
    "native literal pattern is the actual Unicode character contract, without unsupported lookaround");
  for (const literal of ["Markora", "한일의료기", "스마토이 123", "Élan", "E\u0301lan", "株式会社123", "مَرْكة", "ब्रांड", "𐐀Brand", "３Ｍ", "A.B & C+ D'’/X-Y", ". Brand", "123", "A  B", "A\u0301"]) {
    const response=wire({...observation,literal});
    check(schemaValid(JSON.parse(response)) && parseIntrinsicIdentifierObserverResponse(response)?.literal === literal,
      "legitimate Unicode letters/numbers/combining marks, internal spaces and exact punctuation remain unchanged");
  }
  for (const literal of ["Volt\ufeffum", "\ufeffMarkora", "Markora\ufeff", "A\u200bB", "A\u200cB", "A\u200dB", "A\u2060B", "A\u200eB", "A\u202eB", "A\u00a0B", "A\tB", "A\nB", "A\rB", "A\u0000B", " Markora", "Markora ", " . ", ".&+", "\u0301", "Brand😀", "Brand_1"]) {
    const response=wire({...observation,literal});
    check(!schemaValid(JSON.parse(response)) && parseIntrinsicIdentifierObserverResponse(response) === null,
      "actual BOM/control/hidden-space and boundary-invalid literals are denied at generation schema and parser, never stripped");
  }
  const actualBomRaw = wire({...observation,literal:"Volt\ufeffum",box:[414,598,474,618]});
  const actualBom = await observeIntrinsicIdentifier(options,{review:async()=>actualBomRaw});
  check(actualBom.status === "invalid" && !actualBom.evidence && actualBom.diagnostic?.rawResponse === actualBomRaw &&
    actualBom.diagnostic.responseSha256 === hash(actualBomRaw) && actualBom.diagnostic.issue === "OBSERVER_LITERAL_OR_ROLE_INVALID",
    "actual 151 BOM reply remains byte-exact invalid evidence; no spelling cleanup, favorable reread or retry");

  assert.deepEqual(JSON.parse(raw).observation.box, { left: 100, top: 100, width: 300, height: 100 }); checks++;
  for (const [box, expectedIssue] of [
    [[307, 415, 714, 690], "OBSERVER_BOX_HEIGHT_LIMIT"], // actual Hanil v2 whole-leaflet ROI, not a new word fixture
    [[68, 139, 915, 238], "OBSERVER_BOX_WIDTH_LIMIT"], // actual microscope v2 overwide title line
    [[0, 0, 800, 250], "OBSERVER_BOX_AREA_LIMIT"],
    [[900, 900, 1100, 950], "OBSERVER_BOX_BOUNDS_INVALID"],
  ] as Array<[[number, number, number, number], string]>) {
    const invalid = wire({ ...observation, box });
    check(parseIntrinsicIdentifierObserverResponse(invalid) === null && intrinsicIdentifierObserverResponseIssue(invalid) === expectedIssue,
      "word extent limits stay strict and report the actual failed constraint");
    if (expectedIssue.includes("HEIGHT") || expectedIssue.includes("WIDTH")) check(!schemaValid(JSON.parse(invalid)), "native schema itself prevents height/width limit violations");
  }
  for (const legacyRaw of [JSON.stringify({ observation }), JSON.stringify(observation)])
    check(parseIntrinsicIdentifierObserverResponse(legacyRaw) === null, "v1/v2 corner-coordinate raw cannot be relabeled v3 or repaired in place");
  check(parseIntrinsicIdentifierObserverResponse(JSON.stringify({ observation: { ...observation, box: { left: 0, top: 0, width: 100, height: 20, right: 100 } } })) === null,
    "old or mixed coordinate fields stay invalid");
  check(!schemaValid(JSON.parse(wire({ ...observation, box: [1.5, 0, 200, 25] }))), "fractional coordinates fail before output admission");
  let calls = 0;
  const result = await observeIntrinsicIdentifier(options, { review: async request => {
    calls++;
    check(request.imagePaths?.length === 1 && request.imagePaths[0] === file, "exactly one image, never a reference/candidate pair");
    check(request.publicationPhotoInput?.sha256 === options.sha256 && request.maxImages === 1 && request.preserveImageOrder === true, "exact immutable image1 role");
    check(request.noTransientRetry === true && request.researchMode === "disabled", "no search and no transient second turn");
    check(request.userPrompt.includes("BOM U+FEFF") && request.userPrompt.includes("not permission to add, delete, correct or infer any visible letter"),
      "wire-format cause is prevented in instructions without altering real observed characters");
    check(!/Brandum|Brandium|Voltium|Voltum/u.test(request.systemPrompt + request.userPrompt), "no expected brand/literal/near-spelling hint");
    check(request.userPrompt.includes("Never insert/delete a letter") && request.userPrompt.includes("COMPLETE word"), "independent raw letters and full-word ROI requested");
    check(request.userPrompt.includes("Readable EXTERNAL seller/company artwork is not intrinsic") && request.userPrompt.includes("never copy its external word"), "readable external watermark is excluded, never coerced to intrinsic printing");
    check((request.outputSchema as { additionalProperties: boolean }).additionalProperties === false, "strict observation schema");
    return raw;
  } });
  check(calls === 1 && result.status === "observed", "one observation with no automatic corrective retry");
  check(result.evidence?.nativeExecution === false, "DI observations cannot produce native authority");
  check(result.evidence?.requestSha256 === intrinsicIdentifierObserverRequestSha256(options.sha256), "server request hash reproducible");
  check(result.evidence?.rawResponse === raw && result.evidence.responseSha256 === hash(raw), "bounded exact raw response and hash retained");
  assert.deepEqual(result.evidence?.observation, observation); checks++;
  check(intrinsicIdentifierObserverRequestSha256(options.sha256) !== intrinsicIdentifierObserverRequestSha256("0".repeat(64)), "image SHA changes request binding");
  for (const invalid of ["not json", "[]", "{}", raw + " commentary", "```json\n" + raw + "\n```", JSON.stringify(observation),
    JSON.stringify({ observation, extra: "brand hint" }), wire({ ...observation, extra: "brand hint" }),
    wire({ ...observation, literal: "Volt(i)um (not certain)" }), wire({ ...observation, literal: "Brandum or Brandium" }),
    wire({ ...observation, literal: "Brandum\nBrandium" }), wire({ ...observation, literal: "Brandum?" }),
    wire({ ...observation, literal: "Brandum ", box: [0, 0, 1000, 1000] }),
    wire({ ...observation, box: [0, 0, 900, 100] }), wire({ ...observation, box: [0, 0, 800, 250] }),
    wire({ ...observation, box: [100.1, 100, 400, 200] }), wire({ ...observation, location: "not-observed" }),
    wire({ ...observation, readability: "unreadable" }), wire({ ...observation, identifierRole: "none" }),
    " ".repeat(4097) + raw]) {
    check(parseIntrinsicIdentifierObserverResponse(invalid) === null, "ambiguous/annotated/malformed/unbounded observations cannot become word evidence");
  }
  for (const readability of ["unreadable", "absent", "ambiguous"] as const) {
    const unread = wire({ literal: "", box: null, identifierRole: "none", location: "not-observed", readability });
    const held = await observeIntrinsicIdentifier(options, { review: async () => unread });
    check(held.status === "unreadable" && held.evidence?.observation.literal === "", "no readable word stays a neutral observation, not a defect");
  }
  for (const readability of ["legible", "unreadable", "absent", "ambiguous"])
    for (const location of ["intrinsic", "not-observed"])
      for (const identifierRole of ["brand", "product-line", "model", "sku", "none"])
        for (const literal of ["", "Observed"])
          for (const box of [null, [100, 100, 200, 150]]) {
            const expected = readability === "legible" ? location === "intrinsic" && identifierRole !== "none" && literal === "Observed" && box !== null
              : location === "not-observed" && identifierRole === "none" && literal === "" && box === null;
            check(Boolean(parseIntrinsicIdentifierObserverResponse(wire({ readability, location, identifierRole, literal, box }))) === expected,
              "every inconsistent legibility/location/role/literal/box combination stays invalid without coercion");
          }
  const oldHanilInvalid = { literal: "주식회사 한일의료기", box: [582, 30, 967, 82], identifierRole: "brand", location: "not-observed", readability: "legible" };
  check(parseIntrinsicIdentifierObserverResponse(JSON.stringify(oldHanilInvalid)) === null && parseIntrinsicIdentifierObserverResponse(wire(oldHanilInvalid)) === null,
    "actual old external-company contradiction is rejected both as untouched v1 raw and v3-enveloped invalid fields");
  let invalidCalls = 0;
  const reviewer = async () => { invalidCalls++; return raw; };
  check((await observeIntrinsicIdentifier({ ...options, sha256: "0".repeat(64) }, { review: reviewer })).status === "invalid" && invalidCalls === 0, "SHA mismatch before provider");
  check((await observeIntrinsicIdentifier({ ...options, maximumMs: Number.NaN }, { review: reviewer })).status === "invalid" && invalidCalls === 0, "NaN deadline rejected before provider");
  check((await observeIntrinsicIdentifier({ ...options, expectedBrand: "Brandium" } as typeof options, { review: reviewer })).status === "invalid" && invalidCalls === 0, "no source/main/expected-word side channel accepted");
  let errorCalls = 0;
  const unavailable = await observeIntrinsicIdentifier(options, { review: async () => { errorCalls++; throw Error("503"); } });
  check(unavailable.status === "unavailable" && errorCalls === 1, "provider error does not start another observation");
  check(unavailable.diagnostic?.stage === "provider" && unavailable.diagnostic.issue === "503" && unavailable.diagnostic.imageSha256 === options.sha256,
    "provider failure is kept separate from a model response or coordinate error, without authority");
  const oversized = await observeIntrinsicIdentifier(options, { review: async () => wire({ ...observation, box: [307, 415, 714, 690] }) });
  check(oversized.status === "invalid" && !oversized.evidence && oversized.reason === "OBSERVER_RESPONSE_INVALID" &&
    oversized.diagnostic?.issue === "OBSERVER_BOX_HEIGHT_LIMIT" && oversized.diagnostic.responseSha256 === hash(oversized.diagnostic.rawResponse!),
    "actual oversized source reply retains exact raw/constraint/SHA rather than disappearing behind generic binding failure");
  let clock = 0;
  const late = await observeIntrinsicIdentifier(options, { now: () => clock, review: async () => { clock = 60_001; return raw; } });
  check(late.status === "unavailable" && late.reason === "OBSERVER_TIMEOUT", "bounded observer deadline");
  const mutation = await observeIntrinsicIdentifier(options, { review: async () => { fs.appendFileSync(file, "changed"); return raw; } });
  check(mutation.status === "invalid" && !mutation.evidence, "SHA race cannot issue observation evidence"); fs.writeFileSync(file, bytes);
  const requestMutation = await observeIntrinsicIdentifier(options, { review: async request => { request.imagePaths!.push("unexpected-second-image"); return raw; } });
  check(requestMutation.status === "invalid" && !requestMutation.evidence, "request/image-order mutation blocked");
  const bad = await observeIntrinsicIdentifier(options, { review: async () => wire({ ...observation, literal: "maybe Brandium" }) });
  check(bad.status === "invalid", "malformed literal never triggers repair/retry");
  const second = await observeIntrinsicIdentifier(options, { review: async () => wire({ ...observation, literal: "Brandium" }) });
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
