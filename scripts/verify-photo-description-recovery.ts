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
import { publicationImageContext } from "./lib/publish-image-rejections";

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
      textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo",
      photoClaimObjection: { origin: "section-body", sourceIndex: 2, quote: literal, scope: "pictured-appearance",
        conflict: "The pixels show the containers but no spread-out purple formula." } };
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
    // Actual saved packages coalesce six source paragraphs into two render
    // nodes. Paragraph topology is layout, not missing manuscript content.
    const coalescedComposition = { ...composition, renderNodes: [composition.renderNodes[0],
      { kind: "paragraph" as const, sectionId: "shopping-section-28267766", text: bodyParagraphs[0] },
      { kind: "paragraph" as const, sectionId: "shopping-section-28267766", text: bodyParagraphs.slice(1).join("\n\n") },
      ...composition.renderNodes.slice(7)] };
    const coalescedManifest = { ...manifest, composition: coalescedComposition };
    const coalescedFailure = (await auditPublishImages({ ...input, composition: coalescedComposition,
      review: async () => JSON.stringify({ reviews: [{ ...good, photoClaimObjection: { ...good.photoClaimObjection,
        sourceIndex: 1, quote: bodyParagraphs.slice(1).join("\n\n") } }] }) })).failures[0].photoDescription!;
    assert(coalescedFailure, "coalesced real layout still yields an exact grounded sentence finding");
    const coalesced = planPhotoDescriptionRepair(coalescedManifest, markdown, [coalescedFailure]);
    assert.deepEqual(coalesced.manifest.composition.sections[0].body, bodyParagraphs.filter(text => text !== literal));
    assert.equal(coalesced.manifest.composition.renderNodes.length, coalescedComposition.renderNodes.length,
      "a coalesced node retaining normal prose must remain in place");
    assert.deepEqual(coalesced.manifest.composition.renderNodes[2], { ...coalescedComposition.renderNodes[2],
      text: bodyParagraphs.slice(1).join("\n\n").replace(literal, "").trim() });
    assert.deepEqual(coalesced.manifest.composition.renderNodes.filter((_node, index) => index !== 2),
      coalescedComposition.renderNodes.filter((_node, index) => index !== 2), "all unrelated nodes and image styles remain identical");
    for (const badText of [bodyParagraphs.slice(1).filter(text => text !== bodyParagraphs[4]).join("\n\n"),
      `${bodyParagraphs.slice(1).join("\n\n")}\n\n렌더에만 추가된 확인되지 않은 문장입니다.`]) {
      const badComposition = { ...coalescedComposition, renderNodes: coalescedComposition.renderNodes.map((node, index) =>
        index === 2 ? { ...node, text: badText } : node) };
      assert.throws(() => planPhotoDescriptionRepair({ ...manifest, composition: badComposition }, markdown,
        [{ ...coalescedFailure, context: publicationImageContext(badComposition, coalescedFailure.sectionId) }]), /보존/,
      "missing or extra non-whitespace prose cannot be excused by paragraph coalescing");
    }
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
    // Exact explicit photo assertion from the final rejected persimmon scene.
    // A named box photograph is still a photo subject, not generic appearance.
    const boxLiteral = "상자 사진에는 길게 나뉜 칸마다 서로 다른 형태의 곶감이 담겨 있어요.";
    assert.equal(locatePhotoDescriptionSentence(boxLiteral, `본문의 “${boxLiteral}”는 실제 사진과 다릅니다.`), boxLiteral);
    for (const unsafeBoxClaim of [
      "상자가 길게 나뉜 칸마다 서로 다른 형태의 곶감이 담겨 있어요.",
      "용기 사진에는 서로 다른 형태의 곶감이 담겨 있어요.",
      "선반 사진에는 서로 다른 형태의 곶감이 담겨 있어요.",
      "상자 사진에는 1.65kg이라고 적힌 포장이 보여요.",
      "상자 사진에는 제품 원산지 표기가 보여요.",
    ]) assert.equal(locatePhotoDescriptionSentence(unsafeBoxClaim, `“${unsafeBoxClaim}”`), null,
      "the narrow box-photo subject cannot erase arbitrary nouns, generic appearance or product specifications");
    assert.equal(locatePhotoDescriptionSentence(boxLiteral, "“길게 나뉜 칸마다 서로 다른 형태의 곶감이 담겨 있어요.”"), null,
      "a fragment of the box description cannot authorize the whole sentence");
    const boxId = "offline-box-product-123";
    const boxDir = path.join(root, "data", "prepared-brand-posts", boxId);
    fs.mkdirSync(boxDir, { recursive: true });
    const boxImage = path.join(boxDir, "box-scene.png");
    fs.copyFileSync(image, boxImage);
    const boxImageBefore = fs.readFileSync(boxImage);
    const boxBody = ["곶감 선물세트는 보관 조건과 포장 형태를 함께 살펴볼 필요가 있습니다.",
      "판매자가 안내하는 무게와 보관 방법은 포장 사진만으로 확인할 수 없습니다.", boxLiteral,
      "선택 가능한 구성과 실제 구매 옵션은 상품 상세 정보를 통해 확인합니다.",
      "받는 사람의 취향과 식사 일정에 맞춰 선물을 고르는 편이 좋습니다."];
    const boxSectionId = "shopping-section-b9815b28";
    const boxComposition = { ...composition,
      sections: [{ ...composition.sections[0], id: boxSectionId, body: boxBody, characterCount: boxBody.join("").length,
        imagePaths: [boxImage] }, composition.sections[1]],
      renderNodes: [{ ...composition.renderNodes[0], sectionId: boxSectionId },
        { kind: "paragraph" as const, sectionId: boxSectionId, text: boxBody.join("\n\n") },
        { ...composition.renderNodes[7], sectionId: boxSectionId, assetPath: boxImage }, ...composition.renderNodes.slice(8)],
    } as BrandPostPackageManifestV2["composition"];
    const boxManifest = { ...manifest, brandLinkId: boxId, composition: boxComposition,
      imageAssets: [{ path: boxImage, sourcePath: boxImage, sha256, role: "body" as const, sectionId: boxSectionId }] };
    fs.writeFileSync(path.join(boxDir, "manifest.json"), JSON.stringify(boxManifest));
    const boxVerdict = { ...good, reason: `본문의 “${boxLiteral}”와 달리 사진은 같은 형태의 곶감이 반복된 칸을 보여 줍니다. 상품 외형과 옵션 및 사진 형식에는 다른 문제가 없습니다.`,
      photoClaimObjection: { ...good.photoClaimObjection, sourceIndex: 0, quote: boxBody.join("\n\n"),
        conflict: "The pictured compartments repeat the same shape instead of the different shapes asserted in this paragraph." } };
    const boxInput: PublishImageAuditOptions = { brandLinkId: boxId, productName: "예다움 상주곶감 선물세트",
      composition: boxComposition, review: async () => JSON.stringify({ reviews: [boxVerdict] }) };
    const boxFailure = (await auditPublishImages(boxInput)).failures[0];
    assert.equal(boxFailure.photoDescription?.literalClaim, boxLiteral);
    assert.equal(boxFailure.photoDescription?.nodeIndex, 2);
    assert.equal(boxFailure.photoDescription?.assetPath, boxImage);
    assert.equal(boxFailure.photoDescription?.sha256, sha256);
    assert.equal(boxFailure.photoDescription?.context, publicationImageContext(boxComposition, boxSectionId));
    await assert.rejects(assertPublishImagesSafe(boxInput), /PUBLISH_IMAGE_AUDIT_FAILED/u);
    const boxFindings = serverPhotoDescriptionFindings(boxManifest, [findingKey(boxFailure.photoDescription!)]);
    assert.equal(boxFindings.length, 1, "the actual audit persists the exact box description as a server-owned finding");
    const boxMarkdown = `# 곶감 선택 기준\n\n${boxBody.join("\n\n")}\n\n${untouchedBody}`;
    const boxPlanned = planPhotoDescriptionRepair(boxManifest, boxMarkdown, boxFindings);
    assert.equal(boxPlanned.markdown, boxMarkdown.replace(boxLiteral, ""));
    assert.deepEqual(boxPlanned.manifest.composition.sections[0].body, boxBody.filter(text => text !== boxLiteral));
    assert.deepEqual(boxPlanned.manifest.composition.sections[1], boxManifest.composition.sections[1]);
    assert.deepEqual(boxPlanned.manifest.imageAssets, boxManifest.imageAssets);
    assert.deepEqual(boxPlanned.manifest.composition.renderNodes.filter(node => node.kind === "image"),
      boxComposition.renderNodes.filter(node => node.kind === "image"));
    assert.deepEqual(fs.readFileSync(boxImage), boxImageBefore);
    for (const changedFinding of [{ ...boxFindings[0], sha256: "b".repeat(64) },
      { ...boxFindings[0], nodeIndex: 0 }, { ...boxFindings[0], context: "c".repeat(64) }])
      assert.throws(() => planPhotoDescriptionRepair(boxManifest, boxMarkdown, [changedFinding]), /보존/u,
        "box-photo repair still requires the exact current node, bytes and section context");
    assert.throws(() => serverPhotoDescriptionFindings(boxManifest, ["d".repeat(64)]), /보존/u,
      "a client cannot invent a box-photo finding");
    for (const patch of [{ identityMatches: false }, { mixedOptions: true }, { noGraphicLayout: false },
      { photoClaimMatches: true, photoClaimObjection: { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" } }, { reason: "제품 옵션이 미확정입니다." }]) {
      const unsafeBox = await auditPublishImages({ ...boxInput, review: async () => JSON.stringify({ reviews: [{ ...boxVerdict, ...patch }] }) });
      assert.equal(unsafeBox.failures[0].photoDescription, undefined,
        "a box-photo subject never overrides adverse identity, option, format or incomplete quoted evidence");
    }
    // Exact assertions from the latest failed LA-rib and Shark materials.
    // Both are scene-only descriptions, not product facts or performance proof.
    for (const actualClaim of [
      "제공된 사진에는 양념한 갈비가 접시에 담긴 모습과 조리 전 고기 모습이 보여요.",
      "사진처럼 카펫 위를 밀고 지나가는 사용 장면과 잘 맞는 형태예요.",
    ]) assert.equal(locatePhotoDescriptionSentence(["다른 확인된 근거는 유지합니다.", actualClaim], `본문의 “${actualClaim}”는 실제 사진과 다릅니다.`), actualClaim);
    for (const factualClaim of ["제공된 사진에는 532ml 용기가 보여요.", "사진처럼 사용시간 45분인 제품을 고르세요."])
      assert.equal(locatePhotoDescriptionSentence(factualClaim, `“${factualClaim}”`), null, "new photo grammar cannot erase quantities or verified product facts");
    for (const patch of [{ identityMatches: false }, { notice: true }, { mixedOptions: true }, { singlePhotograph: false },
      { noGraphicLayout: false }, { textPolicyMatches: false },
      { photoClaimMatches: true, photoClaimObjection: { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" } },
      { reason: "구조가 왜곡됐습니다." }]) {
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
    const mixedEvents: string[] = [];
    let mixedApprovals = 0, mixedMissing = false;
    await runMaterialPreparation("mixed-badge-photo-description", { pause: async () => {}, call: async (_url, method, data) => {
      const action = (data as { action?: string })?.action || method; mixedEvents.push(action);
      if (action === "approve") {
        mixedApprovals++;
        if (mixedApprovals === 1) {
          mixedMissing = true;
          throw Object.assign(new Error("seller badge and inaccurate photo assertion"), {
            code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: ["SEMANTIC_REJECTION: added badge", "SEMANTIC_REJECTION: false photo description"],
            imageAuditFailures: [{ code: "SEMANTIC_REJECTION", rejectionScope: "product" }, { ...failure, findingKey: findingKey(failure.photoDescription!) }],
          });
        }
        if (mixedApprovals === 2) { mixedMissing = true; throw error(); }
      }
      if (action === "repair_rejected" || action === "repair_photo_description") mixedMissing = false;
      return { success: true, data: { approvedAt: mixedApprovals === 3 ? "yes" : null,
        imageSlots: [{ missing: mixedMissing ? 1 : 0, generationMissing: mixedMissing ? 1 : 0 }], contentQuality: { signals: [] } } };
    } });
    assert.equal(mixedApprovals, 3);
    assert.equal(mixedEvents.filter(event => event === "repair_rejected").length, 1);
    assert.equal(mixedEvents.filter(event => event === "repair_photo_description").length, 1);
    assert(!mixedEvents.some(event => /generate_missing|regenerate|replan|revise/u.test(event)), "mixed format/text failure gets one failed-photo replacement and then preserves those exact pixels while fixing prose");
    // The Dalba package already has a durable old rejection before this run.
    // Readiness excludes the retained photograph; diagnosing it must precede
    // any generate_missing call, not wait for the later approve catch.
    for (const imageSource of ["staged-ai", "seller-original"]) {
      const staleEvents: string[] = [];
      let staleRepaired = false;
      await runMaterialPreparation(`old-rejected-${imageSource}`, { pause: async () => {}, call: async (_url, method, data) => {
        const action = (data as { action?: string })?.action || method;
        staleEvents.push(action);
        if (action === "audit_photo_descriptions") throw error();
        if (action === "repair_photo_description") staleRepaired = true;
        if (method === "POST") throw new Error("A retained photo must not be regenerated or recollected for a false sentence");
        return { success: true, data: { connectKind: "SHOPPING", approvedAt: staleEvents.includes("approve") ? "yes" : null,
          composition: { sections: [{ id: "shopping-section-28267766", imageSource }] },
          approval: { canApprove: staleRepaired, blockers: staleRepaired ? [] : [{ code: "image-publication-rejected", reason: "본문과 사진 불일치", sectionId: "shopping-section-28267766" }] },
          imageSlots: [{ sectionId: "shopping-section-28267766", missing: staleRepaired ? 0 : 1, generationMissing: imageSource === "staged-ai" && !staleRepaired ? 1 : 0 }], contentQuality: { signals: [] } } };
      } });
      assert(staleEvents.indexOf("audit_photo_descriptions") < staleEvents.indexOf("repair_photo_description"));
      assert(staleEvents.indexOf("repair_photo_description") < staleEvents.indexOf("approve"));
      assert.equal(staleEvents.filter(event => event === "repair_photo_description").length, 1);
      assert(!staleEvents.some(event => /generate|bind_sources|prepare_context/u.test(event)));
    }
    // A real badge/layout defect on the retained original is still a source
    // failure. The earlier diagnostic must never edit prose or spend a scene.
    for (const scope of ["format", "identity", "unknown"]) {
      const rejectedEvents: string[] = [];
      await assert.rejects(runMaterialPreparation(`rejected-original-${scope}`, { pause: async () => {}, call: async (_url, method, data) => {
        const action = (data as { action?: string })?.action || method; rejectedEvents.push(action);
        if (action === "audit_photo_descriptions") {
          if (scope === "unknown") throw Object.assign(new Error("review response lost"), { code: "ECONNRESET" });
          throw Object.assign(new Error(scope === "format" ? "gold badge outside product" : "wrong model"), {
            code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: [`SEMANTIC_REJECTION: ${scope}`],
            imageAuditFailures: [{ code: "SEMANTIC_REJECTION", rejectionScope: "product" }],
          });
        }
        if (action === "bind_sources") return { success: true, code: "IMAGE_SOURCE_BINDING_REQUIRED", errors: ["IMAGE_SOURCE_BINDING_REQUIRED: valid original unavailable"] };
        return { success: true, data: { connectKind: "SHOPPING", approvedAt: null,
          composition: { sections: [{ id: "original", imageSource: "seller-original" }] },
          approval: { canApprove: false, blockers: [{ code: "image-publication-rejected", reason: scope, sectionId: "original" }] },
          imageSlots: [{ sectionId: "original", missing: 1, generationMissing: 0 }], contentQuality: { signals: [] } } };
      } }), (value: unknown) => (value as { code?: string }).code === (scope === "unknown" ? "ECONNRESET" : "IMAGE_SOURCE_BINDING_REQUIRED"));
      assert(!rejectedEvents.some(event => /repair_photo_description|generate|regenerate|repair_rejected|approve/u.test(event)), "format/identity/uncertain failure cannot be repaired by deleting a body sentence");
      assert.equal(rejectedEvents.filter(event => event === "prepare_context").length, scope === "unknown" ? 0 : 1);
      if (scope !== "unknown") assert(rejectedEvents.indexOf("audit_photo_descriptions") < rejectedEvents.indexOf("bind_sources"));
    }
    // One quoted sentence rejected against two current photos is one text edit.
    // Use real audit findings and the normal server binding/repair planner.
    const secondImage = path.join(packageDir, "second-scene.png");
    await sharp({ create: { width: 320, height: 240, channels: 3, background: "#dddddd" } }).png().toFile(secondImage);
    const secondSha = crypto.createHash("sha256").update(fs.readFileSync(secondImage)).digest("hex");
    const firstImageNode = composition.renderNodes[7];
    const doubleComposition = { ...composition, sections: composition.sections.map(section => section.id === "shopping-section-28267766" ? { ...section, imagePaths: [image, secondImage] } : section),
      renderNodes: [...composition.renderNodes.slice(0, 8), { ...firstImageNode, assetPath: secondImage }, ...composition.renderNodes.slice(8)] } as BrandPostPackageManifestV2["composition"];
    const doubleManifest = { ...manifest, composition: doubleComposition, imageAssets: [...manifest.imageAssets!, { ...manifest.imageAssets![0], path: secondImage, sourcePath: secondImage, sha256: secondSha }] };
    fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify(doubleManifest));
    const doubleInput = { ...input, composition: doubleComposition, review: async () => JSON.stringify({ reviews: [good, { ...good, index: 2 }] }) };
    await assert.rejects(assertPublishImagesSafe(doubleInput), /PUBLISH_IMAGE_AUDIT_FAILED/u);
    const doubleFindings = readPhotoDescriptionFindings(id);
    assert.equal(doubleFindings.length, 2);
    const doubleFailures = doubleFindings.map(finding => ({ code: "SEMANTIC_REJECTION", rejectionScope: "section", photoDescription: finding, findingKey: findingKey(finding) }));
    let doubleEdits = 0, doubleApprovals = 0;
    await runMaterialPreparation("double-photo-description", { pause: async () => {}, call: async (_url, method, data) => {
      const action = (data as { action?: string })?.action;
      if (action === "approve" && ++doubleApprovals === 1) throw Object.assign(new Error("both photos contradict one assertion"), {
        code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: doubleFailures.map(() => "SEMANTIC_REJECTION: one false assertion"), imageAuditFailures: doubleFailures,
      });
      if (action === "repair_photo_description") {
        doubleEdits++;
        const keys = (data as { findingKeys: string[] }).findingKeys;
        assert.equal(keys.length, 1);
        const result = planPhotoDescriptionRepair(doubleManifest, markdown, serverPhotoDescriptionFindings(doubleManifest, keys));
        assert.deepEqual(result.manifest.imageAssets, doubleManifest.imageAssets);
        assert.equal(result.markdown, markdown.replace(literal, ""));
      }
      assert.notEqual(method, "POST", "duplicate photo findings never generate or rewrite");
      return { success: true, data: { approvedAt: doubleApprovals > 1 ? "yes" : null, imageSlots: [], contentQuality: { signals: [] } } };
    } });
    assert.equal(doubleEdits, 1); assert.equal(doubleApprovals, 2);
    let conflictingEdits = 0, conflictingGenerations = 0;
    await assert.rejects(runMaterialPreparation("different-photo-assertions", { pause: async () => {}, call: async (_url, method, data) => {
      const action = (data as { action?: string })?.action;
      if (action === "approve") throw Object.assign(new Error("two different false assertions in one section"), {
        code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: ["SEMANTIC_REJECTION: assertion one", "SEMANTIC_REJECTION: assertion two"],
        imageAuditFailures: [doubleFailures[0], { ...doubleFailures[1], photoDescription: { ...doubleFindings[1], literalClaim: "사진에는 다른 잘못된 장면이 보여요." } }],
      });
      if (action === "repair_photo_description") conflictingEdits++;
      if (method === "POST") conflictingGenerations++;
      return { success: true, data: { imageSlots: [], contentQuality: { signals: [] } } };
    } }), (value: unknown) => (value as { code?: string }).code === "PHOTO_DESCRIPTION_REPAIR_REQUIRED");
    assert.equal(conflictingEdits, 0); assert.equal(conflictingGenerations, 0, "an unsupported text-only repair must not regenerate correct pixels");
    assert.deepEqual(fs.readFileSync(image), beforeImage);
    fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify(manifest));
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
    const conflict = { gate: "status", claimAcquired: false, observedStatus: "DRAFTING", observedUpdatedAt: "2026-10-12T14:01:43.000Z" };
    const server = http.createServer((request, response) => {
      if (request.url === "/approval-conflict") {
        response.writeHead(409, { "content-type": "application/json" });
        response.end(JSON.stringify({ success: false, code: "NOT_READY", error: "작성·발행 중이거나 게시 여부 확인이 필요한 소재는 승인할 수 없습니다.", approvalConflict: conflict }));
        return;
      }
      response.writeHead(422, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: false, code: "PUBLISH_IMAGE_AUDIT_FAILED", errors: ["SEMANTIC_REJECTION: body mismatch"],
        imageAuditFailures: [{ ...failure, findingKey: findingKey(failure.photoDescription!) }] }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    process.env.APP_PORT = String((server.address() as { port: number }).port);
    try {
      await assert.rejects(localScheduleCall("/api/brandlinks/test/draft", "PATCH", { action: "approve" }),
        (value: unknown) => (value as { imageAuditFailures?: { findingKey: string }[] }).imageAuditFailures?.[0].findingKey === findingKey(failure.photoDescription!));
      await assert.rejects(localScheduleCall("/approval-conflict", "PATCH", { action: "approve" }), (value: unknown) => {
        assert.deepEqual((value as { approvalConflict?: unknown }).approvalConflict, conflict);
        assert.equal((value as { httpStatus?: number }).httpStatus, 409);
        return true;
      });
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
