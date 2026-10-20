/** Actual PATCH + immutable transaction regressions. Isolated files and DB/QA
 * doubles only; no app server, provider, approval or publication is invoked. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { atomicWriteTextFile } from "../src/lib/atomic-text-file";
import { commitPreparedPackageTransaction } from "./lib/prepared-package-transaction";
import { getBrandPostPackageDir, getBrandPostPackageManifestPath, readBrandPostPackage, type BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import { acquireBrandPostImageRepairLock } from "../src/lib/brand-post-image-repair-lock";
import { isDraftEditorialQualityPassed } from "../src/lib/brand-post-quality-display";
import { planPhotoDescriptionRepair, serverPhotoDescriptionFindings } from "../src/lib/brand-post-photo-description-repair";
import { findingKey, photoDescriptionFinding, savePhotoDescriptionFindings } from "./lib/photo-description-finding";
import { publicationImageContext } from "./lib/publish-image-rejections";
import { testPngFixture } from "./lib/test-png-fixture";

function actualFunctions<T>(file: string, names: string[], globals: Record<string, unknown>): T {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const nodes = names.map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name));
  assert.ok(nodes.every(Boolean), "exercise the actual production functions");
  const code = ts.transpileModule(nodes.map(node => node!.getText(ast)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = vm.createContext({ ...globals, exports: {}, Error, Buffer });
  vm.runInContext(code + `\nthis.api={${names.join(",")}}`, context, { filename: file });
  return context.api as T;
}

type RouteResponse = { status: number; success: boolean; code?: string; data?: BrandPostPackageManifestV2 };
const sha = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "photo-persist-"));
  const previousData = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = root;
  try {
    for (const fault of ["none", "implicit-appearance", "before-activate", "atomic-activate", "lost-owner", "changed-manifest", "changed-md", "digest-mismatch", "quality-rejected", "outside-section"] as const) {
      const id = `persist-${fault}`, directory = getBrandPostPackageDir(id);
      fs.mkdirSync(directory, { recursive: true });
      const image = path.join(directory, "original.png");
      fs.writeFileSync(image, testPngFixture("immutable existing product photo"));
      const imageBytes = fs.readFileSync(image);
      const literal = fault === "implicit-appearance" ? "밝은 원목 프레임과 투명 용기, 상단 조명이 한 구조로 이어진 외형이에요."
        : "사진에는 초록색 천 위에 상품 상자가 놓여 있어요.";
      const paragraphs = ["선물을 고를 때는 구매할 옵션의 표시와 판매자가 안내한 구성 정보를 먼저 확인하세요.", literal,
        "포장 방식은 받는 사람의 취향과 전달하는 상황에 맞춰 살펴볼 부분이에요.",
        "보관 방법과 배송 조건도 주문 전에 판매 페이지에서 확인하면 선택에 도움이 됩니다."];
      const composition = { version: "resolved-post-document/v1", contractVersion: "post-composition-contract/v1", connectKind: "SHOPPING",
        qualityPreset: "STANDARD", experienceMode: "AI_ASSISTED_INFORMATION", title: "선물 선택 기준",
        sections: [{ id: "photo-section", title: "포장 확인", body: paragraphs, characterCount: paragraphs.join("").length,
          imagePaths: [image], imageIntent: "상품 외형", imageSource: "staged-ai", headingStyle: "plain", imageMin: 1, imageMax: 1 },
        { id: "other-section", title: "주문 조건", body: ["선택한 옵션과 주문 조건을 확인하세요."], characterCount: 22,
          imagePaths: [], imageIntent: "", headingStyle: "plain", imageMin: 0, imageMax: 0 }],
        renderNodes: [{ kind: "image", sectionId: "photo-section", assetPath: image, role: "detail", altText: "상품 외형", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" },
          { kind: "heading", sectionId: "photo-section", text: "포장 확인" },
          { kind: "paragraph", sectionId: "photo-section", text: paragraphs.join("\n\n") },
          { kind: "connectCard", placement: "mid", url: "https://example.test/product" },
          { kind: "heading", sectionId: "other-section", text: "주문 조건" },
          { kind: "paragraph", sectionId: "other-section", text: "선택한 옵션과 주문 조건을 확인하세요." }], qualityReport: {} } as unknown as BrandPostPackageManifestV2["composition"];
      const markdown = `# 선물 선택 기준\n\n${paragraphs.join("\n\n")}\n\n선택한 옵션과 주문 조건을 확인하세요.`;
      const quality = { canPublish: true, code: "ok", score: 96, signals: [], blockers: [] };
      let initial!: BrandPostPackageManifestV2;
      const committed = commitPreparedPackageTransaction({ outputDir: directory, markdown,
        buildManifest: (markdownPath, markdownSha256) => (initial = { version: "brand-post-package/v2", contractVersion: "post-composition-contract/v1",
          brandLinkId: id, connectKind: "SHOPPING", title: "선물 선택 기준", composition, markdownPath, markdownSha256,
          heroImagePath: image, bodyImagePaths: [image], hashtags: ["선물"], approvedAt: null, createdAt: "original-date",
          imageAssets: [{ path: image, sourcePath: image, sha256: sha(imageBytes), role: "body", sectionId: "photo-section" }],
          contentQuality: quality, pipelineNotes: ["기존 검수 이력 보존"] } as unknown as BrandPostPackageManifestV2) });
      const finding = photoDescriptionFinding({ composition, nodeIndex: 0, sectionId: "photo-section", assetPath: image,
        sha256: sha(imageBytes), sectionBody: [paragraphs.join("\n\n")], allowProductPhoto: true, role: "body",
        verdict: { reason: `본문의 «${literal}»와 달리 실제 사진의 외형은 어둡습니다.`, photoClaimMatches: false,
          identityMatches: true, notice: false, mixedOptions: false, singlePhotograph: true, noGraphicLayout: true,
          textPolicyMatches: true, reviewClass: "product-photo",
          photoClaimObjection: { origin: "section-body", sourceIndex: 1, quote: literal,
            scope: "pictured-appearance", conflict: "The quoted appearance sentence does not match the current photo." } } });
      assert.ok(finding);
      savePhotoDescriptionFindings(id, [finding]);
      fs.writeFileSync(path.join(directory, "publish-image-rejections.json"), JSON.stringify([{ sha256: sha(imageBytes), sectionId: "photo-section",
        context: publicationImageContext(composition, "photo-section"), scope: "section" }]));
      if (fault === "digest-mismatch") fs.appendFileSync(initial.markdownPath, "external changed bytes");
      const manifestBefore = fs.readFileSync(committed.manifestPath), markdownBefore = fs.readFileSync(initial.markdownPath);
      const revisionManifestPath = path.join(committed.revisionDir, "manifest.json"), revisionBefore = fs.readFileSync(revisionManifestPath);
      let expectedPointer = manifestBefore, expectedOldMarkdown = markdownBefore, status = "READY", ownerCalls = 0, transactions = 0;
      const transaction = actualFunctions<{ commitPreparedPackageTransaction: typeof commitPreparedPackageTransaction }>("scripts/lib/prepared-package-transaction.ts",
        ["writeDurableFile", "commitPreparedPackageTransaction"], { fs, path, crypto,
          atomicWriteTextFile: (target: string, text: string) => atomicWriteTextFile(target, text, fault === "atomic-activate" ? {
            replaceForTest: () => { throw new Error("SIMULATED_ATOMIC_POINTER_FAILURE"); },
          } : {}) }).commitPreparedPackageTransaction;
      const route = actualFunctions<{ PATCH: (request: { json: () => Promise<unknown> }, context: { params: Promise<{ id: string }> }) => Promise<RouteResponse> }>(
        "src/app/api/brandlinks/[id]/draft/route.ts", ["PATCH"], {
          fs, path, crypto, requireAdminApiKey: () => null, isBrandPostImageRepairActive: () => false, requireNoPendingDesktopUpdate: () => null,
          NextResponse: { json: (body: object, options?: { status?: number }) => ({ ...body, status: options?.status || 200 }) },
          prisma: { brandLink: { findUnique: async () => ({ id, status, connectKind: "SHOPPING", productName: "선택 상품", url: "https://example.test/product" }),
            updateMany: async ({ data }: { data: { status?: string } }) => { if (data.status) status = data.status; return { count: 1 }; } } },
          acquireBrandPostImageRepairLock: () => { const lease = acquireBrandPostImageRepairLock(id, { purpose: "offline-persistence" });
            return { ...lease, assertOwner: () => { ownerCalls++; lease.assertOwner(); if (fault === "lost-owner" && ownerCalls === 2) throw new Error("SIMULATED_OWNER_LOSS"); } }; },
          readBrandPostPackage, getBrandPostPackageDir, getBrandPostPackageManifestPath, serverPhotoDescriptionFindings, planPhotoDescriptionRepair,
          isDraftEditorialQualityPassed, packagePreview: (value: unknown) => value,
          revalidateSavedBrandPostText: (candidate: BrandPostPackageManifestV2) => {
            if (fault === "changed-manifest") { expectedPointer = Buffer.from(JSON.stringify({ ...initial, externalNote: "concurrent metadata update" })); fs.writeFileSync(committed.manifestPath, expectedPointer); }
            if (fault === "changed-md") { expectedOldMarkdown = Buffer.concat([markdownBefore, Buffer.from("concurrent text")]); fs.writeFileSync(initial.markdownPath, expectedOldMarkdown); }
            return { ...candidate, contentQuality: fault === "quality-rejected" ? { ...quality, canPublish: false, code: "too-short-content" } : quality,
              ...(fault === "outside-section" ? { composition: { ...candidate.composition, sections: candidate.composition.sections.map((section, index) =>
                index === 1 ? { ...section, body: ["범위 밖 변경"] } : section) } } : {}) };
          },
          commitPreparedPackageTransaction: (input: Parameters<typeof commitPreparedPackageTransaction>[0]) => { transactions++;
            return transaction({ ...input, beforeActivate: () => { input.beforeActivate?.(); if (fault === "before-activate") throw new Error("SIMULATED_BEFORE_POINTER"); } }); },
        });
      const response = await route.PATCH({ json: async () => ({ action: "repair_photo_description", findingKeys: [findingKey(finding)] }) }, { params: Promise.resolve({ id }) });
      assert.deepEqual(fs.readFileSync(initial.markdownPath), expectedOldMarkdown, "the route cannot overwrite a prior physical markdown revision");
      assert.deepEqual(fs.readFileSync(revisionManifestPath), revisionBefore, "the old revision manifest is immutable");
      assert.deepEqual(fs.readFileSync(image), imageBytes); assert.equal(status, "READY", "release the row claim after success or failure");
      if (fault === "none" || fault === "implicit-appearance") {
        assert.equal(response.success, true); assert.equal(response.status, 200); assert.equal(transactions, 1);
        const current = JSON.parse(fs.readFileSync(committed.manifestPath, "utf8"));
        assert.notEqual(current.markdownPath, initial.markdownPath);
        assert.equal(fs.readFileSync(current.markdownPath, "utf8"), markdown.replace(literal, ""));
        assert.equal(sha(fs.readFileSync(current.markdownPath)), current.markdownSha256);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(current.markdownPath), "manifest.json"), "utf8")), current);
        assert.equal(response.data?.markdownPath, current.markdownPath); assert.equal(current.approvedAt, null);
        assert.deepEqual(current.imageAssets, initial.imageAssets); assert.deepEqual(current.pipelineNotes, initial.pipelineNotes);
        assert.deepEqual(current.composition.sections[1], initial.composition.sections[1]);
        assert.deepEqual(current.composition.renderNodes.filter((node: { kind: string }) => node.kind !== "paragraph"), initial.composition.renderNodes.filter(node => node.kind !== "paragraph"));
        assert.equal(fs.readdirSync(path.join(directory, ".package-revisions")).length, 2);
      } else {
        assert.equal(response.success, false); assert.equal(response.status, 409);
        assert.deepEqual(fs.readFileSync(committed.manifestPath), expectedPointer, "a failed transaction cannot replace the active pointer");
        assert.equal(fs.readdirSync(path.join(directory, ".package-revisions")).length, 1, "discard only the unpublished candidate, never an old revision");
      }
      console.log(`PASS actual photo-description PATCH immutable revision: ${fault}`);
    }
    console.log("Verified 10 actual-route immutable persistence checks; no live data, model, approval or publication.");
  } finally {
    if (previousData === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previousData;
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.match(path.basename(resolved), /^photo-persist-/u);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
