import test from "node:test";
import assert from "node:assert/strict";
import { applyMaterialPreparationWorkflowGuard, materialPreparationDiagnostics } from "../src/lib/material-preparation-diagnostics";

test('provider quota pauses preparation instead of recommending new source or image generation', () => {
  const diagnostics = materialPreparationDiagnostics({ ready: false, approved: false, approvalReceiptCurrent: false,
    contentPassed: true,
    blockers: [{ code: 'image-coverage', sectionId: 'shopping-source' }],
    imageSlots: [{ sectionId: 'shopping-source', minimum: 1, count: 0, missing: 1, generationMissing: 0 }],
    sourceKinds: { 'shopping-source': 'seller-original' },
    imageGeneration: { status: 'incomplete', errors: ['CODEX_USAGE_LIMIT_REACHED: provider unavailable'] },
  });
  assert.equal(diagnostics.state, 'needs-provider');
  assert.equal(diagnostics.nextAction.action, 'wait-provider-capacity');
  assert.equal(diagnostics.requiredSlots[0].nextAction, 'wait-provider-capacity');
  assert.equal(diagnostics.missingBodyImages, 1);
  assert.equal(applyMaterialPreparationWorkflowGuard(diagnostics, 'PUBLISHED').nextAction.action, 'verify-published-result');
  assert.equal(applyMaterialPreparationWorkflowGuard(diagnostics, 'OUTCOME_UNKNOWN').nextAction.action, 'inspect-existing-output');
});

test('current preparation diagnostics count missing slots once and keep source/recovery boundaries', () => {
  const fixture = { ready: false, approved: false, approvalReceiptCurrent: false, contentPassed: true,
    blockers: [{ code: 'image-coverage', sectionId: 'shopping-source' }, { code: 'generation-required', sectionId: 'shopping-scene' }],
    imageSlots: [
      { sectionId: 'shopping-source', minimum: 1, count: 0, missing: 1, generationMissing: 0, assets: [] },
      { sectionId: 'shopping-scene', minimum: 1, count: 0, missing: 1, generationMissing: 1, assets: [] },
    ], sourceKinds: { 'shopping-source': 'seller-original', 'shopping-scene': 'staged-ai' } };
  const result = materialPreparationDiagnostics(fixture);
  assert.equal(result.missingBodyImages, 2, 'coverage and generation requirement refer to the same missing scene');
  assert.equal(result.nextAction.action, 'collect-source-photo');
  assert.match(result.nextAction.instruction, /AI.*대체하지/u);
  assert.equal(result.requiredSlots[1].missingUnique, 1);
  const sceneOnly = materialPreparationDiagnostics({ ...fixture,
    blockers: [{ code: 'composition-quality' }, { code: 'image-coverage', sectionId: 'shopping-scene' }, { code: 'generation-required', sectionId: 'shopping-scene' }],
    imageSlots: [fixture.imageSlots[1]] });
  assert.equal(sceneOnly.nextAction.action, 'complete-image-slots', 'generic composition failure does not hide the known missing generated slot');
  assert.equal(sceneOnly.missingBodyImages, 1);
  const recovering = materialPreparationDiagnostics({ ...fixture, imageGeneration: { status: 'incomplete',
    errors: ['shopping-scene: IMAGE_OUTPUT_AMBIGUOUS: C:\\private\\photo.png token=secret-random-value'] } });
  assert.equal(recovering.nextAction.action, 'inspect-existing-output');
  assert.equal(recovering.requiredSlots[1].nextAction, 'inspect-existing-output');
  const recoveryCause = recovering.causes.find(cause => cause.code === 'IMAGE_OUTPUT_AMBIGUOUS');
  assert.ok(recoveryCause, 'the whitelisted current recovery cause is present');
  assert.equal(recoveryCause.sectionId, 'shopping-scene');
  assert.doesNotMatch(JSON.stringify(recovering), /private|photo\.png|secret-random-value|token=/u);
  const semantic = materialPreparationDiagnostics({ ...fixture, imageGeneration: { status: 'incomplete', errors: ['shopping-scene: SEMANTIC_REJECTION: wrong?'] } });
  assert.equal(semantic.nextAction.action, 'review-publication');
  assert.match(semantic.nextAction.instruction, /사진 자체의 결함을 단정하지/u);
  assert.doesNotMatch(JSON.stringify(semantic), /wrong\?/u);
  const incompleteSource = materialPreparationDiagnostics({ ...fixture, imageGeneration: { status: 'incomplete', errors: ['SOURCE_REVIEW_INCOMPLETE: transient provider response'] } });
  assert.equal(incompleteSource.nextAction.action, 'review-source-candidates');
  const ownerUnknown = materialPreparationDiagnostics({ ...fixture, imageGeneration: { status: 'running', recoveryState: 'owner-unknown', errors: [] } });
  assert.equal(ownerUnknown.nextAction.action, 'inspect-existing-output', 'running flag cannot authorize another request when owner is unknown');
  const running = materialPreparationDiagnostics({ ...fixture, imageGeneration: { status: 'running', errors: [] } });
  assert.equal(running.nextAction.action, 'wait-current-job');
  const unrecognized = materialPreparationDiagnostics({ ...fixture, blockers: [{ code: 'private-unrecognized-code' }] });
  assert.equal(unrecognized.nextAction.action, 'inspect-current-state');
  assert.doesNotMatch(JSON.stringify(unrecognized), /private-unrecognized-code/u);
  const unclassifiedError = materialPreparationDiagnostics({ ...fixture, imageGeneration: { status: 'incomplete', errors: ['UNLISTED_PROVIDER_FAILURE: private token=never-return'] } });
  assert.equal(unclassifiedError.nextAction.action, 'inspect-current-state', 'an unknown generation outcome requires a fresh status query');
  assert.doesNotMatch(JSON.stringify(unclassifiedError), /UNLISTED_PROVIDER_FAILURE|never-return/u);
  const unknownRole = materialPreparationDiagnostics({ ...fixture, blockers: [], sourceKinds: {} });
  assert.equal(unknownRole.nextAction.action, 'inspect-current-state', 'unknown slot role cannot authorize generated replacement');
  const ready = materialPreparationDiagnostics({ ...fixture, ready: true, approved: true, approvalReceiptCurrent: true,
    imageSlots: [], imageGeneration: { status: 'complete', errors: ['IMAGE_OUTPUT_AMBIGUOUS: historical secret'] } });
  assert.equal(ready.state, 'ready');
  assert.deepEqual(ready.causes, [], 'a historical error cannot relabel a currently ready material');
  assert.equal(ready.missingBodyImages, 0);
  const approval = materialPreparationDiagnostics({ ready: false, approved: false, approvalReceiptCurrent: false, contentPassed: true });
  assert.equal(approval.state, 'needs-approval');
  const pendingReview = materialPreparationDiagnostics({ ready: false, approved: true, approvalReceiptCurrent: false, contentPassed: true });
  assert.equal(pendingReview.state, 'needs-review');
});

test('seller-original slots prioritize scoped and global unfinished source review before collection', () => {
  const base = { ready: false, approved: false, approvalReceiptCurrent: false, contentPassed: true,
    blockers: [{ code: 'image-coverage', sectionId: 'shopping-source' }, { code: 'generation-required', sectionId: 'shopping-scene' }],
    imageSlots: [
      { sectionId: 'shopping-source', minimum: 1, count: 0, missing: 1, generationMissing: 0 },
      { sectionId: 'shopping-scene', minimum: 1, count: 0, missing: 1, generationMissing: 1 },
    ], sourceKinds: { 'shopping-source': 'seller-original', 'shopping-scene': 'staged-ai' } };
  for (const prefix of ['', 'shopping-source: ']) {
    const diagnostic = materialPreparationDiagnostics({ ...base, imageGeneration: { status: 'incomplete', errors: [
      'shopping-source: IMAGE_SOURCE_BINDING_REQUIRED: source assignment has not succeeded',
      `${prefix}SOURCE_REVIEW_INCOMPLETE: collected candidates still need checking`,
    ] } });
    assert.equal(diagnostic.nextAction.action, 'review-source-candidates');
    assert.equal(diagnostic.requiredSlots[0].nextAction, 'review-source-candidates', 'missing verified original does not prove no unreviewed candidate exists');
    assert.equal(diagnostic.requiredSlots[1].nextAction, prefix ? 'complete-image-slots' : 'review-source-candidates');
  }
  const missing = materialPreparationDiagnostics({ ...base, imageGeneration: { status: 'incomplete', errors: [
    'shopping-source: IMAGE_SOURCE_BINDING_REQUIRED: inspected original is unavailable',
  ] } });
  assert.equal(missing.nextAction.action, 'collect-source-photo');
  assert.equal(missing.requiredSlots[0].nextAction, 'collect-source-photo');
  assert.equal(missing.requiredSlots[1].nextAction, 'complete-image-slots');
});

test('seller-original slots and ordinary staged slots honor scoped/global uncertain requests and running owners', () => {
  const base = { ready: false, approved: false, approvalReceiptCurrent: false, contentPassed: true, blockers: [],
    imageSlots: [
      { sectionId: 'shopping-source', minimum: 1, count: 0, missing: 1, generationMissing: 0 },
      { sectionId: 'shopping-scene', minimum: 1, count: 0, missing: 1, generationMissing: 1 },
    ], sourceKinds: { 'shopping-source': 'seller-original', 'shopping-scene': 'staged-ai' } };
  for (const code of ['IMAGE_OUTPUT_AMBIGUOUS', 'IMAGE_RESUME_REQUIRED']) for (const prefix of ['', 'shopping-source: ']) {
    const diagnostic = materialPreparationDiagnostics({ ...base, imageGeneration: { status: 'incomplete', errors: [`${prefix}${code}: existing request not reconciled`] } });
    assert.equal(diagnostic.nextAction.action, 'inspect-existing-output');
    assert.equal(diagnostic.requiredSlots[0].nextAction, 'inspect-existing-output');
    assert.equal(diagnostic.requiredSlots[1].nextAction, prefix ? 'complete-image-slots' : 'inspect-existing-output');
  }
  const unknown = materialPreparationDiagnostics({ ...base, imageGeneration: { status: 'incomplete', errors: ['unclassified failed response'] } });
  assert.ok(unknown.requiredSlots.every(slot => slot.nextAction === 'inspect-current-state'));
  const running = materialPreparationDiagnostics({ ...base, imageGeneration: { status: 'running', errors: [] } });
  assert.ok(running.requiredSlots.every(slot => slot.nextAction === 'wait-current-job'));
  const ownerUnknown = materialPreparationDiagnostics({ ...base, imageGeneration: { status: 'running', recoveryState: 'owner-unknown', errors: [] } });
  assert.ok(ownerUnknown.requiredSlots.every(slot => slot.nextAction === 'inspect-existing-output'));
});

test('workflow response guards replace actions without mutating a saved package diagnostic', () => {
  const saved = materialPreparationDiagnostics({ ready: false, approved: false, approvalReceiptCurrent: false, contentPassed: true,
    imageSlots: [{ sectionId: 'shopping-scene', minimum: 1, missing: 1, generationMissing: 1 }], sourceKinds: { 'shopping-scene': 'staged-ai' } });
  const before = JSON.stringify(saved);
  Object.freeze(saved.requiredSlots[0]); Object.freeze(saved.requiredSlots); Object.freeze(saved.nextAction); Object.freeze(saved);
  for (const [status, expected] of [
    ['DRAFTING', 'wait-current-job'], ['PUBLISHING', 'wait-current-job'], ['OUTCOME_UNKNOWN', 'inspect-existing-output'],
    ['PUBLISHED', 'verify-published-result'], ['SCHEDULED', 'verify-scheduled-result'],
  ] as const) {
    const guarded = applyMaterialPreparationWorkflowGuard(saved, status)!;
    assert.notEqual(guarded, saved);
    assert.equal(guarded.scope, 'current-material-workflow');
    assert.equal(guarded.nextAction.action, expected);
    assert.ok(guarded.requiredSlots.every(slot => slot.nextAction === expected));
    assert.equal(JSON.stringify(saved), before, 'cached package diagnosis survives each workflow view unchanged');
  }
  assert.equal(applyMaterialPreparationWorkflowGuard(saved, 'READY'), saved);
  assert.equal(applyMaterialPreparationWorkflowGuard(saved, 'FAILED'), saved);
  assert.equal(applyMaterialPreparationWorkflowGuard(saved, 'READY', 'running')?.nextAction.action, 'wait-current-job');
  assert.match(applyMaterialPreparationWorkflowGuard(saved, 'OUTCOME_UNKNOWN')!.nextAction.instruction, /자동 생성·재발행 요청을 보내지/u);
  assert.equal(applyMaterialPreparationWorkflowGuard(undefined, 'OUTCOME_UNKNOWN').nextAction.action, 'inspect-existing-output');
  assert.equal(applyMaterialPreparationWorkflowGuard(undefined, 'READY').nextAction.action, 'inspect-current-state', 'missing additive diagnostic cannot imply approval');
});
