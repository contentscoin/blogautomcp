import assert from "node:assert/strict";
import type { Page } from "playwright";
import { applyEditorialEditorStyle } from "./lib/naver-editorial-style";
import { createEditorialSelection } from "./lib/editorial-templates";

async function main() {
  let selectedSize = "15";
  let selectedColor = "rgb(0, 0, 0)";
  let retain = true;
  const calls: string[] = [];
  const locator = (selector: string): any => ({
    first() { return this; }, locator,
    isVisible: async () => true,
    click: async () => {
      calls.push(selector);
      if (retain && selector.includes('data-value="fs')) selectedSize = selector.match(/fs(\d+)/)![1];
      if (retain && selector.includes("data-color")) {
        const hex = selector.match(/#[a-f0-9]+/)![0];
        selectedColor = `rgb(${hex.match(/[a-f\d]{2}/gi)!.map(v => parseInt(v, 16)).join(", ")})`;
      }
    },
    innerText: async () => selector.includes("font-size") ? selectedSize : selector.includes("font-family") ? "나눔고딕" : selector.includes("line-height") ? "180" : "왼쪽",
    getAttribute: async () => null,
    evaluate: async () => selectedColor,
  });
  const page = { locator, waitForFunction: async () => {}, keyboard: { press: async () => {} } } as unknown as Page;
  const selection = createEditorialSelection("SHOPPING", {});
  await applyEditorialEditorStyle(page, selection, "heading");
  assert.ok(selection.applied.includes("heading:font-size"));
  assert.ok(selection.applied.includes("heading:color"));
  assert.equal(selectedSize, "19");
  await applyEditorialEditorStyle(page, selection, "body");
  assert.equal(selectedSize, "16", "Heading size reset");
  assert.equal(selectedColor, "rgb(51, 51, 51)", "Heading color reset");
  retain = false;
  await applyEditorialEditorStyle(page, selection, "heading");
  assert.ok(!selection.applied.includes("heading:font-size"), "Successful click without retained value is not success");
  assert.ok(!selection.applied.includes("heading:color"));
  assert.ok(selection.unsupported.includes("heading:color"));
  assert.match(selection.failures["heading:color"], /not retained/);
  retain = true;
  await applyEditorialEditorStyle(page, selection, "heading");
  assert.ok(!selection.unsupported.includes("heading:color"));
  assert.equal(selection.failures["heading:color"], undefined);
  assert.ok(calls.some(call => call.includes('data-value="180"')));
  console.log("PASS observed toolbar options, retained-value checks, body reset, click-only failure reporting");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
