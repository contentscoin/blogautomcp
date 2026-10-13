/** Read-only current preparation summary. No raw errors, paths, owner tokens or
 * historical success counters are returned, and no approval gate is changed. */
type Action = "ready" | "wait-current-job" | "inspect-existing-output" | "review-source-candidates" |
  "collect-source-photo" | "complete-image-slots" | "repair-text-sections" | "review-publication" |
  "inspect-current-state" | "approve-material" | "verify-published-result" | "verify-scheduled-result";
type Category = "source" | "recovery" | "text" | "images" | "review" | "inspection";
const ACTION_TEXT: Record<Action, string> = {
  ready: "현재 준비완료 상태입니다.",
  "wait-current-job": "진행 중인 작업의 완료와 저장 결과를 조회하세요.",
  "inspect-existing-output": "이전 요청의 완료 여부와 기존 생성 파일을 확인해 복구하세요. 결과 확인 전 새 생성 요청을 보내지 마세요.",
  "review-source-candidates": "수집된 선택 상품의 원본 후보 검토를 완료하세요.",
  "collect-source-photo": "선택 상품·옵션에 맞는 판매자 원본 사진을 다시 확보하세요. 원본 슬롯을 AI 연출 사진으로 대체하지 마세요.",
  "complete-image-slots": "기존 원고와 정상 사진을 보존하고 부족한 파트의 지정 사진만 준비하세요.",
  "repair-text-sections": "현재 원고의 실패 항목과 상품 근거를 조회한 뒤 해당 문단만 보완하세요.",
  "review-publication": "현재 본문과 실제 사진의 대응 및 최종 검사 결과를 확인하세요. 거부 코드만으로 사진 자체의 결함을 단정하지 마세요.",
  "inspect-current-state": "현재 실패 상세와 작업 상태를 먼저 조회하세요. 원인이 확인될 때까지 재작성·재생성을 추측하지 마세요.",
  "approve-material": "현재 원고·구성·사진의 최종 검증과 소재 승인을 완료하세요.",
  "verify-published-result": "이미 발행된 소재입니다. 저장된 게시 URL과 실제 게시물의 본문·사진을 조회해 결과를 확인하세요. 이 소재에 새 생성·발행 요청을 보내지 마세요.",
  "verify-scheduled-result": "이미 예약된 소재입니다. 저장된 예약 내역과 처리 결과를 조회하세요. 확인 없이 새 생성·중복 예약·즉시 발행 요청을 보내지 마세요.",
};

const CODES: Record<string, { category: Category; action: Action }> = {
  IMAGE_SOURCE_BINDING_REQUIRED: { category: "source", action: "collect-source-photo" },
  PREWRITING_PUBLICATION_SOURCE_UNAVAILABLE: { category: "source", action: "collect-source-photo" },
  SOURCE_REVIEW_INCOMPLETE: { category: "source", action: "review-source-candidates" },
  PREWRITING_SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE: { category: "source", action: "review-source-candidates" },
  IMAGE_RESUME_REQUIRED: { category: "recovery", action: "inspect-existing-output" },
  IMAGE_OUTPUT_AMBIGUOUS: { category: "recovery", action: "inspect-existing-output" },
  IMAGE_REQUEST_OUTCOME_UNKNOWN: { category: "recovery", action: "inspect-existing-output" },
  REFERENCE_SCENE_FIDELITY_FAILED: { category: "review", action: "review-publication" },
  REFERENCE_SCENE_NOT_EVIDENCE: { category: "review", action: "review-publication" },
  SEMANTIC_REJECTION: { category: "review", action: "review-publication" },
  PUBLISH_IMAGE_AUDIT_FAILED: { category: "review", action: "review-publication" },
  PHOTO_DESCRIPTION_SOURCE_CONFLICT: { category: "review", action: "review-publication" },
  REPLAN_NATURAL_PHOTOS_REQUIRED: { category: "images", action: "complete-image-slots" },
  "image-owner-unknown": { category: "recovery", action: "inspect-existing-output" },
  "content-quality": { category: "text", action: "repair-text-sections" },
  "draft-recheck-required": { category: "text", action: "repair-text-sections" },
  "text-qc-stale": { category: "text", action: "repair-text-sections" },
  "markdown-invalid": { category: "inspection", action: "inspect-current-state" },
  "content-render-mismatch": { category: "inspection", action: "inspect-current-state" },
  "affiliate-disclosure-position": { category: "text", action: "repair-text-sections" },
  "image-coverage": { category: "images", action: "complete-image-slots" },
  "generation-required": { category: "images", action: "complete-image-slots" },
  "hero-image-invalid": { category: "images", action: "complete-image-slots" },
  "image-publication-rejected": { category: "review", action: "review-publication" },
  "image-reference-review-invalid": { category: "review", action: "review-publication" },
  "image-scene-not-evidence": { category: "review", action: "review-publication" },
  "image-source-review-missing": { category: "review", action: "review-publication" },
  "image-asset-invalid": { category: "inspection", action: "inspect-current-state" },
  "image-asset-binding": { category: "inspection", action: "inspect-current-state" },
  "image-render-mismatch": { category: "inspection", action: "inspect-current-state" },
  "image-intent-stale": { category: "inspection", action: "inspect-current-state" },
  "image-output-duplicate": { category: "inspection", action: "inspect-current-state" },
  "image-natural-photo-role": { category: "images", action: "complete-image-slots" },
  "image-natural-photo-plan": { category: "images", action: "complete-image-slots" },
  "image-original-count": { category: "inspection", action: "inspect-current-state" },
  "image-plan-obsolete": { category: "images", action: "complete-image-slots" },
  "image-thumbnail-format-required": { category: "images", action: "complete-image-slots" },
  "image-format-obsolete": { category: "images", action: "complete-image-slots" },
  "image-full-frame-overlay": { category: "images", action: "complete-image-slots" },
  "image-geometry-invalid": { category: "inspection", action: "inspect-current-state" },
  "image-provenance-invalid": { category: "inspection", action: "inspect-current-state" },
  "image-scene-disclosure-missing": { category: "inspection", action: "inspect-current-state" },
  "generation-source": { category: "inspection", action: "inspect-current-state" },
  "composition-quality": { category: "inspection", action: "inspect-current-state" },
};

export interface MaterialPreparationDiagnosticInput {
  ready: boolean;
  approved: boolean;
  approvalReceiptCurrent: boolean;
  blockers?: readonly { code: string; sectionId?: string }[];
  contentPassed?: boolean;
  imageSlots?: readonly { sectionId: string; minimum: number; count?: number; missing: number;
    generationMissing: number; assets?: readonly unknown[] }[];
  sourceKinds?: Readonly<Record<string, string>>;
  imageGeneration?: { status: string; recoveryState?: string; errors?: readonly string[] } | null;
}

const count = (value: unknown): number => typeof value === "number" && Number.isFinite(value)
  ? Math.max(0, Math.min(1000, Math.floor(value))) : 0;
const sectionId = (value: unknown): string | null => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/u.test(value) ? value : null;

export function materialPreparationDiagnostics(input: MaterialPreparationDiagnosticInput) {
  const causes: Array<{ code: string; sectionId: string | null; category: Category; action: Action }> = [];
  const add = (code: string, id: unknown = null) => {
    if (!Object.hasOwn(CODES, code)) return;
    const safeId = sectionId(id);
    if (!causes.some(item => item.code === code && item.sectionId === safeId)) causes.push({ code, sectionId: safeId, ...CODES[code] });
  };
  const slots = (input.imageSlots || []).slice(0, 50);
  let unclassifiedError = false;
  if (!input.ready) {
    for (const blocker of (input.blockers || []).slice(0, 100)) add(blocker.code, blocker.sectionId);
    for (const error of (input.imageGeneration?.errors || []).slice(0, 30)) {
      if (typeof error !== "string") continue;
      const safeError = error.slice(0, 16000);
      const id = slots.find(slot => sectionId(slot.sectionId) && safeError.includes(`${slot.sectionId}:`))?.sectionId;
      let recognized = false;
      for (const match of safeError.matchAll(/(?<![A-Z0-9_])[A-Z][A-Z0-9_]{3,80}(?![A-Z0-9_])/gu)) {
        if (Object.hasOwn(CODES, match[0])) recognized = true;
        add(match[0], id);
      }
      if (safeError.trim() && !recognized) unclassifiedError = true;
    }
  }
  const progress = input.imageGeneration;
  const unrecognizedBlocker = (input.blockers || []).some(blocker => blocker.code !== "images-running" && !Object.hasOwn(CODES, blocker.code));
  const recoveryUncertain = progress?.recoveryState === "owner-unknown" || progress?.recoveryState === "owner-exited";
  const running = progress?.status === "running" || input.blockers?.some(item => item.code === "images-running");
  const stateUnclassified = unrecognizedBlocker || unclassifiedError || Boolean(progress && !["running", "complete", "incomplete"].includes(progress.status));
  const requiredSlots = slots.flatMap(slot => {
    const id = sectionId(slot.sectionId);
    const missing = count(slot.missing), generationMissing = count(slot.generationMissing);
    if (!id || !Math.max(missing, generationMissing)) return [];
    const sourceKind = input.sourceKinds?.[id] === "seller-original" ? "seller-original"
      : input.sourceKinds?.[id] === "staged-ai" ? "staged-ai" : "unknown";
    const relevant = causes.filter(cause => cause.sectionId === null || cause.sectionId === id);
    let nextAction: Action;
    if (recoveryUncertain || relevant.some(cause => cause.category === "recovery")) nextAction = "inspect-existing-output";
    else if (running) nextAction = "wait-current-job";
    else if (stateUnclassified) nextAction = "inspect-current-state";
    else if (relevant.some(cause => cause.action === "review-source-candidates")) nextAction = "review-source-candidates";
    else if (relevant.some(cause => cause.category === "review")) nextAction = "review-publication";
    else if (relevant.some(cause => cause.category === "inspection" && cause.code !== "composition-quality")) nextAction = "inspect-current-state";
    else if (sourceKind === "unknown") nextAction = "inspect-current-state";
    else if (sourceKind === "seller-original" || relevant.some(cause => cause.action === "collect-source-photo")) nextAction = "collect-source-photo";
    else nextAction = "complete-image-slots";
    return [{ sectionId: id, sourceKind, minimum: count(slot.minimum), verifiedCount: count(slot.count ?? slot.assets?.length),
      missing, generationMissing, missingUnique: Math.max(missing, generationMissing), nextAction }];
  });
  let action: Action = "inspect-current-state";
  if (input.ready) action = "ready";
  else if (recoveryUncertain || causes.some(item => item.category === "recovery")) action = "inspect-existing-output";
  else if (running) action = "wait-current-job";
  else if (stateUnclassified) action = "inspect-current-state";
  else if (causes.some(item => item.action === "review-source-candidates")) action = "review-source-candidates";
  else if (causes.some(item => item.category === "source")) action = causes.find(item => item.category === "source")!.action;
  else if (causes.some(item => item.category === "review")) action = "review-publication";
  else if (causes.some(item => item.category === "inspection" && (item.code !== "composition-quality" || !requiredSlots.length && input.contentPassed !== false))) action = "inspect-current-state";
  else if (requiredSlots.some(slot => slot.sourceKind === "seller-original")) action = "collect-source-photo";
  else if (requiredSlots.some(slot => slot.sourceKind === "unknown")) action = "inspect-current-state";
  else if (input.contentPassed === false || causes.some(item => item.category === "text")) action = "repair-text-sections";
  else if (requiredSlots.length || causes.some(item => item.category === "images")) action = "complete-image-slots";
  else if (input.approved && !input.approvalReceiptCurrent) action = "review-publication";
  else if (!input.approved && input.contentPassed === true) action = "approve-material";
  const states: Record<Action, string> = { ready: "ready", "wait-current-job": "in-progress", "inspect-existing-output": "needs-recovery",
    "review-source-candidates": "needs-source", "collect-source-photo": "needs-source", "complete-image-slots": "needs-images",
    "repair-text-sections": "needs-text", "review-publication": "needs-review", "inspect-current-state": "needs-inspection", "approve-material": "needs-approval",
    "verify-published-result": "published", "verify-scheduled-result": "scheduled" };
  return { version: "material-preparation-diagnostics/v1" as const, scope: "current-package" as const, state: states[action],
    missingBodyImages: requiredSlots.reduce((sum, slot) => sum + slot.missingUnique, 0),
    thumbnailRequired: !input.ready && (input.blockers || []).some(blocker => blocker.code === "hero-image-invalid" || blocker.code === "image-thumbnail-format-required"),
    requiredSlots, causes, nextAction: { action, instruction: ACTION_TEXT[action] } };
}

/** Package quality can pass while its product is active, scheduled or already
 * published. Apply the workflow guard to a fresh response view only. */
export function applyMaterialPreparationWorkflowGuard(
  diagnostics: ReturnType<typeof materialPreparationDiagnostics> | undefined,
  productStatus: string, imageStatus?: string | null,
) {
  let action: Action | null = null;
  let state = "";
  let instruction = "";
  if (productStatus === "OUTCOME_UNKNOWN") {
    action = "inspect-existing-output"; state = "outcome-unknown";
    instruction = "이전 작성·발행 요청의 결과가 확인되지 않았습니다. 저장된 작업과 게시 결과를 먼저 조회하세요. 결과 확인 전 자동 생성·재발행 요청을 보내지 마세요.";
  } else if (productStatus === "DRAFTING" || productStatus === "PUBLISHING" || imageStatus === "running") {
    action = "wait-current-job"; state = "in-progress";
    instruction = "현재 작성·이미지 준비 또는 발행 작업이 진행 중입니다. 해당 작업의 완료와 저장 결과를 조회하세요. 진행 중인 작업에 생성·발행 요청을 추가하지 마세요.";
  } else if (productStatus === "PUBLISHED") {
    action = "verify-published-result"; state = "published"; instruction = ACTION_TEXT[action];
  } else if (productStatus === "SCHEDULED") {
    action = "verify-scheduled-result"; state = "scheduled"; instruction = ACTION_TEXT[action];
  } else if (!["READY", "FAILED"].includes(productStatus)) {
    action = "inspect-current-state"; state = "needs-inspection";
    instruction = "현재 상품 작업 상태를 조회해 소재 준비·발행이 가능한지 확인하세요. 상태 확인 전 생성·발행 요청을 보내지 마세요.";
  }
  if (!action) return diagnostics || materialPreparationDiagnostics({ ready: false, approved: false, approvalReceiptCurrent: false });
  const base = diagnostics || materialPreparationDiagnostics({ ready: false, approved: false, approvalReceiptCurrent: false });
  return { ...base, scope: "current-material-workflow" as const, state,
    requiredSlots: base.requiredSlots.map(slot => ({ ...slot, nextAction: action })),
    nextAction: { action, instruction } };
}
