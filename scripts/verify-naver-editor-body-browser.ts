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
    const editingFixture = `<!doctype html><html><body class="se-body"><div class="se-canvas se-native-selection-hidden"><div class="se-content"><div class="se-main-container">
      <div class="se-component se-documentTitle se-is-selected" id="SE-fixture-title" data-compid="SE-fixture-title"><p id="SE-fixture-title-paragraph" class="se-text-paragraph" contenteditable="true" tabindex="0"><span id="SE-fixture-title-node">검증 제목</span></p></div>
      <div class="se-insert-menu"><div class="se-insert-point-marker-button" tabindex="0"><span class="se-blind">추가할 컴포넌트를 선택하세요.</span></div></div>
      <div class="se-component se-text" id="SE-fixture-body" data-compid="SE-fixture-body"><div id="SE-fixture-unit" class="se-module se-module-text __se-unit"><p id="SE-fixture-body-paragraph" class="se-text-paragraph" style="min-height:30px"><span id="SE-fixture-body-node" class="__se-node"></span></p></div></div>
      </div></div></div><button class="se-toolbar" type="button">본문</button>
      <script src="https://editor-static.pstatic.net/e/basic.desktop/1.78.1/se-editor.js"></script>
      <iframe id="input_buffer123456" title=" 스마트 에디터, 접근성 도움말은 alt + 0 " srcdoc='<body contenteditable="true" aria-multiline="true"></body>' style="position:fixed;left:-9999px;width:17px;height:100%"></iframe>
      </body></html>`;
    async function setupEditing() {
      await page.setContent(editingFixture);
      await page.frameLocator("iframe").locator("body").waitFor({ state: "attached" });
      await page.evaluate(() => {
        const body = document.querySelector(".se-text .se-text-paragraph")!;
        const frame = document.querySelector("iframe") as HTMLIFrameElement;
        const buffer = frame.contentDocument!.body;
        const endpoint = (component: string, paragraph: string, node: string) => ({ compId: component, paraId: paragraph, nodeId: node, unitId: "SE-fixture-unit", offset: 0 });
        const state = { anchor: endpoint("SE-fixture-title", "SE-fixture-title-paragraph", "SE-fixture-title-node"),
          focus: endpoint("SE-fixture-title", "SE-fixture-title-paragraph", "SE-fixture-title-node"), isCollapsed: true };
        const editor = { _papyrus: { getSelection: () => structuredClone(state) }, _virtualEditable: { getInputElement: () => buffer }, state };
        (window as unknown as { SmartEditor: unknown }).SmartEditor = { _editors: { fixture: editor } };
        body.addEventListener("click", () => {
          document.querySelector(".se-documentTitle")!.classList.remove("se-is-selected");
          // Real Naver cursor selection does not add se-is-selected to text.
          const point = endpoint(body.closest(".se-component")!.id, body.id, "SE-fixture-body-node");
          state.anchor = point; state.focus = { ...point }; state.isCollapsed = true;
          const range = document.createRange(); range.selectNodeContents(body); range.collapse(true);
          window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
          frame.contentWindow!.focus(); buffer.focus();
        });
        buffer.addEventListener("input", () => { body.querySelector("span")!.textContent = buffer.innerText; });
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
      other.innerHTML = '<div id="SE-fixture-unit-b" class="se-module se-module-text __se-unit"><p id="SE-fixture-paragraph-b" class="se-text-paragraph"><span id="SE-fixture-node-b" class="__se-node"></span></p></div>'; document.querySelector(".se-main-container")!.append(other);
      const state = (window as unknown as { SmartEditor: { _editors: { fixture: { state: { anchor: object; focus: object } } } } }).SmartEditor._editors.fixture.state;
      const point = { compId: other.id, paraId: "SE-fixture-paragraph-b", nodeId: "SE-fixture-node-b", unitId: "SE-fixture-unit-b", offset: 0 };
      state.anchor = point; state.focus = { ...point };
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
    // Real 1.78.1 has no selected-text CSS marker. Its pure selection getter is
    // accepted only with the exact editable input element and unique DOM owners.
    await setupEditing(); await production.focusFreshNaverEditorBody(page);
    const modelFocus = await page.evaluate(readNaverEditorTypingFocus);
    assert.equal(modelFocus.selectedBodyCount, 0); assert.equal(modelFocus.selectionSource, "smarteditor-model");
    assert.equal(modelFocus.selectedParagraphId, "SE-fixture-body-paragraph"); cases++;
    const model = 'window.SmartEditor._editors.fixture';
    const invalidModels: Array<[string, string]> = [
      ["unknown editor version", 'document.querySelector("script").src = "https://editor-static.pstatic.net/e/basic.desktop/1.79.0/se-editor.js"'],
      ["multiple editor instances", `window.SmartEditor._editors.second = ${model}`],
      ["missing selection API", `${model}._papyrus.getSelection = undefined`],
      ["throwing selection getter", `${model}._papyrus.getSelection = () => { throw new Error("fixture") }`],
      ["foreign input element", `${model}._virtualEditable.getInputElement = () => document.body`],
      ["noncollapsed model", `${model}.state.isCollapsed = false`],
      ["different endpoint offset", `${model}.state.focus.offset = 1`],
      ["cross-owner endpoint", `${model}.state.focus.paraId = "SE-fixture-title-paragraph"`],
      ["negative model offset", `${model}.state.anchor.offset = ${model}.state.focus.offset = -1`],
      ["offset outside text node", `${model}.state.anchor.offset = ${model}.state.focus.offset = 10000`],
      ["missing unit owner", 'document.querySelector("#SE-fixture-unit").removeAttribute("id")'],
      ["hidden text node", 'document.querySelector("#SE-fixture-body-node").style.display = "none"'],
      ["node outside model paragraph", 'document.body.append(document.querySelector("#SE-fixture-body-node"))'],
      ["duplicate paragraph ID", 'document.body.append(document.querySelector("#SE-fixture-body-paragraph").cloneNode(true))'],
      ["duplicate component ID", 'document.body.append(document.querySelector("#SE-fixture-body").cloneNode(true))'],
      ["duplicate node ID", 'document.querySelector("#SE-fixture-body-paragraph").append(document.querySelector("#SE-fixture-body-node").cloneNode(true))'],
      ["hidden current component", 'document.querySelector("#SE-fixture-body").style.display = "none"'],
      ["hidden keyboard buffer", 'document.querySelector("iframe").style.display = "none"'],
      ["CSS title conflict", 'document.querySelector(".se-documentTitle").classList.add("se-is-selected")'],
      ["non-text CSS conflict", 'document.querySelector("#SE-fixture-body").className = "se-component se-image se-is-selected"'],
      ["foreign selected component", 'document.querySelector(".se-main-container").insertAdjacentHTML("beforeend", `<div class="se-component se-image se-is-selected" id="SE-selected-image"></div>`)'],
      ["native noncollapsed selection", 'const range = document.createRange(); range.selectNodeContents(document.querySelector(".se-documentTitle p")); window.getSelection().removeAllRanges(); window.getSelection().addRange(range)'],
      ["native title conflict", 'const range = document.createRange(); range.selectNodeContents(document.querySelector(".se-documentTitle p")); range.collapse(true); window.getSelection().removeAllRanges(); window.getSelection().addRange(range)'],
      ["duplicate caret placeholders", 'document.querySelector("#SE-fixture-body-paragraph").insertAdjacentHTML("beforeend", `<span class="se-placeholder-focused"></span><span class="se-placeholder-focused"></span>`)'],
      ["multiple visible editor roots", 'document.body.insertAdjacentHTML("beforeend", `<div class="se-main-container"></div>`)'],
    ];
    for (const [label, mutation] of invalidModels) {
      await setupEditing(); await production.focusFreshNaverEditorBody(page);
      const before = await page.evaluate(readNaverEditorTypingFocus);
      // Controlled DOM adversaries, never evaluated against an online editor.
      await page.evaluate(mutation);
      assert.equal((await page.evaluate(readNaverEditorTypingFocus)).bodyFocused, false, label);
      await assert.rejects(() => production.assertCurrentEditorTypingFocus(page, before), /FOCUS_UNCONFIRMED/, label); cases++;
    }
    await setupEditing(); await production.focusFreshNaverEditorBody(page);
    const beforeRebuild = await page.evaluate(readNaverEditorTypingFocus);
    await page.evaluate(`${model}.state.anchor.compId = ${model}.state.focus.compId = "SE-rebuilt-body";
      const component = document.querySelector("#SE-fixture-body"); component.id = "SE-rebuilt-body"; component.dataset.compid = component.id;
      const range = document.createRange(); range.selectNodeContents(document.querySelector(".se-main-container")); range.collapse(true);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);`);
    const rebuilt = await page.evaluate(readNaverEditorTypingFocus);
    assert.equal(rebuilt.bodyFocused, true); assert.notEqual(rebuilt.selectedBodyId, beforeRebuild.selectedBodyId);
    assert.equal(rebuilt.selectedParagraphId, beforeRebuild.selectedParagraphId);
    await assert.doesNotReject(() => production.assertCurrentEditorTypingFocus(page, beforeRebuild)); cases++;
    // Enter changes the semantic paragraph while the hidden native range can
    // still point into the preceding paragraph. That range is not authoritative.
    await setupEditing(); await production.focusFreshNaverEditorBody(page);
    const beforeEnter = await page.evaluate(readNaverEditorTypingFocus);
    await page.evaluate(`document.querySelector("#SE-fixture-unit").insertAdjacentHTML("beforeend", '<p class="se-text-paragraph" id="SE-enter-paragraph"><span class="__se-node" id="SE-enter-node"></span></p>');
      ${model}.state.anchor.paraId = ${model}.state.focus.paraId = "SE-enter-paragraph";
      ${model}.state.anchor.nodeId = ${model}.state.focus.nodeId = "SE-enter-node";`);
    const afterEnter = await page.evaluate(readNaverEditorTypingFocus);
    assert.equal(afterEnter.bodyFocused, true); assert.equal(afterEnter.nativeSelectionHidden, true);
    assert.equal(afterEnter.selectedParagraphId, "SE-enter-paragraph"); cases++;
    await assert.rejects(() => production.assertCurrentEditorTypingFocus(page, beforeEnter), /FOCUS_UNCONFIRMED/,
      "a toolbar cannot move to another paragraph even within the same component/buffer"); cases++;
    await page.locator(".se-canvas").evaluate(element => element.classList.remove("se-native-selection-hidden"));
    assert.equal((await page.evaluate(readNaverEditorTypingFocus)).bodyFocused, false, "a visible native selection must agree with the model"); cases++;
    await setupEditing(); await production.focusFreshNaverEditorBody(page);
    await page.evaluate('delete window.SmartEditor; document.querySelector(".se-canvas").classList.remove("se-native-selection-hidden")');
    assert.equal((await page.evaluate(readNaverEditorTypingFocus)).bodyFocused, false, "a native range plus a virtual buffer cannot replace a missing model"); cases++;
    await page.locator("#SE-fixture-body-paragraph").evaluate(element => { element.setAttribute("contenteditable", "true"); (element as HTMLElement).focus();
      const range = document.createRange(); range.selectNodeContents(element); range.collapse(true); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); });
    const nativeFocus = await page.evaluate(readNaverEditorTypingFocus);
    assert.equal(nativeFocus.bodyFocused, true); assert.equal(nativeFocus.selectionSource, "native-range"); cases++;
    await page.locator(".se-canvas").evaluate(element => element.classList.add("se-native-selection-hidden"));
    assert.equal((await page.evaluate(readNaverEditorTypingFocus)).bodyFocused, false, "a hidden stale range is not an independent typing target"); cases++;
    console.log(`Naver editor Chromium fixture: ${cases} production reader and typing-focus cases passed`);
  } finally { await browser.close(); }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
