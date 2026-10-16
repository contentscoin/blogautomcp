/* eslint-disable @typescript-eslint/no-require-imports -- Offline VM regression fixture. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

function load(relative, dependencies) {
  const filename = path.resolve(relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const fixture = { exports: {} };
  new vm.Script(source, { filename }).runInNewContext({ exports: fixture.exports, module: fixture, Buffer, Date, process,
    require(name) { if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; } });
  return fixture.exports;
}

function harness() {
  const root = path.resolve('/fixture-material-data');
  const id = 'product_0001';
  const directory = path.join(root, 'prepared-brand-posts', id);
  const image = path.join(directory, 'photo.png');
  const reference = path.join(directory, 'reference.png');
  const markdown = path.join(directory, 'draft.md');
  const gallery = path.join(directory, 'product-sources');
  const manifest = { version: 'brand-post-package/v2', brandLinkId: id, title: 'Saved material', connectKind: 'SHOPPING',
    createdAt: '2026-10-15T00:00:00Z', approvedAt: '2026-10-15T00:01:00Z', markdownPath: markdown,
    heroImagePath: image, bodyImagePaths: [image], contentQuality: { canPublish: true, score: 100 },
    imageAssets: [{ path: image, sha256: crypto.createHash('sha256').update('good').digest('hex'), sourcePath: reference,
      referenceScene: { referencePath: reference } }],
    composition: { sections: [{ id: 'section-a', imagePaths: [image] }], renderNodes: [{ kind: 'image', assetPath: image }],
      qualityReport: { canAutoPublish: true } },
    textQualityRevalidation: { checkedAt: '2026-10-15T00:01:00Z' } };
  const state = { manifestReads: 0, photoReads: 0, synchronousReads: 0, stamps: new Map(), galleryNames: [], missing: new Set(), bytes: 'good' };
  const asyncFs = {
    readFile: async file => {
      if (file === path.join(directory, 'manifest.json')) { state.manifestReads++; return JSON.stringify(manifest); }
      state.photoReads++; throw new Error(`Summary attempted forbidden byte read ${file}`);
    },
    stat: async file => {
      if (state.missing.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { dev: 1n, ino: 1n, size: 4n, mtimeNs: BigInt(state.stamps.get(file) || 1),
        ctimeNs: BigInt(state.stamps.get(file) || 1), mode: 1n };
    },
    readdir: async () => state.galleryNames,
  };
  const summary = load('src/lib/material-summary.ts', {
    'node:crypto': crypto, 'node:fs/promises': asyncFs, 'node:path': path,
    '../../scripts/lib/app-paths': { getAppDataDir: () => root, getProjectRoot: () => root },
    '../../scripts/lib/publish-image-audit': { PUBLICATION_IMAGE_AUDIT_POLICY_FILES: ['policy.ts'] },
    './brand-post-package': { getBrandPostImageGenerationState: value => value.imageGeneration },
  });
  const strictFs = { readFileSync: () => { state.synchronousReads++; return Buffer.from(state.bytes); }, readdirSync: () => [] };
  let approvedBinding;
  const receipt = load('src/lib/brand-post-approval-receipt.ts', {
    'node:crypto': crypto, 'node:fs': strictFs, 'node:path': path,
    '../../scripts/lib/publish-image-audit': { publicationImageAuditPolicyFingerprint: () => 'fixture-policy' },
    '../../scripts/lib/product-photo-provenance': { readProductPhotoSource: () => null },
    '../../scripts/lib/publish-image-audit-receipt': { readSuccessfulImageAuditReadinessBinding: (_id, binding) => binding === approvedBinding },
  });
  approvedBinding = receipt.brandPostApprovalBinding(manifest, gallery);
  state.synchronousReads = 0;
  const strict = load('src/lib/material-library.ts', {
    'node:crypto': crypto, 'node:path': path,
    'node:fs': strictFs,
    './brand-post-package': { readBrandPostPackage: () => manifest, getBrandPostPackageDir: () => directory,
      // Hold the independent quality gates passing: the actual approval-byte
      // binding below must independently reject unchanged-stat tampering.
      evaluateBrandPostPackageReadiness: () => ({ blockers: [],
        contentScore: 100, composition: manifest.composition, contentPassed: true, imageSlots: [] }) },
    './brand-post-approval-receipt': receipt,
    './material-preparation-diagnostics': { materialPreparationDiagnostics: () => undefined },
  });
  return { id, directory, image, reference, markdown, gallery, root, manifest, state, summary, strict };
}

test('cold and repeated summary requests read zero image/manuscript bytes and coalesce concurrent consumers', async () => {
  const h = harness();
  const reads = Array.from({ length: 20 }, () => h.summary.getMaterialSummary(h.id));
  assert(reads.every(promise => promise === reads[0]), 'concurrent requests share one metadata operation');
  const records = await Promise.all(reads);
  assert.equal(h.state.manifestReads, 1);
  assert.equal(records[0].verification.strict, false);
  assert.equal(records[0].verification.requiresFullVerification, true);
  assert.equal(records[0].verification.contentCheckedAt, h.manifest.textQualityRevalidation.checkedAt);
  for (let i = 0; i < 10; i++) assert.equal((await h.summary.getMaterialSummary(h.id)).revision, records[0].revision);
  assert.equal(h.state.photoReads, 0);
  assert.equal(h.state.synchronousReads, 0);
});

test('image, reference, manuscript, source-gallery membership, policy and receipts invalidate the summary observation', async () => {
  const h = harness();
  let revision = (await h.summary.getMaterialSummary(h.id)).revision;
  const paths = [h.image, h.reference, h.markdown, `${h.image}.source.json`, path.join(h.root, 'policy.ts'),
    path.join(h.directory, 'publish-image-rejections.json'),
    path.join(h.root, 'publication-image-audit-receipts', `${crypto.createHash('sha256').update(h.id).digest('hex')}.json`)];
  for (const file of paths) {
    h.state.stamps.set(file, 2);
    const next = await h.summary.getMaterialSummary(h.id);
    assert.notEqual(next.revision, revision, `metadata change detected: ${path.basename(file)}`);
    assert.equal(next.verification.changedSinceObservation, true);
    revision = next.revision;
  }
  h.state.galleryNames.push('new-original.jpg', 'new-original.jpg.retrieval.json');
  const added = await h.summary.getMaterialSummary(h.id);
  assert.notEqual(added.revision, revision, 'new seller gallery membership is bound');
  revision = added.revision;
  h.manifest.title = 'Changed title';
  assert.notEqual((await h.summary.getMaterialSummary(h.id)).revision, revision);
  assert.equal(h.state.photoReads, 0);
});

test('summary cannot authorize unchanged-stat tampering; default strict path still reads fresh bytes', async () => {
  const h = harness();
  const original = h.strict.getMaterial(h.id);
  assert.equal(original.ready, true);
  const summary = await h.summary.getMaterialSummary(h.id);
  h.state.bytes = 'evil'; // Same size; all metadata remains exactly unchanged.
  assert.equal((await h.summary.getMaterialSummary(h.id)).revision, summary.revision);
  assert.equal(summary.verification.strict, false, 'UI display is explicitly not current-byte proof');
  const changed = h.strict.getMaterial(h.id);
  assert.equal(changed.ready, false);
  assert.notEqual(changed.revision, original.revision);
  assert(h.state.synchronousReads > 0, 'default getMaterial never adopts UI summary cache');
});

test('a requested strict verdict updates only its matching ephemeral summary and is invalidated by changed metadata', async () => {
  const h = harness();
  const saved = await h.summary.getMaterialSummary(h.id);
  h.state.bytes = 'evil'; // Same-size mutation, metadata deliberately restored.
  const failed = h.strict.getMaterial(h.id);
  assert.equal(failed.ready, false);
  assert.equal(h.summary.observeStrictMaterialSummary(h.id, saved.revision, failed), true);
  const observedFailure = await h.summary.getMaterialSummary(h.id);
  assert.equal(observedFailure.ready, false);
  assert.equal(observedFailure.revision, saved.revision, 'strict authority revision never replaces the UI token');
  assert.equal(observedFailure.verification.strict, false);
  assert.equal(observedFailure.verification.lastStrictResult, 'blocked');
  assert(observedFailure.verification.lastStrictCheckAt);
  assert.match(observedFailure.blockers.join(' '), /최종 이미지/);
  h.state.bytes = 'good';
  assert.equal(h.summary.observeStrictMaterialSummary(h.id, saved.revision, h.strict.getMaterial(h.id)), true);
  assert.equal((await h.summary.getMaterialSummary(h.id)).ready, true);
  h.state.stamps.set(h.image, 2);
  const changed = await h.summary.getMaterialSummary(h.id);
  assert.notEqual(changed.revision, saved.revision);
  assert.equal(changed.verification.changedSinceObservation, true);
  assert.equal(changed.verification.lastStrictResult, undefined, 'a new signature has no old byte-strict observation');
  assert.equal(h.summary.observeStrictMaterialSummary(h.id, saved.revision, failed), false, 'racing old observation cannot overwrite new metadata');
  assert.equal((await h.summary.getMaterialSummary(h.id)).verification.lastStrictResult, undefined);
  assert.equal(h.state.photoReads, 0, 'feedback never adds automatic photo reads');
});

test('missing current photo blocks the saved projection; unused historical assets are not newly required', async () => {
  const h = harness();
  const historical = path.join(h.directory, 'unused-history.png');
  h.manifest.imageAssets.push({ path: historical, sha256: 'f'.repeat(64) });
  h.state.missing.add(historical);
  const saved = await h.summary.getMaterialSummary(h.id);
  assert.equal(saved.ready, true);
  assert.equal(saved.verification.missingRequiredFiles, 0);
  h.state.missing.add(h.image);
  const missing = await h.summary.getMaterialSummary(h.id);
  assert.equal(missing.ready, false);
  assert.equal(missing.verification.missingRequiredFiles, 1);
  assert.notEqual(missing.revision, saved.revision);
});

test('default repair eligibility reads one target and retains uncertain publication exclusions', async () => {
  const state = { materialReads: [], productQueries: 0, jobs: [] };
  const product = { id: 'product_0001', productName: 'Fixture', status: 'READY', connectKind: 'SHOPPING' };
  const material = id => { state.materialReads.push(id); return { ready: false, revision: 'b'.repeat(64), blockers: ['needs photo'] }; };
  const candidates = load('src/lib/material-repair-candidates.ts', {
    'node:fs': {}, './db': {}, './material-library': {}, './brand-post-package': {}, './publish-attempt': {}, './material-job-store': {},
  });
  const filename = path.resolve('src/lib/material-job-runner.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'canStillRepairProduct');
  const compiled = ts.transpileModule(`${declaration.getText(ast)}\nexports.probe = canStillRepairProduct;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported = {};
  new vm.Script(compiled).runInNewContext({ exports: exported,
    prisma: { brandLink: { findUnique: async ({ where }) => { state.productQueries++; assert.equal(where.id, product.id); return product; },
      findMany: () => { throw new Error('Full material-library scan is forbidden'); } } },
    listMaterialJobs: () => state.jobs,
    selectMaterialRepairCandidates: candidates.selectMaterialRepairCandidates,
    getMaterial: material, hasSavedMaterialDraft: () => true, readPublishAttempt: () => null,
  });
  const job = { jobId: 'current-repair', connectKind: 'SHOPPING' };
  assert.equal(await exported.probe(product.id, job), true);
  assert.deepEqual(state.materialReads, [product.id]);
  state.jobs = [{ jobId: 'old-unknown', kind: 'publish', startedAt: '2026-10-14T00:00:00Z',
    items: [{ productId: product.id, status: 'outcome_unknown', errorCode: 'OUTCOME_UNKNOWN' }] }];
  assert.equal(await exported.probe(product.id, job), false);
  assert.equal(state.materialReads.length, 1, 'uncertain submission cannot even reach the image reader');
  assert.equal(state.productQueries, 2);
});
