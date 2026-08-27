import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireTrustedLocalMutation } from "@/lib/local-request-auth";

export const runtime = "nodejs";

interface ShapeNode {
  path: string;
  type: "array" | "object";
  length?: number;
  keys?: string[];
}

interface ResponseProfile {
  endpoint: string;
  status: number;
  shapes: ShapeNode[];
}

function sessionPath(): string {
  const configured = process.env.NAVER_STORAGE_STATE_PATH?.trim();
  if (configured) return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  const storageDir = process.env.SESSION_STORAGE_DIR?.trim();
  return storageDir
    ? path.join(storageDir, "naver-session.json")
    : path.join(process.cwd(), "playwright", "storage", "naver-session.json");
}

function validTravelUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "brandconnect.naver.com") return null;
    if (!/^\/\d+(?:\/|$)/.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

function isBrandConnectResponseHost(hostname: string): boolean {
  return (
    hostname === "brandconnect.naver.com" ||
    hostname === "gw-brandconnect.naver.com" ||
    hostname.endsWith(".brandconnect.naver.com")
  );
}

function collectShapes(value: unknown, currentPath = "$", depth = 0, output: ShapeNode[] = []): ShapeNode[] {
  if (depth > 6 || output.length >= 120 || value === null) return output;
  if (Array.isArray(value)) {
    output.push({ path: currentPath, type: "array", length: value.length });
    for (const item of value.slice(0, 3)) collectShapes(item, `${currentPath}[]`, depth + 1, output);
    return output;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).slice(0, 80).sort();
    output.push({ path: currentPath, type: "object", keys });
    for (const key of keys.slice(0, 30)) collectShapes(record[key], `${currentPath}.${key}`, depth + 1, output);
  }
  return output;
}

function captureFileName(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

export async function POST(request: NextRequest) {
  const untrusted = requireTrustedLocalMutation(request);
  if (untrusted) return untrusted;
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;

  let body: { categoryUrl?: string };
  try { body = await request.json(); } catch { body = {}; }
  const configuredTarget = validTravelUrl(body.categoryUrl?.trim() || process.env.BRANDCONNECT_TRAVEL_CATEGORY_URL?.trim() || "");

  const storageState = sessionPath();
  if (!fs.existsSync(storageState)) return NextResponse.json({ success: false, error: "네이버 로그인 세션이 없습니다. 먼저 네이버 로그인을 완료하세요." }, { status: 400 });

  const profiles: ResponseProfile[] = [];
  const pending: Promise<void>[] = [];
  let finalUrl = configuredTarget?.toString() || "https://brandconnect.naver.com/";
  // Keep Playwright out of the webpack server bundle. The desktop package ships
  // it as a runtime dependency and loads it only when capture is requested.
  const { chromium } = await import("playwright");
  try {
    const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL?.trim() || undefined,
      // BrandConnect currently stalls headless Chrome before the first
      // response. A temporary normal Chrome window preserves the authenticated
      // session and allows the Travel Connect route to be discovered.
      headless: process.env.BRANDCONNECT_CAPTURE_HEADLESS?.trim().toLowerCase() === "true",
    });
    try {
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();
      page.on("response", (response) => {
        const task = (async () => {
          if (profiles.length >= 80) return;
          const url = new URL(response.url());
          if (!isBrandConnectResponseHost(url.hostname)) return;
          if (!(response.headers()["content-type"] || "").toLowerCase().includes("json")) return;
          const contentLength = Number(response.headers()["content-length"] || "0");
          if (contentLength > 2_000_000) return;
          const payload = await response.json().catch(() => null);
          if (payload === null) return;
          profiles.push({ endpoint: `${url.origin}${url.pathname}`, status: response.status(), shapes: collectShapes(payload) });
        })();
        pending.push(task);
      });

      const startUrl = configuredTarget?.toString() || "https://brandconnect.naver.com/";
      await page.goto(startUrl, { waitUntil: "commit", timeout: 45_000 });
      if (!configuredTarget) {
        await page.waitForTimeout(2_000);
        const travelHref = await page.locator("a").evaluateAll((anchors) => {
          const match = anchors.find((anchor) => {
            const text = (anchor.textContent || "").toLowerCase();
            const href = (anchor.getAttribute("href") || "").toLowerCase();
            return text.includes("여행") || text.includes("travel") || href.includes("travel");
          });
          return match?.getAttribute("href") || null;
        }).catch(() => null);
        if (travelHref) {
          await page.goto(new URL(travelHref, page.url()).toString(), { waitUntil: "commit", timeout: 45_000 });
        }
      }
      await page.waitForTimeout(4_000);
      for (let index = 0; index < 4; index += 1) {
        await page.mouse.wheel(0, 1400);
        await page.waitForTimeout(750);
      }
      await Promise.allSettled(pending);

      finalUrl = page.url();
      const visibleText = await page.locator("body").innerText().catch(() => "");
      if (/nidlogin|login\.naver/i.test(finalUrl) || (/로그인/.test(visibleText) && profiles.length === 0)) {
        return NextResponse.json({ success: false, error: "네이버 또는 브랜드커넥트 로그인이 만료되었습니다." }, { status: 401 });
      }
    } finally {
      await browser.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `여행커넥트 자동 캡처에 실패했습니다: ${message}` },
      { status: 502 },
    );
  }

  const uniqueProfiles = Array.from(new Map(profiles.map((profile) => [`${profile.endpoint}:${JSON.stringify(profile.shapes)}`, profile])).values());
  const outputDir = path.join(process.cwd(), "logs", "travel-contract");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${captureFileName(new Date())}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({ capturedAt: new Date().toISOString(), sourcePath: new URL(finalUrl).pathname, responses: uniqueProfiles }, null, 2), "utf8");

  return NextResponse.json({
    success: true,
    data: {
      responseProfiles: uniqueProfiles.length,
      logFile: path.relative(process.cwd(), outputPath),
      rawPayloadStored: false,
      message: uniqueProfiles.length
        ? "개인 데이터 원문 없이 여행커넥트 응답 구조를 캡처했습니다. 이 결과로 전용 어댑터를 확정할 수 있습니다."
        : "JSON 응답을 찾지 못했습니다. URL과 로그인 상태를 확인하세요.",
    },
  });
}
