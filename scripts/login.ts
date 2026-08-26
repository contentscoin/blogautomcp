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
import { validateNaverPublishingSession } from "../src/lib/naver-session";

// Stealth 플러그인 적용 (봇 감지 우회)
chromium.use(StealthPlugin());

const STORAGE_PATH = path.join(process.cwd(), "playwright", "storage");
const SESSION_FILE = path.join(STORAGE_PATH, "naver-session.json");
const TEMP_SESSION_FILE = path.join(STORAGE_PATH, `naver-session.pending-${process.pid}.json`);

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

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
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

  // URL만으로 성공을 판단하지 않고, 임시 세션의 실제 글쓰기 권한을 반복 확인합니다.
  let isLoggedIn = false;
  let checkCount = 0;
  const maxChecks = 300; // 최대 5분 대기 (1초 * 300)

  while (!isLoggedIn && checkCount < maxChecks) {
    await new Promise((r) => setTimeout(r, 1000));
    checkCount++;

    try {
      await context.storageState({ path: TEMP_SESSION_FILE });
      const validation = await validateNaverPublishingSession(
        TEMP_SESSION_FILE,
        process.env.NAVER_BLOG_ID?.trim() || "",
        5_000,
      );
      if (validation.valid) {
        isLoggedIn = true;
        console.log("🔍 로그인 및 블로그 글쓰기 권한이 확인되었습니다.");
      }
    } catch {
      // 페이지가 닫혔을 수 있음
      break;
    }
  }

  if (isLoggedIn) {
    // 같은 디렉터리의 임시 파일을 검증한 뒤 원자적으로 교체합니다.
    await context.storageState({ path: TEMP_SESSION_FILE });
    const validation = await validateNaverPublishingSession(
      TEMP_SESSION_FILE,
      process.env.NAVER_BLOG_ID?.trim() || "",
    );
    if (!validation.valid) {
      console.error(`❌ ${validation.error || "최종 권한 확인 실패"}`);
      if (fs.existsSync(TEMP_SESSION_FILE)) fs.unlinkSync(TEMP_SESSION_FILE);
      await browser.close();
      process.exitCode = 1;
      return;
    }
    fs.renameSync(TEMP_SESSION_FILE, SESSION_FILE);
    console.log("\n✅ 검증된 세션이 저장되었습니다.");
    console.log("🎉 이제 자동화가 이 세션을 사용합니다.");
  } else {
    console.error("⏱️ 제한 시간 안에 로그인 및 글쓰기 권한을 확인하지 못했습니다.");
    if (fs.existsSync(TEMP_SESSION_FILE)) fs.unlinkSync(TEMP_SESSION_FILE);
    await browser.close();
    process.exitCode = 1;
    return;
  }

  await browser.close();
  console.log("\n프로그램을 종료합니다.");
  process.exitCode = 0;
}

mainV2().catch((error) => {
  console.error("오류 발생:", error);
  if (fs.existsSync(TEMP_SESSION_FILE)) fs.unlinkSync(TEMP_SESSION_FILE);
  process.exitCode = 1;
});
