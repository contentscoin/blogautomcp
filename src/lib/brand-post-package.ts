import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { copyProductPhotoSource, readProductPhotoSource } from "../../scripts/lib/product-photo-provenance";
import { getAppDataDir } from "../../scripts/lib/app-paths";
import type { BrandLinkContentReadiness } from "../../scripts/lib/brandlink-content-readiness";
import type { ProductSnapshot } from "./draft-context-snapshot";
import type { SavedTextQcMetadata } from "./brand-post-revalidation";
import { atomicWriteTextFile } from "./atomic-text-file";
import { isDraftEditorialQualityPassed } from "./brand-post-quality-display";
import {
  getPostCompositionContract,
  refreshPostDocumentQuality,
  normalizeLegacyFreeformImageRules,
  sectionImageBounds,
  type ResolvedPostDocumentV1,
} from "./post-composition-contract";
import {
  assessProductEditorialCoverage,
  hasProductLimitationLanguage,
} from "../../scripts/lib/product-editorial-plan";

export interface BrandPostPackageImageAsset {
  path: string;
  sourcePath: string;
  sha256: string;
  role: "hero" | "body";
  sectionId?: string | null;
  imageIntent?: string;
  slotId?: string;
  creationMethod?: "source" | "local-composite" | "remote-generated" | "source-with-generated-background";
  remoteGenerated?: boolean;
  provenance?: "ORIGINAL" | "LOCKED_PRODUCT" | "GENERATED_BACKGROUND" | "EDITORIAL_CARD";
}

/** Spec-first 파이프라인 검증 리포트 요약(매니페스트 specValidation / 미리보기 readiness). */
export interface BrandPostPackageReadiness {
  status: "READY" | "NEEDS_REVIEW" | "BLOCKED";
  score: number;
  summary: string;
  signals: Array<{ key: string; label: string; status: "pass" | "warn" | "fail"; sectionIndex?: number; detail?: string }>;
  repairTargets: Array<{ sectionIndex: number | null; code: string; reason: string; priority: string; instruction: string }>;
  generationSource: string;
  attempts: number;
}

/** 초안 생성 프로세스가 패키지 디렉터리에 남기는 결과(코드+메시지). 라우트가 로그 정규식 대신 이 파일로 원인을 읽는다. */
export interface BrandPostPackageResult {
  ok: boolean;
  code: string;
  message: string;
  readiness?: unknown;
  at?: string;
}

export interface BrandPostQualityRepairSummary {
  attempted: boolean;
  applied: boolean;
  beforeScore: number;
  afterScore: number;
  beforeCode: BrandLinkContentReadiness["code"];
  afterCode: BrandLinkContentReadiness["code"];
  note: string;
}

interface BrandPostPackageManifestBase {
  brandLinkId: string;
  connectKind: "SHOPPING" | "TRAVEL";
  title: string;
  generationSource?: "AI" | "PREPARED_APPROVED";
  markdownPath: string;
  markdownSha256?: string;
  heroImagePath: string;
  bodyImagePaths: string[];
  imageAssets?: BrandPostPackageImageAsset[];
  hashtags: string[];
  imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" | "TRAVEL_EDITORIAL";
  /** Original photos meet coverage by default; generation is an explicit opt-in contract. */
  imageRequirements?: { policy: "verified-source-first" | "generated-required" };
  createdAt: string;
  approvedAt: string | null;
  contentQuality?: BrandLinkContentReadiness | null;
  sourceSnapshot?: ProductSnapshot;
  textQualityRevalidation?: SavedTextQcMetadata;
  qualityRepair?: BrandPostQualityRepairSummary | null;
  imageGeneration?: {
    status: "running" | "complete" | "incomplete";
    requested: number;
    applied: number;
    remaining: number;
    errors: string[];
    updatedAt: string;
    ownerPid?: number;
    ownerToken?: string;
    heartbeatAt?: string;
    recoveryState?: "owner-exited" | "owner-unknown";
  };
  /** Spec-first 파이프라인 산출물(부분 수정에 필요). 미리보기에는 싣지 않는다. */
  postSpec?: unknown;
  specDraft?: unknown;
  specValidation?: BrandPostPackageReadiness | null;
  pipelineNotes?: string[] | null;
}

export interface BrandPostPackageManifestV1 extends BrandPostPackageManifestBase {
  version: "brand-post-package/v1";
}

export interface BrandPostPackageManifestV2 extends BrandPostPackageManifestBase {
  version: "brand-post-package/v2";
  contractVersion: "post-composition-contract/v1";
  composition: ResolvedPostDocumentV1;
  thumbnailSpec: {
    version: "thumbnail-spec/v2";
    canvas: { width: number; height: number; aspect: "1:1" | "16:9" };
    style: string;
    sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" | "TRAVEL_EDITORIAL";
    sourceImagePath: string;
  };
}

export type BrandPostPackageManifest =
  | BrandPostPackageManifestV1
  | BrandPostPackageManifestV2;

export function getBrandPostPackageResultPath(brandLinkId: string): string {
  return path.join(getBrandPostPackageDir(brandLinkId), "result.json");
}

export function readBrandPostPackageResult(brandLinkId: string): BrandPostPackageResult | null {
  const resultPath = getBrandPostPackageResultPath(brandLinkId);
  if (!fs.existsSync(resultPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(resultPath, "utf8")) as BrandPostPackageResult;
  } catch {
    return null;
  }
}

/** contentQuality(발행 게이트)를 Spec-first 검증 리포트 형태로 요약한다(specValidation 이 없을 때). */
function readinessFromContentQuality(
  quality: BrandLinkContentReadiness | null | undefined,
  generationSource: string,
): BrandPostPackageReadiness | null {
  if (!quality) return null;
  const failing = quality.signals.filter((signal) => signal.status === "fail");
  return {
    status: quality.canPublish ? "READY" : "BLOCKED",
    score: quality.score,
    summary: quality.summary,
    signals: quality.signals.map((signal) => ({ key: signal.key, label: signal.label, status: signal.status })),
    repairTargets: failing.map((signal) => ({ sectionIndex: null, code: signal.key, reason: signal.label, priority: "P0", instruction: quality.reason || signal.label })),
    generationSource,
    attempts: 1,
  };
}

/** contentQuality 가 없는 v2 패키지는 렌더 계약 품질 리포트로 readiness 를 요약한다. */
function readinessFromQualityReport(
  report: ResolvedPostDocumentV1["qualityReport"],
  generationSource: string,
): BrandPostPackageReadiness {
  return {
    status: report.canAutoPublish ? "READY" : "NEEDS_REVIEW",
    score: report.score,
    summary: report.canAutoPublish
      ? `렌더 계약 품질 ${report.score}점 (자동 발행 가능)`
      : `렌더 계약 품질 ${report.score}점 — ${report.blockers.join(" ") || report.warnings.join(" ")}`,
    signals: [
      ...report.blockers.map((blocker) => ({ key: "composition-blocker", label: blocker, status: "fail" as const })),
      ...report.warnings.map((warning) => ({ key: "composition-warning", label: warning, status: "warn" as const })),
    ],
    repairTargets: report.blockers.map((blocker) => ({ sectionIndex: null, code: "COMPOSITION_QUALITY", reason: blocker, priority: "P0", instruction: blocker })),
    generationSource,
    attempts: 1,
  };
}

export function getBrandPostPackageDir(brandLinkId: string): string {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(brandLinkId)) {
    throw new Error("초안 상품 ID 형식이 올바르지 않습니다.");
  }
  return path.join(getAppDataDir(), "prepared-brand-posts", brandLinkId);
}

export function getBrandPostPackageManifestPath(brandLinkId: string): string {
  return path.join(getBrandPostPackageDir(brandLinkId), "manifest.json");
}

export function readBrandPostPackage(brandLinkId: string, options: { migrate?: boolean } = {}): BrandPostPackageManifest | null {
  const manifestPath = getBrandPostPackageManifestPath(brandLinkId);
  if (!fs.existsSync(manifestPath)) return null;
  let parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BrandPostPackageManifest;
  const supportedVersion =
    parsed.version === "brand-post-package/v1" || parsed.version === "brand-post-package/v2";
  if (!supportedVersion || parsed.brandLinkId !== brandLinkId) {
    throw new Error("준비된 초안 패키지 형식이 올바르지 않습니다.");
  }
  if (
    parsed.version === "brand-post-package/v2" &&
    (parsed.contractVersion !== "post-composition-contract/v1" ||
      parsed.composition?.version !== "resolved-post-document/v1")
  ) {
    throw new Error("준비된 초안 패키지의 렌더 계약 형식이 올바르지 않습니다.");
  }

  if (options.migrate === false) return parsed;
  // A full current text evaluation must never be replaced by the narrow legacy
  // shopping migrations below. Image reconciliation can still refresh its gate.
  if (parsed.version === "brand-post-package/v2" && parsed.textQualityRevalidation) {
    const reconciled = reconcileBrandPostPackageQuality(parsed);
    if (JSON.stringify(reconciled) !== JSON.stringify(parsed)) writeBrandPostPackageManifest(reconciled);
    return reconciled;
  }

  const persistMigration = () => {
    if (parsed.version === "brand-post-package/v2") {
      // Back up original bytes before ANY read-time migration changes this package.
      try {
        fs.copyFileSync(manifestPath, `${manifestPath}.pre-qc-v139.bak`, fs.constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    writeBrandPostPackageManifest(parsed);
  };

  // v1 시절에는 사용자가 직접 확인·승인한 초안에도 generationSource가 저장되지
  // 않았다. 승인 이력이 있는 레거시 초안은 사용자 승인본으로 마이그레이션해
  // 발행 단계가 상품 페이지를 다시 연 뒤 출처 오류로 끝나는 문제를 막는다.
  if (parsed.version === "brand-post-package/v1" && parsed.approvedAt && !parsed.generationSource) {
    parsed = { ...parsed, generationSource: "PREPARED_APPROVED" };
    persistMigration();
  }

  // 이전 판정기는 자연스러운 "어떤 사람에게 더 맞을까", "장점이 살아나요"
  // 같은 표현을 놓쳐 editorial-flow 하나만 실패시키기도 했다. 저장된 본문을 현재
  // 의미 판정기로 다시 확인해 나머지 품질 신호가 모두 정상인 초안은 즉시 복구한다.
  if (
    parsed.version === "brand-post-package/v2" &&
    parsed.connectKind === "SHOPPING" &&
    parsed.contentQuality &&
    !parsed.contentQuality.canPublish
  ) {
    const coverage = assessProductEditorialCoverage(
      parsed.composition.sections.map((section) => `${section.title}\n${section.body.join("\n")}`),
    );
    const editorialFlow = parsed.contentQuality.signals.find((signal) => signal.key === "editorial-flow");
    const otherFailures = parsed.contentQuality.signals.filter(
      (signal) => signal.key !== "editorial-flow" && signal.status === "fail",
    );
    if (editorialFlow?.status === "fail" && coverage.missingCoreRoles.length <= 1 && otherFailures.length === 0) {
      const signals = parsed.contentQuality.signals.map((signal) =>
        signal.key === "editorial-flow" ? { ...signal, status: "pass" as const } : signal,
      );
      const warnings = signals.filter((signal) => signal.status === "warn");
      const score = Math.max(0, 100 - warnings.length * 5);
      parsed = {
        ...parsed,
        contentQuality: {
          ...parsed.contentQuality,
          canPublish: true,
          code: "ok",
          reason: null,
          score,
          signals,
          summary: `커넥트 글 발행 게이트 통과 (${score}점, 신호 ${signals.length}/${signals.length})`,
        },
      };
      persistMigration();
    }
  }

  // 이전 의미 판정기는 "부담이 될 수 있어요", "성능 수치는 확인되지
  // 않았습니다"처럼 실제 제약을 설명한 문장도 '단점'이라는 단어가 없으면
  // 누락으로 보았다. 다른 실패가 없고 이 단일 오탐만 남은 저장 초안은 현재
  // 판정 의미에 맞게 복구해 다시 생성하지 않아도 승인할 수 있게 한다.
  if (
    parsed.version === "brand-post-package/v2" &&
    parsed.connectKind === "SHOPPING" &&
    parsed.contentQuality &&
    !parsed.contentQuality.canPublish &&
    parsed.contentQuality.code === "missing-review-substance" &&
    parsed.contentQuality.reason?.trim() === "상품 고유 리뷰 요소가 부족합니다: 제품 자체의 단점·제약"
  ) {
    const corpus = parsed.composition.sections
      .map((section) => `${section.title}\n${section.body.join("\n")}`)
      .join("\n");
    const otherFailures = parsed.contentQuality.signals.filter(
      (signal) => signal.key !== "review-substance" && signal.status === "fail",
    );
    if (hasProductLimitationLanguage(corpus) && otherFailures.length === 0) {
      const signals = parsed.contentQuality.signals.map((signal) =>
        signal.key === "review-substance" ? { ...signal, status: "pass" as const } : signal,
      );
      const usefulness = parsed.contentQuality.quality?.categories.find(
        (category) => category.key === "usefulness",
      );
      const recoveredPoints = usefulness ? usefulness.maxScore - usefulness.score : 0;
      const quality = parsed.contentQuality.quality
        ? {
            ...parsed.contentQuality.quality,
            score: Math.min(100, parsed.contentQuality.quality.score + recoveredPoints),
            categories: parsed.contentQuality.quality.categories.map((category) =>
              category.key === "usefulness"
                ? { ...category, score: category.maxScore, status: "pass" as const, notes: [] }
                : category,
            ),
          }
        : undefined;
      const score = quality?.score ?? parsed.contentQuality.score;
      parsed = {
        ...parsed,
        contentQuality: {
          ...parsed.contentQuality,
          canPublish: true,
          verdict: "pass",
          code: "ok",
          reason: null,
          score,
          signals,
          summary: `커넥트 글 발행 게이트 통과 (품질 ${score}점, 신호 ${signals.length}/${signals.length})`,
          ...(quality ? { quality } : {}),
        },
      };
      persistMigration();
    }
  }
  if (parsed.version === "brand-post-package/v2") {
    const reconciled = reconcileBrandPostPackageQuality(parsed);
    if (JSON.stringify(reconciled) !== JSON.stringify(parsed)) {
      parsed = reconciled;
      persistMigration();
    }
  }
  return parsed;
}

function hasUnfinishedSectionImages(manifest: BrandPostPackageManifestV2): boolean {
  // Execution metadata is optional (MCP/default-off paths omit it). The
  // section contract and actual asset provenance always determine coverage.
  return getBrandPostImageGenerationState(manifest)?.status === "running" ||
    getBrandPostImageSlots(manifest).some((slot) => slot.missing > 0 || slot.generationMissing > 0);
}

/** A dead owner is evidence of an interrupted job; age alone is not. Never writes on GET. */
export function getBrandPostImageGenerationState(manifest: BrandPostPackageManifest) {
  const state = manifest.imageGeneration;
  if (!state || state.status !== "running") return state;
  const active = (globalThis as typeof globalThis & { brandPostImageJobs?: Set<string> }).brandPostImageJobs?.has(manifest.brandLinkId);
  if (active) return state;
  if (!state.ownerPid || !Number.isInteger(state.ownerPid) || state.ownerPid < 1) return { ...state, recoveryState: "owner-unknown" as const };
  let exited = state.ownerPid === process.pid;
  if (!exited) {
    try { process.kill(state.ownerPid, 0); }
    catch (error) { exited = (error as NodeJS.ErrnoException).code === "ESRCH"; }
  }
  return exited ? { ...state, status: "incomplete" as const, recoveryState: "owner-exited" as const,
    errors: [...new Set([...state.errors, "IMAGE_OWNER_EXITED: 이전 이미지 준비 프로세스가 종료되었습니다. 저장된 결과부터 복구합니다."])] } : state;
}

function isValidPackageImage(asset: BrandPostPackageImageAsset): boolean {
  try {
    const stat = fs.statSync(asset.path);
    return stat.isFile() && stat.size > 0 && stat.size <= 24 * 1024 * 1024 &&
      /^[a-f0-9]{64}$/u.test(asset.sha256) && sha256File(asset.path) === asset.sha256;
  } catch { return false; }
}

export function getBrandPostImageSlots(manifest: BrandPostPackageManifest) {
  const assets = normalizePackageImageAssets(manifest);
  const byPath = new Map(assets.filter(isValidPackageImage).map(asset => [path.resolve(asset.path), asset]));
  return manifest.version === "brand-post-package/v2" ? manifest.composition.sections.map(section => {
    const { min: minimum, max: maximum } = sectionImageBounds(getPostCompositionContract(manifest.connectKind), section);
    const sectionAssets = [...new Set(section.imagePaths.map(file => path.resolve(file)))]
      .flatMap(file => {
        const asset = byPath.get(file);
        return asset && (!asset.sectionId || asset.sectionId === section.id) ? [{ ...asset, assetKey: asset.sha256,
          previewUrl: `/api/brandlinks/${encodeURIComponent(manifest.brandLinkId)}/draft/images?asset=${asset.sha256}` }] : [];
      });
    const originalCount = sectionAssets.filter(asset => asset.provenance === "ORIGINAL" || asset.creationMethod === "source").length;
    const generatedCount = sectionAssets.filter(asset => asset.remoteGenerated === true ||
      asset.remoteGenerated === undefined && asset.provenance === "GENERATED_BACKGROUND").length;
    const generatedMinimum = manifest.imageRequirements?.policy === "generated-required" && maximum > 0 ? minimum : 0;
    return {
      sectionId: section.id, title: section.title, intent: section.imageIntent,
      minimum, recommended: Math.min(maximum, Math.max(minimum, 1)), maximum,
      count: sectionAssets.length, missing: Math.max(0, minimum - sectionAssets.length),
      originalCount, generatedCount, generatedMinimum,
      generationMissing: Math.max(0, generatedMinimum - generatedCount), assets: sectionAssets,
    };
  }) : [];
}

/** One read-only decision used by material selection, preview and approval. */
export function evaluateBrandPostPackageReadiness(manifest: BrandPostPackageManifest) {
  const blockers: Array<{ code: string; reason: string; sectionId?: string }> = [];
  const imageGeneration = getBrandPostImageGenerationState(manifest);
  try {
    const stat = fs.statSync(manifest.markdownPath);
    if (!stat.isFile() || stat.size === 0 || stat.size > 8 * 1024 * 1024 || !fs.readFileSync(manifest.markdownPath, "utf8").trim()) throw new Error("missing");
    if (manifest.markdownSha256 && sha256File(manifest.markdownPath) !== manifest.markdownSha256) throw new Error("changed");
  } catch { blockers.push({ code: "markdown-invalid", reason: "저장 본문 파일이 없거나 검수한 본문과 일치하지 않습니다." }); }
  if (manifest.version === "brand-post-package/v2") {
    const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
    const inconsistent = manifest.title !== manifest.composition.title || manifest.composition.sections.some(section => {
      const rendered = manifest.composition.renderNodes.filter(node => (node.kind === "heading" || node.kind === "quotation" || node.kind === "paragraph") && node.sectionId === section.id)
        .map(node => "text" in node ? node.text : "").join("\n");
      return normalize(rendered) !== normalize([section.title, ...section.body].join("\n"));
    });
    if (inconsistent) blockers.push({ code: "content-render-mismatch", reason: "검수 본문과 발행할 렌더 문서가 일치하지 않습니다." });
  }
  const imageSlots = getBrandPostImageSlots(manifest);
  if (manifest.version === "brand-post-package/v2") {
    for (const section of manifest.composition.sections) {
      const expected = [...new Set(section.imagePaths.map(file => path.resolve(file)))].sort();
      const rendered = manifest.composition.renderNodes
        .filter(node => node.kind === "image" && node.sectionId === section.id)
        .map(node => node.kind === "image" ? path.resolve(node.assetPath) : "").sort();
      if (JSON.stringify(expected) !== JSON.stringify(rendered)) {
        blockers.push({ code: "image-render-mismatch", sectionId: section.id,
          reason: `이미지 · ${section.title}: 저장된 섹션 배치와 발행 이미지가 일치하지 않습니다. 이미지 배치를 복구하세요.` });
      }
    }
  }
  const assets = normalizePackageImageAssets(manifest);
  const generatedOutputUse = new Map<string, BrandPostPackageImageAsset[]>();
  for (const asset of assets) {
    const source = readProductPhotoSource(asset.path);
    if (source && !source.segmented && asset.creationMethod !== "source") blockers.push({
      code: "image-full-frame-overlay",
      sectionId: asset.sectionId || undefined,
      reason: "이미지 · 상품 전체 사각형 사진을 생성 배경 위에 카드처럼 합성한 이미지는 승인할 수 없습니다.",
    });
    if (!asset.sectionId || !(asset.remoteGenerated === true || asset.creationMethod === "source-with-generated-background" || asset.creationMethod === "remote-generated")) continue;
    const uses = generatedOutputUse.get(asset.sha256) || [];
    uses.push(asset);
    generatedOutputUse.set(asset.sha256, uses);
  }
  for (const uses of generatedOutputUse.values()) {
    if (uses.length < 2) continue;
    for (const asset of uses) blockers.push({
      code: "image-output-duplicate",
      sectionId: asset.sectionId || undefined,
      reason: "이미지 · 최종 결과가 다른 파트의 이미지와 완전히 같습니다. 슬롯별로 서로 다른 결과 이미지가 필요합니다.",
    });
  }
  const validPaths = new Set(assets.filter(isValidPackageImage).map(asset => path.resolve(asset.path)));
  if (!validPaths.has(path.resolve(manifest.heroImagePath))) blockers.push({ code: "hero-image-invalid", reason: "대표 이미지 파일이 없거나 저장된 해시와 일치하지 않습니다." });
  const composition = manifest.version === "brand-post-package/v2" ? refreshPostDocumentQuality({
    ...manifest.composition,
    sections: manifest.composition.sections.map(section => ({ ...section,
      imagePaths: imageSlots.find(slot => slot.sectionId === section.id)?.assets.map(asset => asset.path) || [],
    })),
    renderNodes: manifest.composition.renderNodes.filter(node => node.kind !== "image" || validPaths.has(path.resolve(node.assetPath))),
  }) : null;
  const editorialPassed = manifest.version === "brand-post-package/v1" ? manifest.contentQuality?.canPublish !== false : isDraftEditorialQualityPassed(manifest.contentQuality);
  const contentPassed = editorialPassed && !blockers.some(blocker => blocker.code === "markdown-invalid" || blocker.code === "content-render-mismatch");
  const contentScore = manifest.contentQuality?.quality?.score ?? manifest.contentQuality?.score ?? 0;
  const compositionPassed = !composition || composition.qualityReport.canAutoPublish;
  if (manifest.version === "brand-post-package/v2" && manifest.generationSource !== "AI") blockers.push({ code: "generation-source", reason: "AI 원고 출처가 확인되지 않았습니다." });
  if (!editorialPassed) {
    const quality = manifest.contentQuality;
    const failures = [
      ...(quality?.signals || []).filter(signal => signal.status === "fail" && signal.key !== "composition-quality").map(signal => signal.label),
      ...(quality?.quality?.categories || []).filter(category => category.status === "fail").map(category => category.label),
    ];
    blockers.push({ code: "content-quality", reason: failures.length ? `원고 · ${[...new Set(failures)].join(", ")}` : quality?.reason || quality?.summary || "원고 품질검사 결과가 없거나 통과하지 못했습니다." });
  }
  if (!compositionPassed) blockers.push(...(composition!.qualityReport.blockers.length ? composition!.qualityReport.blockers : ["구성 품질검사를 통과하지 못했습니다."]).map(reason => ({ code: "composition-quality", reason })));
  if (imageGeneration?.status === "running") blockers.push({ code: imageGeneration.recoveryState === "owner-unknown" ? "image-owner-unknown" : "images-running", reason: imageGeneration.recoveryState === "owner-unknown" ? "이전 이미지 작업의 실행 주체를 확인할 수 없습니다. 기존 생성 결과의 복구가 필요합니다." : "이미지 준비 작업이 진행 중입니다." });
  for (const slot of imageSlots) {
    if (slot.missing > 0) blockers.push({ code: "image-coverage", sectionId: slot.sectionId, reason: `이미지 · ${slot.title}: 검증된 이미지 ${slot.missing}장 필요` });
    if (slot.generationMissing > 0) blockers.push({ code: "generation-required", sectionId: slot.sectionId, reason: `이미지 · ${slot.title}: 지정된 생성 이미지 ${slot.generationMissing}장 필요` });
  }
  return { canApprove: blockers.length === 0, blockers, imageSlots, imageGeneration, contentPassed, contentScore, compositionPassed, composition };
}

export function approveBrandPostPackage(brandLinkId: string): BrandPostPackageManifest {
  const manifest = readBrandPostPackage(brandLinkId, { migrate: false });
  if (!manifest) throw new Error("승인할 고품질 초안이 없습니다.");
  const approval = evaluateBrandPostPackageReadiness(manifest);
  if (!approval.canApprove) throw new Error(approval.blockers.map(blocker => blocker.reason).join(" "));
  const approved: BrandPostPackageManifest = {
    ...manifest,
    generationSource:
      manifest.version === "brand-post-package/v1" && !manifest.generationSource
        ? "PREPARED_APPROVED"
        : manifest.generationSource,
    approvedAt: new Date().toISOString(),
  };
  return writeBrandPostPackageManifest(approved);
}

export function packagePreview(manifest: BrandPostPackageManifest) {
  const markdown = fs.existsSync(manifest.markdownPath)
    ? fs.readFileSync(manifest.markdownPath, "utf8")
    : "";
  let heroPreviewDataUrl: string | null = null;
  try {
    const stat = fs.statSync(manifest.heroImagePath);
    if (stat.isFile() && stat.size <= 8 * 1024 * 1024) {
      const extension = path.extname(manifest.heroImagePath).toLowerCase();
      const mime = extension === ".png" ? "png" : "jpeg";
      heroPreviewDataUrl = `data:image/${mime};base64,${fs.readFileSync(manifest.heroImagePath).toString("base64")}`;
    }
  } catch {
    heroPreviewDataUrl = null;
  }
  const imageAssets = normalizePackageImageAssets(manifest).map((asset) => ({
    ...asset,
    assetKey: asset.sha256,
    previewUrl: `/api/brandlinks/${encodeURIComponent(manifest.brandLinkId)}/draft/images?asset=${encodeURIComponent(asset.sha256)}`,
  }));
  const approval = evaluateBrandPostPackageReadiness(manifest);
  const imageSlots = approval.imageSlots;
  // 스펙/초안 원본은 크고(MCP 결과 900KB 제한) 화면에 필요 없어 미리보기에서는 뺀다.
  const { postSpec: _postSpec, specDraft: _specDraft, sourceSnapshot: _sourceSnapshot, ...rest } = manifest;
  void _sourceSnapshot;
  void _postSpec;
  void _specDraft;
  const sectionOutline = manifest.version === "brand-post-package/v2"
    ? manifest.composition.sections.map((section, index) => ({ index, id: section.id, title: section.title, chars: section.characterCount, images: section.imagePaths.length }))
    : null;
  const readiness: BrandPostPackageReadiness = {
    status: approval.canApprove ? "READY" as const : "BLOCKED" as const,
    score: approval.contentScore,
    summary: approval.canApprove ? "준비된 소재의 원고·이미지 검수 통과" : approval.blockers.map(blocker => blocker.reason).join(" "),
    signals: approval.blockers.map(blocker => ({ key: blocker.code, label: blocker.reason, status: "fail" as const })),
    repairTargets: approval.blockers.map(blocker => ({ sectionIndex: blocker.sectionId ? manifest.version === "brand-post-package/v2" ? manifest.composition.sections.findIndex(section => section.id === blocker.sectionId) : null : null,
      code: blocker.code, reason: blocker.reason, priority: "P0", instruction: blocker.reason })),
    generationSource: manifest.generationSource || "UNKNOWN", attempts: 1,
  };
  const imageCount = approval.composition
    ? approval.composition.renderNodes.filter(node => node.kind === "image").length
    : imageAssets.filter(isValidPackageImage).length;
  return { ...rest, imageGeneration: approval.imageGeneration, ...(approval.composition ? { composition: approval.composition } : {}), imageAssets, imageSlots, markdown, heroPreviewDataUrl, sectionOutline, readiness, approval, imageCount };
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function normalizePackageImageAssets(
  manifest: BrandPostPackageManifest,
): BrandPostPackageImageAsset[] {
  const explicit = (manifest.imageAssets || []).filter(
    (asset) => typeof asset.path === "string" && fs.existsSync(asset.path),
  );
  if (explicit.length > 0) return explicit;

  const paths = [manifest.heroImagePath, ...manifest.bodyImagePaths].filter((value) => fs.existsSync(value));
  const renderImageByPath = manifest.version === "brand-post-package/v2"
    ? new Map(
        manifest.composition.renderNodes
          .filter((node): node is Extract<(typeof manifest.composition.renderNodes)[number], { kind: "image" }> => node.kind === "image")
          .map((node) => [path.resolve(node.assetPath), node]),
      )
    : new Map<string, never>();
  return paths.map((imagePath, index) => {
    const renderImage = renderImageByPath.get(path.resolve(imagePath));
    return {
      path: path.resolve(imagePath),
      sourcePath: path.resolve(imagePath),
      sha256: sha256File(imagePath),
      role: index === 0 ? "hero" : "body",
      sectionId: renderImage?.sectionId || null,
      imageIntent: renderImage?.altText || "",
      // Legacy role/type cannot prove how an image was made. Leave unknown
      // provenance unknown instead of labelling a local hero as AI-generated.
      provenance: undefined,
    };
  });
}

export function writeBrandPostPackageManifest(
  manifest: BrandPostPackageManifest,
): BrandPostPackageManifest {
  const manifestPath = getBrandPostPackageManifestPath(manifest.brandLinkId);
  atomicWriteTextFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

function refreshStoredContentQuality(
  quality: BrandLinkContentReadiness | null | undefined,
  report: ResolvedPostDocumentV1["qualityReport"],
): BrandLinkContentReadiness | null | undefined {
  if (!quality) return quality;
  const compositionCanPublish = report.canAutoPublish;
  const signals = quality.signals.map((signal) =>
    signal.key === "composition-quality"
      ? { ...signal, status: compositionCanPublish ? ("pass" as const) : ("fail" as const) }
      : signal,
  );
  if (!signals.some((signal) => signal.key === "composition-quality")) {
    signals.push({ key: "composition-quality", label: "포스트 계약 품질", status: compositionCanPublish ? "pass" : "fail" });
  }
  const failures = signals.filter((signal) => signal.status === "fail");
  // Older image repair wrote a generic 82 over an independently passing editorial 100.
  const score = quality.quality?.score ?? quality.score;
  const blockers = (quality.blockers || []).filter((blocker) => blocker.code !== "composition-quality");
  if (!compositionCanPublish) blockers.push({
    code: "composition-quality", tier: "structure",
    reason: report.blockers.join(" ") || "현재 구성·이미지 게이트 미통과",
  });
  const existingTextFailure = !quality.canPublish && quality.code !== "ok" && quality.code !== "composition-quality";
  const qualityFailed = (quality.quality?.categories || []).some((category) => category.status === "fail") ||
    (quality.quality != null && score < quality.quality.passScore);
  if (failures.length === 0 && blockers.length === 0 && !existingTextFailure && !qualityFailed) {
    return {
      ...quality,
      canPublish: true,
      verdict: "pass",
      code: "ok",
      reason: null,
      score,
      signals,
      blockers,
      summary: `커넥트 글 발행 게이트 통과 (${score}점, 신호 ${signals.length}/${signals.length})`,
    };
  }
  const safetyBlocker = blockers.find((blocker) => blocker.tier === "safety");
  // Legacy packages may carry their ONLY text failure in code/reason. Do not
  // overwrite it with a temporary image failure and lose it on the next result.
  const qualityFailures = (quality.quality?.categories || []).filter(category => category.status === "fail");
  const categoryCode = qualityFailures.some(category => category.key === "sceneLinkage")
    ? "low-evidence-density" : qualityFailures.length ? "missing-review-substance" : "quality-score-below-threshold";
  const code = safetyBlocker?.code || (existingTextFailure ? quality.code : blockers[0]?.code) || categoryCode;
  const reason = safetyBlocker?.reason ||
    (existingTextFailure ? quality.reason : blockers[0]?.reason) ||
    (qualityFailures.length
      ? `필수 품질 조건 미충족: ${qualityFailures.map(category => `${category.label} (${category.notes.join(" ")})`).join(", ")}`
      : `${failures[0]?.label || "원고 품질"} 항목을 보강해야 합니다.`);
  return {
    ...quality,
    canPublish: false,
    verdict: blockers.length ? "blocked" : "quality",
    code,
    score,
    signals,
    blockers,
    reason,
    summary: `커넥트 글 발행 보류 (원고 품질 ${score}점, ${reason})`,
    qualityFailures,
  };
}

/** Refresh derived gates from this package, never regenerate text or infer new facts. */
export function reconcileBrandPostPackageQuality(manifest: BrandPostPackageManifestV2): BrandPostPackageManifestV2 {
  const exists = (file: string) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
  const source = manifest.postSpec ? manifest.composition : normalizeLegacyFreeformImageRules(manifest.composition);
  const composition = refreshPostDocumentQuality({
    ...source,
    sections: source.sections.map((section) => ({ ...section, imagePaths: section.imagePaths.filter(exists) })),
    renderNodes: source.renderNodes.filter((node) => node.kind !== "image" || exists(node.assetPath)),
  });
  const contentQuality = refreshStoredContentQuality(manifest.contentQuality, composition.qualityReport);
  return {
    ...manifest, composition, contentQuality,
    approvedAt: manifest.approvedAt && composition.qualityReport.canAutoPublish && contentQuality?.canPublish !== false &&
      !hasUnfinishedSectionImages({ ...manifest, composition }) ? manifest.approvedAt : null,
  };
}

function replacePath(values: string[], previousPath: string, nextPath: string): string[] {
  return values.map((value) =>
    path.resolve(value) === path.resolve(previousPath) ? nextPath : value,
  );
}

export function applyGeneratedBrandPostImage(options: {
  brandLinkId: string;
  generatedPath: string;
  sectionId?: string;
  replaceAssetKey?: string;
  provenance: NonNullable<BrandPostPackageImageAsset["provenance"]>;
  imageIntent?: string;
  slotId?: string;
  creationMethod?: BrandPostPackageImageAsset["creationMethod"];
  remoteGenerated?: boolean;
}): BrandPostPackageManifestV2 {
  const manifest = readBrandPostPackage(options.brandLinkId);
  if (!manifest || manifest.version !== "brand-post-package/v2") {
    throw new Error("이미지를 편집할 v2 초안 패키지가 없습니다.");
  }
  const sourceStat = fs.statSync(options.generatedPath);
  if (!sourceStat.isFile() || sourceStat.size < 1 || sourceStat.size > 24 * 1024 * 1024) {
    throw new Error("생성 이미지 파일 크기가 허용 범위를 벗어났습니다.");
  }
  const assets = normalizePackageImageAssets(manifest);
  const generatedHash = sha256File(options.generatedPath);
  if (assets.some((asset) => asset.sha256 === generatedHash)) {
    throw new Error("기존 이미지와 동일한 파일입니다. 같은 이미지를 여러 섹션의 생성 결과로 계산하지 않습니다.");
  }

  const extension = [".png", ".jpg", ".jpeg", ".webp"].includes(
    path.extname(options.generatedPath).toLowerCase(),
  )
    ? path.extname(options.generatedPath).toLowerCase()
    : ".png";
  const imageDir = path.join(getBrandPostPackageDir(options.brandLinkId), "images");
  fs.mkdirSync(imageDir, { recursive: true });
  const destination = path.join(imageDir, `generated-${Date.now()}-${crypto.randomUUID()}${extension}`);
  fs.copyFileSync(options.generatedPath, destination);
  copyProductPhotoSource(options.generatedPath, destination);
  const destinationPath = path.resolve(destination);
  const availablePaths = new Set(assets.map((asset) => path.resolve(asset.path)));
  let composition = {
    ...manifest.composition,
    sections: manifest.composition.sections.map((section) => ({
      ...section, imagePaths: section.imagePaths.filter((file) => availablePaths.has(path.resolve(file))),
    })),
    renderNodes: manifest.composition.renderNodes.filter((node) => node.kind !== "image" || availablePaths.has(path.resolve(node.assetPath))),
  };
  let heroImagePath = manifest.heroImagePath;
  let bodyImagePaths = manifest.bodyImagePaths.filter((file) => availablePaths.has(path.resolve(file)));
  let thumbnailSpec = manifest.thumbnailSpec;
  let nextAssets: BrandPostPackageImageAsset[];

  if (options.replaceAssetKey) {
    const existing = assets.find((asset) => asset.sha256 === options.replaceAssetKey);
    if (!existing) throw new Error("다시 만들 원본 이미지 항목을 찾을 수 없습니다.");
    const replacement: BrandPostPackageImageAsset = {
      ...existing,
      path: destinationPath,
      sourcePath: path.resolve(options.generatedPath),
      sha256: sha256File(destinationPath),
      provenance: options.provenance,
      slotId: options.slotId || existing.slotId,
      creationMethod: options.creationMethod,
      remoteGenerated: options.remoteGenerated ?? options.provenance === "GENERATED_BACKGROUND",
      imageIntent: options.imageIntent || existing.imageIntent,
    };
    nextAssets = assets.map((asset) => asset === existing ? replacement : asset);
    if (existing.role === "hero") {
      heroImagePath = destinationPath;
      thumbnailSpec = { ...thumbnailSpec, sourceImagePath: destinationPath };
    } else {
      bodyImagePaths = replacePath(bodyImagePaths, existing.path, destinationPath);
    }
    composition = {
      ...composition,
      sections: composition.sections.map((section) => ({
        ...section,
        imagePaths: replacePath(section.imagePaths, existing.path, destinationPath),
      })),
      renderNodes: composition.renderNodes.map((node) =>
        node.kind === "image" && path.resolve(node.assetPath) === path.resolve(existing.path)
          ? { ...node, assetPath: destinationPath }
          : node,
      ),
    };
  } else {
    const sectionId = options.sectionId?.trim();
    const section = composition.sections.find((candidate) => candidate.id === sectionId);
    if (!sectionId || !section) throw new Error("이미지를 추가할 본문 파트를 찾을 수 없습니다.");
    const bounds = sectionImageBounds(getPostCompositionContract(manifest.connectKind), section);
    if (section.imagePaths.length >= Math.max(1, bounds.max)) {
      throw new Error("이 파트는 권장 최대 이미지 수에 도달했습니다.");
    }
    const asset: BrandPostPackageImageAsset = {
      path: destinationPath,
      sourcePath: path.resolve(options.generatedPath),
      sha256: sha256File(destinationPath),
      role: "body",
      sectionId,
      imageIntent: options.imageIntent || section.imageIntent,
      provenance: options.provenance,
      slotId: options.slotId,
      creationMethod: options.creationMethod,
      remoteGenerated: options.remoteGenerated ?? options.provenance === "GENERATED_BACKGROUND",
    };
    nextAssets = [...assets, asset];
    bodyImagePaths = [...bodyImagePaths, destinationPath];
    const imageNode = {
      kind: "image" as const,
      assetPath: destinationPath,
      sectionId,
      role: "scene" as const,
      altText: `${section.title} - ${asset.imageIntent || section.imageIntent}`,
      layout: section.imagePaths.length > 0 ? ("sequence" as const) : ("single" as const),
      sourcePolicy: manifest.imagePolicy,
    };
    const renderNodes = [...composition.renderNodes];
    let insertionIndex = -1;
    renderNodes.forEach((node, index) => {
      if ("sectionId" in node && node.sectionId === sectionId) insertionIndex = index;
    });
    renderNodes.splice(insertionIndex >= 0 ? insertionIndex + 1 : renderNodes.length - 1, 0, imageNode);
    composition = {
      ...composition,
      sections: composition.sections.map((candidate) =>
        candidate.id === sectionId
          ? { ...candidate, imagePaths: [...candidate.imagePaths, destinationPath] }
          : candidate,
      ),
      renderNodes,
    };
  }

  composition = refreshPostDocumentQuality(composition);
  const updated: BrandPostPackageManifestV2 = {
    ...manifest,
    heroImagePath,
    bodyImagePaths,
    imageAssets: nextAssets,
    composition,
    thumbnailSpec,
    contentQuality: refreshStoredContentQuality(
      manifest.contentQuality,
      composition.qualityReport,
    ),
    approvedAt: null,
  };
  writeBrandPostPackageManifest(updated);
  return updated;
}
