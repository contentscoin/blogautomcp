/** Offline regression of real material gates and HTTP mutation handlers. No browser/provider/DB. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.scripts.json') });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'material-image-integrity-'));
process.env.DESKTOP_USER_DATA = root;
const store = require('../src/lib/brand-post-package');
const { resolvePostDocument, stableFreeformSectionId } = require('../src/lib/post-composition-contract');
const { getDraftApprovalBlockers } = require('../src/app/draft-approval-ui');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main() {
  const dir = store.getBrandPostPackageDir('fixture-image'); fs.mkdirSync(dir, { recursive: true });
  const images = ['hero', 'city', 'bathroom'].map(name => { const file = path.join(dir, name + '.png'); fs.writeFileSync(file, require('./lib/test-png-fixture').testPngFixture('fixture:' + name)); return file; });
  const sections = ['시티투어\n\n도시의 확인된 방문 코스 안내입니다.', '객실 욕실\n\n객실 내 욕실의 확인된 시설 안내입니다.'];
  const cityId = stableFreeformSectionId('TRAVEL', '시티투어');
  const bathroomId = stableFreeformSectionId('TRAVEL', '객실 욕실');
  const options = { connectKind: 'TRAVEL', title: '확인된 여행 정보', sections, imagePaths: images, hashtags: [], connectUrl: 'https://example.test/', qualityPreset: 'STANDARD' };
  const unassigned = resolvePostDocument(options);
  assert.ok(unassigned.sections.every(section => section.imagePaths.length === 0), 'unknown image meanings remain missing');
  assert.equal(unassigned.qualityReport.actual.images, 1, 'candidate images are not rendered coverage');
  const bindings = { [cityId]: [images[1]], [bathroomId]: [images[2]] };
  const composition = resolvePostDocument({ ...options, sectionImageBindings: bindings });
  const reordered = resolvePostDocument({ ...options, sections: [...sections].reverse(), sectionImageBindings: bindings });
  assert.equal(reordered.sections[0].id, bathroomId);
  assert.deepEqual(reordered.sections[0].imagePaths, [images[2]], 'reordering preserves semantic binding');
  const markdown = path.join(dir, 'post.md'); fs.writeFileSync(markdown, sections.join('\n\n'));
  const fixture = { version: 'brand-post-package/v2', brandLinkId: 'fixture-image', connectKind: 'TRAVEL', title: composition.title, generationSource: 'AI', markdownPath: markdown,
    heroImagePath: images[0], bodyImagePaths: images.slice(1), imageAssets: images.map((file, index) => ({ path: file, sourcePath: file, sha256: digest(file), role: index ? 'body' : 'hero',
      sectionId: index === 1 ? cityId : index === 2 ? bathroomId : null, provenance: 'ORIGINAL', creationMethod: 'source', remoteGenerated: false })),
    hashtags: [], imagePolicy: 'TRAVEL_EDITORIAL', createdAt: new Date().toISOString(), approvedAt: null, contractVersion: 'post-composition-contract/v1', composition,
    contentQuality: { canPublish: true, code: 'ok', reason: null, score: 96, summary: 'pass', signals: [] },
    specValidation: { status: 'BLOCKED', score: 0, summary: 'stale image failure', signals: [], repairTargets: [], generationSource: 'AI', attempts: 1 },
    thumbnailSpec: { version: 'thumbnail-spec/v2', canvas: { width: 1000, height: 1000, aspect: '1:1' }, style: 'fixture-image', sourcePolicy: 'TRAVEL_EDITORIAL', sourceImagePath: images[0] } };
  store.writeBrandPostPackageManifest(fixture);
  const preview = store.packagePreview(fixture);
  assert.equal(preview.approval.canApprove, true, 'verified originals meet default coverage');
  assert.equal(preview.readiness.status, 'READY', 'stale spec result cannot disagree with approval');
  assert.deepEqual(getDraftApprovalBlockers(preview), []);
  assert.ok(store.approveBrandPostPackage('fixture-image').approvedAt);
  const missingRender = { ...fixture, composition: { ...composition,
    renderNodes: composition.renderNodes.filter(node => node.kind !== 'image' || node.sectionId !== cityId) } };
  assert.ok(store.packagePreview(missingRender).approval.blockers.some(blocker => blocker.code === 'image-render-mismatch'));
  const textBound = { ...fixture, markdownSha256: digest(markdown) };
  fs.appendFileSync(markdown, '\nchanged text');
  assert.equal(store.packagePreview(textBound).approval.contentPassed, false, 'text changed after inspection cannot retain QC pass');
  fs.writeFileSync(markdown, sections.join('\n\n'));
  assert.equal(store.packagePreview(textBound).approval.contentPassed, true);
  assert.equal(store.packagePreview({ ...fixture, markdownPath: path.join(dir, 'absent.md') }).approval.contentPassed, false);
  assert.equal(store.packagePreview({ ...fixture, composition: { ...composition, title: 'changed rendering' } }).approval.contentPassed, false);
  const running = { ...fixture, imageGeneration: { status: 'running', requested: 2, applied: 0, remaining: 2, errors: [], updatedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), ownerPid: process.pid, ownerToken: 'fixture-owner' } };
  assert.equal(store.getBrandPostImageGenerationState(running).status, 'incomplete', 'same-process orphan is recoverable without waiting');
  assert.equal(running.imageGeneration.status, 'running', 'status preview is read-only');
  assert.equal(store.getBrandPostImageGenerationState({ ...running, imageGeneration: { ...running.imageGeneration, ownerPid: undefined } }).recoveryState, 'owner-unknown');
  const activeJobs = globalThis.brandPostImageJobs ||= new Set(); activeJobs.add(fixture.brandLinkId);
  assert.equal(store.getBrandPostImageGenerationState(running).status, 'running'); activeJobs.delete(fixture.brandLinkId);
  const originalKill = process.kill;
  try {
    process.kill = (_pid, signal) => { assert.equal(signal, 0); throw Object.assign(Error('dead'), { code: 'ESRCH' }); };
    assert.equal(store.getBrandPostImageGenerationState({ ...running, imageGeneration: { ...running.imageGeneration, ownerPid: process.pid + 1 } }).status, 'incomplete');
    process.kill = () => { throw Object.assign(Error('permission'), { code: 'EPERM' }); };
    assert.equal(store.getBrandPostImageGenerationState({ ...running, imageGeneration: { ...running.imageGeneration, ownerPid: process.pid + 1 } }).status, 'running', 'permission error is not proof of process exit');
  } finally { process.kill = originalKill; }
  const forced = store.packagePreview({ ...fixture, imageRequirements: { policy: 'generated-required' } });
  assert.equal(forced.approval.canApprove, false, 'generation required only by explicit policy');
  const local = store.packagePreview({ ...fixture, imageAssets: fixture.imageAssets.map(asset => ({ ...asset, provenance: 'EDITORIAL_CARD', creationMethod: 'local-composite' })) });
  assert.ok(local.imageSlots.every(slot => slot.generatedCount === 0), 'local editorial cards are not remote AI generations');
  const badQc = { ...fixture, contentQuality: { ...fixture.contentQuality, quality: { score: 96, passScore: 70, categories: [{ key: 'fit', label: '추천 대상', status: 'fail' }] } } };
  assert.equal(store.packagePreview(badQc).approval.contentPassed, false);
  assert.match(store.packagePreview(badQc).approval.blockers[0].reason, /추천 대상/);
  fs.writeFileSync(images[1], 'changed-after-selection');
  assert.equal(store.packagePreview(fixture).imageSlots[0].missing, 1, 'changed bytes invalidate stored image hash');
  assert.equal(store.packagePreview(fixture).approval.canApprove, false);
  fs.unlinkSync(images[1]);
  assert.equal(store.packagePreview(fixture).approval.canApprove, false, 'deleted file blocks approval');

  let status = 'READY', reads = 0, applies = 0, repairs = 0, loseClaim = false, applyFailure = null, updatedAt, readManifest = fixture;
  let activeRepair = false, repairFailure = null, repairResultErrors = null;
  let automation = false;
  let releaseApply;
  const fakePreview = { imageAssets: [], imageSlots: [{ sectionId: cityId, maximum: 1, count: 0, missing: 1, generationMissing: 0, assets: [] }] };
  const deps = { 'node:fs': fs, 'node:path': path, 'node:crypto': crypto,
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    '@/lib/db': { prisma: { brandLink: { findUnique: async () => ({ productName: 'fixture-image', status, updatedAt }), updateMany: async ({ where, data }) => {
      if (loseClaim && data.status === 'DRAFTING') { status = 'PUBLISHING'; return { count: 0 }; }
      if (status !== where.status) return { count: 0 }; status = data.status; return { count: 1 };
    } } } }, '@/lib/api-auth': { requireAdminApiKey: () => null }, '@/lib/update-guard': { requireNoPendingDesktopUpdate: () => null },
    '@/lib/desktop-activity': { beginDesktopActivity: () => () => {} },
    '@/lib/brand-post-package': { getBrandPostPackageDir: () => dir, getBrandPostImageGenerationState: store.getBrandPostImageGenerationState, normalizePackageImageAssets: () => [], packagePreview: () => fakePreview,
      readBrandPostPackage: (_id, options) => { reads++; assert.equal(options.migrate, false); return readManifest; } },
    '@/lib/brand-post-image-generation': { applyExternalGeneratedBrandPostImage: async () => { applies++; if (applyFailure) throw Error(applyFailure); await new Promise(resolve => { releaseApply = resolve; }); return { manifest: fixture }; } },
    '@/lib/brand-post-image-repair': { isBrandPostImageRepairActive: () => activeRepair, planSectionImageRequests: () => [{ requestId: 'fixture', sectionId: cityId }],
      repairBrandPostImages: async () => { repairs++; if (repairFailure) throw Error(repairFailure); return { manifest: fixture, generatedCount: 1, appliedCount: 1,
        errors: repairResultErrors || (automation ? ['section: CHATGPT_BROWSER_AUTH_REQUIRED: login'] : []) }; } },
    '@/lib/brand-post-image-replan': { replanShoppingImageCoverage: async () => { throw Error('Unexpected replan in route integrity fixture'); } },
    '@/lib/chatgpt-browser-automation': { isChatGptBrowserAutomationEnabled: () => automation } };
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/app/api/brandlinks/[id]/draft/images/route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { module: mod, exports: mod.exports, require: name => { assert.ok(name in deps, name); return deps[name]; }, process, console });
  const post = (action = 'apply_generated') => mod.exports.POST({ json: async () => ({ action, generatedPath: images[2], sectionId: cityId }) }, { params: Promise.resolve({ id: 'fixture-image' }) });
  activeRepair = true; status = 'READY'; const readsBeforeBusyHint = reads; const busyHint = await post('generate_missing');
  assert.equal(busyHint.status, 409); assert.equal(busyHint.body.code, 'IMAGE_REPAIR_BUSY'); assert.equal(reads, readsBeforeBusyHint);
  activeRepair = false;
  for (const busy of ['PUBLISHING', 'SCHEDULED', 'DRAFTING', 'PUBLISHED']) { status = busy; assert.equal((await post()).status, 409); }
  assert.equal(reads, 0); assert.equal(applies, 0);
  status = 'READY'; loseClaim = true; assert.equal((await post()).status, 409); assert.equal(reads, 0); loseClaim = false;
  status = 'READY'; const pending = post(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(status, 'DRAFTING'); assert.equal((await post()).status, 409); assert.equal(applies, 1);
  releaseApply(); assert.equal((await pending).status, 200); assert.equal(status, 'READY');
  status = 'FAILED'; applyFailure = 'fixture failure'; assert.equal((await post()).status, 422); assert.equal(status, 'FAILED', 'failure releases mutation claim');
  for (const conflictCode of ['IMAGE_REPAIR_BUSY', 'IMAGE_REPAIR_OWNERSHIP_LOST']) {
    status = 'READY'; applyFailure = `${conflictCode}: fixture apply conflict`;
    const conflict = await post();
    assert.equal(conflict.status, 409); assert.equal(conflict.body.code, conflictCode);
    assert.equal(status, 'READY', 'an apply ownership conflict releases the DB mutation claim');
  }
  applyFailure = null;
  for (const action of ['generate_missing', 'generate_section']) {
    status = 'READY'; const sourceFirst = await post(action); assert.equal(sourceFirst.status, 200);
    assert.equal(sourceFirst.body.success, true); assert.equal(status, 'READY', 'source-first completion releases claim');
  }
  for (const conflictCode of ['IMAGE_REPAIR_BUSY', 'IMAGE_REPAIR_OWNERSHIP_LOST']) {
    status = 'READY'; repairFailure = `${conflictCode}: fixture conflict`;
    const conflict = await post('generate_missing');
    assert.equal(conflict.status, 409); assert.equal(conflict.body.code, conflictCode);
    assert.equal(status, 'READY', 'a repair conflict releases the DB mutation claim');
  }
  repairFailure = null;
  for (const conflictCode of ['IMAGE_REPAIR_BUSY', 'IMAGE_REPAIR_OWNERSHIP_LOST']) {
    status = 'READY'; repairResultErrors = [`${conflictCode}: fixture returned conflict`];
    const conflict = await post('generate_missing');
    assert.equal(conflict.status, 409); assert.equal(conflict.body.code, conflictCode); assert.equal(conflict.body.success, false);
  }
  repairResultErrors = null;
  status = 'READY'; assert.equal((await post('regenerate')).status, 404); assert.equal(status, 'READY');
  assert.equal(repairs, 6, 'source-first repairs and authoritative lock conflicts both reach the repair boundary');
  status = 'DRAFTING'; readManifest = running; updatedAt = new Date(Date.parse(running.imageGeneration.heartbeatAt) - 1000);
  assert.equal((await post('generate_missing')).body.success, true);
  assert.equal(status, 'READY', 'explicit recovery releases a proven-dead owner DB claim');
  status = 'DRAFTING'; updatedAt = new Date(Date.parse(running.imageGeneration.heartbeatAt) + 1000);
  assert.equal((await post('generate_missing')).body.code, 'ALREADY_PUBLISHING');
  assert.equal(status, 'DRAFTING', 'never steal a newer draft mutation');
  status = 'READY'; automation = true; const partial = await post('generate_missing');
  assert.equal(partial.body.success, true); assert.equal(partial.body.generatedCount, 1);
  assert.equal(partial.body.code, 'CHATGPT_BROWSER_AUTH_REQUIRED', 'partial success retains the batch-level auth code');
  console.log('PASS material image integrity: semantic bindings, originals, canonical QC, stale result, changed/missing files, HTTP CAS race/exclusion/release. No external calls.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('material-image-integrity-'));
  fs.rmSync(resolved, { recursive: true, force: true });
});
