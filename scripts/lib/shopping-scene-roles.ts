/** Generation roles shared by prewriting and the photographic brief.
 * These describe camera coverage, never product facts or proof of performance. */
export const SHOPPING_NATURAL_SCENE_ROLES = [
  { role: "scene-1", purpose: "생활 공간에서 전체 외형과 놓이는 위치", coverage: "establishing view: show the entire selected subject at rest and its physically appropriate support in a believable everyday setting" },
  { role: "scene-2", purpose: "별도 구도에서 선택 옵션의 식별 외형", coverage: "identifying view: a distinct normal-perspective view of the same complete selected subject, with its identifying surface readable and unobstructed" },
  { role: "scene-3", purpose: "다른 거리에서 주변 공간과 배치 관계", coverage: "context view: move the camera or support position to show genuine surrounding space while preserving the same complete selected subject and option" },
] as const;

export function shoppingNaturalSceneRoleAt(index: number) {
  const normalized = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return SHOPPING_NATURAL_SCENE_ROLES[normalized % SHOPPING_NATURAL_SCENE_ROLES.length];
}
