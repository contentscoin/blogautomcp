import assert from "node:assert/strict";
import http from "node:http";
import { runScheduledDraftWorkflow, runAutomaticDraftWorkflow, localScheduleCall } from "./lib/scheduled-draft-workflow";
import { preparedPostsFirst } from "../src/lib/prepared-post-priority";
import { beginAutomaticPublishing, automaticPublishingCancellationCheck, cancelAutomaticPublishing } from "../src/lib/desktop-activity";

async function main() {
  const previousPort = process.env.APP_PORT;
  const server = http.createServer((_request, response) => {
    response.writeHead(422, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: false, errors: ["shopping-hook: segmentation failed"], message: "No images" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.APP_PORT = String((server.address() as { port: number }).port);
    await assert.rejects(localScheduleCall("/draft/images", "POST", {}), /shopping-hook: segmentation failed/);
  } finally {
    if (previousPort === undefined) delete process.env.APP_PORT;
    else process.env.APP_PORT = previousPort;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  const candidates = Array.from({ length: 15 }, (_, i) => ({ id: String(i) }));
  const selected = preparedPostsFirst(candidates, 10, id => Number(id) >= 12);
  assert.deepEqual(selected.map(row => row.id), ["12", "13", "14", "0", "1", "2", "3", "4", "5", "6"]);
  assert.equal(preparedPostsFirst(candidates.slice(0, 3), 10, () => false).length, 3);
  assert.equal(candidates[0].id, "0", "do not mutate source ordering");
  const release = beginAutomaticPublishing("automatic-post");
  assert.throws(() => beginAutomaticPublishing("bulk-today-publish"), /진행 중/);
  const check = automaticPublishingCancellationCheck();
  cancelAutomaticPublishing();
  assert.throws(check, /중단/);
  release();
  beginAutomaticPublishing("bulk-schedule-publish")();
  for (const terminal of ["PUBLISHED", "READY", "SCHEDULED", "FAILED"]) {
    let created = 0, published = 0, waits = 0;
    const promise = runAutomaticDraftWorkflow("new-product", { publishMode: "now" }, {
      pause: async () => { waits++; },
      call: async (url, method, body) => {
        if (url.endsWith("/draft") && method === "GET") return { success: true, data: null };
        if (url.endsWith("/draft") && method === "POST") created++;
        if (url.endsWith("/publish")) {
          published++;
          assert.deepEqual(body, { publishMode: "now" });
        }
        if (url.endsWith("/new-product")) return { success: true, data: { status: waits < 120 ? "PUBLISHING" : terminal } };
        return { success: true, data: { imageSlots: [] } };
      },
    });
    if (terminal === "PUBLISHED") await promise;
    else await assert.rejects(promise);
    assert.equal(created, 1);
    assert.equal(published, 1);
    assert.equal(waits, 120, "long-running publication must not finish early");
  }
  for (const finalStatus of ["SCHEDULED", "READY", "FAILED", "PUBLISHED", "MISSING"]) {
    const events: string[] = [];
    let polls = 0;
    const work = runScheduledDraftWorkflow("product", "2026-09-08", {
      pause: async () => { events.push("wait"); },
      call: async (url, method, body) => {
        const action = (body as { action?: string })?.action;
        events.push(`${method}:${action || url}`);
        if (url.endsWith("/draft") && method === "GET") return { success: true, data: { imageSlots: [{ missing: 1, generationMissing: 1 }] } };
        if (url.endsWith("/product")) return { success: true, data: { status: polls++ === 0 ? "PUBLISHING" : finalStatus } };
        return { success: true, data: {} };
      },
    });
    if (finalStatus === "SCHEDULED") await work;
    else await assert.rejects(work, /예약 등록 미확인/);
    assert(events.indexOf("POST:generate_missing") < events.indexOf("PATCH:approve"));
    assert(events.indexOf("PATCH:approve") < events.indexOf("POST:/api/brandlinks/product/publish"));
    assert.equal(events.filter(e => e.endsWith("/publish")).length, 1);
    assert(!events.includes("POST:/api/brandlinks/product/draft"), "existing manuscript must be reused");
  }
  let publishCalled = false;
  let repairs = 0;
  await assert.rejects(runScheduledDraftWorkflow("product", "2026-09-08", {
    pause: async () => {},
    call: async (url, method, body) => {
      const action = (body as { action?: string })?.action;
      if (action === "approve") throw Object.assign(new Error("quality blocked"), { code: "CONTENT_BLOCKED" });
      if (action === "revise") repairs++;
      if (url.endsWith("/publish")) publishCalled = true;
      return { success: true, data: {} };
    },
  }), /quality blocked/);
  assert.equal(repairs, 1);
  assert.equal(publishCalled, false);
  let imageReads = 0;
  let waited = 0;
  let publishes = 0;
  await assert.rejects(runScheduledDraftWorkflow("product", "2026-09-08", {
    pause: async () => { waited++; },
    call: async (url, method) => {
      if (url.endsWith("/draft") && method === "GET") return { success: true, data: {
        imageGeneration: { status: imageReads++ < 2 ? "running" : "complete" }, imageSlots: [],
      } };
      if (url.endsWith("/publish")) { publishes++; throw new Error("connection lost"); }
      return { success: true, data: {} };
    },
  }), /connection lost/);
  assert.equal(waited, 2);
  assert.equal(publishes, 1, "never retry an uncertain publication");
  console.log("Scheduled workflow: terminal states, image ordering, saved draft reuse, bounded quality repair passed");
}
void main();
