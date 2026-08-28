import assert from "node:assert/strict";
import {
  getConnectEditorInsertionMode,
} from "./lib/connect-editor-insertion";

assert.equal(
  getConnectEditorInsertionMode("SHOPPING"),
  "SHOPPING_CONNECT",
  "쇼핑 상품은 쇼핑커넥트 컴포넌트를 사용해야 합니다."
);
assert.equal(
  getConnectEditorInsertionMode("TRAVEL"),
  "EXTERNAL_LINK",
  "여행 상품은 쇼핑 검색이 아닌 외부 링크 컴포넌트를 사용해야 합니다."
);

console.log("✅ 커넥트 유형별 에디터 삽입 경로 검증 완료");
