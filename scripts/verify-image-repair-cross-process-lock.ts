import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork, spawnSync, type ChildProcess } from "node:child_process";

async function lockWorker(): Promise<void> {
  const userData = process.argv[3];
  const brandLinkId = process.argv[4];
  if (!userData || !brandLinkId) throw new Error("worker arguments missing");
  process.env.DESKTOP_USER_DATA = userData;
  const { acquireBrandPostImageRepairLock } = await import("../src/lib/brand-post-image-repair-lock");
  acquireBrandPostImageRepairLock(brandLinkId, { purpose: "cross-process-regression-worker" });
  process.send?.({ type: "locked" });
  // Deliberately do not register a release handler. The parent terminates this
  // process to reproduce an orphan left by a hard application exit.
  setInterval(() => undefined, 60_000);
}

async function tryStaleRecoveryWorker(): Promise<void> {
  const userData = process.argv[3];
  const brandLinkId = process.argv[4];
  if (!userData || !brandLinkId) throw new Error("recovery worker arguments missing");
  process.env.DESKTOP_USER_DATA = userData;
  const { acquireBrandPostImageRepairLock } = await import("../src/lib/brand-post-image-repair-lock");
  try {
    acquireBrandPostImageRepairLock(brandLinkId, {
      ownerToken: "successor-owner-token",
      purpose: "heartbeat-race-successor",
      staleAfterMs: 30_000,
    });
    // Deliberately exit without release. If this succeeds in the heartbeat
    // commit window, the old owner must never be allowed to replace this file.
    process.stdout.write("ACQUIRED");
  } catch (error) {
    if (!String((error as Error).message || error).includes("IMAGE_REPAIR_BUSY")) throw error;
    process.stdout.write("BUSY");
  }
}

function waitForWorkerLock(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("lock worker timed out")), 15_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`lock worker exited before acquisition (${code})`));
    });
    child.on("message", (message) => {
      if ((message as { type?: string })?.type !== "locked") return;
      clearTimeout(timer);
      resolve();
    });
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error("lock worker did not exit")), 15_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

async function main(): Promise<void> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "image-repair-process-lock-"));
  process.env.DESKTOP_USER_DATA = temp;
  const lockId = "fixture-cross-process-lock";
  const tsNodeRegister = require.resolve("ts-node/register/transpile-only");
  const child = fork(__filename, ["--lock-worker", temp, lockId], {
    cwd: process.cwd(),
    execArgv: ["-r", tsNodeRegister],
    env: { ...process.env, TS_NODE_PROJECT: path.join(process.cwd(), "tsconfig.scripts.json") },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  try {
    await waitForWorkerLock(child);
    const repair = await import("../src/lib/brand-post-image-repair");
    assert.equal(repair.isBrandPostImageRepairActive(lockId), true,
      "a lock owned by another Node process must be visible to the route guard");
    let dependencyTouched = false;
    const unreachable = () => { dependencyTouched = true; throw new Error("dependency must not run while locked"); };
    await assert.rejects(
      repair.repairBrandPostImages({ brandLinkId: lockId }, {
        read: unreachable as never,
        write: unreachable as never,
        apply: unreachable as never,
        generate: unreachable as never,
      }),
      /IMAGE_REPAIR_BUSY/u,
      "the authoritative lock must reject a second process before it reads or writes the manifest",
    );
    assert.equal(dependencyTouched, false);

    child.kill();
    await waitForExit(child);
    const lockApi = await import("../src/lib/brand-post-image-repair-lock");
    const recovered = lockApi.acquireBrandPostImageRepairLock(lockId, { purpose: "crash-recovery-regression" });
    recovered.assertOwner();
    recovered.release();
    assert.equal(fs.existsSync(lockApi.getBrandPostImageRepairLockPath(lockId)), false,
      "a dead process lock must be reclaimed and cleanly released");

    const heartbeatRaceId = "fixture-heartbeat-recovery-race";
    const heartbeatLockPath = lockApi.getBrandPostImageRepairLockPath(heartbeatRaceId);
    let recoveryOutcome = "";
    const heartbeatOwner = lockApi.acquireBrandPostImageRepairLock(heartbeatRaceId, {
      ownerToken: "heartbeat-owner-token",
      purpose: "heartbeat-race-original-owner",
      staleAfterMs: 30_000,
      beforeHeartbeatCommitForTest: () => {
        const contender = spawnSync(process.execPath, [
          "-r",
          tsNodeRegister,
          __filename,
          "--try-stale-recovery",
          temp,
          heartbeatRaceId,
        ], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, TS_NODE_PROJECT: path.join(process.cwd(), "tsconfig.scripts.json") },
          timeout: 15_000,
        });
        assert.equal(contender.status, 0, contender.stderr || "stale recovery contender failed");
        recoveryOutcome = contender.stdout.trim();
      },
    });
    const staleHeartbeat = JSON.parse(fs.readFileSync(heartbeatLockPath, "utf8")) as { heartbeatAt: string };
    staleHeartbeat.heartbeatAt = new Date(Date.now() - 120_000).toISOString();
    fs.writeFileSync(heartbeatLockPath, JSON.stringify(staleHeartbeat), "utf8");
    const staleTimestamp = new Date(Date.now() - 120_000);
    fs.utimesSync(heartbeatLockPath, staleTimestamp, staleTimestamp);

    heartbeatOwner.heartbeat();
    assert.equal(recoveryOutcome, "BUSY",
      "stale recovery must not install a successor between heartbeat validation and commit");
    const heartbeatAfterRace = JSON.parse(fs.readFileSync(heartbeatLockPath, "utf8")) as { ownerToken: string };
    assert.equal(heartbeatAfterRace.ownerToken, "heartbeat-owner-token",
      "heartbeat must retain its owner without overwriting a recovered successor");
    heartbeatOwner.release();
    assert.equal(fs.existsSync(heartbeatLockPath), false, "heartbeat race lock must release cleanly");

    const store = await import("../src/lib/brand-post-package");
    const { resolvePostDocument } = await import("../src/lib/post-composition-contract");
    const casId = "fixture-image-owner-cas";
    const packageDir = store.getBrandPostPackageDir(casId);
    fs.mkdirSync(packageDir, { recursive: true });
    const heroPath = path.join(packageDir, "hero.png");
    const markdownPath = path.join(packageDir, "post.md");
    fs.writeFileSync(heroPath, "owner-cas-hero");
    fs.writeFileSync(markdownPath, "이미지 소유권 CAS 회귀 테스트", "utf8");
    const composition = resolvePostDocument({
      connectKind: "SHOPPING",
      title: "이미지 소유권 CAS 회귀 테스트",
      sections: Array.from({ length: 7 }, (_, index) =>
        `상품 파트 ${index + 1}\n\n${"검증된 제품 사실과 구매 판단을 연결하는 본문입니다. ".repeat(8)}`),
      imagePaths: [heroPath],
      hashtags: ["상품"],
      connectUrl: "https://example.test/product",
      qualityPreset: "PREMIUM",
    });
    const heroSha256 = crypto.createHash("sha256").update(fs.readFileSync(heroPath)).digest("hex");
    const fixture: import("../src/lib/brand-post-package").BrandPostPackageManifestV2 = {
      version: "brand-post-package/v2",
      brandLinkId: casId,
      connectKind: "SHOPPING",
      title: composition.title,
      generationSource: "AI",
      markdownPath,
      heroImagePath: heroPath,
      bodyImagePaths: [],
      imageAssets: [{
        path: heroPath,
        sourcePath: heroPath,
        sha256: heroSha256,
        role: "hero",
        provenance: "LOCKED_PRODUCT",
        creationMethod: "source",
      }],
      hashtags: ["상품"],
      imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
      createdAt: new Date().toISOString(),
      approvedAt: null,
      contractVersion: "post-composition-contract/v1",
      composition,
      contentQuality: {
        canPublish: false,
        code: "composition-quality",
        reason: "이미지 부족",
        score: 100,
        summary: "이미지 준비 필요",
        signals: [{ key: "composition-quality", label: "구성", status: "fail" }],
      } as never,
      thumbnailSpec: {
        version: "thumbnail-spec/v2",
        canvas: { width: 1080, height: 1080, aspect: "1:1" },
        style: "fixture",
        sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
        sourceImagePath: heroPath,
      },
    };
    store.writeBrandPostPackageManifest(fixture);
    let ownershipStolen = false;
    let generationStarted = false;
    await assert.rejects(repair.repairBrandPostImages({ brandLinkId: casId }, {
      read: store.readBrandPostPackage,
      apply: store.applyGeneratedBrandPostImage,
      generate: async () => { generationStarted = true; return []; },
      write: (manifest) => {
        const committed = store.writeBrandPostPackageManifest(manifest);
        if (!ownershipStolen && committed.imageGeneration?.status === "running") {
          ownershipStolen = true;
          store.writeBrandPostPackageManifest({
            ...committed,
            imageGeneration: { ...committed.imageGeneration, ownerToken: "foreign-owner-token" },
          });
        }
        return committed;
      },
    }), /IMAGE_REPAIR_OWNERSHIP_LOST/u,
    "a foreign owner token observed after commit must stop the worker before generation");
    assert.equal(generationStarted, false);
    assert.equal(store.readBrandPostPackage(casId, { migrate: false })?.imageGeneration?.ownerToken, "foreign-owner-token",
      "the losing worker must not overwrite the newer owner state");
    assert.equal(repair.isBrandPostImageRepairActive(casId), false, "failure must release the process lock");

    console.log("PASS: cross-process exclusion, dead-owner recovery, heartbeat recovery serialization, and manifest owner-token CAS");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await waitForExit(child).catch(() => undefined);
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--lock-worker") {
  lockWorker().catch((error) => { console.error(error); process.exitCode = 1; });
} else if (process.argv[2] === "--try-stale-recovery") {
  tryStaleRecoveryWorker().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
