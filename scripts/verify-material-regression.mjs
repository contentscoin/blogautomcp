import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const runner = require.resolve('tsx/cli');
// Stop at the first failure. No account, provider, publication or paid generation.
const checks = [
  'verify-shopping-connect-access.ts', 'verify-naver-login-flow.ts', 'verify-connect-routing-regression.ts',
  'verify-connect-contract-store.ts', 'verify-image-resume-speed.ts',
  'verify-image-timeout-policy.ts', 'verify-image-batch-progress.ts',
  'verify-chatgpt-browser-automation.ts',
  'verify-product-section-review-conflicts.ts', 'verify-product-section-image-review.ts', 'verify-publish-image-audit.ts',
  'verify-publish-source-watermark.ts',
  'verify-rejected-original-repair.ts',
  'verify-publish-image-failure-diagnostics.ts',
  'verify-image-coverage-replan.ts', 'verify-material-image-recovery.ts',
  'verify-material-approval-semantics.ts', 'verify-scheduled-draft-workflow.ts',
  'verify-material-publication-receipt.ts',
  'verify-material-failure-reference.ts',
  'verify-photo-description-recovery.ts',
  'verify-photo-description-persistence.ts',
  'verify-shopping-prewrite-photos.ts',
  'verify-product-source-receipt-stability.ts',
  'verify-image-reference-context-stability.ts',
  'verify-completed-image-context-recovery.ts',
  'verify-shopping-reference-scene.ts',
  'verify-product-print-observability.ts',
  'verify-shopping-reference-view.ts',
  'verify-shopping-reference-bundle.ts',
  'verify-product-9canvas.ts',
  'verify-manual-revision-contract.ts',
  'verify-remote-product-reference-inputs.ts',
  'verify-shopping-thumbnail-copy.ts',
  'verify-product-photo-region.ts',
  'verify-source-selection-fairness.ts',
  'verify-prepared-draft-reference.ts',
  'verify-mcp-source-repair-coordination.ts',
  'verify-published-editor-audit.ts',
  'verify-travel-draft-resilience.ts', 'verify-naver-schedule-submission.ts',
];
for (const check of checks) {
  console.log(`\n[material-regression] ${check}`);
  const result = spawnSync(process.execPath, [runner, `scripts/${check}`], { stdio: 'inherit', timeout: 120_000 });
  if (result.error || result.status !== 0) {
    console.error(`FAILED: ${check}`, result.error?.message || `exit ${result.status}`);
    process.exit(1);
  }
}
console.log(`PASS: ${checks.length} material regression suites`);
