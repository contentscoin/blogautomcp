/** Offline source-only regressions: receipts are retrieval evidence, never pixel approval. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { collectShoppingProductSourceCandidates, ensureStaticDecodableImage, PRODUCT_SOURCE_RECEIPT_TTL_MS,
  readSavedProductSourceCandidates } from "./lib/product-photo-source";
import { buildSellerOriginalRepairTarget } from "./lib/seller-original-repair-target";
import type { ProductSectionImageDiagnostics } from "./lib/product-photo-review";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seller-original-recovery-"));
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("No network or provider calls in this fixture"); };
  const now = Date.parse("2026-10-10T08:00:00.000Z");
  const url = "https://shop-phinf.pstatic.net/selected-option.jpg?type=original";
  let passes = 0;
  let sequence = 0;
  const sha = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
  const snapshot = (dir: string) => fs.readdirSync(dir).sort().map(name => [name, sha(fs.readFileSync(path.join(dir, name)))]);
  const fixture = () => {
    const dir = path.join(root, String(++sequence));
    fs.mkdirSync(dir);
    return dir;
  };
  const test = async (name: string, run: () => Promise<void> | void) => {
    await run();
    passes++;
    console.log(`PASS ${name}`);
  };
  try {
    const [blue, green, red] = await Promise.all(["#2255aa", "#33aa55", "#aa3322"].map(background =>
      sharp({ create: { width: 24, height: 24, channels: 3, background } }).png().toBuffer()));
    const fresh = path.join(root, "new-seller-photo.png");
    fs.writeFileSync(fresh, green);
    const saved = (dir: string, name: string, bytes = blue, sourceUrl = url, retrievedAt: string | undefined = new Date(now - 1000).toISOString()) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, bytes);
      fs.writeFileSync(`${file}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl,
        sha256: sha(bytes), retrievedAt, identityVerified: false, rightsGranted: false }));
      return file;
    };
    const collect = async (dir: string, options: { localCandidates?: string[]; sourceImageUrls?: string[]; forceRefresh?: boolean; maximum?: number } = {}) => {
      const downloads: string[] = [];
      const candidates = await collectShoppingProductSourceCandidates({ localCandidates: [], sourceImageUrls: [url], outputDir: dir, ...options }, {
        now: () => now, download: async sourceUrl => { downloads.push(sourceUrl); return fresh; },
      });
      return { candidates, downloads };
    };

    await test("recent exact URL and SHA reuse keeps original bytes and receipts unchanged", async () => {
      const dir = fixture();
      const file = saved(dir, "seller.png");
      const before = snapshot(dir);
      const result = await collect(dir);
      assert.deepEqual(result, { candidates: [file], downloads: [] });
      assert.deepEqual(snapshot(dir), before);
      const record = JSON.parse(fs.readFileSync(`${file}.retrieval.json`, "utf8"));
      assert.equal(record.identityVerified, false);
      assert.equal(record.rightsGranted, false, "cached retrieval never becomes photo/rights approval");
    });
    await test("query or URL differences never borrow another source's receipt", async () => {
      const dir = fixture();
      saved(dir, "seller.png", blue, url.replace("original", "thumbnail"));
      assert.deepEqual((await collect(dir)).downloads, [url]);
    });
    for (const [label, timestamp] of [
      ["expiry boundary", new Date(now - PRODUCT_SOURCE_RECEIPT_TTL_MS).toISOString()],
      ["expired receipt", new Date(now - PRODUCT_SOURCE_RECEIPT_TTL_MS - 1).toISOString()],
      ["future receipt", new Date(now + 1).toISOString()],
      ["invalid date", "not-a-date"],
    ]) {
      await test(`${label} requires fresh retrieval`, async () => {
        const dir = fixture();
        saved(dir, "seller.png", blue, url, timestamp);
        assert.deepEqual((await collect(dir)).downloads, [url]);
      });
    }
    await test("legacy missing timestamp remains a local candidate but cannot skip retrieval", async () => {
      const dir = fixture();
      const file = saved(dir, "seller.png");
      const record = JSON.parse(fs.readFileSync(`${file}.retrieval.json`, "utf8"));
      delete record.retrievedAt;
      fs.writeFileSync(`${file}.retrieval.json`, JSON.stringify(record));
      assert.deepEqual(readSavedProductSourceCandidates(dir), [file]);
      assert.deepEqual((await collect(dir)).downloads, [url]);
    });
    await test("within-TTL receipt may skip HTTP", async () => {
      const dir = fixture();
      saved(dir, "seller.png", blue, url, new Date(now - PRODUCT_SOURCE_RECEIPT_TTL_MS + 1).toISOString());
      assert.deepEqual((await collect(dir)).downloads, []);
    });
    await test("forceRefresh bypasses warm receipts even when local quota is already full", async () => {
      const dir = fixture();
      const file = saved(dir, "seller.png");
      const before = snapshot(dir);
      const result = await collect(dir, { localCandidates: [file], maximum: 1, forceRefresh: true });
      assert.deepEqual(result.downloads, [url]);
      assert.deepEqual(result.candidates, [fresh], "fresh seller bytes take the explicit refresh quota");
      assert.deepEqual(snapshot(dir), before, "the previously saved original is not overwritten");
    });
    await test("normal collection preserves existing local priority and bounded quota", async () => {
      const dir = fixture();
      const file = saved(dir, "seller.png");
      assert.deepEqual(await collect(dir, { localCandidates: [file], maximum: 1 }), { candidates: [file], downloads: [] });
    });
    for (const mutation of ["changed", "deleted", "corrupt receipt", "wrong receipt SHA", "wrong receipt version", "empty image"]) {
      await test(`${mutation} cannot be trusted as cached seller pixels`, async () => {
        const dir = fixture();
        const file = saved(dir, "seller.png");
        if (mutation === "changed") fs.writeFileSync(file, red);
        else if (mutation === "deleted") fs.unlinkSync(file);
        else if (mutation === "corrupt receipt") fs.writeFileSync(`${file}.retrieval.json`, "{");
        else if (mutation === "empty image") fs.writeFileSync(file, "");
        else {
          const record = JSON.parse(fs.readFileSync(`${file}.retrieval.json`, "utf8"));
          if (mutation === "wrong receipt SHA") record.sha256 = sha(red);
          else record.version = "unknown/v1";
          fs.writeFileSync(`${file}.retrieval.json`, JSON.stringify(record));
        }
        const before = snapshot(dir);
        assert.deepEqual(readSavedProductSourceCandidates(dir), []);
        assert.deepEqual((await collect(dir)).downloads, [url]);
        assert.deepEqual(snapshot(dir), before, "invalid preserved files/records are not repaired by overwriting");
      });
    }
    await test("newest intact receipt wins when one URL changed pixels", async () => {
      const dir = fixture();
      saved(dir, "older.png", blue, url, new Date(now - 2000).toISOString());
      const latest = saved(dir, "latest.png", red);
      assert.deepEqual(await collect(dir), { candidates: [latest], downloads: [] });
    });
    await test("equal-time duplicate copies of the same pixels are unambiguous", async () => {
      const dir = fixture();
      const file = saved(dir, "a.png");
      saved(dir, "b.png");
      assert.deepEqual(await collect(dir), { candidates: [file], downloads: [] });
    });
    await test("equal-time differing pixels require retrieval rather than arbitrary cache choice", async () => {
      const dir = fixture();
      saved(dir, "a.png");
      saved(dir, "b.png", red);
      assert.deepEqual((await collect(dir)).downloads, [url]);
    });
    await test("undecodable receipt-bound bytes are not reused", async () => {
      const dir = fixture();
      saved(dir, "seller.jpg", Buffer.from("not a photo"));
      const result = await collect(dir);
      assert.deepEqual(result.downloads, [url]);
      assert.deepEqual(result.candidates, [fresh]);
    });
    await test("unavailable seller refresh preserves existing local photos", async () => {
      const dir = fixture();
      const file = saved(dir, "seller.png");
      const before = snapshot(dir);
      let attempts = 0;
      const candidates = await collectShoppingProductSourceCandidates({ localCandidates: [file], sourceImageUrls: [url], outputDir: dir,
        forceRefresh: true, maximum: 1 }, { now: () => now, download: async () => { attempts++; throw new Error("HTTP429 fixture"); } });
      assert.equal(attempts, 1);
      assert.deepEqual(candidates, [file]);
      assert.deepEqual(snapshot(dir), before);
    });
    await test("no local or downloadable source retains infrastructure failure", async () => {
      const dir = fixture();
      await assert.rejects(collectShoppingProductSourceCandidates({ localCandidates: [], sourceImageUrls: [url], outputDir: dir }, {
        download: async () => { throw new Error("HTTP429 fixture"); },
      }), /PRODUCT_SOURCE_DOWNLOAD_FAILED/);
    });
    await test("invalid source hosts or lookalikes never trigger a download", async () => {
      assert.deepEqual(await collect(fixture(), { sourceImageUrls: ["https://shop-phinf.pstatic.net.evil.test/photo.jpg", "http://shop-phinf.pstatic.net/photo.jpg"] }),
        { candidates: [], downloads: [] });
    });
    await test("source URL deduplication and twenty-source bound stay intact", async () => {
      const urls = Array.from({ length: 24 }, (_, index) => `https://shop-phinf.pstatic.net/${index}.png`);
      const result = await collect(fixture(), { sourceImageUrls: [urls[0], ...urls] });
      assert.deepEqual(result.downloads, urls.slice(0, 20));
      assert.deepEqual(result.candidates, [fresh], "copied pixels remain one candidate");
    });
    await test("legacy static sibling must match a fresh re-encode of intact original", async () => {
      const dir = fixture();
      const animated = path.join(dir, "seller.gif");
      await sharp([blue, red], { join: { animated: true } }).gif({ loop: 0 }).toFile(animated);
      const original = fs.readFileSync(animated);
      const receipt = JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: url, sha256: sha(original),
        retrievedAt: new Date(now - 1000).toISOString(), identityVerified: false, rightsGranted: false });
      fs.writeFileSync(`${animated}.retrieval.json`, receipt);
      const staticFile = await ensureStaticDecodableImage(animated);
      assert.ok(staticFile && staticFile !== animated);
      assert.equal(fs.readFileSync(`${staticFile}.retrieval.json`, "utf8"), receipt, "legacy copied receipt is not rewritten");
      assert.deepEqual(readSavedProductSourceCandidates(dir), [animated], "copied raw SHA cannot approve re-encoded bytes");
      const before = snapshot(dir);
      assert.equal(await ensureStaticDecodableImage(animated), staticFile);
      assert.deepEqual(snapshot(dir), before);
      assert.deepEqual(await collect(dir), { candidates: [staticFile], downloads: [] });
      fs.writeFileSync(staticFile, green);
      const changed = snapshot(dir);
      assert.equal(await ensureStaticDecodableImage(animated), null, "an edited sibling is never blessed by its filename");
      assert.deepEqual(snapshot(dir), changed, "reject without overwriting edited sibling or receipts");
      assert.deepEqual(fs.readFileSync(animated), original);
    });

    const diagnostics = (reasons: string[], patch: Partial<ProductSectionImageDiagnostics> = {}): ProductSectionImageDiagnostics => ({
      version: 1, status: "complete", cacheHit: false, reviewedAt: "fixture", candidateCount: reasons.length, targetCount: 1,
      entries: reasons.map((reason, index) => ({ targetIndex: 0, path: `fixture-${index}.png`, sourceSha256: sha(blue),
        status: "rejected", reason, reviewedAt: "fixture" })), ...patch,
    });
    await test("Dalba inset and selected-option mismatch are separate actionable causes", () => {
      const target = buildSellerOriginalRepairTarget({ sectionId: "shopping-section-dalba", targetIndex: 0,
        diagnostics: diagnostics(["설명판 프레임과 증정품 인셋이 제품에 겹쳐 단일 자연스러운 사진이 아닙니다.", "용량이 다르고 다른 구성입니다."]) });
      assert.ok(target);
      assert.equal(target.code, "IMAGE_SOURCE_BINDING_REQUIRED");
      assert.equal(target.imageSource, "seller-original");
      assert.equal(target.action, "provide-clean-seller-photo");
      assert.equal(target.candidateCount, 2);
      assert.equal(target.rejectedCount, 2);
      assert.deepEqual(target.causes.map(cause => cause.kind), ["graphic-layout", "identity-variant"]);
      assert.match(target.message, /증정품 인셋/);
      assert.match(target.message, /제품 자체 라벨은 보존/);
      assert.match(target.message, /같은 옵션의 용기 한 개 근접 사진은 허용/);
      assert.match(target.message, /AI 연출로 원본 슬롯을 대체하지 않습니다/);
    });
    await test("Hanwoo packaging overlays keep all different rejection details", () => {
      const long = "보자기 포장옵션 안내가 별도 추가 텍스트입니다. " + "관찰된 실제 픽셀 설명 ".repeat(40) + "끝의 보냉가방 설명도 겹칩니다.";
      const target = buildSellerOriginalRepairTarget({ sectionId: "shopping-section-hanwoo", targetIndex: 0,
        diagnostics: diagnostics([long, "일반포장 사진 상단 프레임과 하단 아이스팩 설명이 있습니다."]) });
      assert.ok(target);
      assert.equal(target.causes[0].count, 2);
      assert.match(target.message, /끝의 보냉가방 설명/);
      assert.match(target.message, /하단 아이스팩 설명/);
      assert.ok(target.message.length > 500, "full reason is not truncated to 180 characters");
      assert.deepEqual(target.message.match(/[A-Z][A-Z0-9_]{3,}/gu), ["IMAGE_SOURCE_BINDING_REQUIRED"], "no new unknown recovery code");
    });
    await test("Aveeno notice, overlay and actual section-evidence failures remain distinct", () => {
      const target = buildSellerOriginalRepairTarget({ sectionId: "shopping-section-aveeno", targetIndex: 0,
        diagnostics: diagnostics(["상품 위 설명 패널과 프레임", "배송 공지 안내 이미지", "기능 근거 부족: 실제 본문 기능의 직접 근거가 아닙니다."]) });
      assert.ok(target);
      assert.deepEqual(target.causes.map(cause => cause.kind), ["graphic-layout", "notice", "section-evidence"]);
    });
    await test("repair details stay bound to their actual zero-based target", () => {
      const report = diagnostics(["프레임 있음"]);
      report.targetCount = 2;
      report.entries.push({ ...report.entries[0], targetIndex: 1, reason: "다른 제품 구성입니다." });
      const target = buildSellerOriginalRepairTarget({ sectionId: "second-slot", targetIndex: 1, diagnostics: report });
      assert.ok(target);
      assert.equal(target.rejectedCount, 1);
      assert.equal(target.causes[0].kind, "identity-variant");
      assert.doesNotMatch(target.message, /프레임 있음/);
    });
    await test("failed provider report and unresolved accepted proposal do not become photo-absence claims", () => {
      const report = diagnostics(["프레임 있음"]);
      assert.equal(buildSellerOriginalRepairTarget({ sectionId: "slot", targetIndex: 0, diagnostics: { ...report, status: "failed", error: "provider unavailable" } }), null);
      for (const status of ["review-failed", "proposed"] as const) {
        assert.equal(buildSellerOriginalRepairTarget({ sectionId: "slot", targetIndex: 0,
          diagnostics: { ...report, entries: [{ ...report.entries[0], status }] } }), null);
      }
      assert.equal(buildSellerOriginalRepairTarget({ sectionId: "slot", targetIndex: -1, diagnostics: report }), null);
      assert.equal(buildSellerOriginalRepairTarget({ sectionId: "slot", targetIndex: 1, diagnostics: report }), null);
      assert.equal(buildSellerOriginalRepairTarget({ sectionId: "slot", targetIndex: 0 }), null);
    });
    await test("zero candidates gives source repair guidance without invented pixel verdicts", () => {
      const target = buildSellerOriginalRepairTarget({ sectionId: "slot", targetIndex: 0, diagnostics: diagnostics([]) });
      assert.ok(target);
      assert.equal(target.candidateCount, 0);
      assert.equal(target.rejectedCount, 0);
      assert.deepEqual(target.causes, []);
      assert.doesNotMatch(target.message, /실제 거절 사유/);
      assert.match(target.message, /같은 후보의 반복 수집 대신/);
    });
    assert.equal(networkCalls, 0);
    console.log(`PASS seller-original source recovery: ${passes} offline cases; paid QA/generation/network calls 0`);
  } finally {
    globalThis.fetch = originalFetch;
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("seller-original-recovery-")) {
      throw new Error("Unsafe fixture cleanup target");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
