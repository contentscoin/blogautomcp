const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const source = fs.readFileSync('src/app/api/remote-agent/poll/route.ts', 'utf8');
const body = source.match(/function remainingGenerationMissing\([\s\S]*?\n\}/)?.[0];
assert(body);
const context = vm.createContext({ numberField: (record, key) => typeof record[key] === 'number' ? record[key] : 0 });
vm.runInContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
assert.equal(context.remainingGenerationMissing([{ missing: 1, generationMissing: 0 }]), 1);
assert.equal(context.remainingGenerationMissing([{ missing: 1, generationMissing: 1 }]), 1);
assert.equal(context.remainingGenerationMissing([{ missing: 0, generationMissing: 2 }]), 2);
assert.equal(context.remainingGenerationMissing(null), 0);
for (const file of ['src/lib/chatgpt-draft-handoff.ts', 'scripts/lib/writing-prompt-contract.ts', 'apps/sites/app/api/mcp/[credential]/route.ts']) {
  assert(fs.readFileSync(file, 'utf8').includes('missing 또는 generationMissing'), `${file}: missing travel-slot guidance`);
}
console.log('PASS: MCP counts empty travel slots, no double-counting, and all handoff instructions include missing images');
