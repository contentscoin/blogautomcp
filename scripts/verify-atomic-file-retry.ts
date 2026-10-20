import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { atomicWriteTextFile } from "../src/lib/atomic-text-file";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-file-retry-"));
let checks = 0;
const failure = (code: string, attempt: number, syscall = "rename") => Object.assign(new Error(`${code} attempt ${attempt}`), { code, syscall });
function fixture() {
  const dir = fs.mkdtempSync(path.join(root, "case-")), target = path.join(dir, "manifest.json"), sibling = path.join(dir, ".manifest.json.foreign.tmp");
  fs.writeFileSync(target, "prior complete target"); fs.writeFileSync(sibling, "unrelated sibling");
  return { dir, target, sibling, clean: () => assert.deepEqual(fs.readdirSync(dir).sort(), ["manifest.json", ".manifest.json.foreign.tmp"].sort()) };
}
try {
  const f = fixture(), waits: number[] = [], sources: string[] = [];
  let attempts = 0;
  atomicWriteTextFile(f.target, "새 완전한 원고\n사진 경로도 그대로", { platformForTest: "win32", waitForTest: delay => { waits.push(delay); },
    replaceForTest: (temporary, target) => {
      attempts++; sources.push(temporary);
      assert.equal(fs.readFileSync(target, "utf8"), "prior complete target");
      assert.equal(fs.readFileSync(temporary, "utf8"), "새 완전한 원고\n사진 경로도 그대로");
      if (attempts <= 3) throw failure(["EPERM", "EACCES", "EBUSY"][attempts - 1], attempts);
      fs.renameSync(temporary, target);
    } });
  assert.equal(attempts, 4); assert.deepEqual(waits, [20, 50, 100]); assert.equal(new Set(sources).size, 1);
  assert.equal(fs.readFileSync(f.target, "utf8"), "새 완전한 원고\n사진 경로도 그대로"); f.clean(); checks += 5;

  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    const sample = fixture(), delays: number[] = [], failures: Error[] = []; let count = 0;
    assert.throws(() => atomicWriteTextFile(sample.target, "candidate", { platformForTest: "win32", waitForTest: ms => { delays.push(ms); },
      replaceForTest: () => { const error = failure(code, ++count); failures.push(error); throw error; } }), error => error === failures.at(-1));
    assert.equal(count, 5); assert.deepEqual(delays, [20, 50, 100, 200]); assert.ok(delays.reduce((sum, ms) => sum + ms, 0) < 1000);
    assert.equal(fs.readFileSync(sample.target, "utf8"), "prior complete target"); assert.equal(fs.readFileSync(sample.sibling, "utf8"), "unrelated sibling"); sample.clean(); checks += 6;
  }
  for (const [platform, code, syscall] of [["linux", "EPERM", "rename"], ["win32", "EIO", "rename"], ["win32", "ENOENT", "rename"],
    ["win32", "ENOSPC", "rename"], ["win32", "EXDEV", "rename"], ["win32", "EPERM", "open"]] as const) {
    const sample = fixture(), error = failure(code, 1, syscall); let count = 0, delays = 0;
    assert.throws(() => atomicWriteTextFile(sample.target, "candidate", { platformForTest: platform, waitForTest: () => { delays++; },
      replaceForTest: () => { count++; throw error; } }), candidate => candidate === error);
    assert.equal(count, 1); assert.equal(delays, 0); assert.equal(fs.readFileSync(sample.target, "utf8"), "prior complete target"); sample.clean(); checks += 4;
  }
  for (const kind of ["concurrent-process", "replacement-same-bytes", "new-target", "changed-temp", "foreign-temp", "cas-hook"] as const) {
    const sample = fixture(); let count = 0, temporary = "";
    const foreign = path.join(sample.dir, "foreign-file.json"); fs.writeFileSync(foreign, kind === "replacement-same-bytes" ? "prior complete target" : "foreign replacement");
    if (kind === "new-target") fs.unlinkSync(sample.target);
    assert.throws(() => atomicWriteTextFile(sample.target, "candidate", { platformForTest: "win32",
      replaceForTest: (source, target) => {
        temporary = source; count++;
        if (kind === "cas-hook" && count === 2) throw Object.assign(new Error("caller CAS owner changed"), { code: "CALLER_CAS_LOST" });
        if (count === 1) throw failure("EPERM", count);
        fs.renameSync(source, target);
      }, waitForTest: () => {
        if (kind === "concurrent-process") {
          const process = spawnSync(globalThis.process.execPath, ["-e", "require('node:fs').writeFileSync(process.argv[1], 'concurrent winner')", sample.target]);
          assert.equal(process.status, 0);
        } else if (kind === "replacement-same-bytes") fs.renameSync(foreign, sample.target);
        else if (kind === "new-target") fs.writeFileSync(sample.target, "new concurrent target");
        else if (kind === "changed-temp") fs.appendFileSync(temporary, "tampered");
        else if (kind === "foreign-temp") fs.renameSync(foreign, temporary);
      } }), error => (error as { code?: string }).code === (kind === "cas-hook" ? "CALLER_CAS_LOST" : "ATOMIC_WRITE_TARGET_CHANGED"));
    assert.equal(count, kind === "cas-hook" ? 2 : 1);
    if (kind === "concurrent-process") assert.equal(fs.readFileSync(sample.target, "utf8"), "concurrent winner");
    else if (kind === "new-target") assert.equal(fs.readFileSync(sample.target, "utf8"), "new concurrent target");
    else assert.equal(fs.readFileSync(sample.target, "utf8"), "prior complete target");
    if (kind === "foreign-temp") assert.equal(fs.readFileSync(temporary, "utf8"), "foreign replacement", "cleanup must preserve a foreign inode at the old temporary filename");
    else assert.equal(fs.existsSync(temporary), false);
    assert.equal(fs.readFileSync(sample.sibling, "utf8"), "unrelated sibling"); checks += 5;
  }
  // An exclusive-open collision belongs to somebody else, even at this exact
  // generated basename. Failure cleanup must never remove that foreign file.
  {
    const sample = fixture(), open = fs.openSync; let collision = "";
    fs.openSync = ((file, flags, mode) => {
      if (flags === "wx") {
        collision = String(file); const descriptor = open(file, "wx", mode);
        fs.writeFileSync(descriptor, "foreign exclusive collision"); fs.closeSync(descriptor);
        throw Object.assign(new Error("existing foreign temporary"), { code: "EEXIST" });
      }
      return open(file, flags, mode);
    }) as typeof fs.openSync;
    try { assert.throws(() => atomicWriteTextFile(sample.target, "candidate"), (error: unknown) => (error as { code?: string }).code === "EEXIST"); }
    finally { fs.openSync = open; }
    assert.equal(fs.readFileSync(collision, "utf8"), "foreign exclusive collision"); assert.equal(fs.readFileSync(sample.target, "utf8"), "prior complete target"); checks += 3;
  }
  // Deterministic symlink observation exercises the same fail-closed path on
  // Windows CI machines without permission to create real filesystem symlinks.
  {
    const sample = fixture(), lstat = fs.lstatSync, fixtureFs = fs as unknown as { lstatSync: typeof fs.lstatSync }; let attempts = 0, delays = 0;
    fixtureFs.lstatSync = ((file, options) => {
      const stat = lstat(file, options as never);
      if (path.resolve(String(file)) === path.resolve(sample.target)) return Object.assign(Object.create(stat), { isSymbolicLink: () => true });
      return stat;
    }) as typeof fs.lstatSync;
    try {
      assert.throws(() => atomicWriteTextFile(sample.target, "candidate", { platformForTest: "win32", waitForTest: () => { delays++; },
        replaceForTest: () => { attempts++; throw failure("EPERM", attempts); } }), /EPERM/);
    } finally { fixtureFs.lstatSync = lstat; }
    assert.equal(attempts, 1); assert.equal(delays, 0); assert.equal(fs.readFileSync(sample.target, "utf8"), "prior complete target"); sample.clean(); checks += 4;
  }
  {
    const sample = fixture(), sync = fs.fsyncSync; let replacements = 0;
    fs.fsyncSync = () => { throw failure("EIO", 1, "fsync"); };
    try { assert.throws(() => atomicWriteTextFile(sample.target, "candidate", { platformForTest: "win32", replaceForTest: () => { replacements++; } }), /EIO/); }
    finally { fs.fsyncSync = sync; }
    assert.equal(replacements, 0); assert.equal(fs.readFileSync(sample.target, "utf8"), "prior complete target"); sample.clean(); checks += 3;
  }
  console.log(`Atomic-file retry: ${checks} offline checks passed; bounded Windows sharing retry, target/CAS/temp identity protection, permanent-error propagation; live/provider calls 0.`);
} finally {
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true });
}
