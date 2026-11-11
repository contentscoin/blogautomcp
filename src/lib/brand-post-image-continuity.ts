import crypto from "node:crypto";
import path from "node:path";
import { classifyBrandPostImageEvidence, isReferenceGuidedScene, REFERENCE_SCENE_CAPTION } from "./brand-post-image-evidence";
import { brandPostReferenceSceneIssue } from "./brand-post-package";
import { refreshPostDocumentQuality, type PostRenderNode, type ResolvedPostSectionV1 } from "./post-composition-contract";
import type {
  BrandPostPackageImageAsset,
  BrandPostPackageManifestV2,
} from "./brand-post-package";

function normalizeIntent(value: string | undefined): string {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function brandPostVisualIntentFingerprint(value: string | undefined): string {
  return crypto.createHash("sha256").update(normalizeIntent(value)).digest("hex");
}

function assetMap(manifest: BrandPostPackageManifestV2): Map<string, BrandPostPackageImageAsset> {
  return new Map((manifest.imageAssets || []).map(asset => [path.resolve(asset.path), asset]));
}

function assetIdentity(asset: BrandPostPackageImageAsset): string {
  return asset.sha256 ? `sha256:${asset.sha256}` : `path:${path.resolve(asset.path)}`;
}

function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((file, index) => path.resolve(file) === path.resolve(right[index]));
}

function sameAssetBinding(left: BrandPostPackageImageAsset, right: BrandPostPackageImageAsset): boolean {
  return Boolean(left.sha256) && left.sha256 === right.sha256 && left.role === right.role &&
    (left.sectionId ?? null) === (right.sectionId ?? null) && left.slotId === right.slotId &&
    (left.role === "hero" || normalizeIntent(left.imageIntent) === normalizeIntent(right.imageIntent)) &&
    left.provenance === right.provenance && left.creationMethod === right.creationMethod &&
    left.remoteGenerated === right.remoteGenerated;
}

function renderLayoutSignature(nodes: PostRenderNode[]): string {
  return JSON.stringify(nodes.map(node => {
    if (node.kind === "paragraph" || node.kind === "heading" || node.kind === "quotation") {
      return { kind: node.kind, sectionId: node.sectionId };
    }
    return node.kind === "image" ? { ...node, assetPath: path.resolve(node.assetPath) } : node;
  }));
}

function imageNodeFor(
  section: ResolvedPostSectionV1,
  assetPath: string,
  ordinal: number,
  previousNodes: PostRenderNode[],
  sourcePolicy: BrandPostPackageManifestV2["imagePolicy"],
  caption?: string,
): Extract<PostRenderNode, { kind: "image" }> {
  const previous = previousNodes.find(node => node.kind === "image" && path.resolve(node.assetPath) === path.resolve(assetPath));
  return {
    kind: "image",
    assetPath,
    sectionId: section.id,
    role: previous?.kind === "image" && previous.role !== "thumbnail" && previous.role !== "hero"
      ? previous.role
      : ordinal === 0 ? "detail" : "scene",
    altText: `${section.title} - ${section.imageIntent}`,
    layout: section.imagePaths.length > 1 ? "sequence" : "single",
    sourcePolicy,
    ...(caption ? { caption } : {}),
  };
}

/**
 * Carries image assets across a text revision without carrying stale bindings.
 * Exact visual intent is the boundary: title/body/createdAt are editorial data;
 * a changed intent invalidates only that section's old images.
 */
export function reconcileBrandPostImageContinuity(
  previous: BrandPostPackageManifestV2,
  next: BrandPostPackageManifestV2,
): BrandPostPackageManifestV2 {
  if (previous.brandLinkId !== next.brandLinkId || previous.connectKind !== next.connectKind) return next;

  const previousAssets = assetMap(previous);
  const nextAssets = assetMap(next);
  const usedPreviousSections = new Set<string>();
  const allPreviousPaths = new Set((previous.imageAssets || []).map(asset => path.resolve(asset.path)));
  const chosenAssets = new Map<string, BrandPostPackageImageAsset>();
  const chooseAsset = (asset: BrandPostPackageImageAsset) => {
    const identity = assetIdentity(asset);
    if (!chosenAssets.has(identity)) chosenAssets.set(identity, asset);
  };
  const hasAsset = (asset: BrandPostPackageImageAsset) => chosenAssets.has(assetIdentity(asset));
  const previousHero = previousAssets.get(path.resolve(previous.heroImagePath));
  const sameProductFacts = previous.sourceSnapshot?.snapshotId === next.sourceSnapshot?.snapshotId;
  const reusableScene = (asset: BrandPostPackageImageAsset) => !isReferenceGuidedScene(asset) ||
    (sameProductFacts && brandPostReferenceSceneIssue(next, asset) === null);
  const reusableBodyPhoto = (asset: BrandPostPackageImageAsset | undefined, section: ResolvedPostSectionV1) => {
    if (next.connectKind !== "SHOPPING") return !asset || reusableScene(asset);
    if (!asset || !reusableScene(asset)) return false;
    if (isReferenceGuidedScene(asset)) return section.imageSource !== "seller-original" && section.imageSource !== "seller-crop" && section.imageSource !== "editorial-card";
    return asset.provenance === "ORIGINAL" && asset.creationMethod === "source" && section.imageSource !== "staged-ai";
  };
  const preservePreviousHero = previousHero && reusableScene(previousHero) &&
    (next.connectKind !== "SHOPPING" || previousHero.provenance === "PHOTO_TEXT_THUMBNAIL");
  const selectedHero = preservePreviousHero ? previousHero : nextAssets.get(path.resolve(next.heroImagePath)) || previousHero;
  if (selectedHero) chooseAsset(selectedHero);

  const sectionMatches = next.composition.sections.map((section, index) => {
    const byId = previous.composition.sections.find(candidate => candidate.id === section.id);
    if (byId) {
      usedPreviousSections.add(byId.id);
      return byId;
    }
    const fingerprint = brandPostVisualIntentFingerprint(section.imageIntent);
    const byIntent = previous.composition.sections.find(candidate =>
      !usedPreviousSections.has(candidate.id) &&
      brandPostVisualIntentFingerprint(candidate.imageIntent) === fingerprint,
    );
    const fallback = byIntent || previous.composition.sections[index];
    if (fallback) usedPreviousSections.add(fallback.id);
    return fallback;
  });

  const sections = next.composition.sections.map((section, index) => {
    const prior = sectionMatches[index];
    const sameIntent = prior && brandPostVisualIntentFingerprint(prior.imageIntent) ===
      brandPostVisualIntentFingerprint(section.imageIntent);
    const nextPaths = section.imagePaths.filter(file => {
      const resolved = path.resolve(file);
      // A path already present in the old package is stale when its intent
      // changed. A truly new reviewed image remains eligible.
      return !allPreviousPaths.has(resolved) && reusableBodyPhoto(nextAssets.get(resolved), section);
    });
    const preservedPaths = sameIntent ? prior.imagePaths.filter(file => {
      const asset = previousAssets.get(path.resolve(file));
      return reusableBodyPhoto(asset, section);
    }) : [];
    const imagePaths = uniquePaths(preservedPaths.length ? preservedPaths : nextPaths);
    for (const imagePath of imagePaths) {
      const resolved = path.resolve(imagePath);
      const asset = previousAssets.get(resolved) || nextAssets.get(resolved);
      if (asset) chooseAsset({
        ...asset,
        sectionId: section.id,
        imageIntent: section.imageIntent,
      });
    }
    return { ...section, imagePaths };
  });

  // Retain package-local, unbound source candidates. They are useful for a
  // later targeted repair but never count as section coverage.
  for (const asset of previous.imageAssets || []) {
    if (!asset.sectionId && asset.role !== "hero") chooseAsset(asset);
  }
  for (const asset of next.imageAssets || []) {
    if (!asset.sectionId && asset.role !== "hero" && !hasAsset(asset)) {
      chooseAsset(asset);
    }
  }

  const heroImagePath = preservePreviousHero ? previous.heroImagePath : next.heroImagePath;
  const chosenByPath = new Map([...chosenAssets.values()].map(asset => [path.resolve(asset.path), asset]));
  const activeBindings = [
    { file: heroImagePath, sectionId: null },
    ...sections.flatMap(section => section.imagePaths.map(file => ({ file, sectionId: section.id }))),
  ];
  const renderImages = next.composition.renderNodes.filter(node => node.kind === "image");
  // A text revision already has its saved render plan. Preserve it only after
  // the normal eligibility filters chose exactly the same reviewed bindings.
  // Missing notices, stale reviews and real slot changes still use rebinding.
  const preserveRenderPlan = Boolean(previous.sourceSnapshot?.snapshotId) && sameProductFacts &&
    Boolean(preservePreviousHero) && previous.imagePolicy === next.imagePolicy &&
    samePaths([previous.heroImagePath, next.heroImagePath], [heroImagePath, heroImagePath]) &&
    renderLayoutSignature(previous.composition.renderNodes) === renderLayoutSignature(next.composition.renderNodes) &&
    previous.composition.sections.length === sections.length &&
    sections.every((section, index) => {
      const prior = previous.composition.sections[index];
      const requested = next.composition.sections[index];
      return prior.id === section.id && prior.imageSource === section.imageSource &&
        prior.imagePlacement === section.imagePlacement && prior.imageMin === section.imageMin && prior.imageMax === section.imageMax &&
        brandPostVisualIntentFingerprint(prior.imageIntent) === brandPostVisualIntentFingerprint(section.imageIntent) &&
        samePaths(prior.imagePaths, section.imagePaths) && samePaths(requested.imagePaths, section.imagePaths);
    }) && renderImages.length === activeBindings.length &&
    new Set(activeBindings.map(binding => path.resolve(binding.file))).size === activeBindings.length &&
    activeBindings.every(({ file, sectionId }) => {
      const resolved = path.resolve(file);
      const prior = previousAssets.get(resolved);
      const requested = nextAssets.get(resolved);
      const chosen = chosenByPath.get(resolved);
      if (!prior || !requested || !chosen || !sameAssetBinding(prior, chosen) || !sameAssetBinding(requested, chosen) ||
          (chosen.sectionId ?? null) !== sectionId || brandPostReferenceSceneIssue(next, requested) !== null) return false;
      const nodes = renderImages.filter(node => path.resolve(node.assetPath) === resolved);
      const priorNodes = previous.composition.renderNodes.filter(node => node.kind === "image" && path.resolve(node.assetPath) === resolved);
      return nodes.length === 1 && nodes[0].sectionId === sectionId && nodes[0].sourcePolicy === next.imagePolicy &&
        priorNodes.length === 1 && priorNodes[0].kind === "image" && priorNodes[0].sectionId === sectionId &&
        priorNodes[0].caption === nodes[0].caption && priorNodes[0].role === nodes[0].role &&
        priorNodes[0].layout === nodes[0].layout && priorNodes[0].sourcePolicy === nodes[0].sourcePolicy &&
        (sectionId === null ? nodes[0].role === "hero" || nodes[0].role === "thumbnail" : nodes[0].role !== "hero" && nodes[0].role !== "thumbnail") &&
        (!isReferenceGuidedScene(chosen) || Boolean(nodes[0].caption?.includes("상품 원본을 참조한 AI 연출 이미지")));
    });
  const renderNodes = preserveRenderPlan ? [...next.composition.renderNodes] : next.composition.renderNodes.flatMap((node): PostRenderNode[] => {
    if (node.kind !== "image") return [node];
    if (node.sectionId !== null) return [];
    return [{ ...node, assetPath: heroImagePath, caption: selectedHero && isReferenceGuidedScene(selectedHero) ? REFERENCE_SCENE_CAPTION : undefined }];
  });
  if (!preserveRenderPlan) {
    for (const section of sections) {
      const nodes = section.imagePaths.map((assetPath, index) =>
        imageNodeFor(section, assetPath, index, previous.composition.renderNodes, next.imagePolicy,
          isReferenceGuidedScene(previousAssets.get(path.resolve(assetPath)) || nextAssets.get(path.resolve(assetPath)) || {}) ? REFERENCE_SCENE_CAPTION : undefined));
      if (!nodes.length) continue;
      let insertAt = -1;
      renderNodes.forEach((node, index) => {
        if ("sectionId" in node && node.sectionId === section.id) insertAt = index;
      });
      renderNodes.splice(insertAt >= 0 ? insertAt + 1 : renderNodes.length, 0, ...nodes);
    }
  }

  const composition = refreshPostDocumentQuality({ ...next.composition, sections, renderNodes });
  const activePaths = new Set([
    path.resolve(heroImagePath),
    ...sections.flatMap(section => section.imagePaths.map(file => path.resolve(file))),
  ]);
  const imageAssets = [...chosenAssets.values()].filter(asset =>
    activePaths.has(path.resolve(asset.path)) || !asset.sectionId,
  );
  const bodyImagePaths = uniquePaths([
    ...sections.flatMap(section => section.imagePaths),
    ...imageAssets.filter(asset => asset.role !== "hero" && !asset.sectionId).map(asset => asset.path),
  ]);

  const allVisualIntentsPreserved = next.composition.sections.every((section, index) => {
    const prior = sectionMatches[index];
    return Boolean(prior) && brandPostVisualIntentFingerprint(prior!.imageIntent) ===
      brandPostVisualIntentFingerprint(section.imageIntent);
  });
  let imageGeneration = previous.imageGeneration;
  const slotCoverageChanged = sections.some((section, index) => section.imagePaths.length !== sectionMatches[index]?.imagePaths.length);
  if (imageGeneration && (!allVisualIntentsPreserved || !sameProductFacts || slotCoverageChanged)) {
    const generatedRequired = (previous.imageRequirements || next.imageRequirements)?.policy === "generated-required";
    const generatedPaths = new Set(imageAssets.filter(asset => {
      const evidence = classifyBrandPostImageEvidence(asset);
      return evidence.coherent && evidence.generated && reusableScene(asset);
    }).map(asset => path.resolve(asset.path)));
    const generatedSections = next.connectKind === "SHOPPING"
      ? sections.filter(section => section.imageSource === "staged-ai") : sections;
    const requested = generatedRequired
      ? generatedSections.reduce((sum, section) => sum + Math.max(0, section.imageMin || 0), 0)
      : imageGeneration.requested;
    const applied = generatedRequired
      ? generatedSections.reduce((sum, section) => sum + Math.min(Math.max(0, section.imageMin || 0),
          section.imagePaths.filter(file => generatedPaths.has(path.resolve(file))).length), 0)
      : Math.min(imageGeneration.applied, imageAssets.length);
    const remaining = Math.max(0, requested - applied);
    imageGeneration = {
      ...imageGeneration,
      status: remaining === 0 ? "complete" : "incomplete",
      requested,
      applied,
      remaining,
      errors: [],
      updatedAt: new Date().toISOString(),
      ownerPid: undefined,
      ownerToken: undefined,
      heartbeatAt: undefined,
      recoveryState: undefined,
    };
  }

  return {
    ...next,
    createdAt: previous.createdAt,
    approvedAt: null,
    heroImagePath,
    bodyImagePaths,
    imageAssets,
    imageRequirements: previous.imageRequirements || next.imageRequirements,
    imageGeneration,
    composition,
    thumbnailSpec: { ...next.thumbnailSpec, sourceImagePath: heroImagePath },
  };
}
