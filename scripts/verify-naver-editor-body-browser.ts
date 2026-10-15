import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { chromium } from "playwright";
import { assertNaverEditorBody, assertNaverEditorTypingFocus, readNaverEditorBodySnapshot, readNaverEditorTypingFocus, type NaverEditorTypingFocus } from "./lib/naver-editor-body";
import { getConnectAffiliateDisclosure } from "../src/lib/connect-disclosure";
import { resolvePostDocument } from "../src/lib/post-composition-contract";

// Naver SmartEditor 1.78.1 renders this accessibility-only label in its insert
// menu (se-app-context.js + Korean se-messages5.js). The clipping rule is from
// https://editor-static.pstatic.net/e/basic.desktop/1.78.1/css/59.se-editor.css.
// Run the actual serialized reader in Chromium, without network or Naver writes.
const fixture = `<!doctype html><html><head><style>
  .se-blind { position:absolute; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); width:1px; height:1px }
</style></head><body class="se-body"><div class="se-content"><div class="se-main-container">
  <div class="se-component se-text se-l-default"><p class="se-text-paragraph">검증용 본문</p></div>
  <div class="se-insert-menu"><div class="se-insert-point-marker-button">
    <span class="se-insert-point-marker-icon"></span><span class="se-blind">추가할 컴포넌트를 선택하세요.</span>
  </div></div>
</div></div></body></html>`;

const notice = getConnectAffiliateDisclosure("SHOPPING");
const doc = resolvePostDocument({ connectKind: "SHOPPING", title: "회귀 검증", sections: ["확인\n검증용 본문입니다."], imagePaths: [], hashtags: [], connectUrl: "" });
const editorSource = ts.createSourceFile("simple-agent.ts", fs.readFileSync("scripts/simple-agent.ts", "utf8"), ts.ScriptTarget.Latest, true);
const names = ["assertCurrentEditorTypingFocus", "focusFreshNaverEditorBody", "inputPlainParagraph"];
const productionCode = ts.transpileModule(names.map(name => {
  const node = editorSource.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert(node, `cover production ${name}`); return node.getText(editorSource);
}).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent(fixture);
    const snapshot = await page.evaluate(readNaverEditorBodySnapshot);
    assert.equal(snapshot.scope, "confirmed", `accessibility insert-menu label is not article text: ${snapshot.reason}`);
    assert.equal(snapshot.text, "검증용 본문");
    let cases = 1;
    await page.locator(".se-main-container").evaluate(root => { root.append(document.createTextNode("추가할 컴포넌트를 선택하세요.")); });
    assert.equal((await page.evaluate(readNaverEditorBodySnapshot)).reason, "unscoped-visible-text"); cases++;
    await page.setContent(fixture.replace("검증용 본문", ""));
    assert.throws(() => assertNaverEditorBody(doc, snapshot, "disclosure"), /DISCLOSURE_MISMATCH/);
    assert.throws(() => assertNaverEditorBody(doc, { ...snapshot, text: "", leadingContent: "none" }, "disclosure"), /DISCLOSURE_MISMATCH|CONTENT_MISSING/); cases++;
    for (const extra of ["<p>범위 밖 본문</p>", "<img src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='>", "<div class='se-main-container'><div class='se-component'>다른 편집기</div></div>"]) {
      await page.setContent(fixture);
      // Ensure the adversarial content is in the .se-content alias scope.
      await page.locator(".se-content").evaluate((root, html) => { root.insertAdjacentHTML("afterbegin", html); }, extra);
      assert.notEqual((await page.evaluate(readNaverEditorBodySnapshot)).scope, "confirmed"); cases++;
    }
    const editingFixture = `<!doctype html><html><body class="se-body"><div class="se-content"><div class="se-main-container">
      <div class="se-component se-documentTitle se-is-selected" id="SE-fixture-title" data-compid="SE-fixture-title"><p class="se-text-paragraph" contenteditable="true" tabindex="0">검증 제목</p></div>
      <div class="se-insert-menu"><div class="se-insert-point-marker-button" tabindex="0"><span class="se-blind">추가할 컴포넌트를 선택하세요.</span></div></div>
      <div class="se-component se-text" id="SE-fixture-body" data-compid="SE-fixture-body"><p class="se-text-paragraph" style="min-height:30px"></p></div>
      </div></div><button class="se-toolbar" type="button">본문</button>
      <iframe id="input_buffer123456" title=" 스마트 에디터, 접근성 도움말은 alt + 0 " srcdoc='<body contenteditable="true" aria-multiline="true"></body>' style="position:fixed;left:-9999px;width:17px;height:100%"></iframe>
      </body></html>`;
    async function setupEditing() {
      await page.setContent(editingFixture);
      await page.frameLocator("iframe").locator("body").waitFor({ state: "attached" });
      await page.evaluate(() => {
        const body = document.querySelector(".se-text .se-text-paragraph")!;
        const frame = document.querySelector("iframe") as HTMLIFrameElement;
        const buffer = frame.contentDocument!.body;
        body.addEventListener("click", () => {
          document.querySelector(".se-documentTitle")!.classList.remove("se-is-selected");
          body.closest(".se-component")!.classList.add("se-is-selected");
          frame.contentWindow!.focus(); buffer.focus();
        });
        buffer.addEventListener("input", () => { body.textContent = buffer.innerText; });
        // Keep the real browser's toolbar focus. Production must restore only
        // the previously confirmed virtual body selection, without a body click.
      });
    }
    await setupEditing();
    await page.locator(".se-documentTitle p").focus();
    await page.keyboard.press("Tab");
    assert.equal((await page.evaluate(readNaverEditorTypingFocus)).bodyFocused, false);
    await page.keyboard.type("검증 전용 입력");
    assert.equal((await page.evaluate(readNaverEditorBodySnapshot)).textLength, 0, "blind Tab order cannot establish the body target"); cases++;
    await setupEditing();
    const production = vm.runInNewContext(`${productionCode}; ({ focusFreshNaverEditorBody, inputPlainParagraph, assertCurrentEditorTypingFocus });`, {
      readNaverEditorBodySnapshot, readNaverEditorTypingFocus, assertNaverEditorTypingFocus,
      console: { error() {} }, setNaverTextFormat: async () => { await page.locator("button").click(); return true; },
    }) as { focusFreshNaverEditorBody: (page: unknown) => Promise<void>; inputPlainParagraph: (page: unknown, text: string) => Promise<void>;
      assertCurrentEditorTypingFocus: (page: unknown, previous: NaverEditorTypingFocus) => Promise<void> };
    await production.focusFreshNaverEditorBody(page);
    assert.equal((await page.evaluate(readNaverEditorTypingFocus)).bodyFocused, true);
    await production.inputPlainParagraph(page, notice);
    const afterTyping = await page.evaluate(readNaverEditorBodySnapshot);
    assert.doesNotThrow(() => assertNaverEditorBody(doc, afterTyping, "disclosure")); cases++;
    await production.inputPlainParagraph(page, "두 번째 검증 문단");
    assert.equal((await page.evaluate(readNaverEditorBodySnapshot)).text.replace(/\s+/gu, ""),
      notice.replace(/\s+/gu, "") + "두번째검증문단"); cases++;
    await page.frameLocator("iframe").locator("body").evaluate(buffer => {
      buffer.textContent = "앞부분|뒷부분";
      const selection = buffer.ownerDocument.getSelection()!;
      const range = buffer.ownerDocument.createRange();
      range.setStart(buffer.firstChild!, 4); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
      buffer.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await production.inputPlainParagraph(page, "중간");
    assert.equal((await page.evaluate(readNaverEditorBodySnapshot)).text.replace(/\s+/gu, ""), "앞부분|중간뒷부분",
      "restoring the same buffer must preserve the existing insertion position and surrounding article order"); cases++;
    await assert.rejects(() => production.focusFreshNaverEditorBody(page), /BODY_START_UNCONFIRMED/); cases++;
    await page.evaluate(() => {
      document.querySelector(".se-text")!.classList.remove("se-is-selected");
      document.querySelector(".se-documentTitle")!.classList.add("se-is-selected");
    });
    const titleFocus = await page.evaluate(readNaverEditorTypingFocus);
    assert.equal(titleFocus.activeKind, "input-buffer"); assert.equal(titleFocus.bodyFocused, false);
    assert.throws(() => assertNaverEditorTypingFocus(titleFocus), /FOCUS_UNCONFIRMED/); cases++;
    const beforeRejected = (await page.evaluate(readNaverEditorBodySnapshot)).text;
    await assert.rejects(() => production.inputPlainParagraph(page, "입력하면 안 됨"), /FOCUS_UNCONFIRMED/);
    assert.equal((await page.evaluate(readNaverEditorBodySnapshot)).text, beforeRejected); cases++;
    await page.evaluate(() => { document.querySelector(".se-documentTitle")!.classList.remove("se-is-selected"); });
    assert.equal((await page.evaluate(readNaverEditorTypingFocus)).bodyFocused, false, "an input buffer without a body selection is not enough"); cases++;
    await setupEditing();
    await production.focusFreshNaverEditorBody(page);
    await page.evaluate(() => {
      const frame = document.querySelector("iframe")!.cloneNode(true) as HTMLIFrameElement;
      frame.id = "input_buffer654321"; document.body.append(frame);
    });
    await page.frameLocator("#input_buffer654321").locator("body").waitFor({ state: "attached" });
    assert.equal((await page.evaluate(readNaverEditorTypingFocus)).bodyFocused, false, "multiple keyboard buffers must fail closed"); cases++;
    await assert.rejects(() => production.inputPlainParagraph(page, "입력하면 안 됨"), /FOCUS_UNCONFIRMED/); cases++;
    await setupEditing();
    await production.focusFreshNaverEditorBody(page);
    await page.locator(".se-insert-point-marker-button").focus();
    assert.equal((await page.evaluate(readNaverEditorTypingFocus)).bodyFocused, false, "a toolbar/insert control cannot receive article text"); cases++;
    for (const className of ["se-image", "se-oglink", "se-quotation", "se-horizontalLine", "se-unknown"]) {
      await setupEditing(); await production.focusFreshNaverEditorBody(page);
      await page.locator("#SE-fixture-body").evaluate((element, type) => { element.setAttribute("class", `se-component ${type} se-is-selected`); }, className);
      const visualFocus = await page.evaluate(readNaverEditorTypingFocus);
      assert.equal(visualFocus.activeKind, "input-buffer"); assert.equal(visualFocus.selectedBodyCount, 1);
      assert.equal(visualFocus.bodyFocused, false, `${className} is not a text insertion target even with a focused buffer`);
      await assert.rejects(() => production.inputPlainParagraph(page, "입력하면 안 됨"), /FOCUS_UNCONFIRMED/); cases++;
    }
    await setupEditing(); await production.focusFreshNaverEditorBody(page);
    const beforeA = await page.evaluate(readNaverEditorTypingFocus);
    await page.evaluate(() => {
      document.querySelector("#SE-fixture-body")!.classList.remove("se-is-selected");
      const other = document.createElement("div"); other.className = "se-component se-text se-is-selected";
      other.id = "SE-fixture-body-b"; other.setAttribute("data-compid", other.id);
      other.innerHTML = '<p class="se-text-paragraph"></p>'; document.querySelector(".se-main-container")!.append(other);
    });
    const afterB = await page.evaluate(readNaverEditorTypingFocus);
    assert.equal(afterB.bodyFocused, true, "the counterexample keeps a valid buffer and text target focused");
    assert.notEqual(beforeA.selectedBodyId, afterB.selectedBodyId);
    await assert.rejects(() => production.assertCurrentEditorTypingFocus(page, beforeA), /FOCUS_UNCONFIRMED/); cases++;
    await page.locator("#SE-fixture-body p").evaluate(element => { element.setAttribute("contenteditable", "true"); (element as HTMLElement).focus(); });
    assert.equal((await page.evaluate(readNaverEditorTypingFocus)).bodyFocused, false, "native editable A cannot disagree with selected component B"); cases++;
    await setupEditing(); await production.focusFreshNaverEditorBody(page);
    await page.locator("#SE-fixture-body").evaluate(element => { element.setAttribute("class", "se-component se-sectionTitle se-is-selected"); });
    assert.equal((await page.evaluate(readNaverEditorTypingFocus)).bodyFocused, true, "a real section-title text component remains supported"); cases++;
    console.log(`Naver editor Chromium fixture: ${cases} production reader and typing-focus cases passed`);
  } finally { await browser.close(); }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
