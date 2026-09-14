import crypto from "node:crypto";
import path from "node:path";
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

function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

function imageNodeFor(
  section: ResolvedPostSectionV1,
  assetPath: string,
  ordinal: number,
  previousNodes: PostRenderNode[],
  sourcePolicy: BrandPostPackageManifestV2["imagePolicy"],
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
  const previousHero = previousAssets.get(path.resolve(previous.heroImagePath));
  if (previousHero) chosenAssets.set(path.resolve(previousHero.path), previousHero);

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
      return !allPreviousPaths.has(resolved);
    });
    const imagePaths = uniquePaths(sameIntent ? prior.imagePaths : nextPaths);
    for (const imagePath of imagePaths) {
      const resolved = path.resolve(imagePath);
      const asset = previousAssets.get(resolved) || nextAssets.get(resolved);
      if (asset) chosenAssets.set(resolved, {
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
    if (!asset.sectionId && asset.role !== "hero") chosenAssets.set(path.resolve(asset.path), asset);
  }
  for (const asset of next.imageAssets || []) {
    if (!asset.sectionId && asset.role !== "hero" && !chosenAssets.has(path.resolve(asset.path))) {
      chosenAssets.set(path.resolve(asset.path), asset);
    }
  }

  const heroImagePath = previousHero ? previous.heroImagePath : next.heroImagePath;
  const baseNodes = next.composition.renderNodes.flatMap((node): PostRenderNode[] => {
    if (node.kind !== "image") return [node];
    if (node.sectionId !== null) return [];
    return [{ ...node, assetPath: heroImagePath }];
  });
  const renderNodes = [...baseNodes];
  for (const section of sections) {
    const nodes = section.imagePaths.map((assetPath, index) =>
      imageNodeFor(section, assetPath, index, previous.composition.renderNodes, next.imagePolicy));
    if (!nodes.length) continue;
    let insertAt = -1;
    renderNodes.forEach((node, index) => {
      if ("sectionId" in node && node.sectionId === section.id) insertAt = index;
    });
    renderNodes.splice(insertAt >= 0 ? insertAt + 1 : renderNodes.length, 0, ...nodes);
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
  if (imageGeneration && !allVisualIntentsPreserved) {
    const generatedRequired = (previous.imageRequirements || next.imageRequirements)?.policy === "generated-required";
    const generatedPaths = new Set(imageAssets.filter(asset =>
      asset.remoteGenerated === true || asset.creationMethod === "remote-generated" ||
      asset.creationMethod === "source-with-generated-background",
    ).map(asset => path.resolve(asset.path)));
    const requested = generatedRequired
      ? sections.reduce((sum, section) => sum + Math.max(0, section.imageMin || 0), 0)
      : imageGeneration.requested;
    const applied = generatedRequired
      ? sections.reduce((sum, section) => sum + Math.min(Math.max(0, section.imageMin || 0),
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
