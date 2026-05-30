/**
 * 네이버 스마트에디터 ONE 셀렉터 점검 (READ-ONLY 진단).
 *
 * 목적: 발행 핵심 경로(simple-agent.ts)가 의존하는 해시 클래스 셀렉터의 현재 DOM을
 *       점검해, data-name/role/aria 같은 안정적 대안 셀렉터를 도출한다.
 *
 * 안전장치:
 *  - 제목/본문을 입력하지 않는다(빈 글 → 네이버가 발행 자체를 막음).
 *  - 어떤 "최종 발행" 버튼도 클릭하지 않는다. 발행 설정 레이어는 열어서 읽기만 한다.
 *  - 로그인 페이지로 리다이렉트되면(세션 만료) 즉시 종료.
 *  - try/finally로 항상 브라우저를 닫는다.
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs";
import type { Page } from "playwright";
import {
  EDITOR_SELECTORS,
  EDITOR_VIEWPORT,
  isLoginRedirect,
  checkEditorReady,
} from "./lib/naver-editor-selectors";

chromium.use(StealthPlugin());

const SESSION_FILE = path.join(process.cwd(), "playwright", "storage", "naver-session.json");
const NAVER_BLOG_ID = process.env.NAVER_BLOG_ID || "";
const OUT_DIR = path.join(process.cwd(), "logs");
const SHOT_DIR = path.join(OUT_DIR, "selector-inspect");

// page.evaluate 안에서 한 요소의 안정적 식별 속성을 뽑는 헬퍼(직렬화용 문자열).
const DESCRIBE_FN = `(el) => {
  if (!el) return null;
  const attrs = {};
  for (const a of el.attributes) attrs[a.name] = a.value;
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || el.textContent || '').trim().slice(0, 40),
    className: el.className,
    dataName: el.getAttribute('data-name'),
    dataTestid: el.getAttribute('data-testid') || el.getAttribute('data-log') || null,
    ariaLabel: el.getAttribute('aria-label'),
    role: el.getAttribute('role'),
    id: el.id || null,
    attrs,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
  };
}`;

async function dumpCandidates(page: Page, label: string, selectors: string[]) {
  const result: Record<string, unknown> = {};
  for (const sel of selectors) {
    try {
      const info = await page.evaluate(
        ([s, fnStr]) => {
          const fn = eval(fnStr as string);
          const els = Array.from(document.querySelectorAll(s as string)).slice(0, 4);
          return els.map((e) => fn(e));
        },
        [sel, DESCRIBE_FN] as [string, string]
      );
      result[sel] = info.length ? info : "(없음)";
    } catch (e) {
      result[sel] = `(에러: ${(e as Error).message})`;
    }
  }
  console.log(`\n──── ${label} ────`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

// 텍스트로 버튼류를 스캔(안정적 텍스트 기반 셀렉터 후보 발굴).
async function scanButtonsByText(page: Page, label: string, root = "body") {
  const info = await page.evaluate(
    ([rootSel, fnStr]) => {
      const fn = eval(fnStr as string);
      const scope = document.querySelector(rootSel as string) || document.body;
      const els = Array.from(scope.querySelectorAll('button, [role="button"], a'))
        .filter((e) => {
          const r = (e as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (e as HTMLElement).innerText.trim();
        })
        .slice(0, 40);
      return els.map((e) => fn(e));
    },
    [root, DESCRIBE_FN] as [string, string]
  );
  console.log(`\n──── ${label} (보이는 버튼/링크) ────`);
  console.log(JSON.stringify(info, null, 2));
  return info;
}

async function main() {
  if (!NAVER_BLOG_ID) throw new Error("NAVER_BLOG_ID 미설정");
  if (!fs.existsSync(SESSION_FILE)) throw new Error("naver-session.json 없음 — npm run login 필요");
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const report: Record<string, unknown> = { capturedAt: new Date().toISOString() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;
  try {
    browser = await chromium.launch({
      headless: false,
      slowMo: 60,
      args: ["--disable-blink-features=AutomationControlled", "--disable-features=IsolateOrigins,site-per-process"],
    });
    const context = await browser.newContext({
      storageState: SESSION_FILE,
      viewport: { ...EDITOR_VIEWPORT },
      locale: "ko-KR",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    await context.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR','ko','en-US','en'] });
    `);
    const page: Page = await context.newPage();
    // 안전: 어떤 네이티브 다이얼로그(alert/confirm)도 무조건 취소(dismiss). 절대 수락하지 않음.
    page.on("dialog", (d) => {
      console.log(`   (다이얼로그 자동 취소: ${d.type()} "${d.message().slice(0, 40)}")`);
      d.dismiss().catch(() => {});
    });

    const url = `https://blog.naver.com/${NAVER_BLOG_ID}/postwrite`;
    console.log(`📄 에디터 진입: ${url}`);
    await page.goto(url, { timeout: 45000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);

    // 세션 만료 감지(중앙 모듈 사용)
    const curUrl = page.url();
    if (isLoginRedirect(curUrl)) {
      console.log(`❌ 로그인 페이지로 리다이렉트됨(세션 만료): ${curUrl}`);
      report.error = "SESSION_EXPIRED";
      report.redirectedTo = curUrl;
      return report;
    }

    // 작성 중 글 팝업 닫기(취소 = 새 글로 진행, 발행 아님)
    try {
      const cancel = await page.$(EDITOR_SELECTORS.draftPopupCancel);
      if (cancel) {
        await cancel.click();
        console.log("   작성중 글 팝업 닫음");
        await page.waitForTimeout(1200);
      }
    } catch {}

    await page.screenshot({ path: path.join(SHOT_DIR, "1-editor.png") }).catch(() => {});

    // 0. 헬스체크: 중앙 모듈의 안정 셀렉터가 현재 DOM에 살아있는지(드리프트 감지)
    report.readiness = await checkEditorReady(page);
    console.log("\n──── 0. 에디터 헬스체크(중앙 모듈) ────");
    console.log(JSON.stringify(report.readiness, null, 2));

    // A. 제목 영역
    report.title = await dumpCandidates(page, "A. 제목(title) 후보", [
      ...EDITOR_SELECTORS.title.stable,
      "[contenteditable='true']",
      ".se-section-documentTitle",
    ]);

    // B. 이미지 업로드 버튼
    report.image = await dumpCandidates(page, "B. 이미지 버튼 후보", [
      ...EDITOR_SELECTORS.imageButton.stable,
      "button[data-log*='image']",
    ]);

    // C. 상단 헤더 영역 버튼 스캔(발행/임시저장 등) + 해시 클래스 후보
    report.headerButtons = await scanButtonsByText(page, "C. 헤더 버튼", "header, .header, [class*='header']");
    report.headerPublishCandidates = await dumpCandidates(page, "C2. 헤더 발행버튼 후보", [
      ...(EDITOR_SELECTORS.headerPublishButton.semi ?? []),
    ]);

    // D. 발행 설정 레이어 열기 (← 설정만 펼침, 발행 아님). 빈 글이라 발행 불가 상태.
    console.log("\n🔎 발행 설정 레이어 열기 시도(읽기 전용, 최종 발행 클릭 안 함)");

    // 도움말/가이드 레이어가 발행버튼 클릭을 가로막으므로 먼저 닫는다(Escape + close 셀렉터).
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);
    }
    for (const sel of EDITOR_SELECTORS.helpCloseButtons) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(200);
      }
    }
    await page.evaluate("window.scrollTo(0,0)").catch(() => {});
    await page.waitForTimeout(500);

    try {
      // 안정 셀렉터(data-click-area) 우선, 없으면 semi 폴백으로 헤더 발행버튼 탐색.
      const publishSelectors = [
        ...EDITOR_SELECTORS.headerPublishButton.stable,
        ...(EDITOR_SELECTORS.headerPublishButton.semi ?? []),
      ];
      const headerPublish = await page.$(publishSelectors.join(", "));
      if (headerPublish) {
        await headerPublish.click({ timeout: 3000 });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: path.join(SHOT_DIR, "2-publish-panel.png") }).catch(() => {});

        report.scheduleControls = await dumpCandidates(page, "D. 예약/날짜 컨트롤 후보", [
          ...EDITOR_SELECTORS.scheduleReserveRadio.stable,
          ...EDITOR_SELECTORS.scheduleNowRadio.stable,
          ...EDITOR_SELECTORS.finalPublishButton.stable,
          "input[type='radio']",
          "input[class*='input_date']",
          "[class*='date']",
          "select",
          "[class*='calendar']",
        ]);
        // D3. 예약 라디오 선택(발행 아님) → 날짜/시간 입력이 렌더되면 캡처.
        try {
          const reserve = await page.$(EDITOR_SELECTORS.scheduleReserveRadio.stable.join(", "));
          if (reserve) {
            await reserve.check({ timeout: 2000 }).catch(async () => {
              await reserve.click({ force: true }).catch(() => {});
            });
            await page.waitForTimeout(1500);
            await page.screenshot({ path: path.join(SHOT_DIR, "3-schedule-open.png") }).catch(() => {});
            report.dateControls = await dumpCandidates(page, "D3. 예약 날짜/시간 컨트롤(예약 선택 후)", [
              "input[class*='input_date']",
              "input[class*='hour']",
              "input[class*='minute']",
              "select[class*='hour']",
              "select[class*='minute']",
              "[class*='date_picker']",
              "[class*='calendar']",
              "[data-click-area*='schedule']",
              ".se-popup-date input",
              "input[type='text'][maxlength]",
            ]);
          } else {
            report.dateControls = "(예약 라디오 미발견)";
          }
        } catch (e) {
          report.dateControls = `(예약 라디오 캡처 실패: ${(e as Error).message})`;
        }

        report.panelButtons = await scanButtonsByText(page, "D2. 발행 레이어 버튼", "[class*='layer'], [class*='popup'], [role='dialog'], body");
      } else {
        console.log("   헤더 발행버튼 미발견 — 레이어 열기 생략");
        report.scheduleControls = "(헤더 발행버튼 미발견)";
      }
    } catch (e) {
      console.log(`   레이어 열기 실패(무시): ${(e as Error).message}`);
      report.panelError = (e as Error).message;
    }

    console.log("\n✅ 점검 완료 — 어떤 발행/제출 버튼도 클릭하지 않았습니다.");
    return report;
  } finally {
    const outFile = path.join(SHOT_DIR, "report.json");
    try {
      fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
      console.log(`📝 리포트 저장: ${outFile}`);
    } catch {}
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("점검 실패:", e);
  process.exit(1);
});
