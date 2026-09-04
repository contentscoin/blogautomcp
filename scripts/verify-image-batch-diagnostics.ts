import assert from "node:assert/strict";
import { imagePageSignals, imageBatchSucceeded, keepFailedDiagnosticOpen } from "./lib/image-batch-diagnostics";

async function main() {
  const env = { CHATGPT_IMAGE_DIAGNOSTIC_KEEP_OPEN: "true", CHATGPT_BROWSER_VISIBILITY: "visible" };
  assert.equal(keepFailedDiagnosticOpen(env, 1), true);
  assert.equal(keepFailedDiagnosticOpen(env, 2), false);
  assert.equal(keepFailedDiagnosticOpen({}, 1), false);
  assert.equal(keepFailedDiagnosticOpen({ ...env, CHATGPT_BROWSER_VISIBILITY: "background" }, 1), false);
  assert.equal(imageBatchSucceeded(undefined, [{ localPath: null, error: "timeout" }]), false);
  assert.equal(imageBatchSucceeded(undefined, [{ localPath: null }]), false);
  assert.equal(imageBatchSucceeded(undefined, []), false);
  assert.equal(imageBatchSucceeded(new Error("checkpoint"), [{ localPath: "image.png" }]), false);
  assert.equal(imageBatchSucceeded(undefined, [{ localPath: "image.png" }]), true);
  const page = { locator: (selector: string) => ({ count: async () => selector.includes('"user"') ? 1 : 2 }) };
  assert.deepEqual(await imagePageSignals(page as never), { userMessages: 1, assistantMessages: 2 });
  console.log("image batch diagnostic policy: 10 assertions passed");
}
void main();
