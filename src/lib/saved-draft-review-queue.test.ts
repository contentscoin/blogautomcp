import { test } from "node:test";
import assert from "node:assert/strict";
import { createSavedDraftReviewQueue } from "./saved-draft-review-queue";

test("rechecks run serially, deduplicate, and continue after failure", async () => {
  const queue = createSavedDraftReviewQueue();
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = queue.run("a", async () => { events.push("a"); await gate; throw new Error("blocked"); });
  const duplicate = queue.run("a", async () => "must not execute");
  assert.equal(first, duplicate);
  const rejected = assert.rejects(first, /blocked/);
  const second = queue.run("b", async () => { events.push("b"); return "checked"; });
  await Promise.resolve();
  assert.deepEqual(events, ["a"]);
  release();
  await rejected;
  assert.equal(await second, "checked");
  assert.deepEqual(events, ["a", "b"]);
  queue.retry("a");
  assert.equal(await queue.run("a", async () => "retried"), "retried");
});
