# MCP 오류 접수와 Telegram 설정

`bug_report_create`는 사용자 동의(`confirmed=true`)를 받아 중앙 D1에 접수한 뒤 관리자 Telegram으로 알립니다. `bug_report_get(reportId)`는 본인의 접수 상태만 조회합니다. 데스크탑이 꺼져 있어도 동작합니다.

예: `{ "summary": "시즌 자동등록 실패", "details": "종료 코드 1. 오류 부분만 첨부", "idempotencyKey": "support-20260905-001", "confirmed": true }`

- 선택적인 `jobId`는 인증 계정의 작업만 첨부합니다. 다른 계정 작업은 거부합니다.
- PC 파일, 환경변수, 원고 본문, 쿠키 저장소는 자동 수집하지 않습니다. 필요한 로그 부분만 사용자가 전달해야 합니다.
- 알려진 토큰·인증 헤더·URL·이메일·전화번호·Windows 사용자 경로를 마스킹합니다. 임의의 모든 개인정보를 검출할 수는 없으므로 민감정보를 처음부터 넣지 마세요.
- 시간당 5개 제한. 같은 신고를 재시도할 때 동일한 idempotencyKey를 사용하면 재전송하지 않습니다.
- `SENT`만 Telegram 전달 성공입니다. `NOT_CONFIGURED`, `FAILED`, `PENDING`이어도 D1 리포트는 유지됩니다. 현재 자동 재전송은 없습니다.
- 텔레그램에는 최대 3900자 요약을 전달합니다. 나머지 오류 내용은 중앙 D1 `bug_reports`에 저장됩니다. 관리자 Sites DB 조회로 계정별 확인이 가능합니다.

## 관리자 봇 연결

1. Telegram 공식 BotFather에서 봇을 생성하거나 관리자가 지정한 기존 봇을 사용합니다.
2. 수신자가 봇을 시작하거나, 지정한 관리자 그룹에 봇을 추가합니다.
3. 서버 비밀 설정에 `BUG_REPORT_TELEGRAM_BOT_TOKEN`, `BUG_REPORT_TELEGRAM_CHAT_ID`를 저장합니다. 고객 PC나 Git에는 저장하지 않습니다.
4. chat ID는 관리자가 지정한 대상과 일치하는지 확인합니다. getUpdates의 첫 채팅을 자동 채택하지 않습니다.
5. 배포 후 개인정보 없는 테스트 리포트로 실제 수신을 확인합니다. 일반 완료 알림용 TELEGRAM_* 설정과 분리합니다.

공식 API: https://core.telegram.org/bots/api#sendmessage

새 `0002` 마이그레이션은 bug_reports만 생성합니다. snapshot에 함께 반영된 기존 pair_codes/rate_limits 및 작업 상태 열은 이전 런타임 초기화에서 이미 생성된 항목이라 중복 적용하지 않습니다.
