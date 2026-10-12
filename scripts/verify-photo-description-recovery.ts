import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import sharp from "sharp";
import { auditPublishImages, assertPublishImagesSafe, type PublishImageAuditOptions } from "./lib/publish-image-audit";
import { findingKey, readPhotoDescriptionFindings, locatePhotoDescriptionSentence } from "./lib/photo-description-finding";
import { planPhotoDescriptionRepair, serverPhotoDescriptionFindings } from "../src/lib/brand-post-photo-description-repair";
import { runMaterialPreparation, localScheduleCall, type Call, type Result } from "./lib/scheduled-draft-workflow";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import { validateBrandPostPublishImages } from "../src/lib/brand-post-publish-preflight";
import { acquireBrandPostImageRepairLock } from "../src/lib/brand-post-image-repair-lock";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "photo-description-repair-"));
  const previousData = process.env.DESKTOP_USER_DATA;
  const previousPort = process.env.APP_PORT;
  process.env.DESKTOP_USER_DATA = root;
  try {
    const id = "offline-product-123";
    const packageDir = path.join(root, "data", "prepared-brand-posts", id);
    fs.mkdirSync(packageDir, { recursive: true });
    const image = path.join(packageDir, "scene.png");
    await sharp({ create: { width: 320, height: 240, channels: 3, background: "#eeeeee" } }).png().toFile(image);
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(image)).digest("hex");
    // Exact saved sentence from the real rejected Dalba section (read-only evidence).
    const literal = "제품 사진에는 연보라색 제형이 펼쳐져 있고 용기에도 퍼플 코렉팅이 표시돼 있어요.";
    const bodyParagraphs = ["이 제품은 페이스용으로 분류돼 있어요.",
      "그래서 얼굴에 바를 자외선 차단제와 톤업 제품을 함께 찾는 상황에 실용적이에요.", literal,
      "다만 펼쳐 놓은 제형 색과 피부 위에서 보이는 색은 구분해야 해요.",
      "사진만으로 내 얼굴에서 얼마나 밝아지는지나 잡티가 얼마나 가려지는지는 알 수 없어요.",
      "평소 베이스 색이 잘 맞는 분이라면 그 위에 더해질 색감까지 고려하는 편이 좋아요."];
    const body = bodyParagraphs.join("\n");
    const untouchedBody = "보관 조건과 선택 옵션은 판매자 상세 정보에서 확인하세요.";
    const composition = {
      version: "resolved-post-document/v1", contractVersion: "post-composition-contract/v1", connectKind: "SHOPPING", qualityPreset: "STANDARD", experienceMode: "AI_ASSISTED_INFORMATION", title: "달바 퍼플 톤업 선택 기준",
      sections: [
        { id: "shopping-section-28267766", title: "제형과 사용 기준", body: bodyParagraphs, characterCount: body.length, imagePaths: [image], imageIntent: "제품 원형을 보존한 연출컷 또는 원본 사용 장면", imageSource: "staged-ai", headingStyle: "plain", imageMin: 1, imageMax: 1 },
        { id: "untouched-section", title: "선택 조건", body: [untouchedBody], characterCount: untouchedBody.length, imagePaths: [], imageIntent: "", headingStyle: "plain", imageMin: 0, imageMax: 0 },
      ],
      renderNodes: [
        { kind: "heading", sectionId: "shopping-section-28267766", text: "제형과 사용 기준" },
        ...bodyParagraphs.map(text => ({ kind: "paragraph", sectionId: "shopping-section-28267766", text })),
        { kind: "image", sectionId: "shopping-section-28267766", assetPath: image, role: "detail", altText: "상품 외형", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" },
        { kind: "heading", sectionId: "untouched-section", text: "선택 조건" },
        { kind: "paragraph", sectionId: "untouched-section", text: untouchedBody },
      ], qualityReport: {},
    } as unknown as BrandPostPackageManifestV2["composition"];
    const manifest = { version: "brand-post-package/v2", contractVersion: "post-composition-contract/v1", brandLinkId: id, connectKind: "SHOPPING", composition,
      imageAssets: [{ path: image, sourcePath: image, sha256, role: "body", sectionId: "shopping-section-28267766" }], approvedAt: null,
    } as unknown as BrandPostPackageManifestV2;
    fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify(manifest));
    const good = { index: 1, reason: `본문의 “${literal}”와 달리 사진은 용기 외형만 보여 줍니다. 제품과 옵션은 일치하고 배치와 형상에 다른 문제는 없습니다.`,
      accepted: false, identityMatches: true, photoClaimMatches: false, notice: false, mixedOptions: false,
      explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true, noGraphicLayout: true,
      textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo" };
    const input: PublishImageAuditOptions = { brandLinkId: id, productName: "달바 퍼플 톤업 선크림", composition,
      review: async () => JSON.stringify({ reviews: [good] }) };
    const failure = (await auditPublishImages(input)).failures[0];
    assert.equal(failure.photoDescription?.literalClaim, literal, "original Dalba mismatch is a scoped body finding");
    assert.equal(failure.photoDescription?.sha256, sha256);
    assert.equal(failure.photoDescription?.sectionId, "shopping-section-28267766");
    assert.equal(failure.photoDescription?.nodeIndex, 7);
    await assert.rejects(assertPublishImagesSafe(input), /PUBLISH_IMAGE_AUDIT_FAILED/);
    assert.equal(readPhotoDescriptionFindings(id).length, 1, "real audit persists server-owned finding");
    for (const generation of [{ status: "running" }, { status: "complete", recoveryState: "owner-unknown" }]) {
      fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify({ ...manifest, imageGeneration: generation }));
      const previousManifest = fs.readFileSync(path.join(packageDir, "manifest.json"));
      let modelCalls = 0;
      await assert.rejects(validateBrandPostPublishImages(id, "달바", { review: async () => { modelCalls++; return ""; } }),
        (value: unknown) => (value as { code?: string }).code === "IMAGE_RESUME_REQUIRED");
      assert.equal(modelCalls, 0, "running/unknown diagnostic must not submit a review");
      assert.deepEqual(fs.readFileSync(path.join(packageDir, "manifest.json")), previousManifest);
    }
    fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify(manifest));
    const imageBeforeLease = fs.readFileSync(image);
    const manifestBeforeLease = fs.readFileSync(path.join(packageDir, "manifest.json"));
    const lease = acquireBrandPostImageRepairLock(id, { purpose: "test-existing-owner" });
    try {
      await assert.rejects(validateBrandPostPublishImages(id, "달바"), /IMAGE_REPAIR_BUSY/u);
      lease.assertOwner();
      assert.deepEqual(fs.readFileSync(image), imageBeforeLease);
      assert.deepEqual(fs.readFileSync(path.join(packageDir, "manifest.json")), manifestBeforeLease);
    } finally { lease.release(); }
    const findings = serverPhotoDescriptionFindings(manifest, [findingKey(failure.photoDescription!)]);
    const markdown = `# 달바 퍼플 톤업 선택 기준\n\n${body}\n\n${untouchedBody}`;
    const beforeImage = fs.readFileSync(image);
    const planned = planPhotoDescriptionRepair(manifest, markdown, findings);
    assert.deepEqual(planned.manifest.composition.sections[0].body, bodyParagraphs.filter(text => text !== literal));
    assert.deepEqual(planned.manifest.composition.sections[1], manifest.composition.sections[1]);
    assert.deepEqual(planned.manifest.composition.renderNodes.filter(node => node.kind === "image"), composition.renderNodes.filter(node => node.kind === "image"));
    assert.deepEqual(planned.manifest.imageAssets, manifest.imageAssets);
    const facts = { version: "post-spec/v1", facts: { lines: ["페이스용 퍼플 톤업 선크림"] } };
    const cached = planPhotoDescriptionRepair({ ...manifest, postSpec: facts,
      specDraft: { sections: [{ lines: [literal] }] } }, markdown, findings);
    assert.equal(cached.manifest.specDraft, null, "later spec revision cannot resurrect the false sentence");
    assert.deepEqual(cached.manifest.postSpec, facts, "verified source facts remain intact");
    assert.equal(planned.markdown, markdown.replace(literal, ""));
    assert.deepEqual(fs.readFileSync(image), beforeImage);
    assert.throws(() => serverPhotoDescriptionFindings(manifest, ["a".repeat(64)]), /보존/);
    assert.throws(() => planPhotoDescriptionRepair({ ...manifest, composition: { ...composition,
      sections: composition.sections.map(section => ({ ...section, body: [...section.body, "추가 문장"] })) } }, markdown, findings), /보존/);
    assert.throws(() => planPhotoDescriptionRepair(manifest, markdown, [{ ...findings[0], sha256: "b".repeat(64) }]), /보존/);
    assert.throws(() => planPhotoDescriptionRepair(manifest, markdown, [{ ...findings[0], nodeIndex: 0 }]), /보존/);
    assert.equal(locatePhotoDescriptionSentence([body], `“${literal}”`), literal);
    assert.equal(locatePhotoDescriptionSentence(body, "용기만 있어 제형을 확인할 수 없습니다."), null);
    assert.equal(locatePhotoDescriptionSentence(body, "“없는 문장과 설명은 수정하세요.”"), null);
    const genericSurface = "제품 표면의 질감이 매끈하게 보여요.";
    assert.equal(locatePhotoDescriptionSentence(genericSurface, `“${genericSurface}”`), null, "product appearance without an explicit photo assertion must remain intact");
    const decimalLabel = "사진에는 100.5ml라고 적힌 용기 라벨이 보여요.";
    assert.equal(locatePhotoDescriptionSentence(decimalLabel, `“${decimalLabel}”`), null, "never clip a decimal or erase a product specification");
    assert.equal(locatePhotoDescriptionSentence(body, "“연보라색 제형이 펼쳐져 있고 용기에도 퍼플 코렉팅이 표시돼 있어요.”"), null, "a quote fragment cannot authorize deleting a larger sentence");
    for (const patch of [{ identityMatches: false }, { notice: true }, { mixedOptions: true }, { singlePhotograph: false },
      { noGraphicLayout: false }, { textPolicyMatches: false }, { photoClaimMatches: true }, { reason: "구조가 왜곡됐습니다." }]) {
      const unsafe = await auditPublishImages({ ...input, review: async () => JSON.stringify({ reviews: [{ ...good, ...patch }] }) });
      assert.equal(unsafe.failures[0].photoDescription, undefined, "identity/format/unknown failure cannot authorize text repair");
    }

    const error = () => Object.assign(new Error("SEMANTIC_REJECTION: false photo description"), {
      code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: ["SEMANTIC_REJECTION: false photo description"],
      imageAuditFailures: [{ ...failure, findingKey: findingKey(failure.photoDescription!) }],
    });
    const events: string[] = [];
    let approvals = 0;
    const call: Call = async (url, method, data) => {
      const action = (data as { action?: string })?.action || method;
      events.push(action);
      if (action === "approve" && ++approvals === 1) throw error();
      if (action === "repair_photo_description") assert.deepEqual((data as { findingKeys: string[] }).findingKeys, [findingKey(failure.photoDescription!)]);
      return { success: true, data: { approvedAt: approvals > 1 ? "approved" : null, imageSlots: [], contentQuality: { signals: [] } } };
    };
    await runMaterialPreparation(id, { call, pause: async () => {} });
    assert.equal(events.filter(event => event === "repair_photo_description").length, 1);
    assert.equal(events.filter(event => event === "approve").length, 2);
    assert(!events.some(event => /generate|regenerate|repair_rejected|replan|revise/u.test(event)), "text repair re-audits the SAME image without spending generation");
    // The Dalba package already has a durable old rejection before this run.
    // Readiness excludes the retained photograph; diagnosing it must precede
    // any generate_missing call, not wait for the later approve catch.
    const staleEvents: string[] = [];
    let staleRepaired = false;
    await runMaterialPreparation("old-rejected-dalba", { pause: async () => {}, call: async (_url, method, data) => {
      const action = (data as { action?: string })?.action || method;
      staleEvents.push(action);
      if (action === "audit_photo_descriptions") throw error();
      if (action === "repair_photo_description") staleRepaired = true;
      if (method === "POST") throw new Error("A retained photo must not be regenerated for a false sentence");
      return { success: true, data: { connectKind: "SHOPPING", approvedAt: staleEvents.includes("approve") ? "yes" : null,
        approval: { canApprove: staleRepaired, blockers: staleRepaired ? [] : [{ code: "image-publication-rejected", reason: "본문과 사진 불일치", sectionId: "shopping-section-28267766" }] },
        imageSlots: [{ sectionId: "shopping-section-28267766", missing: staleRepaired ? 0 : 1, generationMissing: staleRepaired ? 0 : 1 }], contentQuality: { signals: [] } } };
    } });
    assert(staleEvents.indexOf("audit_photo_descriptions") < staleEvents.indexOf("repair_photo_description"));
    assert(staleEvents.indexOf("repair_photo_description") < staleEvents.indexOf("approve"));
    assert.equal(staleEvents.filter(event => event === "repair_photo_description").length, 1);
    assert(!staleEvents.includes("generate_missing"));
    for (const code of ["USER_CANCELLED", "IMAGE_RESUME_REQUIRED", "CODEX_AUTH_REQUIRED", "ECONNRESET"]) {
      let repairs = 0;
      await assert.rejects(runMaterialPreparation(id, { pause: async () => {}, call: async (_url, method, data) => {
        const action = (data as { action?: string })?.action;
        if (action === "approve") throw Object.assign(new Error(code), { code });
        if (method === "POST" || action === "repair_photo_description") repairs++;
        return { success: true, data: { imageSlots: [], contentQuality: { signals: [] } } };
      } }), new RegExp(code));
      assert.equal(repairs, 0, "cancelled/auth/uncertain audit never replays or generates");
    }
    let editAttempts = 0, secondApprovals = 0;
    await assert.rejects(runMaterialPreparation(id, { pause: async () => {}, call: async (_url, _method, data) => {
      const action = (data as { action?: string })?.action;
      if (action === "approve") { secondApprovals++; throw error(); }
      if (action === "repair_photo_description") editAttempts++;
      return { success: true, data: { imageSlots: [], contentQuality: { signals: [] } } };
    } }), /false photo description/);
    assert.equal(editAttempts, 1); assert.equal(secondApprovals, 2, "second rejection remains terminal");

    for (const recoverOriginal of [false, true]) {
      const preflightEvents: string[] = [];
      let bound = false, generated = false;
      const snapshot = (): Result => ({ success: true, data: { connectKind: "SHOPPING", approvedAt: preflightEvents.includes("approve") ? "yes" : null,
        composition: { sections: [{ id: "original", imageSource: "seller-original" }, { id: "scene", imageSource: "staged-ai" }] },
        imageSlots: [{ sectionId: "original", missing: bound ? 0 : 1, generationMissing: 0 }, { sectionId: "scene", missing: generated ? 0 : 1, generationMissing: generated ? 0 : 1 }],
        contentQuality: { signals: [] } } });
      const deps = { pause: async () => {}, call: async (_url: string, method: string, data?: object): Promise<Result> => {
        const request = data as { action?: string; refreshSourcePhotos?: boolean } | undefined;
        const action = request?.action || method; preflightEvents.push(action);
        if (action === "bind_sources") {
          if (request?.refreshSourcePhotos && recoverOriginal) bound = true;
          return { ...snapshot(), code: bound ? "IMAGE_GENERATION_REQUIRED" : "IMAGE_SOURCE_BINDING_REQUIRED", errors: [bound ? "IMAGE_GENERATION_REQUIRED: scene needed" : "IMAGE_SOURCE_BINDING_REQUIRED: clean original missing"] };
        }
        if (action === "generate_missing") { assert.equal(bound, true); generated = true; }
        return snapshot();
      } };
      if (recoverOriginal) {
        await runMaterialPreparation(`preflight-${recoverOriginal}`, deps);
        assert(preflightEvents.indexOf("prepare_context") < preflightEvents.indexOf("generate_missing"));
        assert.equal(preflightEvents.filter(event => event === "generate_missing").length, 1);
      } else {
        await assert.rejects(runMaterialPreparation(`preflight-${recoverOriginal}`, deps), (value: unknown) => (value as { code?: string }).code === "IMAGE_SOURCE_BINDING_REQUIRED");
        assert(!preflightEvents.some(event => /generate|regenerate|repair_rejected/u.test(event)));
      }
      assert.equal(preflightEvents.filter(event => event === "prepare_context").length, 1, "original refresh is bounded");
    }
    const server = http.createServer((_request, response) => {
      response.writeHead(422, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: false, code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: ["SEMANTIC_REJECTION: body mismatch"],
        imageAuditFailures: [{ ...failure, findingKey: findingKey(failure.photoDescription!) }] }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    process.env.APP_PORT = String((server.address() as { port: number }).port);
    try {
      await assert.rejects(localScheduleCall("/api/brandlinks/test/draft", "PATCH", { action: "approve" }),
        (value: unknown) => (value as { imageAuditFailures?: { findingKey: string }[] }).imageAuditFailures?.[0].findingKey === findingKey(failure.photoDescription!));
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    console.log("PASS: exact Dalba photo assertion correction, same-image re-audit, server finding binding, identity/format/unknown guards, bounded original preflight and structured HTTP transport");
  } finally {
    if (previousData === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previousData;
    if (previousPort === undefined) delete process.env.APP_PORT; else process.env.APP_PORT = previousPort;
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected test directory");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
