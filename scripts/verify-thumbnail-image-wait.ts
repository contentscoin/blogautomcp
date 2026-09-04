import assert from "node:assert/strict";
import fs from "node:fs";
import { thumbnailImageWaitPolicy, waitForThumbnailArtifacts } from "./lib/thumbnail-image-wait";

async function main() {
  const policy = thumbnailImageWaitPolicy({});
  assert.equal(policy.baseMs, 300_000);
  assert.equal(policy.hardMs, 600_000);
  assert.equal(thumbnailImageWaitPolicy({ PRODUCT_THUMBNAIL_IMAGE_WAIT_MS: "420000" }).baseMs, 420_000);
  assert.equal(thumbnailImageWaitPolicy({ CHATGPT_IMAGE_WAIT_MS: "360000" }).baseMs, 360_000);
  for (const invalid of ["NaN", "Infinity", "-1", "0"]) {
    assert.equal(thumbnailImageWaitPolicy({ PRODUCT_THUMBNAIL_IMAGE_WAIT_MS: invalid }).baseMs, 300_000);
  }
  async function scenario(observe: (now: number) => { imageCount: number; generating: boolean }) {
    let now = 0;
    const result = await waitForThumbnailArtifacts({ policy, now: () => now,
      observe: async () => observe(now), wait: async (ms) => { now += ms; } });
    return { result, now };
  }
  const slow = await scenario((now) => ({ imageCount: now >= 360_000 ? 1 : 0, generating: now < 360_000 }));
  assert.equal(slow.result, 1);
  assert.ok(slow.now > 300_000 && slow.now < policy.hardMs);
  assert.deepEqual(await scenario(() => ({ imageCount: 0, generating: false })), { result: 0, now: 300_000 });
  assert.deepEqual(await scenario(() => ({ imageCount: 1, generating: true })), { result: 0, now: 600_000 });
  let now = 0;
  assert.equal(await waitForThumbnailArtifacts({ policy, now: () => now,
    observe: async () => { now = 700_000; return { imageCount: 1, generating: false }; },
    wait: async () => {},
  }), 0, "observation time counts toward the deadline");
  const agent = fs.readFileSync("scripts/simple-agent.ts", "utf8");
  assert.match(agent, /PRODUCT_THUMBNAIL_IMAGE_WAIT_POLICY = thumbnailImageWaitPolicy\(\)/);
  assert.match(agent, /beforeSources,\s*PRODUCT_THUMBNAIL_IMAGE_WAIT_POLICY/);
  const wrapper = agent.slice(agent.indexOf("async function waitForProductThumbnailImageArtifacts("), agent.indexOf("async function downloadProductThumbnailImages("));
  assert.match(wrapper, /countNewRenderableChatGPTImages\(page, beforeSources\)/);
  assert.match(wrapper, /page.close\(\{ runBeforeUnload: false \}\)/);
  assert.match(wrapper, /clearTimeout\(timer\)/);
  assert.match(wrapper, /await closing/);
  assert.doesNotMatch(wrapper, /Promise\.race\(/);
  assert.doesNotMatch(wrapper, /clickChatGPTRetryIfVisible/);
  assert.match(fs.readFileSync(".env.example", "utf8"), /^PRODUCT_THUMBNAIL_IMAGE_WAIT_MS="300000"$/m);
  console.log("thumbnail-image-wait: slow completion, hard deadline, no false success, policy wiring PASS");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
