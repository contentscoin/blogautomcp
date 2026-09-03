import type { Page } from "playwright";

/**
 * 숨은 창(--start-minimized --window-position=-32000,-32000)을 화면 안으로 옮긴다.
 * 로그인 스크립트와 초안 이동 마지막 시도가 함께 쓴다: 사용자가 보안 확인이나 로그인 화면을
 * 직접 볼 수 있어야 막힌 상태를 풀 수 있다.
 */
export async function revealChatGptBrowserWindow(page: Page): Promise<void> {
  await page.bringToFront().catch(() => {});
  const cdp = await page.context().newCDPSession(page).catch(() => null);
  if (!cdp) return;

  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal" },
    });
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { left: 80, top: 80, width: 1440, height: 960 },
    });
    await page.bringToFront().catch(() => {});
  } catch {
    // Chrome 채널/OS가 창 제어를 지원하지 않아도 나머지 흐름은 계속 진행합니다.
  } finally {
    await cdp.detach().catch(() => {});
  }
}
