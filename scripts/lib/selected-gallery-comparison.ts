import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { readProductSnapshot } from "../../src/lib/draft-context-snapshot";
import { isAllowedProductPhotoUrl } from "./product-photo-source";
import { isReviewImageUrl, isSalesPageProductImageUrl } from "./product-image-selection";
import { readHistoricalPrintSourceHints } from "./publication-image-defect-proof";

export interface SelectedGalleryComparisonImage {
  path: string;
  sha256: string;
  sourceUrl: string;
  sourceSnapshotId: string;
  receiptPath: string;
  receiptSha256: string;
}

// Discovery only: quantities must come from canonical facts. No filename can
// certify the actual pictured product or option; the reviewer reads the pixels.
function quantityTokens(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of value.normalize("NFKC").matchAll(/(?<![\p{L}\p{N}.])(\d+(?:\.\d+)?)\s*(ml|kg|mg|g|l)(?![\p{L}\p{N}])/giu)) {
    const [integer, decimal = ""] = match[1].split(".");
    const whole = integer.replace(/^0+(?=\d)/u, "");
    const fraction = decimal.replace(/0+$/u, "");
    const amount = fraction ? `${whole}.${fraction}` : whole;
    if (amount !== "0") tokens.add(`${amount}${match[2].toLowerCase()}`);
  }
  return tokens;
}

function filenameMatchesQuantity(url: string, selectedQuantities: Set<string>): boolean {
  try {
    const filename = decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "");
    return [...quantityTokens(filename)].some(token => selectedQuantities.has(token));
  } catch { return false; }
}

/** Server-owned snapshot/gallery lineage only, NEVER visual identity approval.
 * Read cached original bytes; no download, normalization or package mutation. */
export async function readSelectedGalleryComparisons(options: {
  snapshot: unknown; productId: string; sourceDirectory: string; maximum?: number;
  publicationOriginalSha256?: string;
}): Promise<SelectedGalleryComparisonImage[]> {
  const snapshot = readProductSnapshot(options.snapshot, { productId: options.productId, connectKind: "SHOPPING" });
  if (!options.productId || !snapshot || !options.sourceDirectory || !path.isAbsolute(options.sourceDirectory))
    throw new Error("SELECTED_SOURCE_CONTEXT_INVALID: 비교 근거의 저장 상품 스냅샷을 검증할 수 없습니다.");
  const gallery = Array.isArray(snapshot.product.referenceImageUrls)
    ? [...new Set(snapshot.product.referenceImageUrls.filter((url): url is string => typeof url === "string" &&
      isAllowedProductPhotoUrl(url) && isSalesPageProductImageUrl(url) && !isReviewImageUrl(url)))].slice(0, 20) : [];
  const maximum = Math.max(1, Math.min(5, Math.floor(Number.isFinite(options.maximum) ? options.maximum! : 5)));
  const product = snapshot.product;
  const selectedQuantities = new Set([product.name, product.description, ...(Array.isArray(product.features) ? product.features : [])]
    .filter((value): value is string => typeof value === "string").flatMap(value => [...quantityTokens(value)]));
  let directory: string, names: string[];
  try { directory = fs.realpathSync(options.sourceDirectory); names = fs.readdirSync(directory).filter(name => name.endsWith(".retrieval.json")).sort(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; // Legacy cache absent.
    throw new Error("SELECTED_SOURCE_CONTEXT_INVALID: 비교 근거의 원본 캐시 경로가 올바르지 않습니다.");
  }
  const candidates = new Map<string, SelectedGalleryComparisonImage[]>();
  for (const name of names) {
    try {
      const receiptPath = path.join(directory, name);
      const receiptStat = fs.statSync(receiptPath);
      if (!receiptStat.isFile() || receiptStat.size < 1 || receiptStat.size > 32 * 1024 || path.dirname(fs.realpathSync(receiptPath)) !== directory) continue;
      const receiptBytes = fs.readFileSync(receiptPath), receipt = JSON.parse(receiptBytes.toString("utf8"));
      if (receipt.version !== "product-image-retrieval/v1" || !gallery.includes(receipt.sourceUrl) ||
          typeof receipt.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(receipt.sha256) ||
          typeof receipt.retrievedAt !== "string" || !Number.isFinite(Date.parse(receipt.retrievedAt)) || Date.parse(receipt.retrievedAt) > Date.now()) continue;
      const file = path.join(directory, name.slice(0, -".retrieval.json".length)), stat = fs.statSync(file);
      if (!stat.isFile() || stat.size < 1 || stat.size > 24 * 1024 * 1024 || path.dirname(fs.realpathSync(file)) !== directory) continue;
      const sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      if (sha256 !== receipt.sha256) continue;
      const candidate = { path: file, sha256, sourceUrl: receipt.sourceUrl, sourceSnapshotId: snapshot.snapshotId,
        receiptPath, receiptSha256: crypto.createHash("sha256").update(receiptBytes).digest("hex") };
      candidates.set(receipt.sourceUrl, [...(candidates.get(receipt.sourceUrl) ?? []), candidate]);
    } catch { /* Unbound or corrupt cached bytes cannot become comparison evidence. */ }
  }
  const selected: SelectedGalleryComparisonImage[] = [], seen = new Set<string>();
  let supplementalQuantityCount = 0, supplementalOriginalCount = 0;
  for (const url of gallery) {
    const matching = candidates.get(url) ?? [];
    // Multiple different recorded originals for one URL are ambiguous; no
    // newest receipt or filename guess can identify the frozen source pixels.
    if (new Set(matching.map(candidate => candidate.sha256)).size !== 1) continue;
    const candidate = matching[0];
    const quantityContext = supplementalQuantityCount < 2 && filenameMatchesQuantity(url, selectedQuantities);
    const originalContext = supplementalOriginalCount === 0 && candidate.sha256 === options.publicationOriginalSha256;
    // Two static originals, two quantity-discovered contexts, and at most one
    // exact publication ORIGINAL from the same canonical gallery. Matching
    // source bytes establish lineage only, never visual identity approval.
    if (selected.length >= 2 && !quantityContext && !originalContext) continue;
    if (!seen.has(candidate.sha256)) {
      // Optional gallery discovery must not promote animated or broken cache
      // entries into declared evidence and then block an unrelated final photo.
      // Decode all pages to distinguish a static image from a first-frame read;
      // never extract an animation frame or repair source bytes here.
      try {
        const bytes = fs.readFileSync(candidate.path);
        if (crypto.createHash("sha256").update(bytes).digest("hex") !== candidate.sha256) continue;
        const metadata = await sharp(bytes, { animated: true, failOn: "warning" }).metadata();
        if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1 ||
            !["jpeg", "png", "webp", "gif"].includes(metadata.format ?? "")) continue;
        await sharp(bytes, { animated: true, failOn: "warning" }).rotate().png().toBuffer();
        if (crypto.createHash("sha256").update(fs.readFileSync(candidate.path)).digest("hex") !== candidate.sha256 ||
            crypto.createHash("sha256").update(fs.readFileSync(candidate.receiptPath)).digest("hex") !== candidate.receiptSha256) continue;
        if (selected.length >= 2) {
          if (quantityContext) supplementalQuantityCount++;
          else supplementalOriginalCount++;
        }
        selected.push(candidate); seen.add(candidate.sha256);
      } catch { /* An optional undecodable original is not comparison evidence. */ }
    }
    if (selected.length >= maximum) break;
  }
  // Fill only a spare comparison slot, after every existing priority. Geometry
  // discovers one bounded detail candidate; it cannot certify a catalog, SKU,
  // included component or quantity. Very long seller documents are not readable
  // single-image context. Existing references must never be displaced by this.
  if (selected.length < maximum) {
    const details: Array<{ candidate: SelectedGalleryComparisonImage; aspect: number }> = [];
    for (const url of gallery) {
      const matching = candidates.get(url) ?? [];
      if (new Set(matching.map(candidate => candidate.sha256)).size !== 1) continue;
      const candidate = matching[0];
      if (seen.has(candidate.sha256)) continue;
      try {
        const bytes = fs.readFileSync(candidate.path);
        if (crypto.createHash("sha256").update(bytes).digest("hex") !== candidate.sha256) continue;
        const metadata = await sharp(bytes, { animated: true, failOn: "warning" }).metadata();
        if (!metadata.width || !metadata.height || metadata.height <= metadata.width || metadata.height > 4096 ||
            (metadata.pages ?? 1) !== 1 || !["jpeg", "png", "webp", "gif"].includes(metadata.format ?? "")) continue;
        details.push({ candidate, aspect: metadata.height / metadata.width });
      } catch { /* Unreadable optional details are not comparison evidence. */ }
    }
    // Stable sort retains canonical gallery order for equal aspect ratios.
    details.sort((a, b) => b.aspect - a.aspect);
    for (const { candidate } of details) {
      try {
        const bytes = fs.readFileSync(candidate.path);
        if (crypto.createHash("sha256").update(bytes).digest("hex") !== candidate.sha256) continue;
        const decoded = await sharp(bytes, { animated: true, failOn: "warning" }).rotate().png().toBuffer();
        // An optional detail alone must fit the unchanged final-audit transport
        // ceiling. The audit still enforces its full per-request byte budget.
        if (decoded.length > 8 * 1024 * 1024 ||
            crypto.createHash("sha256").update(fs.readFileSync(candidate.path)).digest("hex") !== candidate.sha256 ||
            crypto.createHash("sha256").update(fs.readFileSync(candidate.receiptPath)).digest("hex") !== candidate.receiptSha256) continue;
        selected.push(candidate); seen.add(candidate.sha256);
        break;
      } catch { /* A broken detail cannot hide the next usable bounded detail. */ }
    }
  }
  // Do not return a stale earlier binding if its files changed while a later
  // optional gallery candidate was being decoded.
  return selected.filter(candidate => {
    try {
      return crypto.createHash("sha256").update(fs.readFileSync(candidate.path)).digest("hex") === candidate.sha256 &&
        crypto.createHash("sha256").update(fs.readFileSync(candidate.receiptPath)).digest("hex") === candidate.receiptSha256;
    } catch { return false; }
  });
}

const sha256 = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function exactStaticFile(file: unknown, expected: string): file is string {
  try {
    if (typeof file !== "string" || !path.isAbsolute(file)) return false;
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 24 * 1024 * 1024 &&
      sha256(fs.readFileSync(file)) === expected;
  } catch { return false; }
}

/** Reuse only the scene's input hashes as discovery hints, never its words,
 * verdict, warning or native authority. Every returned path must subsequently
 * resolve to CURRENT canonical gallery bytes and a current retrieval receipt. */
function boundSceneSourceHints(manifest: Record<string, unknown>, options: {
  snapshot: unknown; candidateSha256: string; sourceDirectory: string;
  primaryReference: { path: string; sha256: string };
}, snapshotId: string): Array<{ path: string; sha256: string }> {
  try {
    if (JSON.stringify(manifest.sourceSnapshot) !== JSON.stringify(options.snapshot) || !Array.isArray(manifest.imageAssets)) return [];
    const assets = manifest.imageAssets.map(record).filter(asset => asset?.sha256 === options.candidateSha256);
    if (assets.length !== 1) return [];
    const asset = assets[0]!, scene = record(asset.referenceScene), warning = record(scene?.printObservationWarning);
    const input = record(warning?.input), result = record(warning?.result), context = record(result?.context);
    const primary = record(input?.primaryReference), gate = record(input?.scopeGate), request = record(gate?.request);
    if (asset.role !== "body" || asset.provenance !== "GENERATED_SCENE" || asset.creationMethod !== "reference-guided-scene" || asset.remoteGenerated !== true ||
        !scene || scene.reviewStatus !== "passed" || scene.reviewedOutputSha256 !== options.candidateSha256 || scene.sourceSnapshotId !== snapshotId ||
        scene.referenceSha256 !== options.primaryReference.sha256 || scene.referencePath !== options.primaryReference.path ||
        !input || input.candidateSha256 !== options.candidateSha256 || !primary || primary.sha256 !== options.primaryReference.sha256 ||
        primary.path !== options.primaryReference.path || !exactStaticFile(asset.path, options.candidateSha256) ||
        !exactStaticFile(input.candidatePath, options.candidateSha256) || !exactStaticFile(primary.path, options.primaryReference.sha256) ||
        !context || context.candidateSha256 !== options.candidateSha256 || context.primaryReferenceSha256 !== primary.sha256 ||
        context.primaryReferenceImageIndex !== 2 || !gate || gate.kind !== "scene-native-positive/v1" || gate.nativeExecution !== true ||
        !request || gate.requestSha256 !== sha256(JSON.stringify(request)) || typeof gate.rawResponse !== "string" ||
        gate.responseSha256 !== sha256(gate.rawResponse) || context.scopeGateSha256 !== sha256(JSON.stringify(gate)) ||
        !Array.isArray(input.canonicalReferences) || input.canonicalReferences.length < 1 || input.canonicalReferences.length > 5) return [];
    const relative = path.relative(fs.realpathSync(path.dirname(options.sourceDirectory)), fs.realpathSync(asset.path));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return [];
    const sources = input.canonicalReferences.map(record);
    if (sources.some(source => !source || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(source.sha256) ||
        source.sourceSnapshotId !== snapshotId || !exactStaticFile(source.path, source.sha256)) ||
        new Set(sources.map(source => source!.sha256)).size !== sources.length ||
        !sources.some(source => source!.sha256 === primary.sha256 && source!.path === primary.path)) return [];
    const ordered = [sources.find(source => source!.sha256 === primary.sha256)!, ...sources.filter(source => source!.sha256 !== primary.sha256)];
    if (JSON.stringify(context.references) !== JSON.stringify(ordered.map((source, index) => ({ imageIndex: index + 2,
      sha256: source!.sha256, sourceSnapshotId: snapshotId }))) ||
        JSON.stringify(request.imagePaths) !== JSON.stringify([primary.sha256, options.candidateSha256,
          ...ordered.slice(1).map(source => source!.sha256)])) return [];
    return ordered.slice(1).map(source => ({ path: source!.path as string, sha256: source!.sha256 as string }));
  } catch { return []; }
}

/** Preserve the slot's independently bound canonical primary even when the
 * optional comparison shortlist omitted it. This is receipt/byte lineage only;
 * no pixel verdict, literal certification or repair authority is created. */
export async function readPublicationIdentifierReferenceBindings(options: {
  snapshot: unknown; productId: string; sourceDirectory: string;
  candidateSha256?: string;
  publicationOriginalSha256?: string; primaryReference: { path: string; sha256: string };
}): Promise<SelectedGalleryComparisonImage[]> {
  const base = await readSelectedGalleryComparisons(options);
  const primary = options.primaryReference;
  if (!primary || !/^[a-f0-9]{64}$/u.test(primary.sha256) || !path.isAbsolute(primary.path))
    throw new Error("SELECTED_SOURCE_CONTEXT_INVALID: 본문 사진의 고정 원본 연결이 유효하지 않습니다.");
  const stat = fs.statSync(primary.path);
  if (!stat.isFile() || stat.size < 1 || stat.size > 24 * 1024 * 1024 ||
      crypto.createHash("sha256").update(fs.readFileSync(primary.path)).digest("hex") !== primary.sha256)
    throw new Error("SELECTED_SOURCE_CONTEXT_INVALID: 본문 사진의 고정 원본 바이트가 변경되었습니다.");
  const own = base.find(reference => reference.sha256 === primary.sha256) ??
    (await readSelectedGalleryComparisons({ ...options, publicationOriginalSha256: primary.sha256 }))
      .find(reference => reference.sha256 === primary.sha256);
  // An unreceipted primary remains unreceipted. Never infer its snapshot from
  // another source's ID or manufacture canonical membership from scene metadata.
  if (!own) return base;
  if (crypto.createHash("sha256").update(fs.readFileSync(primary.path)).digest("hex") !== primary.sha256 ||
      crypto.createHash("sha256").update(fs.readFileSync(own.path)).digest("hex") !== own.sha256 ||
      crypto.createHash("sha256").update(fs.readFileSync(own.receiptPath)).digest("hex") !== own.receiptSha256)
    throw new Error("SELECTED_SOURCE_CONTEXT_INVALID: 본문 사진 원본의 수집 증거가 변경되었습니다.");
  // The primary was already attached/observed separately. Keep every existing
  // optional reference when space permits; only the final optional item yields
  // to the exact own primary at the unchanged five-reference ceiling.
  const retained = base.filter(reference => reference.sha256 !== own.sha256).slice(0, 4);
  const discovered = new Set<string>();
  let discoveryStillBound = () => true;
  if (retained.length < 4 && options.candidateSha256) {
    try {
      const manifestPath = path.join(options.sourceDirectory, "..", "manifest.json"), stat = fs.lstatSync(manifestPath);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4 * 1024 * 1024) {
        const manifestBytes = fs.readFileSync(manifestPath), manifest = JSON.parse(manifestBytes.toString("utf8"));
        if (manifest.brandLinkId === options.productId && manifest.sourceSnapshot?.snapshotId === own.sourceSnapshotId) {
          const sceneOptions = { snapshot: options.snapshot, candidateSha256: options.candidateSha256,
            sourceDirectory: options.sourceDirectory, primaryReference: primary };
          const sceneHints = boundSceneSourceHints(manifest, sceneOptions, own.sourceSnapshotId);
          discoveryStillBound = () => fs.readFileSync(manifestPath).equals(manifestBytes) &&
            JSON.stringify(boundSceneSourceHints(manifest, sceneOptions, own.sourceSnapshotId)) === JSON.stringify(sceneHints);
          for (const hint of sceneHints) {
            if (retained.length >= 4) break;
            if (hint.sha256 === own.sha256 || retained.some(reference => reference.sha256 === hint.sha256)) continue;
            const candidate = (await readSelectedGalleryComparisons({ ...options, publicationOriginalSha256: hint.sha256 }))
              .find(reference => reference.sha256 === hint.sha256 && path.resolve(reference.path) === path.resolve(hint.path));
            if (candidate && discoveryStillBound()) { retained.push(candidate); discovered.add(candidate.sha256); }
          }
          for (const hint of readHistoricalPrintSourceHints(manifest, options.candidateSha256, own.sha256)) {
            if (retained.length >= 4) break;
            if (hint === own.sha256 || retained.some(reference => reference.sha256 === hint)) continue;
            // Resolve through the current gallery, bytes and retrieval receipt;
            // the historical path, transcription and verdict are never reused.
            const candidate = (await readSelectedGalleryComparisons({ ...options, publicationOriginalSha256: hint }))
              .find(reference => reference.sha256 === hint);
            if (candidate) { retained.push(candidate); discovered.add(candidate.sha256); break; }
          }
        }
      }
    } catch { /* Historical hints are optional, not evidence or authority. */ }
  }
  let discoveryCurrent = false;
  try { discoveryCurrent = discoveryStillBound(); } catch { /* Changed or missing optional discovery inputs cannot survive an await. */ }
  if (!exactStaticFile(primary.path, primary.sha256))
    throw new Error("SELECTED_SOURCE_CONTEXT_INVALID: 본문 사진 원본이 비교 근거 조회 중 변경되었습니다.");
  return [...retained, own].filter(reference => (!discovered.has(reference.sha256) || discoveryCurrent) &&
    exactStaticFile(reference.path, reference.sha256) && exactStaticFile(reference.receiptPath, reference.receiptSha256));
}
