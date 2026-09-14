/** Run: node docs/qa/2026-09-07-approval-audit-fixtures.cjs
 * Offline regression reproductions. No network, browser, generation, DB, or writes.
 * Expected to pass while the audited defects exist. Update expectations after fixes.
 */
require('tsx/cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { packagePreview } = require('../../src/lib/brand-post-package.ts');
const { isDraftEditorialQualityPassed } = require('../../src/lib/brand-post-quality-display.ts');
const { runAutomaticDraftWorkflow } = require('../../scripts/lib/scheduled-draft-workflow.ts');
const root = path.resolve(__dirname, '../..');

async function main() {
  const nonexistent = path.join(root, '__approval_audit_nonexistent__');
  assert.equal(fs.existsSync(nonexistent), false, 'Fixture reads only nonexistent assets');
  const manifest = {
    version: 'brand-post-package/v2', brandLinkId: 'audit-in-memory', connectKind: 'SHOPPING',
    title: 'audit', generationSource: 'AI', markdownPath: path.join(nonexistent, 'post.md'),
    heroImagePath: path.join(nonexistent, 'hero.png'), bodyImagePaths: [], hashtags: [], approvedAt: null,
    composition: { sections: [], renderNodes: [], qualityReport: {
      preset: 'PREMIUM', score: 30, canAutoPublish: false, blockers: ['current image missing'], warnings: [],
    } },
    specValidation: { status: 'READY', score: 100, summary: 'old spec passed', repairTargets: [] },
    contentQuality: { canPublish: false, score: 96, reason: 'current fit missing', summary: 'current blocked',
      signals: [{ key: 'review-substance', label: 'fit missing', status: 'fail' }],
    },
  };
  const preview = packagePreview(manifest);
  assert.equal(preview.readiness.status, 'READY');
  assert.equal(preview.readiness.score, 100);
  assert.equal(preview.contentQuality.canPublish, false);
  assert.equal(preview.contentQuality.score, 96);
  console.log('REPRODUCED A1: readiness READY/100 coexists with blocked content/96');

  const categoryOnly = {
    canPublish: false, score: 60, code: 'quality-score-below-threshold',
    signals: [{ key: 'composition-quality', status: 'fail' }],
    quality: { score: 60, passScore: 70, categories: [{ key: 'usefulness', status: 'fail' }] },
  };
  assert.equal(isDraftEditorialQualityPassed(categoryOnly), true);
  console.log('REPRODUCED A4: failed category and low score classified as editorial PASS');

  // Confirm that the mocked rejection below matches the actual endpoint contract.
  // This is source-contract coverage, not an HTTP integration test.
  const route = fs.readFileSync(path.join(root, 'src/app/api/brandlinks/[id]/draft/route.ts'), 'utf8');
  assert.match(route, /existing\.version !== "brand-post-package\/v2" \|\| !existing\.postSpec/);
  assert.match(route, /code: "INVALID_INPUT", error: "이 초안은 Spec-first 스펙이 없어/);
  const events = [];
  await assert.rejects(runAutomaticDraftWorkflow('saved-freeform', { publishMode: 'now' }, {
    pause: async () => {},
    call: async (url, method, body) => {
      events.push(body?.action || `${method}:${url}`);
      if (body?.action === 'approve') throw Object.assign(new Error('quality blocked'), { code: 'CONTENT_BLOCKED' });
      if (body?.action === 'revise') throw Object.assign(new Error('Spec-first required'), { code: 'INVALID_INPUT' });
      return { success: true, data: { imageSlots: [] } };
    },
  }), /Spec-first required/);
  assert.deepEqual(events, ['GET:/api/brandlinks/saved-freeform/draft', 'recheck', 'approve', 'revise']);
  assert.equal(events.some((event) => event.includes('/publish')), false);
  console.log('REPRODUCED A2: freeform repair rejects; workflow ends with zero publication calls');
  console.log('PASS: all reproductions completed without writes or external calls');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
