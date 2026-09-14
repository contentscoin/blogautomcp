const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'photo-review-test-'));
const files=['notice.jpg','product_detail_1.jpg'].map((name,i)=>{const p=path.join(root,name);fs.writeFileSync(p,'fixture'+i);return p});
const code=ts.transpileModule(fs.readFileSync('scripts/lib/product-photo-review.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const out={exports:{}};let calls=0;
vm.runInNewContext(code,{exports:out.exports,require:s=>s==='./codex-draft-provider'?{runCodexDraft:async()=>{calls++;return JSON.stringify({productPhoto:calls===2})}}:require(s)});
(async()=>{assert.equal(await out.exports.selectVerifiedProductPhoto(files,'fixture'),files[1]);assert.equal(calls,2);assert.equal(await out.exports.selectVerifiedProductPhoto(files,'fixture'),files[1]);assert.equal(calls,2);const agent=fs.readFileSync('scripts/simple-agent.ts','utf8');assert.ok(agent.includes('[product.representativeImagePath || "", ...product.imagePaths]'));console.log('PASS: notice rejected, verified detail photo accepted, byte cache reused, detail candidates passed to gate');})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const f of files)fs.unlinkSync(f);fs.rmdirSync(root)});
