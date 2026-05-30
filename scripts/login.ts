/**
 * 네이버 수동 로그인 스크립트
 * 사용법: npm run login
 * 
 * 브라우저에서 로그인 후 브라우저를 닫으면 자동으로 세션이 저장됩니다.
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";

// Stealth 플러그인 적용 (봇 감지 우회)
chromium.use(StealthPlugin());

const STORAGE_PATH = path.join(process.cwd(), "playwright", "storage");
const SESSION_FILE = path.join(STORAGE_PATH, "naver-session.json");

// 폴더가 없으면 생성
if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH, { recursive: true });
}

// 다른 접근 방식: 페이지 이벤트 감지
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

  // 번들 Chromium에서 입력 포커스 문제가 있을 때 LOGIN_BROWSER_CHANNEL=chrome 로 실제 Chrome 사용.
  const launchChannel = process.env.LOGIN_BROWSER_CHANNEL?.trim() || undefined;
  if (launchChannel) console.log(`🌐 브라우저 채널: ${launchChannel}`);
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    ...(launchChannel ? { channel: launchChannel } : {}),
    args: [
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  
  // 봇 감지 우회 스크립트 (문자열로 전달)
  await page.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  `);
  
  // 네이버 로그인 페이지로 이동
  await page.goto("https://nid.naver.com/nidlogin.login");

  console.log("✅ 브라우저가 열렸습니다.");
  console.log("📝 네이버에 로그인해주세요...");
  console.log("   (로그인 완료 감지 중...)");
  console.log("");

  // 로그인 성공 감지: 네이버 인증 쿠키(NID_AUT/NID_SES) 존재로 확정 판정.
  // URL 추측 대신 실제 로그인 신호를 보므로 2FA/기기등록 인터스티셜에도 견고하다.
  let isLoggedIn = false;
  let checkCount = 0;
  const maxChecks = 480; // 최대 8분 대기 (1초 * 480)

  while (!isLoggedIn && checkCount < maxChecks) {
    await new Promise((r) => setTimeout(r, 1000));
    checkCount++;

    try {
      const cookies = await context.cookies();
      const names = new Set(cookies.map((c) => c.name));
      if (names.has("NID_AUT") && names.has("NID_SES")) {
        isLoggedIn = true;
        console.log("🔍 로그인 인증 쿠키 감지됨!");
        break;
      }
    } catch {
      // 페이지/컨텍스트가 닫혔을 수 있음
      break;
    }

    // 30초마다 남은 시간 안내
    if (checkCount % 30 === 0) {
      const remain = Math.ceil((maxChecks - checkCount) / 60);
      console.log(`   ⏳ 로그인 대기 중... (약 ${remain}분 남음)`);
    }
  }

  if (isLoggedIn) {
    // 블로그 페이지로 이동하여 최종 확인 후 세션 저장
    console.log("🔄 로그인 상태 최종 확인 중...");
    try {
      await page.goto("https://blog.naver.com/", { waitUntil: "domcontentloaded", timeout: 10000 });
      await new Promise((r) => setTimeout(r, 2000));
    } catch {
      console.log("⚠️ 블로그 페이지 이동 중 오류(무시) — 현재 컨텍스트로 저장합니다.");
    }
    await context.storageState({ path: SESSION_FILE });
    console.log("");
    console.log("✅ 세션이 저장되었습니다!");
    console.log(`   📁 저장 위치: ${SESSION_FILE}`);
    console.log("🎉 이제 자동화가 이 세션을 사용합니다. (보통 7~30일 유지)");
  } else {
    // 로그인 미완료 시 기존 세션을 덮어쓰지 않는다(비로그인 상태 저장 방지).
    console.log("⏱️ 시간 초과 — 로그인이 감지되지 않았습니다.");
    console.log("   ⚠️ 비로그인 상태를 저장하지 않도록 기존 세션 파일을 보존합니다.");
    console.log("   다시 시도하려면 npm run login 을 재실행하세요.");
  }

  await browser.close();
  console.log("\n프로그램을 종료합니다.");
  process.exit(isLoggedIn ? 0 : 1);
}

mainV2().catch((error) => {
  console.error("오류 발생:", error);
  process.exit(1);
});
