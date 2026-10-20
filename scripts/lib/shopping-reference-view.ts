/** Generation planning only. A view observation never approves an output. */
export const SHOPPING_REFERENCE_STATES = ["worn", "held", "freestanding", "laid-flat", "hanging", "packaged", "unknown"] as const;
const CAMERA_VIEWS = ["front", "side", "three-quarter", "top", "unknown"] as const;
const GEOMETRY_VISIBILITY = ["complete", "partial", "unknown"] as const;
const PRINT_VISIBILITY = ["readable", "unreadable", "absent", "unknown"] as const;

export interface ShoppingReferenceViewObservation {
  subjectState: typeof SHOPPING_REFERENCE_STATES[number];
  cameraView: typeof CAMERA_VIEWS[number];
  geometryVisibility: typeof GEOMETRY_VISIBILITY[number];
  hiddenParts: string[];
  intrinsicPrint: typeof PRINT_VISIBILITY[number];
  readableIdentifiers: string[];
}

export const SHOPPING_REFERENCE_VIEW_SCHEMA = {
  type: "object",
  properties: {
    subjectState: { type: "string", enum: SHOPPING_REFERENCE_STATES },
    cameraView: { type: "string", enum: CAMERA_VIEWS },
    geometryVisibility: { type: "string", enum: GEOMETRY_VISIBILITY },
    hiddenParts: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 160 } },
    intrinsicPrint: { type: "string", enum: PRINT_VISIBILITY },
    readableIdentifiers: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 160 } },
  },
  required: ["subjectState", "cameraView", "geometryVisibility", "hiddenParts", "intrinsicPrint", "readableIdentifiers"],
  additionalProperties: false,
};

export const SHOPPING_REFERENCE_VIEW_INSTRUCTION = "Also return viewObservation from the actual attached product pixels, never its name or a generic product assumption. subjectState=worn|held|freestanding|laid-flat|hanging|packaged|unknown describes its actual presentation; cameraView=front|side|three-quarter|top|unknown. geometryVisibility=complete only when the selected subject's entire identifying silhouette is actually visible; a body, hair, overlapping product, crop or packaging hiding it means partial, even when its identity is recognizable. hiddenParts lists every important hidden/cropped identifying part or surface (for example waistband, rear connection, back, neckline or hem); do not infer those parts' design. intrinsicPrint=readable|unreadable|absent|unknown refers ONLY to intrinsic product print; readableIdentifiers lists exact actually readable identifying strings, otherwise []. Outside promotional logos and listing-title words are never intrinsic identifiers. Unknown is safer than inventing an observation. These observations constrain generation, not publication approval.";

/** Missing observations in old cached references cannot authorize a new view.
 * Malformed supplied observations stop rather than silently granting permission. */
export function parseShoppingReferenceView(value: unknown): ShoppingReferenceViewObservation | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reference view observation");
  const row = value as Record<string, unknown>;
  const strings = (raw: unknown, maximum: number): raw is string[] => Array.isArray(raw) && raw.length <= maximum &&
    raw.every(item => typeof item === "string" && Boolean(item.trim()) && item.length <= 160 && !/[\r\n\u0000-\u001f]/u.test(item));
  if (!SHOPPING_REFERENCE_STATES.includes(row.subjectState as ShoppingReferenceViewObservation["subjectState"]) ||
      !CAMERA_VIEWS.includes(row.cameraView as ShoppingReferenceViewObservation["cameraView"]) ||
      !GEOMETRY_VISIBILITY.includes(row.geometryVisibility as ShoppingReferenceViewObservation["geometryVisibility"]) ||
      !PRINT_VISIBILITY.includes(row.intrinsicPrint as ShoppingReferenceViewObservation["intrinsicPrint"]) ||
      !strings(row.hiddenParts, 12) || !strings(row.readableIdentifiers, 8) ||
      Object.keys(row).some(key => !SHOPPING_REFERENCE_VIEW_SCHEMA.required.includes(key)) ||
      (row.intrinsicPrint === "readable" ? row.readableIdentifiers.length === 0 : row.readableIdentifiers.length !== 0))
    throw new Error("Invalid reference view observation");
  return { subjectState: row.subjectState as ShoppingReferenceViewObservation["subjectState"],
    cameraView: row.cameraView as ShoppingReferenceViewObservation["cameraView"],
    geometryVisibility: row.geometryVisibility as ShoppingReferenceViewObservation["geometryVisibility"],
    hiddenParts: [...row.hiddenParts], intrinsicPrint: row.intrinsicPrint as ShoppingReferenceViewObservation["intrinsicPrint"],
    readableIdentifiers: [...row.readableIdentifiers] };
}

type Reference = { sha256: string; viewObservation?: ShoppingReferenceViewObservation };
export function resolveShoppingReferenceView(primary: Reference | undefined,
  supports: readonly (Reference & { purpose: "geometry" | "intrinsic-label" })[] = []) {
  const observation = parseShoppingReferenceView(primary?.viewObservation);
  // Only an already visually verified same-option complete geometry support can
  // authorize changing a worn/held product into a separate physical object.
  const geometrySupport = supports.find(reference => {
    const view = parseShoppingReferenceView(reference.viewObservation);
    return reference.purpose === "geometry" && view?.geometryVisibility === "complete" &&
      ["freestanding", "laid-flat", "hanging"].includes(view.subjectState);
  });
  const geometry = geometrySupport?.viewObservation ?? observation;
  const labelSupport = supports.find(reference => reference.purpose === "intrinsic-label" &&
    parseShoppingReferenceView(reference.viewObservation)?.intrinsicPrint === "readable");
  const printing = labelSupport?.viewObservation ?? observation;
  return {
    version: "shopping-reference-view/v1" as const,
    subjectState: geometry?.subjectState ?? "unknown",
    cameraView: geometry?.cameraView ?? "unknown",
    geometryVisibility: geometry?.geometryVisibility ?? "unknown",
    hiddenParts: geometry?.hiddenParts ?? [],
    geometryReferenceSha256: geometrySupport?.sha256 ?? primary?.sha256 ?? null,
    presentationChangeSupported: Boolean(geometrySupport && observation && geometrySupport.viewObservation!.subjectState !== observation.subjectState),
    mayVaryViewpoint: Boolean(geometry && geometry.geometryVisibility === "complete" &&
      geometry.cameraView !== "unknown" && !geometry.hiddenParts.length && ["freestanding", "laid-flat", "hanging"].includes(geometry.subjectState)),
    intrinsicPrint: printing?.intrinsicPrint ?? "unknown",
    readableIdentifiers: printing?.readableIdentifiers ?? [],
    novelIdentifyingSurfacesAllowed: false as const,
  };
}
