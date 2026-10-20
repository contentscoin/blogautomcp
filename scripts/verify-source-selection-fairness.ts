/** Offline causal selection tests. Synthetic verdicts are never real photo approvals. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import sharp from "sharp";
import { auditSectionProposals, productSectionProposalAuditPolicyKey } from "./lib/product-section-proposal-audit";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import type { ProductSectionImageDiagnostics, ProductSectionImageReview } from "./lib/product-photo-review";
import type { PublishImageAuditOptions, PublishImageAuditResult } from "./lib/publish-image-audit";

type Selector = typeof import("./lib/product-photo-review").selectVerifiedProductSectionImages;
type Target = Parameters<Selector>[2][number];
type Class = ProductSectionImageReview["reviewClass"];
const sourceFile = path.resolve("scripts/lib/product-photo-review.ts");
const source = ts.transpileModule(fs.readFileSync(sourceFile, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const requireSource = createRequire(sourceFile);
const digest = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const overview = (id = "overview"): Target => ({ sectionId: id, sectionTitle: "선택 상품 외형", sectionBody: ["확인한 상품 외형을 소개합니다."],
  imageIntent: "판매페이지 원본 상품 사진: 선택 상품·옵션 외형 확인", imageSource: "seller-original" });

function fixtureSelector(options: {
  classes: (targetIndex: number, file: string) => Class | null;
  targetCount?: number;
  accept: (file: string, targetIndex: number, round: number) => boolean;
  onReview?: () => void;
  onAudit?: (request: PublishImageAuditOptions, round: number) => void;
}) {
  const audits: Array<Array<{ file: string; targetIndex: number }>> = [];
  let reviewCalls = 0;
  const loadedModule = { exports: {} as { selectVerifiedProductSectionImages: Selector } };
  vm.runInNewContext(source, { module: loadedModule, exports: loadedModule.exports, process, Buffer,
    require: (name: string) => {
      if (name === "./codex-draft-provider") return { runCodexDraft: async (request: { imagePaths: string[] }) => {
        reviewCalls++; options.onReview?.();
        const assignments: unknown[] = [];
        const rejections: unknown[] = [];
        for (let targetIndex = 0; targetIndex < (options.targetCount || 1); targetIndex++) request.imagePaths.forEach((file, index) => {
          const reviewClass = options.classes(targetIndex, file);
          if (reviewClass) assignments.push({ targetIndex: targetIndex + 1, selectedIndex: index + 1, reviewClass, reason: "synthetic suitability proposal" });
          else rejections.push({ targetIndex: targetIndex + 1, selectedIndex: index + 1, reason: "synthetic wrong product/feature" });
        });
        return JSON.stringify({ assignments, rejections, notSelected: [] });
      } };
      if (name === "./product-section-proposal-audit") return { productSectionProposalAuditPolicyKey, auditSectionProposals: (input: Parameters<typeof auditSectionProposals>[0]) =>
        auditSectionProposals({ ...input, audit: async (request: PublishImageAuditOptions): Promise<PublishImageAuditResult> => {
          const images = request.composition.renderNodes.flatMap((node, nodeIndex) => node.kind === "image"
            ? [{ nodeIndex, assetPath: node.assetPath, sha256: digest(node.assetPath), targetIndex: Number(node.sectionId?.match(/(\d+)$/u)?.[1] || 0) }] : []);
          const round = audits.length;
          audits.push(images.map(image => ({ file: image.assetPath, targetIndex: image.targetIndex })));
          options.onAudit?.(request, round);
          const failures: PublishImageAuditResult["failures"] = images.flatMap(image => options.accept(image.assetPath, image.targetIndex, round) ? [] :
            [{ nodeIndex: image.nodeIndex, assetPath: image.assetPath, code: "SEMANTIC_REJECTION" as const, reason: "synthetic full-rule rejection" }]);
          return { ok: failures.length === 0, checked: images.length, images: images.map(image => ({ ...image, sha256: digest(image.assetPath) })), failures };
        } }) };
      return requireSource(name);
    },
  });
  return { select: loadedModule.exports.selectVerifiedProductSectionImages, audits, reviews: () => reviewCalls };
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "source-selection-fairness-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Network/provider calls are forbidden in source-selection fixtures"); };
  let count = 0;
  const test = async (name: string, operation: () => Promise<void>) => { await operation(); count++; console.log(`PASS ${name}`); };
  try {
    const files = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const file = path.join(directory, `seller-${index}.png`);
      await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: index * 19, g: 120, b: 210 - index * 11 } } }).png().toFile(file);
      return file;
    }));
    const classes = (file: string): Class => files.indexOf(file) < 6 ? "product-photo" : "scene-evidence";
    await test("six rejected packshots cannot starve an already proposed clean scene", async () => {
      const fixture = fixtureSelector({ classes: (_, file) => classes(file), accept: file => file === files[6] });
      const result = await fixture.select(files.slice(0, 7), "selected fixture", [overview()]);
      assert.equal(result[0]?.path, files[6], JSON.stringify({ finalAuditFiles: fixture.audits.map(round => path.basename(round[0].file)),
        boundCount: result.length, expected: "seller-6.png" }));
      assert.deepEqual(fixture.audits.map(round => round[0].file), [files[0], files[6]]);
    });
    await test("class preference remembers the last real full rejection across rounds", async () => {
      const fixture = fixtureSelector({ classes: (_, file) => classes(file), accept: file => file === files[7] });
      const result = await fixture.select(files.slice(0, 8), "alternating fixture", [overview()]);
      assert.equal(result[0]?.path, files[7]);
      assert.deepEqual(fixture.audits.map(round => round[0].file), [files[0], files[6], files[1], files[7]],
        "rebuilding a static interleaved list each round must not reset to product-photo");
    });
    await test("all final rejections remain unbound and preserve the six-call budget", async () => {
      const fixture = fixtureSelector({ classes: (_, file) => classes(file), accept: () => false });
      let diagnostics: ProductSectionImageDiagnostics | undefined;
      const result = await fixture.select(files, "all rejected fixture", [overview()], { onDiagnostics: value => { diagnostics = value; } });
      assert.equal(result.length, 0); assert.equal(fixture.audits.length, 6); assert.equal(diagnostics?.status, "incomplete");
      assert.deepEqual(fixture.audits.map(round => round[0].file), [files[0], files[6], files[1], files[7], files[2], files[8]]);
    });
    await test("one remaining class keeps the original candidate order", async () => {
      const fixture = fixtureSelector({ classes: () => "product-photo", accept: file => file === files[3] });
      assert.equal((await fixture.select(files.slice(0, 5), "same class fixture", [overview()]))[0]?.path, files[3]);
      assert.deepEqual(fixture.audits.map(round => round[0].file), files.slice(0, 4));
    });
    await test("feature-only and scene-forbidden targets retain their eligibility filters", async () => {
      const feature: Target = { sectionId: "feature-0", sectionTitle: "버튼 작동 구조", sectionBody: ["확인된 버튼 구조입니다."], imageIntent: "작동 구조 근거", imageSource: "seller-crop" };
      const fixture = fixtureSelector({ classes: (_, file) => file === files[2] ? "feature-evidence" : file === files[0] ? "product-photo" : "scene-evidence", accept: () => true });
      assert.equal((await fixture.select(files.slice(0, 3), "feature fixture", [feature]))[0]?.path, files[2]);
      assert.deepEqual(fixture.audits[0].map(row => row.file), [files[2]]);
      const legacy = { ...overview(), imageSource: undefined, imageIntent: "제품 대표 사진", sectionTitle: "제품 소개" };
      const photosOnly = fixtureSelector({ classes: (_, file) => file === files[1] ? "scene-evidence" : "product-photo", accept: file => file === files[2] });
      assert.equal((await photosOnly.select(files.slice(0, 3), "no scene fixture", [legacy]))[0]?.path, files[2]);
      assert.deepEqual(photosOnly.audits.map(round => round[0].file), [files[0], files[2]]);
    });
    await test("last rejected class is scoped to its target and invocation", async () => {
      const fixture = fixtureSelector({ targetCount: 2, classes: (target, file) => target === 0
        ? files.indexOf(file) < 2 ? "product-photo" : file === files[6] ? "scene-evidence" : null
        : file === files[2] ? "product-photo" : file === files[7] ? "scene-evidence" : null,
      accept: (file, target) => target === 0 ? file === files[6] : file === files[7] });
      const result = await fixture.select([files[0], files[1], files[2], files[6], files[7]], "target fixture", [overview("target-0"), overview("target-1")]);
      assert.equal(result.length, 2);
      assert.deepEqual(fixture.audits[0].map(row => row.file).sort(), [files[0], files[2]].sort());
      assert.deepEqual(fixture.audits[1].map(row => row.file).sort(), [files[6], files[7]].sort());
      const previous = fixture.audits.length;
      await fixture.select([files[0], files[1], files[2], files[6], files[7]], "target fixture", [overview("target-0"), overview("target-1")], { selectedProduct: "new exact option" });
      assert.deepEqual(fixture.audits[previous].map(row => row.file).sort(), [files[0], files[2]].sort(), "new context starts with the original product-photo preference");
    });
    await test("opposite rejected classes on two targets cannot poison each other's order", async () => {
      const fixture = fixtureSelector({ targetCount: 2, classes: (target, file) => target === 0
        ? files.indexOf(file) < 2 ? "product-photo" : file === files[6] ? "scene-evidence" : null
        : file === files[0] ? "product-photo" : file === files[7] ? "scene-evidence" : null,
      accept: (file, target) => target === 0 ? file === files[6] : file === files[0] });
      const result = await fixture.select([files[0], files[1], files[6], files[7]], "opposite history fixture", [overview("target-0"), overview("target-1")]);
      assert.equal(result.length, 2); assert.equal(fixture.audits.length, 2);
      assert.deepEqual(fixture.audits[0].map(row => [row.targetIndex, row.file]).sort(), [[0, files[0]], [1, files[7]]].sort());
      assert.deepEqual(fixture.audits[1].map(row => [row.targetIndex, row.file]).sort(), [[0, files[6]], [1, files[0]]].sort());
    });
    await test("maximum matching and SHA deduplication survive preference changes", async () => {
      const alias = path.join(directory, "identical-source-alias.png"); fs.copyFileSync(files[0], alias);
      const feature: Target = { sectionId: "feature-1", sectionTitle: "버튼 구조", imageIntent: "버튼 근거", imageSource: "seller-crop" };
      const fixture = fixtureSelector({ targetCount: 2, classes: (target, file) => target === 0 ? "product-photo" : file === files[0] ? "feature-evidence" : null, accept: () => true });
      const result = await fixture.select([files[0], alias, files[1]], "matching fixture", [overview("overview-0"), feature]);
      assert.equal(result.length, 2); assert.equal(new Set(result.map(row => row.sourceSha256)).size, 2);
      assert.equal(result.find(row => row.targetIndex === 1)?.path, files[0]);
      assert.equal(result.find(row => row.targetIndex === 0)?.path, files[1]);
      assert.equal(fixture.audits[0].length, 2);
    });
    await test("terminal provider failures stop immediately at the actual final audit", async () => {
      const quota = Object.assign(new Error("You have hit your usage limit"), { code: "CODEX_USAGE_LIMIT_REACHED" });
      const fixture = fixtureSelector({ classes: (_, file) => classes(file), accept: () => false, onAudit: () => { throw quota; } });
      await assert.rejects(() => fixture.select(files, "quota fixture", [overview()]), error => error === quota);
      assert.equal(fixture.audits.length, 1); assert.equal(fixture.reviews(), 1);
      const proposalFailure = fixtureSelector({ classes: () => "product-photo", accept: () => true, onReview: () => { throw quota; } });
      await assert.rejects(() => proposalFailure.select(files, "proposal quota fixture", [overview()]), error => error === quota);
      assert.equal(proposalFailure.audits.length, 0); assert.equal(proposalFailure.reviews(), 1);
    });
    await test("source-byte mutation during full audit remains fatal", async () => {
      const previous = fs.readFileSync(files[0]);
      const fixture = fixtureSelector({ classes: () => "product-photo", accept: () => true, onAudit: () => { fs.appendFileSync(files[0], "changed during audit"); } });
      await assert.rejects(() => fixture.select([files[0]], "changed fixture", [overview()]), /IMAGE_CHANGED/u);
      fs.writeFileSync(files[0], previous);
      assert.equal(fixture.audits.length, 1);
    });
    await test("cache reuse stays bound to section text, exact option and selected snapshot", async () => {
      const sourceUrl = "https://shop-phinf.pstatic.net/current-selected.png";
      fs.writeFileSync(`${files[0]}.retrieval.json`, JSON.stringify({ sourceUrl, sha256: digest(files[0]) }));
      const snapshot = (description: string) => createProductSnapshot({ productId: "fairness-fixture", connectKind: "SHOPPING", externalProductId: "synthetic-selected", sourceUrl: "https://seller.example/current",
        product: { name: "선택 상품", description, features: ["선택 옵션: 남색"], referenceImageUrls: [sourceUrl] } });
      const firstSnapshot = snapshot("확인된 현재 사실");
      const context = { selectedProduct: "exact navy option", selectedSourceSnapshot: firstSnapshot, selectedSourceProductId: firstSnapshot.productId,
        selectedSourceDirectory: directory, sourceSnapshotId: firstSnapshot.snapshotId };
      const fixture = fixtureSelector({ classes: () => "product-photo", accept: () => true });
      await fixture.select([files[0]], "context fixture", [overview()], context); assert.equal(fixture.audits.length, 1);
      let cacheHit = false;
      await fixture.select([files[0]], "context fixture", [overview()], { ...context, onDiagnostics: report => { cacheHit = report.cacheHit; } });
      assert.equal(cacheHit, true); assert.equal(fixture.audits.length, 1);
      await fixture.select([files[0]], "context fixture", [{ ...overview(), sectionBody: ["수정한 정확한 외형 설명"] }], context); assert.equal(fixture.audits.length, 2);
      await fixture.select([files[0]], "context fixture", [overview()], { ...context, selectedProduct: "other option" }); assert.equal(fixture.audits.length, 3);
      const next = snapshot("변경된 현재 사실");
      await fixture.select([files[0]], "context fixture", [overview()], { ...context, selectedSourceSnapshot: next, sourceSnapshotId: next.snapshotId }); assert.equal(fixture.audits.length, 4);
      fs.appendFileSync(files[0], "new immutable fixture pixels");
      await fixture.select([files[0]], "context fixture", [overview()], context); assert.equal(fixture.audits.length, 5, "byte drift cannot reuse an old final approval");
    });
    console.log(`PASS source selection fairness: ${count} offline cases; no real provider or approval calls`);
  } finally { globalThis.fetch = originalFetch; fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
