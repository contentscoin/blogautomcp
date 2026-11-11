import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalProductEvidenceName, isProductTitleEcho, SELLER_SOURCE_MAX_IMAGE_BYTES, type SellerSourceEvidenceImage } from "./product-source-intake";

export interface SellerSourceReadingDiagnostic {
  kind: "ocr" | "vision";
  status: string;
  imagePaths: string[];
  scannedImageCount: number;
  acceptedFacts: string[];
  rejectedFacts?: string[];
}

export interface InsufficientSourceDiagnosticInput {
  sourceUrl: string;
  productName: string;
  description: string;
  features: string[];
  collectedFeatures?: string[];
  evidenceLevel: string;
  evidenceSignals: string[];
  candidateImageCount: number;
  publicationImageCount: number;
  detailImageCount: number;
  evidenceImages: readonly SellerSourceEvidenceImage[];
  reading: readonly SellerSourceReadingDiagnostic[];
}

function bounded(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ").slice(0, maximum);
}

function publicSourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!/^https?:$/u.test(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:token|secret|credential|authorization|api.?key|signature|session|code)/iu.test(key)) url.searchParams.delete(key);
    }
    return bounded(url.toString(), 1_024);
  } catch { return ""; }
}

/** Failure evidence is not a source snapshot and cannot authorize writing. */
export function buildInsufficientSourceDiagnostic(input: InsufficientSourceDiagnosticInput) {
  return {
    version: "product-source-intake-diagnostic/v1",
    status: "insufficient-source",
    code: "SOURCE_EVIDENCE_REQUIRED",
    trusted: false,
    usableSnapshot: false,
    observedAt: new Date().toISOString(),
    sourceUrl: publicSourceUrl(input.sourceUrl),
    productName: bounded(input.productName, 300),
    canonicalProductName: bounded(canonicalProductEvidenceName(input.productName), 300),
    untrustedDescription: bounded(input.description, 4_000),
    descriptionIsTitleEcho: isProductTitleEcho(input.description, input.productName),
    untrustedFeatures: input.features.slice(0, 40).map(value => bounded(value, 220)),
    untrustedCollectedFeatures: (input.collectedFeatures || input.features).slice(0, 40).map(value => bounded(value, 220)),
    sufficiency: { level: bounded(input.evidenceLevel, 20), passed: false,
      signals: input.evidenceSignals.slice(0, 16).map(value => bounded(value, 220)) },
    imageIntake: {
      candidateCount: input.candidateImageCount,
      publicationImageCount: input.publicationImageCount,
      detailImageCount: input.detailImageCount,
      evidenceImageCount: input.evidenceImages.length,
      evidenceImages: input.evidenceImages.slice(0, 24).map(image => {
        let sha256: string | null = null;
        try {
          const stat = fs.statSync(image.path);
          if (stat.isFile() && stat.size === image.size && stat.size <= SELLER_SOURCE_MAX_IMAGE_BYTES) {
            sha256 = crypto.createHash("sha256").update(fs.readFileSync(image.path)).digest("hex");
          }
        } catch { /* A missing file remains a missing observation, never a verified reference. */ }
        return { file: bounded(path.basename(image.path), 160), sourceUrl: publicSourceUrl(image.url),
          sourceIndex: image.index, width: image.width, height: image.height, bytes: image.size,
          publicationCandidate: image.publicationCandidate, detailCrop: Boolean(image.detailCrop), sha256 };
      }),
    },
    reading: input.reading.slice(0, 3).map(stage => ({
      kind: stage.kind, status: bounded(stage.status, 30), scannedImageCount: stage.scannedImageCount,
      files: stage.imagePaths.slice(0, 16).map(file => bounded(path.basename(file), 120)),
      untrustedAcceptedFacts: stage.acceptedFacts.slice(0, 16).map(value => bounded(value, 160)),
      rejectedFacts: (stage.rejectedFacts || []).slice(0, 8).map(value => bounded(value, 160)),
    })),
  };
}

/** Save only a bounded diagnostic sibling. Never touch manifests, manuscripts,
 * images, the database or the successful sourceSnapshot/context files. */
export function writeInsufficientSourceDiagnostic(outputDirectory: string, input: InsufficientSourceDiagnosticInput): string | null {
  if (!outputDirectory.trim()) return null;
  const directory = path.resolve(outputDirectory);
  const target = path.join(directory, "source-intake-diagnostics.json");
  const temporary = path.join(directory, `.source-intake-diagnostics-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    fs.mkdirSync(directory, { recursive: true });
    if (fs.lstatSync(directory).isSymbolicLink() || (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())) return null;
    const json = `${JSON.stringify(buildInsufficientSourceDiagnostic(input), null, 2)}\n`;
    if (Buffer.byteLength(json, "utf8") > 192 * 1_024) return null;
    fs.writeFileSync(temporary, json, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
    return target;
  } catch { return null; }
  finally { try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* Best effort for this helper's own temporary sibling only. */ } }
}
