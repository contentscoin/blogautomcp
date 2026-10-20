import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import { planRejectedOriginalRepair } from "../src/lib/brand-post-rejected-original-repair";
import { readCanonicalSellerSourceHashes } from "./lib/canonical-seller-source";
import { recordPublicationImageRejections, rejectedPublicationImageHashes } from "./lib/publish-image-rejections";
import { auditPublishImages, type PublishImageAuditOptions } from "./lib/publish-image-audit";
import { runMaterialPreparation } from "./lib/scheduled-draft-workflow";

const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const actualPublishedSentence = "포장 상자도 함께 보이지만 사진만으로 선택 구성 전체를 알 수는 없어요.";
const neutral = { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" };
const good = { index: 1, accepted: true, identityMatches: true, photoClaimMatches: true, photoClaimObjection: neutral,
  notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true,
  noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo", reason: "Offline source/slot contract fixture" };

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rejected-original-")), previous = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = root;
  const store = await import("../src/lib/brand-post-package");
  const { repairBrandPostImages } = await import("../src/lib/brand-post-image-repair");
  let checks = 0;
  try {
    const id = "microscope-source-fixture", dir = store.getBrandPostPackageDir(id), sources = path.join(dir, "product-sources");
    fs.mkdirSync(sources, { recursive: true });
    const files = ["hero", "bad-original-no-box", "same-product-with-box", "normal-scene"].map(name => path.join(dir, `${name}.png`));
    for (let index = 0; index < files.length; index++) await sharp({ create: { width: 320, height: 320, channels: 3,
      background: `rgb(${50 + index * 30},120,140)` } }).png().toFile(files[index]);
    const [hero, bad, alternative, normal] = files, markdown = path.join(dir, "post.md");
    fs.writeFileSync(markdown, actualPublishedSentence);
    const urls = [0, 1].map(index => `https://shop-phinf.pstatic.net/selected/microscope-${index}.png?type=w860`);
    for (const [index, file] of [bad, alternative].entries()) {
      const cached = path.join(sources, `${hash(file)}.png`); fs.copyFileSync(file, cached);
      fs.writeFileSync(`${cached}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: urls[index],
        sha256: hash(file), retrievedAt: new Date(Date.now() - 1000).toISOString() }));
    }
    const snapshot = createProductSnapshot({ productId: id, externalProductId: id, connectKind: "SHOPPING",
      sourceUrl: "https://smartstore.naver.com/selected/products/123456", product: { name: "어린이 스크린 현미경", referenceImageUrls: urls } });
    const original = { id: "original", title: "어린이 현미경 외형", body: [actualPublishedSentence], characterCount: 40,
      imagePaths: [bad], imageMin: 1, imageMax: 1, imageSource: "seller-original", imageIntent: "판매페이지 원본 상품 사진: 선택 상품의 외형", headingStyle: "plain" } as const;
    const baseline = { version: "brand-post-package/v2", brandLinkId: id, connectKind: "SHOPPING", title: "어린이 현미경 외형",
      generationSource: "AI", markdownPath: markdown, markdownSha256: hash(markdown), heroImagePath: hero, bodyImagePaths: [bad, alternative, normal],
      imageAssets: [{ path: hero, sourcePath: hero, sha256: hash(hero), role: "hero", provenance: "PHOTO_TEXT_THUMBNAIL", creationMethod: "local-composite", remoteGenerated: false },
        { path: bad, sourcePath: bad, sha256: hash(bad), role: "body", sectionId: "original", slotId: "original:image:1", provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false,
          sourceReview: { version: "product-photo-source-review/v1", sourceSha256: hash(bad), usage: "section-matched-product-evidence", sectionIntent: original.imageIntent,
            reviewClass: "product-photo", reason: "Old source reviewer missed the absent box", reviewedAt: "2026-10-19T01:12:26.645Z" } },
        { path: alternative, sourcePath: alternative, sha256: hash(alternative), role: "body", sectionId: null, provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false },
        { path: normal, sourcePath: normal, sha256: hash(normal), role: "body", sectionId: "normal", slotId: "normal:image:1", provenance: "GENERATED_SCENE", creationMethod: "reference-guided-scene", remoteGenerated: true }],
      hashtags: [], imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", contractVersion: "post-composition-contract/v1", createdAt: new Date().toISOString(), approvedAt: null,
      composition: { version: "resolved-post-document/v1", title: "어린이 현미경 외형", connectKind: "SHOPPING", sections: [original, { ...original, id: "normal", title: "생활 장면", body: ["생활 맥락입니다."],
        imagePaths: [normal], imageSource: "staged-ai", imageIntent: "AI 연출 이미지: 생활 장면" }], renderNodes: [
        { kind: "image", assetPath: hero, sectionId: null, role: "thumbnail", altText: "외형", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" },
        { kind: "heading", sectionId: "original", text: original.title }, { kind: "paragraph", sectionId: "original", text: actualPublishedSentence },
        { kind: "image", assetPath: bad, sectionId: "original", role: "scene", altText: "외형", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" },
        { kind: "heading", sectionId: "normal", text: "생활 장면" }, { kind: "paragraph", sectionId: "normal", text: "생활 맥락입니다." },
        { kind: "image", assetPath: normal, sectionId: "normal", role: "scene", altText: "생활", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" }] },
      contentQuality: { canPublish: true, score: 97, signals: [] }, sourceSnapshot: snapshot,
    } as unknown as BrandPostPackageManifestV2;
    const manifestFile = path.join(dir, "manifest.json"), rejectionFile = path.join(dir, "publish-image-rejections.json");
    const reset = () => {
      fs.writeFileSync(manifestFile, JSON.stringify(baseline)); fs.writeFileSync(rejectionFile, "[]");
      recordPublicationImageRejections(id, baseline.composition, [{ sha256: hash(bad), sectionId: "original", scope: "section" }]);
      return structuredClone(baseline);
    };
    const photoHashes = files.map(hash), canonical = readCanonicalSellerSourceHashes({ snapshot, productId: id, sourceDirectory: sources });
    assert.deepEqual([...canonical].sort(), [hash(bad), hash(alternative)].sort()); checks++;
    let manifest = reset();
    const requests = planRejectedOriginalRepair(manifest, "original");
    assert.equal(requests.length, 1); assert.equal(requests[0].replaceAssetKey, hash(bad)); checks++;
    for (const scenario of ["no-rejection", "product-scope", "old-context", "changed-text", "stale-body", "duplicate-use", "changed-bytes", "generated", "wrong-source", "wrong-section", "normal-slot", "running", "unknown-owner", "unbound-snapshot"] as const) {
      manifest = reset();
      if (scenario === "no-rejection") fs.writeFileSync(rejectionFile, "[]");
      if (scenario === "product-scope" || scenario === "old-context") {
        const rows = JSON.parse(fs.readFileSync(rejectionFile, "utf8"));
        if (scenario === "product-scope") rows[0].scope = "product"; else rows[0].context = "f".repeat(64);
        fs.writeFileSync(rejectionFile, JSON.stringify(rows));
      }
      if (scenario === "changed-text") manifest.composition.renderNodes[2] = { kind: "paragraph", sectionId: "original", text: "본문이 달라졌어요." };
      if (scenario === "stale-body") manifest.composition.sections[0].body = ["본문이 달라졌어요."];
      if (scenario === "duplicate-use") manifest.composition.sections[1].imagePaths.push(bad);
      if (scenario === "changed-bytes") fs.appendFileSync(bad, "changed");
      if (scenario === "generated") manifest.imageAssets![1].remoteGenerated = true;
      if (scenario === "wrong-source") manifest.composition.sections[0].imageSource = "staged-ai";
      if (scenario === "wrong-section") manifest.imageAssets![1].sectionId = "normal";
      if (scenario === "running" || scenario === "unknown-owner") manifest.imageGeneration = { status: scenario === "running" ? "running" : "complete",
        recoveryState: scenario === "unknown-owner" ? "owner-unknown" : undefined } as never;
      if (scenario === "unbound-snapshot") manifest.sourceSnapshot!.product.name = "changed product";
      try { assert.throws(() => planRejectedOriginalRepair(manifest, scenario === "normal-slot" ? "normal" : "original"), /REJECTED_ORIGINAL_REPAIR_INVALID/u, scenario); checks++; }
      finally { if (scenario === "changed-bytes") fs.writeFileSync(bad, fs.readFileSync(path.join(sources, `${photoHashes[1]}.png`))); }
    }
    const duplicate = path.join(sources, "ambiguous.png"); fs.copyFileSync(alternative, duplicate);
    fs.writeFileSync(`${duplicate}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: urls[0],
      sha256: hash(alternative), retrievedAt: new Date(Date.now() - 1000).toISOString() }));
    assert(!readCanonicalSellerSourceHashes({ snapshot, productId: id, sourceDirectory: sources }).has(hash(bad))); checks++;
    fs.unlinkSync(`${duplicate}.retrieval.json`); fs.unlinkSync(duplicate);

    const run = async (outcome: "success" | "wrong-option" | "no-alternative" | "repeat" | "transport") => {
      reset(); let approved = 0, mutations = 0, backups = 0, finalReviews = 0; const actions: string[] = [];
      const originalFailure = () => Object.assign(new Error("real photo has no box while the published sentence names one"), { code: "PUBLISH_IMAGE_AUDIT_FAILED",
        errors: ["SEMANTIC_REJECTION: missing pictured box"], imageAuditFailures: [{ code: "SEMANTIC_REJECTION", sectionId: "original", rejectionScope: "section", photoClaimMismatchOnly: true as const }] });
      const preview = () => { const current = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as BrandPostPackageManifestV2;
        const needs = current.composition.sections[0].imagePaths[0] === bad;
        return { connectKind: "SHOPPING", approvedAt: approved ? "offline-reviewed-approval" : null,
          approval: { canApprove: !needs, blockers: needs ? [{ code: "image-publication-rejected", sectionId: "original", reason: "사진에 상자 없음" }] : [] },
          composition: { sections: current.composition.sections.map(section => ({ id: section.id, imageSource: section.imageSource })) },
          contentQuality: { signals: [] }, imageSlots: [{ sectionId: "original", missing: needs ? 1 : 0, generationMissing: 0 }], imageGeneration: { status: "complete" } }; };
      const api = async (url: string, method: string, body?: object) => {
        const action = (body as { action?: string })?.action || method; actions.push(action);
        if (action === "audit_photo_descriptions") throw originalFailure();
        if (action === "repair_rejected_originals") {
          mutations++; assert.equal(backups, 1); assert.equal((body as { sectionId?: string }).sectionId, "original");
          const current = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as BrandPostPackageManifestV2;
          const planned = planRejectedOriginalRepair(current, "original");
          if (outcome === "transport") throw Object.assign(new Error("lost operation result"), { code: "ECONNRESET" });
          const result = await repairBrandPostImages({ brandLinkId: id, requests: planned, sourceOnly: true, canonicalSourceOnly: true }, {
            read: store.readBrandPostPackage, write: store.writeBrandPostPackageManifest, apply: store.applyGeneratedBrandPostImage,
            generate: async options => {
              assert.equal(options.sourceOnly, true); assert.equal(options.canonicalSourceOnly, true); assert.equal(options.requests.length, 1);
              const request = options.requests[0]; assert.equal(request.replaceAssetKey, hash(bad));
              if (outcome === "no-alternative") return [{ ...request, generatedPath: null, imageIntent: original.imageIntent, provenance: "ORIGINAL", error: "IMAGE_SOURCE_BINDING_REQUIRED: no alternative" }];
              const auditOptions: PublishImageAuditOptions = { productName: "어린이 스크린 현미경", composition: { sections: [
                { ...current.composition.sections[0], imagePaths: [alternative] }], renderNodes: [
                { kind: "paragraph", sectionId: "original", text: actualPublishedSentence },
                { kind: "image", sectionId: "original", assetPath: alternative, role: "detail", altText: "외형", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" }] },
                review: async () => JSON.stringify({ reviews: [{ ...good, identityMatches: outcome !== "wrong-option", accepted: outcome !== "wrong-option",
                  reason: outcome === "wrong-option" ? "Candidate shows the wrong selected option" : "The matching white/yellow microscopes and box support the unchanged actual published sentence" }] }) };
              const qa = await auditPublishImages(auditOptions); assert.equal(qa.ok, outcome !== "wrong-option");
              if (!qa.ok) return [{ ...request, generatedPath: null, imageIntent: original.imageIntent, provenance: "ORIGINAL", error: "IMAGE_SOURCE_BINDING_REQUIRED: wrong option" }];
              return [{ ...request, generatedPath: alternative, bindExistingAssetKey: hash(alternative), provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false,
                imageIntent: original.imageIntent, sourceReview: { version: "product-photo-source-review/v1", sourceSha256: hash(alternative), usage: "section-matched-product-evidence",
                  sectionIntent: original.imageIntent, reviewClass: "product-photo", reason: "Actual selected product/box pixels match the unchanged paragraph", reviewedAt: new Date().toISOString() } }];
            } });
          return { success: true, data: preview(), appliedCount: result.appliedCount, generatedCount: result.generatedCount, errors: result.errors, remainingMissing: result.remaining };
        }
        if (action === "approve") {
          finalReviews++;
          const current = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as BrandPostPackageManifestV2;
          const finalQA = await auditPublishImages({ productName: "어린이 스크린 현미경", composition: { sections: [current.composition.sections[0]],
            renderNodes: current.composition.renderNodes.filter(node => "sectionId" in node && node.sectionId === "original") },
            review: async () => JSON.stringify({ reviews: [{ ...good, accepted: outcome !== "repeat", photoClaimMatches: outcome !== "repeat",
              photoClaimObjection: outcome === "repeat" ? { origin: "section-body", sourceIndex: 0, quote: actualPublishedSentence,
                scope: "pictured-appearance", conflict: "A new actual published-photo mismatch remains" } : neutral }] }) });
          if (!finalQA.ok) throw originalFailure(); approved++;
        }
        assert(!["revise", "repair_photo_description", "generate_missing", "regenerate", "prepare_context", "publish"].includes(action));
        assert(!url.endsWith("/images")); return { success: true, data: preview() };
      };
      const operation = runMaterialPreparation(id, { pause: async () => {}, call: api }, { incrementalOnly: true, beforeRepair: async () => { backups++; } });
      if (outcome === "success") await operation; else await assert.rejects(operation);
      if (outcome === "no-alternative") {
        await assert.rejects(runMaterialPreparation(id, { pause: async () => {}, call: api }, { incrementalOnly: true, beforeRepair: async () => { backups++; } }));
        assert.equal(mutations, 1, "the persisted same-input failed operation cannot renew the source review budget"); checks++;
      }
      assert.equal(mutations, 1); assert.equal(approved, outcome === "success" ? 1 : 0);
      assert.equal(finalReviews, outcome === "success" || outcome === "repeat" ? 1 : 0);
      const current = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as BrandPostPackageManifestV2;
      assert.equal(current.title, baseline.title); assert.deepEqual(current.composition.sections.map(section => section.body), baseline.composition.sections.map(section => section.body));
      assert.equal(hash(markdown), baseline.markdownSha256); assert.deepEqual(files.map(hash), photoHashes);
      assert.deepEqual(current.imageAssets!.find(asset => asset.sectionId === "normal"), baseline.imageAssets!.find(asset => asset.sectionId === "normal"));
      assert(rejectedPublicationImageHashes(id, baseline.composition, "original").includes(hash(bad)), "old bad pixels/history remain recorded");
      assert(!actions.includes("repair_photo_description")); checks++;
    };
    for (const outcome of ["success", "wrong-option", "no-alternative", "repeat", "transport"] as const) {
      fs.rmSync(path.join(dir, "image-recovery-history.json"), { force: true }); await run(outcome);
    }
    console.log(`PASS rejected seller-original repair: ${checks} checks; exact current rejection/canonical scope, unchanged box-description recovery, normal assets preserved, source and final QA, bounded retries; no paid generation/publication`);
  } finally {
    if (previous === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
