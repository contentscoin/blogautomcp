import assert from "node:assert/strict";
import { replanShoppingImageCoverage, type ImageReplanDependencies } from "../src/lib/brand-post-image-replan";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import { SHOPPING_POST_CONTRACT_V1, buildPostQualityReport, type ResolvedPostSectionV1 } from "../src/lib/post-composition-contract";
import { SHOPPING_POST_STRATEGY_VERSION, isShoppingSceneCoverageRelaxed } from "../src/lib/shopping-post-strategy";
import { droppableSceneSections, isOptionalSceneImageFailure, runMaterialPreparation } from "./lib/scheduled-draft-workflow";

type Fixture = { hero?: boolean; original?: boolean; scenes?: string[][]; rejected?: string[]; running?: boolean; sellerPhotos?: string[]; repairFails?: boolean; held?: string[] };

function fixture(options: Fixture = {}) {
  const scenes = options.scenes || [[], [], []];
  let stored = {
    version: "brand-post-package/v2", brandLinkId: "fixture", connectKind: "SHOPPING", imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
    approvedAt: "old-approval", title: "접이식 빨래건조대", createdAt: "created", hashtags: ["건조대"],
    heroImagePath: options.hero === false ? null : "hero.jpg",
    imageRequirements: { policy: "verified-source-first" },
    imageGeneration: { status: options.running ? "running" : "incomplete", requested: 3, applied: 0, remaining: 3, errors: ["REFERENCE_SCENE_FIDELITY_FAILED"], updatedAt: "old" },
    bodyImagePaths: ["original.jpg", ...scenes.flat()],
    imageAssets: [{ path: "original.jpg", sha256: "o" }, ...scenes.flat().map(file => ({ path: file, sha256: file }))],
    composition: {
      strategyVersion: SHOPPING_POST_STRATEGY_VERSION,
      renderNodes: [{ kind: "paragraph", text: "본문" }, ...scenes.flat().map(file => ({ kind: "image", assetPath: file }))],
      sections: [
        { id: "s0", title: "어떤 제품인지", body: ["본문"], imageIntent: "원본", imageSource: "seller-original", imageMin: 1, imageMax: 1, imagePaths: options.original === false ? [] : ["original.jpg"] },
        { id: "s1", title: "거실에서", body: ["본문"], imageIntent: "연출", imageSource: "staged-ai", imageMin: 1, imageMax: 1, imagePaths: scenes[0] },
        { id: "s2", title: "정보", body: ["본문"], imageIntent: "없음", imageSource: "none", imageMin: 0, imageMax: 0, imagePaths: [] },
        { id: "s3", title: "베란다에서", body: ["본문"], imageIntent: "연출", imageSource: "staged-ai", imageMin: 1, imageMax: 1, imagePaths: scenes[1] },
        { id: "s4", title: "보관", body: ["본문"], imageIntent: "연출", imageSource: "staged-ai", imageMin: 1, imageMax: 1, imagePaths: scenes[2] },
      ],
    },
  } as unknown as BrandPostPackageManifestV2;
  const rejected = new Set(options.rejected || []);
  let writes = 0;
  let released = 0;
  const repairRequests: string[][] = [];
  const deps = {
    read: () => structuredClone(stored),
    write: (value: BrandPostPackageManifestV2) => { stored = value; writes += 1; return value; },
    reconcile: (value: BrandPostPackageManifestV2) => value,
    lock: () => ({ assertOwner() {}, release() { released += 1; } }),
    repair: async (request: { sourceOnly?: boolean; requests?: Array<{ sectionId: string }> }) => {
      // 완화는 새 이미지를 생성하지 않는다. 검수된 판매자 실사진만 붙인다.
      assert.equal(request.sourceOnly, true);
      repairRequests.push((request.requests || []).map(item => item.sectionId));
      if (options.repairFails) throw new Error("PRODUCT_SOURCE_REQUIRED: 실사진 없음");
      const photos = [...(options.sellerPhotos || [])];
      for (const item of request.requests || []) {
        const photo = photos.shift();
        if (!photo) break;
        stored.composition.sections.find(section => section.id === item.sectionId)!.imagePaths = [photo];
      }
      return { errors: [] };
    },
    held: (_manifest: BrandPostPackageManifestV2, _sectionId: string, assetKey: string) => (options.held || []).includes(assetKey),
    slots: (value: BrandPostPackageManifestV2) => value.composition.sections.map(section => {
      const valid = section.imagePaths.filter(file => !rejected.has(file));
      const generated = section.imageSource === "staged-ai" ? section.imageMin! : 0;
      return { sectionId: section.id, minimum: section.imageMin!, maximum: section.imageMax!, count: valid.length,
        missing: Math.max(0, section.imageMin! - valid.length, section.imagePaths.length - valid.length),
        generatedMinimum: generated, generationMissing: Math.max(0, generated - valid.length), assets: valid.map(file => ({ path: file, sha256: file, assetKey: file })),
        staleTargets: section.imagePaths.filter(file => rejected.has(file)).map(file => ({ path: file, code: "image-publication-rejected" })) };
    }),
  } as unknown as ImageReplanDependencies;
  return { deps, read: () => stored, writes: () => writes, released: () => released, repairRequests };
}

async function main() {
  const saved = process.env.SHOPPING_GATE_PROFILE;
  delete process.env.SHOPPING_GATE_PROFILE;

  // 연출 사진을 하나도 못 만든 글: 원본 1장 + 썸네일로 구성을 확정한다.
  const none = fixture();
  const noneResult = await replanShoppingImageCoverage({ brandLinkId: "fixture" }, none.deps);
  assert.equal(noneResult.changed, true);
  assert.equal(noneResult.reason, "SCENES_RELAXED_ORIGINAL_PHOTO_ONLY");
  assert.equal(noneResult.after.missing, 0);
  assert.equal(none.writes(), 1);
  assert.equal(none.released(), 1);
  const noneStored = none.read();
  assert.deepEqual(noneStored.composition.sections.map(section => section.imageMin), [1, 0, 0, 0, 0]);
  assert.deepEqual(noneStored.composition.sections[0].imagePaths, ["original.jpg"], "첫 원본은 그대로 둔다");
  assert.deepEqual(none.repairRequests, [["s1", "s3", "s4"]], "빈 연출 자리마다 실사진을 한 번 요청한다");
  assert.deepEqual(noneStored.composition.sections.map(section => section.imageSource), ["seller-original", "seller-original", "none", "seller-original", "seller-original"]);

  // 서로 다른 판매자 실사진이 있으면 빈 자리에 붙는다. 부족하면 붙은 만큼만 쓴다.
  const withPhotos = fixture({ sellerPhotos: ["angle2.jpg", "detail.jpg"] });
  const withPhotosResult = await replanShoppingImageCoverage({ brandLinkId: "fixture" }, withPhotos.deps);
  assert.equal(withPhotosResult.reason, "SCENES_RELAXED_SELLER_PHOTOS_ADDED");
  assert.equal(withPhotosResult.after.missing, 0);
  assert.deepEqual(withPhotos.read().composition.sections.map(section => section.imagePaths), [["original.jpg"], ["angle2.jpg"], [], ["detail.jpg"], []]);

  // 실사진 붙이기가 실패해도 완화 결과는 유지된다.
  const repairFails = fixture({ repairFails: true });
  const repairFailsResult = await replanShoppingImageCoverage({ brandLinkId: "fixture" }, repairFails.deps);
  assert.equal(repairFailsResult.changed, true);
  assert.equal(repairFailsResult.reason, "SCENES_RELAXED_ORIGINAL_PHOTO_ONLY");
  assert.equal(noneStored.composition.imageFloor, 2);
  assert.equal(noneStored.approvedAt, null, "구성이 바뀌면 승인을 다시 받는다");
  assert.equal(noneStored.imageGeneration?.status, "complete");
  assert.match(noneStored.pipelineNotes!.join("\n"), /IMAGE_SCENES_RELAXED/u);
  assert.equal(isShoppingSceneCoverageRelaxed(noneStored.composition), true);

  // 통과한 연출 사진은 남기고, 거절된 파일만 빼고, 빈 슬롯만 낮춘다.
  const partial = fixture({ scenes: [["scene-ok.jpg"], ["scene-bad.jpg"], []], rejected: ["scene-bad.jpg"] });
  const partialResult = await replanShoppingImageCoverage({ brandLinkId: "fixture" }, partial.deps);
  assert.equal(partialResult.changed, true);
  const partialStored = partial.read();
  assert.deepEqual(partialStored.composition.sections.map(section => section.imagePaths), [["original.jpg"], ["scene-ok.jpg"], [], [], []]);
  assert.deepEqual(partialStored.composition.sections.map(section => section.imageMin), [1, 1, 0, 0, 0]);
  assert.deepEqual(partialStored.composition.sections.map(section => section.imageSource), ["seller-original", "staged-ai", "none", "seller-original", "seller-original"],
    "통과한 연출 사진 자리는 그대로 두고 빈 자리만 실사진 자리로 바꾼다");
  assert.equal(partialStored.composition.imageFloor, 3);
  assert.equal(partialStored.imageAssets!.some(asset => asset.path === "scene-bad.jpg"), false);
  assert.equal(partialStored.composition.renderNodes.some(node => node.kind === "image" && node.assetPath === "scene-bad.jpg"), false);

  // 원본이나 썸네일이 없으면 완화하지 않는다.
  for (const missing of [{ original: false }, { hero: false }] as Fixture[]) {
    const blocked = fixture(missing);
    const result = await replanShoppingImageCoverage({ brandLinkId: "fixture" }, blocked.deps);
    assert.equal(result.changed, false);
    assert.equal(result.reason, "REPLAN_ORIGINAL_PHOTO_REQUIRED");
    assert.equal(blocked.writes(), 0);
  }
  assert.equal((await replanShoppingImageCoverage({ brandLinkId: "fixture" }, fixture({ running: true }).deps)).reason, "REPLAN_BUSY");
  const full = fixture({ scenes: [["a.jpg"], ["b.jpg"], ["c.jpg"]] });
  assert.equal((await replanShoppingImageCoverage({ brandLinkId: "fixture" }, full.deps)).changed, false, "다 채워진 글은 건드리지 않는다");

  // strict 프로필은 이전 규칙 그대로다.
  process.env.SHOPPING_GATE_PROFILE = "strict";
  const strict = fixture();
  assert.equal((await replanShoppingImageCoverage({ brandLinkId: "fixture" }, strict.deps)).reason, "REPLAN_NATURAL_PHOTOS_REQUIRED");
  assert.equal(strict.writes(), 0);
  delete process.env.SHOPPING_GATE_PROFILE;

  // 구성 검사는 기록된 완화 하한만 인정한다.
  const section = (id: string, imageMin: number, imagePaths: string[]): ResolvedPostSectionV1 => ({
    id, title: id, body: ["본문"], characterCount: 320, imagePaths, imageMin, imageMax: 1, imageIntent: "의도", headingStyle: "sectionTitle",
  } as ResolvedPostSectionV1);
  const sections = [section("s0", 1, ["original.jpg"]), section("s1", 0, []), section("s2", 0, []), section("s3", 0, []), section("s4", 0, [])];
  const report = (imageFloor?: number, imageCount = 2) => buildPostQualityReport({ contract: SHOPPING_POST_CONTRACT_V1, preset: "PREMIUM", sections, imageCount, imageFloor, shoppingScenesRelaxed: imageFloor !== undefined });
  assert.equal(buildPostQualityReport({ contract: SHOPPING_POST_CONTRACT_V1, preset: "PREMIUM", sections, imageCount: 2, imageFloor: 2 }).canAutoPublish, false,
    "완화 표시 없이 남은 하한은 자연사진 계약을 우회하지 못한다");
  assert.equal(report().canAutoPublish, false, "완화 기록이 없으면 5장 기준이 그대로다");
  assert.equal(report(2).canAutoPublish, true);
  assert.equal(report(1).canAutoPublish, false, "썸네일만 있는 하한은 인정하지 않는다");
  assert.equal(report(2, 1).canAutoPublish, false, "실제 이미지가 하한보다 적으면 막는다");
  assert.equal(isShoppingSceneCoverageRelaxed({ strategyVersion: SHOPPING_POST_STRATEGY_VERSION, imageFloor: 5, sceneCoverage: "relaxed" }), false);
  assert.equal(isShoppingSceneCoverageRelaxed({ strategyVersion: SHOPPING_POST_STRATEGY_VERSION, imageFloor: 2 }), false);
  assert.equal(isShoppingSceneCoverageRelaxed({ strategyVersion: "shopping-post-strategy/v1", imageFloor: 2, sceneCoverage: "relaxed" }), false);

  // 연출 사진 실패만 완화 대상이다. 로그인·엔진·취소는 그대로 실패로 올린다.
  assert.equal(isOptionalSceneImageFailure({ code: "REFERENCE_SCENE_FIDELITY_FAILED" }), true);
  assert.equal(isOptionalSceneImageFailure({ code: "IMAGE_REPAIR_FAILED", errors: ["s1: PRODUCT_REFERENCE_REQUIRED: 참조 없음"] }), true);
  assert.equal(isOptionalSceneImageFailure({ code: "CODEX_AUTH_REQUIRED" }), false);
  assert.equal(isOptionalSceneImageFailure({ code: "IMAGE_REPAIR_FAILED", errors: ["s1: CHATGPT_BROWSER_LOGIN_REQUIRED"] }), false);
  assert.equal(isOptionalSceneImageFailure({ code: "USER_CANCELLED" }), false);
  assert.equal(isOptionalSceneImageFailure({ code: "IMAGE_SOURCE_BINDING_REQUIRED", errors: ["IMAGE_SOURCE_BINDING_REQUIRED: missing", "REQUEST_TIMEOUT: response lost"] }), false);
  assert.equal(isOptionalSceneImageFailure({ code: "REFERENCE_SCENE_FIDELITY_FAILED", errors: ["unclassified reviewer failure"] }), false);
  assert.equal(isOptionalSceneImageFailure({ code: "IMAGE_REPAIR_BUSY" }), false);
  assert.equal(isOptionalSceneImageFailure(new Error("unknown")), false);

  // 검수 결과를 확정하지 못해 보류된 연출 사진: 고쳐 쓰지 않고 빼고, 그 자리는 판매자 실사진 선택 슬롯이 된다.
  const heldScene = fixture({ scenes: [["a.jpg"], ["b.jpg"], ["c.jpg"]], held: ["b.jpg"], sellerPhotos: ["seller-2.jpg"] });
  const heldResult = await replanShoppingImageCoverage({ brandLinkId: "fixture" }, heldScene.deps);
  assert.equal(heldResult.changed, true);
  assert.equal(heldResult.after.missing, 0);
  assert.deepEqual(heldScene.repairRequests, [["s3"]]);
  assert.equal(heldScene.read().bodyImagePaths?.includes("b.jpg"), false, "보류된 연출 사진은 본문에서 빠진다");
  assert.deepEqual(heldScene.read().composition.sections.find(section => section.id === "s1")!.imagePaths, ["a.jpg"], "문제없는 연출 사진은 그대로 둔다");
  assert.equal(heldScene.read().composition.sections.find(section => section.id === "s3")!.imageSource, "seller-original");

  // 최종 검수가 거절한 문단을 지정해서 뺀다. 연출 문단이 아니면 아무것도 바꾸지 않는다.
  const named = fixture({ scenes: [["a.jpg"], ["b.jpg"], ["c.jpg"]] });
  const namedResult = await replanShoppingImageCoverage({ brandLinkId: "fixture", dropSectionIds: ["s4"] }, named.deps);
  assert.equal(namedResult.changed, true);
  assert.equal(named.read().bodyImagePaths?.includes("c.jpg"), false);
  assert.equal(named.read().bodyImagePaths?.includes("original.jpg"), true);
  const wrongTarget = fixture({ scenes: [["a.jpg"], ["b.jpg"], ["c.jpg"]] });
  const wrongResult = await replanShoppingImageCoverage({ brandLinkId: "fixture", dropSectionIds: ["s0"] }, wrongTarget.deps);
  assert.equal(wrongResult.changed, false, "판매자 원본 문단은 지정해도 빼지 않는다");
  assert.equal(wrongResult.reason, "REPLAN_DROP_TARGET_NOT_SCENE");
  assert.equal(wrongTarget.writes(), 0);
  process.env.SHOPPING_GATE_PROFILE = "strict";
  const strictDrop = fixture({ scenes: [["a.jpg"], ["b.jpg"], ["c.jpg"]] });
  assert.equal((await replanShoppingImageCoverage({ brandLinkId: "fixture", dropSectionIds: ["s4"] }, strictDrop.deps)).changed, false);
  delete process.env.SHOPPING_GATE_PROFILE;

  // 실제 PC에서 나온 실패 문구: 본문 연출 문단에만 걸린 실패는 그 문단을 뺄 대상으로 읽는다.
  assert.deepEqual(droppableSceneSections({ code: "IMAGE_RESUME_REQUIRED",
    message: "shopping-section-6d63a17b: IMAGE_RESUME_REQUIRED: 생성 요청이 이미 접수됐을 수 있어 자동 재전송하지 않았습니다. IMAGE_RESUME_REQUIRED: 이전 Codex 이미지 요청의 완료 여부를 확인해야 합니다." }),
    ["shopping-section-6d63a17b"]);
  assert.deepEqual(droppableSceneSections({ code: "HTTP_ERROR",
    message: "shopping-section-9bb0783e: PUBLICATION_IMAGE_REGENERATION_HELD: 관찰 부족 또는 미확정 표기 검수는 사진 교체 권한이 아닙니다." }),
    ["shopping-section-9bb0783e"]);
  assert.deepEqual(droppableSceneSections({ code: "PUBLISH_IMAGE_AUDIT_FAILED",
    imageAuditFailures: [{ code: "SEMANTIC_REJECTION", sectionId: "shopping-section-aa11" }, { code: "SEMANTIC_REJECTION", sectionId: "shopping-section-aa11" }] }),
    ["shopping-section-aa11"]);
  assert.equal(droppableSceneSections({ code: "PUBLISH_IMAGE_AUDIT_FAILED",
    imageAuditFailures: [{ code: "INVALID_REVIEW", sectionId: null }, { code: "SEMANTIC_REJECTION", sectionId: "shopping-section-aa11" }] }), null,
    "대표 이미지 문제가 섞이면 연출 사진만 빼서는 해결되지 않는다");
  assert.equal(droppableSceneSections({ code: "IMAGE_RESUME_REQUIRED", message: "이전 이미지 작업의 실행 여부를 확인할 수 없습니다." }), null);
  assert.equal(droppableSceneSections({ code: "CODEX_AUTH_REQUIRED", message: "shopping-section-aa11: CODEX_AUTH_REQUIRED: 로그인" }), null);
  assert.equal(droppableSceneSections({ code: "USER_CANCELLED", message: "shopping-section-aa11: IMAGE_RESUME_REQUIRED: x" }), null);
  assert.equal(droppableSceneSections({ code: "HTTP_ERROR", message: "shopping-section-aa11: IMAGE_RESUME_REQUIRED: x REQUEST_TIMEOUT" }), null);

  // 준비 흐름: 연출 문단 실패 → 그 문단만 빼기 요청 1회 → 한 번 더 진행. 빼지 못하면 원래 실패를 그대로 올린다.
  const flow = (changed: boolean) => {
    const calls: string[] = [];
    const deps = { pause: async () => {}, now: () => 0, onStage: () => {},
      call: async (pathname: string, method: string, body?: { action?: string; dropSectionIds?: string[] }) => {
        calls.push(`${method} ${pathname.split("/").slice(4).join("/")} ${body?.action || ""}`.trim());
        if (body?.action === "replan_sources") {
          assert.deepEqual(body.dropSectionIds, ["shopping-section-aa11"]);
          return { success: true, recovery: { changed }, remainingMissing: 0 };
        }
        throw Object.assign(new Error("shopping-section-aa11: PUBLICATION_IMAGE_REGENERATION_HELD: 보류"), { code: "HTTP_ERROR" });
      } };
    return { calls, run: runMaterialPreparation("fixture", deps as never) };
  };
  const dropped = flow(true);
  await assert.rejects(dropped.run, (error: Error & { sceneDropAttempted?: boolean }) => error.sceneDropAttempted === true);
  assert.deepEqual(dropped.calls, ["GET draft", "POST draft/images replan_sources", "GET draft"], "빼기는 한 번만 요청하고 한 번만 다시 진행한다");
  const refused = flow(false);
  await assert.rejects(refused.run, (error: Error & { sceneDropAttempted?: boolean }) => !error.sceneDropAttempted);
  assert.deepEqual(refused.calls, ["GET draft", "POST draft/images replan_sources"]);
  process.env.SHOPPING_GATE_PROFILE = "strict";
  const strictFlow = flow(true);
  await assert.rejects(strictFlow.run);
  assert.deepEqual(strictFlow.calls, ["GET draft"], "strict 프로필은 기존 동작 그대로다");
  delete process.env.SHOPPING_GATE_PROFILE;

  if (saved === undefined) delete process.env.SHOPPING_GATE_PROFILE;
  else process.env.SHOPPING_GATE_PROFILE = saved;
  console.log("shopping scene relax ok");
}

main().catch((error) => { console.error(error); process.exit(1); });
