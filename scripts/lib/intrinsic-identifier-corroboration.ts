import { corroboratableIdentifierPairs, intrinsicIdentifierBoxesOverlap, type IntrinsicIdentifierPair, type IntrinsicIdentifierServerConflict } from "./intrinsic-identifier-comparison";
import { normalizeIntrinsicIdentifierLiteral, reviewIntrinsicIdentifierOcr, type IntrinsicIdentifierOcrResult } from "./intrinsic-identifier-ocr";
import crypto from "node:crypto";
import { observeIntrinsicIdentifier, intrinsicIdentifierObserverRequestSha256, parseIntrinsicIdentifierObserverResponse,
  INTRINSIC_IDENTIFIER_OBSERVER_VERSION, type IntrinsicIdentifierObserverEvidence } from "./intrinsic-identifier-observer";

export interface IntrinsicIdentifierCorroboration {
  pair: IntrinsicIdentifierPair;
  ocr: IntrinsicIdentifierOcrResult;
  /** Never substituted for the native comparison's original literal/box. */
  blindObservations?: IntrinsicIdentifierServerConflict["blindObservations"];
  initialOcr?: IntrinsicIdentifierOcrResult;
}
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
function validObservation(value: IntrinsicIdentifierObserverEvidence | undefined, sha256: string): value is IntrinsicIdentifierObserverEvidence {
  return !!value && value.nativeExecution === true && value.version === INTRINSIC_IDENTIFIER_OBSERVER_VERSION && value.imageSha256 === sha256 &&
    value.requestSha256 === intrinsicIdentifierObserverRequestSha256(sha256) && typeof value.rawResponse === "string" &&
    Buffer.byteLength(value.rawResponse, "utf8") <= 4096 && value.responseSha256 === hash(value.rawResponse) &&
    JSON.stringify(parseIntrinsicIdentifierObserverResponse(value.rawResponse)) === JSON.stringify(value.observation);
}

/** A different, single-image transcription task can resolve an ambiguous word
 * observation. It never retries the product verdict or selects a new source.
 * OCR/runtime/input failures and incomplete observations remain a hold. */
export async function corroborateIntrinsicIdentifierPair(options: {
  pair: IntrinsicIdentifierPair; sourcePath: string; candidatePath: string; candidateSha256: string;
  workspace: string; allowBlindObservation: boolean;
}, dependencies: { ocr?: typeof reviewIntrinsicIdentifierOcr; observe?: typeof observeIntrinsicIdentifier } = {}): Promise<IntrinsicIdentifierCorroboration> {
  const { pair } = options, ocr = dependencies.ocr || reviewIntrinsicIdentifierOcr;
  const run = (actual: IntrinsicIdentifierPair) => ocr({ sourcePath: options.sourcePath, sourceSha256: actual.sourceSha256!,
    sourceBox: actual.sourceBox!, candidatePath: options.candidatePath, candidateSha256: options.candidateSha256,
    candidateBox: actual.candidateBox!, sourceLiteral: actual.sourceLiteral, workspace: options.workspace });
  if (!corroboratableIdentifierPairs({ identifierComparisons: [pair] }).length)
    return { pair, ocr: { status: "invalid", reason: "IDENTIFIER_COMPONENT_OR_OPTION_UNCONFIRMED" } };
  const initial = await run(pair), candidateAgrees = initial.evidence?.candidate.consensus?.normalized === normalizeIntrinsicIdentifierLiteral(pair.candidateLiteral);
  if ((initial.status === "match" || initial.status === "conflict") && candidateAgrees) return { pair, ocr: initial };
  // No new provider task can fix missing OCR, changed bytes, unsafe regions,
  // time/capacity errors, or a caller's injected review. Only a completed native
  // pixel transcription with a literal/consensus problem reaches this stage.
  if (!options.allowBlindObservation || !initial.evidence?.nativeExecution ||
      !["SOURCE_LITERAL_NOT_CONFIRMED", "OCR_CONSENSUS_UNAVAILABLE", "BLIND_OCR_LITERALS_MATCH", "BLIND_OCR_IDENTIFIER_CONFLICT"].includes(initial.reason))
    return { pair, ocr: initial };
  const observe = dependencies.observe || observeIntrinsicIdentifier;
  const observed = await Promise.all([
    observe({ path: options.sourcePath, sha256: pair.sourceSha256! }),
    observe({ path: options.candidatePath, sha256: options.candidateSha256 }),
  ]);
  const source = observed[0].evidence, candidate = observed[1].evidence;
  if (observed.some(result => result.status !== "observed") || !validObservation(source, pair.sourceSha256!) || !validObservation(candidate, options.candidateSha256) ||
      [source.observation, candidate.observation].some(row => row.readability !== "legible" || row.location !== "intrinsic" ||
        row.identifierRole !== pair.identifierRole || !row.box) ||
      !intrinsicIdentifierBoxesOverlap(pair.sourceBox, source.observation.box) || !intrinsicIdentifierBoxesOverlap(pair.candidateBox, candidate.observation.box))
    return { pair, ocr: { status: "unavailable", reason: "BLIND_IDENTIFIER_OBSERVATION_UNCONFIRMED" }, initialOcr: initial };
  const derived: IntrinsicIdentifierPair = { ...pair, sourceLiteral: source.observation.literal, sourceBox: source.observation.box!,
    candidateLiteral: candidate.observation.literal, candidateBox: candidate.observation.box! };
  return { pair: derived, ocr: await run(derived), blindObservations: { source, candidate }, initialOcr: initial };
}
