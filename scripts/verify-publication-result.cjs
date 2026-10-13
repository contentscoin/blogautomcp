/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS route integration harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const path = require('node:path');
require('tsx/cjs');
const contentContract = require('../src/lib/published-post-verification.ts');
const urlContract = require('../src/lib/naver-published-url.ts');
let link = { id: 'fixture', status: 'READY', postUrl: null, scheduledPublishAt: new Date('2026-09-15T00:00:00Z'), productName: 'fixture' };
let attempt = null;
const imageBytes = Buffer.from('fixture image bytes');
const title = 'fixture 선택한 제목';
const disclosure = '이 포스팅은 구매 발생 시 수수료를 제공받습니다.';
const manifest = { version: 'brand-post-package/v2', brandLinkId: 'fixture', title, composition: {
  version: 'resolved-post-document/v1', title, renderNodes: [
    { kind: 'disclosure', placement: 'top', text: disclosure },
    { kind: 'paragraph', text: 'fixture published content' },
    { kind: 'image', assetPath: 'fixture-image.png', sectionId: null },
    { kind: 'connectCard', url: 'https://naver.me/fixture' },
  ],
} };
const postHtml = `<div class="se-main-container"><div class="se-documentTitle"><div class="se-title-text">${title}</div></div><p>${disclosure}</p><p>fixture published content</p><div class="se-component se-image"><img class="se-image-resource" src="https://postfiles.pstatic.net/source/photo.png?type=w966"></div><div class="se-oglink"><a href="https://naver.me/fixture">옵션 확인</a></div></div>`;
let pageHtml = postHtml;
let pageUrl = 'https://blog.naver.com/fixture/123';
let responseStatus = 200, responseLocation = null, imageResponseBytes = imageBytes, snapshotChanged = false, sourceChanged = false, receiptUnreadable = false;
const fetches = [];
const mocks = {
  'next/server': { NextResponse: { json: body => body } },
  '@/lib/db': { prisma: { brandLink: { findUnique: async () => link } } },
  '@/lib/api-auth': { requireAdminApiKey: () => null },
  '@/lib/naver-published-url': urlContract,
  '@/lib/published-post-verification': contentContract,
  'node:fs': { readFileSync: file => file.endsWith('manifest.json') ? JSON.stringify(manifest) : imageBytes },
  'node:path': path, 'node:crypto': crypto,
  '@/lib/publish-attempt': { readPublishAttempt: () => { if (receiptUnreadable) throw Error('invalid receipt'); return attempt; }, publisherHasExited: () => true,
    publicationMaterialHash: file => file === 'snapshot-manifest.json' ? snapshotChanged ? 'changed' : 'snapshot-hash' : sourceChanged ? 'changed' : 'source-hash' },
};
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/brandlinks/[id]/verify/route.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, {
  module: mod, exports: mod.exports, Date, Buffer, URL, setTimeout, clearTimeout, AbortController,
  fetch: async (url, options) => {
    fetches.push({ url, redirect: options.redirect });
    const isImage = url.includes('pstatic.net');
    const response = new Response(isImage ? imageResponseBytes : pageHtml, { status: isImage ? 200 : responseStatus,
      headers: isImage ? { 'content-type': 'image/png' } : responseLocation ? { location: responseLocation } : {} });
    Object.defineProperty(response, 'url', { value: isImage ? url : pageUrl });
    return response;
  },
  require: name => { if (!(name in mocks)) throw Error(`Unexpected dependency: ${name}`); return mocks[name]; },
});
const verify = async () => (await mod.exports.GET({}, { params: Promise.resolve({ id: 'fixture' }) })).data;
(async () => {
  let result = await verify();
  assert.equal(result.scheduled, false);
  assert.equal(result.scheduledPublishAt, null, 'a planned date must not appear as confirmed');
  assert.equal(result.plannedPublishAt, '2026-09-15T00:00:00.000Z');
  link.status = 'SCHEDULED';
  assert.equal((await verify()).scheduled, false, 'DB status alone is not a receipt');
  attempt = { id: 'attempt', stage: 'CONFIRMED', mode: 'schedule', evidence: { reservationId: 'reserve' } };
  assert.equal((await verify()).scheduled, false, 'date evidence is required');
  attempt.evidence.scheduledDate = '2026-09-15';
  result = await verify();
  assert.equal(result.scheduled, true);
  assert.equal(result.reservationVerification.liveListChecked, false);
  assert.equal(result.reservationVerification.publicationConfirmed, false);
  assert.equal(result.automaticReplayAllowed, false);
  assert.equal(result.verificationBasis, 'submission-receipt');
  assert.equal(result.confirmedScheduledDate, '2026-09-15');
  attempt.evidence.scheduledDate = '2026-09-16';
  assert.equal((await verify()).scheduled, false, 'receipt and stored reservation must have the same date');
  link.status = 'OUTCOME_UNKNOWN';
  attempt = { id: 'attempt', stage: 'SUBMITTING', publisherPid: 123, submittedAt: '2026-09-14T00:00:00Z' };
  result = await verify();
  assert.equal(result.scheduled, false);
  assert.equal(result.outcomeUnknown, true);
  assert.equal(result.publisherProcessState, 'exited');
  assert.equal(result.attemptStage, 'SUBMITTING');
  assert.equal(result.submittedAt, '2026-09-14T00:00:00Z');
  link.status = 'PUBLISHED'; link.postUrl = 'https://blog.naver.com/fixture/123';
  attempt = { id: 'attempt', stage: 'CONFIRMED', mode: 'now', evidence: { postUrl: link.postUrl },
    snapshotManifestPath: 'snapshot-manifest.json', snapshotHash: 'snapshot-hash', sourceManifestPath: 'source-manifest.json', manifestHash: 'source-hash' };
  result = await verify();
  assert.equal(result.published, true);
  assert.equal(result.verificationBasis, 'live-post-probe');
  assert.equal(result.contentVerified, true);
  assert.equal(result.verificationStatus, 'verified');
  assert.equal(fetches.at(-1).url, 'https://blogfiles.pstatic.net/source/photo.png');
  assert.equal(fetches.at(-1).redirect, 'error');
  imageResponseBytes = Buffer.from('Naver reencoded bytes');
  result = await verify(); assert.equal(result.published, true); assert.equal(result.contentVerified, false); assert.equal(result.verificationStatus, 'partial');
  imageResponseBytes = imageBytes;
  pageHtml = postHtml.replace('fixture published content', 'completely unrelated product');
  result = await verify(); assert.equal(result.published, true); assert.equal(result.contentVerified, false); assert.equal(result.contentVerification.checks.bodyOrder, 'fail');
  pageHtml = postHtml.replace(title, 'wrong title'); assert.equal((await verify()).published, false, 'product mentions elsewhere cannot replace exact public title verification');
  pageHtml = postHtml; snapshotChanged = true; assert.equal((await verify()).contentVerified, false); snapshotChanged = false;
  sourceChanged = true; result = await verify(); assert.equal(result.contentVerified, false); assert.equal(result.contentVerification.checks.revision, 'fail'); sourceChanged = false;
  pageHtml = postHtml.replace('https://postfiles.pstatic.net/source/photo.png?type=w966', 'http://127.0.0.1/private.png');
  fetches.length = 0; result = await verify(); assert.equal(result.contentVerified, false); assert.equal(fetches.length, 1, 'Unknown image hosts must not be fetched');
  pageHtml = '<html>fixture temporarily unavailable</html>';
  assert.equal((await verify()).published, false, 'generic HTTP 200 error pages are not published content');
  pageHtml = '<div class="se-main-container">fixture</div>'; pageUrl = 'https://nid.naver.com/login';
  assert.equal((await verify()).published, false, 'login redirects cannot confirm the requested post');
  pageUrl = link.postUrl; attempt.evidence.postUrl = 'https://blog.naver.com/fixture/999';
  assert.equal((await verify()).published, false, 'receipt identity must match the probed post');
  attempt.evidence.postUrl = link.postUrl; pageHtml = postHtml;
  responseStatus = 302; responseLocation = 'http://127.0.0.1/private'; fetches.length = 0;
  assert.equal((await verify()).published, false); assert.equal(fetches.length, 1, 'A redirect outside the same Naver post must never be followed');
  responseStatus = 200; responseLocation = null;
  responseStatus = 404; assert.equal((await verify()).published, false, 'HTTP failure must never confirm a public post'); responseStatus = 200;
  pageUrl = 'https://blog.naver.com/fixture/999'; result = await verify(); assert.equal(result.verificationStatus, 'mismatch'); assert.equal(result.contentVerification.checks.postIdentity, 'fail'); pageUrl = link.postUrl;
  pageHtml = 'x'.repeat(800001); assert.equal((await verify()).published, false, 'Oversized responses must not validate a truncated body'); pageHtml = postHtml;
  receiptUnreadable = true; result = await verify(); assert.equal(result.published, false); assert.equal(result.outcomeUnknown, true); assert.equal(result.automaticReplayAllowed, false);
  console.log('PASS: receipt vs live reservation, exact public title/content/image/link/revision verification, resize partial, bounded requests and no automatic replay');
})().catch(error => { console.error(error); process.exitCode = 1; });
