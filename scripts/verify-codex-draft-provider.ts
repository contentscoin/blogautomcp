import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import draftRuntimePolicy from "./lib/draft-runtime-policy.json";
import {
  classifyCodexDraftFailure,
  codexDraftTerminalFailureCode,
  codexDraftStructuredFailureCode,
  codexUsageLimitDetails,
  runCodexDraftWithRetry,
  collectCodexDraftResponse,
} from "./lib/codex-draft-provider";
import { getBundledCodexEntrypoint, getBundledCodexExecutable, readCodexLocalStatus } from "../src/lib/codex-local";
import { classifyLocalFailure, extractLocalApiError, LOCAL_AUTOMATION_ERROR_HINTS, LocalAutomationError, toLocalAutomationError } from "../src/lib/local-automation-error";

const root = process.cwd();
const providerSource = fs.readFileSync(path.join(root, "scripts/lib/codex-draft-provider.ts"), "utf8");
const agentSource = fs.readFileSync(path.join(root, "scripts/simple-agent.ts"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "src/app/api/brandlinks/[id]/draft/route.ts"), "utf8");
const settingsSource = fs.readFileSync(path.join(root, "src/app/api/settings/route.ts"), "utf8");
const electronSource = fs.readFileSync(path.join(root, "scripts/electron/main.cjs"), "utf8");
const productPhotoReviewSource = fs.readFileSync(path.join(root, "scripts/lib/product-photo-review.ts"), "utf8");

assert.ok(getBundledCodexEntrypoint(), "bundled Codex entrypoint must resolve");
assert.ok(getBundledCodexExecutable(), "bundled native Codex executable must resolve");
assert.equal(readCodexLocalStatus().installed, true, "bundled Codex runtime must be installed");
assert.match(providerSource, /sandboxMode:\s*"read-only"/u);
assert.match(providerSource, /networkAccessEnabled:\s*false/u);
assert.match(providerSource, /researchMode\?:\s*"disabled"\s*\|\s*"cached"\s*\|\s*"live"/u);
assert.match(providerSource, /webSearchMode:\s*researchMode/u);
assert.match(providerSource, /여행지 사실 확인에만 사용/u);
assert.match(providerSource, /approvalPolicy:\s*"never"/u);
assert.match(providerSource, /local_image/u);
assert.match(providerSource, /detailImages\.slice\(0, 2\)/u);
assert.match(providerSource, /regularImages\.slice\(0, 2\)/u);
assert.match(providerSource, /maxImages\?: number/u);
assert.match(providerSource, /preserveImageOrder\?: boolean/u);
assert.match(providerSource, /readableImages\(options\.imagePaths \?\? \[\], options\.maxImages, options\.preserveImageOrder\)/u);
assert.match(productPhotoReviewSource, /maxImages: batch\.length/u,
  "bounded section-image review must receive every numbered candidate instead of the writing default of four");
assert.match(productPhotoReviewSource, /preserveImageOrder: true/u,
  "numbered product-photo candidates must not be silently reordered by filename");
assert.match(providerSource, /runStreamed/u);
assert.match(agentSource, /const AI_PROVIDER = "codex" as const/u);
assert.doesNotMatch(agentSource, /return (?:await )?runChatGPTBrowserDirect\(/u,
  "automated writing must never fall back to an unpinned browser model");
assert.match(agentSource, /if \(codexDraftTerminalFailureCode\(error\)\) throw error;/u,
  "revision convergence must immediately preserve provider failures");
assert.match(routeSource, /error instanceof PrepareProcessError[\s\S]{0,100}\? error\.code/u,
  "the draft route must return the child provider code unchanged");

const agentAst = ts.createSourceFile("simple-agent.ts", agentSource, ts.ScriptTarget.Latest, true);
const failureClassifierNode = agentAst.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "classifyFailureCode");
assert.ok(failureClassifierNode, "prepare failure classifier must exist");
const failureClassifierContext = vm.createContext({
  codexDraftTerminalFailureCode,
  getErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
});
vm.runInContext(
  `${ts.transpileModule(failureClassifierNode.getText(agentAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText}\nthis.classifyFailureCodeForTest = classifyFailureCode;`,
  failureClassifierContext,
);
const classifyPrepareFailure = failureClassifierContext.classifyFailureCodeForTest as (error: unknown) => string;
const codedProviderFailure = Object.assign(new Error("로그인 문구가 포함된 외부 래퍼"), { code: "CODEX_MODEL_INCOMPATIBLE" });
assert.equal(classifyPrepareFailure(codedProviderFailure), "CODEX_MODEL_INCOMPATIBLE",
  "structured provider code must win over misleading message heuristics");
assert.equal(classifyPrepareFailure(new Error("outer", { cause: Object.assign(new Error("inner"), { code: "CODEX_AUTH_REQUIRED" }) })), "CODEX_AUTH_REQUIRED",
  "a provider code must survive nested error causes until result.json");
assert.match(agentSource, /CODEX_DRAFT_MODEL = CODEX_TEXT_MODEL/u);
assert.equal(draftRuntimePolicy.CODEX_DRAFT_MODEL, "gpt-6-luna");
assert.equal(draftRuntimePolicy.CHATGPT_BROWSER_MODEL, "default");
assert.equal("OPENAI_TEXT_MODEL" in draftRuntimePolicy, false);
assert.equal(draftRuntimePolicy.CODEX_DRAFT_REASONING_EFFORT, "low");
// 1.3.8 부터 섹션 문장 수는 공유 필수 작성 계약(writing-prompt-contract)이 정하고 Codex 프롬프트는 그 계약을 참조한다.
assert.match(agentSource, /문장 수와 출력 구조는 공유 필수 작성 계약을 따릅니다/u);
assert.match(routeSource, /const useCodex/u);
assert.match(routeSource, /AI_PROVIDER:\s*"codex"/u);
assert.match(routeSource, /CODEX_BROWSER_FALLBACK_ENABLED:\s*"false"/u);
assert.match(routeSource, /ALLOW_CHATGPT_BROWSER_MODE:\s*"false"/u);
assert.doesNotMatch(routeSource, /hasProviderKey|localFallbackEnabled|useBrowserChatGpt|OPENAI_API_KEY/u);
assert.doesNotMatch(routeSource, /CODEX_BROWSER_FALLBACK_ENABLED:[\s\S]{0,160}browserSession\?\.isValid/u);
assert.match(settingsSource, /draftCreationMode: codexDraftEnabled && codexDraft\.authenticated/u);
assert.equal(draftRuntimePolicy.AI_PROVIDER, "codex");
assert.equal(draftRuntimePolicy.CODEX_DRAFT_ENABLED, "true");
assert.match(electronSource, /Object\.assign\(process\.env, draftRuntimePolicy\)/u);
assert.match(settingsSource, /fixedDraftSettings: draftRuntimePolicy/u);

// Real approval catch and revision/create response must preserve provider evidence,
// rather than converting HTTP 400 or a generic Korean quality word to bad input.
const routeAst = ts.createSourceFile("route.ts", routeSource, ts.ScriptTarget.Latest, true);
let approvalCodeExpression: ts.Expression | undefined;
function locateApprovalCode(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(routeAst) === "code"
    && node.initializer?.getText(routeAst).includes("error instanceof SavedTextRevalidationError")
    && node.initializer.getText(routeAst).includes("codexDraftStructuredFailureCode(error)")) {
    approvalCodeExpression = node.initializer;
  }
  ts.forEachChild(node, locateApprovalCode);
}
locateApprovalCode(routeAst);
assert.ok(approvalCodeExpression, "approval catch must retain provider classification before quality-message heuristics");
const failureResponseNode = routeAst.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "failureResponse");
assert.ok(failureResponseNode);
class FixtureSavedTextRevalidationError extends Error {
  readonly code = "QC_RECHECK_FAILED";
}
class FixturePrepareProcessError extends Error {
  constructor(readonly code: string) { super("prepare failed"); }
}
const approvalContext = vm.createContext({
  Error, codexDraftStructuredFailureCode, classifyLocalFailure,
  SavedTextRevalidationError: FixtureSavedTextRevalidationError,
  PrepareProcessError: FixturePrepareProcessError,
  NextResponse: { json: (body: unknown, options: unknown) => ({ body, options }) },
});
vm.runInContext(ts.transpileModule(failureResponseNode.getText(routeAst), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, approvalContext);
for (const code of ["CODEX_AUTH_REQUIRED", "CODEX_MODEL_INCOMPATIBLE", "CODEX_TIMEOUT", "CODEX_TRANSIENT_FAILURE", "CODEX_USAGE_LIMIT_REACHED"] as const) {
  const error = new Error("최종 품질 검사 오류", { cause: Object.assign(new Error("provider failure"), { code }) });
  approvalContext.error = error;
  approvalContext.message = error.message;
  assert.equal(vm.runInContext(approvalCodeExpression.getText(routeAst), approvalContext), code);
  assert.equal(vm.runInContext("failureResponse(error, 'failure', 400).body.code", approvalContext), code);
}
approvalContext.error = new FixtureSavedTextRevalidationError("quality error");
approvalContext.message = "quality error";
assert.equal(vm.runInContext(approvalCodeExpression.getText(routeAst), approvalContext), "QC_RECHECK_FAILED");
for (const message of ["Invalid timeout field", "Invalid websocket disconnected input", "invalid request"]) {
  approvalContext.error = new Error(message);
  approvalContext.message = message;
  assert.equal(vm.runInContext(approvalCodeExpression.getText(routeAst), approvalContext), "INVALID_INPUT");
  assert.equal(vm.runInContext("failureResponse(error, 'failure', 400).body.code", approvalContext), "INVALID_INPUT");
}

const completionLoss = "Reconnecting... 2/5 (stream disconnected before completion: websocket closed by server before response.completed)";
assert.equal(classifyLocalFailure({ status: 400, message: completionLoss }), "CODEX_TRANSIENT_FAILURE",
  "exact legacy approval diagnostic must not become INVALID_INPUT");
assert.equal(classifyLocalFailure({ status: 400, code: "INVALID_INPUT", message: completionLoss }), "INVALID_INPUT",
  "an explicit invalid-input response is not reclassified from its message");

async function verifyRetryPolicy(): Promise<void> {
  // Reproduce the real MCP approval bridge: explicit image-audit HTTP 422 is
  // a failed final gate, never an invalid argument or permission to approve.
  const pollFile = "src/app/api/remote-agent/poll/route.ts";
  const pollAst = ts.createSourceFile(pollFile, fs.readFileSync(path.join(root, pollFile), "utf8"), ts.ScriptTarget.Latest, true);
  const localApiNode = pollAst.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "localApi");
  assert.ok(localApiNode);
  const pixelMessage = "PUBLISH_IMAGE_AUDIT_FAILED: [11:SEMANTIC_REJECTION] 현재 사진과 본문 묘사가 일치하지 않습니다.";
  let localResponse: { success: false; code?: string; error: string };
  let localCalls = 0;
  const bridge = vm.createContext({ Error, Headers, URL, process: { env: {} },
    jobContexts: new WeakMap(), localAppOrigin: () => "http://127.0.0.1:43127",
    localJsonFetch: async () => { localCalls++; return { ok: false, status: 422, json: async () => localResponse }; },
    classifyLocalFailure, extractLocalApiError, LOCAL_AUTOMATION_ERROR_HINTS, LocalAutomationError,
  });
  vm.runInContext(ts.transpileModule(localApiNode.getText(pollAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText + "\nthis.call=localApi;", bridge);
  for (const [rawCode, message, expected] of [
    ["PUBLISH_IMAGE_AUDIT_FAILED", pixelMessage, "PUBLISH_IMAGE_AUDIT_FAILED"],
    ["INVALID_INPUT", pixelMessage, "INVALID_INPUT"],
    [undefined, "Invalid field format", "INVALID_INPUT"],
    ["UNKNOWN_VALIDATION_CODE", "Invalid field format", "INVALID_INPUT"],
    ["CONTENT_BLOCKED", "Current content is blocked", "CONTENT_BLOCKED"],
  ] as const) {
    localResponse = { success: false, ...(rawCode ? { code: rawCode } : {}), error: message };
    const before = localCalls;
    await assert.rejects(bridge.call({}, "/api/brandlinks/offline-fixture/draft", { method: "PATCH", body: '{"action":"approve"}' }), (error: unknown) => {
      assert.ok(error instanceof LocalAutomationError);
      assert.equal(error.code, expected); assert.equal(error.message, message); assert.equal(error.httpStatus, 422);
      assert.equal(toLocalAutomationError(error), error, "the completion conversion must retain the exact typed cause/message");
      return true;
    });
    assert.equal(localCalls, before + 1, "a definitive approval rejection cannot replay the mutation");
  }
  const approveNode = routeAst.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "approvePackageAfterCurrentValidation");
  assert.ok(approveNode);
  const savedDraft = Object.freeze({ approvedAt: null, markdown: "existing manuscript", imageSha256: "a".repeat(64) });
  const pixelFailure = Object.assign(new Error(pixelMessage), { code: "PUBLISH_IMAGE_AUDIT_FAILED" });
  let approvalWrites = 0;
  const gate = vm.createContext({
    revalidatePackageForApproval: () => savedDraft,
    validateBrandPostPublishImages: async (_id: string, _name: string, options: { bindReadiness: boolean }) => {
      assert.equal(options.bindReadiness, true); throw pixelFailure;
    },
    approveBrandPostPackage: () => { approvalWrites++; return { ...savedDraft, approvedAt: "must-not-happen" }; },
  });
  vm.runInContext(ts.transpileModule(approveNode.getText(routeAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText + "\nthis.approve=approvePackageAfterCurrentValidation;", gate);
  await assert.rejects(gate.approve("offline-fixture", { productName: "fixture" }), error => error === pixelFailure);
  assert.equal(approvalWrites, 0); assert.equal(savedDraft.approvedAt, null);
  assert.deepEqual(savedDraft, { approvedAt: null, markdown: "existing manuscript", imageSha256: "a".repeat(64) });

  const events = async function* (items: Array<import("@openai/codex-sdk").ThreadEvent>) { yield* items; };
  const progress = { type: "error" as const, message: completionLoss };
  const response = { type: "item.completed" as const, item: { type: "agent_message" as const, id: "response", text: "completed JSON" } };
  const completed = { type: "turn.completed" as const, usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } };
  assert.equal(await collectCodexDraftResponse(events([progress, response, completed])), "completed JSON",
    "native recovery progress must not cancel its still-running turn");
  const highDemand = "Reconnecting... 2/5 (We’re currently experiencing high demand, which may cause temporary errors.)";
  const nextHighDemand = highDemand.replace("2/5", "3/5");
  const demandEvents = [{ type: "error" as const, message: highDemand }, { type: "error" as const, message: nextHighDemand }];
  const negativeJson = '{"accepted":false,"identityMatches":false,"reason":"actual retained negative"}';
  const negativeResponse = { ...response, item: { ...response.item, text: negativeJson } };
  const progressTrace: string[] = [];
  let sameTurnCalls = 0;
  assert.equal(await runCodexDraftWithRetry(async () => {
    sameTurnCalls++;
    return collectCodexDraftResponse(events([...demandEvents, negativeResponse, completed]), notice => progressTrace.push(notice));
  }, { retryDelayMs: 0, canRetry: () => false }), negativeJson,
  "2/5 -> 3/5 waits within one SDK operation and preserves a completed raw negative without a favorable reroll");
  assert.equal(sameTurnCalls, 1);
  assert(progressTrace.some(notice => notice.includes(highDemand)) && progressTrace.some(notice => notice.includes(nextHighDemand)),
    "the exact first and later reconnect notifications remain in the progress trace");
  assert.equal(await collectCodexDraftResponse(events([{ type: "error", message: highDemand.replace("We’re", "We're") }, response, completed]), () => {}), "completed JSON");
  for (const raw of ['{"accepted":null}', "{invalid-json", negativeJson]) {
    let calls = 0;
    const received = await runCodexDraftWithRetry(async () => {
      calls++;
      return collectCodexDraftResponse(events([...demandEvents, { ...response, item: { ...response.item, text: raw } }, completed]), () => {});
    }, { retryDelayMs: 0, canRetry: () => false });
    assert.equal(received, raw); assert.equal(calls, 1, "model negative, unknown and parse-invalid text never trigger another provider operation");
  }
  for (const message of ["authentication required", "You've hit your usage limit.", "The model is not supported when using Codex with a ChatGPT account.",
    "HTTP status 400 invalid_request_error: invalid output schema", "CODEX_TIMEOUT", highDemand.replace("errors.)", "errors. authentication required)")]) {
    let reachedLaterResponse = false;
    async function* terminalEvents(): AsyncIterable<import("@openai/codex-sdk").ThreadEvent> {
      yield demandEvents[0]; yield { type: "error", message }; reachedLaterResponse = true; yield response; yield completed;
    }
    await assert.rejects(collectCodexDraftResponse(terminalEvents(), () => {}), error => (error as Error).message === message);
    assert.equal(reachedLaterResponse, false, "terminal or unrecognized errors are not swallowed as progress");
  }
  for (const invalid of [highDemand.replace("2/5", "0/5"), highDemand.replace("2/5", "02/5"), highDemand.replace("2/5", "6/5"),
    highDemand.replace("2/5", "2/0"), highDemand.replace("2/5", "2/6"), highDemand.replace("2/5", "9007199254740993/9007199254740993"),
    `Invalid request text: ${highDemand}`, `${highDemand} suffix`, highDemand.slice(0,-1), highDemand.replace("temporary errors.", "a different transient message.")]) {
    await assert.rejects(collectCodexDraftResponse(events([{ type: "error", message: invalid }, response, completed]), () => {}), error => (error as Error).message === invalid);
  }
  for (const finish of [[], [negativeResponse], [{ type: "turn.failed" as const, error: { message: highDemand } }]]) {
    let calls = 0;
    await assert.rejects(runCodexDraftWithRetry(async () => {
      calls++;
      return collectCodexDraftResponse(events([...demandEvents, ...finish]), () => {});
    }, { retryDelayMs: 0, canRetry: () => false }), error => (error as Error).message === (finish[0]?.type === "turn.failed" ? highDemand : nextHighDemand));
    assert.equal(calls, 1, "failed or unknown stream completion never dispatches another QC operation");
  }
  async function* highDemandAbortedEvents(): AsyncIterable<import("@openai/codex-sdk").ThreadEvent> {
    yield demandEvents[0]; throw Object.assign(new Error("existing deadline aborted this same turn"), { name: "AbortError" });
  }
  let deadlineCalls = 0;
  await assert.rejects(runCodexDraftWithRetry(async () => {
    deadlineCalls++; return collectCodexDraftResponse(highDemandAbortedEvents(), () => {});
  }, { retryDelayMs: 0, canRetry: () => false }), error => (error as { code?: string }).code === "CODEX_TIMEOUT");
  assert.equal(deadlineCalls, 1, "SDK reconnects do not reset the caller's deadline or add a second QC turn");
  assert.equal(classifyCodexDraftFailure(new Error(highDemand)), "non-retryable",
    "recognizing same-turn progress does not broaden the generic new-operation retry classifier");
  await assert.rejects(collectCodexDraftResponse(events([progress, { type: "turn.failed", error: { message: completionLoss } }])), /Reconnecting/);
  await assert.rejects(collectCodexDraftResponse(events([progress, response])), /Reconnecting/,
    "a partial response without turn.completed cannot count as successful QC");
  await assert.rejects(collectCodexDraftResponse(events([response])), /turn.completed/);
  await assert.rejects(collectCodexDraftResponse(events([{ type: "error", message: "authentication required" }, response, completed])), /authentication required/);
  await assert.rejects(collectCodexDraftResponse(events([{ type: "error", message: completionLoss.replace("2/5", "9/5") }, response, completed])), /Reconnecting/);
  async function* abortedEvents(): AsyncIterable<import("@openai/codex-sdk").ThreadEvent> {
    yield progress;
    throw Object.assign(new Error("cancelled"), { name: "AbortError" });
  }
  await assert.rejects(collectCodexDraftResponse(abortedEvents()), (error: unknown) => (error as Error).name === "AbortError");
  const transientErrors = [
    Object.assign(new Error("rate limited"), { status: 429 }),
    new Error('{"type":"error","status":429,"error":{"message":"rate limit"}}'),
    Object.assign(new Error("service unavailable"), { statusCode: 503 }),
    new Error("HTTP status 504 Gateway Timeout"),
    new Error("Gateway Timeout (504)"),
    Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
    new Error(completionLoss),
    new Error("stream disconnected before completion: websocket closed by server before response.completed"),
    new Error("review wrapper", { cause: new Error(completionLoss) }),
  ];
  for (const transient of transientErrors) {
    assert.equal(classifyCodexDraftFailure(transient), "retryable-transient");
    let calls = 0;
    const result = await runCodexDraftWithRetry(async () => {
      calls += 1;
      if (calls === 1) throw transient;
      return "ok";
    }, { retryDelayMs: 0 });
    assert.equal(result, "ok");
    assert.equal(calls, 2, "strong provider transport/service evidence gets exactly one same-Codex retry");
  }

  let exhaustedCalls = 0;
  const exhaustedFailure = Object.assign(new Error("HTTP status 500"), { status: 500 });
  await assert.rejects(runCodexDraftWithRetry(async () => {
    exhaustedCalls += 1;
    throw exhaustedFailure;
  }, { retryDelayMs: 0 }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "CODEX_TRANSIENT_FAILURE");
    assert.equal(codexDraftTerminalFailureCode(error), "CODEX_TRANSIENT_FAILURE");
    assert.equal((error as Error).cause, exhaustedFailure, "the exhausted provider error remains available as cause");
    return true;
  });
  assert.equal(exhaustedCalls, 2, "a persistent 5xx is never retried more than once");

  let streamFailureCalls = 0;
  await assert.rejects(runCodexDraftWithRetry(async () => {
    streamFailureCalls += 1;
    throw new Error(completionLoss);
  }, { retryDelayMs: 0 }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "CODEX_TRANSIENT_FAILURE");
    return true;
  });
  assert.equal(streamFailureCalls, 2, "completion loss never adds a third SDK operation");
  let cancelledCalls = 0;
  await assert.rejects(runCodexDraftWithRetry(async () => {
    cancelledCalls += 1;
    throw new Error(completionLoss);
  }, { retryDelayMs: 0, canRetry: () => false }));
  assert.equal(cancelledCalls, 1, "the existing abort/budget guard still vetoes transport retry");

  const definitiveErrors: Array<[unknown, ReturnType<typeof classifyCodexDraftFailure>, string | null]> = [
    [new Error("You’ve hit your usage limit. Try again at Oct 22 4:17 PM."), "usage-limit", "CODEX_USAGE_LIMIT_REACHED"],
    [new Error("You've hit your usage limit. Try again at Oct 22 4:17 PM."), "usage-limit", "CODEX_USAGE_LIMIT_REACHED"],
    [new Error("SOURCE_REVIEW_INCOMPLETE", { cause: new Error("You’ve hit your usage limit.") }), "usage-limit", "CODEX_USAGE_LIMIT_REACHED"],
    [Object.assign(new Error("Too many requests"), { status: 429, error: { type: "usage_limit_reached" } }), "usage-limit", "CODEX_USAGE_LIMIT_REACHED"],
    [Object.assign(new Error("Too many requests"), { status: 429, error: { code: "insufficient_quota" } }), "usage-limit", "CODEX_USAGE_LIMIT_REACHED"],
    [Object.assign(new Error(completionLoss, { cause: Object.assign(new Error("quota"), { code: "CODEX_USAGE_LIMIT_REACHED" }) }), { code: "CODEX_TRANSIENT_FAILURE" }), "usage-limit", "CODEX_USAGE_LIMIT_REACHED"],
    [Object.assign(new Error("authentication required"), { status: 401 }), "authentication", "CODEX_AUTH_REQUIRED"],
    [Object.assign(new Error("provider wrapper"), { status: 500, response: { status: 401, message: "Forbidden" } }), "authentication", "CODEX_AUTH_REQUIRED"],
    [new Error('{"type":"error","status":401,"error":{"message":"Forbidden"}}'), "authentication", "CODEX_AUTH_REQUIRED"],
    [new Error('{"status":500,"error":{"status":401,"message":"Forbidden"}}'), "authentication", "CODEX_AUTH_REQUIRED"],
    [new Error('{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The gpt-6-astra model requires a newer version of Codex."}}'), "model-version", "CODEX_MODEL_INCOMPATIBLE"],
    [new Error('{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The gpt-6-luna model is not supported when using Codex with a ChatGPT account."}}'), "model-version", "CODEX_MODEL_INCOMPATIBLE"],
    [Object.assign(new Error("operation timed out"), { name: "AbortError" }), "timeout", "CODEX_TIMEOUT"],
    [Object.assign(new Error("invalid request"), { status: 400 }), "non-retryable", null],
    [new Error("websocket disconnected"), "non-retryable", null],
    [new Error("stream disconnected before completion: invalid user request"), "non-retryable", null],
    [new Error(`Invalid request text: ${completionLoss}`), "non-retryable", null],
    [new Error("Reconnecting... 2/5 (stream disconnected before completion: websocket closed by server before response.completed"), "non-retryable", null],
    [Object.assign(new Error(completionLoss), { code: "CODEX_AUTH_REQUIRED" }), "authentication", "CODEX_AUTH_REQUIRED"],
    [Object.assign(new Error(completionLoss), { status: 403 }), "authentication", "CODEX_AUTH_REQUIRED"],
    [Object.assign(new Error(completionLoss), { code: "CODEX_MODEL_INCOMPATIBLE" }), "model-version", "CODEX_MODEL_INCOMPATIBLE"],
    [Object.assign(new Error(completionLoss), { code: "CODEX_TIMEOUT" }), "timeout", "CODEX_TIMEOUT"],
    [Object.assign(new Error(completionLoss, { cause: Object.assign(new Error("inner auth failure"), { code: "CODEX_AUTH_REQUIRED" }) }), { code: "CODEX_TRANSIENT_FAILURE" }), "authentication", "CODEX_AUTH_REQUIRED"],
  ];
  for (const [failure, expectedKind, expectedCode] of definitiveErrors) {
    assert.equal(classifyCodexDraftFailure(failure), expectedKind);
    let calls = 0;
    await assert.rejects(runCodexDraftWithRetry(async () => {
      calls += 1;
      throw failure;
    }, { retryDelayMs: 0 }), (error: unknown) => {
      assert.equal((error as { code?: string }).code || null, expectedCode);
      assert.equal(codexDraftTerminalFailureCode(error), expectedCode);
      if (expectedCode && (failure as { code?: string }).code === expectedCode) {
        assert.equal(error, failure, "already typed terminal failures are preserved intact");
      } else if (expectedCode) assert.equal((error as Error).cause, failure, "terminal wrapping must preserve the provider cause");
      else assert.equal(error, failure, "unknown non-retryable failures remain unchanged");
      return true;
    });
    assert.equal(calls, 1, `${expectedKind} must not retry or switch execution engines`);
  }

  const timedQuota = new Error("outer", { cause: Object.assign(new Error("You’ve hit your usage limit. Try again at Oct 22 4:17 PM."), {
    reset_at: "2026-10-22T16:17:00+09:00", headers: { "retry-after": "120" },
  }) });
  assert.deepEqual(codexUsageLimitDetails(timedQuota), { retryAfterSeconds: 120, resetAt: "2026-10-22T07:17:00.000Z", resetHint: "Oct 22 4:17 PM." });
  assert.deepEqual(codexUsageLimitDetails(Object.assign(new Error("You've hit your usage limit. Try again at Oct 22 4:17 PM."), {
    resetAt: "Oct 22 4:17 PM", retryAfterSeconds: Infinity,
  })), { resetHint: "Oct 22 4:17 PM." }, "ambiguous local reset text is preserved without inventing a date or time zone");
  await assert.rejects(runCodexDraftWithRetry(async () => { throw timedQuota; }, { retryDelayMs: 0 }), (error: unknown) => {
    const typed = error as Error & { code: string; retryAfterSeconds: number; resetAt: string; resetHint: string };
    assert.equal(typed.code, "CODEX_USAGE_LIMIT_REACHED"); assert.equal(typed.cause, timedQuota);
    assert.equal(typed.retryAfterSeconds, 120); assert.equal(typed.resetAt, "2026-10-22T07:17:00.000Z");
    assert.equal(typed.resetHint, "Oct 22 4:17 PM."); return true;
  });
  assert.equal(classifyPrepareFailure(new Error("SOURCE_EVIDENCE_REQUIRED", { cause: timedQuota })), "CODEX_USAGE_LIMIT_REACHED",
    "the actual child result classifier must preserve nested quota before source-evidence heuristics");
  assert.equal(classifyLocalFailure({ status: 400, message: "You’ve hit your usage limit. Try again at Oct 22 4:17 PM." }), "CODEX_USAGE_LIMIT_REACHED");
  assert.equal(classifyLocalFailure({ status: 429, message: "rate_limit_exceeded" }), "LOCAL_AUTOMATION_FAILED",
    "a short-lived HTTP 429 is not an account usage quota");
  for (const code of ["CODEX_AUTH_REQUIRED", "CODEX_MODEL_INCOMPATIBLE", "CODEX_TIMEOUT", "CODEX_TRANSIENT_FAILURE", "CODEX_USAGE_LIMIT_REACHED"] as const) {
    assert.equal(classifyLocalFailure({ status: 500, code, message: "wrapped provider failure" }), code,
      `${code} must cross the local automation/MCP mapping unchanged`);
    assert.equal(toLocalAutomationError(Object.assign(new Error("wrapped provider failure"), { code })).code, code,
      `${code} must survive the generic MCP error conversion boundary`);
  }
  for (const code of ["CHATGPT_BROWSER_AUTH_REQUIRED", "CHATGPT_BROWSER_UNREACHABLE", "CHATGPT_BROWSER_BUSY"] as const) {
    assert.equal(classifyLocalFailure({ status: 500, code, message: "wrapped browser failure" }), code,
      `${code} must cross the local automation/MCP mapping unchanged`);
    assert.equal(toLocalAutomationError(Object.assign(new Error("wrapped browser failure"), { code })).code, code,
      `${code} must survive the generic MCP error conversion boundary`);
  }
}

verifyRetryPolicy().then(() => {
  console.log(JSON.stringify({
    ok: true,
    bundledCodex: getBundledCodexEntrypoint(),
    bundledNativeCodex: getBundledCodexExecutable(),
    localStatus: readCodexLocalStatus(),
    safety: ["read-only", "network-disabled", "travel-web-search-cached", "approval-never", "codex-gpt-6-luna-low", "chatgpt-browser-default", "astra-forbidden", "bounded-same-codex-retry", "browser-fallback-disabled"],
  }, null, 2));
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
