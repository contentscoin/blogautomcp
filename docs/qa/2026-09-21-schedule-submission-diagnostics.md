# 2026-09-21 예약 제출 판정 및 이미지 복구 진단

## 비교 결과

- 1.3.73과 1.3.74의 예약 날짜 선택·제출 코드는 동일하다. 1.3.74의 추가 변경은 소재 이미지 감사와 저장 원고 일관성 영역이다.
- 즉시 발행 성공 기록은 확인됐지만 실제 네이버 예약 성공 기록은 확인되지 않았다. 기존 예약 검증 fixture는 달력 선택만 검사하고 최종 네트워크 payload는 검사하지 않았다.
- 일렉트로룩스 `4fbafb36-2334-4bb6-ac74-657283e2b9fe`의 실제 로그에서는 날짜 UI가 `2026-09-23 09:00`으로 검증됐지만 `rabbit` 제출이 `schedule=true,targetDate=false`였다. 뒤의 `write` 응답은 HTTP 200 빈 JSON이었고 예약 ID·승인 플래그가 없었다.
- 응답 본문 조회 실패는 `unavailable`로만 기록돼 원인을 알 수 없었다. 이 결과를 성공으로 완화하면 중복 예약을 만들 수 있으므로 작업은 `OUTCOME_UNKNOWN`으로 중지하는 것이 맞다.

## 수정

- `inspectNaverScheduleSubmissionSignal`이 URL query와 중첩 URL 인코딩 payload를 함께 검사한다.
- 날짜 판정은 0으로 채운 날짜, 점·슬래시 구분자, 한국어 날짜, 예약 시각 epoch(초·밀리초)를 지원한다.
- Playwright 응답은 `text()` 실패 시 제한된 `body()` fallback을 시도한다. 두 방식이 실패하면 URL·본문을 남기지 않고 정제한 오류 메시지를 진단 로그에 보존한다.
- 예약 실패 진단은 마지막 3개 이벤트만 남기지 않고 마지막 8개를 보존해 실제 `rabbit` 요청과 뒤따른 자동 저장 `write`를 구분한다.
- HTTP 200, `pending`, 빈 JSON, 예약 ID 없음은 계속 미확정으로 처리한다.

## 소재별 확인

- 샤크 `1de72744-8a38-45f6-aa68-3c7aec77182d`는 거절된 일반 구성 사진을 판매자 사용 장면 원본으로 source-only 교체했고 실제 최종 이미지 감사 5/5를 통과했다.
- 교체로 승인 시각이 무효화된 뒤 원고 재검증을 실행했으며, 저장 출처의 고유 기능·구성·규격 텍스트가 부족해 `SOURCE_EVIDENCE_REQUIRED`로 중지됐다. 근거 없는 원고 승인이나 강제 발행은 하지 않았다.
- 이미지 자동 복구는 동일 소재의 승인·원고 품질 게이트를 우회하지 않으며, 검증 가능한 대체 원본이 없으면 중지한다.

## 검증

- `scripts/verify-naver-schedule-submission.ts`: query·한국어·epoch 날짜, 지연 응답, body fallback 오류 정제, bounded wait fixture 통과.
- 설치 앱의 샤크 최종 이미지 감사: `checked=5`, 오류 없음.
- 네이버 계정에 대한 재예약은 실행하지 않았다. 이전 제출 결과가 확인되지 않은 소재는 중복 발행 방지를 위해 재전송하지 않는다.

## 1.3.76 추가 수정

- SmartEditor ONE의 실제 예약 payload인 `populationMeta.prePostYear/Month/Date` 분리 필드와 `postWriteTimeType=pre`를 예약 신호 검사에 포함했다.
- 응답 이벤트에서 본문 읽기를 지연시키던 microtask를 제거해 `RabbitWrite.naver` 직후 네비게이션으로 응답 body가 사라지는 경쟁 조건을 줄였다.
