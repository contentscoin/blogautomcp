import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { assertPublishedEditorText, publishedReadinessSections } from "./lib/published-editor-audit";
import { assertNaverEditorBody, editorBodyAuditDiagnostic, type NaverEditorBodySnapshot } from "./lib/naver-editor-body";
import { resolvePostDocument, type ResolvedPostDocumentV1 } from "../src/lib/post-composition-contract";
import { getConnectAffiliateDisclosure } from "../src/lib/connect-disclosure";
const document = { sections: [{ id: "body", title: "stale metadata", body: ["stale body"] }], renderNodes: [
  { kind: "paragraph", sectionId: "body", text: "Q. 향은 무엇인가요?\nA. 라벤더향입니다. 선택 옵션을 확인하세요." },
  { kind: "hashtags", values: ["바디워시", "아비노"] },
  { kind: "disclosure", text: "이 포스팅은 수수료를 제공받습니다." },
] } as ResolvedPostDocumentV1;
const text = "Q. 향은 무엇인가요?\nA. 라벤더향입니다. 선택 옵션을 확인하세요.\n#바디워시 #아비노\n이 포스팅은 수수료를 제공받습니다.";
assert.doesNotThrow(() => assertPublishedEditorText(document, text));
assert.throws(() => assertPublishedEditorText(document, ""), /MISSING/);
assert.throws(() => assertPublishedEditorText(document, text.replace("라벤더향입니다.", "")), /CONTENT_MISMATCH/);
assert.throws(() => assertPublishedEditorText(document, text.replace("#아비노\n이", "#아비노이")), /HASHTAG_MISMATCH/);
assert.throws(() => assertPublishedEditorText(document, text + " #아비노"), /HASHTAG_MISMATCH/);
assert.deepEqual(publishedReadinessSections(document), ["Q. 향은 무엇인가요?\nA. 라벤더향입니다. 선택 옵션을 확인하세요.", "이 포스팅은 수수료를 제공받습니다."]);
const sceneCaption = "상품 원본을 참조한 AI 연출 이미지입니다. 실제 사용 사진이 아닙니다.";
const sceneDocument = { ...document, renderNodes: [
  { kind: "disclosure", placement: "top", text: "이 포스팅은 수수료를 제공받습니다." },
  { kind: "image", role: "hero", assetPath: "scene.png", caption: sceneCaption },
  document.renderNodes[0],
  document.renderNodes[1],
] } as ResolvedPostDocumentV1;
const sceneText = `이 포스팅은 수수료를 제공받습니다.\n${sceneCaption}\nQ. 향은 무엇인가요?\nA. 라벤더향입니다. 선택 옵션을 확인하세요.\n#바디워시 #아비노`;
assert.doesNotThrow(() => assertPublishedEditorText(sceneDocument, sceneText));
assert.throws(() => assertPublishedEditorText(sceneDocument, sceneText.replace(sceneCaption, "")), /CONTENT_MISMATCH/);
assert.throws(() => assertPublishedEditorText(sceneDocument, `${sceneCaption}\n${sceneText.replace(`${sceneCaption}\n`, "")}`), /DISCLOSURE_MISMATCH/);
for (const connectKind of ["SHOPPING", "TRAVEL"] as const) {
  const notice = getConnectAffiliateDisclosure(connectKind);
  const canonical = resolvePostDocument({ connectKind, title: "선택 안내", sections: ["조건\n확인한 선택 조건을 설명합니다."],
    imagePaths: [], hashtags: ["선택기준"], connectUrl: "" });
  const body = "조건\n확인한 선택 조건을 설명합니다.\n#선택기준";
  assert.doesNotThrow(() => assertPublishedEditorText(canonical, `${notice}\n${body}`));
  assert.throws(() => assertPublishedEditorText(canonical, `${body}\n${notice}`), /DISCLOSURE_MISMATCH/);
  assert.throws(() => assertPublishedEditorText(canonical, `먼저 읽어주세요.\n${notice}\n${body}`), /DISCLOSURE_MISMATCH/);
  assert.throws(() => assertPublishedEditorText(canonical, `${notice}\n${body}\n${notice}`), /DISCLOSURE_MISMATCH/);
  assert.throws(() => assertPublishedEditorText(canonical, `${notice.replace("제공받습니다", "제공받을 수 있습니다")}\n${body}`), /DISCLOSURE_MISMATCH/);
}

// The production page.evaluate reader runs in a DOM fixture, without a browser,
// editor writes, external requests or page-title text heuristics.
class TextFixture {
  readonly nodeType = 3;
  parentElement: ElementFixture | null = null;
  constructor(public nodeValue: string) {}
}
class ElementFixture {
  readonly nodeType = 1;
  parentElement: ElementFixture | null = null;
  readonly childNodes: Array<ElementFixture | TextFixture> = [];
  readonly attributes: Record<string, string>;
  style = { display: "block", visibility: "visible", opacity: "1" };
  constructor(readonly tagName = "DIV", className = "", ...children: Array<ElementFixture | string>) {
    this.attributes = className ? { class: className } : {};
    for (const child of children) this.append(child);
  }
  append(child: ElementFixture | string) {
    const node = typeof child === "string" ? new TextFixture(child) : child;
    node.parentElement = this; this.childNodes.push(node); return this;
  }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  hasAttribute(name: string) { return name in this.attributes; }
  matches(selector: string): boolean {
    return selector.split(",").some(part => {
      const value = part.trim();
      if (value.startsWith(".")) return (this.attributes.class || "").split(/\s+/u).includes(value.slice(1));
      const attr = value.match(/^\[([^=]+)="([^"]+)"\]$/u);
      return Boolean(attr && this.getAttribute(attr[1]!) === attr[2]);
    });
  }
  closest(selector: string): ElementFixture | null {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
  }
  contains(element: ElementFixture): boolean {
    return element === this || Boolean(element.parentElement && this.contains(element.parentElement));
  }
  querySelectorAll(selector: string): ElementFixture[] {
    return this.childNodes.flatMap(node => node instanceof ElementFixture
      ? [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)] : []);
  }
}
const paragraph = (text: string) => new ElementFixture("P", "se-text-paragraph", text);
const component = (...children: Array<ElementFixture | string>) => new ElementFixture("DIV", "se-component se-text", ...children);
const readerSource = ts.createSourceFile("naver-editor-body.ts", fs.readFileSync("scripts/lib/naver-editor-body.ts", "utf8"), ts.ScriptTarget.Latest, true);
const readerNode = readerSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "readNaverEditorBodySnapshot");
assert(readerNode, "test the production serialized reader, not a copied selector implementation");
const readerCode = ts.transpileModule(readerNode.getText(readerSource).replace(/^export\s+/u, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function readerFor(...roots: ElementFixture[]) {
  const dom = new ElementFixture("HTML", "", new ElementFixture("BODY", "", ...roots));
  const sandbox = { document: dom, window: { getComputedStyle: (element: ElementFixture) => element.style } };
  return vm.runInNewContext(`${readerCode}; readNaverEditorBodySnapshot`, sandbox) as () => NaverEditorBodySnapshot;
}
function bodyFixture(body: string[], title = "선택 안내", extras: ElementFixture[] = []) {
  const bodyComponent = component(...body.map(paragraph));
  const root = new ElementFixture("DIV", "se-main-container",
    new ElementFixture("DIV", "se-component se-documentTitle", paragraph(title)),
    new ElementFixture("DIV", "se-toolbar", "본문", "도움말"), ...extras, bodyComponent);
  return { root, bodyComponent, read: readerFor(root) };
}
let domCases = 0;
function passBody(doc: ResolvedPostDocumentV1, fixture: ReturnType<typeof bodyFixture>, phase: "disclosure" | "final" = "final") {
  const snapshot = fixture.read(); assert.equal(snapshot.scope, "confirmed");
  assert.doesNotThrow(() => assertNaverEditorBody(doc, snapshot, phase)); domCases++; return snapshot;
}
function failBody(doc: ResolvedPostDocumentV1, fixture: ReturnType<typeof bodyFixture>, error: RegExp, phase: "disclosure" | "final" = "final") {
  assert.throws(() => assertNaverEditorBody(doc, fixture.read(), phase), error); domCases++;
}
for (const kind of ["SHOPPING", "TRAVEL"] as const) {
  const notice = getConnectAffiliateDisclosure(kind);
  const doc = resolvePostDocument({ connectKind: kind, title: "선택 안내", sections: ["조건\n확인한 선택 조건을 설명합니다."], imagePaths: [], hashtags: ["선택기준"], connectUrl: "" });
  const body = [notice, "조건", "확인한 선택 조건을 설명합니다.", "#선택기준"];
  const correct = passBody(doc, bodyFixture(body));
  assert.equal(correct.excludedTitleCount, 1); assert.equal(correct.excludedUiCount, 1);
  assert(!correct.text.includes("도움말"));
  passBody(doc, bodyFixture(body, notice)); // A disclosure in the title cannot count as a duplicate body notice.
  failBody(doc, bodyFixture(body.slice(1), notice), /DISCLOSURE_MISMATCH/); // Title alone cannot supply the body notice.
  failBody(doc, bodyFixture(body.slice(1)), /DISCLOSURE_MISMATCH/);
  failBody(doc, bodyFixture([...body, notice]), /DISCLOSURE_MISMATCH/);
  failBody(doc, bodyFixture([...body.slice(1), notice]), /DISCLOSURE_MISMATCH/);
  failBody(doc, bodyFixture(["선택 안내", ...body]), /DISCLOSURE_MISMATCH/); // Never delete a body first line that happens to equal the title.
  const sameTitleBody = passBody(doc, bodyFixture([notice, "선택 안내", ...body.slice(1)]));
  assert(sameTitleBody.text.includes("선택 안내"));
  failBody(doc, bodyFixture(body.slice(1), "선택 안내", [new ElementFixture("DIV", "se-toolbar", notice)]), /DISCLOSURE_MISMATCH/);
  passBody(doc, bodyFixture([notice]), "disclosure");
  failBody(doc, bodyFixture([]), /DISCLOSURE_MISMATCH|CONTENT_MISSING/, "disclosure");
  failBody(doc, bodyFixture([notice, notice]), /DISCLOSURE_MISMATCH/, "disclosure");
}
const notice = getConnectAffiliateDisclosure("SHOPPING");
const topDoc = resolvePostDocument({ connectKind: "SHOPPING", title: "상품", sections: ["조건\n선택 조건입니다."], imagePaths: [], hashtags: ["선택"], connectUrl: "" });
const topBody = [notice, "조건", "선택 조건입니다.", "#선택"];
const hidden = new ElementFixture("DIV", "se-main-container", component("오래된 본문")); hidden.style.display = "none";
const visible = bodyFixture(topBody);
assert.doesNotThrow(() => assertNaverEditorBody(topDoc, readerFor(hidden, visible.root)(), "final")); domCases++;
assert.throws(() => assertNaverEditorBody(topDoc, readerFor(visible.root, bodyFixture(topBody).root)(), "final"), /SCOPE_AMBIGUOUS/); domCases++;
const transparent = bodyFixture(topBody); transparent.root.style.opacity = "0";
assert.throws(() => assertNaverEditorBody(topDoc, transparent.read(), "final"), /SCOPE_MISSING/); domCases++;
const transparentAncestor = new ElementFixture("DIV", "", bodyFixture(topBody).root); transparentAncestor.style.opacity = "0";
assert.throws(() => assertNaverEditorBody(topDoc, readerFor(transparentAncestor)(), "final"), /SCOPE_MISSING/); domCases++;
assert.throws(() => assertNaverEditorBody(topDoc, readerFor(bodyFixture(topBody).root,
  new ElementFixture("DIV", "se-content", component(...topBody.map(paragraph))))(), "final"), /SCOPE_AMBIGUOUS/); domCases++;
const wrapper = new ElementFixture("DIV", "se-content", bodyFixture(topBody).root);
assert.doesNotThrow(() => assertNaverEditorBody(topDoc, readerFor(wrapper)(), "final")); domCases++;
const wrapperWithOutsideBody = new ElementFixture("DIV", "se-content", component("실제 본문이 고지 앞에 있음"), bodyFixture(topBody).root);
const outsideBodySnapshot = readerFor(wrapperWithOutsideBody)();
assert.equal(outsideBodySnapshot.reason, "body-components-outside-selected-root");
assert.throws(() => assertNaverEditorBody(topDoc, outsideBodySnapshot, "final"), /SCOPE_AMBIGUOUS/); domCases++;
const wrapperWithUnscopedBody = new ElementFixture("DIV", "se-content", paragraph("범위 밖 실제 본문"), bodyFixture(topBody).root);
assert.throws(() => assertNaverEditorBody(topDoc, readerFor(wrapperWithUnscopedBody)(), "final"), /SCOPE_AMBIGUOUS/); domCases++;
const wrapperWithOutsideUi = new ElementFixture("DIV", "se-content", new ElementFixture("DIV", "se-toolbar", "본문 도구"),
  new ElementFixture("DIV", "se-component se-documentTitle", paragraph("상품")), bodyFixture(topBody).root);
assert.doesNotThrow(() => assertNaverEditorBody(topDoc, readerFor(wrapperWithOutsideUi)(), "final")); domCases++;
passBody(topDoc, bodyFixture(topBody, "상품", [new ElementFixture("DIV", "se-insert-menu",
  new ElementFixture("DIV", "se-insert-point-marker-button", new ElementFixture("SPAN", "se-blind", "추가할 컴포넌트를 선택하세요.")))]));
const samePhraseArticle = bodyFixture(topBody); samePhraseArticle.root.append("추가할 컴포넌트를 선택하세요.");
failBody(topDoc, samePhraseArticle, /SCOPE_AMBIGUOUS/); // A matching string outside the real UI is still unknown article content.
failBody(topDoc, bodyFixture([], "상품", [new ElementFixture("DIV", "se-insert-menu", "추가할 컴포넌트를 선택하세요.")]),
  /DISCLOSURE_MISMATCH|CONTENT_MISSING/, "disclosure"); // Removing UI noise must never manufacture a body notice.
for (const tag of ["IMG", "VIDEO", "HR"]) {
  const outsideVisual = new ElementFixture("DIV", "se-content", new ElementFixture(tag), bodyFixture(topBody).root);
  const snapshot = readerFor(outsideVisual)(); assert.equal(snapshot.reason, "unscoped-visible-visual");
  assert.throws(() => assertNaverEditorBody(topDoc, snapshot, "final"), /SCOPE_AMBIGUOUS/); domCases++;
}
assert.throws(() => assertNaverEditorBody(topDoc, readerFor(new ElementFixture("DIV", "se-main-container", paragraph(topBody.join("\n"))))(), "final"), /SCOPE_MISSING/); domCases++;
assert.throws(() => assertNaverEditorBody(topDoc, readerFor()(), "final"), /SCOPE_MISSING/); domCases++;
const unscoped = bodyFixture(topBody); unscoped.root.append("범위가 불명확한 본문");
assert.equal(unscoped.read().reason, "unscoped-visible-text"); failBody(topDoc, unscoped, /SCOPE_AMBIGUOUS/);
const nested = bodyFixture([notice]); nested.bodyComponent.append(component(...topBody.slice(1).map(paragraph)));
const nestedSnapshot = passBody(topDoc, nested); assert.equal(nestedSnapshot.componentCount, 1);
const imageBefore = bodyFixture(topBody, "상품", [new ElementFixture("DIV", "se-component se-image", new ElementFixture("IMG"))]);
assert.equal(imageBefore.read().leadingContent, "visual"); failBody(topDoc, imageBefore, /DISCLOSURE_MISMATCH/);
for (const invisible of ["  \n", "\u200b", "\u200c\u200d\ufeff"]) {
  const invisibleThenImage = bodyFixture(topBody, "상품", [component(paragraph(invisible)),
    new ElementFixture("DIV", "se-component se-image", new ElementFixture("IMG"))]);
  assert.equal(invisibleThenImage.read().leadingContent, "visual"); failBody(topDoc, invisibleThenImage, /DISCLOSURE_MISMATCH/);
  passBody(topDoc, bodyFixture(topBody, "상품", [component(paragraph(invisible))]));
}
const imageAfter = bodyFixture(topBody); imageAfter.bodyComponent.append(new ElementFixture("DIV", "se-image", new ElementFixture("IMG")));
passBody(topDoc, imageAfter); // The same text component may contain a later image, but the notice is still first.
const hiddenComponent = component("고지가 아님"); hiddenComponent.attributes.hidden = "";
passBody(topDoc, bodyFixture(topBody, "상품", [hiddenComponent]));
const hiddenUiInBody = bodyFixture(topBody); hiddenUiInBody.bodyComponent.append(new ElementFixture("DIV", "se-toolbar", notice));
passBody(topDoc, hiddenUiInBody);
const fallback = new ElementFixture("DIV", "se-content", component(...topBody.map(paragraph)));
assert.doesNotThrow(() => assertNaverEditorBody(topDoc, readerFor(fallback)(), "final")); domCases++;
const tooLong = bodyFixture([notice, "x".repeat(100_001)]);
assert.equal(tooLong.read().reason, "body-read-limit"); assert.equal(tooLong.read().text, ""); failBody(topDoc, tooLong, /SCOPE_AMBIGUOUS/);
const tooMany = new ElementFixture("DIV", "se-main-container", ...Array.from({ length: 257 }, () => component("x")));
assert.equal(readerFor(tooMany)().reason, "body-component-limit"); domCases++;
const nodeLimit = bodyFixture([notice]); for (let i = 0; i < 20_001; i++) nodeLimit.bodyComponent.append("");
assert.equal(nodeLimit.read().reason, "body-read-limit"); failBody(topDoc, nodeLimit, /SCOPE_AMBIGUOUS/);
const longSnapshot = bodyFixture([notice, "x".repeat(10_000)]).read();
const diagnostic = editorBodyAuditDiagnostic(longSnapshot, "final", "e".repeat(1000), notice);
assert.equal(diagnostic.message.length, 300); assert.equal(diagnostic.bodyPrefix.length, 300); assert.equal(diagnostic.bodySuffix.length, 160);
assert.equal(diagnostic.disclosureOccurrences, 1); assert(!JSON.stringify(diagnostic).includes("x".repeat(1000))); domCases++;

async function verifyProductionEditorOrder() {
  const source = ts.createSourceFile("simple-agent.ts", fs.readFileSync("scripts/simple-agent.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const declarations = ["assertCurrentEditorDocument", "renderResolvedPostDocument", "step5and6_uploadAndWrite"].map(name => {
    const node = source.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert(node, `production ${name} must remain covered`); return node.getText(source);
  });
  const code = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  async function run(mode: "normal" | "missing-notice" | "duplicate-notice" | "reader-error" | "final-missing-notice") {
    const fixture = bodyFixture([]);
    const events: string[] = [], diagnostics: string[] = [];
    const doc = { ...topDoc, renderNodes: [topDoc.renderNodes[0]!, { kind: "image", role: "scene", assetPath: "fixture.png" },
      ...topDoc.renderNodes.slice(1)] } as ResolvedPostDocumentV1;
    let reads = 0;
    const typingFocus = () => ({ bodyFocused: true });
    const page = {
      evaluate: async (fn: () => unknown) => {
        if (fn === typingFocus) return typingFocus();
        events.push("read"); reads++;
        if (mode === "reader-error") throw new Error("fixture evaluation failed");
        if (mode === "final-missing-notice" && reads === 2) fixture.bodyComponent.childNodes.shift();
        return fn();
      },
      keyboard: { press: async () => {}, type: async (value: string) => { fixture.bodyComponent.append(paragraph(value)); } },
      waitForTimeout: async () => {},
    };
    const sandbox = {
      assertNaverEditorBody, editorBodyAuditDiagnostic, readNaverEditorBodySnapshot: fixture.read,
      readNaverEditorTypingFocus: typingFocus,
      getErrorMessage: (error: Error) => error.message,
      console: { log: () => {}, error: () => { events.push("diagnostic"); } },
      fs: { mkdirSync: () => {}, writeFileSync: (_file: string, value: string) => { diagnostics.push(value); } },
      path, process: { cwd: () => "fixture-only-no-files-written", pid: 123 }, createTimestampLabel: () => "fixture",
      createEditorialBodyStyleState: () => ({}), shouldApplyBodyStyle: () => false, markBodyStyleReady: () => {}, invalidateBodyStyle: () => {},
      setNaverTextFormat: async () => true,
      focusFreshNaverEditorBody: async () => { events.push("focus"); },
      assertCurrentEditorTypingFocus: async () => {},
      inputPlainParagraph: async (_page: unknown, value: string) => {
        events.push("write");
        if (value === notice && mode === "missing-notice") return;
        fixture.bodyComponent.append(paragraph(value));
        if (value === notice && mode === "duplicate-notice") fixture.bodyComponent.append(paragraph(value));
      },
      inputNaverHeading: async (_page: unknown, value: string) => { fixture.bodyComponent.append(paragraph(value)); return true; },
      insertNaverHorizontalDivider: async () => true,
      uploadOneImage: async () => { events.push("image"); return true; },
    };
    const write = vm.runInNewContext(`${code}; step5and6_uploadAndWrite`, sandbox) as (page: unknown, paths: string[], sections: string[], tags: string[], options: unknown) => Promise<void>;
    if (mode === "normal") {
      await write(page, [], [], [], { resolvedDocument: doc });
      assert(events.indexOf("read") < events.indexOf("image"), "the first body notice must be verified before the first upload");
      assert(events.indexOf("focus") < events.indexOf("write"), "the fresh body must be targeted before any text is typed");
      assert.equal(reads, 2, "the same reader must check both early disclosure and final rendered body");
      assert.equal(diagnostics.length, 0);
    } else {
      await assert.rejects(() => write(page, [], [], [], { resolvedDocument: doc }), mode === "reader-error" ? /SCOPE_MISSING/ : /DISCLOSURE_MISMATCH|CONTENT_MISSING/);
      assert.equal(diagnostics.length, 1); assert(diagnostics[0]!.length < 12_000);
      assert.equal(JSON.parse(diagnostics[0]!).phase, mode === "final-missing-notice" ? "final" : "disclosure");
      if (mode !== "final-missing-notice") assert(!events.includes("image"), "failed early disclosure must stop before any upload");
    }
  }
  for (const mode of ["normal", "missing-notice", "duplicate-notice", "reader-error", "final-missing-notice"] as const) await run(mode);
}
void verifyProductionEditorOrder().then(() => {
  console.log(`Published editor audit: 19 existing cases + ${domCases} production DOM reader cases + 5 production render ordering cases passed`);
}).catch(error => { console.error(error); process.exitCode = 1; });
