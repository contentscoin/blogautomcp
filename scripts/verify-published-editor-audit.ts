import assert from "node:assert/strict";
import { assertPublishedEditorText, publishedReadinessSections } from "./lib/published-editor-audit";
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
console.log("Published editor audit: 19 cases passed (actual body, canonical top disclosure, adjacent scene caption)");
