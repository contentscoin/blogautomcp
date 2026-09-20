import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import ts from "typescript";
import { test } from "node:test";
import * as readiness from "../src/lib/topic-task-publish-readiness";

const content = JSON.stringify({ title: "주제", sections: [{ heading: "설명", body: "본문" }], hashtags: [] });
const task = { id: "approved", status: "PREPARED", pipelineStage: "PREPARED", selectedDraftId: "draft", preparedContentJson: content,
  topic: "주제", scheduledPublishAt: new Date("2030-01-01"), updatedAt: new Date(0) };
const hero = { localPath: "hero.jpg", provider: "source", role: "hero" };
const inline = { localPath: "inline.jpg", provider: "source", role: "inline" };
class TopicPrepareConflictError extends Error {}

function evaluate(source: string, bindings: Record<string, unknown>) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  const context = vm.createContext({ console, URL, Date, setTimeout, ...bindings });
  vm.runInContext(compiled.outputText, context);
  return context;
}

function functionSource(file: string, name: string): string {
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return declaration.getText(ast);
}

function routeHarness(file: string, images = [hero], tasks = [task]) {
  const calls: { args?: string[]; sources?: string[]; claim?: unknown } = {};
  const child = Object.assign(new EventEmitter(), { pid: 123, unref() {} });
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status: number }) => ({ body, status: options?.status || 200 }) } },
    "@/lib/db": { prisma: {
      topicPostTask: { findUnique: async () => tasks[0], findMany: async () => tasks, count: async () => 0,
        updateMany: async (input: unknown) => { calls.claim = input; return { count: 1 }; } },
      topicDraftImage: { findMany: async () => images.map((image) => ({ ...image, draftId: "draft" })) },
      topicDraft: { findUnique: async () => ({ campaign: { sourceUrls: '["https://source.example/fact"]' } }),
        findMany: async () => [{ id: "draft", campaign: { sourceUrls: '["https://source.example/fact"]' } }] },
    } },
    "child_process": { spawn: (_: unknown, args: string[]) => { calls.args = args; return child; } },
    path,
    fs: { statSync: (file: string) => { if (file === "missing.jpg") throw new Error("ENOENT"); return { isFile: () => true, size: 1 }; },
      mkdirSync() {}, openSync: () => 1, writeSync() {}, closeSync() {} },
    "@/lib/api-auth": { requireAdminApiKey: () => null },
    "@/lib/update-guard": { requireNoPendingDesktopUpdate: () => null },
    "@/services/topic-task-pipeline": { taskHasPreparedContent: () => true, TOPIC_CRAFT_CATEGORIES: [], TopicPrepareConflictError },
    "@/lib/topic-task-publish-readiness": readiness,
    "@/lib/topic-task-content-readiness": { getTopicTaskContentReadiness: (input: { sourceUrls: string[] }) => {
      calls.sources = input.sourceUrls; return { canPublish: input.sourceUrls.length > 0 }; } },
  };
  const exports: Record<string, any> = {};
  evaluate(fs.readFileSync(file, "utf8"), { exports, console: { error() {} }, process: { env: {}, cwd: () => process.cwd(), execPath: process.execPath },
    require: (id: string) => { assert.ok(id in mocks, `Unexpected import: ${id}`); return mocks[id]; } });
  return { calls, post: exports.POST, patch: exports.PATCH, child };
}

test("missing hero file blocks even when an inline image survives", () => {
  const result = readiness.getTopicTaskPublishReadiness({ ...task, preparedImages: [hero, inline] }, (file) => file === "inline.jpg");
  assert.equal(result.canPublish, false);
  assert.equal(result.hasHero, false);
  assert.equal(result.resolvedImageCount, 1);
});

test("real source hero is accepted, generic hero still blocked", () => {
  assert.equal(readiness.getTopicTaskPublishReadiness({ ...task, preparedImages: [hero] }, () => true).canPublish, true);
  assert.equal(readiness.getTopicTaskPublishReadiness({ ...task, preparedImages: [{ ...hero, provider: "picsum" }] }, () => true).code, "generic-images");
  assert.equal(readiness.getTopicTaskPublishReadiness({ ...task, preparedImages: [hero] }, () => false).canPublish, false);
});

test("immediate route passes explicit now and original campaign sources", async () => {
  const h = routeHarness("src/app/api/topic-tasks/[id]/publish/route.ts");
  const response = await h.post({ json: async () => ({ publishMode: "now" }) }, { params: Promise.resolve({ id: task.id }) });
  assert.equal(response.status, 200);
  assert.ok(h.calls.args?.includes("--publish-mode=now"));
  assert.deepEqual(h.calls.sources, ["https://source.example/fact"]);
});

test("route refuses a missing hero before spawning", async () => {
  const h = routeHarness("src/app/api/topic-tasks/[id]/publish/route.ts", [{ ...hero, localPath: "missing.jpg" }, inline]);
  const response = await h.post({ json: async () => ({ publishMode: "now" }) }, { params: Promise.resolve({ id: task.id }) });
  assert.equal(response.status, 409);
  assert.equal(h.calls.args, undefined);
});

test("bulk route freezes approved IDs and caps the actual selection", async () => {
  const h = routeHarness("src/app/api/topic-tasks/bulk-schedule/route.ts", [hero], [task, { ...task, id: "other" }]);
  const response = await h.post({ json: async () => ({ limit: 1 }) });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.targetCount, 1);
  assert.ok(h.calls.args?.includes('--task-ids=["approved"]'));
  assert.deepEqual(h.calls.sources, ["https://source.example/fact"]);
});

test("worker parses exact IDs and rejects empty selection instead of broadening", () => {
  const scope = evaluate(functionSource("scripts/bulk-topic-schedule-publish.ts", "parseArgs"), {});
  assert.deepEqual(Array.from(scope.parseArgs(['--task-ids=["a","a","b"]']).taskIds), ["a", "b"]);
  assert.throws(() => scope.parseArgs(['--task-ids=[]']));
});

test("worker queries only approved IDs and never counts an unrelated completion state as success", async () => {
  let query: any;
  const processStub = { argv: [], exitCode: 0 };
  const scope = evaluate(functionSource("scripts/bulk-topic-schedule-publish.ts", "main"), {
    PrismaClient: class {
      topicPostTask = {
        findMany: async (input: unknown) => { query = input; return [task]; },
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => ({ status: "PREPARED" }),
      };
      topicDraftImage = { findMany: async () => [hero] };
      topicDraft = { findUnique: async () => ({ campaign: { sourceUrls: '[]' } }) };
      async $disconnect() {}
    },
    process: processStub,
    console: { log() {} },
    parseArgs: () => ({ limit: 1, taskIds: ["approved"], delayMs: 0, dryRun: false }),
    getPublishBlocker: () => null,
    getTopicTaskContentReadiness: () => ({ reason: null }),
    parseTopicSourceUrls: readiness.parseTopicSourceUrls,
    formatYmd: () => "2030-01-01",
    runTopicAgent: async () => ({ code: 0, signal: null }),
    getErrorMessage: String,
  });
  await scope.main();
  assert.deepEqual(Array.from(query.where.id.in), ["approved"]);
  assert.equal(query.take, 1);
  assert.equal(query.where.pipelineStage.not, "OUTCOME_UNKNOWN");
  assert.equal(processStub.exitCode, 1);
});

test("only a concrete post in the expected blog is a publish receipt", () => {
  for (const url of ["https://blog.naver.com/me/123", "https://blog.naver.com/PostView.naver?blogId=me&logNo=123"]) {
    assert.equal(readiness.isTopicPublishedUrl(url, "me"), true);
  }
  for (const url of ["https://evil.example/PostView?logNo=123", "https://blog.naver.com/PostView.naver", "https://blog.naver.com/other/123", "https://blog.naver.com/PostWriteForm.naver?logNo=123"]) {
    assert.equal(readiness.isTopicPublishedUrl(url, "me"), false);
  }
});

test("topic scheduling accepts verified response alone, even after browser closes", async () => {
  const scope = evaluate(functionSource("scripts/topic-agent.ts", "waitForScheduleSubmission"), {
    formatDateYmd: () => "2030-01-01",
    waitForConfirmedScheduleSubmission: async (tracker: any) => tracker.confirmed,
  });
  const page = { isClosed: () => true };
  await scope.waitForScheduleSubmission(page, new Date(), { confirmed: true });
  await assert.rejects(scope.waitForScheduleSubmission(page, new Date(), { confirmed: false }));
});

test("final click persists uncertainty first and never retries a failed click", async () => {
  const events: string[] = [];
  const button = { isVisible: async () => true, textContent: async () => "발행", getAttribute: async () => "",
    click: async () => { events.push("click"); throw new Error("connection lost"); } };
  const page = { locator: () => ({ first: () => button }), waitForTimeout: async () => {} };
  const scope = evaluate(functionSource("scripts/topic-agent.ts", "clickFinalPublishButton"), {
    compactUiText: (text: string) => text, isReservedPostsListText: () => false,
  });
  await assert.rejects(scope.clickFinalPublishButton(page, "now", async () => { events.push("OUTCOME_UNKNOWN"); }));
  assert.deepEqual(events, ["OUTCOME_UNKNOWN", "click"]);
  events.length = 0;
  await assert.rejects(scope.clickFinalPublishButton(page, "now", async () => { throw new Error("DB unavailable"); }));
  assert.deepEqual(events, [], "no click when durable marker cannot be saved");
});

test("uncertain failed tasks are blocked by readiness and single publish API", async () => {
  const uncertain = { ...task, status: "FAILED", pipelineStage: "OUTCOME_UNKNOWN" };
  assert.equal(readiness.getTopicTaskPublishReadiness({ ...uncertain, preparedImages: [hero] }).code, "outcome-unknown");
  const h = routeHarness("src/app/api/topic-tasks/[id]/publish/route.ts", [hero], [uncertain]);
  const response = await h.post({ json: async () => ({ publishMode: "now" }) }, { params: Promise.resolve({ id: task.id }) });
  assert.equal(response.status, 409);
  assert.equal(h.calls.args, undefined);
});

test("unconfirmed child exit preserves an unknown outcome, even with code zero", async () => {
  const h = routeHarness("src/app/api/topic-tasks/[id]/publish/route.ts");
  await h.post({ json: async () => ({ publishMode: "now" }) }, { params: Promise.resolve({ id: task.id }) });
  h.child.emit("exit", 0, null);
  const update = h.calls.claim as any;
  assert.equal(update.where.status, "PUBLISHING", "confirmed completion must not be overwritten");
  assert.equal(update.data.pipelineStage, "OUTCOME_UNKNOWN");
});

test("bulk selection excludes uncertain tasks even if previously marked FAILED", async () => {
  const h = routeHarness("src/app/api/topic-tasks/bulk-schedule/route.ts", [hero], [{ ...task, status: "FAILED", pipelineStage: "OUTCOME_UNKNOWN" }]);
  const result = await h.post({ json: async () => ({ limit: 1 }) });
  assert.equal(result.body.data.targetCount, 0);
  assert.equal(h.calls.args, undefined);
});

test("ordinary content and metadata edits cannot erase an unknown submission", async () => {
  for (const body of [{ topic: "수정 제목" }, { memo: "수정" }, { categoryNo: "1" }, { scheduledPublishAt: "2030-01-01" }]) {
    const h = routeHarness("src/app/api/topic-tasks/[id]/route.ts", [hero], [{ ...task, status: "FAILED", pipelineStage: "OUTCOME_UNKNOWN" }]);
    const result = await h.patch({ json: async () => body }, { params: Promise.resolve({ id: task.id }) });
    assert.equal(result.status, 409);
    assert.equal(h.calls.claim, undefined, "no mutation before conflict");
  }
});

test("ordinary editable tasks still update with a concurrent outcome guard", async () => {
  const h = routeHarness("src/app/api/topic-tasks/[id]/route.ts");
  const result = await h.patch({ json: async () => ({ topic: "수정 제목" }) }, { params: Promise.resolve({ id: task.id }) });
  assert.equal(result.status, 200);
  const update = h.calls.claim as any;
  assert.equal(update.where.pipelineStage.not, "OUTCOME_UNKNOWN");
  assert.equal(update.where.status.not, "PUBLISHING");
  assert.equal(update.data.pipelineStage, "READY");
});

test("prepare rejects unknown or publishing tasks before locks or external work", async () => {
  for (const state of [{ ...task, status: "FAILED", pipelineStage: "OUTCOME_UNKNOWN" }, { ...task, status: "PUBLISHING" }]) {
    let locks = 0;
    const scope = evaluate(functionSource("src/services/topic-task-pipeline.ts", "prepareTopicTask"), {
      exports: {}, getTaskForPrepare: async () => state, TopicPrepareConflictError,
      acquirePrepareLock: () => { locks++; throw new Error("unexpected side effect"); },
    });
    await assert.rejects(scope.prepareTopicTask(task.id), TopicPrepareConflictError);
    assert.equal(locks, 0);
  }
});

test("prepare claim loses to a concurrent publisher without discovery or failure writes", async () => {
  let writes = 0;
  let released = 0;
  const scope = evaluate(functionSource("src/services/topic-task-pipeline.ts", "prepareTopicTask"), {
    exports: {}, getTaskForPrepare: async () => task, TopicPrepareConflictError,
    acquirePrepareLock: () => () => { released++; },
    prisma: { topicPostTask: { updateMany: async (input: any) => {
      writes++;
      assert.equal(input.where.updatedAt, task.updatedAt);
      assert.equal(input.where.pipelineStage.not, "OUTCOME_UNKNOWN");
      assert.equal(input.where.status.not, "PUBLISHING");
      return { count: 0 };
    } } },
    mapTaskTypeToTopicType: () => { throw new Error("must not start work after lost claim"); },
  });
  await assert.rejects(scope.prepareTopicTask(task.id), TopicPrepareConflictError);
  assert.equal(writes, 1, "no FAILED cleanup after claim conflict");
  assert.equal(released, 1);
});

test("an outcome marker arriving during discovery survives subsequent prepare stage and catch", async () => {
  let writes = 0;
  let stage = "PREPARED";
  const scope = evaluate([
    functionSource("src/services/topic-task-pipeline.ts", "setTaskStage"),
    functionSource("src/services/topic-task-pipeline.ts", "prepareTopicTask"),
  ].join("\n"), {
    exports: {}, getTaskForPrepare: async () => task, TopicPrepareConflictError,
    acquirePrepareLock: () => () => {},
    prisma: { topicPostTask: { updateMany: async (input: any) => {
      writes++;
      assert.equal(input.where.pipelineStage.not, "OUTCOME_UNKNOWN");
      if (stage === "OUTCOME_UNKNOWN") return { count: 0 };
      stage = input.data.pipelineStage;
      return { count: 1 };
    } } },
    mapTaskTypeToTopicType: () => "knowledge", parseKeywords: () => [], extractSourceUrlsFromTask: () => [],
    discoverTopicSourceUrls: async () => { assert.equal(stage, "RESEARCHING"); stage = "OUTCOME_UNKNOWN"; return []; },
    dedupeStrings: (values: unknown) => values, normalizeTopicCraftCategory: () => "기술 / IT",
  });
  await assert.rejects(scope.prepareTopicTask(task.id), TopicPrepareConflictError);
  assert.equal(stage, "OUTCOME_UNKNOWN");
  assert.equal(writes, 2, "no catch-and-FAILED overwrite after stage conflict");
});

test("review top-level rejection sets nonzero exit status", async () => {
  const source = fs.readFileSync("scripts/review-agent.ts", "utf8");
  const processStub = { exitCode: 0 };
  evaluate(source.slice(source.lastIndexOf("main().catch")), { main: async () => { throw new Error("fixture failure"); }, process: processStub, console: { error() {} } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(processStub.exitCode, 1);
});
