import "dotenv/config";
import fs from "fs";
import path from "path";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getAppDataDir, getNaverSessionFile } from "./lib/app-paths";
import { readNaverSessionSnapshot } from "./lib/naver-session-state";
import {
  attachShoppingJsonCapture,
  collectShoppingPageState,
  parseShoppingProductCard,
  redactSensitiveFields,
} from "./lib/shopping-product-card";

/**
 * 실제 쇼핑 상품 페이지의 구조화 데이터를 떠서 저장한다. 구조화 수집이 무엇을 놓치는지 확인하는 용도.
 * 사용: npm run capture:shopping-page -- <상품 URL 또는 naver.me 링크>
 * 저장 전에 계정·인증 관련 값은 지운다. 네이버에는 아무것도 쓰지 않는다.
 */
chromium.use(StealthPlugin());

async function main() {
  const url = process.argv.slice(2).find((arg) => /^https?:\/\//iu.test(arg));
  if (!url) throw new Error("상품 URL을 입력하세요. 예: npm run capture:shopping-page -- https://naver.me/xxxx");
  const sessionFile = getNaverSessionFile();
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL?.trim() || undefined, headless: false });
  try {
    const context = await browser.newContext({
      ...(fs.existsSync(sessionFile) ? { storageState: readNaverSessionSnapshot(sessionFile).state } : {}),
      viewport: { width: 1400, height: 1000 },
    });
    const page = await context.newPage();
    const capture = attachShoppingJsonCapture(page, 20);
    await page.goto(url, { timeout: 30000 });
    await page.waitForTimeout(6000);
    const embedded = await collectShoppingPageState(page);
    capture.detach();
    const card = parseShoppingProductCard([...embedded, ...capture.states]);
    const outputDir = path.join(getAppDataDir(), "shopping-fixtures", new Date().toISOString().replace(/[:.]/gu, "-"));
    fs.mkdirSync(outputDir, { recursive: true });
    const write = (name: string, value: unknown) => fs.writeFileSync(path.join(outputDir, name), JSON.stringify(value, null, 2), "utf8");
    write("embedded-state.json", redactSensitiveFields(embedded));
    write("captured-responses.json", redactSensitiveFields(capture.states));
    write("summary.json", { finalUrl: page.url().split("?")[0], capturedUrls: capture.urls, embeddedCount: embedded.length, card });
    console.log(`저장 위치: ${outputDir}`);
    console.log(card.found
      ? `상품 카드 발견: ${card.name} · 사실 ${card.factLines.length}줄 · 옵션 ${card.optionLines.length}줄 · 이미지 ${card.imageUrls.length + card.detailImageUrls.length}장 · 상세 글자 ${card.detailText.length}자`
      : `상품 카드를 찾지 못했습니다. 내장 상태 ${embedded.length}개, 응답 ${capture.states.length}건을 저장했습니다.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
