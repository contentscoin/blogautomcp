# 2026-09-21 발행 이미지 규격 및 예약 날짜 복구

## 실제 실패

작업 f5bac543-8f7b-42cd-b248-f41826acb66e의 두 항목을 확인했다.

- 달바 cdfdca53-cc31-455d-920a-a57e2895fa3e: 승인 소재 node21의 이미지가860x2818(3.277:1). 준비에서는 READY100점/5장으로 표시되지만 최종 publish-image-audit의3:1 제한에서 거절됐다.
- 닥터지9ec029d5-f5e6-4f7d-890d-b132680e3474: 실제 날짜 input_date__UwKAB와 코드의 구형 input_date__QmA0s selector 불일치. readonly 입력의 DOM 값 변경으로는 실제 달력 상태를 갱신할 수 없다.
- 두 발행 시도 모두 FAILED_BEFORE_SUBMIT이다. 최종 제출 결과가 불확실한 건을 자동 재발행하는 상황과 구분했다.
- 기존 선택 예약일은 달바2026-09-22, 닥터지2026-09-23이다.

## 완료 증거

검증 및 배포 결과는 실행 후 기록한다.

## 수정 및 검증

- 준비·승인·이미지 교체·원본 후보 선택에 실제 파일 기준3:1 규격 검사를 공유한다. 기존 저장 소재도 다시 판정한다. 최종 시각 검증은 유지한다.
- 긴 이미지가 있는 파트는 기존 자동 보강의 교체 대상으로 처리한다. 대체 파트 배치는 검증 원본이 확보된 경우에만 적용하며 필수 수량과 본문을 보존한다.
- 예약 날짜 selector의 CSS 해시 의존성을 제거하고 readonly 입력값 강제 변경을 금지한다. 달력의 인접 월·선택 불가 날짜를 제외한다.
- 최종 이미지 검증 오류는 STEP2.6으로 표시해 대표 썸네일 생성 오류로 오인하지 않도록 했다.
- geometry 경계/포맷/EXIF/불량 파일/승인 차단, section repair/review/replan, publish audit36, image batch42, material integrity, material recovery, scheduled workflow, datepicker 브라우저 fixture, 예약 응답 검증 통과.
- scripts 및 Next TypeScript 통과. 수정 범위 ESLint 오류0(기존 경고4).
- 달바 실제 sourceOnly 복구: 요청1/반영1/오류0/remaining0, 신규 생성0, 원고100점/이미지5장. 승인 해제 후 최종 검증 중.
- 추가 반증: 첫 규격 교체 뒤 실제 final audit가 node21 SEMANTIC_REJECTION을 발견했다. 후보의 산뜻보송 설명은 본문의 촉촉함 근거가 아니었다. 따라서 이 중간 상태를 완료로 간주하지 않았다.
- 배정 검사를 실제 render-node 제목/본문 전체와 연결하고 검토 캐시에 본문을 포함했다. 이미지 목적 메타데이터가 실제 기능 주장을 대신하지 못하도록 기준을 맞췄다. 미검토 overview 우회 배정도 제거했다.
- 첫 교체 결과는 별도 백업하고 정확한 revision CAS 확인 후 본 작업에서 생성한 교체만 되돌렸다. 승인 해제 상태로 강화된 검사를 다시 수행한다.
- 강화된 본문 검사 후 달바 교체 원본: 860x1573, SHA256 1eb7f87c5bfea981f76bbabe25d49573cb53cc2b7894ea06ff532ccc269d3a5e. sourceOnly 반영1, 유료 생성0.
- 실제 final publish-image-audit 결과 ok=true, checked=5, failures=[] 확인(2026-09-21 21:04 KST). 원고100점, 최종 이미지5장.
- 확정적인 SEMANTIC_REJECTION만 이미지SHA256+파트+실제본문지문에 묶어 publish-image-rejections.json에 최대64개 저장한다. 인증/통신/응답형식/검사 중 파일 변경은 기록하지 않는다.
- 다음 준비에서 해당 조합은 stale 교체 대상으로 판정하고 후보 재배정에서도 제외한다. 재수집·검증된 대체 배치는 기존 bounded loop를 따른다. 발행 중 원고를 자동 변경하거나 결과 불명 작업을 재발행하지 않는다.
- 거절기록의 시각 변경만으로 복구 횟수를 초기화하지 않으며 새로운 거절/실제근거 변화는 새 복구 입력으로 처리한다.
- 실제 제목·원고해시·sourceSnapshot·모든 발행 텍스트가 복구 전후 동일함을 비교 확인했다.
