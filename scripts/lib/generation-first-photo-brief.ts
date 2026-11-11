import type { Product9Canvas } from "./product-9canvas";

/** Planning data only: neither seller copy nor a photo slot proves a purchase,
 * included quantity, hidden design or product performance. No provider calls. */
export interface GenerationFirstPhotoBriefOptions {
  productName: string;
  sectionTitle: string;
  imageIntent: string;
  role: "hero" | "body";
  variantIndex?: number;
  productUnderstanding?: Product9Canvas;
  plannedBodyImageCount?: number;
}

const clean = (value: unknown, limit = 220): string => typeof value === "string"
  ? value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, limit) : "";

const BODY_GOALS = [
  "Establish the selected subject in a believable everyday setting with its physical support visible.",
  "Make the selected option and already visible identifying appearance easy to recognize in a distinct composition.",
  "Show how the selected subject sits within its surrounding space from a different natural camera distance.",
  "Show the source-visible material and finish with soft side light at an ordinary viewing distance, without inventing microdetail.",
  "Give the section a quiet alternate placement and background depth while keeping the selected subject recognizable.",
  "Show a wider everyday arrangement that helps the reader picture placement, without measuring dimensions or demonstrating results.",
] as const;

export function buildGenerationFirstPhotoBrief(options: GenerationFirstPhotoBriefOptions) {
  const index = Number.isSafeInteger(options.variantIndex) && options.variantIndex! >= 0 ? options.variantIndex! : 0;
  const count = Number.isSafeInteger(options.plannedBodyImageCount) && options.plannedBodyImageCount! >= 0
    ? options.plannedBodyImageCount! : null;
  // A different product's saved ontology must not leak its option or staging.
  const canvas = options.productUnderstanding?.version === "product-9canvas/v1" &&
    clean(options.productUnderstanding.subject.productName, 400) === clean(options.productName, 400)
    ? options.productUnderstanding : undefined;
  const sourceFacts = canvas?.claim.filter(claim => claim.status === "validated" && claim.evidenceIds.length > 0 &&
    claim.evidenceIds.every(id => {
      const evidence = canvas.evidence.find(item => item.id === id);
      const resource = canvas.resource.find(item => item.id === evidence?.resourceId);
      return resource?.kind === "seller-feature" && clean(resource.text, 500) === clean(claim.text, 500) &&
        clean(evidence?.text, 500) === clean(claim.text, 500);
    })).slice(0, 4).map(claim => clean(claim.text)) ?? [];
  return {
    version: "generation-first-photo-brief/v1" as const,
    deliverable: options.role === "hero" ? "one-thumbnail-background-photo" : "one-body-photo",
    plannedBodyImageCount: count,
    bodySlotOrdinal: options.role === "body" ? index + 1 : null,
    countPolicy: "The count describes the existing composition plan; deliver this one slot only. It never authorizes extra images, retries or a collage.",
    section: { title: clean(options.sectionTitle), imageIntent: clean(options.imageIntent, 400) },
    photoGoal: options.role === "hero"
      ? "A full photograph with a prominent selected product and quiet photographic space for one separately rendered short Korean headline."
      : BODY_GOALS[index % BODY_GOALS.length],
    productContext: canvas ? {
      productKind: clean(canvas.concept.productKind, 100),
      physicalScale: canvas.concept.physicalScale,
      selectedOption: {
        status: canvas.subject.selectedOption.status,
        explicitFeatureLabel: canvas.subject.selectedOption.status === "confirmed" ? clean(canvas.subject.selectedOption.label) : null,
        basis: "existing-9canvas-feature-label; catalog candidates are not a confirmed purchase or included set",
      },
      sellerFactsForContextOnly: sourceFacts,
    } : null,
    visualEvidencePolicy: "Attached selected-subject pixels define visible design, option and count. Product context helps stage the photo; it cannot reveal hidden parts, assemble catalog alternatives, certify the complete set or make this AI illustration prove seller facts.",
  };
}
