/**
 * 관리자 API 인증 회귀 검증.
 *   - ADMIN_API_KEY 가 설정되면 Origin/Referer/Sec-Fetch-Site 만으로는 통과하지 못한다.
 *   - x-admin-api-key 헤더 또는 대시보드 세션 쿠키(+동일 출처)만 통과한다.
 *   - 키가 없으면 동일 출처인 로컬 앱 요청만 통과한다.
 *   - 키가 없어도 다른 사이트 요청(CSRF)과 허용하지 않은 호스트 이름(DNS 리바인딩)은 거부한다.
 *     IP 주소·localhost 접속과 출처 헤더가 없는 스크립트는 통과한다.
 *   - 커스텀 서버 내부 URL과 실제 수신 Host가 달라도 실제 로컬 Origin을 인식한다.
 */

import assert from "node:assert/strict";
import { NextRequest } from "next/server";

Object.assign(process.env, { NODE_ENV: "production" });
process.env.REMOTE_SITE_URL = "https://example.test";
process.env.REMOTE_DEVICE_ID = "device_test";
process.env.REMOTE_DEVICE_TOKEN = "token_test";

async function main() {
  const { requireAdminApiKey } = await import("../src/lib/api-auth");
  const { requireTrustedLocalMutation } = await import("../src/lib/local-request-auth");
  const { ADMIN_SESSION_COOKIE, adminSessionTokenFor } = await import("../src/lib/admin-session");

  const base = "http://app.example.test:3001";
  const request = (headers: Record<string, string> = {}, cookie?: string) =>
    new NextRequest(`${base}/api/posting/stop`, {
      method: "POST",
      headers: { ...(cookie ? { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` } : {}), ...headers },
    });
  const status = (response: ReturnType<typeof requireAdminApiKey>) => (response ? response.status : 200);

  // 키가 없으면 로컬 앱·스크립트 요청은 자격 증명 없이 통과한다.
  process.env.ADMIN_API_KEY = "";
  const local = (headers: Record<string, string> = {}) =>
    new NextRequest("http://127.0.0.1:43127/api/materials/publish", { method: "POST", headers: { host: "127.0.0.1:43127", ...headers } });
  assert.equal(status(requireAdminApiKey(local())), 200, "키 미설정: 출처 헤더 없는 로컬 스크립트 통과");
  assert.equal(status(requireAdminApiKey(local({ origin: "http://127.0.0.1:43127", "sec-fetch-site": "same-origin" }))), 200, "키 미설정: 로컬 대시보드 통과");
  assert.equal(status(requireAdminApiKey(local({ host: "localhost:43127", origin: "http://localhost:43127" }))), 200, "키 미설정: localhost 별칭 통과");
  // 다른 사이트가 사용자의 브라우저로 로컬 발행 API를 부르는 CSRF.
  assert.equal(status(requireAdminApiKey(local({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }))), 403, "키 미설정: 다른 사이트 요청 거부");
  assert.equal(status(requireAdminApiKey(local({ origin: "https://evil.example" }))), 403, "키 미설정: 다른 Origin 거부");
  assert.equal(status(requireAdminApiKey(local({ "sec-fetch-site": "same-site" }))), 403, "키 미설정: same-site 거부");
  // DNS 리바인딩: 공격자 도메인이 127.0.0.1로 풀리면 Origin과 Host가 같은 외부 도메인이 된다.
  assert.equal(status(requireAdminApiKey(request({ origin: base, "sec-fetch-site": "same-origin" }))), 403, "키 미설정: 허용하지 않은 호스트 이름 거부");
  const hostRejection = await requireAdminApiKey(request())!.json();
  assert.equal(hostRejection.code, "LOCAL_REQUEST_REQUIRED");
  assert.match(hostRejection.error, /LOCAL_ALLOWED_HOSTS/u, "Host 거부 안내는 해결 방법을 알려준다");
  const mutationRejection = requireTrustedLocalMutation(request({ origin: base }))!;
  assert.equal(mutationRejection.status, 403, "키 미설정: remote-agent 변경도 허용하지 않은 호스트 이름 거부");
  assert.equal((await mutationRejection.json()).code, "LOCAL_REQUEST_REQUIRED");
  const crossSiteRejection = await requireAdminApiKey(local({ origin: "https://evil.example" }))!.json();
  assert.equal(crossSiteRejection.code, "LOCAL_REQUEST_REQUIRED");
  assert.match(crossSiteRejection.error, /x-admin-api-key/u, "다른 사이트 요청 거부 안내는 외부 도구용 방법을 알려준다");
  // 리바인딩은 DNS 이름으로만 가능하다. Host가 IP 주소이면(같은 공유기의 다른 기기, 0.0.0.0 바인딩, IPv6) 통과한다.
  const hosted = (host: string, headers: Record<string, string> = {}) =>
    local({ host, origin: `http://${host}`, "sec-fetch-site": "same-origin", ...headers });
  for (const host of ["192.168.0.12:43127", "0.0.0.0:43127", "[::1]:43127", "127.0.0.1"]) {
    assert.equal(status(requireAdminApiKey(hosted(host))), 200, `키 미설정: IP 주소 Host 통과 (${host})`);
    assert.equal(status(requireTrustedLocalMutation(hosted(host))), 200, `키 미설정: IP 주소 Host의 변경 요청 통과 (${host})`);
  }
  assert.equal(status(requireAdminApiKey(hosted("192.168.0.12:43127", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }))), 403,
    "IP 주소 Host라도 다른 사이트 요청은 거부");
  // IP나 localhost처럼 보이게 만든 공격자 도메인, 해석할 수 없는 Host는 거부한다.
  for (const host of ["127.0.0.1.evil.example:43127", "localhost.evil.example:43127", "evil.example", "localhost.", "bad host"]) {
    assert.equal(status(requireAdminApiKey(hosted(host))), 403, `키 미설정: 허용하지 않은 Host 거부 (${host})`);
    assert.equal(status(requireTrustedLocalMutation(hosted(host))), 403, `키 미설정: 허용하지 않은 Host의 변경 요청 거부 (${host})`);
  }
  // 출처 헤더가 없는 요청도 Host가 허용되지 않으면 거부한다(해석할 수 없는 Host를 내부 URL로 대신 판단하지 않는다).
  for (const host of ["bad host", "evil.example:43127"])
    assert.equal(status(requireAdminApiKey(local({ host }))), 403, `키 미설정: 출처 헤더 없이도 허용하지 않은 Host 거부 (${host})`);
  // 명시한 이름만 추가로 받는다. 포트·스킴·대소문자·공백이 섞여 있어도 이름으로 비교한다.
  for (const allowed of ["app.example.test", "app.example.test:3001", "http://app.example.test:3001", " other.test , APP.Example.Test "]) {
    process.env.LOCAL_ALLOWED_HOSTS = allowed;
    assert.equal(status(requireAdminApiKey(request({ origin: base, "sec-fetch-site": "same-origin" }))), 200, `LOCAL_ALLOWED_HOSTS로 명시한 Host 허용 (${allowed})`);
  }
  process.env.LOCAL_ALLOWED_HOSTS = "other.test,*";
  assert.equal(status(requireAdminApiKey(request({ origin: base, "sec-fetch-site": "same-origin" }))), 403, "LOCAL_ALLOWED_HOSTS는 와일드카드를 받지 않는다");
  delete process.env.LOCAL_ALLOWED_HOSTS;
  process.env.APP_HOST = "app.example.test";
  assert.equal(status(requireAdminApiKey(request({ origin: base, "sec-fetch-site": "same-origin" }))), 200, "APP_HOST로 지정한 이름 허용");
  delete process.env.APP_HOST;
  assert.equal(status(requireAdminApiKey(request({ origin: base, "sec-fetch-site": "same-origin" }))), 403, "설정을 지우면 다시 거부");
  process.env.LOCAL_ALLOWED_HOSTS = "app.example.test";

  process.env.ADMIN_API_KEY = "secret-key-1234";
  const token = adminSessionTokenFor("secret-key-1234");

  // 출처 헤더만으로는 통과하지 못한다(누구나 붙일 수 있는 헤더).
  assert.equal(status(requireAdminApiKey(request({ origin: base }))), 401, "같은 Origin 만으로 통과 금지");
  assert.equal(status(requireAdminApiKey(request({ referer: `${base}/` }))), 401, "같은 Referer 만으로 통과 금지");
  assert.equal(status(requireAdminApiKey(request({ "sec-fetch-site": "same-origin" }))), 401, "Sec-Fetch-Site 만으로 통과 금지");
  assert.equal(status(requireAdminApiKey(request({ "sec-fetch-site": "same-site" }))), 401, "same-site 만으로 통과 금지");
  const denied = requireAdminApiKey(request({ origin: base }));
  assert.equal((await denied!.json()).code, "ADMIN_AUTH_REQUIRED");

  // 실제 자격 증명은 통과한다.
  assert.equal(status(requireAdminApiKey(request({ "x-admin-api-key": "secret-key-1234" }))), 200, "헤더 키 통과");
  assert.equal(status(requireAdminApiKey(request({ "x-admin-api-key": "wrong" }))), 401, "틀린 키 거부");
  assert.equal(status(requireAdminApiKey(request({ origin: base, "sec-fetch-site": "same-origin" }, token))), 200, "세션 쿠키 + 동일 출처 통과");
  assert.equal(status(requireAdminApiKey(request({}, token))), 200, "세션 쿠키(출처 헤더 없음) 통과");
  assert.equal(status(requireAdminApiKey(request({ origin: "https://evil.example" }, token))), 401, "세션 쿠키라도 다른 출처면 거부(CSRF)");
  assert.equal(status(requireAdminApiKey(request({ "sec-fetch-site": "cross-site" }, token))), 401, "cross-site 요청은 거부");
  assert.equal(status(requireAdminApiKey(request({}, "forged-cookie"))), 401, "위조 쿠키 거부");

  // remote-agent 변경 API 도 같은 규칙을 따른다.
  assert.equal(status(requireTrustedLocalMutation(request({ origin: base }))), 401, "키 설정 시 Origin 만으로 remote-agent 변경 금지");
  assert.equal(status(requireTrustedLocalMutation(request({ "x-admin-api-key": "secret-key-1234" }))), 200);
  assert.equal(status(requireTrustedLocalMutation(request({ origin: base }, token))), 200);
  process.env.ADMIN_API_KEY = "";
  assert.equal(status(requireTrustedLocalMutation(request({ origin: base }))), 200, "키 미설정: 동일 출처 브라우저 요청 허용(허용 Host)");
  delete process.env.LOCAL_ALLOWED_HOSTS;
  assert.equal(status(requireTrustedLocalMutation(request({ origin: "https://evil.example" }))), 403, "키 미설정: 다른 출처 거부");
  assert.equal(status(requireTrustedLocalMutation(request({ "sec-fetch-site": "cross-site" }))), 403, "키 미설정: cross-site 거부");

  // 패키지 커스텀 서버가 내부 URL을 기본값으로 구성해도 실제 수신 Host를 기준으로 판정한다.
  const packagedRequest = (headers: Record<string, string> = {}, cookie?: string) =>
    new NextRequest("http://localhost:3000/api/system/control", {
      method: "POST",
      headers: {
        host: "127.0.0.1:43127",
        ...(cookie ? { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` } : {}),
        ...headers,
      },
    });
  assert.equal(
    status(requireTrustedLocalMutation(packagedRequest({ origin: "http://127.0.0.1:43127", "sec-fetch-site": "same-origin" }))),
    200,
    "실제 수신 Host와 일치하는 패키지 앱 Origin 허용",
  );
  assert.equal(
    status(requireTrustedLocalMutation(packagedRequest({ origin: "http://localhost:43127", "sec-fetch-site": "same-origin" }))),
    200,
    "같은 포트의 loopback 별칭 허용",
  );
  assert.equal(
    status(requireTrustedLocalMutation(packagedRequest({ origin: "http://127.0.0.1:43128", "sec-fetch-site": "same-origin" }))),
    403,
    "다른 로컬 포트의 Origin 거부",
  );
  assert.equal(
    status(requireTrustedLocalMutation(packagedRequest({ origin: "https://evil.example", "sec-fetch-site": "same-origin" }))),
    403,
    "실제 Host가 로컬이어도 외부 Origin 거부",
  );
  assert.equal(
    status(requireTrustedLocalMutation(packagedRequest({ origin: "http://localhost:3000" }))),
    403,
    "Next 내부 기본 Origin은 실제 수신 Host와 다르면 신뢰하지 않음",
  );

  process.env.ADMIN_API_KEY = "secret-key-1234";
  assert.equal(
    status(requireTrustedLocalMutation(packagedRequest({ origin: "http://127.0.0.1:43127", "sec-fetch-site": "same-origin" }, token))),
    200,
    "관리자 세션도 실제 수신 Host 기준 동일 출처 허용",
  );
  assert.equal(
    status(requireTrustedLocalMutation(packagedRequest({ origin: "https://evil.example", "sec-fetch-site": "same-origin" }, token))),
    401,
    "관리자 세션의 외부 Origin은 계속 거부",
  );

  console.log(JSON.stringify({ ok: true, checks: "admin-api-key/session-cookie/csrf" }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
