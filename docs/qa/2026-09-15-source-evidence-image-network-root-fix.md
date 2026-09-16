# 상품 근거·이미지·MCP 원고 준비 근본 수정 검수

- 검수일: 2026-09-15 KST
- 데스크톱 버전: 1.3.51
- 업데이트 채널: `https://blogautomcp.hiway350051.chatgpt.site/api/updates/windows/`
- 대상: 쇼핑커넥트 소재 준비, Codex 원고 경로, ChatGPT 이미지 자동화, MCP 작업 전달

## 사용자 증상과 판정

### 1. 2026-09-14의 `SOURCE_EVIDENCE_REQUIRED`

곱창, LA갈비, 로보락, 갈비살 상품은 저장된 상품 이미지와 상세 분할 이미지가 있었지만, `simple-agent.ts`가 이미지 수집과 OCR보다 먼저 텍스트 근거를 판정했다. 따라서 상세 이미지가 가진 기능·규격을 읽을 기회 없이 STEP1에서 종료됐다. 상품명도 근거 판정 함수에 빈 문자열로 전달되어 음식과 가전 카테고리 판정이 약해졌다. 동일한 결정적 오류를 최대 세 번 반복해 시간도 낭비했다.

### 2. 2026-09-08의 Codex·브라우저 오류

`gpt-6-astra` 버전 오류와 `ERR_CERT_COMMON_NAME_INVALID` 기록은 1.3.39 시점의 과거 실패 로그다. 현재 고정 원고 모델은 `gpt-5.5`이고 Codex는 ChatGPT 계정으로 인증되어 있다. 새 경로는 Codex 인증·모델·버전 오류를 브라우저 자동화로 우회하지 않으며, 429·5xx·연결 재설정만 동일 Codex 경로에서 한 번 재시도한다.

### 3. 이미지 생성 실패와 불필요한 재생성

브라우저의 인증서·DNS·연결 거부·이동 시간 초과가 개별 슬롯 오류로 취급되어 여러 이미지 슬롯이 같은 장애를 반복할 수 있었다. 이제 세션 단위 연결 장애는 남은 슬롯을 즉시 중단한다. 원고 일부를 보강할 때는 기존 이미지 매니페스트와 해시를 유지하고, 이미지 의도가 실제로 달라진 슬롯만 무효화한다.

## 구현 내용

- 텍스트 근거 판정을 이미지 수집·저장 소재 복원·상세 이미지 OCR 뒤로 이동했다.
- 판매자 상세 분할 이미지만 OCR하며 생성 이미지, 리뷰 이미지, 공지 이미지는 근거로 쓰지 않는다.
- Windows 설치본에 Tesseract 5.5와 한국어·영어 언어팩을 포함했다.
- OCR은 상품당 최대 4개 분할, 개별 8초, 전체 35초로 제한하고 SHA-256 기준 64개 프로세스 캐시를 둔다.
- 상품명에서 명시된 기능·중량·용량만 보수적으로 추출하고 광고 문구, 비교, 부정, 미지원, 유사, 옵션 표현은 제외한다.
- DOM·JSON-LD·OCR의 단위와 기능 별칭을 한 경로로 정규화한다. `자동세척 미지원`, `무선 아님`, `자동세척: X` 같은 표현은 근거로 인정하지 않는다.
- `SOURCE_EVIDENCE_REQUIRED`는 재시도해도 바뀌지 않는 오류로 분류해 즉시 종료한다.
- Codex 오류 객체를 중첩 구조까지 순회해 실제 HTTP 상태를 분류한다. 인증·모델/버전·로컬 시간 초과는 재시도하지 않는다.
- 기본/MCP 원고 생성에서 Codex 실패 후 브라우저 GPT로 자동 전환하는 경로를 차단했다.
- ChatGPT 이미지 페이지 이동과 복구 이동을 공통 네트워크 판정 함수로 통일했다.

## 자동 검증

다음 검사가 통과했다.

- `npm run typecheck`
- `scripts/verify-product-source-evidence.ts`
- 실제 로보락 상세 분할 이미지 2개를 번들 Tesseract로 OCR: `자동세척`, `건조기능` 추출 및 `usable` 판정
- `verify-material-approval-semantics.ts`
- `verify-quality-convergence.ts`
- `test:product-substance`
- `test:brand-post-quality`
- `test:brand-post-package`
- `test:quality-repair`
- `test:codex-draft-provider`
- `test:writing-timeouts`
- `test:image-timeouts`
- `test:image-resume`
- `test:image-batch-progress` 27개 검사
- `test:chatgpt-browser-automation`
- `test:generated-image-selectors`
- 변경 파일 대상 ESLint와 `git diff --check`

네트워크 장애 고정값 검사에서는 인증서 오류가 발생하면 10개 슬롯 모두에서 이미지 프롬프트 전송 횟수가 0회였다. 텍스트 보강 검사에서는 보존 대상 이미지의 파일 해시와 슬롯 연결이 유지됐다.

## 패키징·배포 검증

- 설치파일: `out/BrandConnect-Automation-Setup-1.3.51.exe`
- 크기: 336,954,461 bytes
- SHA-256: `df28be0c79f864dbf8f5c86cf226a13d31bc7c75ad1ef1d3761df8e7ab164dc0`
- 업데이트 게시 시각: 2026-09-15 00:44:12 KST
- 원격 업데이트 릴리스: 1.3.51
- 자동업데이트 후 설치 경로 버전: 1.3.51
- 설치 앱 상태: `ready=true`, 실행 작업 0, 업데이트 오류 없음
- 설치된 OCR: Tesseract 5.5, `kor`·`eng` 언어팩 로드 성공
- Codex: 설치됨, ChatGPT 인증됨, 고정 모델 `gpt-5.5`

## 설치본 실데이터 검수

MCP `settings_get`을 실제로 실행해 Sites 작업큐, 데스크톱 폴러, 로컬 API, 결과 저장·반환 전 구간을 통과했다.

현재 원고 엔진 코드로 Codex `gpt-5.5` 실연결도 실행했다. 이미지 없는 확인 요청이 12.5초 만에 정상 JSON을 반환했으며 모델 버전 오류나 브라우저 우회는 발생하지 않았다.

이전 STEP1 실패 상품 4건에 `post_create_draft`를 실행했다. 1.3.51 설치본은 모두 `SOURCE_EVIDENCE_REQUIRED` 없이 완료했다.

- 로보락 F25 RT: 제품 기능 6개, 원본 이미지 20개, 상세 분할 8개, 검증 사실 11개
- 소곱창 160g: 식품유형·중량·초벌 구성, 원본 이미지 20개, 상세 분할 8개, 검증 사실 8개
- 양념 LA갈비 1kg: 식품유형·중량·양념 구성, 원본 이미지 20개, 검증 사실 8개
- 갈비살 1kg: 식품유형·중량, 원본 이미지 20개, 상세 분할 8개, 검증 사실 7개

네 작업 모두 경고가 없었고 MCP 결과 전체 페이지를 끝까지 읽어 JSON 무결성을 확인했다.

이 검수는 원고 제출, 이미지 생성, 승인, 발행을 실행하지 않았다. 기존 실패 작업 기록은 감사 이력으로 남으며 새 버전에서 재시도할 때 새 결과가 추가된다.

## 남은 운영 단계

1. 실패 상품은 1.3.51에서 새 소재 준비 작업으로 재시도한다.
2. 원고 준비가 끝난 뒤에만 필요한 이미지 슬롯을 생성·적용한다.
3. 품질검사와 승인을 통과한 revision만 `materials_publish`로 예약 또는 즉시 발행한다.

이미지 생성은 외부 생성 비용과 시간이 발생할 수 있으므로 이번 배포 검수에서는 실행하지 않았다.
