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
  runCodexDraftWithRetry,
} from "./lib/codex-draft-provider";
import { getBundledCodexEntrypoint, getBundledCodexExecutable, readCodexLocalStatus } from "../src/lib/codex-local";
import { classifyLocalFailure, toLocalAutomationError } from "../src/lib/local-automation-error";

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
for (const code of ["CODEX_AUTH_REQUIRED", "CODEX_MODEL_INCOMPATIBLE", "CODEX_TIMEOUT", "CODEX_TRANSIENT_FAILURE"] as const) {
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

  for (const code of ["CODEX_AUTH_REQUIRED", "CODEX_MODEL_INCOMPATIBLE", "CODEX_TIMEOUT", "CODEX_TRANSIENT_FAILURE"] as const) {
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
