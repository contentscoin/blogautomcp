/**
 * 관리자 API 인증 회귀 검증.
 *   - ADMIN_API_KEY 가 설정되면 Origin/Referer/Sec-Fetch-Site 만으로는 통과하지 못한다.
 *   - x-admin-api-key 헤더 또는 대시보드 세션 쿠키(+동일 출처)만 통과한다.
 *   - 키가 없으면 종전처럼 열려 있다.
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

  // 키가 없으면 열려 있다.
  process.env.ADMIN_API_KEY = "";
  assert.equal(status(requireAdminApiKey(request())), 200, "키 미설정: 통과");

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
  assert.equal(status(requireTrustedLocalMutation(request({ origin: base }))), 200, "키 미설정: 동일 출처 브라우저 요청 허용");
  assert.equal(status(requireTrustedLocalMutation(request({ origin: "https://evil.example" }))), 403, "키 미설정: 다른 출처 거부");
  assert.equal(status(requireTrustedLocalMutation(request({ "sec-fetch-site": "cross-site" }))), 403, "키 미설정: cross-site 거부");

  console.log(JSON.stringify({ ok: true, checks: "admin-api-key/session-cookie/csrf" }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
