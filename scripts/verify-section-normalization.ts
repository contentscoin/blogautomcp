import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { stripDraftListPrefix } from "./lib/draft-sections";
import { normalizeLines } from "./lib/post-spec/render";
const source = ts.createSourceFile("agent.ts", fs.readFileSync("scripts/simple-agent.ts", "utf8"), ts.ScriptTarget.Latest, true);
const names = new Set(["stripSectionPrefix", "normalizeSectionText", "applyHumanMobilePolishToSection"]);
const code = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && !!node.name && names.has(node.name.text)).map(node => node.getText(source)).join("\n");
const context = vm.createContext({
  stripEmoji: (s: string) => s.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ""), stripDraftListPrefix,
  isInstructionLeakLine: (s: string) => /프롬프트/.test(s),
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
for (const heading of ["1.65kg은 어떻게 판단하면 좋을까요?", "2.5L 용량은 얼마나 될까요?", "3.5mm 연결 단자", "-0.5°C 보관 조건"]) {
  assert.ok(normalize(`${heading}\n확인된 값과 단위를 그대로 씁니다.`, "결론", 1).startsWith(`${heading}\n\n`), `initial writer preserves scalar heading ${heading}`);
  assert.ok(polish(`${heading}\n확인된 값과 단위를 그대로 씁니다.`, 0, "SHOPPING").startsWith(`${heading}\n\n`), `mobile polish preserves scalar heading ${heading}`);
  assert.equal(normalizeLines([heading], "checklist")[0], `▸ ${heading}`);
  assert.equal(normalizeLines([heading], "facts-list")[0], `• ${heading}`);
}
for (const [input, expected] of [["1. 용량", "용량"], ["1.용량", "용량"], ["2) 구성", "구성"], ["1. 1.65kg 무게", "1.65kg 무게"], ["- 사용 조건", "사용 조건"]]) {
  assert.equal(stripDraftListPrefix(input), expected);
  assert.ok(normalize(`${input}\n확인된 원문입니다.`, "결론", 1).startsWith(`${expected}\n\n`));
}
console.log("PASS short conclusions, sentence splitting, empty/instruction rejection, decimal/signed values in initial and polished headings and list rendering");
