import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { parseNaverPublishedUrl } from '../src/lib/naver-published-url';
import { inspectNaverScheduleSubmissionSignal } from '../src/lib/naver-schedule-submission';
import { createPublishAttempt, readPublishAttempt, updatePublishAttempt, interruptedPublishStatus, publicationMaterialHash } from '../src/lib/publish-attempt';
import { applyFreeformSectionRevision } from './lib/freeform-draft-revision';

async function main() {
  assert.deepEqual(parseNaverPublishedUrl('https://m.blog.naver.com/account/223123456789'), { blogId: 'account', logNo: '223123456789', url: 'https://blog.naver.com/account/223123456789' });
  assert.equal(parseNaverPublishedUrl('https://blog.naver.com/PostView.naver?blogId=account&logNo=123')?.url, 'https://blog.naver.com/account/123');
  for (const url of ['https://example.invalid/?logNo=1', 'https://blog.naver.com.attacker.test/account/123', 'javascript:PostView?logNo=1', 'https://blog.naver.com/PostWriteForm.naver?blogId=account&logNo=123', 'https://blog.naver.com/account/not-a-post']) assert.equal(parseNaverPublishedUrl(url), null);
  assert.equal(parseNaverPublishedUrl('https://blog.naver.com/account/123', 'different-account'), null);

  const request = { url: 'https://blog.naver.com/api/post/reserve', postData: JSON.stringify({ radio_time: 'pre', preDate: '2026-09-08' }), targetYmd: '2026-09-08', status: 200 };
  for (const responseBody of [undefined, '<html>login</html>', { success: false }, { success: true }, { success: true, errorCode: 'LOGIN_REQUIRED', data: { reservationId: '123' } }]) {
    assert.equal(inspectNaverScheduleSubmissionSignal({ ...request, responseBody }).confirmed, false);
  }
  const responseBody = { success: true, result: { reservationId: 'reserved-123' } };
  assert.equal(inspectNaverScheduleSubmissionSignal({ ...request, responseBody }).confirmed, true);
  assert.equal(inspectNaverScheduleSubmissionSignal({ ...request, responseBody, status: 302 }).confirmed, false);
  assert.equal(inspectNaverScheduleSubmissionSignal({ ...request, responseBody, url: 'https://naver.com.attacker.test/reserve' }).confirmed, false);
  assert.equal(inspectNaverScheduleSubmissionSignal({ ...request, responseBody, targetYmd: '2026-09-09' }).confirmed, false);

  const original = ['호텔 객실\n기존 객실 본문', '시티투어\n기존 관광 본문'];
  assert.deepEqual(applyFreeformSectionRevision(original, '{"updates":[{"index":1,"body":"새 관광 본문"}]}', [1]), ['호텔 객실\n기존 객실 본문', '시티투어\n새 관광 본문']);
  assert.deepEqual(original, ['호텔 객실\n기존 객실 본문', '시티투어\n기존 관광 본문']);
  for (const updates of [[{ index: 0, body: 'wrong section' }], [{ index: 1, body: '' }], [{ index: 1, body: 'one' }, { index: 1, body: 'duplicate' }], [{ index: 9, body: 'new section' }]]) assert.throws(() => applyFreeformSectionRevision(original, JSON.stringify({ updates }), [1]));

  // Extract only this function. Importing simple-agent itself would start work.
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/simple-agent.ts'), 'utf8');
  const ast = ts.createSourceFile('agent.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'clickFinalPublishButton');
  assert(fn);
  const scope: Record<string, unknown> = { console };
  vm.createContext(scope);
  vm.runInContext(ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
  const click = scope.clickFinalPublishButton as (page: unknown, mode: string, before: () => Promise<void>) => Promise<boolean>;
  let submitted = 0;
  const before = async () => { submitted++; };
  const page = (enabled: boolean, fail: boolean) => ({ locator: () => ({ first: () => ({ isVisible: async () => true, isEnabled: async () => enabled, click: async () => { if (fail) throw Error('detached'); } }) }), waitForTimeout: async () => {} });
  await assert.rejects(click(page(false, false), 'now', before), /비활성/);
  assert.equal(submitted, 0);
  await assert.rejects(click(page(true, true), 'now', before), /detached/);
  assert.equal(submitted, 1, 'uncertain click attempts must never try another selector');
  assert.equal(await click(page(true, false), 'now', before), true);
  assert.equal(submitted, 2);

  // Attempt receipts use an isolated temporary user-data root, never the live DB.
  const previous = process.env.DESKTOP_USER_DATA;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-publish-safety-'));
  try {
    process.env.DESKTOP_USER_DATA = temporary;
    const manifest = path.join(temporary, 'manifest.json');
    const markdown = path.join(temporary, 'draft.md');
    const asset = path.join(temporary, 'image.png');
    fs.writeFileSync(markdown, 'approved draft');
    fs.writeFileSync(asset, 'approved image fixture');
    fs.writeFileSync(manifest, JSON.stringify({ approvedAt: 'fixture', markdownPath: markdown, heroImagePath: asset,
      bodyImagePaths: [asset], imageAssets: [{ path: asset }], composition: { sections: [{ imagePaths: [asset] }], renderNodes: [{ assetPath: asset }] } }));
    const attempt = createPublishAttempt('fixture-product', 'now', manifest);
    const frozen = JSON.parse(fs.readFileSync(attempt.snapshotManifestPath!, 'utf8'));
    assert.notEqual(frozen.markdownPath, markdown);
    assert.equal(frozen.heroImagePath, frozen.composition.renderNodes[0].assetPath);
    assert.equal(frozen.imageAssets[0].path, frozen.heroImagePath);
    fs.writeFileSync(markdown, 'modified original');
    fs.writeFileSync(asset, 'modified image');
    assert.equal(fs.readFileSync(frozen.markdownPath, 'utf8'), 'approved draft');
    assert.equal(fs.readFileSync(frozen.heroImagePath, 'utf8'), 'approved image fixture');
    assert.equal(publicationMaterialHash(attempt.snapshotManifestPath!), attempt.snapshotHash);
    assert.notEqual(publicationMaterialHash(manifest), attempt.manifestHash);
    assert.equal(interruptedPublishStatus(attempt), 'FAILED');
    assert.throws(() => createPublishAttempt('fixture-product', 'now', manifest));
    updatePublishAttempt('fixture-product', attempt.id, 'SUBMITTING');
    assert(readPublishAttempt('fixture-product')?.submittedAt);
    assert.equal(interruptedPublishStatus(readPublishAttempt('fixture-product')), 'OUTCOME_UNKNOWN');
    assert.throws(() => updatePublishAttempt('fixture-product', attempt.id, 'SUBMITTING'));
    updatePublishAttempt('fixture-product', attempt.id, 'CONFIRMED', { postUrl: 'https://blog.naver.com/account/123' });
    assert(readPublishAttempt('fixture-product')?.confirmedAt);
    updatePublishAttempt('fixture-product', attempt.id, 'OUTCOME_UNKNOWN');
    assert.equal(readPublishAttempt('fixture-product')?.stage, 'CONFIRMED', 'cleanup/timeouts cannot overwrite a confirmed receipt');
    assert.throws(() => createPublishAttempt('fixture-product', 'now', manifest));
    const failed = createPublishAttempt('failed-product', 'now', manifest);
    updatePublishAttempt('failed-product', failed.id, 'FAILED_BEFORE_SUBMIT');
    assert.notEqual(createPublishAttempt('failed-product', 'now', manifest).id, failed.id);
    assert.equal(interruptedPublishStatus(null), 'OUTCOME_UNKNOWN');
  } finally {
    if (previous === undefined) delete process.env.DESKTOP_USER_DATA;
    else process.env.DESKTOP_USER_DATA = previous;
    assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log('Publish safety: URL identity, response evidence, click failures, immutable revisions and durable uncertainty passed. No browser, server, production DB or generation used.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
