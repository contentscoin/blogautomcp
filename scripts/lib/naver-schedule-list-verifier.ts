import type { Locator, Page } from "playwright";

export interface ReservedPostListEvidence {
  reservationId: string;
  scheduledDate: string;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scheduleListEntryMatches(
  itemText: string,
  expectedTitle: string,
  targetYmd: string,
  expectedTimeLabel?: string | null
): boolean {
  const text = compact(itemText);
  const title = compact(expectedTitle);
  if (!title || !text.includes(title)) return false;
  const [year, month, day] = targetYmd.split("-");
  if (!year || !month || !day) return false;
  const datePattern = new RegExp(
    `${escapeRegExp(year)}(?:\\.|-|/|년\\s*)0?${Number(month)}(?:\\.|-|/|월\\s*)0?${Number(day)}(?:일)?`
  );
  if (!datePattern.test(text)) return false;
  return !expectedTimeLabel || text.includes(expectedTimeLabel);
}

export function reservationIdFromPrePostReadUrl(value: string, expectedBlogId: string): string | null {
  try {
    const url = new URL(value);
    if (!/(^|\.)naver\.com$/i.test(url.hostname) || url.pathname !== "/RabbitPrePostRead.naver") return null;
    const blogId = url.searchParams.get("blogId") || "";
    const logNo = url.searchParams.get("logNo") || "";
    if (blogId.toLowerCase() !== expectedBlogId.toLowerCase() || !/^[1-9]\d*$/.test(logNo)) return null;
    return logNo;
  } catch {
    return null;
  }
}

async function closeHelpPanel(page: Page): Promise<void> {
  const closeSelectors = [
    '.help_layer button[class*="close"]',
    '.guide_layer button[class*="close"]',
    '[class*="close_btn"]',
    '[class*="closeBtn"]',
    'button[aria-label="닫기"]',
    '.se-help-panel-close-button',
  ];
  for (const selector of closeSelectors) {
    const buttons = page.locator(selector);
    const count = Math.min(await buttons.count().catch(() => 0), 10);
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      if (await button.isVisible().catch(() => false)) await button.click({ force: true }).catch(() => {});
    }
  }
}

/**
 * RabbitWrite can navigate before Chromium exposes its response body. Verify
 * the server-backed reservation list by exact title/date/time and recover the
 * numeric logNo from the request that opens the matching reservation.
 */
export async function verifyReservedPostInNaverList(
  page: Page,
  options: {
    blogId: string;
    expectedTitle: string;
    targetYmd: string;
    expectedTimeLabel?: string | null;
    timeoutMs?: number;
  }
): Promise<ReservedPostListEvidence | null> {
  const { blogId, expectedTitle, targetYmd, expectedTimeLabel } = options;
  if (!blogId || !expectedTitle) return null;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const verificationPage = await page.context().newPage();
  try {
    await verificationPage.goto(
      `https://blog.naver.com/PostWriteForm.naver?blogId=${encodeURIComponent(blogId)}`,
      { waitUntil: "domcontentloaded", timeout: timeoutMs }
    );
    await verificationPage.waitForTimeout(1_500);
    await closeHelpPanel(verificationPage);
    const reserveButton = verificationPage.locator("button").filter({ hasText: /예약 발행\s*\d+건/ }).first();
    await reserveButton.waitFor({ state: "visible", timeout: Math.min(timeoutMs, 15_000) });
    await reserveButton.click({ force: true });

    const titleNodes = verificationPage.getByText(expectedTitle, { exact: true });
    await titleNodes.first().waitFor({ state: "visible", timeout: Math.min(timeoutMs, 15_000) });
    const titleCount = Math.min(await titleNodes.count().catch(() => 0), 20);
    const matchingButtons: Locator[] = [];
    for (let index = 0; index < titleCount; index += 1) {
      const titleNode = titleNodes.nth(index);
      if (!(await titleNode.isVisible().catch(() => false))) continue;
      const itemButton = titleNode.locator("xpath=ancestor::button[1]");
      const itemText = await itemButton.innerText().catch(() => "");
      if (scheduleListEntryMatches(itemText, expectedTitle, targetYmd, expectedTimeLabel)) matchingButtons.push(itemButton);
    }
    if (matchingButtons.length !== 1) return null;

    const readRequest = verificationPage.waitForRequest(
      (request) => Boolean(reservationIdFromPrePostReadUrl(request.url(), blogId)),
      { timeout: Math.min(timeoutMs, 15_000) }
    );
    await matchingButtons[0].click({ force: true });
    const reservationId = reservationIdFromPrePostReadUrl((await readRequest).url(), blogId);
    return reservationId ? { reservationId, scheduledDate: targetYmd } : null;
  } catch {
    return null;
  } finally {
    await verificationPage.close().catch(() => {});
  }
}
