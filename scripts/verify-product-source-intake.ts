import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import * as imageSelection from "./lib/product-image-selection";
import * as sourceIntake from "./lib/product-source-intake";
import { writeInsufficientSourceDiagnostic } from "./lib/product-source-intake-diagnostics";
import { buildProductReviewAnalysis, hasSufficientProductReviewEvidence, isMeaningfulProductEvidenceFeature } from "./lib/product-editorial-plan";
import { extractExplicitProductFacts, normalizeTypedProductFact } from "./lib/product-source-facts";
import { mergeProductInfo, type MergeableProductInfo } from "./lib/product-info-merge";
import { createPublishImageCleanup } from "./lib/publish-image-cleanup";

interface MaterializedSourceImages {
  representativeImagePath: string | null;
  imagePaths: string[];
  detailImagePaths: string[];
  sellerEvidenceImages: sourceIntake.SellerSourceEvidenceImage[];
  sellerEvidenceOnlyImagePaths: string[];
}

/** Execute the actual intake functions, with explicit local stubs, without
 * importing simple-agent's main/database/browser side effects. No network or
 * provider is available in these regressions. */
function isolatedIntakeFunction(source: string, startMarker: string, endMarker: string,
  functionName: string, dependencies: Record<string, unknown>): unknown {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `intake test boundary exists: ${functionName}`);
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(`${javascript}\n${functionName};`, { ...dependencies, console: { log() {} } });
}

function sourceProduct(name: string, description: string, features: string[]): MergeableProductInfo {
  return { name, description, features, price: "", originalPrice: "", discountRate: "", couponInfo: "", deliveryInfo: "",
    reviewCount: "", rating: "", representativeImagePath: null, imagePaths: [], detailImagePaths: [], sourceImageUrls: [],
    finalUrl: "https://smartstore.naver.com/fixture/products/123" };
}

export async function verifyProductSourceIntake(): Promise<void> {
  const agent = fs.readFileSync("scripts/simple-agent.ts", "utf8");
  // Actual October 12 Bendict failure: raw live title looked usable, then the
  // same facts became sparse when merge chose the unsuffixed stored title.
  const bendict = "벤딕트 에어건 무선 미니 송풍기 초강력 콤프레샤 세차 캠핑 컴퓨터 청소 가정용 마하1";
  const base = sourceProduct(bendict, "", []);
  const live = sourceProduct(`${bendict} : 벤딕트`, bendict, extractExplicitProductFacts(bendict, "title"));
  const merged = mergeProductInfo(base, live)!;
  const analyze = (product: MergeableProductInfo) => buildProductReviewAnalysis({ productName: product.name,
    description: product.description, features: product.features, targetSectionCount: 11 });
  assert.equal(analyze(live).evidenceLevel, "sparse", "a store suffix cannot make title keywords independent evidence");
  assert.equal(analyze(live).evidenceLevel, analyze(merged).evidenceLevel, "early skip and post-merge gate agree");
  assert.deepEqual(analyze(live).verifiedSignals, ["무선 방식"], "mini/camping title keywords do not become extra facts");
  assert.equal(sourceIntake.isProductTitleEcho(`${bendict} : 무게 500g`, live.name), false,
    "a description containing the title plus a new specification remains independent");
  assert.equal(analyze({ ...live, description: `${bendict} : 무게 500g` }).evidenceLevel, "usable",
    "an independent source description is still graded, including its actual new measurement");
  assert.equal(sourceIntake.canonicalProductEvidenceName("모델 A-100 라일락 2개 : 브랜드 공식몰"), "모델 A-100 라일락 2개");
  assert.equal(sourceIntake.isProductTitleEcho("모델 A-100 블랙 1개", "모델 A-100 라일락 2개 : 공식몰"), false);

  const tefal = sourceProduct("테팔 휴대용 무선 미니 블렌더 라이트믹스 라일락, 핑크 BL1C06K0 텀블러 믹서기",
    "[테팔] 테팔 브랜드 공식 판매점", ["원산지: 중국산((유)그룹세브코리아)", "용량: 300ml", "기능: 무선"]);
  assert.equal(analyze(tefal).evidenceLevel, "usable", "same-job Tefal's independently collected 300ml remains usable");
  assert.equal(analyze({ ...tefal, name: `${tefal.name} : 테팔` }).evidenceLevel, "usable");

  let ocrCalls = 0;
  const visionImages: string[][] = [];
  const enrich = isolatedIntakeFunction(agent, "function sanitizeText(", "function sanitizeTravelPageResearch(",
    "enrichShoppingSourceFeatures", {
      ...sourceIntake, extractExplicitProductFacts, normalizeTypedProductFact, isMeaningfulProductEvidenceFeature,
      hasSufficientProductReviewEvidence, DETAIL_VISION_READ_ENABLED: true, DETAIL_VISION_MAX_IMAGES: 8,
      readSellerDetailOcrFacts: async () => { ocrCalls += 1; return { facts: [], status: "complete", scannedImageCount: 8, imagePaths: [] }; },
      readDetailImagesWithVision: async (input: { imagePaths: string[] }) => {
        visionImages.push(Array.from(input.imagePaths));
        return { status: "complete", imageCount: input.imagePaths.length, acceptedFacts: [], rejectedFacts: [] };
      },
      runCodexDraft: () => { throw new Error("test must not call a provider"); },
    }) as (name: string, description: string, features: string[], detailPaths: string[], sellerPaths: string[]) => Promise<string[]>;
  const bendictPanels = Array.from({ length: 10 }, (_, index) => `seller-spec-${index}.jpg`);
  await enrich(live.name, live.description, live.features, bendictPanels.slice(0, 8), bendictPanels);
  assert.equal(ocrCalls, 1, "Bendict's echoed-title input actually enters OCR instead of skipping it");
  assert.equal(visionImages.length, 2);
  assert.equal(visionImages.flat().length, 10);
  ocrCalls = 0; visionImages.length = 0;
  await enrich(tefal.name, tefal.description, tefal.features, bendictPanels, bendictPanels);
  assert.equal(ocrCalls, 0, "usable independent specs do not spend the source-reading budget");
  assert.equal(visionImages.length, 0);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "product-source-intake-"));
  try {
    const square = path.join(directory, "square.jpg");
    const wide = path.join(directory, "wide.jpg");
    const narrow = path.join(directory, "narrow.jpg");
    const tiny = path.join(directory, "tiny.jpg");
    const make = async (file: string, width: number, height: number) => {
      const pixels = crypto.randomBytes(width * height * 3);
      await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 80 }).toFile(file);
    };
    await make(square, 860, 860); await make(wide, 860, 540); await make(narrow, 860, 270); await make(tiny, 32, 32);
    assert.ok(fs.statSync(square).size > 20_000);
    const cleanup = createPublishImageCleanup(path.join(directory, "downloaded"));
    const urls = Array.from({ length: 20 }, (_, index) => `https://shop-phinf.pstatic.net/source-${index}.jpg`);
    const materialize = isolatedIntakeFunction(agent, "function isTallDetailImageDimension(", "async function buildProductInfoFromStoredBrandLink(",
      "materializeProductImages", {
        ...imageSelection, ...sourceIntake, fs, path, sharp, TEMP_PATH: cleanup.tempPath, publishImageCleanup: cleanup,
        SHOPPING_BODY_IMAGE_MAX: 5,
        downloadImage: async (url: string, file: string) => {
          const index = urls.indexOf(url);
          fs.copyFileSync(index === 15 ? tiny : index === 16 ? narrow : index === 17 || index === 18 ? wide : square, file);
        },
        createProductDetailImageSegments: async () => [],
      }) as (urls: string[], prefix: string, maximum: number, retainEvidence: boolean) => Promise<MaterializedSourceImages>;
    // Actual Gompyo layout: 20 URLs, 5 ordinary photo candidates, later ordinary
    // panels, a too-small asset and 860x270/860x540 panels excluded from photos.
    const images = await materialize(urls, "gompyo-source", 5, true);
    assert.equal(images.imagePaths.length, 5, "publication photo quota is unchanged");
    assert.equal(images.detailImagePaths.length, 0);
    assert.ok(images.imagePaths.every(file => /_[0-4]\.jpg$/u.test(file)), "later evidence never enters publication paths");
    assert.equal(images.sellerEvidenceImages.length, 19);
    const evidencePaths = images.sellerEvidenceImages.map(image => image.path);
    assert.ok(evidencePaths.slice(0, 3).every(file => /_(?:16|17|18)\.jpg$/u.test(file)), "wide seller panels get reading priority");
    const batches = sourceIntake.planSellerSourceReadingBatches(evidencePaths, 8);
    assert.equal(batches.length, 2);
    assert.equal(batches.flat().length, 16);
    assert.equal(new Set(batches.flat()).size, 16, "source reading does not attach the same image twice");
    for (const index of [5, 14, 16, 17, 18, 19]) {
      assert.ok(batches.flat().some(file => file.endsWith(`_${index}.jpg`)), `later/wide source ${index + 1} reaches the reader`);
    }
    assert.equal(sourceIntake.isReadableSellerSourceImage({ url: "https://checkout.phinf.naver.net/review.jpg", width: 860, height: 540, size: 50_000 }), false);
    assert.equal(sourceIntake.isReadableSellerSourceImage({ url: urls[0], width: 860, height: 540, size: 16 * 1024 * 1024 }), false);
    assert.equal(sourceIntake.planSellerSourceEvidenceImages(Array.from({ length: 60 }, (_, index) => ({ ...images.sellerEvidenceImages[0],
      path: `bounded-${index}.jpg`, index }))).length, 24, "source image pool remains bounded independently of the photo quota");

    // A failed observation is retained for diagnosis, never installed as a usable
    // snapshot. Existing normal prose, manifests and photos stay byte-identical.
    const protectedFiles = ["draft.md", "manifest.json", "draft-context.json"].map(file => path.join(directory, file));
    protectedFiles.forEach(file => fs.writeFileSync(file, `preserve ${path.basename(file)}\n`));
    const before = [...protectedFiles, ...images.imagePaths].map(file => fs.readFileSync(file));
    const diagnostic = writeInsufficientSourceDiagnostic(directory, {
      sourceUrl: "https://smartstore.naver.com/fixture/products/123?token=private&productId=123",
      productName: live.name, description: live.description, features: live.features, evidenceLevel: "sparse",
      evidenceSignals: analyze(live).verifiedSignals, candidateImageCount: 20, publicationImageCount: 5, detailImageCount: 0,
      evidenceImages: images.sellerEvidenceImages,
      reading: [{ kind: "vision", status: "complete", imagePaths: batches[0], scannedImageCount: 8, acceptedFacts: [] }],
    });
    assert.ok(diagnostic);
    const saved = JSON.parse(fs.readFileSync(diagnostic!, "utf8"));
    assert.equal(saved.status, "insufficient-source"); assert.equal(saved.trusted, false); assert.equal(saved.usableSnapshot, false);
    assert.equal(saved.sufficiency.passed, false); assert.equal(saved.descriptionIsTitleEcho, true);
    assert.ok(!saved.sourceUrl.includes("private")); assert.ok(saved.sourceUrl.includes("productId=123"));
    assert.equal(saved.imageIntake.evidenceImages[0].sha256, crypto.createHash("sha256").update(fs.readFileSync(evidencePaths[0])).digest("hex"));
    assert.ok(!("sourceSnapshot" in saved));
    [...protectedFiles, ...images.imagePaths].forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index]));
    assert.ok(!fs.readdirSync(directory).some(file => file.endsWith(".tmp")));
    cleanup.cleanup(images.sellerEvidenceOnlyImagePaths);
    assert.ok(images.sellerEvidenceOnlyImagePaths.every(file => !fs.existsSync(file)), "reading-only temps are owned and cleaned");
    assert.ok(images.imagePaths.every(file => fs.existsSync(file)), "source-only cleanup leaves normal photo candidates alone");
    const diagnosticCall = agent.indexOf("writeInsufficientSourceDiagnostic(diagnosticDirectory");
    const insufficientThrow = agent.indexOf("throw new Error(`SOURCE_EVIDENCE_REQUIRED: 제품 자체의 확인 가능한 구성", diagnosticCall);
    assert.ok(diagnosticCall > 0 && insufficientThrow > diagnosticCall, "failure diagnostic is written before the source-evidence throw");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
