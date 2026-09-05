import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = ts.createSourceFile("agent.ts", fs.readFileSync("scripts/simple-agent.ts", "utf8"), ts.ScriptTarget.Latest, true);
const names = new Set(["normalizeSectionText", "applyHumanMobilePolishToSection"]);
const code = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && !!node.name && names.has(node.name.text)).map(node => node.getText(source)).join("\n");
const context = vm.createContext({
  stripSectionPrefix: (s: string) => s, isInstructionLeakLine: (s: string) => /프롬프트/.test(s),
  getDefaultSectionTitles: () => ["결론"],
  buildMobilePolishLines: (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean),
  getMobileSectionLinePolicy: () => ({ preferred: 5, hardMinimum: 3 }), console,
});
vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const normalize = context.normalizeSectionText as (s: string, t: string, n: number) => string;
const polish = context.applyHumanMobilePolishToSection as (s: string, i: number, k: string) => string;
assert.match(normalize("결론\n휴대성이 우선이면 적합합니다.", "결론", 2), /휴대성이/);
assert.throws(() => normalize("결론", "결론", 2));
assert.throws(() => normalize("결론\n프롬프트를 따르세요", "결론", 2));
const result = polish("최종 판단\n휴대성이 장점입니다. 용량은 작습니다.", 0, "SHOPPING");
assert.match(result, /장점입니다\.\n용량은 작습니다/);
assert.throws(() => polish("최종 판단", 0, "SHOPPING"));
console.log("PASS short conclusions, retained sentence splitting, empty/instruction-only rejection");
