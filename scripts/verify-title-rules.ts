/**
 * 낚시성 제목 필터 검증 — 네이버가 스팸으로 명시한 어그로 제목 문구를
 * 생성 후 하드 필터로 걸러내는지 확인한다.
 *
 *   npm run test:title-rules
 */

import { stripClickbaitFromTitle } from "../scripts/lib/blog-writing-style";
let failures = 0;
function check(label: string, actual: string, expected: string) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: "${actual}"${ok ? "" : ` (기대: "${expected}")`}`);
  if (!ok) failures += 1;
}
check("완벽 가이드 제거", stripClickbaitFromTitle("무쇠 냄비 완벽 가이드 | 프리미엄 주물냄비 후기"), "무쇠 냄비 | 프리미엄 주물냄비 후기");
check("총정리 제거", stripClickbaitFromTitle("제주 여행 코스 총정리 - 3박4일 일정"), "제주 여행 코스 - 3박4일 일정");
check("꿀팁 Zip 제거", stripClickbaitFromTitle("캠핑 준비물 꿀팁 Zip 필수 체크"), "캠핑 준비물 필수 체크");
check("역대급 제거", stripClickbaitFromTitle("역대급 할인 무선청소기 비교"), "할인 무선청소기 비교");
check("일반 제목 유지", stripClickbaitFromTitle("아기비데 추천 | 해피달링 시그니처 워터탭 솔직 후기"), "아기비데 추천 | 해피달링 시그니처 워터탭 솔직 후기");
check("꿀팁 단독은 유지", stripClickbaitFromTitle("겨울 등산 꿀팁과 준비물 정리"), "겨울 등산 꿀팁과 준비물 정리");
check("전부 지워지면 원본 유지", stripClickbaitFromTitle("총정리"), "총정리");
if (failures) { console.error(`${failures}개 실패`); process.exit(1); }
console.log("모든 검증 통과");
