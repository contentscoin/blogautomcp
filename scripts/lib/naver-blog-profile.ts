import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getAppDataDir, getEnvFilePath, getNaverSessionFile } from "./app-paths";

export interface NaverBlogProfileSnapshot {
  blogId: string;
  nickname: string;
  blogName: string;
  introduction: string;
  adminUrl: string;
  skinUrl: string;
  layoutUrl: string;
  detailDesignUrl: string;
  capturedAt: string;
  screenshotPath: string;
}

export interface NaverBlogProfileChanges {
  nickname?: string;
  blogName?: string;
  introduction?: string;
}

function readBlogId(): string {
  const configured = process.env.NAVER_BLOG_ID?.trim();
  if (configured) return configured;
  const envPath = getEnvFilePath();
  if (!fs.existsSync(envPath)) throw new Error("NAVER_BLOG_ID가 설정되어 있지 않습니다.");
  const text = fs.readFileSync(envPath, "utf8");
  const match = text.match(/^\s*NAVER_BLOG_ID\s*=\s*["']?([^"'\r\n]+)/m);
  const blogId = match?.[1]?.trim() || "";
  if (!blogId) throw new Error("NAVER_BLOG_ID가 설정되어 있지 않습니다.");
  if (!/^[A-Za-z0-9._-]{2,50}$/.test(blogId)) throw new Error("NAVER_BLOG_ID 형식을 확인하세요.");
  return blogId;
}

function validateChanges(changes: NaverBlogProfileChanges): NaverBlogProfileChanges {
  const desired: NaverBlogProfileChanges = {};
  if (changes.nickname !== undefined) {
    const nickname = changes.nickname.replace(/\s+/g, " ").trim();
    if (!nickname || nickname.length > 20) throw new Error("별명은 1~20자로 입력하세요.");
    desired.nickname = nickname;
  }
  if (changes.blogName !== undefined) {
    const blogName = changes.blogName.replace(/\s+/g, " ").trim();
    if (!blogName || blogName.length > 50) throw new Error("블로그명은 1~50자로 입력하세요.");
    desired.blogName = blogName;
  }
  if (changes.introduction !== undefined) {
    const introduction = changes.introduction.replace(/\r\n/g, "\n").trim();
    if (introduction.length > 200) throw new Error("소개글은 200자 이하여야 합니다.");
    desired.introduction = introduction;
  }
  if (Object.keys(desired).length === 0) throw new Error("변경할 프로필 항목이 없습니다.");
  return desired;
}

async function openAdminContext(): Promise<{ context: BrowserContext; page: Page; blogId: string }> {
  const sessionPath = getNaverSessionFile();
  if (!fs.existsSync(sessionPath)) throw new Error("저장된 네이버 로그인 세션이 없습니다. 네이버 재로그인을 먼저 실행하세요.");
  const blogId = readBlogId();
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL?.trim() || "chrome", headless: true });
  const context = await browser.newContext({ storageState: sessionPath, locale: "ko-KR", viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  return { context, page, blogId };
}

async function waitForBlogInfoFrame(page: Page) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const contentFrame = page.frames().find((frame) => /AdminUserBasic\.naver/i.test(frame.url()));
    if (contentFrame) return contentFrame;
    await page.waitForTimeout(250);
  }
  throw new Error("네이버 블로그 정보 화면 구조를 확인할 수 없습니다.");
}

async function readSnapshot(page: Page, blogId: string, screenshotLabel: string): Promise<NaverBlogProfileSnapshot> {
  const adminUrl = `https://admin.blog.naver.com/${encodeURIComponent(blogId)}/config/bloginfo`;
  if (!page.url().includes("/config/bloginfo")) {
    await page.goto(adminUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
  }
  if (!page.url().startsWith("https://admin.blog.naver.com/")) throw new Error("네이버 블로그 관리 권한을 확인할 수 없습니다.");
  const contentFrame = await waitForBlogInfoFrame(page);
  const textInputs = contentFrame.locator('input[type="text"]:visible');
  await textInputs.first().waitFor({ state: "visible", timeout: 20_000 });
  if (await textInputs.count() < 2) throw new Error("네이버 블로그명·별명 입력 항목을 확인할 수 없습니다.");
  const blogName = await textInputs.nth(0).inputValue();
  const nickname = await textInputs.nth(1).inputValue();
  const introductionField = contentFrame.locator("textarea:visible").first();
  const introduction = await introductionField.count() ? await introductionField.inputValue() : "";
  const snapshotDir = path.join(getAppDataDir(), "naver-blog-settings-backups");
  fs.mkdirSync(snapshotDir, { recursive: true });
  const screenshotPath = path.join(snapshotDir, `${screenshotLabel}-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return {
    blogId,
    nickname,
    blogName,
    introduction,
    adminUrl,
    skinUrl: `https://admin.blog.naver.com/${encodeURIComponent(blogId)}/skin/list`,
    layoutUrl: `https://admin.blog.naver.com/LayoutSelect.naver?blogId=${encodeURIComponent(blogId)}`,
    detailDesignUrl: `https://admin.blog.naver.com/Remocon.naver?blogId=${encodeURIComponent(blogId)}&loadType=admin&Redirect=Remocon`,
    capturedAt: new Date().toISOString(),
    screenshotPath,
  };
}

export async function inspectNaverBlogProfile(): Promise<NaverBlogProfileSnapshot> {
  const { context, page, blogId } = await openAdminContext();
  try {
    return await readSnapshot(page, blogId, "profile-inspect");
  } finally {
    await context.browser()?.close().catch(() => undefined);
  }
}

export async function applyNaverBlogProfile(
  changes: NaverBlogProfileChanges,
  expected: Pick<NaverBlogProfileSnapshot, "nickname" | "blogName" | "introduction">,
): Promise<{ before: NaverBlogProfileSnapshot; after: NaverBlogProfileSnapshot }> {
  const desired = validateChanges(changes);
  const { context, page, blogId } = await openAdminContext();
  try {
    const before = await readSnapshot(page, blogId, "profile-before");
    if (before.nickname !== expected.nickname || before.blogName !== expected.blogName || before.introduction !== expected.introduction) {
      throw new Error("프로필이 미리보기 이후 변경되었습니다. 현재 상태를 다시 확인해 주세요.");
    }
    const contentFrame = await waitForBlogInfoFrame(page);
    const textInputs = contentFrame.locator('input[type="text"]:visible');
    let basicChanged = false;
    if (desired.nickname !== undefined && desired.nickname !== before.nickname) {
      await textInputs.nth(1).fill(desired.nickname);
      basicChanged = true;
    }
    if (desired.blogName !== undefined && desired.blogName !== before.blogName) {
      await textInputs.nth(0).fill(desired.blogName);
      basicChanged = true;
    }
    if (desired.introduction !== undefined && desired.introduction !== before.introduction) {
      await contentFrame.locator("textarea:visible").first().fill(desired.introduction);
      basicChanged = true;
    }
    if (basicChanged) {
      const submit = contentFrame.locator('input[type="submit"]:visible, button:visible').filter({ hasText: "확인" }).first();
      if (await submit.count()) await submit.click();
      else await contentFrame.locator('input[type="submit"]:visible').last().click();
      await page.waitForTimeout(1_500);
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    const after = await readSnapshot(page, blogId, "profile-after");
    if (desired.nickname !== undefined && after.nickname !== desired.nickname) throw new Error("별명 저장 결과가 요청과 일치하지 않습니다.");
    if (desired.blogName !== undefined && after.blogName !== desired.blogName) throw new Error("블로그명 저장 결과가 요청과 일치하지 않습니다.");
    if (desired.introduction !== undefined && after.introduction !== desired.introduction) throw new Error("소개글 저장 결과가 요청과 일치하지 않습니다.");
    return { before, after };
  } finally {
    await context.browser()?.close().catch(() => undefined);
  }
}

export { validateChanges as validateNaverBlogProfileChanges };
