// Read-only source extraction with dependency mocks. No HTTP server, browser,
// production database, publishing process, or image generation is started.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

async function reproduceScheduleHandler() {
  const source = read('src/app/page.tsx');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleSchedulePublish') {
      handler = node.initializer.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(handler, 'schedule handler must exist');
  let apiCalls = 0;
  let notices = 0;
  const scope = {
    getBusyMessage: () => null,
    formatDateDisplay: () => '2026-09-08',
    formatDateInputLocal: () => '2026-09-08',
    setDashboardNotice: () => { notices++; },
    startPublish: async () => { apiCalls++; },
    // Electron 44.0.0 lib/renderer/window-setup.ts lines 13-17.
    prompt: () => { throw Error('prompt() is not supported.'); },
  };
  vm.createContext(scope);
  vm.runInContext(transpile(`var invoke = ${handler}`), scope);
  await assert.rejects(scope.invoke({ id: 'fixture', scheduledPublishAt: '2026-09-08' }), /prompt\(\) is not supported/);
  assert.equal(apiCalls, 0);
  assert.equal(notices, 0);
  console.log('CONFIRMED: Electron prompt rejects before API request and dashboard notice.');
}

async function reproducePublisher() {
  const source = read('scripts/simple-agent.ts');
  const ast = ts.createSourceFile('agent.ts', source, ts.ScriptTarget.Latest, true);
  const names = ['isPublishedUrl', 'clickFinalPublishButton'];
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(functions.length, names.length);
  const scope = { console };
  vm.createContext(scope);
  vm.runInContext(transpile(functions.map(node => node.getText(ast)).join('\n')), scope);
  assert.equal(scope.isPublishedUrl('https://blog.naver.com/example/223123456789'), false);
  assert.equal(scope.isPublishedUrl('https://blog.naver.com/PostView.naver?blogId=example&logNo=223123456789'), true);
  assert.equal(scope.isPublishedUrl('https://example.invalid/?logNo=1'), true);
  const page = {
    locator: () => ({ first: () => ({
      isVisible: async () => true,
      click: async () => { throw Error('detached or disabled'); },
    }) }),
    waitForTimeout: async () => {},
  };
  assert.equal(await scope.clickFinalPublishButton(page, 'now'), true);
  console.log('CONFIRMED: numeric post path rejected; unrelated logNo host accepted; rejected click returns true.');
}

async function reproduceBulkDateFilter() {
  let query;
  let spawned = 0;
  const mocks = {
    '@/lib/prepared-post-priority': { preparedPostsFirst: rows => rows },
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/db': { prisma: { brandLink: {
      count: async () => 0,
      findMany: async value => { query = value; return []; },
    } } },
    child_process: { spawn: () => { spawned++; throw Error('must not spawn'); } },
    fs: {},
    path,
    crypto: {},
    '@/lib/api-auth': { requireAdminApiKey: () => null },
    '@/lib/update-guard': { requireNoPendingDesktopUpdate: () => null },
    '@/lib/desktop-activity': { beginAutomaticPublishing: () => { throw Error('must not acquire'); } },
    '@/lib/brandconnect-kind': { parseConnectKind: kind => kind || 'shopping', toStoredConnectKind: kind => kind.toUpperCase() },
    '@/lib/connect-contract-store': { resolveConnectContract: () => ({ captureRequired: false }) },
    '@/lib/bulk-schedule-plan': {},
  };
  const module = { exports: {} };
  vm.runInNewContext(transpile(read('src/app/api/brandlinks/bulk-schedule/route.ts')), {
    module, exports: module.exports, console, Map, Date,
    process: { cwd: () => root, env: {} },
    require: name => {
      if (!(name in mocks)) throw Error(`Unexpected dependency: ${name}`);
      return mocks[name];
    },
  });
  const response = await module.exports.POST({ json: async () => ({
    connectKind: 'shopping', limit: 10, startDate: '2026-09-08', intervalDays: 1,
  }) });
  assert.equal(query.where.status, 'READY');
  assert.equal(query.where.scheduledPublishAt.not, null);
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.targetCount, 0);
  assert.equal(spawned, 0);
  console.log('CONFIRMED: explicit startDate still requires preset dates; zero candidates returns success with targetCount=0.');
}

async function main() {
  await reproduceScheduleHandler();
  await reproducePublisher();
  await reproduceBulkDateFilter();
  console.log('Audit reproductions passed. These assertions document current defects, not desired fixed behavior.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
