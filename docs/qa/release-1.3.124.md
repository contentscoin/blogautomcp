# Sites 51 · Windows 1.3.124 배포 검증

2026-10-13 KST. 원본 후보 누락 재검토, 정상 사진을 보존하는 문장 복구, 승인 충돌의 제한된 재시도, 제목·소제목·템플릿 보강을 배포했다. 구현 점검은 [소재 품질 보고서](material-quality-20261013.md)에 기록돼 있다.

## 배포 소스와 CI

- 릴리스 소스: `e50a5dff97d13fe0d6f8b0de63bdb9c70fc2ebd9`, 버전 `1.3.124`.
- [릴리스 CI](https://github.com/contentscoin/blogautomcp/actions/runs/38320843111)의 PC·Sites TypeScript, Lint, 회귀 검사와 production build가 통과했다.
- 기존 승인 정책 지문을 구성하는 소스 15개는 이번 보강에서 변경하지 않았다.

## Sites

- 사이트: <https://blogautomcp.hiway350051.chatgpt.site>
- 기존 프로젝트 `appgprj_6a8ee59a97b4819199c3ba961436581c`의 버전 **51**을 배포했다. 공개 범위와 환경 설정을 유지했다.
- Sites 소스 커밋: `8759a4e66f61fcad146deb1c739f929afb30ecf8`. 릴리스 소스와 검증한 `apps/sites/dist`를 별도 Sites 소스 저장소에 반영한 커밋이다.
- 버전 ID: `appgprj_6a8ee59a97b4819199c3ba961436581c~appgver_a07fae7c30388191aa8b367bc7be19b9`.
- 배포 ID: `appgdep_6acd6ab9f85c8191906e6e97c8a300fd`. 상태 `succeeded`, `has_mcp: true`, 환경 revision **21**, 완료 `2026-10-12T23:18:32.977116Z`.
- 원래 빌드와 Sites 소스 저장소의 배포 파일 **162/162** SHA가 일치했다. 비밀 값 검사는 1,405개 파일에서 노출 0건이었다.
- 로컬 gzip 묶음 SHA256은 `db86c6288cc72370a1ded59b9b6e602fca3fc753d9ca9f846622250b1168503f`다. Sites 저장 기록의 tar hash는 `sha256:2b9b5bfd963c867fab7b0584c4e8bb6b15c5a3900346cfc907cf9a0c38cf560b`, 2,170,880 bytes, 162 files다. 두 형식의 hash가 동일하다고 주장하지 않는다.
- 배포 후 홈페이지, OAuth 발급자와 보호 리소스 메타데이터 조회가 HTTP 200으로 통과했다. 이는 인증된 신규 MCP 작성·생성 실행 검증과 구분한다.

## Windows 업데이트

| 항목 | 결과 |
|---|---|
| 버전 | 1.3.124 |
| 설치파일 | `BrandConnect-Automation-Setup-1.3.124.exe` |
| 크기 | 347,302,741 bytes |
| SHA256 | `ce2d49a9c72d05dd0fc45d8d3c74db44c511f6cb8c0562158b97ed7fb74c477c` |
| SHA512 | `37HsKx93JIkIfsFablLzjywtkjMOPCnqW0PUhHRz0dHW05ygLpjh5j+yS99z9wwnZjmBrfPQRlLDACnbhyVhhA==` |
| blockmap | 353,797 bytes, SHA256 `e40afa4f5af56a3110f6cca22faee25785bd52427b421a31c127a499d6eebafd` |
| 채널 게시 완료 | `2026-10-12T23:26:14.393Z` |

Windows production build와 NSIS 제작이 통과했다. 패키지의 실행 소스 **78/78**, 기존 승인 정책 **15/15**, 주요 compiled UI **3/3**, Next 실행 산출물 **390/390**이 릴리스 빌드와 일치했다. build-time 선언 파일 3개는 실행 산출물 비교에서 제외했다. 실제 `.env`와 임시 작업 파일은 패키지에서 제외됐고, 빌드 내 비밀 값 노출은 0건이었다.

업데이트 게시 전에 설치파일·blockmap·`latest.yml`의 로컬 크기와 hash를 검사했다. 게시 후 별도 검증에서 관리자 채널 포인터, 승인된 PC의 `latest.yml`, blockmap, 설치파일 HEAD·206 부분 다운로드가 일치했다. 서버에서 설치파일 전체 **347,302,741 bytes**를 내려받은 SHA256과 SHA512도 로컬 검증 파일과 일치했다(`2026-10-12T23:26:50.542Z`).

진행 중인 작성·발행이 없는 것을 확인한 뒤 기존 앱의 업데이트 확인을 한 번 요청했다. 정상 업데이트로 설치·재시작됐으며 `2026-10-12T23:32:22.539Z`에 API가 **1.3.124 / current / ready / activeCount 0**으로 응답했다. 설치된 실행 소스 **78/78**, 기존 승인 정책 **15/15**, compiled UI **3/3**, Next 실행 산출물 **390/390**이 검증한 릴리스와 일치했고 `.env`·임시 파일 제외도 확인했다. 강제 종료나 별도 중복 설치파일 실행은 하지 않았다.

## 보존과 검증 범위

배포 직전 별도 불변 기준으로 저장한 원고·manifest **72개**, 사진 **570개**를 배포 후 다시 비교했고 변경 0건이었다. 정상 업데이트·재시작 후 최종 비교에서도 본문·제목·상품 근거·사진 바이트·출처·배치·전체 renderNodes 변경은 **0건**이었다. manifest 19개의 `textQualityRevalidation`만 정상 시작 재검사 메타데이터로 갱신됐다. 이번 배포에서 소재 작성·이미지 생성·예약·발행 요청은 0회다.

`2026-10-12T23:33:25Z`에 설치된 1.3.124의 정책 소스와 서명 기준으로 같은 52개를 migration 없는 읽기 전용 조회로 확인했다. **준비완료 33/52, 보완 필요 19/52**이며 이전 준비완료 33개 상품 ID도 정확히 일치했다. 갱신된 재검사 메타데이터 19개는 `checkedAt`·`inputFingerprint` 변경으로 한정됐다.

이번 배포는 신규 최초 작성의 성공률, 실제 생성 사진 품질, 인증된 ChatGPT 신규 MCP 작성부터 네이버 발행 완료까지의 현장 성공을 측정한 결과가 아니다. 남은 19개를 이번 배포로 일괄 성공 처리하지 않았다.

로컬 근거: `tmp/release-1.3.124/`의 build·package 로그, 무결성·Sites 배포 기록, `verifier/{published,published-full,public,preservation}.json`, 설치 검증과 보존 기준. 인증키·장치 토큰과 원시 비공개 설정은 배포 산출물이나 보고서에 포함하지 않았다.
