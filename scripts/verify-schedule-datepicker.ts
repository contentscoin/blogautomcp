import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { chromium, type Page } from "playwright";

// The failed 2026-09-21 publish snapshot contained this read-only date field.
// Keep the fixture free of the user's article/account data and network requests.
const snapshotInput = '<div class="time_setting__HBg5Y"><div class="date__JIhWW"><input class="input_date__UwKAB" readonly type="text" value="2026. 09. 21"></div></div>';
const target = new Date(2026, 8, 23, 9);
function loadFunctions(file: string) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const names = new Set(["normalizeDateCandidate", "isScheduleDateMatch", "getSchedulePanelLocator", "setInputValueWithNativeEvents", "parseDatepickerYearMonth", "compareYearMonth", "trySetScheduleDateViaDatepicker", "verifyScheduleDateApplied"]);
  const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text));
  assert.equal(declarations.length, names.size);
  const context = vm.createContext({ console, formatDateYmd: () => "2026-09-23" });
  vm.runInContext(ts.transpileModule(declarations.map(node => node.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context as unknown as {
    trySetScheduleDateViaDatepicker(page: Page, date: Date): Promise<boolean>;
    verifyScheduleDateApplied(page: Page, date: Date): Promise<boolean>;
    setInputValueWithNativeEvents(input: ReturnType<Page["locator"]>, value: string): Promise<string>;
  };
}
async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    for (const file of ["scripts/simple-agent.ts", "scripts/topic-agent.ts"]) {
      const functions = loadFunctions(file);
      for (const inputClass of ["input_date__UwKAB", "input_date__QmA0s", "input_date__futureHash"]) {
        await page.setContent(`<div class="layer_publish__newHash">${snapshotInput.replace("input_date__UwKAB", inputClass)}<span>2026. 09. 23 기사 참고 날짜</span></div><div class="ui-datepicker" style="display:none"><div class="ui-datepicker-title">2026년 9월</div><table><tr><td class="ui-datepicker-other-month"><button class="ui-state-default" data-value="2026. 10. 23">23</button></td><td><button class="ui-state-default" data-value="2026. 09. 23">23</button></td></tr></table></div>`);
        await page.evaluate(() => {
          const input = document.querySelector("input") as HTMLInputElement;
          const picker = document.querySelector(".ui-datepicker") as HTMLElement;
          input.addEventListener("click", () => { picker.style.display = "block"; });
          for (const button of document.querySelectorAll<HTMLButtonElement>("[data-value]")) {
            button.addEventListener("click", () => {
              input.value = button.dataset.value!;
              input.dataset.appliedByCalendar = "true";
              picker.style.display = "none";
            });
          }
        });
        assert.equal(await functions.verifyScheduleDateApplied(page, target), false, "article date cannot mask actual input mismatch");
        assert.equal(await functions.setInputValueWithNativeEvents(page.locator("input"), "2026. 09. 23"), "", "read-only native mutation must be refused");
        assert.equal(await page.locator("input").inputValue(), "2026. 09. 21");
        assert.equal(await functions.trySetScheduleDateViaDatepicker(page, target), true, `${file} ${inputClass}`);
        assert.equal(await functions.verifyScheduleDateApplied(page, target), true);
        assert.equal(await page.locator("input").getAttribute("data-applied-by-calendar"), "true");
      }
      await page.setContent(`<div class="layer_publish__changed">${snapshotInput}</div><div class="ui-datepicker" style="display:none"><div class="ui-datepicker-title">2026년 9월</div><table><tr><td class="ui-state-disabled"><button class="ui-state-default">23</button></td></tr></table></div>`);
      await page.locator("input").evaluate(input => input.addEventListener("click", () => { (document.querySelector(".ui-datepicker") as HTMLElement).style.display = "block"; }));
      assert.equal(await functions.trySetScheduleDateViaDatepicker(page, target), false, "disabled target stays blocked");
      assert.equal(await functions.verifyScheduleDateApplied(page, target), false);
      console.log(`PASS ${file}: saved DOM, old/new CSS hashes, calendar state, adjacent month and disabled date`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
