import assert from "node:assert/strict";
import { assertPublishedEditorText, publishedReadinessSections } from "./lib/published-editor-audit";
import type { ResolvedPostDocumentV1 } from "../src/lib/post-composition-contract";
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
console.log("Published editor audit: 6 cases passed (actual body + final disclosure handoff)");
