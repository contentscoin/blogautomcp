const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const quietConsole = { log() {}, error() {}, warn() {} };
function load(file, mocks = {}, globals = {}, tail = '') {
  const filename = path.resolve(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8') + tail, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => name in mocks ? mocks[name] : name.startsWith('.')
      ? load(path.resolve(path.dirname(filename), `${name}.ts`), mocks, globals) : require(name),
    process: { env: {}, cwd: () => root }, console: quietConsole, Error, Buffer,
    Request, Response, Headers, URL, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval,
    ...globals,
  }, { filename });
  return module.exports;
}
const helper = load('scripts/lib/draft-section-contract.ts');
const disclosure = load('src/lib/connect-disclosure.ts');
const errors = load('src/lib/local-automation-error.ts');
const agentFile = path.join(root, 'scripts/simple-agent.ts');
const agentAst = ts.createSourceFile(agentFile, fs.readFileSync(agentFile, 'utf8'), ts.ScriptTarget.Latest, true);
function agentFunctions(names, globals = {}) {
  const nodes = names.map(name => agentAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name));
  assert.ok(nodes.every(Boolean), 'test must exercise the actual agent functions');
  const code = ts.transpileModule(nodes.map(node => node.getText(agentAst)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ ...helper, ...disclosure, Error, path, console: quietConsole,
    normalizeText: value => value.replace(/\s+/gu, ' ').trim(),
    getDefaultSectionTitles: () => ['본문'],
    codexDraftTerminalFailureCode: () => null,
    getErrorMessage: error => error instanceof Error ? error.message : String(error),
    ...globals,
  });
  vm.runInContext(`${code}\nthis.api = { ${names.join(', ')} };`, context);
  return context.api;
}
const normalizer = agentFunctions(['stripEmoji', 'stripSectionPrefix', 'isInstructionLeakLine', 'normalizeSectionText', 'normalizeSections']);
function sections(count) {
  return Array.from({ length: count }, (_, index) => {
    const heading = index === count - 2 ? 'FAQ 질문과 답변' : index === count - 1 ? '조건별 결론' : `확인 항목 ${index + 1}`;
    return `${heading}\n\n확인된 상품 근거 ${index + 1}은 해당 사용 환경에서 선택 기준으로 참고할 수 있어요.\n구성 및 규격 ${index + 1}은 확인된 범위에서 설명하며 다른 조건으로 확대하지 않아요.\n${'이 문단의 검증 자료와 사용 조건을 연결해서 판단합니다. '.repeat(2)}${index === count - 2 ? 'FAQ_KEEP' : index === count - 1 ? 'CONCLUSION_KEEP' : ''}`;
  });
}
function countError(run, stage, count) {
  let failure;
  try { run(); } catch (error) { failure = error; }
  assert.ok(failure instanceof helper.DraftSectionCountError, 'must reject with the structural error, not return clipped text');
  assert.equal(failure.code, 'DRAFT_SECTION_COUNT_OUT_OF_RANGE');
  assert.equal(failure.details.stage, stage);
  assert.equal(failure.details.sectionCount, count);
  assert.match(failure.nextAction, /post_submit_draft/u);
  assert.match(failure.nextAction, /post_revise_draft는 저장된 섹션 수를 변경하지 않습니다/u);
  return failure;
}

for (const [kind, minimum, maximum] of [['SHOPPING', 5, 8], ['TRAVEL', 7, 12]]) {
  for (const count of [minimum, maximum]) test(`${kind} ${count} sections preserve the FAQ and final conclusion`, () => {
    const input = sections(count);
    const before = JSON.stringify(input);
    helper.validateSubmittedDraftSectionCount(input, kind);
    const output = normalizer.normalizeSections(input, minimum, maximum, kind);
    assert.equal(output.length, count);
    assert.match(output.at(-2), /FAQ_KEEP/u);
    assert.match(output.at(-1), /CONCLUSION_KEEP/u);
    assert.equal(JSON.stringify(input), before, 'validation must not mutate the submitted manuscript');
  });
  test(`${kind} raw overflow is rejected instead of clipping tail sections`, () => {
    const input = sections(maximum + 1);
    const before = JSON.stringify(input);
    const failure = countError(() => helper.validateSubmittedDraftSectionCount(input, kind), 'submitted', maximum + 1);
    assert.deepEqual(Array.from(failure.details.sourceSectionIndexes), [maximum]);
    countError(() => normalizer.normalizeSections(input, minimum, maximum, kind), 'submitted', maximum + 1);
    assert.equal(JSON.stringify(input), before);
    assert.match(input.at(-2), /FAQ_KEEP/u);
    assert.match(input.at(-1), /CONCLUSION_KEEP/u);
  });
  test(`${kind} below the submission minimum is rejected`, () => {
    countError(() => helper.validateSubmittedDraftSectionCount(sections(minimum - 1), kind), 'submitted', minimum - 1);
  });
  test(`${kind} a legal raw count expanding beyond the maximum reports original indexes`, () => {
    const input = sections(maximum);
    input[0] += '\n\n주요 기능 1\n\n추가 기능의 확인 근거를 따로 설명합니다.\n확인된 사용 조건도 함께 설명합니다.';
    const before = JSON.stringify(input);
    const failure = countError(() => helper.validateSubmittedDraftSectionCount(input, kind), 'expanded', maximum + 1);
    assert.deepEqual(Array.from(failure.details.sourceSectionIndexes), [maximum - 1]);
    assert.equal(failure.details.expandedSectionCounts[0], 2);
    countError(() => normalizer.normalizeSections(input, minimum, maximum, kind), 'expanded', maximum + 1);
    assert.equal(JSON.stringify(input), before);
  });
}
test('ordinary short lines and existing FAQ pairs do not create new boundaries', () => {
  const input = sections(8);
  input[6] += '\nQ. 관리할 때 무엇을 확인하나요?\nA. 표기된 관리 조건을 먼저 확인해요.\n짧은 부연 설명\n문장 없는 줄';
  helper.validateSubmittedDraftSectionCount(input, 'SHOPPING');
  assert.equal(helper.expandDraftSectionEntries(input).length, 8);
  assert.equal(normalizer.normalizeSections(input, 5, 8, 'SHOPPING').length, 8);
});
test('automatic drafts can shape a merged array without inventing or dropping body text', () => {
  const input = ['구매 전 확인 포인트\n\n처음 선택할 때 확인한 사실이에요.\n조건을 먼저 설명해요.\n주요 기능 1\n\n첫째 기능의 자료예요.\n이 자료를 연결해요.\n주요 기능 2\n\n둘째 기능의 자료예요.\n이 조건을 연결해요.\n아쉬운 점\n\n제약을 설명해요.\n해당 조건을 확인해요.\n이런 분께 잘 맞아요\n\n사용 대상을 설명해요.\nCONCLUSION_KEEP를 마지막에 유지해요.'];
  const output = normalizer.normalizeSections(input, 5, 8, 'SHOPPING');
  assert.equal(output.length, 5);
  assert.match(output.at(-1), /CONCLUSION_KEEP/u);
});
test('canonical shopping and travel disclosures survive polishing unchanged', () => {
  const api = agentFunctions(['applyHumanMobilePolishToDisclosure']);
  for (const kind of ['SHOPPING', 'TRAVEL']) {
    const canonical = disclosure.getConnectAffiliateDisclosure(kind);
    assert.equal(api.applyHumanMobilePolishToDisclosure(canonical).trim(), canonical);
    assert.doesNotMatch(api.applyHumanMobilePolishToDisclosure(canonical), /수 있습니다|수 있어요/u);
  }
});
test('the structural error stays explicit through local and child-process classifiers', () => {
  const failure = countError(() => helper.validateSubmittedDraftSectionCount(sections(9), 'SHOPPING'), 'submitted', 9);
  assert.equal(errors.classifyLocalFailure({ status: 422, code: failure.code, message: failure.message }), failure.code);
  const api = agentFunctions(['classifyFailureCode']);
  assert.equal(api.classifyFailureCode(failure), failure.code);
  assert.equal(api.classifyFailureCode(new Error('outer', { cause: failure })), failure.code);
});

function routeFixture(kind, inputSections) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-count-reject-'));
  const manifestPath = path.join(directory, 'manifest.json');
  const manuscriptPath = path.join(directory, 'post.md');
  const manifest = JSON.stringify({ version: 'brand-post-package/v2', approvedAt: '2026-10-01T00:00:00Z', title: '승인된 원고', imageAssets: [{ sha256: 'fixture-image-hash' }] });
  fs.writeFileSync(manifestPath, manifest);
  fs.writeFileSync(manuscriptPath, '# 승인된 원고\n\n보존할 본문');
  const before = [fs.readFileSync(manifestPath), fs.readFileSync(manuscriptPath)];
  const effects = [];
  const failMutation = label => () => { effects.push(label); throw Error(`unexpected mutation ${label}`); };
  const guardedFs = new Proxy(fs, { get(target, key) {
    return ['mkdirSync', 'openSync', 'writeFileSync', 'rmSync', 'unlinkSync', 'renameSync'].includes(key)
      ? failMutation(`fs:${key}`) : target[key];
  } });
  const file = 'src/app/api/brandlinks/[id]/draft/route.ts';
  const mocks = {};
  for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/from\s+["']([^"']+)["']/g)) mocks[match[1]] = {};
  Object.assign(mocks, {
    'node:fs': guardedFs, 'node:path': path, 'node:child_process': { spawn: failMutation('spawn') },
    'next/server': { NextResponse: Response },
    '@/lib/api-auth': { requireAdminApiKey: () => null },
    '@/lib/update-guard': { requireNoPendingDesktopUpdate: () => null },
    '@/lib/brand-post-image-repair': { isBrandPostImageRepairActive: () => false, repairBrandPostImages: failMutation('images') },
    '@/lib/desktop-activity': { beginDesktopActivity: failMutation('activity') },
    '@/lib/draft-progress': { writeDraftProgress: failMutation('progress') },
    '@/lib/db': { prisma: { brandLink: {
      findUnique: async () => ({ id: 'product-fixture', connectKind: kind, status: 'READY', experienceNotes: null, parentBrandLinkId: null }),
      updateMany: failMutation('db:claim'), update: failMutation('db:update'),
    } } },
    '@/lib/experience-notes': load('src/lib/experience-notes.ts'),
    '@/lib/post-composition-contract': { stripAffiliateDisclosureFromTitle: value => value.trim(),
      getPostCompositionContract: () => ({ targetSections: helper.getDraftSectionBounds(kind), targetCharacters: { min: kind === 'SHOPPING' ? 1200 : 2400 } }) },
    '@/lib/brand-post-package': { getBrandPostPackageDir: () => directory, getBrandPostPackageManifestPath: () => manifestPath,
      writeBrandPostPackageManifest: failMutation('manifest'), approveBrandPostPackage: failMutation('approve') },
    '../../../../../../scripts/lib/draft-runtime-policy.json': { CODEX_DRAFT_ENABLED: 'true' },
    '../../../../../../scripts/lib/draft-section-contract': helper,
  });
  const route = load(file, mocks);
  const request = new Request('http://localhost/api/brandlinks/product-fixture/draft', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'submit_generated', autoApprove: true, autoSectionImages: true,
      draft: { title: '검증할 제출 원고 제목입니다', sections: inputSections, hashtags: ['상품', '조건', '정보'] } }) });
  return { run: () => route.POST(request, { params: Promise.resolve({ id: 'product-fixture' }) }), effects,
    verifyPreserved: () => {
      assert.deepEqual(fs.readFileSync(manifestPath), before[0]);
      assert.deepEqual(fs.readFileSync(manuscriptPath), before[1]);
    }, clean: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
for (const [label, kind, count, expand] of [
  ['shopping nine raw sections', 'SHOPPING', 9, false],
  ['shopping eight expanding to nine', 'SHOPPING', 8, true],
  ['travel six raw sections', 'TRAVEL', 6, false],
  ['travel twelve expanding to thirteen', 'TRAVEL', 12, true],
]) test(`actual POST rejects ${label} before mutations, PC launch, or image/approval work`, async () => {
  const input = sections(count);
  if (expand) input[0] += '\n\n주요 기능 1\n\n추가 소제목의 확인 사실입니다.\n이 조건을 함께 설명합니다.';
  const fixture = routeFixture(kind, input);
  try {
    const response = await fixture.run();
    const payload = await response.json();
    assert.equal(response.status, 422);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'DRAFT_SECTION_COUNT_OUT_OF_RANGE');
    assert.equal(payload.data.sectionCountValidation.stage, expand ? 'expanded' : 'submitted');
    assert.equal(payload.data.sectionCountValidation.sectionCount, count + Number(expand));
    assert.match(payload.data.nextAction, /post_submit_draft/u);
    assert.equal(fixture.effects.length, 0);
    fixture.verifyPreserved();
  } finally { fixture.clean(); }
});
test('direct agent submission overflow is checked before browser/model work and does not touch the stored manuscript', async () => {
  const input = sections(9);
  const submitted = JSON.stringify({ version: 'mcp-generated-draft/v1', title: '검증할 원고 제목입니다', sections: input, hashtags: ['상품', '조건', '정보'] });
  const effects = [], results = [];
  const fakeProcess = { env: { BRANDLINK_PREPARE_OUTPUT_DIR: '/fixture/package' }, argv: ['node', 'simple-agent.ts', 'product-fixture'], exitCode: 0,
    exit: () => { throw Error('unexpected process exit'); } };
  const api = agentFunctions(['sanitizeText', 'readMcpGeneratedDraft', 'classifyFailureCode', 'main'], {
    fs: { existsSync: () => true, statSync: () => ({ isFile: () => true, size: Buffer.byteLength(submitted) }), readFileSync: () => submitted },
    process: fakeProcess, Buffer,
    SESSION_FILE: '/fixture/session', BRANDLINK_GENERATED_DRAFT_PATH: '/fixture/submitted.json', BRANDLINK_DRAFT_CONTEXT_OUTPUT: '', DRY_RUN_GENERATE_ONLY: false,
    parseRuntimePublishOptions: () => ({ mode: 'now' }),
    prisma: { brandLink: { findUnique: async () => ({ connectKind: 'SHOPPING' }), updateMany: () => { effects.push('db'); } }, $disconnect: async () => {} },
    chromium: { launch: () => { effects.push('browser'); throw Error('unexpected browser'); } },
    generateWithAI: () => { effects.push('model'); throw Error('unexpected generation'); },
    writePrepareResult: (_directory, payload) => results.push(payload),
  });
  await api.main();
  assert.equal(fakeProcess.exitCode, 1);
  assert.equal(effects.length, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].code, 'DRAFT_SECTION_COUNT_OUT_OF_RANGE');
  assert.match(submitted, /FAQ_KEEP/u);
  assert.match(submitted, /CONCLUSION_KEEP/u);
});

function canonicalDisclosureGate() {
  const file = path.join(root, 'src/lib/post-composition-contract.ts');
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names = ['clean', 'splitAffiliateDisclosure', 'hasCanonicalAffiliateDisclosure'];
  const nodes = names.map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name));
  assert.ok(nodes.every(Boolean));
  const code = ts.transpileModule(nodes.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ ...disclosure, exports: {}, Error });
  vm.runInContext(`${code}\nthis.gate = hasCanonicalAffiliateDisclosure;`, context);
  return context.gate;
}
const hasCanonicalAffiliateDisclosure = canonicalDisclosureGate();
const preparedText = load('scripts/lib/prepared-post-markdown.ts');
function preparedFixture(version = 'brand-post-package/v2') {
  const kind = 'TRAVEL';
  const body = sections(7);
  const compositionSections = body.map((text, index) => ({ id: `travel-${index}`, title: text.split('\n')[0], body: text.split('\n').slice(2) }));
  const renderNodes = [
    { kind: 'disclosure', disclosureType: 'affiliate', placement: 'top', text: disclosure.getConnectAffiliateDisclosure(kind) },
    ...compositionSections.flatMap(section => [
      { kind: 'heading', sectionId: section.id, text: section.title },
      { kind: 'paragraph', sectionId: section.id, text: section.body.join('\n') },
    ]),
  ];
  const manifest = { version, connectKind: kind, approvedAt: '2026-10-01T00:00:00Z', generationSource: 'AI', markdownPath: '/fixture/post.md',
    heroImagePath: '/fixture/hero.png', bodyImagePaths: [], hashtags: ['여행', '일정', '조건'],
    composition: version === 'brand-post-package/v2' ? { version: 'resolved-post-document/v1', connectKind: kind, title: '검토한 여행 원고', sections: compositionSections, renderNodes } : undefined };
  const writes = [];
  const api = agentFunctions(['resolvePreparedOverridePath', 'loadPreparedBrandLinkPostOverride'], {
    process: { env: { BRANDLINK_PREPARED_POST_MANIFEST: '/fixture/manifest.json' } },
    fs: { existsSync: () => true, readFileSync: file => file.endsWith('manifest.json') ? JSON.stringify(manifest)
      : `# 검토한 여행 원고\n\n${body.map(section => `## ${section}`).join('\n\n')}`,
      writeFileSync: () => writes.push('write'), unlinkSync: () => writes.push('delete') },
    hasCanonicalAffiliateDisclosure,
    ...preparedText,
    readProductSnapshot: () => null,
  });
  return { manifest, writes, load: options => api.loadPreparedBrandLinkPostOverride(options) };
}
test('standalone publication rejects an approved legacy v1 without rewriting it', () => {
  const fixture = preparedFixture('brand-post-package/v1');
  const before = JSON.stringify(fixture.manifest);
  assert.throws(() => fixture.load(), error => error.code === 'DRAFT_RECHECK_REQUIRED');
  assert.equal(JSON.stringify(fixture.manifest), before);
  assert.equal(fixture.writes.length, 0);
});
test('revision can still read a legacy v1 explicitly without claiming it is publishable', () => {
  const fixture = preparedFixture('brand-post-package/v1');
  const result = fixture.load({ requireApproval: false });
  assert.equal(result.composition, null);
  assert.match(result.post.sections.at(-1), /CONCLUSION_KEEP/u);
  assert.equal(fixture.writes.length, 0);
});
for (const [label, change] of [
  ['bottom notice', composition => { const notice = composition.renderNodes.shift(); notice.placement = 'bottom'; composition.renderNodes.push(notice); }],
  ['qualified payout', composition => { composition.renderNodes[0].text = composition.renderNodes[0].text.replace('제공받습니다', '제공받을 수 있습니다'); }],
  ['shopping notice in travel', composition => { composition.renderNodes[0].text = disclosure.getConnectAffiliateDisclosure('SHOPPING'); }],
  ['duplicate affiliate notice', composition => { composition.renderNodes.push({ ...composition.renderNodes[0] }); }],
]) test(`standalone publication rejects ${label} before a hidden approved-layout migration`, () => {
  const fixture = preparedFixture();
  change(fixture.manifest.composition);
  const before = JSON.stringify(fixture.manifest);
  assert.throws(() => fixture.load(), error => error.code === 'DRAFT_RECHECK_REQUIRED');
  assert.equal(JSON.stringify(fixture.manifest), before);
  assert.equal(fixture.writes.length, 0);
  assert.ok(fixture.load({ requireApproval: false }), 'explicit recheck/revision reading remains available');
});
test('standalone publication accepts the approved canonical v2 and preserves its final body', () => {
  const fixture = preparedFixture();
  const before = JSON.stringify(fixture.manifest);
  const result = fixture.load();
  assert.equal(result.post.sections.length, 8, 'seven body sections plus the statutory notice');
  assert.match(result.post.sections.at(-2), /CONCLUSION_KEEP/u);
  assert.equal(result.post.sections.at(-1), disclosure.getConnectAffiliateDisclosure('TRAVEL'));
  assert.equal(JSON.stringify(fixture.manifest), before);
  assert.equal(fixture.writes.length, 0);
});

test('standalone publication rejects a canonical document of a different material kind without changing approval', () => {
  const fixture = preparedFixture();
  fixture.manifest.connectKind = 'SHOPPING';
  const before = JSON.stringify(fixture.manifest);
  assert.throws(() => fixture.load(), error => error.code === 'DRAFT_RECHECK_REQUIRED');
  assert.equal(JSON.stringify(fixture.manifest), before);
  assert.equal(fixture.writes.length, 0);
  assert.ok(fixture.load({ requireApproval: false }), 'explicit revision can still inspect the stored document');
});

test('standalone publication checks the actual product kind before accepting its otherwise canonical material', () => {
  const fixture = preparedFixture();
  const before = JSON.stringify(fixture.manifest);
  assert.throws(() => fixture.load({ connectKind: 'SHOPPING' }), error => error.code === 'DRAFT_RECHECK_REQUIRED');
  assert.ok(fixture.load({ connectKind: 'TRAVEL' }));
  assert.equal(JSON.stringify(fixture.manifest), before);
  assert.equal(fixture.writes.length, 0);
});

test('standalone publication does not guess a missing or unsupported material kind', () => {
  const fixture = preparedFixture();
  for (const kind of [undefined, 'OTHER']) {
    fixture.manifest.connectKind = kind;
    const before = JSON.stringify(fixture.manifest);
    assert.throws(() => fixture.load(), error => error.code === 'DRAFT_RECHECK_REQUIRED');
    assert.equal(JSON.stringify(fixture.manifest), before);
  }
  assert.equal(fixture.writes.length, 0);
});
