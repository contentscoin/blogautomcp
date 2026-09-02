import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.join(process.env.APPDATA || "", "brandconnect-automation");
const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
const match = envText.match(/^\s*NAVER_BLOG_ID\s*=\s*["']?([^"'\r\n]+)/m);
if (!match) throw new Error("BLOG_ID_MISSING");
const blogId = match[1].trim();
const sessionPath = path.join(root, "playwright", "storage", "naver-session.json");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ storageState: sessionPath, locale: "ko-KR" });
  const page = await context.newPage();
  const target = process.argv.includes("--bloginfo")
    ? `https://admin.blog.naver.com/${encodeURIComponent(blogId)}/config/bloginfo`
    : process.argv.includes("--skin")
      ? `https://admin.blog.naver.com/${encodeURIComponent(blogId)}/skin/list`
      : `https://admin.blog.naver.com/${encodeURIComponent(blogId)}`;
  await page.goto(target, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(2_500);
  if (process.argv.includes("--frame-only")) {
    const frame = page.frames().find((item) => /AdminUserBasic\.naver/i.test(item.url()));
    if (!frame) throw new Error("BLOG_INFO_FRAME_NOT_FOUND");
    const fields = await frame.evaluate(() => [...document.querySelectorAll("input, textarea, select")].map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { tag: element.tagName.toLowerCase(), type: element.getAttribute("type") || "", id: element.id || "", name: element.getAttribute("name") || "", maxLength: element.getAttribute("maxlength") || "", visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" };
    }).filter((item) => item.visible));
    console.log(JSON.stringify({ frame: frame.url().replaceAll(blogId, "{BLOG_ID}"), fields }));
    await context.close();
    process.exit(0);
  }
  if (process.argv.includes("--screenshot")) {
    const screenshotPath = path.join(process.cwd(), "out", "qa-naver-blog-admin.png");
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
  const data = await page.evaluate(() => ({
    title: document.title,
    links: [...document.querySelectorAll("a")]
      .map((anchor) => ({
        text: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
        href: anchor.getAttribute("href") || "",
      }))
      .filter((item) => /(프로필|기본 정보|스킨|레이아웃|꾸미기|디자인|카테고리)/.test(item.text) || /\/(?:config|skin)\/|LayoutSelect|Remocon/i.test(item.href))
      .slice(0, 100),
    fields: [...document.querySelectorAll("input, textarea, select")].map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute("type") || "",
      name: element.getAttribute("name") || "",
      id: element.id || "",
      placeholder: element.getAttribute("placeholder") || "",
      maxLength: element.getAttribute("maxlength") || "",
    })),
    buttons: [...document.querySelectorAll("button, input[type=submit], input[type=button]")]
      .map((element) => (element.textContent || element.getAttribute("value") || "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  }));
  const frameFields = [];
  for (const frame of page.frames().filter((item) => /AdminUserBasic\.naver/i.test(item.url()))) {
    const fields = await frame.locator("input, textarea, select").evaluateAll((elements) => elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => ({ tag: element.tagName.toLowerCase(), type: element.getAttribute("type") || "", id: element.id || "", name: element.getAttribute("name") || "", maxLength: element.getAttribute("maxlength") || "" })));
    if (fields.length) frameFields.push({ url: frame.url().replaceAll(blogId, "{BLOG_ID}"), fields });
  }
  console.log(JSON.stringify({
    title: data.title,
    frames: page.frames().map((frame) => frame.url().replaceAll(blogId, "{BLOG_ID}")),
    frameFields,
    links: data.links.map((item) => ({
      text: item.text,
      href: item.href.replaceAll(blogId, "{BLOG_ID}"),
    })),
    fields: data.fields,
    buttons: data.buttons,
  }));
  await context.close();
} finally {
  await browser.close();
}
