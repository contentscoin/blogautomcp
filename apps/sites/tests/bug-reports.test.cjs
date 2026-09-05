const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function fixture() {
  const records = [];
  const env = {};
  let allowed = true;
  const d1 = { prepare(sql) { return { bind(...args) { return {
    async first() {
      if (sql.includes('FROM bug_reports')) return records.find(r => sql.includes('idempotency_key=?') ? r.user_id === args[0] && r.idempotency_key === args[1] : r.id === args[0] && r.user_id === args[1]) || null;
      if (sql.includes('FROM agent_jobs')) return args[0] === 'owned' && args[1] === 'owner' ? { id: 'owned', error_message: 'token=private-secret', type: 'SYNC', status: 'FAILED' } : null;
      if (sql.includes('FROM devices')) return { app_version: '1.3.19', platform: 'win32' };
      throw new Error(sql);
    },
    async run() {
      if (sql.startsWith('INSERT')) { records.push(Object.fromEntries(['id','user_id','idempotency_key','summary','diagnostics_json','delivery_status','created_at'].map((k,i) => [k,args[i]]))); return { meta: { changes: 1 } }; }
      const record = records.find(r => r.id === args[1] && r.user_id === args[2]);
      record.delivery_status = args[0]; return { meta: { changes: 1 } };
    },
  }; } }; } };
  const mocks = { 'cloudflare:workers': { env }, '@/db': { getD1: () => d1 }, '@/lib/crypto': { newId: () => `bug_${records.length}` }, '@/lib/rate-limit': { enforceRateLimit: async () => ({ allowed }) } };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/bug-reports.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports',code)(name => mocks[name], module, module.exports);
  return { ...module.exports, records, env, block: () => { allowed = false; } };
}
const input = { summary: '동기화 실패', details: '오류 발생', idempotencyKey: 'report-001', confirmed: true };
test('redacts credentials, private URLs, local username, email and phone', () => {
  const { redactReport } = fixture();
  const raw = 'Authorization: Bearer private\n{"api_key":"supersecret"}\nNID_AUT=naversecret\nhttps://host/api/mcp/secret\nC:\\Users\\jinhyouck\\logs\nhello@example.com 010-1234-5678';
  const clean = redactReport(raw);
  for (const secret of ['private','supersecret','naversecret','https://host','jinhyouck','hello@example.com','010-1234-5678']) assert.ok(!clean.includes(secret), secret);
});
test('consent and account ownership are enforced before storing', async () => {
  const f = fixture();
  assert.equal((await f.createBugReport('owner', { ...input, confirmed: false })).code, 'CONFIRMATION_REQUIRED');
  assert.equal((await f.createBugReport('other', { ...input, jobId: 'owned' })).code, 'JOB_NOT_FOUND');
  assert.equal(f.records.length, 0);
});
test('missing bot preserves report, idempotency prevents duplicates and get is scoped', async () => {
  const f = fixture();
  const result = await f.createBugReport('owner', { ...input, jobId: 'owned' });
  assert.equal(result.deliveryStatus, 'NOT_CONFIGURED');
  assert.ok(!f.records[0].diagnostics_json.includes('private-secret'));
  assert.equal((await f.createBugReport('owner', input)).reused, true);
  assert.equal(f.records.length, 1);
  assert.equal((await f.getBugReport('other', result.reportId)).code, 'REPORT_NOT_FOUND');
  assert.equal((await f.getBugReport('owner', result.reportId)).ok, true);
});
test('rate limit prevents storing and sending', async () => {
  const f = fixture(); f.block();
  assert.equal((await f.createBugReport('owner', input)).code, 'RATE_LIMITED');
  assert.equal(f.records.length, 0);
});
test('Telegram HTTP, API and network failures never lose a saved report', async () => {
  const original = global.fetch;
  try {
    const responses = [() => { throw Error('secret URL'); }, async () => Response.json({ ok: false }), async () => Response.json({ ok: true }, { status: 500 }), async () => Response.json({ ok: true })];
    for (const [index, response] of responses.entries()) {
      const f = fixture(); Object.assign(f.env, { BUG_REPORT_TELEGRAM_BOT_TOKEN: 'test', BUG_REPORT_TELEGRAM_CHAT_ID: '123' });
      global.fetch = response;
      const result = await f.createBugReport('owner', input);
      assert.equal(f.records.length, 1);
      assert.equal(result.deliveryStatus, index === 3 ? 'SENT' : 'FAILED');
      assert.equal(result.deliveryStatus, f.records[0].delivery_status);
    }
  } finally { global.fetch = original; }
});
