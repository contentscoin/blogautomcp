export type EditorConnectKind = "SHOPPING" | "TRAVEL";

export type ConnectEditorInsertionMode = "SHOPPING_CONNECT" | "EXTERNAL_LINK";

/**
 * 네이버 블로그 에디터의 쇼핑커넥트 도구는 스마트스토어 상품 전용이다.
 * 여행커넥트에서 발급한 링크는 쇼핑 상품 검색으로 찾지 않고 일반 링크
 * 컴포넌트로 삽입해야 한다.
 */
export function getConnectEditorInsertionMode(
  kind: EditorConnectKind
): ConnectEditorInsertionMode {
  return kind === "TRAVEL" ? "EXTERNAL_LINK" : "SHOPPING_CONNECT";
}
