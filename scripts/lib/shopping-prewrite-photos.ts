import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readProductSnapshot, type ProductSnapshot } from "../../src/lib/draft-context-snapshot";
import { buildProduct9Canvas, selectedProductContextFrom9Canvas } from "./product-9canvas";
import { selectVerifiedProductSectionImages, type ProductSectionImageAssignment, type ProductSectionImageDiagnostics } from "./product-photo-review";
import type { WritingPublicationPhotoContext } from "./writing-prompt-contract";
import { SHOPPING_NATURAL_SCENE_ROLES } from "./shopping-scene-roles";

export interface ShoppingPrewritePhotoProof {
  version: "shopping-prewrite-photo-proof/v1";
  snapshot: ProductSnapshot;
  selectedProductContext: string;
  original: { path: string; sha256: string; observedSubject: string };
  /** This proves visible exterior suitability; it does not certify every hidden SKU specification or a complete purchased kit. */
  scope: "selected-product-exterior";
}

type Select = (paths: string[], productName: string, selectedProduct: string) => Promise<ProductSectionImageAssignment | null>;
export interface ShoppingPrewritePhotoDependencies {
  select: Select;
  /** Optional deterministic crop of actual seller pixels. It must not generate/edit a product or scene with imagegen. */
  recoverSourcePixels?: () => Promise<string | null>;
}

function sameLocalPath(left: string, right: string): boolean {
  const a = path.resolve(left), b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function selectShoppingPrewriteOriginal(paths: string[], productName: string, selectedProduct: string,
  review: typeof selectVerifiedProductSectionImages = selectVerifiedProductSectionImages): Promise<ProductSectionImageAssignment | null> {
  let diagnostics: ProductSectionImageDiagnostics | undefined;
  let assignments: ProductSectionImageAssignment[];
  try {
    assignments = await review(paths, productName, [{
      sectionId: "prewriting-original", sectionTitle: "선택 상품 외형",
      imageIntent: "선택 상품 외형 확인용 실제 판매자 원본 사진", imageSource: "seller-original", sectionBody: [],
    }], { selectedProduct, onDiagnostics: report => { diagnostics = report; } });
  } catch (error) {
    // Preserve explicit provider/auth/transport errors. An undecodable review
    // response is neither a pixel rejection nor proof that no source exists.
    const message = error instanceof Error ? error.message : String(error);
    if ((error as { code?: string })?.code || /\b(?:CODEX_[A-Z_]+|CHATGPT_BROWSER_[A-Z_]+)\b/u.test(message) || diagnostics?.status !== "failed") throw error;
    if (/\bIMAGE_CHANGED\b/u.test(message)) throw Object.assign(new Error("PREWRITING_PHOTO_CHANGED: 작성 전 원본 검사 중 상품 사진 바이트가 변경되었습니다.", { cause: error }),
      { code: "PREWRITING_PHOTO_CHANGED" });
    throw Object.assign(new Error("SOURCE_REVIEW_INCOMPLETE: 작성 전 판매자 원본 검사 응답이나 최종 판정을 완료하지 못했습니다. 원본 부족으로 처리하거나 새 원고·연출 사진을 생성하지 않았습니다.", { cause: error }),
      { code: "SOURCE_REVIEW_INCOMPLETE" });
  }
  // A shortlist omission is not proof that a product original is absent. The
  // batch reviewer already spends its bounded renewal on unreviewed candidates;
  // do not turn that protocol gap into a crop/recollection or generation attempt.
  if (assignments.length === 0 && diagnostics?.status === "incomplete") {
    throw Object.assign(new Error("SOURCE_REVIEW_INCOMPLETE: 작성 전 판매자 원본 후보의 픽셀 판정이 누락됐습니다. 원본 없음으로 처리하거나 새 원고·연출 사진을 생성하지 않았습니다. 누락 판정을 확인한 뒤 같은 상품 근거에서 재개하세요."),
      { code: "SOURCE_REVIEW_INCOMPLETE" });
  }
  if (assignments.length === 0 && diagnostics?.status === "failed") {
    throw Object.assign(new Error("SOURCE_REVIEW_INCOMPLETE: 작성 전 판매자 원본 검토가 완료되지 않았습니다. 기존 근거와 사진을 보존했으며 새 원고·연출 사진을 생성하지 않았습니다."),
      { code: "SOURCE_REVIEW_INCOMPLETE" });
  }
  return assignments[0] ?? null;
}

function imageHash(file: string): string {
  try {
  const stat = fs.statSync(file);
  const canonicalMatch = sameLocalPath(fs.realpathSync(file), file);
  if (!stat.isFile() || fs.lstatSync(file).isSymbolicLink() || stat.size < 1 || stat.size > 24 * 1024 * 1024 || !canonicalMatch)
    throw new Error("PREWRITING_PHOTO_CHANGED: 작성 전 상품 원본 파일을 확인할 수 없습니다.");
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch { throw new Error("PREWRITING_PHOTO_CHANGED: 작성 전 상품 원본 파일이 누락되거나 변경되었습니다."); }
}

function canonicalContext(snapshot: ProductSnapshot): string {
  if (!snapshot || !readProductSnapshot(snapshot, { productId: snapshot.productId, connectKind: "SHOPPING" }))
    throw new Error("PREWRITING_SOURCE_CHANGED: 작성 전 고정된 선택 상품 근거를 확인할 수 없습니다.");
  const productName = snapshot.product.name;
  if (typeof productName !== "string" || !productName.trim()) throw new Error("PREWRITING_SOURCE_CHANGED: 선택 상품명이 없습니다.");
  return selectedProductContextFrom9Canvas(buildProduct9Canvas({ name: productName,
    description: typeof snapshot.product.description === "string" ? snapshot.product.description : "",
    features: Array.isArray(snapshot.product.features) ? snapshot.product.features.filter((value): value is string => typeof value === "string") : [],
    sourceUrl: snapshot.sourceUrl, externalProductId: snapshot.externalProductId,
  }));
}

export function assertShoppingPrewritePhoto(proof: ShoppingPrewritePhotoProof, snapshot?: ProductSnapshot): void {
  snapshot = snapshot ?? proof?.snapshot;
  if (!proof || !snapshot || !proof.original || typeof proof.original.path !== "string" || !/^[a-f0-9]{64}$/u.test(proof.original.sha256) ||
      !proof.snapshot || proof.version !== "shopping-prewrite-photo-proof/v1" || proof.scope !== "selected-product-exterior" ||
      snapshot.snapshotId !== proof.snapshot.snapshotId || canonicalContext(snapshot) !== proof.selectedProductContext ||
      imageHash(proof.original.path) !== proof.original.sha256)
    throw new Error("PREWRITING_PHOTO_CHANGED: 선택 상품·옵션·원본 사진이 작성 전 검사 이후 바뀌었습니다. 원고나 새 이미지를 생성하지 않습니다.");
}

export function writingPhotosFromPrewrite(proof: ShoppingPrewritePhotoProof): WritingPublicationPhotoContext {
  assertShoppingPrewritePhoto(proof);
  const context = JSON.parse(proof.selectedProductContext) as { selectedOption: { status: "confirmed" | "ambiguous" | "not-applicable"; label: string | null } };
  return { version: "writing-publication-photo-context/v1", verifiedOriginal: {
    path: proof.original.path, sha256: proof.original.sha256, verifiedProductName: String(proof.snapshot.product.name),
    sourceUrl: proof.snapshot.sourceUrl, snapshotId: proof.snapshot.snapshotId,
    selectedIdentity: { status: context.selectedOption.status, label: context.selectedOption.label },
    observedSubject: proof.original.observedSubject, inclusionScope: "selected-product-exterior",
  }, plannedScenes: SHOPPING_NATURAL_SCENE_ROLES.map(scene => ({ role: scene.role, intent: scene.purpose })) };
}

/** MCP context survives collector temporary-file cleanup. This copies identical reviewed source bytes, never a generated image. */
export function persistPrewritePhotoForContext(proof: ShoppingPrewritePhotoProof, contextPath: string): ShoppingPrewritePhotoProof {
  assertShoppingPrewritePhoto(proof);
  const extension = path.extname(proof.original.path).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) throw new Error("PREWRITING_PHOTO_CHANGED: 검증 원본 형식을 확인할 수 없습니다.");
  const destination = path.join(path.dirname(path.resolve(contextPath)), `prewrite-original-${proof.original.sha256}${extension}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    if (imageHash(destination) !== proof.original.sha256) throw new Error("PREWRITING_PHOTO_CHANGED: 저장된 원본 복사본이 변경되었습니다.");
  } else {
    const bytes = fs.readFileSync(proof.original.path);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== proof.original.sha256) throw new Error("PREWRITING_PHOTO_CHANGED: 원본 복사 전에 파일이 바뀌었습니다.");
    fs.writeFileSync(destination, bytes, { flag: "wx" });
  }
  const persisted = { ...proof, original: { ...proof.original, path: destination } };
  assertShoppingPrewritePhoto(persisted);
  return persisted;
}

/** The local API forwards its own saved context, never caller photo verdicts. Bind the external writer to those same original pixels. */
export function readSubmittedPrewritePhoto(file: string, expected: ProductSnapshot): ShoppingPrewritePhotoProof | null {
  const context = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  const savedSnapshot = readProductSnapshot(context.snapshot, { productId: expected.productId, connectKind: "SHOPPING" });
  if (!savedSnapshot || savedSnapshot.snapshotId !== expected.snapshotId || context.snapshotId !== expected.snapshotId)
    throw new Error("PREWRITING_SOURCE_CHANGED: 제출 컨텍스트의 선택 상품 스냅샷이 변경되었습니다.");
  if (!context.prewritingPhotoProof) {
    if (context.publicationPhotoContext || context.publicationPhotoAvailability)
      throw new Error("PREWRITING_PHOTO_CHANGED: 작성 컨텍스트의 원본 검사 기록이 누락되었습니다.");
    return null; // Legacy contexts still have to pass the fresh prewrite gate.
  }
  const proof = context.prewritingPhotoProof as ShoppingPrewritePhotoProof;
  assertShoppingPrewritePhoto(proof, expected);
  const sameDirectory = sameLocalPath(path.dirname(file), path.dirname(proof.original.path));
  const publication = context.publicationPhotoContext as WritingPublicationPhotoContext | undefined;
  if (!sameDirectory || !path.basename(proof.original.path).startsWith(`prewrite-original-${proof.original.sha256}.`) ||
      publication?.verifiedOriginal?.sha256 !== proof.original.sha256 || publication.verifiedOriginal.snapshotId !== proof.snapshot.snapshotId ||
      publication.verifiedOriginal.verifiedProductName !== expected.product.name || publication.verifiedOriginal.sourceUrl !== expected.sourceUrl ||
      !sameLocalPath(publication.verifiedOriginal.path, proof.original.path))
    throw new Error("PREWRITING_PHOTO_CHANGED: 작성 컨텍스트와 실제 원본 파일 연결이 변경되었습니다.");
  return proof;
}

/** The operation is reached only after a clean selected-context original survives exact-byte checks. No image generation is involved. */
export async function withShoppingPrewritePhoto<T>(input: { snapshot: ProductSnapshot; candidatePaths: string[] },
  operation: (proof: ShoppingPrewritePhotoProof) => Promise<T>, dependencies: ShoppingPrewritePhotoDependencies = { select: selectShoppingPrewriteOriginal }): Promise<T> {
  const selectedProductContext = canonicalContext(input.snapshot);
  const productName = String(input.snapshot.product.name);
  const snapshot = JSON.parse(JSON.stringify(input.snapshot)) as ProductSnapshot;
  const candidates = [...new Set(input.candidatePaths.map(file => path.resolve(file)))];
  const hashes = new Map<string, string>();
  for (const file of candidates) { try { hashes.set(file, imageHash(file)); } catch { /* Unreadable sources cannot be candidates. */ } }
  let selected = await dependencies.select([...hashes.keys()], productName, selectedProductContext);
  if (!selected && dependencies.recoverSourcePixels) {
    const recovered = await dependencies.recoverSourcePixels();
    if (recovered) {
      const file = path.resolve(recovered);
      hashes.set(file, imageHash(file));
      // A crop proposal does not authorize publication: the same selected-context pixel gate reviews the actual crop.
      selected = await dependencies.select([file], productName, selectedProductContext);
    }
  }
  if (!selected) throw Object.assign(new Error("IMAGE_SOURCE_BINDING_REQUIRED: 작성 전 필수 판매자 원본의 상품·옵션·자연 사진 검사를 통과하지 못했습니다. 새 원고와 연출 이미지를 생성하지 않았습니다."),
    { code: "IMAGE_SOURCE_BINDING_REQUIRED" });
  const file = path.resolve(selected.path), sha256 = hashes.get(file);
  if (!sha256 || selected.sourceSha256 !== sha256 || imageHash(file) !== sha256 ||
      canonicalContext(input.snapshot) !== selectedProductContext || input.snapshot.snapshotId !== snapshot.snapshotId)
    throw new Error("PREWRITING_PHOTO_CHANGED: 원본 검사 중 선택 근거나 상품 사진이 바뀌었습니다. 원고를 생성하지 않습니다.");
  const proof: ShoppingPrewritePhotoProof = { version: "shopping-prewrite-photo-proof/v1", snapshot, selectedProductContext,
    original: { path: file, sha256, observedSubject: selected.reason.trim().slice(0, 800) }, scope: "selected-product-exterior" };
  assertShoppingPrewritePhoto(proof, input.snapshot);
  return operation(proof);
}
