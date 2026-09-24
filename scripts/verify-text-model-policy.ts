import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { TEXT_MODEL, resolveTextModel, resolveTextReasoningEffort, textCompletionParameters } from "./lib/text-model-policy";
import { extractJsonObject, getOpenAiTextModel, getOpenAiVisionModel, openaiChatText } from "./lib/openai-text";
import { generateStructured } from "./lib/post-spec/llm-client";
import { buildHumanizeSectionsPrompt, parseHumanizeSections } from "./lib/humanize-response-contract";

// Execute only named functions: no agent main(), browser, database, or SDK startup.
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
  const originalFetch = globalThis.fetch;
  const envNames = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_VISION_MODEL", "TOPIC_PIPELINE_OPENAI_MODEL"];
  const savedEnv = envNames.map((name) => process.env[name]);
  let bodies: any[] = [];
  let replies: Array<{ status?: number; content?: string; finish?: string; error?: string }> = [];
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const next = replies.shift() || { content: '{"ok":true}' };
    return new Response(next.status ? next.error : JSON.stringify({ choices: [{
      message: { content: next.content }, finish_reason: next.finish || "stop",
    }] }), { status: next.status || 200 });
  }) as typeof fetch;
  try {
    process.env.OPENAI_API_KEY = "offline-test-placeholder";
    for (const name of envNames.slice(1)) process.env[name] = "gpt-4o-mini";
    assert.equal(TEXT_MODEL, "gpt-6-luna");
    assert.equal(resolveTextReasoningEffort(), "low");
    assert.throws(() => resolveTextReasoningEffort("none"), /TEXT_MODEL_POLICY/);
    assert.equal(getOpenAiTextModel(), TEXT_MODEL);
    assert.equal(getOpenAiVisionModel(), TEXT_MODEL);
    assert.equal(resolveTextModel("  "), TEXT_MODEL);
    assert.throws(() => resolveTextModel("gpt-4o-mini"), /TEXT_MODEL_POLICY/);
    for (const budget of [400, 600]) {
      await openaiChatText({ user: "Return JSON", json: true, maxOutputTokens: budget });
      assert.equal(bodies.at(-1).reasoning_effort, "low", "GPT-6 Luna has no none level");
      assert.equal(bodies.at(-1).max_completion_tokens, budget + 1024);
    }
    bodies = [];

    await openaiChatText({ user: "JSON please", json: true, temperature: 0.7 });
    await openaiChatText({ user: "Inspect image", images: [{ base64: "offline", mimeType: "image/png" }], temperature: 0 });
    assert.equal(bodies[1].messages[0].content[1].type, "image_url");
    assert.equal(bodies[0].response_format.type, "json_object");
    const request = { system: "JSON only", user: "Write", schema: { type: "object" }, schemaName: "test", temperature: 0.4, maxOutputTokens: 8192 };
    await generateStructured(request);
    assert.equal(bodies.at(-1).response_format.type, "json_schema");
    assert.equal(bodies.at(-1).reasoning_effort, "low");
    assert.equal(bodies.at(-1).max_completion_tokens, 8192 + 4096);
    replies = [{ status: 400, error: "response_format json_schema unsupported" }, { content: '{"ok":true}' }];
    const result = await generateStructured(request);
    assert.equal(result.usedSchema, false);
    assert.equal(result.model, TEXT_MODEL);
    assert.equal(bodies.at(-1).response_format.type, "json_object");
    const callsBeforeReject = bodies.length;
    await assert.rejects(openaiChatText({ user: "x", model: "gpt-4o-mini" }), /TEXT_MODEL_POLICY/);
    await assert.rejects(generateStructured({ ...request, model: "gpt-4o-mini" }), /TEXT_MODEL_POLICY/);
    assert.equal(bodies.length, callsBeforeReject);
    replies = [{ content: '{"cut":', finish: "length" }];
    await assert.rejects(openaiChatText({ user: "JSON" }), /잘렸/);
    replies = [{ status: 404, error: "model unavailable" }];
    const beforeUnavailable = bodies.length;
    await assert.rejects(generateStructured(request), /404/);
    assert.equal(bodies.length, beforeUnavailable + 1, "no fallback to another model");

    const api = functionsFrom("scripts/simple-agent.ts", ["runOpenAiApi"], {
      OPENAI_API_KEY: "offline", OPENAI_MODEL: TEXT_MODEL, OPENAI_MAX_OUTPUT_TOKENS: 8192,
      OPENAI_TIMEOUT_MS: 1000, textCompletionParameters, fetch: globalThis.fetch,
    });
    replies = [{ content: '{"sections":["첫 문단"]}' }];
    assert.equal(await api.runOpenAiApi("JSON", "rewrite"), '{"sections":["첫 문단"]}');
    for (const body of bodies) {
      assert.equal(body.model, "gpt-6-luna");
      assert.ok(body.max_completion_tokens > 0);
      assert.equal(body.reasoning_effort, "low");
      assert.ok(!("temperature" in body) && !("max_tokens" in body));
    }

    let codexCalls = 0;
    const generate = functionsFrom("scripts/simple-agent.ts", ["generateWithAI"], {
      BROWSER_GPT_MODE: true, AI_PROVIDER: "openai", TEXT_MODEL,
      CODEX_DRAFT_MODEL: TEXT_MODEL, CODEX_DRAFT_TIMEOUT_MS: 1000, CODEX_DRAFT_REASONING_EFFORT: "medium",
      runCodexDraft: async (options: any) => { codexCalls++; assert.equal(options.model, TEXT_MODEL); return "pinned"; },
      runChatGPTBrowserDirect: () => { throw new Error("browser must not run"); },
      runOpenAiApi: () => { throw new Error("unexpected API call"); },
      getErrorMessage: (error: Error) => error.message, codexDraftTerminalFailureCode: () => "CODEX_MODEL_INCOMPATIBLE",
    });
    assert.equal(await generate.generateWithAI("sys", "user", undefined, []), "pinned");
    assert.equal(codexCalls, 1);
    generate.runCodexDraft = async () => { throw new Error("unsupported model"); };
    await assert.rejects(generate.generateWithAI("sys", "user"), /unsupported model/);

    const sections = ["소제목\n첫 문단", '다음 문단 "인용"\n끝'];
    assert.match(buildHumanizeSectionsPrompt(sections), /JSON 객체/);
    assert.deepEqual(parseHumanizeSections(JSON.stringify({ sections }), 2), sections);
    assert.deepEqual(parseHumanizeSections('```json\n{"sections":["a","b"]}\n```', 2), ["a", "b"]);
    for (const raw of ['{"sections":["a"]}', '{"sections":["a",""]}', '{"sections":[{},"b"]}', "a<<<섹션구분>>>b", "null"]) {
      assert.throws(() => parseHumanizeSections(raw, 2));
    }
    const humanize = functionsFrom("scripts/simple-agent.ts", ["rewriteSectionsForHumanTone"], {
      buildHumanizeSectionsPrompt, parseHumanizeSections, OPENAI_API_KEY: "offline",
      runOpenAiApi: async () => JSON.stringify({ sections }), scanAiTells: () => ({ score: 0 }),
      getErrorMessage: (error: Error) => error.message,
    });
    assert.deepEqual(Array.from(await humanize.rewriteSectionsForHumanTone(["old1", "old2"], 10)), sections);
    humanize.runOpenAiApi = async () => '{"sections":["wrong count"]}';
    assert.deepEqual(Array.from(await humanize.rewriteSectionsForHumanTone(["old1", "old2"], 10)), ["old1", "old2"]);

    const pipeline = functionsFrom("src/services/topic-task-pipeline.ts", ["runOpenAiStructured", "runBrowserStructured"], {
      process: { env: { OPENAI_API_KEY: "offline", BROWSER_GPT_MODE: "true" } },
      ALLOW_CHATGPT_BROWSER_MODE: true, TEXT_MODEL, OPENAI_MODEL: TEXT_MODEL, STRUCTURED_MODEL_TIMEOUT_MS: 1000,
      openaiChatText, parseJsonObject: JSON.parse,
      runCodexDraft: async (options: any) => { assert.equal(options.model, TEXT_MODEL); return '{"pinned":true}'; },
    });
    assert.deepEqual(await pipeline.runBrowserStructured("JSON"), { pinned: true });
    replies = [{ content: '{"pinned":true}' }];
    assert.deepEqual(await pipeline.runOpenAiStructured("test", {}, "JSON"), { pinned: true });
    const candidateRequest = functionsFrom("src/services/topic-task-pipeline.ts", ["requestTopicCraftCandidates", "extractTopicCraftCandidates", "normalizeTopicCraftCandidate", "normalizeTopicCraftSubtopics", "normalizeTopicCraftContent"], {
      TEXT_MODEL, TOPIC_CRAFT_TIMEOUT_MS: 1000,
      extractJsonObject,
      normalizeText: (value: unknown) => typeof value === "string" ? value.trim() : "",
      normalizeStringArray: (value: unknown) => Array.isArray(value) ? value : [],
      normalizeSectionKind: () => "intro",
      runCodexDraft: async (options: any) => {
        assert.equal(options.model, TEXT_MODEL);
        assert.match(options.userPrompt, /offline source/);
        return '```json\n{"topics":[{"title":"Pinned candidate","content":"Evidence body","subtopics":[{"subtitle":"Heading","summary":"Source fact"}],"hashtags":["tag"],"image_prompt":"Scene"}]}\n```';
      },
      buildNarrativeCandidatesFromBriefs: () => [], dedupeTopicCraftCandidates: (value: unknown) => value,
    });
    const candidates = await candidateRequest.requestTopicCraftCandidates({
      category: "tech", keyword: "test", rootTopic: "test", keywords: [], topicType: "knowledge",
      packet: {}, sourceSummaries: ["offline source"], narrativeBriefs: [],
    });
    assert.equal(candidates[0].title, "Pinned candidate");
    assert.equal(candidates[0].content, "Evidence body");
    assert.equal(candidates[0].subtopics[0].summary, "Source fact");
    assert.equal(candidates[0].image_prompt, "Scene");
    candidateRequest.runCodexDraft = async () => "null";
    await assert.rejects(candidateRequest.requestTopicCraftCandidates({ sourceSummaries: [], narrativeBriefs: [] }), /JSON 객체/);

    const editorial = functionsFrom("src/services/topic-task-pipeline.ts", ["runCodexStructured", "parseJsonObject", "extractJsonBlocks"], {
      TEXT_MODEL, TOPIC_CODEX_TIMEOUT_MS: 120_000,
      runCodexDraft: async (options: any) => {
        assert.equal(options.model, TEXT_MODEL);
        assert.equal(options.timeoutMs, 120_000);
        return '```json\n{"ok":true}\n```';
      },
    });
    assert.equal((await editorial.runCodexStructured("edit")).ok, true);
    editorial.runCodexDraft = async () => "malformed";
    assert.equal(await editorial.runCodexStructured("edit"), null);
    editorial.runCodexDraft = async () => { throw new Error("unavailable"); };
    assert.equal(await editorial.runCodexStructured("edit"), null);

    let finished = 0;
    const route = functionsFrom("src/app/api/topic-candidates/route.ts", ["runCodex", "POST", "summarizeCodexFailure"], {
      TEXT_MODEL, getCodexTimeoutMs: () => 90_000,
      beginDesktopActivity: () => () => { finished++; },
      codexDraftTerminalFailureCode: (error: any) => error.code,
      normalizeSpace: (value: string) => value.trim(), extractJsonObject,
      requireAdminApiKey: () => null, requireNoPendingDesktopUpdate: () => null,
      CATEGORIES: { tech: "IT" }, NextResponse: { json: (value: unknown) => value },
      buildFallbackTopics: () => [{ title: "local fallback" }],
      runCodexDraft: async (options: any) => {
        assert.equal(options.model, TEXT_MODEL);
        assert.equal(options.timeoutMs, 90_000);
        return '```json\n{"topics":[{"title":"SDK topic"}]}\n```';
      },
    });
    const req = { json: async () => ({ category: "tech", keyword: "test" }) };
    assert.equal((await route.POST(req)).topics[0].title, "SDK topic");
    assert.equal(finished, 1);
    route.runCodexDraft = async () => { throw Object.assign(new Error("timeout"), { code: "CODEX_TIMEOUT" }); };
    assert.equal((await route.runCodex("test")).timedOut, true);
    assert.equal(finished, 2, "activity released on SDK failure");
    route.runCodexDraft = async () => '{"wrong":[]}';
    assert.equal((await route.POST(req)).fallback, true, "malformed envelope must not be presented as model candidates");
    assert.equal(finished, 3);
    for (const file of ["src/services/topic-task-pipeline.ts", "src/app/api/topic-candidates/route.ts"]) {
      assert.doesNotMatch(fs.readFileSync(file, "utf8"), /--full-auto|\/Users\/jakeshin|\bspawn\(|CODEX_BIN/);
    }
    const topicSource = fs.readFileSync("scripts/topic-agent.ts", "utf8");
    const topicAst = ts.createSourceFile("topic-agent.ts", topicSource, ts.ScriptTarget.Latest, true);
    const topicFunction = topicAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "generateAdvancedContent")!;
    assert.match(topicFunction.getText(topicAst), /await runCodexDraft\(/);
    assert.doesNotMatch(topicFunction.getText(topicAst), /sendPromptToChatGPT|createChatGPTContext/);
    console.log("PASS: GPT-6 Luna text/vision/structured/API/Codex/browser routing, no model downgrade, humanize JSON contract (offline mocks only)");
  } finally {
    globalThis.fetch = originalFetch;
    envNames.forEach((name, index) => {
      if (savedEnv[index] === undefined) delete process.env[name]; else process.env[name] = savedEnv[index];
    });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
