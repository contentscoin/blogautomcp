# 모바일 템플릿 검증

## 실제 네이버 편집기 관찰

2026-09-05 저장된 로컬 네이버 세션으로 connectableai/postwrite에 접속했다. 로그인 리다이렉트가 없었으며 본문 입력·저장·발행 없이 서식 메뉴만 열어 확인했다. 진단용 브라우저만 종료했다.

| 기능 | 관찰된 버튼 | 관찰된 값 |
| --- | --- | --- |
| 글꼴 | data-name=font-family | nanumgothic |
| 크기 | data-name=font-size | fs13, fs16, fs19 (fs20 없음) |
| 정렬 | data-name=align-drop-down-with-justify | left |
| 줄간격 | data-name=line-height | 180 |
| 글자색 | data-name=font-color | 메뉴 안 button[data-color] |

관찰된 팔레트 중 선택: #00554c, #003960, #823f00, #004e82, #245b12, #4f0041, #333333, #555555.
색상 표시기는 글자색 버튼 안 [data-role=color]의 background-color다.

## 브라우저 시안

docs/mobile-template-preview.html을 로컬 HTTP로 제공하고 Playwright Chromium에서 360/390/430px × 6개 템플릿을 클릭했다. 18개 조합에서 documentElement.scrollWidth가 innerWidth를 초과하지 않았고 본문 16px를 확인했다. 390px 전체 화면 캡처도 직접 관찰했다.

이는 편집 시안 검증이며 네이버 저장·공개 발행 검증이 아니다. 사진 영역은 명시적인 자리표시자다.

## 변경 전 회귀 기준

- npm run test:writing-structure: PASS
- npm run test:post-composition: PASS (의도적인 미달 fixture 차단 유지)

## 실제 조작에서 발견한 차이

- 글자 크기 메뉴의 19px 선택은 aria-current=true로 확인할 수 있다. 정렬 메뉴도 동일하다. 툴바의 일반 안내 문구만 비교하면 적용 성공을 실패로 잘못 판정한다.
- 최근 사용 색상에 같은 색상 버튼이 추가되어 button[data-color]가 2개가 될 수 있다.
- 색상 클릭 직후 표시기를 읽으면 이전 색상이 남아 있다. 표시기 값이 바뀔 때까지 제한 시간 안에서 기다린 후 판정해야 한다.
- 첫 라이브 반복 시험은 비교형 본문 색상 복원에서 실패했다. 이 실패를 숨기지 않고 중복 선택과 비동기 갱신 수정 대상으로 기록했다.

## 구현 검증 결과

- `npm run typecheck`: PASS
- `npx ts-node --project tsconfig.scripts.json scripts/verify-editorial-templates.ts`: PASS. 여섯 선택, 수정 시 선택 유지, 섹션별 이미지 연결, 템플릿별 위치, 본문 내용 보존, 기존 QC 동일.
- `npx ts-node --project tsconfig.scripts.json scripts/verify-naver-editorial-style.ts`: PASS. 관찰된 옵션 적용, 적용 상태 확인, 실패 기록, 본문 복원.
- `npm run test:writing-harness`: PASS
- `npm run test:post-composition`: PASS
- `node scripts/verify-mobile-template-preview.cjs`: PASS. 18개 조합.
- `scripts/verify-editorial-live.ts`: 수정 후 여섯 템플릿 × 소제목/본문에서 글꼴·크기·정렬·줄간격·색상 확인 PASS. 세션 파일과 블로그 ID는 환경변수로 명시해야 실행한다.

배포와 설치 앱 업데이트는 수행하지 않았다. 실제 글 저장 후 서식 유지와 캡션 전용 컴포넌트는 미검증/미지원으로 남기고 적용 성공 목록에 포함하지 않는다. 기존 승인 문서는 배치를 자동 변경하지 않으며 새 생성 문서부터 선택한 편집 정책을 사용한다.
