const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let link = { id: 'fixture', status: 'READY', postUrl: null, scheduledPublishAt: new Date('2026-09-15T00:00:00Z'), productName: 'fixture' };
let attempt = null;
let pageHtml = '<div class="se-main-container">fixture published content</div>';
let pageUrl = 'https://blog.naver.com/fixture/123';
const mocks = {
  'next/server': { NextResponse: { json: body => body } },
  '@/lib/db': { prisma: { brandLink: { findUnique: async () => link } } },
  '@/lib/api-auth': { requireAdminApiKey: () => null },
  '@/lib/naver-published-url': { parseNaverPublishedUrl: value => value?.includes('blog.naver.com') ? { blogId: 'fixture', logNo: '123', url: value.includes('999') ? 'https://blog.naver.com/fixture/999' : 'https://blog.naver.com/fixture/123' } : null },
  '@/lib/publish-attempt': { readPublishAttempt: () => attempt, publisherHasExited: () => true },
};
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/brandlinks/[id]/verify/route.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  module: mod, exports: mod.exports, Date, setTimeout, clearTimeout, AbortController,
  fetch: async () => ({ ok: true, status: 200, url: pageUrl, text: async () => pageHtml }),
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
  attempt = { id: 'attempt', stage: 'CONFIRMED', mode: 'now', evidence: { postUrl: link.postUrl } };
  result = await verify();
  assert.equal(result.published, true);
  assert.equal(result.verificationBasis, 'live-post-probe');
  pageHtml = '<html>fixture temporarily unavailable</html>';
  assert.equal((await verify()).published, false, 'generic HTTP 200 error pages are not published content');
  pageHtml = '<div class="se-main-container">fixture</div>'; pageUrl = 'https://nid.naver.com/login';
  assert.equal((await verify()).published, false, 'login redirects cannot confirm the requested post');
  pageUrl = link.postUrl; attempt.evidence.postUrl = 'https://blog.naver.com/fixture/999';
  assert.equal((await verify()).published, false, 'receipt identity must match the probed post');
  console.log('PASS: planned date separation, receipt date/ID requirement, unknown-process diagnostics and live-post probe');
})().catch(error => { console.error(error); process.exitCode = 1; });
