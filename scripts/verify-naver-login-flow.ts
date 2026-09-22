import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  hasNaverAuthCookies,
  replaceSessionFileWithRollback,
  waitForNaverAuthentication,
  type LoginCookie,
  type LoginContext,
} from "./lib/naver-login-flow";

class FakeLoginContext implements LoginContext {
  private cookieIndex = 0;
  storageWrites = 0;

  constructor(
    private readonly cookieFrames: LoginCookie[][],
    private readonly openPages = 1,
  ) {}

  async cookies(): Promise<LoginCookie[]> {
    const frame = this.cookieFrames[Math.min(this.cookieIndex, this.cookieFrames.length - 1)] ?? [];
    this.cookieIndex += 1;
    return frame;
  }

  pages(): unknown[] {
    return Array.from({ length: this.openPages }, () => ({}));
  }

  async storageState(): Promise<void> {
    this.storageWrites += 1;
  }
}

const authCookies: LoginCookie[] = [
  { name: "NID_AUT", value: "auth", domain: ".naver.com" },
  { name: "NID_SES", value: "session", domain: ".naver.com" },
];

assert.equal(hasNaverAuthCookies(authCookies), true);
assert.equal(hasNaverAuthCookies(authCookies.slice(0, 1)), false);
assert.equal(
  hasNaverAuthCookies(authCookies.map((cookie) => ({ ...cookie, domain: ".example.com" }))),
  false,
);

async function main(): Promise<void> {
const loginSource = fs.readFileSync(path.join(__dirname, "login.ts"), "utf8");
assert.match(loginSource, /nidlogin\.login\?url=https:\/\/brandconnect\.naver\.com/u,
  "fresh-PC login must complete the first-party BrandConnect SSO handshake");
assert.match(loginSource, /probeShoppingCategoryFromSession\(TEMP_SESSION_FILE\)/u,
  "login must verify the persisted shopping space/category before reporting setup");
let clock = 0;
const authenticatedContext = new FakeLoginContext([[], authCookies, authCookies]);
const authenticated = await waitForNaverAuthentication(authenticatedContext, {
  sessionPath: "pending.json",
  timeoutMs: 100,
  pollIntervalMs: 1,
  settleMs: 1,
  now: () => clock,
  sleep: async (milliseconds) => {
    clock += milliseconds;
  },
});
assert.deepEqual(authenticated, { status: "authenticated" });
assert.equal(authenticatedContext.storageWrites, 1);

const closed = await waitForNaverAuthentication(new FakeLoginContext([[]], 0), {
  sessionPath: "pending.json",
  timeoutMs: 10,
  now: () => 0,
  sleep: async () => {},
});
assert.deepEqual(closed, { status: "closed" });

clock = 0;
const timedOut = await waitForNaverAuthentication(new FakeLoginContext([[]]), {
  sessionPath: "pending.json",
  timeoutMs: 3,
  pollIntervalMs: 1,
  now: () => clock,
  sleep: async (milliseconds) => {
    clock += milliseconds;
  },
});
assert.deepEqual(timedOut, { status: "timeout" });

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "brandconnect-naver-login-"));
try {
  const pendingPath = path.join(tempDir, "pending.json");
  const sessionPath = path.join(tempDir, "session.json");
  fs.writeFileSync(sessionPath, "old", "utf8");
  fs.writeFileSync(pendingPath, "new", "utf8");
  replaceSessionFileWithRollback(pendingPath, sessionPath);
  assert.equal(fs.readFileSync(sessionPath, "utf8"), "new");
  assert.equal(fs.existsSync(`${sessionPath}.previous`), false);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("Naver login flow verification passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
