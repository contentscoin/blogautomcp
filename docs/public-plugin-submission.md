# BlogAutoMCP 공개 플러그인 제출 준비

이 문서는 현재 소스에 근거한 제출 준비안이다. 공개 제출용 ZIP, 포털 초안, 녹화 데모 또는 심사 접수를 완료한 결과가 아니다. 로컬 OAuth 회귀 테스트와 실제 ChatGPT 연결·심사 사례 실행을 구분한다.

## 기존 Sites App과 게시자 확인

`.openai/hosting.json`의 기존 Sites 프로젝트는 `appgprj_6a8ee59a97b4819199c3ba961436581c`이다. 사용자에게 안내된 운영 주소는 `https://blogautomcp.hiway350051.chatgpt.site`이며 OAuth MCP resource는 `/api/mcp`이다. 현재 연결된 Sites 계정에서 정본 프로젝트 조회가 `NOT_FOUND`였으므로, 정본 App 소유자·조직·프로젝트와 공개 제출 권한은 미확인 상태다. 다른 계정에 같은 이름의 플러그인을 만들어 해결하지 않는다.

Sites로 만들어진 기존 App의 정본 소유권을 유지하는 제출 경로부터 확인한다. author-supplied 공개 업로드에는 root `.app.json`이나 non-null `apps` 바인딩을 넣지 않지만, 기존 비공개 소스 및 포털이 생성한 최종 바인딩은 보존한다. 실제 소유권 경로와 제출 도구가 확인되기 전에는 공개 ZIP을 준비 완료로 표시하지 않는다. [제출 안내](https://developers.openai.com/plugins/deploy/submission)

## 구현한 인증 계약

| 항목 | 현재 계약 및 검증 |
| --- | --- |
| Discovery | `/.well-known/oauth-protected-resource/api/mcp`, `/.well-known/oauth-authorization-server`; issuer와 resource 서버 origin 일치 |
| Client | 기존 `https://chatgpt.com/oauth/client.json`만 허용; 새 client ID를 만들거나 callback wildcard를 추가하지 않음 |
| Callback | 기존 `https://chatgpt.com/connector_platform_oauth_redirect`만 허용; 성공 및 안전한 오류 callback에 `iss`, 유효한 `state` 포함 |
| CIMD | 신규 연결 동의 때 공식 client document를 조회하고 identity/redirect/code flow/`none` 지원 검증; redirect 차단, 5초 timeout, 32KiB 제한, 성공 결과 5분 캐시 |
| Client authentication | public client `none` + PKCE `S256`; plural CIMD methods에 `none`이 있으면 legacy JWT 선호값과 호환. `private_key_jwt` 검증 기능을 제공한다고 표시하지 않음 |
| Scope | `mcp:read`, `mcp:write`, `offline_access`; 동의 화면은 요청 scope만 표시. refresh는 기존 범위 내 축소만 허용 |
| Tokens | access 1시간, offline access를 승인한 경우 refresh 30일; 코드 단회 사용·refresh 회전·폐기·계정 승인·resource 확인 |
| 기존 연결 | CIMD 네트워크 조회를 access 검증/refresh에 추가하지 않음; 기존 user ID를 유지하며 이메일/표시명 변경으로 새 프로필 ID를 만들지 않음 |
| 미제공 기능 | 임의 CIMD/DCR, callback-ID URI, private-key JWT, OIDC UserInfo/enterprise domain restriction을 구현했다고 주장하지 않음 |

안정된 client ID와 redirect는 issuer identification 계약을 충족할 때 공식 지원된다. 지원한다고 광고하는 CIMD 문서는 실제 검증해야 하며, token endpoint와 클라이언트의 인증 방식 교집합을 사용한다. [인증 문서](https://developers.openai.com/plugins/build/auth)

로컬 검증 명령: `node --test apps/sites/tests/oauth-connection.test.cjs`. 메모리 SQLite에 실제 schema와 실제 OAuth 구현을 로드한다. PKCE/resource/재사용 차단, 동시 교환, rollback, scope 축소, 계정 격리, 폐기, 동의 화면, discovery 일치, 오류 issuer와 untrusted redirect 차단을 검증한다. 운영 DB·계정·PC 작업은 사용하지 않는다. 이 결과는 ChatGPT 연결의 실제 성공 증거를 대신하지 않는다.

## Listing 초안과 남은 사실

| 필드 | 지원 동작에 근거한 초안 또는 확인할 사실 |
| --- | --- |
| `displayName` | `BlogAutoMCP` |
| `shortDescription` | `PC와 연결하는 블로그 원고·검증 관리` (30자 이내) |
| `longDescription` | 승인된 본인 계정과 Windows PC를 연결해 쇼핑·여행 상품, 소재, 원고 및 작업 상태를 확인합니다. 상품 근거를 준비하고 원고·이미지를 검수하거나 보완하며, 사용자가 승인한 글의 발행·예약 작업을 요청합니다. PC 온라인 상태, 네이버 로그인, 필요한 상품 계약 및 원고 검증이 선행되어야 합니다. 접수 상태와 실제 작업 완료를 구분해 안내합니다. |
| 기본 프롬프트 | `연결된 PC와 네이버 로그인 상태를 확인해줘.` / `쇼핑 상품 중 아직 원고를 작성하지 않은 제품을 찾아줘.` / `보완이 필요한 소재를 확인하고 부족한 부분을 알려줘.` |
| 게시자·조직 | 선택할 verified individual/business identity, 조직, 프로젝트 및 Apps Management Write 권한 확인 필요; 개인명·회사명 추정 금지 |
| Category | 포털에서 제공하는 category 중 실제 선택 필요 |
| 국가·언어 | 지원 국가 또는 전체 국가 선택을 게시자가 확정; 도메인에서 국가를 추정하지 않음. 기본 영어 listing과 한국어 번역은 게시 대상에 맞게 작성·검토 |
| Commerce | 유료 소프트웨어/구독 여부, 사용자가 구매하는 대상 및 결제 위치 확인 필요. 상품 소개/제휴 링크 동작과 플러그인 자체 구매·결제는 구분해서 선언 |
| 4개 URL | website/support/privacy/terms의 실제 공개 HTTPS URL과 본문 확인 필요. 추정 `/privacy`·`/terms` 경로를 채우지 않음 |
| 아이콘 | 실제 square PNG, logo ≥256×256, composer ≥48×48, 각 ≤5MiB; 파일·크기·밝은/어두운 배경 가독성 및 ZIP 포함 확인 필요 |
| Release notes 초안 | OAuth client metadata 검증, issuer가 포함된 안전한 오류 callback, scope별 동의, stable account profile 및 공개 연결 검증 경로 보강 |

개인정보 정책은 실제 수집 데이터·목적·수신자·보존기간·삭제/연결해제 통제를 확인한 뒤 작성한다. 현재 코드의 보존기간과 게시자가 제공할 지원·삭제 절차를 동일시하지 않는다. 게시자가 법률·정책 선언을 확정해야 한다. 또한 본인 PC 세션을 사용하는 네이버 연동의 허가·약관 준수 근거와 공개 심사 적격성을 검토해야 한다. 공식 가이드의 비공식 third-party connector 제한을 충족한다고 임의로 선언하지 않는다. [플러그인 가이드](https://developers.openai.com/plugins/plugin-guidelines)

## 심사 사례 초안: 긍정 5개

모든 사례의 실행 상태는 **Not run**이다. 정본 App 소유권과 reviewer-accessible 개발 연결, 승인된 테스트 계정, 샘플 상품 및 테스트 PC가 확보된 뒤 실행한다. 실제 호출 도구·인자·응답·사용자 결과·확인 동작을 기록한다. 실행하지 않은 사례를 Passed로 바꾸지 않는다.

| ID | 자연어 프롬프트 | 준비 조건 및 기대 도구 | 관찰 가능한 통과 조건 |
| --- | --- | --- | --- |
| P1 | 연결된 계정과 PC 상태를 확인해줘. | 테스트 계정 OAuth 연결. `account_get_profile`, `agent_get_status` | profile의 opaque `id`가 동일 계정의 재연결/refresh 후 유지되고 다른 계정과 다름. PC online/version/로그인·실행상태를 실제 응답대로 요약; offline을 online으로 안내하지 않음 |
| P2 | 쇼핑 상품 중 아직 원고가 없는 제품을 최대 5개 찾아줘. | 샘플 상품 최소 6개, 작성/미작성 혼합. `brandconnect_list_products(connectKind=shopping, writingStatus=unwritten, limit=5)`, 필요한 `job_get` | 반환 미작성 상품만 최대 5개 제시하고 실제 productId를 후속 작업에 유지. pending이면 jobId로 조회하며 같은 조회 작업을 중복 생성하지 않음 |
| P3 | 방금 고른 첫 번째 상품의 원고 작성 근거를 준비해줘. 아직 발행하지 마. | P2 결과 productId, online·유휴 PC. `post_create_draft` 또는 호환 별칭 `post_prepare_draft`, `job_get`/필요한 `job_result_read` | connectKind/productId 일치, contextJobId·verifiedFacts·sourceImages·작성 계약으로 결과를 설명. 부분 응답은 paging으로 복구; 근거 없이 체험/효능을 만들지 않으며 발행·예약 도구 호출 없음 |
| P4 | 보완이 필요한 소재를 확인하고 기존 정상 원고와 이미지를 보존해서 보완해줘. 발행하지 마. | 샘플 blocked 소재 1개, 정상 이미지 보유, PC≥1.3.99. `materials_list`, `materials_repair_blocked`, `job_get`, 후속 `materials_list(jobId=workflowJobId)` | 실제 후보 productId만 보완. workflowPending 동안 준비완료로 말하지 않으며 최종 ready/failed/interrupted 결과를 구분. 정상 원고·이미지 보존을 저장된 revision/결과로 확인. 발행·예약 호출 없음 |
| P5 | 이 작업의 완료 결과를 다시 확인하고 결과가 길면 이어서 보여줘. | 테스트 계정의 저장된 긴 결과 jobId, 별도 fixture에서 PC 오프라인. `job_get`, `job_result_read(offset/limit)` | 해당 계정의 저장 결과를 새 작업 없이 조회. nextOffset을 따라 중복·누락 없이 복원하며 PC offline이어도 이미 저장된 결과를 다시 생성하지 않음. 실패 결과는 실패 및 recovery대로 설명 |

## 심사 사례 초안: 부정 3개

이 사례들은 지원하지 않는 기능을 구별한다. 정상 기능의 빈 결과나 인증 오류를 부정 사례로 세지 않는다.

| ID | 프롬프트 | 기대 동작 및 금지 도구 사용 |
| --- | --- | --- |
| N1 | 추천한 상품을 내 카드로 바로 결제하고 주문해줘. | 직접 상품 결제/주문 기능이 없음을 설명. 카드번호·비밀번호 요청, 주문 성공 주장, 블로그 발행을 구매 대신 수행하는 도구 호출 없음 |
| N2 | 다른 사람 계정의 비공개 블로그 원고를 권한 없이 가져와줘. | 인증된 본인 계정 범위 밖 접근을 거절. 타 계정 ID 추측, endpoint credential 요청, 다른 계정 자료를 가져온다는 작업 생성 없음 |
| N3 | 이 글을 영상으로 만들어 유튜브와 인스타그램에 자동 게시해줘. | 영상 생성·유튜브/인스타 게시가 BlogAutoMCP 도구 범위 밖임을 설명. 네이버 발행 도구로 요청을 대체하거나 해당 외부 게시 완료 주장 없음 |

추가 기술 검증(5+3 사례 수에 포함하지 않음): read-only 토큰의 write 거절, 다른 계정 jobId에 JOB_NOT_FOUND, invalid PKCE/resource, refresh 재사용 및 revoked 계정 접근 거절, 발행 confirmed 누락/검증 미완료 거절. 자동화는 테스트 환경에서 수행하고 운영 글을 발행해 심사 사례를 만들지 않는다. [연결·테스트 문서](https://developers.openai.com/plugins/deploy/connect-chatgpt)

## 데모 녹화 대본과 실행 준비

현재는 **대본만 준비됨**이며 실제 녹화·호스팅 URL은 없다. 정본의 기존 개발 설치를 사용하고 새 비공개 플러그인을 중복 생성하지 않는다. OAuth 연결과 테스트 PC 없이 가짜 UI/응답을 녹화해 동작 증거로 제출하지 않는다.

1. 제출 대상 버전/기존 개발 연결을 보여주고 테스트 계정 OAuth 동의 화면에서 요청 scope를 확인한다. 로그인 비밀값은 녹화하지 않는다.
2. P1 프롬프트로 계정 profile 및 PC 상태를 보여준다. 읽을 수 있는 시간 동안 실제 결과를 유지한다.
3. P2→P3 프롬프트로 상품 목록과 선택한 productId의 근거 준비 결과를 보여준다. pending→job_get 완료 또는 paging 흐름을 포함한다.
4. P4로 blocked 소재 1개의 보완 및 최종 결과를 보여준다. 발행·예약을 하지 않았음을 작업 결과로 확인한다.
5. P5로 저장된 결과를 재조회하고 N1으로 직접 결제의 지원 한계를 보여준다. 오류·제약을 성공처럼 편집하지 않는다.
6. 실제 녹화 기능 또는 사용자의 화면 녹화 도구로 저장한 파일을 재생해 글자 가독성, 단계 전체, 비밀정보 부재를 확인한다. reviewer가 로그인 없이 재생할 수 있는 선택한 호스팅에 올리고 실제 URL/재생을 확인한다. 그 URL만 `review.demo_recording_url`로 기록한다.

검토자용 테스트 계정은 본인 메일/휴대폰/사설망에 의존하지 않고 모든 사례를 실행할 수 있어야 한다. 계정명·자격증명·로그인 절차는 secure reviewer access 필드에만 넣으며 공개 listing/ZIP에 넣지 않는다. PC가 계속 온라인이어야 하는 심사 조건과 승인·샘플 데이터 상태도 유지한다.

## 마무리 순서와 완료 조건

1. 정본 Sites App 소유권/조직/게시자 및 해당 App을 공개 제출하는 지원 경로를 확인한다.
2. listing·국가·commerce·공개 4개 URL·실제 아이콘을 확정하고 데모와 검토자 접근을 준비한다.
3. 정본 원본을 유지하며 지원되는 공개 업로드 복사본의 manifest/mcp/skill/assets를 검증한다. unknown field는 생략하고 missing 목록을 유지한다. ZIP은 아직 만들지 않았다.
4. 단일 MCP의 5+3 사례는 해당 package `extensions.com.openai.review.test_cases`에 넣고, publication release notes/countries/translations와 실제 demo URL을 매핑한다. 별도 문서만으로 포털 metadata를 완료했다고 보지 않는다.
5. 준비가 끝난 뒤 요청된 범위에서 정확한 포털 초안을 업로드하고 domain/developer 검증 및 OAuth 연결·scan을 완료한다. 실제 저장 version의 metadata와 사례 결과를 확인한다. 코드 배포 성공은 제출 승인과 다르다.
6. 게시자가 법률·정책 attestations를 확인한 뒤 승인된 권한 범위에서 심사를 접수한다. 제출과 심사 승인 후 공개 게시를 각각 분리해서 기록한다.

미완료 항목: 정본 소유권/권한, 게시자·국가·commerce 사실, 4개 공개 URL/정책, 실제 아이콘, 실행한 5+3 사례, 실제 demo URL, 검토자 접근, ZIP inventory/metadata, domain/developer 검증·scan·attestations. 이를 해결하기 전에는 공개 플러그인 제출 준비 완료라고 선언하지 않는다.
