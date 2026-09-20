const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict'),path=require('path');
require('ts-node').register({project:path.resolve('tsconfig.scripts.json'),transpileOnly:true});
const filename=path.resolve('scripts/lib/codex-draft-provider.ts');
let source=fs.readFileSync(filename,'utf8');
source=source.replace(/const nativeImport = new Function[\s\S]*?Promise<CodexSdkModule>;/,'const nativeImport = async () => ({ Codex: MockCodex });');
let captured;
class MockCodex { startThread(options){captured=options;return {runStreamed:async()=>({events:(async function*(){yield {type:'item.completed',item:{type:'agent_message',text:'{"productPhoto":true}'}}})()})}} }
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,resolveJsonModule:true}}).outputText;
const moduleObj={exports:{}};
vm.runInNewContext(code,{exports:moduleObj.exports,require:s=>s.startsWith('.')?require(path.resolve(path.dirname(filename),s)):require(s),MockCodex,process,AbortController,setTimeout,clearTimeout});
(async()=>{
  for(const model of [undefined,'','   ','gpt-5.5']) {
    const result=await moduleObj.exports.runCodexDraft({systemPrompt:'check',userPrompt:'check',model});
    assert.equal(captured.model,'gpt-5.5');
    assert.equal(result,'{"productPhoto":true}');
    assert.equal(captured.sandboxMode,'read-only');
  }
  captured=undefined;
  await assert.rejects(moduleObj.exports.runCodexDraft({systemPrompt:'check',userPrompt:'check',model:'gpt-4o-mini'}), /TEXT_MODEL_POLICY/);
  await assert.rejects(moduleObj.exports.runCodexDraft({systemPrompt:'check',userPrompt:'check',reasoningEffort:'ultra'}), /TEXT_MODEL_POLICY/);
  assert.equal(captured,undefined,'invalid model/effort must fail before starting a thread');
  console.log('PASS: pinned Codex model; blank defaults; foreign model and unsupported effort rejected before execution');
})().catch(e=>{console.error(e);process.exitCode=1});
