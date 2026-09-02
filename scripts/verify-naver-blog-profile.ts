import assert from "node:assert/strict";
import { applyNaverBlogProfile, inspectNaverBlogProfile, validateNaverBlogProfileChanges } from "./lib/naver-blog-profile";

async function main() {
  console.log(JSON.stringify({ step: "inspect-start" }));
  const before = await inspectNaverBlogProfile();
  console.log(JSON.stringify({ step: "inspect-complete" }));
  assert.ok(before.blogId);
  assert.equal(typeof before.nickname, "string");
  assert.ok(before.blogName);
  assert.ok(before.screenshotPath);
  assert.throws(() => validateNaverBlogProfileChanges({ nickname: "" }));
  assert.throws(() => validateNaverBlogProfileChanges({ introduction: "x".repeat(201) }));
  const unchanged = await applyNaverBlogProfile(
    { blogName: before.blogName },
    { nickname: before.nickname, blogName: before.blogName, introduction: before.introduction },
  );
  console.log(JSON.stringify({ step: "no-op-complete" }));
  assert.equal(unchanged.after.blogName, before.blogName);
  console.log(
    JSON.stringify({
      ok: true,
      inspected: true,
      noOpVerified: true,
      introductionDetected: typeof before.introduction === "string",
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
