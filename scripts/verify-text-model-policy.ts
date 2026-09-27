import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import policy from "./lib/draft-runtime-policy.json";
import { CODEX_TEXT_MODEL, resolveCodexTextModel, resolveTextReasoningEffort } from "./lib/text-model-policy";
import { buildHumanizeSectionsPrompt, parseHumanizeSections } from "./lib/humanize-response-contract";

function functionsFrom(file: string, names: string[], bindings: Record<string, unknown>) {
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const selected = ast.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && !!node.name && names.includes(node.name.text));
  assert.equal(selected.length, names.length);
  const context = vm.createContext({ exports: {}, console, Error, AbortController, setTimeout, clearTimeout, ...bindings });
  vm.runInContext(ts.transpileModule(selected.map((node) => node.getText(ast)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context;
}

async function main() {
  assert.equal(policy.AI_PROVIDER, "codex");
  assert.equal(policy.CODEX_DRAFT_MODEL, "default");
  assert.equal("OPENAI_TEXT_MODEL" in policy, false);
  assert.equal(CODEX_TEXT_MODEL, undefined);
  for (const value of [undefined, "", "   ", "default"]) assert.equal(resolveCodexTextModel(value), undefined);
  for (const value of ["gpt-6-luna", "gpt-5.5", "gpt-4o-mini"]) {
    assert.throws(() => resolveCodexTextModel(value), /TEXT_MODEL_POLICY/);
  }
  assert.equal(resolveTextReasoningEffort(), "low");
  assert.throws(() => resolveTextReasoningEffort("ultra"), /TEXT_MODEL_POLICY/);

  const runtimeFiles = [
    "scripts/simple-agent.ts",
    "scripts/lib/codex-text.ts",
    "scripts/lib/post-spec/llm-client.ts",
    "src/services/topic-task-pipeline.ts",
    "src/app/api/brandlinks/[id]/draft/route.ts",
    "src/app/api/settings/route.ts",
  ];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /api\.openai\.com|OPENAI_API_KEY|OPENAI_TEXT_MODEL|runOpenAi|openaiChat/u, file);
  }
  assert.equal(fs.existsSync("scripts/lib/openai-text.ts"), false);
  assert.equal(fs.existsSync("scripts/lib/openai-image.ts"), false);

  let codexCalls = 0;
  const generate = functionsFrom("scripts/simple-agent.ts", ["generateWithAI"], {
    BROWSER_GPT_MODE: false,
    CODEX_DRAFT_MODEL: CODEX_TEXT_MODEL,
    CODEX_DRAFT_TIMEOUT_MS: 1000,
    CODEX_DRAFT_REASONING_EFFORT: "low",
    runCodexDraft: async (options: Record<string, unknown>) => {
      codexCalls += 1;
      assert.equal(options.model, undefined);
      return "account-default";
    },
    getErrorMessage: (error: Error) => error.message,
    codexDraftTerminalFailureCode: () => null,
  });
  assert.equal(await generate.generateWithAI("sys", "user"), "account-default");
  assert.equal(codexCalls, 1);

  const sections = ["소제목\n첫 문단", "다음 문단\n끝"];
  const humanize = functionsFrom("scripts/simple-agent.ts", ["rewriteSectionsForHumanTone"], {
    buildHumanizeSectionsPrompt,
    parseHumanizeSections,
    CODEX_DRAFT_TIMEOUT_MS: 1000,
    CODEX_DRAFT_REASONING_EFFORT: "low",
    runCodexDraft: async () => JSON.stringify({ sections }),
    scanAiTells: () => ({ score: 0 }),
    getErrorMessage: (error: Error) => error.message,
  });
  assert.deepEqual(Array.from(await humanize.rewriteSectionsForHumanTone(["old1", "old2"], 10)), sections);

  let schemaSeen: unknown = null;
  const structured = functionsFrom("src/services/topic-task-pipeline.ts", ["runStructuredPrompt"], {
    STRUCTURED_MODEL_TIMEOUT_MS: 1000,
    runCodexDraft: async (options: Record<string, unknown>) => {
      schemaSeen = options.outputSchema;
      assert.equal(options.model, undefined);
      return '{"ok":true}';
    },
    parseJsonObject: JSON.parse,
  });
  const schema = { type: "object", properties: { ok: { type: "boolean" } } };
  assert.deepEqual(await structured.runStructuredPrompt({ schemaName: "check", schema, prompt: "JSON" }), { ok: true });
  assert.equal(schemaSeen, schema);

  let finished = 0;
  const route = functionsFrom("src/app/api/topic-candidates/route.ts", ["runCodex"], {
    getCodexTimeoutMs: () => 90_000,
    beginDesktopActivity: () => () => { finished += 1; },
    codexDraftTerminalFailureCode: () => null,
    runCodexDraft: async (options: Record<string, unknown>) => {
      assert.equal(options.model, undefined);
      return '{"topics":[]}';
    },
  });
  assert.equal((await route.runCodex("test")).exitCode, 0);
  assert.equal(finished, 1);

  console.log("PASS: ChatGPT-account Codex default is the only text/vision model route; API model paths are absent");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
