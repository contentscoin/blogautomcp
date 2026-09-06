import assert from "node:assert/strict";
import { runScheduledDraftWorkflow } from "./lib/scheduled-draft-workflow";

async function main() {
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
