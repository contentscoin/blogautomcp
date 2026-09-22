/**
 * 네이버 수동 로그인 스크립트
 * 사용법: npm run login
 * 
 * 브라우저에서 로그인 후 브라우저를 닫으면 자동으로 세션이 저장됩니다.
 */

import { chromium, type BrowserContext } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { validateNaverPublishingSession } from "../src/lib/naver-session";
import { probeShoppingCategoryFromSession, ShoppingConnectAccessError } from "../src/lib/shopping-connect-access";
import { getSessionStorageDir } from "./lib/app-paths";
import {
  replaceSessionFileWithRollback,
  waitForNaverAuthentication,
} from "./lib/naver-login-flow";

const STORAGE_PATH = getSessionStorageDir();
const SESSION_FILE = path.join(STORAGE_PATH, "naver-session.json");
const TEMP_SESSION_FILE = path.join(STORAGE_PATH, `naver-session.pending-${process.pid}.json`);
const LOGIN_PROFILE_PATH = path.join(STORAGE_PATH, "naver-login-profile");
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL?.trim() || "chrome";
const FORCE_LOGIN = process.argv.includes("--force-login");
const BRANDCONNECT_LOGIN_URL = "https://nid.naver.com/nidlogin.login?url=https://brandconnect.naver.com";

// 폴더가 없으면 생성
if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH, { recursive: true });
}

async function mainV2() {
  console.log("=".repeat(50));
  console.log("네이버 블로그 자동화 - 로그인 설정");
  console.log("=".repeat(50));
  console.log("");
  console.log("📌 사용 방법:");
  console.log("   1. 열리는 브라우저에서 네이버 로그인");
  console.log("   2. 로그인 완료되면 자동 감지됩니다");
  console.log("   3. 세션 저장 후 브라우저가 자동으로 닫힙니다");
  console.log("");

  let context: BrowserContext | null = null;
  try {
    // 수동 로그인에는 페이지 동작을 바꾸는 스텔스 플러그인과 오래된 고정 UA를 쓰지 않습니다.
    // 실제 설치된 Chrome과 전용 영구 프로필을 사용해 로그인 화면의 반복 초기화를 피합니다.
    context = await chromium.launchPersistentContext(LOGIN_PROFILE_PATH, {
      channel: BROWSER_CHANNEL,
      headless: false,
      viewport: null,
      locale: "ko-KR",
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const existingPages = context.pages();
    const page = existingPages[0] ?? (await context.newPage());
    await Promise.all(existingPages.slice(1).map((extraPage) => extraPage.close().catch(() => {})));
    page.on("crash", () => console.error("❌ 네이버 로그인 페이지가 비정상 종료되었습니다."));

    if (FORCE_LOGIN) {
      await context.clearCookies();
      console.log("🔄 기존 네이버 브라우저 인증을 비우고 재로그인을 시작합니다.");
    }

    await page.goto("https://nid.naver.com/nidlogin.login", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    console.log("✅ 브라우저가 열렸습니다.");
    console.log("📝 네이버에 로그인해주세요...");
    console.log("   (로그인 완료 감지 중...)");
    console.log("");

    const result = await waitForNaverAuthentication(context, {
      sessionPath: TEMP_SESSION_FILE,
      timeoutMs: 8 * 60_000,
    });

    if (result.status === "closed") {
      console.error("❌ 로그인 완료 전에 브라우저 창이 닫혔습니다.");
      process.exitCode = 1;
      return;
    }
    if (result.status === "timeout") {
      console.error("⏱️ 8분 안에 네이버 로그인을 확인하지 못했습니다.");
      process.exitCode = 1;
      return;
    }

    console.log("🔍 네이버 계정 로그인이 확인되었습니다.");

    // A fresh PC has Naver cookies but no BrandConnect account handshake yet.
    // Complete the same first-party SSO used by BrandConnect, then persist the
    // refreshed cookie jar before probing the signed-in space/category APIs.
    try {
      await page.goto(BRANDCONNECT_LOGIN_URL, {
        waitUntil: "commit",
        timeout: 30_000,
      });
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      await context.storageState({ path: TEMP_SESSION_FILE });
      const shoppingCategoryUrl = await probeShoppingCategoryFromSession(TEMP_SESSION_FILE);
      if (shoppingCategoryUrl) {
        console.log("✅ 쇼핑커넥트 계정 공간과 상품 카테고리도 확인되었습니다.");
      } else {
        console.warn("⚠️ 네이버 로그인은 저장하지만 쇼핑커넥트 공간은 확인되지 않았습니다. 쇼핑커넥트 가입·권한을 확인하세요.");
      }
    } catch (error) {
      await context.storageState({ path: TEMP_SESSION_FILE }).catch(() => {});
      const detail = error instanceof ShoppingConnectAccessError ? error.message : "브랜드커넥트 연결 응답 없음";
      console.warn(`⚠️ 네이버 로그인은 저장하지만 쇼핑커넥트 연결은 완료되지 않았습니다: ${detail}`);
    }

    const blogId = process.env.NAVER_BLOG_ID?.trim();
    if (blogId) {
      const validation = await validateNaverPublishingSession(TEMP_SESSION_FILE, blogId);
      if (validation.valid) {
        console.log("✅ 네이버 블로그 글쓰기 권한도 확인되었습니다.");
      } else {
        console.warn(`⚠️ 로그인은 저장하지만 블로그 권한 확인은 완료되지 않았습니다: ${validation.error || "확인 실패"}`);
      }
    } else {
      console.warn("⚠️ 네이버 로그인은 저장합니다. 블로그 ID는 프로그램 설정에서 나중에 입력할 수 있습니다.");
    }

    replaceSessionFileWithRollback(TEMP_SESSION_FILE, SESSION_FILE);
    console.log("\n✅ 네이버 로그인 세션이 저장되었습니다.");
    console.log("🎉 이제 프로그램 설정에서 블로그 ID를 입력하면 발행 권한을 확인합니다.");
    process.exitCode = 0;
  } finally {
    await context?.close().catch(() => {});
    if (fs.existsSync(TEMP_SESSION_FILE)) fs.unlinkSync(TEMP_SESSION_FILE);
  }

  console.log("\n프로그램을 종료합니다.");
}

async function checkRuntime() {
  const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: true });
  await browser.close();
  fs.accessSync(STORAGE_PATH, fs.constants.R_OK | fs.constants.W_OK);
  console.log(JSON.stringify({
    ok: true,
    browserChannel: BROWSER_CHANNEL,
    sessionStorageDir: STORAGE_PATH,
  }));
}

const entry = process.argv.includes("--check-runtime") ? checkRuntime() : mainV2();

entry.catch((error) => {
  console.error("오류 발생:", error);
  if (fs.existsSync(TEMP_SESSION_FILE)) fs.unlinkSync(TEMP_SESSION_FILE);
  process.exitCode = 1;
});
