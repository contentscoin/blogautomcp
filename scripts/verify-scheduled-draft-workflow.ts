import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { runMaterialPreparation, runAutomaticDraftWorkflow, localScheduleCall, type Call } from "./lib/scheduled-draft-workflow";
import { runMaterialJob } from "../src/lib/material-job-runner";
import { readMaterialJob, saveMaterialJob, acquireMaterialJobLock, type MaterialJob } from "../src/lib/material-job-store";
import { materialRevision, validateMaterialSelection } from "../src/lib/material-library";
import type { BrandPostPackageManifest } from "../src/lib/brand-post-package";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "material-workflow-test-"));
  const previousRoot = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = dir;
  const revision = "a".repeat(64);
  const makeJob = (count = 10, kind: "publish" | "prepare" = "publish"): MaterialJob => ({
    jobId: crypto.randomUUID(), kind, status: "running", ownerPid: process.pid,
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), publishMode: "now",
    items: Array.from({ length: count }, (_, index) => ({ productId: `product-${index}`, revision, status: "queued", stage: "대기" })),
  });
  const material = (id: string) => ({ productId: id, revision, title: id, connectKind: "SHOPPING" as const, ready: true, blockers: [] as string[], score: 100, imageCount: 3, createdAt: "", approvedAt: "approved" });
  try {
    const events: string[] = [];
    const call: Call = async (url, method) => {
      events.push(`${method} ${url}`);
      if (url.endsWith("/draft")) return { success: true, data: { approvedAt: "approved", imageSlots: [] } };
      return { success: true, data: { status: "PUBLISHED", published: true, postUrl: "https://blog.naver.com/test/1234" } };
    };
    const job = makeJob();
    await runMaterialJob(job, { call, material, save: saveMaterialJob, pause: async () => {}, checkCancelled: () => {} });
    assert.equal(job.status, "completed");
    assert.equal(job.items.filter(item => item.status === "published").length, 10);
    assert.deepEqual(events.filter(event => event.startsWith("POST")), job.items.map(item => `POST /api/brandlinks/${item.productId}/publish`));
    assert(!events.some(event => /PATCH|images/.test(event)), "publication must never repair or generate materials");
    assert.equal(readMaterialJob(job.jobId)?.items.length, 10, "terminal history persists beyond in-memory job lifetime");

    for (const unready of [null, { approvedAt: null }, { approvedAt: "yes", imageSlots: [{ missing: 1, generationMissing: 0 }] }, { approvedAt: "yes", approval: { canApprove: false } }]) {
      let submitted = 0;
      await assert.rejects(runAutomaticDraftWorkflow("product-0", { publishMode: "now" }, { pause: async () => {}, call: async (url, method) => {
        if (method === "POST") submitted++;
        return { success: true, data: unready };
      } }), /준비·승인/);
      assert.equal(submitted, 0);
    }
    const changed = makeJob(1);
    let submitted = 0;
    await runMaterialJob(changed, { call: async (url, method, body) => { if (method === "POST") submitted++; return call(url, method, body); },
      material: id => ({ ...material(id), revision: "b".repeat(64) }), save: saveMaterialJob, pause: async () => {}, checkCancelled: () => {} });
    assert.equal(submitted, 0); assert.equal(changed.items[0].status, "failed");
    assert.match(changed.items[0].error!, /변경/);

    const recovered = makeJob();
    const requests: string[] = [];
    await runMaterialJob(recovered, { call: async (url, method, body) => {
      if (method === "POST") { requests.push(url); throw new Error("response lost after submit"); }
      return call(url, method, body);
    }, material, save: saveMaterialJob, pause: async () => {}, checkCancelled: () => {} });
    assert.equal(requests.length, 10);
    assert.equal(recovered.items.filter(item => item.status === "published").length, 10);

    const uncertain = makeJob();
    let baseReads = 0;
    await runMaterialJob(uncertain, { call: async (url, method) => {
      if (method === "POST") throw new Error("response lost before submit");
      if (!url.endsWith("/draft")) baseReads++;
      return { success: true, data: url.endsWith("/draft") ? { approvedAt: "approved", imageSlots: [] } : { status: "DRAFTED" } };
    }, material, save: saveMaterialJob, pause: async () => {}, checkCancelled: () => {} });
    assert.equal(baseReads, 1);
    assert.equal(uncertain.items[0].status, "outcome_unknown");
    assert.equal(uncertain.items.filter(item => item.status === "interrupted").length, 9, "lost POST response must halt the batch without another submission");

    const unverified = makeJob(2);
    await runMaterialJob(unverified, { call: async (url, method, body) => url.endsWith("/verify")
      ? { success: true, data: { published: false, verificationBasis: "unverified" } } : call(url, method, body),
      material, save: saveMaterialJob, pause: async () => {}, checkCancelled: () => {} });
    assert.equal(unverified.items[0].status, "outcome_unknown", "DB terminal status alone is not verified publication");
    assert.equal(unverified.items[1].status, "interrupted");

    for (const unexpected of ["SCHEDULED", "READY", "FAILED", undefined]) {
      const mismatch = makeJob(2);
      let submissions = 0;
      await runMaterialJob(mismatch, { call: async (url, method) => {
        if (method === "POST") submissions++;
        return { success: true, data: url.endsWith("/draft") ? { approvedAt: "yes" } : { status: unexpected, attemptStage: "SUBMITTING" } };
      }, material, save: saveMaterialJob, pause: async () => {}, checkCancelled: () => {} });
      assert.equal(mismatch.items[0].status, "outcome_unknown", `unexpected ${unexpected} after submission requires reconciliation`);
      assert.equal(submissions, 1);
      assert.equal(mismatch.items[1].status, "interrupted");
    }

    let preparePublishes = 0, created = 0, rechecks = 0, repairs = 0, approvalAttempts = 0;
    await runMaterialPreparation("product-0", { pause: async () => {}, call: async (url, method, body) => {
      if (url.endsWith("/publish")) preparePublishes++;
      if (method === "POST" && url.endsWith("/draft")) {
        created++;
        assert.equal((body as { autoSectionImages?: boolean }).autoSectionImages, false, "prepare must validate text before section generation");
      }
      const action = (body as { action?: string })?.action;
      if (action === "recheck") rechecks++;
      if (action === "revise") repairs++;
      if (action === "approve") { approvalAttempts++; assert.equal(repairs, 1); }
      return { success: true, data: method === "GET" && !created ? null : { approvedAt: approvalAttempts ? "yes" : null, imageSlots: [], contentQuality: { signals: [{ key: "review-substance", status: repairs ? "pass" : "fail" }] } } };
    } });
    assert.equal(preparePublishes, 0); assert.equal(created, 1); assert.equal(rechecks, 3); assert.equal(repairs, 1); assert.equal(approvalAttempts, 1);

    const travelEvents: string[] = []; let imagesDone = false;
    await runMaterialPreparation("travel-existing", { pause: async () => {}, call: async (url, method, body) => {
      const action = (body as { action?: string })?.action || method;
      travelEvents.push(action);
      if (url.endsWith("/images")) imagesDone = true;
      return { success: true, data: { approvedAt: travelEvents.includes("approve") ? "yes" : null, imageSlots: [{ missing: imagesDone ? 0 : 1, generationMissing: 0 }], contentQuality: { signals: [{ key: "composition-quality", status: imagesDone ? "pass" : "fail" }] } } };
    } });
    assert(travelEvents.includes("generate_missing"), "travel ORIGINAL slots still require images when generationMissing is zero");
    assert(!travelEvents.includes("revise"), "image-only failure must preserve manuscript");
    assert(travelEvents.indexOf("recheck") < travelEvents.indexOf("generate_missing"));
    assert(travelEvents.indexOf("generate_missing") < travelEvents.indexOf("approve"));

    const runningEvents: string[] = [];
    let runningPolls = 0;
    await runMaterialPreparation("travel-running-images", { pause: async () => { runningPolls++; }, call: async (url, method, body) => {
      const action = (body as { action?: string })?.action || method;
      runningEvents.push(action);
      if (method === "GET" && runningPolls < 2) return { success: true, data: { imageGeneration: { status: "running" }, imageSlots: [] } };
      return { success: true, data: { imageSlots: [], contentQuality: { signals: [] }, approvedAt: runningEvents.includes("approve") ? "yes" : null } };
    } });
    assert(runningPolls >= 2, "material preparation must wait for existing image generation");
    assert(runningEvents.indexOf("GET") < runningEvents.indexOf("recheck"), "recheck must not run while image generation is active");

    let imageWaitPolls = 0;
    const waiting = makeJob(1, "prepare");
    await runMaterialJob(waiting, { call: async (_url, _method, body) => ({ success: true, data: {
      imageGeneration: { status: imageWaitPolls < 25 ? "running" : "idle" },
      imageSlots: [], approvedAt: "yes",
    } }), material, save: saveMaterialJob, pause: async () => { imageWaitPolls++; }, checkCancelled: () => {} });
    assert.equal(waiting.items[0].status, "ready");
    assert.equal(waiting.events?.filter(event => event.stage === "이미지 준비 대기").length, 1, "unchanged polling must not flood MCP result pages");

    await assert.rejects(runMaterialPreparation("approval-not-persisted", {
      pause: async () => {}, call: async () => ({ success: true, data: { approvedAt: null, imageSlots: [] } }),
    }), /소재 준비·승인이 완료되지/);

    let blockedImages = 0, blockedRevisions = 0;
    await assert.rejects(runMaterialPreparation("travel-weak", { pause: async () => {}, call: async (url, method, body) => {
      if (url.endsWith("/images")) blockedImages++;
      if ((body as { action?: string })?.action === "revise") blockedRevisions++;
      return { success: true, data: { imageSlots: [{ missing: 1, generationMissing: 0 }], contentQuality: { signals: [{ key: "review-substance", status: "fail" }] } } };
    } }), /보강 후에도/);
    assert.equal(blockedRevisions, 1); assert.equal(blockedImages, 0);

    const partial = makeJob(10, "prepare");
    await runMaterialJob(partial, { call: async (url) => {
      if (url.includes("product-3/")) throw Object.assign(new Error("provider refused"), { code: "IMAGE_PROVIDER_REFUSED" });
      return { success: true, data: { approvedAt: "yes", imageSlots: [] } };
    }, material, save: saveMaterialJob, pause: async () => {}, checkCancelled: () => {} });
    assert.equal(partial.status, "partial"); assert.equal(partial.items.filter(item => item.status === "ready").length, 9);
    assert.equal(partial.items.filter(item => item.status === "failed").length, 1);

    const uncertainPreparation = makeJob(10, "prepare");
    let preparationSubmissions = 0;
    await runMaterialJob(uncertainPreparation, { call: async (_url, method) => {
      if (method !== "GET") { preparationSubmissions++; throw Object.assign(new Error("response lost while draft child is still running"), { code: "ECONNRESET" }); }
      return { success: true, data: null };
    }, material, save: saveMaterialJob, pause: async () => {}, checkCancelled: () => {} });
    assert.equal(preparationSubmissions, 1);
    assert.equal(uncertainPreparation.items[0].status, "interrupted");
    assert.equal(uncertainPreparation.items.filter(item => item.status === "interrupted").length, 10);

    const auth = makeJob(10, "prepare"); let authCalls = 0;
    await runMaterialJob(auth, { call: async () => { authCalls++; throw Object.assign(new Error("login required"), { code: "CHATGPT_BROWSER_AUTH_REQUIRED" }); },
      material, save: saveMaterialJob, pause: async () => {}, checkCancelled: () => {} });
    assert.equal(authCalls, 1); assert.equal(auth.items.filter(item => item.status === "interrupted").length, 9);

    let legacyPolls = 0;
    await assert.rejects(runMaterialPreparation("product-0", { pause: async () => { legacyPolls++; }, call: async () => ({ success: true, data: { imageGeneration: { status: "running", recoveryState: "owner-unknown" } } }) }), /이전 이미지 작업/);
    assert.equal(legacyPolls, 0, "legacy owner-unknown must not poll for ninety minutes");
    const authPartial = makeJob(10, "prepare"); let batchGenerations = 0;
    await runMaterialJob(authPartial, { call: async url => {
      if (url.endsWith("/images")) { batchGenerations++; return { success: true, code: "CHATGPT_BROWSER_AUTH_REQUIRED", errors: ["login required after first success"], data: {} }; }
      return { success: true, data: { imageSlots: [{ missing: 1, generationMissing: 0 }] } };
    }, material, save: saveMaterialJob, pause: async () => {}, checkCancelled: () => {} });
    assert.equal(batchGenerations, 1); assert.equal(authPartial.items.filter(item => item.status === "interrupted").length, 9);
    const orphanedSamePid = makeJob(1); saveMaterialJob(orphanedSamePid);
    assert.equal(readMaterialJob(orphanedSamePid.jobId)?.status, "interrupted", "orphaned jobs from a reused PID must not remain running");

    const interrupted = makeJob(2); interrupted.ownerPid = 99999999; interrupted.items[0].status = "publishing";
    saveMaterialJob(interrupted);
    const restored = readMaterialJob(interrupted.jobId)!;
    assert.equal(restored.status, "interrupted"); assert.equal(restored.items[0].status, "outcome_unknown");
    assert.equal(restored.items[1].status, "interrupted");
    const unlock = acquireMaterialJobLock(crypto.randomUUID());
    assert.throws(() => acquireMaterialJobLock(crypto.randomUUID()), /진행 중/); unlock();
    acquireMaterialJobLock(crypto.randomUUID())();

    const markdown = path.join(dir, "post.md"), image = path.join(dir, "hero.png");
    fs.writeFileSync(markdown, "original text"); fs.writeFileSync(image, "original image");
    const manifest = { version: "brand-post-package/v1", markdownPath: markdown, heroImagePath: image, bodyImagePaths: [], title: "fixture" } as unknown as BrandPostPackageManifest;
    const first = materialRevision(manifest);
    fs.writeFileSync(image, "replacement image"); assert.notEqual(first, materialRevision(manifest));
    const second = materialRevision(manifest); fs.writeFileSync(markdown, "changed manuscript"); assert.notEqual(second, materialRevision(manifest));
    assert.throws(() => validateMaterialSelection([]));
    assert.throws(() => validateMaterialSelection([{ productId: "product-0", revision }, { productId: "product-0", revision }]));
    assert.equal(validateMaterialSelection(makeJob().items).length, 10);

    let time = 0, postCount = 0;
    await assert.rejects(runAutomaticDraftWorkflow("product-0", { publishMode: "now" }, { now: () => time, timeoutMs: 5, pause: async () => { time += 10; }, call: async (url, method) => {
      if (method === "POST") postCount++;
      return { success: true, data: url.endsWith("/draft") ? { approvedAt: "yes" } : { status: "PUBLISHING" } };
    } }), /제한시간/);
    assert.equal(postCount, 1);

    const previousPort = process.env.APP_PORT;
    const server = http.createServer((_request, response) => {
      response.writeHead(422, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: false, errors: ["shopping-hook: segmentation failed"] }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try { process.env.APP_PORT = String((server.address() as { port: number }).port); await assert.rejects(localScheduleCall("/draft/images", "POST", {}), /segmentation failed/); }
    finally { if (previousPort === undefined) delete process.env.APP_PORT; else process.env.APP_PORT = previousPort; await new Promise<void>(resolve => server.close(() => resolve())); }

    let getRequests = 0, postRequests = 0, invalidRequests = 0;
    const resetServer = http.createServer((request, response) => {
      if (request.method === "POST") { postRequests++; request.socket.destroy(); return; }
      if (request.url === "/invalid") { invalidRequests++; response.writeHead(403); response.end(JSON.stringify({ success: false, code: "UNAUTHORIZED", error: "fixture denied" })); return; }
      getRequests++;
      if (getRequests === 1) { response.writeHead(200, { "content-type": "application/json" }); response.write('{"success":'); setImmediate(() => response.destroy()); return; }
      response.end(JSON.stringify({ success: true, data: { approvedAt: "persisted" } }));
    });
    await new Promise<void>(resolve => resetServer.listen(0, "127.0.0.1", resolve));
    try {
      process.env.APP_PORT = String((resetServer.address() as { port: number }).port);
      assert.equal((await localScheduleCall("/draft", "GET")).data?.approvedAt, "persisted");
      assert.equal(getRequests, 2, "a truncated read response can be recovered on a fresh socket");
      await assert.rejects(localScheduleCall("/publish", "POST", {}));
      assert.equal(postRequests, 1, "uncertain mutation must never be replayed");
      await assert.rejects(localScheduleCall("/invalid", "GET"), /fixture denied/);
      assert.equal(invalidRequests, 1, "HTTP application failures are not transient transport errors");
    } finally {
      if (previousPort === undefined) delete process.env.APP_PORT; else process.env.APP_PORT = previousPort;
      await new Promise<void>(resolve => resetServer.close(() => resolve()));
    }
    console.log("PASS: 10 selected publications, zero generation during publishing, separate preparation, stale revision, partial 9/10, auth halt, uncertain result halt, durable restart/locking, file hashes, bounded polling, transport errors");
  } finally {
    if (previousRoot === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previousRoot;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
void main();
