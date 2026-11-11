/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {requestFactoryReset, completeFactoryReset} = require('./electron/factory-reset.cjs');
const vm = require('node:vm');
test('native confirmation, busy guard and failed relaunch never reset real data', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'electron/main.cjs'), 'utf8').replace(/\r\n/g, '\n');
  const fn = source.match(/async function factoryReset\(\) \{[\s\S]*?\n\}/)[0];
  for (const scenario of ['cancel', 'busy', 'relaunch-failure', 'confirm']) {
    const calls = [], env = {DATABASE_URL:'file:fixture', SESSION_STORAGE_DIR:'fixture'};
    const context = { factoryResetPending:false, serverRestartPromise:null, isQuitting:false, process:{env}, path,
      __desktopActivityState:{active:new Map()}, fs:{existsSync:()=>false},
      app:{isPackaged:true,getPath:()=>path.resolve('fixture-only'),relaunch:()=>{if(scenario==='relaunch-failure')throw Error('relaunch'); calls.push('relaunch');},exit:()=>calls.push('exit')},
      dialog:{showMessageBox:async options=>{assert.equal(options.defaultId,0); return {response:scenario==='cancel'?0:1};}},
      getUpdateReadiness:async()=>({ready:scenario!=='busy'}), getRelaunchArgs:()=>[],
      requestFactoryReset:()=>calls.push('request'), cancelFactoryReset:()=>calls.push('cancel'), desktopUpdater:{stop:()=>{}},
    };
    vm.runInNewContext(fn,context);
    if(['busy','relaunch-failure'].includes(scenario)) await assert.rejects(context.factoryReset());
    else await context.factoryReset();
    if(['cancel','busy'].includes(scenario)) assert.deepEqual(calls,[]);
    if(scenario==='relaunch-failure'){assert.deepEqual(calls,['request','cancel']); assert.equal(env.DATABASE_URL,'file:fixture');}
    if(scenario==='confirm') assert.deepEqual(calls,['request','relaunch','exit']);
  }
});
test('reset requires explicit intent, deletes only app-owned data, and resumes failed cleanup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blogauto-reset-test-'));
  try {
    fs.mkdirSync(path.join(root, 'data'));
    fs.writeFileSync(path.join(root, 'data', 'draft.txt'), 'preserve until confirmed');
    fs.writeFileSync(path.join(root, '.env'), 'TEST_SETTING=value');
    fs.writeFileSync(path.join(root, 'unrelated.txt'), 'keep');
    assert.equal(await completeFactoryReset(root, async () => assert.fail()), false);
    requestFactoryReset(root);
    assert(fs.existsSync(path.join(root, 'data', 'draft.txt')));
    await assert.rejects(completeFactoryReset(root, async () => { throw new Error('storage busy'); }), /storage busy/);
    assert(fs.existsSync(path.join(root, 'data', 'draft.txt')));
    assert.equal(await completeFactoryReset(root, async () => {}), true);
    assert(!fs.existsSync(path.join(root, 'data')));
    assert(!fs.existsSync(path.join(root, '.env')));
    assert(fs.existsSync(path.join(root, 'unrelated.txt')));
    assert.equal(await completeFactoryReset(root, async () => assert.fail()), false);
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});
test('reset rejects linked external directories before deleting any material', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blogauto-reset-link-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'blogauto-reset-external-'));
  try {
    fs.writeFileSync(path.join(external, 'keep.txt'), 'keep');
    fs.symlinkSync(external, path.join(root, 'data'), 'junction');
    assert.throws(() => requestFactoryReset(root), /외부/);
    assert(fs.existsSync(path.join(external, 'keep.txt')));
  } finally { fs.rmSync(root, {recursive:true,force:true}); fs.rmSync(external, {recursive:true,force:true}); }
});
