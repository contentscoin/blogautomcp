# v1.3.95 — 네이버 예약 발행 결과 교차 검증

- 네이버 `RabbitWrite` 응답이 화면 이동 중 폐기되어도 예약 성공을 실패로 오판하지 않습니다.
- 같은 제출에서 예약 모드·목표 날짜가 포함된 2xx 응답을 확인한 경우에만 예약 목록 보조 검증을 시작합니다.
- 예약 목록의 제목·날짜·시간이 정확히 한 건 일치하고 숫자형 `logNo`를 확인해야 예약 성공으로 확정합니다.
- 같은 제목과 날짜의 항목이 중복되거나 목록·식별자를 확인하지 못하면 기존처럼 결과 미확인 상태를 유지해 중복 발행을 차단합니다.
- 초안 승인 라우트 검증 하네스가 현재 이미지 감사 의존성을 포함하도록 갱신했습니다.

## 검증

- `npm run test:naver-schedule-submission`
- `npx ts-node --project tsconfig.scripts.json scripts/verify-publish-safety.ts`
- `node scripts/verify-publish-route.cjs`
- `npm run typecheck`
- `npm run build`
- 로그인된 네이버 예약 목록에서 실제 제목·예약 일시·예약 식별자 교차 검증
