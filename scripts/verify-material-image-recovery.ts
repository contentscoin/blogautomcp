import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { runMaterialPreparation, type Call } from "./lib/scheduled-draft-workflow";
import { runRecordedImageRecovery, imageRecoverySignature, isRecoverableImageEvidenceResult, IMAGE_RECOVERY_POLICY_VERSION } from "./lib/material-image-recovery";
import { getBrandPostPackageDir } from "../src/lib/brand-post-package";

async function main() {
  const previous = process.env.DESKTOP_USER_DATA;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-image-recovery-"));
  process.env.DESKTOP_USER_DATA = root;
  try {
    for (const outcome of ["recovered", "second-rejection", "cancelled", "uncertain", "auth", "missing", "ambiguous", "unknown-key"] as const) {
      let blocked = ["missing", "ambiguous", "unknown-key"].includes(outcome); let approvals = 0; let accepted = false; let regenerated = false;
      const actions: string[] = [];
      const call: Call = async (url, method, body) => {
        const payload = body as { action?: string; assetKey?: string }; const action = payload?.action || method; actions.push(action);
        if (url.endsWith("/images")) {
          assert.equal(action, outcome === "missing" ? "generate_missing" : "regenerate", "thumbnail-only recovery never mutates completed body slots");
          assert.equal(payload.assetKey, outcome === "missing" ? undefined : "a".repeat(64));
          if (["cancelled", "uncertain", "auth"].includes(outcome)) throw Object.assign(new Error("generation stopped or response unavailable"),
            { code: outcome === "cancelled" ? "IMAGE_REPAIR_FAILED" : outcome === "auth" ? "CODEX_AUTH_REQUIRED" : "OUTCOME_UNKNOWN" });
          blocked = false; regenerated = true;
        }
        if (action === "approve") {
          approvals++;
          if (outcome !== "missing" && (approvals === 1 || outcome === "second-rejection")) {
            blocked = true;
            throw Object.assign(new Error("thumbnail circular gift inset/+ promotion"), { code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: ["SEMANTIC_REJECTION: forbidden circular inset and gift graphic"] });
          }
          accepted = true;
        }
        const hero = { role: "hero", sectionId: null, sha256: (regenerated ? "b" : "a").repeat(64) };
        return { success: true, data: { approvedAt: accepted ? "yes" : null, approval: { canApprove: !blocked, blockers: blocked
          ? [{ code: outcome === "missing" ? "hero-image-invalid" : "image-publication-rejected", reason: "대표 이미지 · forbidden gift inset", sectionId: null }] : [] },
          imageAssets: outcome === "missing" && !regenerated ? [] : outcome === "ambiguous" ? [hero, { ...hero, sha256: "c".repeat(64) }] : outcome === "unknown-key" ? [{ ...hero, sha256: "unknown" }] : [hero],
          imageSlots: [{ missing: 0, generationMissing: 0 }], contentQuality: { signals: [] } } };
      };
      const run = runMaterialPreparation(`thumbnail-${outcome}`, { call, pause: async () => {} });
      if (["recovered", "missing"].includes(outcome)) await run; else await assert.rejects(run);
      assert.equal(accepted, ["recovered", "missing"].includes(outcome));
      assert.equal(actions.filter(action => ["regenerate", "generate_missing"].includes(action)).length, ["ambiguous", "unknown-key"].includes(outcome) ? 0 : 1);
      assert(!actions.includes("repair_rejected") && !actions.includes("replan_sources") && !actions.includes("prepare_context"));
      assert.equal(approvals, ["recovered", "second-rejection"].includes(outcome) ? 2 : ["ambiguous", "unknown-key"].includes(outcome) ? 0 : 1);
    }
    for (const outcome of ["recovered", "second-rejection", "replan-success", "third-rejection", "replan-incomplete", "auth", "mixed", "unstale"] as const) {
      let approvals = 0; let missing = false; let accepted = false;
      const actions: string[] = [];
      const call: Call = async (url, method, body) => {
        const action = (body as { action?: string })?.action || method; actions.push(action);
        if (action === "approve") {
          approvals++;
          if (outcome === "auth") throw Object.assign(new Error("login required"), { code: "CODEX_AUTH_REQUIRED" });
          if (approvals === 1 || outcome === "second-rejection" || outcome === "third-rejection" ||
              (["replan-success", "replan-incomplete"].includes(outcome) && approvals === 2)) {
            missing = outcome !== "unstale";
            throw Object.assign(new Error("final pixel rejection"), { code: "PUBLISH_IMAGE_AUDIT_FAILED",
              errors: outcome === "mixed" ? ["SEMANTIC_REJECTION: wrong feature", "INVALID_REVIEW: malformed"] : ["SEMANTIC_REJECTION: wrong feature"] });
          }
          accepted = true;
        }
        if (url.endsWith("/images")) {
          assert(["repair_rejected", "replan_sources"].includes(action));
          if (action === "replan_sources") {
            const changed = ["replan-success", "third-rejection", "replan-incomplete"].includes(outcome);
            missing = !changed || outcome === "replan-incomplete";
            return { success: true, recovery: { changed }, remainingMissing: missing ? 1 : 0 };
          }
          missing = false;
        }
        return { success: true, data: { approvedAt: accepted ? "yes" : null, approval: { canApprove: !missing },
          imageSlots: [{ missing: missing ? 1 : 0, generationMissing: 0 }], contentQuality: { signals: [] } } };
      };
      const run = runMaterialPreparation(`audit-${outcome}`, { call, pause: async () => {} });
      if (["recovered", "replan-success"].includes(outcome)) await run; else await assert.rejects(run);
      assert.equal(accepted, ["recovered", "replan-success"].includes(outcome));
      assert.equal(approvals, ["replan-success", "third-rejection"].includes(outcome) ? 3 : ["recovered", "second-rejection", "replan-incomplete"].includes(outcome) ? 2 : 1);
      // (1.3.88) A rejection with no empty slot left still gets one drop-and-relax replan.
      assert.equal(actions.filter(action => action === "replan_sources").length, ["second-rejection", "replan-success", "third-rejection", "replan-incomplete", "unstale"].includes(outcome) ? 1 : 0);
      assert.equal(actions.filter(action => action === "repair_rejected").length, ["recovered", "second-rejection", "replan-success", "third-rejection", "replan-incomplete"].includes(outcome) ? 1 : 0);
      assert(!actions.includes("generate_missing"), "final audit recovery targets rejected slots instead of restarting every image");
    }
    // A known replacement failure remains diagnostic, without renewing the
    // generation budget. Auth/transport/incomplete outcomes keep early exits.
    for (const secondaryCode of ["SOURCE_REVIEW_CONFLICT", "wrapped-cause-code", "wrapped-cause", "cyclic-cause", "CODEX_AUTH_REQUIRED", "ECONNRESET", "SOURCE_REVIEW_INCOMPLETE", undefined]) {
      const sectionId = "shopping-section-causal123";
      let rejected = false;
      const actions: string[] = [];
      const primary = Object.assign(new Error("final body card rejection"), { code: "PUBLISH_IMAGE_AUDIT_FAILED",
        httpStatus: 422, errors: ["SEMANTIC_REJECTION: body card"], imageAuditFailures: [{ code: "SEMANTIC_REJECTION", sectionId, rejectionScope: "product" }] });
      if (secondaryCode?.startsWith("wrapped-")) Object.assign(primary, { causeCode: "PREVIOUS_IMAGE_REVIEW_FAILED",
        cause: Object.assign(new Error("private original cause"), { code: "PREVIOUS_IMAGE_REVIEW_FAILED" }) });
      const replacement = Object.assign(new Error("private replacement payload https://private.invalid/?token=hidden"),
        secondaryCode === "cyclic-cause" ? { code: "SOURCE_REVIEW_CONFLICT" }
          : secondaryCode === "wrapped-cause-code" ? { code: "SOURCE_REVIEW_FAILED", causeCode: "SOURCE_REVIEW_CONFLICT" }
          : secondaryCode === "wrapped-cause" ? { code: "SOURCE_REVIEW_FAILED", cause: Object.assign(new Error("private nested response"), { code: "SOURCE_REVIEW_CONFLICT" }) }
          : secondaryCode ? { code: secondaryCode } : {});
      if (secondaryCode === "cyclic-cause") Object.assign(replacement, { cause: replacement });
      const causalFailure = secondaryCode === "SOURCE_REVIEW_CONFLICT" || secondaryCode === "cyclic-cause" || secondaryCode?.startsWith("wrapped-");
      await assert.rejects(runMaterialPreparation(`causal-${secondaryCode || "unknown"}`, { pause: async () => {}, call: async (_url, method, body) => {
        const action = (body as { action?: string })?.action || method; actions.push(action);
        if (action === "approve") { rejected = true; throw primary; }
        if (action === "bind_sources") throw replacement;
        if (action === "replan_sources") return { success: true, recovery: { changed: false }, remainingMissing: 1, errors: [] };
        return { success: true, data: { connectKind: "SHOPPING", approvedAt: null,
          composition: { sections: [{ id: sectionId, imageSource: "seller-original" }] },
          imageSlots: [{ sectionId, missing: rejected ? 1 : 0, generationMissing: 0 }], contentQuality: { signals: [] } } };
      } }), (error: unknown) => {
        if (!causalFailure) { assert.equal(error, replacement); return true; }
        const failure = error as Error & { code?: string; causeCode?: string; httpStatus?: number; errors?: string[]; imageAuditFailures?: unknown; cause?: Error & { code?: string } };
        assert.equal(failure.code, primary.code);
        assert.equal(failure.httpStatus, 422);
        assert.deepEqual(failure.errors, primary.errors);
        assert.deepEqual(failure.imageAuditFailures, primary.imageAuditFailures);
        assert.equal(failure.cause?.code, "SOURCE_REVIEW_CONFLICT");
        assert.equal(failure.causeCode, "SOURCE_REVIEW_CONFLICT", "the current replacement diagnosis precedes the old primary cause in storage");
        assert.equal((primary as Error & { causeCode?: string }).causeCode, secondaryCode?.startsWith("wrapped-") ? "PREVIOUS_IMAGE_REVIEW_FAILED" : undefined,
          "the original audit error is not mutated");
        assert.ok(!failure.cause?.message.includes("private") && !failure.cause?.message.includes("token"));
        assert.deepEqual(Object.keys(failure.cause || {}), ["code"], "only a bounded machine-code cause is attached");
        const codes: string[] = [];
        let current: unknown = failure.cause;
        while (current instanceof Error) {
          assert.equal(current.message, "이미지 복구 단계에서 실패했습니다.");
          codes.push((current as Error & { code: string }).code);
          current = current.cause;
        }
        if (secondaryCode?.startsWith("wrapped-")) assert.deepEqual(codes, ["SOURCE_REVIEW_CONFLICT", "SOURCE_REVIEW_FAILED", "PREVIOUS_IMAGE_REVIEW_FAILED"]);
        return true;
      });
      assert.equal(actions.filter(action => action === "approve").length, 1);
      assert.equal(actions.filter(action => action === "bind_sources").length, 1);
      assert.equal(actions.filter(action => action === "replan_sources").length, secondaryCode?.startsWith("wrapped-") ? 1 : 0,
        "a direct contradictory source review stops without an extra replan");
      assert(!actions.some(action => /generate|regenerate|revise|repair_photo_description|prepare_context/u.test(action)),
        "diagnostic section/cause metadata grants no generation, source refresh or text edit");
    }
    for (const tail of ["REQUEST_TIMEOUT: response lost", "unclassified reviewer failure", "CODEX_MODEL_INCOMPATIBLE: model"]) {
      assert.equal(isRecoverableImageEvidenceResult({ code: "IMAGE_SOURCE_BINDING_REQUIRED", errors: ["IMAGE_SOURCE_BINDING_REQUIRED: missing", tail] }), false);
      assert.equal(isRecoverableImageEvidenceResult({ code: "REFERENCE_SCENE_FIDELITY_FAILED", errors: ["REFERENCE_SCENE_FIDELITY_FAILED: wrong product", tail] }), false);
    }
    for (const returned of [false, true]) {
      const actions: string[] = [];
      await assert.rejects(runMaterialPreparation(`source-review-incomplete-${returned}`, { pause: async () => {}, call: async (_url, method, body) => {
        const action = (body as { action?: string })?.action || method; actions.push(action);
        if (action === "bind_sources") {
          const failure = { code: "SOURCE_REVIEW_INCOMPLETE", errors: ["SOURCE_REVIEW_INCOMPLETE: reviewer omitted unreviewed candidates"] };
          if (returned) return { success: true, ...failure };
          throw Object.assign(new Error(failure.errors[0]), failure);
        }
        return { success: true, data: { connectKind: "SHOPPING", composition: { sections: [{ id: "original", imageSource: "seller-original" }] },
          imageSlots: [{ sectionId: "original", missing: 1, generationMissing: 0 }], contentQuality: { signals: [] } } };
      } }), (value: unknown) => (value as { code?: string }).code === "SOURCE_REVIEW_INCOMPLETE");
      assert.equal(actions.filter(action => action === "bind_sources").length, 1);
      assert(!actions.some(action => /generate|prepare_context|replan|approve/u.test(action)), "incomplete review is not evidence of missing source and never buys a generation/recollection retry");
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
          assert.equal((body as { refreshSourcePhotos?: boolean }).refreshSourcePhotos,
            action === "bind_sources" ? true : undefined,
            "only the recorded source-refresh pass bypasses the seller URL cache");
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
    // AI-scene slots left empty after a source refresh get exactly one more generation pass;
    // a source-only pass reports IMAGE_GENERATION_REQUIRED for them, which is recoverable.
    {
      const actions: string[] = [];
      let generated = 0; let approved = false;
      const call: Call = async (url, method, body) => {
        const action = (body as { action?: string })?.action || method;
        actions.push(action);
        if (url.endsWith("/images")) {
          if (action === "generate_missing") generated++;
          if (action === "bind_sources") return { success: true, code: "IMAGE_GENERATION_REQUIRED", errors: ["shopping-fit: IMAGE_GENERATION_REQUIRED: AI 연출 이미지 파트입니다."] };
          if (generated < 2) return { success: true, code: "IMAGE_SOURCE_BINDING_REQUIRED", errors: ["IMAGE_SOURCE_BINDING_REQUIRED: transient generation miss"] };
          return { success: true, code: "IMAGE_REPAIR_COMPLETE", errors: [] };
        }
        if (action === "approve") approved = true;
        const done = generated >= 2;
        return { success: true, data: { approvedAt: approved ? "yes" : null, approval: { canApprove: done },
          imageSlots: [{ missing: 0, generationMissing: done ? 0 : 1 }], contentQuality: { signals: [] } } };
      };
      await runMaterialPreparation("fixture-ai-scene-retry", { call, pause: async () => {} });
      assert.equal(actions.filter(a => a === "generate_missing").length, 2, "one extra generation pass for AI-scene slots only");
      assert.ok(approved);
    }
    // Actual reference failures formerly escaped before source recovery. Fresh references
    // buy one bounded generation attempt; an adverse semantic verdict still blocks approval.
    for (const code of ["PRODUCT_REFERENCE_REQUIRED", "REFERENCE_SCENE_FIDELITY_FAILED"]) {
      for (const exhausted of [false, true]) {
        const actions: string[] = [];
        let generated = 0; let approved = false;
        const call: Call = async (url, method, body) => {
          const action = (body as { action?: string })?.action || method;
          actions.push(action);
          if (url.endsWith("/images")) {
            if (action === "generate_missing") generated++;
            if (action === "bind_sources") return { success: true, code: "IMAGE_GENERATION_REQUIRED", errors: ["IMAGE_GENERATION_REQUIRED: scene still needed"] };
            if (!exhausted && generated >= 2) return { success: true, code: "IMAGE_REPAIR_COMPLETE", errors: [] };
            throw Object.assign(new Error(`${code}: selected product evidence failed`), { code, errors: [`${code}: selected product evidence failed`] });
          }
          if (action === "approve") approved = true;
          const done = !exhausted && generated >= 2;
          return { success: true, data: { approvedAt: approved ? "yes" : null, approval: { canApprove: done },
            imageSlots: [{ missing: done ? 0 : 1, generationMissing: done ? 0 : 1 }], contentQuality: { signals: [] } } };
        };
        const run = runMaterialPreparation(`reference-${code}-${exhausted}`, { call, pause: async () => {} });
        if (exhausted) await assert.rejects(run, (error: { code?: string }) => error.code === code); else await run;
        assert.equal(actions.filter(a => a === "prepare_context").length, 1);
        assert.equal(actions.filter(a => a === "bind_sources").length, 1);
        assert.equal(actions.filter(a => a === "generate_missing").length, 2);
        assert.equal(actions.filter(a => a === "replan_sources").length, exhausted ? 1 : 0);
        assert.equal(approved, !exhausted, "wrong product/fidelity findings never become accepted via recovery");
      }
    }
    for (const code of ["ECONNRESET", "REQUEST_TIMEOUT", "CODEX_AUTH_REQUIRED", "CODEX_TIMEOUT", "PREPARATION_RESULT_UNCERTAIN", "IMAGE_RESUME_REQUIRED", "IMAGE_OUTPUT_AMBIGUOUS", "ALREADY_PUBLISHING", "OUTCOME_UNKNOWN"]) {
      const actions: string[] = []; let missing = false;
      const call: Call = async (url, method, body) => {
        const action = (body as { action?: string })?.action || method; actions.push(action);
        if (action === "approve") {
          missing = true;
          throw Object.assign(new Error("pixel rejection"), { code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: ["SEMANTIC_REJECTION: wrong product"] });
        }
        if (url.endsWith("/images")) throw Object.assign(new Error("repair response unavailable"), { code });
        return { success: true, data: { imageSlots: [{ missing: missing ? 1 : 0, generationMissing: 0 }], contentQuality: { signals: [] } } };
      };
      await assert.rejects(runMaterialPreparation(`repair-stop-${code}`, { call, pause: async () => {} }), (error: { code?: string }) => error.code === code);
      assert.equal(actions.filter(a => a === "repair_rejected").length, 1);
      assert.equal(actions.filter(a => a === "approve").length, 1);
      assert(!actions.includes("replan_sources"), "uncertain replacement must not fall through to another image mutation");
    }
    for (const target of ["recheck", "generate_missing", "approve"]) {
      for (const scenario of ["recovered", "exhausted", "drafting", "publishing", "unknown-link", "unknown-images", "missing-image-state", "unknown-owner", "running", "no-http", "other-message", "transport", "auth", ...(target === "approve" ? ["status-conflict-metadata", "claimed-conflict-metadata", "idle-after-drafting", "still-drafting", "guard-without-metadata", "scheduled", "outcome-unknown"] : [])]) {
        const actions: string[] = []; let attempts = 0; let approved = false; let done = target !== "generate_missing";
        const call: Call = async (url, method, body) => {
          const action = (body as { action?: string })?.action || method; actions.push(action);
          if (url === `/api/brandlinks/cas-${target}-${scenario}`) return { success: true, data: { status: ({ drafting: "DRAFTING", "still-drafting": "DRAFTING", publishing: "PUBLISHING", "unknown-link": "MISSING", scheduled: "SCHEDULED", "outcome-unknown": "OUTCOME_UNKNOWN" } as Record<string, string>)[scenario] || "READY" } };
          if (action === target) {
            attempts++;
            const guard = ["idle-after-drafting", "still-drafting", "guard-without-metadata", "scheduled", "outcome-unknown"].includes(scenario);
            if ((scenario !== "recovered" || attempts < 3) && (scenario !== "idle-after-drafting" || attempts < 2)) throw Object.assign(new Error(scenario === "other-message" ? "현재 발행 중인 상품입니다." : guard ? "작성·발행 중이거나 게시 여부 확인이 필요한 소재는 승인할 수 없습니다." : target === "approve" ? "소재 상태가 변경되어 승인하지 않았습니다." : "상품 상태가 변경되었습니다."), {
              code: scenario === "transport" ? "ECONNRESET" : scenario === "auth" ? "CODEX_AUTH_REQUIRED" : target === "approve" ? "NOT_READY" : "ALREADY_PUBLISHING",
              ...(scenario === "no-http" ? {} : { httpStatus: 409 }),
              ...(scenario === "status-conflict-metadata" ? { approvalConflict: { gate: "status", claimAcquired: false, observedStatus: "PUBLISHING" } } :
                scenario === "claimed-conflict-metadata" ? { approvalConflict: { gate: "compare-and-set", claimAcquired: true, observedStatus: "READY" } } :
                  guard && scenario !== "guard-without-metadata" ? { approvalConflict: { gate: "status", claimAcquired: false, observedStatus: "DRAFTING" } } : {}),
            });
            done = true;
          }
          if (action === "approve") approved = true;
          return { success: true, data: { approvedAt: approved ? "yes" : null, approval: { canApprove: done },
            ...(attempts && scenario === "missing-image-state" ? {} : { imageGeneration: { status: attempts && scenario === "running" ? "running" : attempts && scenario === "unknown-images" ? "unknown" : "complete",
              ...(attempts && scenario === "unknown-owner" ? { recoveryState: "owner-unknown" } : {}) } }),
            imageSlots: [{ missing: done ? 0 : 1, generationMissing: 0 }], contentQuality: { signals: [] } } };
        };
        const run = runMaterialPreparation(`cas-${target}-${scenario}`, { call, pause: async () => {} });
        if (["recovered", "idle-after-drafting"].includes(scenario)) await run; else await assert.rejects(run);
        const expectedAttempts = scenario === "idle-after-drafting" ? 2 : scenario === "recovered" && target === "recheck" ? 4 : ["recovered", "exhausted"].includes(scenario) ? 3 : 1;
        assert.equal(attempts, expectedAttempts, "CAS replay has three attempts maximum; successful preparation also performs its normal final recheck");
        assert.equal(approved, ["recovered", "idle-after-drafting"].includes(scenario));
        assert(!actions.includes("prepare_context") && !actions.includes("replan_sources"));
      }
    }
    const dir = getBrandPostPackageDir("persistent-fixture");
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { sourceSnapshot: { product: { name: "vacuum", features: ["사용시간: 45분"] } },
      composition: { sections: [{ id: "feature", body: ["45분"], imageMin: 1 }] }, imageAssets: [] };
    const save = () => fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    save();
    assert.equal(IMAGE_RECOVERY_POLICY_VERSION, 10);
    const oldSignatures = [6, 7, 8, 9].map(policy => crypto.createHash("sha256").update(JSON.stringify({
      version: 1, policy, product: manifest.sourceSnapshot.product,
      sections: [{ id: "feature", body: ["45분"], imageMin: 1 }], assets: [], receipts: [], rejected: [],
    })).digest("hex"));
    fs.writeFileSync(path.join(dir, "image-recovery-history.json"), JSON.stringify({ version: 1, entries: [
      ...oldSignatures.map(signature => ({ stage: "refresh-source", input: signature, output: signature, status: "failed", at: "earlier" })),
    ] }));
    for (const signature of oldSignatures) assert.notEqual(imageRecoverySignature(dir), signature,
      "the changed prewriting review and shared scene plan allow one bounded new attempt after policies 6/7/8/9");
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
    for (const code of ["CODEX_USAGE_LIMIT_REACHED", "CODEX_TRANSIENT_FAILURE"]) {
      const id = `external-${code}`, fixture = getBrandPostPackageDir(id);
      fs.mkdirSync(fixture, { recursive: true });
      fs.writeFileSync(path.join(fixture, "manifest.json"), JSON.stringify(manifest));
      await assert.rejects(runRecordedImageRecovery(id, "refresh-source", async () => {
        throw Object.assign(new Error("external provider unavailable"), { code });
      }));
      const saved = JSON.parse(fs.readFileSync(path.join(fixture, "image-recovery-history.json"), "utf8"));
      assert.equal(saved.entries[0].externalFailure, true, `${code} must not consume a product-evidence repair budget`);
      assert.equal((await runRecordedImageRecovery(id, "refresh-source", async () => {})).attempted, true);
      assert.equal((await runRecordedImageRecovery(id, "refresh-source", async () => {})).attempted, false,
        "an actual successful recovery still consumes the unchanged-input budget");
    }
    for (const [label, status, reason, retryAllowed] of [
      ["curly-legacy-quota", "failed", "You’ve hit your usage limit. Try again later.", true],
      ["ascii-legacy-quota", "failed", "You've hit your usage limit. Try again later.", true],
      ["legacy-quota-code", "failed", "CODEX_IMAGE_FAILED: usage_limit_reached", true],
      ["quota-during-running", "running", "You’ve hit your usage limit.", false],
      ["quota-after-complete", "complete", "You’ve hit your usage limit.", false],
      ["generic-limit", "failed", "IMAGE_RESUME_REQUIRED: image request limit reached", false],
      ["quality-limit", "failed", "QUALITY_REPAIR_EXHAUSTED: retry limit reached", false],
      ["untyped-rate-limit", "failed", "429 rate_limit_exceeded", false],
    ] as const) {
      const id = `history-${label}`, fixture = getBrandPostPackageDir(id);
      fs.mkdirSync(fixture, { recursive: true });
      fs.writeFileSync(path.join(fixture, "manifest.json"), JSON.stringify(manifest));
      const previousEntry = { stage: "refresh-source", input: imageRecoverySignature(fixture), status, at: "original", reason };
      const file = path.join(fixture, "image-recovery-history.json");
      fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [previousEntry] }));
      let called = 0;
      assert.equal((await runRecordedImageRecovery(id, "refresh-source", async () => { called++; })).attempted, retryAllowed);
      assert.equal(called, Number(retryAllowed));
      assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).entries[0], previousEntry,
        "legacy diagnosis preserves the historical record instead of rewriting or deleting it");
    }
    let unknownMutations = 0;
    await assert.rejects(runMaterialPreparation("policy-upgrade-unknown-owner", { pause: async () => {}, call: async (_url, method) => {
      if (method !== "GET") unknownMutations++;
      return { success: true, data: { imageGeneration: { status: "complete", recoveryState: "owner-unknown" }, imageSlots: [{ missing: 1, generationMissing: 1 }] } };
    } }), (value: unknown) => (value as { code?: string }).code === "IMAGE_RESUME_REQUIRED");
    assert.equal(unknownMutations, 0, "a policy upgrade cannot restart or adopt an unknown image submission");
    console.log("PASS material image recovery: reference/fidelity source recovery, bounded early CAS conflicts, auth/uncertain stop, persistent policy upgrade and no-progress budgets");
  } finally {
    process.env.DESKTOP_USER_DATA = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
