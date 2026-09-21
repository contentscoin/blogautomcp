import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMaterialPreparation, type Call } from "./lib/scheduled-draft-workflow";
import { runRecordedImageRecovery, imageRecoverySignature, isRecoverableImageEvidenceResult } from "./lib/material-image-recovery";
import { getBrandPostPackageDir } from "../src/lib/brand-post-package";

async function main() {
  const previous = process.env.DESKTOP_USER_DATA;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-image-recovery-"));
  process.env.DESKTOP_USER_DATA = root;
  try {
    for (const tail of ["REQUEST_TIMEOUT: response lost", "unclassified reviewer failure", "CODEX_MODEL_INCOMPATIBLE: model"]) {
      assert.equal(isRecoverableImageEvidenceResult({ code: "IMAGE_SOURCE_BINDING_REQUIRED", errors: ["IMAGE_SOURCE_BINDING_REQUIRED: missing", tail] }), false);
    }
    for (const scenario of ["refresh", "replan", "exhausted", "auth", "transport", "partial", "mixed200", "mixed422"]) {
      const actions: string[] = [];
      let done = false; let approved = false;
      const call: Call = async (url, method, body) => {
        const action = (body as { action?: string })?.action || method;
        actions.push(action);
        if (url.endsWith("/images")) {
          if (scenario.startsWith("mixed")) {
            const failure = { code: "IMAGE_SOURCE_BINDING_REQUIRED", errors: ["IMAGE_SOURCE_BINDING_REQUIRED: missing", "REQUEST_TIMEOUT: response lost"] };
            if (scenario === "mixed422") throw Object.assign(new Error(failure.errors.join("\n")), failure);
            return { success: true, ...failure };
          }
          if (scenario === "auth") throw Object.assign(new Error("login required"), { code: "CODEX_AUTH_REQUIRED" });
          if (scenario === "transport") throw Object.assign(new Error("lost response"), { code: "ECONNRESET" });
          done = (scenario === "refresh" && action === "bind_sources") ||
            (["replan", "partial"].includes(scenario) && action === "replan_sources");
          if (!done && scenario !== "partial") throw Object.assign(new Error("feature evidence missing"), { code: "IMAGE_SOURCE_BINDING_REQUIRED" });
          return { success: true, code: done ? "IMAGE_REPAIR_COMPLETE" : "IMAGE_SOURCE_BINDING_REQUIRED", errors: done ? [] : ["IMAGE_SOURCE_BINDING_REQUIRED: feature evidence missing"] };
        }
        if (action === "approve") approved = true;
        return { success: true, data: { approvedAt: approved ? "yes" : null,
          approval: { canApprove: done }, imageSlots: [{ missing: done ? 0 : 1, generationMissing: 0 }],
          contentQuality: { signals: [] } } };
      };
      const run = runMaterialPreparation(`fixture-${scenario}`, { call, pause: async () => {} });
      if (["refresh", "replan", "partial"].includes(scenario)) await run;
      else await assert.rejects(run);
      assert.equal(actions.filter(a => a === "generate_missing").length, 1, "background generation never repeats during recovery");
      if (["auth", "transport", "mixed200", "mixed422"].includes(scenario)) {
        assert.ok(!actions.includes("prepare_context"));
        assert.ok(!actions.includes("replan_sources"));
      } else {
        assert.equal(actions.filter(a => a === "prepare_context").length, 1);
        assert.equal(actions.filter(a => a === "bind_sources").length, 1);
        assert.equal(actions.filter(a => a === "replan_sources").length, scenario === "refresh" ? 0 : 1);
      }
      assert.equal(approved, ["refresh", "replan", "partial"].includes(scenario));
    }
    const dir = getBrandPostPackageDir("persistent-fixture");
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { sourceSnapshot: { product: { name: "vacuum", features: ["사용시간: 45분"] } },
      composition: { sections: [{ id: "feature", body: ["45분"], imageMin: 1 }] }, imageAssets: [] };
    const save = () => fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    save();
    let calls = 0;
    await runRecordedImageRecovery("persistent-fixture", "refresh-source", async () => { calls++; });
    const skipped = await runRecordedImageRecovery("persistent-fixture", "refresh-source", async () => { calls++; });
    assert.equal(skipped.attempted, false); assert.equal(calls, 1);
    const signature = imageRecoverySignature(dir);
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ ...manifest, approvedAt: "later", imageGeneration: { updatedAt: "later" } }));
    assert.equal(imageRecoverySignature(dir), signature, "status timestamps cannot reset recovery budget");
    manifest.sourceSnapshot.product.features.push("충전시간: 4시간30분"); save();
    await runRecordedImageRecovery("persistent-fixture", "refresh-source", async () => { calls++; });
    assert.equal(calls, 2, "new evidence permits a new bounded attempt");
    await assert.rejects(runRecordedImageRecovery("persistent-fixture", "replan-images", async () => { throw new Error("review failed"); }));
    assert.equal((await runRecordedImageRecovery("persistent-fixture", "replan-images", async () => {})).attempted, false);
    const history = JSON.parse(fs.readFileSync(path.join(dir, "image-recovery-history.json"), "utf8"));
    assert.equal(history.entries.at(-1).status, "failed");
    const externalDir = getBrandPostPackageDir("external-fixture");
    fs.mkdirSync(externalDir, { recursive: true });
    fs.writeFileSync(path.join(externalDir, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(runRecordedImageRecovery("external-fixture", "refresh-source", async () => {
      throw Object.assign(new Error("login required"), { code: "CODEX_AUTH_REQUIRED" });
    }));
    assert.equal((await runRecordedImageRecovery("external-fixture", "refresh-source", async () => {})).attempted, true,
      "an explicit retry after external runtime repair remains possible");
    console.log("PASS material image recovery: HTTP failure/partial success, source refresh, replan, bounded exhaustion, auth/transport stop, persistent no-progress budget and changed evidence");
  } finally {
    process.env.DESKTOP_USER_DATA = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
