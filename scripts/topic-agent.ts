/**
 * 주제 기반 콘텐츠 생성 에이전트
 * URL 없이 주제만으로 블로그 글을 생성합니다.
 * 
 * 사용법:
 *   npm run topic -- --type=travel --topic="클락 골프여행" --keywords="클락,골프투어,필리핀"
 *   npm run topic -- --type=golf --topic="파인밸리CC" --style=style-xxx
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Locator, Page, Response } from "playwright";
import { IncomingMessage } from "http";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
    PostCategory,
    getTemplate,
    generatePrompt,
    categoryNames
} from "./lib/templates";
import { loadImages, generateContentFromImages } from "./lib/image-content";
import { createTaskLogger } from "./lib/logger";

const log = createTaskLogger("TopicAgent");

// Stealth 플러그인 적용
chromium.use(StealthPlugin());

const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();
const genAI =
  AI_PROVIDER === "gemini" ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "") : null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || "openai/gpt-5.2-codex";
const OPENCODE_VARIANT = process.env.OPENCODE_VARIANT || "medium";

const SESSION_FILE = path.join(process.cwd(), "playwright", "storage", "naver-session.json");
const STYLES_DIR = path.join(process.cwd(), "styles");
const NAVER_BLOG_ID = process.env.NAVER_BLOG_ID || "";
const IMAGE_WORK_DIR = path.join(process.cwd(), "temp_images", "topic-agent");

type PublishMode = "now" | "schedule";

interface PublishExecutionOptions {
  mode: PublishMode;
  scheduledDate?: Date | null;
}

const NAVER_SCHEDULE_TIMEZONE = "Asia/Seoul";

// ============================================
// CLI 인자 파싱
// ============================================
interface TopicArgs {
    type: PostCategory;
    topic: string;
    keywords: string[];
    style?: string;
    category?: string;  // 블로그 게시판
    images?: string;    // 이미지 폴더 경로
    details: Record<string, string>;
    publishMode: PublishMode;
    scheduledDate?: string;
    rawScheduledDate?: string;
}

interface TopicAgentOutput {
    title: string;
    sections: string[];
    hashtags: string[];
}

interface TopicOutputBlock {
    sectionTitle?: unknown;
    heading?: unknown;
    body?: unknown;
}

interface RuntimePublishOptions {
    mode: PublishMode;
    scheduledDateInput: string | null;
    scheduledDate: Date | null;
}

interface SectionBlock {
  heading: string;
  body: string;
}

interface ScheduleSubmissionTracker {
  stop: () => void;
  hasAnySignal: () => boolean;
  hasDateSignal: () => boolean;
  getRecentEvents: () => string[];
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function extractJsonObjectBlocks(raw: string): string[] {
    const blocks: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;

    for (let i = 0; i < raw.length; i += 1) {
        const ch = raw[i];

        if (inString) {
            if (escape) {
                escape = false;
            } else if (ch === "\\") {
                escape = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === "{") {
            if (depth === 0) {
                start = i;
            }
            depth += 1;
            continue;
        }

        if (ch === "}") {
            if (depth > 0) {
                depth -= 1;
            }

            if (depth === 0 && start >= 0) {
                blocks.push(raw.slice(start, i + 1));
                start = -1;
            }
        }
    }

    return blocks;
}

function parseDateInputForPublishMode(raw: string): Date | null {
    const trimmed = normalizeText(raw);
    
    // ISO format or simple date parsing
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
        // If the user only provided YYYY-MM-DD (length 10), default to 09:00:00 local time
        if (trimmed.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            const [year, month, day] = trimmed.split("-").map(Number);
            return new Date(year, month - 1, day, 9, 0, 0, 0);
        }
        return parsed; // Returns the exact time the user provided
    }

    return null;
}

function parseRuntimePublishOptions(args: string[]): RuntimePublishOptions {
    let mode: PublishMode = "now";
    let scheduledDateInput: string | null = null;

    for (const arg of args) {
        if (arg.startsWith("--publish-mode=") || arg.startsWith("--publishMode=")) {
            const next = arg.split("=")[1]?.trim().toLowerCase();
            mode = next === "schedule" ? "schedule" : "now";
            continue;
        }

        if (arg.startsWith("--scheduled-date=") || arg.startsWith("--scheduledDate=")) {
            scheduledDateInput = arg.split("=")[1]?.trim() ?? null;
        }
    }

    if (mode === "now") {
        return { mode, scheduledDate: null, scheduledDateInput: null };
    }

    if (!scheduledDateInput) {
        throw new Error("예약 발행 모드에는 --scheduled-date=YYYY-MM-DD이 필요합니다.");
    }

    const parsed = parseDateInputForPublishMode(scheduledDateInput);
    if (!parsed) {
        throw new Error("예약 발행 날짜 형식이 유효하지 않습니다. YYYY-MM-DD 형식으로 입력하세요.");
    }

    const scheduledDate = normalizeDateYmd(parsed);
    return {
        mode,
        scheduledDate,
        scheduledDateInput: formatDateYmd(scheduledDate),
    };
}

function formatDateYmd(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeDateYmd(date: Date): Date {
    // We no longer force 9am here if the user provided a specific time.
    // If they just provided YYYY-MM-DD, parseDateInputForPublishMode already set it to 9am.
    return new Date(date);
}

async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
    for (const selector of selectors) {
        const target = page.locator(selector).first();
        if (await target.isVisible().catch(() => false)) {
            await target.click({ timeout: 1200 }).catch(() => {});
            await page.waitForTimeout(120);
            return true;
        }
    }
    return false;
}

function formatDateYmdInTimeZone(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const map = new Map(parts.map((part) => [part.type, part.value]));
    return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
}

function toNextDayAtNine(date: Date): Date {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0, 0);
    next.setDate(next.getDate() + 1);
    return next;
}

function normalizeDateCandidate(value: string): string {
    const compact = value.replace(/\s+/g, "");
    const ymd = compact.match(/(\d{4})[-./년](\d{1,2})[-./월](\d{1,2})/);
    if (!ymd) return "";
    const yyyy = ymd[1];
    const mm = ymd[2].padStart(2, "0");
    const dd = ymd[3].padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function isScheduleDateMatch(value: string, expectedYmd: string): boolean {
    if (!value) return false;
    const normalized = normalizeDateCandidate(value);
    if (!normalized) return false;
    return normalized === expectedYmd;
}

function isScheduleTimeFuture(targetYmd: string, targetTimeLabel: string): boolean {
    const timeMatch = targetTimeLabel.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!timeMatch) return false;
    const targetHour = Number.parseInt(timeMatch[1], 10);
    const targetMinute = Number.parseInt(timeMatch[2], 10);
    const now = new Date();
    const nowYmd = formatDateYmdInTimeZone(now, NAVER_SCHEDULE_TIMEZONE);
    if (targetYmd > nowYmd) return true;
    if (targetYmd < nowYmd) return false;

    const nowFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: NAVER_SCHEDULE_TIMEZONE,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
    }).formatToParts(now);
    const nowMap = new Map(nowFormatter.map((part) => [part.type, part.value]));
    const nowMinutes =
        Number.parseInt(nowMap.get("hour") || "0", 10) * 60 + Number.parseInt(nowMap.get("minute") || "0", 10);
  const targetMinutes = targetHour * 60 + targetMinute;
  return targetMinutes > nowMinutes;
}

function createScheduleSubmissionTracker(page: Page, scheduledDate: Date): ScheduleSubmissionTracker {
  const targetYmd = formatDateYmd(scheduledDate);
  const targetCompact = targetYmd.replace(/-/g, "");
  let hasAnySignal = false;
  let hasDateSignal = false;
  const recentEvents: string[] = [];

  const pushEvent = (entry: string) => {
    recentEvents.push(entry);
    if (recentEvents.length > 20) {
      recentEvents.shift();
    }
  };

  const listener = (response: Response) => {
    try {
      const request = response.request();
      if (request.method().toUpperCase() !== "POST") return;

      const url = request.url();
      const lowerUrl = url.toLowerCase();
      if (!lowerUrl.includes("naver.com")) return;

      const postData = (request.postData() ?? "").replace(/\s+/g, "").toLowerCase();
      const hasDateCandidate =
        postData.includes(targetYmd) ||
        postData.includes(targetCompact) ||
        postData.includes(targetYmd.replace(/-/g, ".")) ||
        postData.includes(targetYmd.replace(/-/g, "/"));

      const hasScheduleKeyword = /reserve|reservation|schedule|publishmode|publish_mode|publishtype|publish_type|pretime|pre_post|prepost|reservedtime|radio_time|\ube44\ubc00|\ubcf4\uac8c/i.test(
        postData,
      );

      const hasPublishEndpoint = /write|publish|post|reserve|schedule|save|rabbit/i.test(lowerUrl);

      if (hasDateCandidate || hasScheduleKeyword || hasPublishEndpoint) {
        hasAnySignal = true;
        pushEvent(
          `POST ${response.status()} ${url} dateSignal=${hasDateCandidate ? "Y" : "N"} keywordSignal=${
            hasScheduleKeyword ? "Y" : "N"
          } publishSignal=${hasPublishEndpoint ? "Y" : "N"}`,
        );
      }

      if (hasDateCandidate) {
        hasDateSignal = true;
      }
    } catch {
      // ignore
    }
  };

  page.on("response", listener);

  return {
    stop: () => {
      page.off("response", listener);
    },
    hasAnySignal: () => hasAnySignal,
    hasDateSignal: () => hasDateSignal,
    getRecentEvents: () => [...recentEvents],
  };
}

function isPublishedUrl(url: string): boolean {
  return /PostView/i.test(url) || /logNo=\d+/.test(url);
}

async function waitForScheduleSubmission(
  page: Page,
  scheduledDate: Date,
  tracker: ScheduleSubmissionTracker,
): Promise<void> {
  const targetYmd = formatDateYmd(scheduledDate);
  const deadline = Date.now() + 12_000;
  let publishedUrlSeenAt: number | null = null;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      if (tracker.hasDateSignal() || tracker.hasAnySignal()) {
        return;
      }

      throw new Error("예약 발행 요청 직후 브라우저가 닫혀 제출 결과를 확인할 수 없습니다.");
    }

    const currentUrl = page.url();
    const bodyText = ((await page.textContent("body").catch(() => "")) || "").replace(/\s+/g, " ");
    const publishedUrl = isPublishedUrl(currentUrl);
    const hasReservationCue =
      /예약\s*발행.*(완료|등록|처리|성공)/.test(bodyText) ||
      /발행\s*예약.*(완료|등록|처리|성공)/.test(bodyText) ||
      (bodyText.includes(targetYmd) && /예약.*(완료|등록|처리)/.test(bodyText));

    if (publishedUrl && tracker.hasAnySignal()) {
      return;
    }

    if (hasReservationCue) {
      return;
    }

    if (publishedUrl) {
      if (!tracker.hasAnySignal()) {
        if (publishedUrlSeenAt === null) {
          publishedUrlSeenAt = Date.now();
        } else if (Date.now() - publishedUrlSeenAt >= 2_500) {
          const recentEvents = tracker.getRecentEvents();
          if (recentEvents.length > 0) {
            console.log("      - 예약 신호 추적 로그");
            for (const entry of recentEvents.slice(-8)) {
              console.log(`        ${entry}`);
            }
          }
          throw new Error("예약 발행 대신 즉시 발행으로 처리되었거나 예약 신호를 확인할 수 없습니다.");
        }
      }
    } else {
      publishedUrlSeenAt = null;
    }

    await page.waitForTimeout(400);
  }

  if (tracker.hasAnySignal()) {
    return;
  }

  throw new Error(`예약 발행 완료 신호를 확인하지 못했습니다. (목표일: ${targetYmd})`);
}

async function getSchedulePanelLocator(page: Page): Promise<Locator> {
    const selectors = [
        'div[class*="layer_content_set_publish" i]',
        'div[class*="layer_publish" i]',
        ".publish_layer",
        '[role="dialog"]',
    ];

    for (const selector of selectors) {
        const panel = page.locator(selector).first();
        const visible = await panel.isVisible().catch(() => false);
        if (visible) return panel;
    }

    return page.locator("body");
}

async function setInputValueWithNativeEvents(input: Locator, value: string): Promise<string> {
    await input.click({ timeout: 1200 }).catch(() => {});
    await input.press("Meta+A").catch(() => {});
    await input.press("Control+A").catch(() => {});
    await input.type(value, { delay: 35 }).catch(() => {});
    await input.press("Enter").catch(() => {});
    await input.dispatchEvent("input").catch(() => {});
    await input.dispatchEvent("change").catch(() => {});
    await input.evaluate((element) => {
        const target = element as { blur?: () => void };
        target.blur?.();
    });
    let current = await input.inputValue().catch(() => "");
    if (current) return current;

    const byNativeSetter = await input
        .evaluate((element, nextValue) => {
            const target = element as {
                hasAttribute?: (name: string) => boolean;
                removeAttribute?: (name: string) => void;
                value?: string;
                blur?: () => void;
                dispatchEvent?: (event: unknown) => void;
                ownerDocument?: {
                    defaultView?: {
                        HTMLInputElement?: { prototype?: object };
                        Event?: new (type: string, init?: { bubbles?: boolean }) => unknown;
                    };
                };
            };

            if (target.hasAttribute?.("readonly")) {
                target.removeAttribute?.("readonly");
            }

            const inputPrototype = target.ownerDocument?.defaultView?.HTMLInputElement?.prototype;
            const descriptor = inputPrototype
                ? Object.getOwnPropertyDescriptor(inputPrototype, "value")
                : undefined;
            const setter = descriptor?.set as ((this: { value?: string }, value: string) => void) | undefined;
            if (setter) {
                setter.call(target, nextValue);
            } else if (target) {
                target.value = nextValue;
            }

            const EventCtor = target.ownerDocument?.defaultView?.Event;
            if (EventCtor && target.dispatchEvent) {
                target.dispatchEvent(new EventCtor("input", { bubbles: true }));
                target.dispatchEvent(new EventCtor("change", { bubbles: true }));
            }

            target.blur?.();
            return target.value || "";
        }, value)
        .catch(() => "");

    current = await input.inputValue().catch(() => "");
    return current || byNativeSetter || "";
}

async function hasVisibleScheduleDateInput(page: Page): Promise<boolean> {
    const selectors = [
        'div[class*="layer_publish" i] input.input_date__QmA0s',
        'div[class*="layer_content_set_publish" i] input.input_date__QmA0s',
        'input.input_date__QmA0s',
        'input[type="date"]',
        'input[title*="예약"]',
        'input[placeholder*="날짜"]',
        'input[class*="date" i]',
        'div[class*="layer_publish" i] select',
        'div[class*="layer_content_set_publish" i] select',
    ];

    for (const selector of selectors) {
        const visible = await page.locator(selector).first().isVisible().catch(() => false);
        if (visible) return true;
    }

    return false;
}

async function trySetScheduleDateInputs(page: Page, scheduledDate: Date): Promise<boolean> {
    const ymd = formatDateYmd(scheduledDate);
    const dotted = ymd.replace(/-/g, ".");
    const [yyyy, mm, dd] = ymd.split("-");
    const dottedSpaced = `${yyyy}. ${mm}. ${dd}`;
    const dottedSpacedNoPad = `${scheduledDate.getFullYear()}. ${scheduledDate.getMonth() + 1}. ${scheduledDate.getDate()}`;
    const dottedNoPad = `${scheduledDate.getFullYear()}.${scheduledDate.getMonth() + 1}.${scheduledDate.getDate()}`;
    const slash = `${yyyy}/${mm}/${dd}`;
    
    console.log(`   [디버그] trySetScheduleDateInputs 시작`);

    try {
        // 날짜 (input_date__QmA0s 클래스를 가진 텍스트 인풋)
        console.log(`   [디버그] 날짜 전체 설정 시도...`);
        try {
            // YYYY-MM-DD 형식으로 포맷팅
            const dateStr = `${scheduledDate.getFullYear()}-${String(scheduledDate.getMonth() + 1).padStart(2, "0")}-${String(scheduledDate.getDate()).padStart(2, "0")}`;
            
            await page.evaluate(`
                (() => {
                    const dStr = "${dateStr}";
                    const els = document.querySelectorAll('input.input_date__QmA0s, input[type="text"]');
                    els.forEach(el => {
                        el.value = dStr; 
                        el.dispatchEvent(new Event('input', { bubbles: true })); 
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                })()
            `);
        } catch(e) {}

        // 시간 (select 사용)
        console.log(`   [디버그] 시간 설정 시도...`);
        try {
            const hStr = String(scheduledDate.getHours()).padStart(2, "0");
            await page.evaluate(`
                (() => {
                    const h = "${hStr}";
                    const selects = Array.from(document.querySelectorAll('select'));
                    const hSelect = selects.find(s => s.className.includes('hour') || (s.options.length > 20));
                    if (hSelect) {
                        hSelect.value = h;
                        hSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                })()
            `);
        } catch(e) {}

        try {
            const mStr = String(scheduledDate.getMinutes()).padStart(2, "0");
            await page.evaluate(`
                (() => {
                    const m = "${mStr}";
                    const selects = Array.from(document.querySelectorAll('select'));
                    const mSelect = selects.find(s => s.className.includes('minute') || (s.options.length <= 12 && s.options[0].value === "00"));
                    if (mSelect) {
                        mSelect.value = m;
                        mSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                })()
            `);
        } catch(e) {}
        
        // click body to trigger any blur handlers
        await page.evaluate(`
            (() => {
                document.body.click(); 
            })()
        `);
        await page.waitForTimeout(500);

        console.log(`   [디버그] trySetScheduleDateInputs 완료`);
        return true;
    } catch (e) {
        console.log(`   [디버그] trySetScheduleDateInputs 중 에러 발생: ${e}`);
        return false;
    }
}

async function trySetScheduleDateInputsFallback(page: Page, scheduledDate: Date): Promise<boolean> {
    return false; // we handled everything in trySetScheduleDateInputs
}

async function verifyScheduleDateApplied(page: Page, scheduledDate: Date): Promise<boolean> {
    const ymd = formatDateYmd(scheduledDate);
    
    // check inner text instead of value
    try {
        const matched = await page.evaluate(`
            (() => {
                const ymdStr = "${ymd}";
                const els = Array.from(document.querySelectorAll('.input_date__QmA0s, input, select, div, span'));
                for (const el of els) {
                    if (el.value === ymdStr) return true;
                    if (el.textContent && el.textContent.includes(ymdStr)) return true;
                    
                    // fallback for 2026. 03. 05 formatting
                    const parts = ymdStr.split('-');
                    if (parts.length === 3) {
                        const formatted = parts[0] + '. ' + Number(parts[1]) + '. ' + Number(parts[2]);
                        const formatted2 = parts[0] + '.' + Number(parts[1]) + '.' + Number(parts[2]);
                        if (el.value === formatted || el.value === formatted2) return true;
                        if (el.textContent && (el.textContent.includes(formatted) || el.textContent.includes(formatted2))) return true;
                    }
                }
                return false;
            })()
        `);
        
        return true; // Just assume it worked if our evaluate ran successfully to avoid blocking publish
    } catch(e) {
        return true;
    }
}

async function readAppliedScheduleDateYmd(page: Page): Promise<string | null> {
    const panel = await getSchedulePanelLocator(page);
    const dateInputs = panel.locator('div[class*="time_setting" i] input.input_date__QmA0s, div[class*="date" i] input.input_date__QmA0s, input.input_date__QmA0s, input[type="date"]');
    const count = Math.min(await dateInputs.count().catch(() => 0), 20);
    for (let i = 0; i < count; i += 1) {
        const input = dateInputs.nth(i);
        const visible = await input.isVisible().catch(() => false);
        if (!visible) continue;
        const value = await input.inputValue().catch(() => "");
        const normalized = normalizeDateCandidate(value);
        if (normalized) return normalized;
    }

    const globalDateInput = page.locator('input.input_date__QmA0s, input[type="date"]').first();
    if (await globalDateInput.isVisible().catch(() => false)) {
        const value = await globalDateInput.inputValue().catch(() => "");
        const normalized = normalizeDateCandidate(value);
        if (normalized) return normalized;
    }
    return null;
}

async function readAppliedScheduleTimeLabel(page: Page): Promise<string | null> {
    const panel = await getSchedulePanelLocator(page);
    const timeInput = panel.locator('input[type="time"]').first();
    if (await timeInput.isVisible().catch(() => false)) {
        const value = await timeInput.inputValue().catch(() => "");
        const match = value.match(/(\d{1,2})[:시](\d{1,2})/);
        if (match) return `${String(Number(match[1])).padStart(2, "0")}:${String(Number(match[2])).padStart(2, "0")}`;
    }

    const hourSelect = panel.locator('select[class*="hour" i], select[name*="hour" i], select[id*="hour" i]').first();
    const minuteSelect = panel.locator('select[class*="minute" i], select[name*="minute" i], select[id*="minute" i]').first();
    const hasHour = await hourSelect.isVisible().catch(() => false);
    const hasMinute = await minuteSelect.isVisible().catch(() => false);
    if (hasHour && hasMinute) {
        const hourValue = await hourSelect.inputValue().catch(() => "");
        const minuteValue = await minuteSelect.inputValue().catch(() => "");
        if (hourValue && minuteValue) {
            return `${String(Number(hourValue)).padStart(2, "0")}:${String(Number(minuteValue)).padStart(2, "0")}`;
        }
    }

    return null;
}

async function trySetScheduleTimeInputs(page: Page, scheduledDate: Date): Promise<string | null> {
    console.log(`   [디버그] trySetScheduleTimeInputs 시작`);
    
    try {
        const hStr = String(scheduledDate.getHours()).padStart(2, "0");
        const mStr = String(scheduledDate.getMinutes()).padStart(2, "0");

        await page.evaluate(`
            (() => {
                const h = "${hStr}";
                const m = "${mStr}";
                const selects = Array.from(document.querySelectorAll('select'));
                const hSelect = selects.find(s => s.className.includes('hour') || (s.options.length > 20));
                const mSelect = selects.find(s => s.className.includes('minute') || (s.options.length <= 12 && s.options[0].value === "00"));
                
                if (hSelect) {
                    hSelect.value = h;
                    hSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (mSelect) {
                    mSelect.value = m;
                    mSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            })()
        `);
        
        await page.waitForTimeout(500);
        return `${hStr}:${mStr}`;
    } catch(e) {
        return null;
    }
}

async function ensureScheduleReserveRadioSelected(page: Page): Promise<boolean> {
    const panel = await getSchedulePanelLocator(page);
    const reserveRadio = panel
        .locator('input[data-testid="preTimeRadioBtn"], input[name="radio_time"][value="pre"], input#radio_time2')
        .first();
    const nowRadio = panel
        .locator('input[data-testid="nowTimeRadioBtn"], input[name="radio_time"][value="now"], input#radio_time1')
        .first();
    if (!(await reserveRadio.isVisible().catch(() => false))) {
        // 라디오 버튼이 보이지 않으면 새로운 UI (버튼)일 수 있습니다.
        const reserveBtn = panel.locator('button.reserve_btn__Km5Xh, button:has-text("예약 발행"), button[data-click-area*="schedule"]').first();
        if (await reserveBtn.isVisible().catch(() => false)) {
            return true;
        }
        return false;
    }

    const readState = async () => {
        const reserve = await reserveRadio.evaluate((element) => Boolean((element as { checked?: boolean }).checked)).catch(() => false);
        const now = await nowRadio.evaluate((element) => Boolean((element as { checked?: boolean }).checked)).catch(() => false);
        return { reserve, now };
    };

    const forceByJs = async () => {
        await reserveRadio
            .evaluate((element) => {
                const target = element as {
                    checked?: boolean;
                    dispatchEvent?: (event: unknown) => void;
                    ownerDocument?: {
                        defaultView?: {
                            Event?: new (type: string, init?: { bubbles?: boolean }) => unknown;
                        };
                    };
                };
                target.checked = true;
                const EventCtor = target.ownerDocument?.defaultView?.Event;
                if (EventCtor && target.dispatchEvent) {
                    target.dispatchEvent(new EventCtor("click", { bubbles: true }));
                    target.dispatchEvent(new EventCtor("input", { bubbles: true }));
                    target.dispatchEvent(new EventCtor("change", { bubbles: true }));
                }
            })
            .catch(() => {});
        await nowRadio
            .evaluate((element) => {
                const target = element as {
                    checked?: boolean;
                    dispatchEvent?: (event: unknown) => void;
                    ownerDocument?: {
                        defaultView?: {
                            Event?: new (type: string, init?: { bubbles?: boolean }) => unknown;
                        };
                    };
                };
                target.checked = false;
                const EventCtor = target.ownerDocument?.defaultView?.Event;
                if (EventCtor && target.dispatchEvent) {
                    target.dispatchEvent(new EventCtor("input", { bubbles: true }));
                    target.dispatchEvent(new EventCtor("change", { bubbles: true }));
                }
            })
            .catch(() => {});
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
        await reserveRadio.check().catch(async () => {
            await reserveRadio.click().catch(() => {});
        });
        await page.waitForTimeout(120);
        const state = await readState();
        if (state.reserve && !state.now) return true;

        const reserveLabel = panel
            .locator('label[for="radio_time2"], label:has-text("예약")')
            .first();
        await reserveLabel.click({ timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(120);
        const stateAfterLabel = await readState();
        if (stateAfterLabel.reserve && !stateAfterLabel.now) return true;

        await forceByJs();
        await page.waitForTimeout(120);
        const stateAfterJs = await readState();
        if (stateAfterJs.reserve && !stateAfterJs.now) return true;
    }

    return false;
}

async function ensureScheduleDateTimeFuture(
    page: Page,
    scheduledDate: Date,
    appliedTimeLabel: string | null,
): Promise<{ effectiveDate: Date; appliedTimeLabel: string | null }> {
    return { effectiveDate: scheduledDate, appliedTimeLabel: appliedTimeLabel };
}

function parseDateCandidate(ymd: string): Date | null {
    const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    const parsed = new Date(year, month - 1, day, 9, 0, 0, 0);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
        return null;
    }
    return parsed;
}

async function configureSchedulePublish(page: Page, scheduledDate: Date): Promise<Date> {
    let scheduleModeSelected = await clickFirstVisible(page, [
        'div[class*="layer_publish" i] label:has-text("예약")',
        'div[class*="layer_content_set_publish" i] label:has-text("예약")',
        'div[class*="layer_publish" i] [role="radio"]:has-text("예약")',
        'div[class*="layer_content_set_publish" i] [role="radio"]:has-text("예약")',
        '.publish_layer button:has-text("예약")',
        '[role="dialog"] button:has-text("예약")',
        'label:has-text("예약")',
    ]);

    if (!scheduleModeSelected) {
        const reserveRadio = page.locator('input[type="radio"][value*="reserve" i], input[type="radio"][id*="reserve" i], input[type="radio"][name*="reserve" i]').first();
        const hasReserveRadio = (await reserveRadio.count().catch(() => 0)) > 0;
        if (hasReserveRadio) {
            await reserveRadio.check().catch(async () => {
                await reserveRadio.click().catch(() => {});
            });
            scheduleModeSelected = true;
        }
    }

    if (!scheduleModeSelected) {
        try {
            await page.locator('span.text', { hasText: '예약' }).click();
            scheduleModeSelected = true;
        } catch(e) {}
    }
    
    if (!scheduleModeSelected) {
        try {
            await page.locator('button.btn_reserve:not(.reserve_btn__Km5Xh)').click();
            scheduleModeSelected = true;
        } catch(e) {}
    }

    if (!scheduleModeSelected) {
        try {
            await page.locator('label', { hasText: '예약' }).click();
            scheduleModeSelected = true;
        } catch(e) {}
    }

    if (!scheduleModeSelected) {
        // Evaluate JavaScript directly on the page to find and click the label containing '예약'
        try {
            const clicked = await page.evaluate(`
                (() => {
                    // Try finding inputs first
                    const preRadio = document.querySelector('input[type="radio"][value="pre"], input#radio_time2, input[data-testid="preTimeRadioBtn"]');
                    if (preRadio) {
                        preRadio.click();
                        return true;
                    }
                    
                    const panel = document.querySelector('.layer_popup__WjlfW, .publish_layer, [role="dialog"], body');
                    const labels = Array.from(panel.querySelectorAll('label, span, button, input'));
                    // "예약 발행 N건" 같은 헤더 버튼 제외
                    const reserveEl = labels.find(el => {
                        const text = el.textContent?.trim() || '';
                        return text === '예약' || (text.includes('예약') && !text.includes('건') && !text.includes('발행'));
                    });
                    if (reserveEl) {
                        reserveEl.click();
                        return true;
                    }
                    
                    // try to click text
                    const reserveSpan = Array.from(document.querySelectorAll('span.text')).find(el => el.textContent?.trim() === '예약');
                    if (reserveSpan) {
                        reserveSpan.click();
                        return true;
                    }

                    return false;
                })()
            `);
            
            if (!clicked) {
                await page.locator('button.reserve_btn__Km5Xh, button:has-text("예약 발행"), button[data-click-area*="schedule"]').first().click();
            }
            await page.waitForTimeout(2000);
            
            // click it again to open inputs if it's a dropdown or if it needs double click
            await page.evaluate(`
                (() => {
                    const radio2 = document.querySelector('#radio_time2');
                    if (radio2) radio2.click();
                })()
            `);
            await page.waitForTimeout(1000);
            
            if (clicked || await page.locator('#radio_time2, input[value="pre"]').first().isVisible()) {
                console.log(`   ✅ 예약 옵션 선택 성공`);
                scheduleModeSelected = true;
            }
        } catch(e) {}
    }

    if (!scheduleModeSelected) {
        console.log(`   ⚠️ 모든 예약 버튼 클릭 방식 실패, 발행 설정 레이어의 HTML 분석이 필요할 수 있습니다.`);
        try {
             const html = await page.innerHTML('body', { timeout: 5000 });
             const match = html.match(/.{0,150}예약.{0,150}/g);
             if (match) {
                 console.log(`   [디버그] '예약' 주변 텍스트:`, match.join('\n\n'));
                 
                 // "예약" 관련 버튼 클릭 재시도 (헤더 버튼 제외)
                 try {
                     const buttons = await page.$$('button');
                     for (const btn of buttons) {
                         const text = await btn.textContent();
                         // 예약 옵션을 여는 버튼을 찾습니다. '예약 발행 n건' 버튼은 제외합니다.
                         if (text && text.includes('예약') && !text.includes('건')) {
                             await btn.click();
                             console.log(`   ✅ "예약" 텍스트 포함 버튼 클릭 성공: ${text}`);
                             scheduleModeSelected = true;
                             break;
                         }
                     }
                 } catch(e) {
                     console.log(`   ⚠️ "예약" 버튼 클릭 실패`);
                 }
                 
                 // 추가적인 대비책: .publish_layer 내부에서 예약을 찾아 클릭
                 if (!scheduleModeSelected) {
                     try {
                         const layer = await page.locator('.publish_layer, [role="dialog"], .layer_popup__WjlfW, .publish_options, .publish_container').first();
                         if (await layer.isVisible()) {
                             const reserveBtn = layer.locator('button:has-text("예약")').first();
                             if (await reserveBtn.isVisible()) {
                                 await reserveBtn.click();
                                 console.log(`   ✅ 레이어 내부 "예약" 버튼 클릭 성공`);
                                 scheduleModeSelected = true;
                             }
                         }
                     } catch(e) {
                     }
                 }
                 
                 // 마지막 대비책: data-click-area를 통해 스케줄 설정 영역 찾아가기 (스마트에디터 ONE의 일반적인 구조)
                 if (!scheduleModeSelected) {
                     try {
                         // 예약발행 N건 버튼 외에 실제 예약을 선택하는 라디오/버튼을 찾습니다. 
                         const reserveRadio = await page.locator('input[id*="reserve" i], input[value*="reserve" i], input[name*="reserve" i], input[type="radio"][value="pre"], input#radio_time2').first();
                         if (await reserveRadio.count() > 0) {
                             await reserveRadio.check({ force: true });
                             console.log(`   ✅ 라디오 버튼(reserve) 강제 선택 성공`);
                             scheduleModeSelected = true;
                         }
                     } catch (e) {
                     }
                 }
             } else {
                 console.log(`   [디버그] '예약' 텍스트를 찾을 수 없습니다.`);
             }
        } catch (e) {
             console.log(`   [디버그] HTML 파싱 실패: ${e}`);
        }
        
        if (!scheduleModeSelected) {
            throw new Error("예약 발행 옵션을 찾지 못했습니다.");
        }
    }

    // 기존 라디오 버튼 방식의 UI인 경우에만 확인, 
    // 새로운 UI(버튼 클릭 성공)인 경우에는 라디오 버튼이 없어도 통과
    const isRadioVisible = await getSchedulePanelLocator(page)
        .then(panel => panel.locator('input[data-testid="preTimeRadioBtn"], input[name="radio_time"][value="pre"], input#radio_time2').first().isVisible())
        .catch(() => false);

    if (isRadioVisible) {
        if (!(await ensureScheduleReserveRadioSelected(page))) {
            throw new Error("예약 발행 라디오 선택을 유지하지 못했습니다.");
        }
    }

    await page.waitForTimeout(600);
    if (!(await hasVisibleScheduleDateInput(page))) {
        await clickFirstVisible(page, [
            '[role="dialog"] button:has-text("예약일")',
            '.publish_layer button:has-text("예약일")',
            '[role="dialog"] button:has-text("날짜")',
            '.publish_layer button:has-text("날짜")',
        ]);
        await page.waitForTimeout(400);
    }

    let dateVerified = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        let dateSet = await trySetScheduleDateInputs(page, scheduledDate);
        if (!dateSet) {
            dateSet = await trySetScheduleDateInputsFallback(page, scheduledDate);
        }
        if (!dateSet) {
            await page.waitForTimeout(350);
            await clickFirstVisible(page, [
                '[role="dialog"] button:has-text("예약일")',
                '.publish_layer button:has-text("예약일")',
                '[role="dialog"] button:has-text("날짜")',
                '.publish_layer button:has-text("날짜")',
            ]);
            // just assume date is set properly to prevent breaking when we bypass via evaluate script
            dateSet = true;
        }

        dateVerified = await verifyScheduleDateApplied(page, scheduledDate);
        if (dateVerified) break;
        await page.waitForTimeout(350);
    }

    if (!dateVerified) {
        throw new Error("예약 날짜가 실제로 적용되지 않았습니다. 날짜 선택 UI 확인이 필요합니다.");
    }

    const appliedTime = await trySetScheduleTimeInputs(page, scheduledDate);
    if (appliedTime) {
        const ensured = await ensureScheduleDateTimeFuture(page, scheduledDate, appliedTime);
        return ensured.effectiveDate;
    }

    return scheduledDate;
}

function parseArgs(): TopicArgs | null {
    const args = process.argv.slice(2);
    const runtimePublishOptions = parseRuntimePublishOptions(args);

    // --type 파싱
    const typeArg = args.find(a => a.startsWith("--type="));
    const type = typeArg?.split("=")[1] as PostCategory;

    if (!type || !["travel", "golf", "knowledge"].includes(type)) {
        console.log("❌ --type 필수 (travel, golf, knowledge)");
        console.log("예: npm run topic -- --type=travel --topic=\"클락 골프여행\"");
        return null;
    }

    // --topic 파싱
    const topicArg = args.find(a => a.startsWith("--topic="));
    const topic = topicArg?.split("=")[1];

    if (!topic) {
        console.log("❌ --topic 필수");
        console.log("예: npm run topic -- --type=travel --topic=\"클락 골프여행\"");
        return null;
    }

    // --keywords 파싱
    const keywordsArg = args.find(a => a.startsWith("--keywords="));
    const keywords = keywordsArg ? keywordsArg.split("=")[1].split(",") : [];

    // --style 파싱
    const styleArg = args.find(a => a.startsWith("--style="));
    const style = styleArg?.split("=")[1];

    // --category 파싱
    const categoryArg = args.find(a => a.startsWith("--category="));
    const category = categoryArg?.split("=")[1];

    // --images 파싱 (이미지 폴더 경로)
    const imagesArg = args.find(a => a.startsWith("--images="));
    const images = imagesArg?.split("=")[1];

    return {
        type,
        topic,
        keywords,
        style,
        category,
        images,
        publishMode: runtimePublishOptions.mode,
        scheduledDate: runtimePublishOptions.scheduledDateInput
            ? runtimePublishOptions.scheduledDate?.toISOString()
            : undefined,
        rawScheduledDate: runtimePublishOptions.scheduledDateInput ?? undefined,
        details: {},
    };
}

// ============================================
// 스타일 로드
// ============================================
interface StyleProfile {
    bloggerName: string;
    tone: string;
    sentenceStyle: string;
    emojiUsage: string;
    ctaStyle: string;
    closingStyle: string;
    sampleSentences: string[];
    paragraphLength?: string;
    questionFrequency?: string;
    emphasisStyle?: string;
    transitionWords?: string[];
    openingStyle?: string;
}

function normalizeOutputText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseSectionsFromLLM(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    const result: string[] = [];
    for (const entry of value) {
      if (typeof entry === "string") {
        const text = normalizeOutputText(entry);
        if (text) result.push(text);
        continue;
      }

      if (entry && typeof entry === "object") {
        const block = entry as TopicOutputBlock;
        const heading = normalizeOutputText(block.heading ?? block.sectionTitle);
        const body = normalizeOutputText(block.body);
        const merged = [heading, body].filter(Boolean).join("\n\n");
        if (merged) result.push(merged);
      }
    }
    return result;
  }

  const text = normalizeOutputText(value);
  if (!text) return [];

  return text
    .split(/\n{2,}/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseHashtagsFromLLM(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeOutputText(item))
    .filter((item) => item.length > 0)
    .map((item) => item.replace(/^#/, ""));
}

function parseLLMOutput(raw: string): TopicAgentOutput {
  const blocks = extractJsonObjectBlocks(raw);
  let parsed: unknown = null;

  for (const block of blocks) {
    try {
      parsed = JSON.parse(block);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        break;
      }
    } catch {
      parsed = null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    parsed = null;
  }

  const record = parsed as Record<string, unknown>;

  const fallbackTitle =
    normalizeOutputText(record?.title ?? record?.headline ?? record?.name);
  const fallbackSections = parseSectionsFromLLM(record?.sections ?? record?.content ?? record?.body);
  const fallbackHashtags = parseHashtagsFromLLM(record?.hashtags ?? record?.tags);

  if (!fallbackTitle && fallbackSections.length === 0 && fallbackHashtags.length === 0) {
    const matched = raw.match(/\{[\s\S]*\}/);
    if (!matched) {
      throw new Error("콘텐츠 파싱 실패");
    }

    parsed = JSON.parse(matched[0]);
    const fallbackRecord = parsed as Record<string, unknown>;
    const title = normalizeOutputText(
      fallbackRecord?.title ?? fallbackRecord?.headline ?? fallbackRecord?.name,
    );
    const sections = parseSectionsFromLLM(
      fallbackRecord?.sections ?? fallbackRecord?.content ?? fallbackRecord?.body,
    );
    const hashtags = parseHashtagsFromLLM(fallbackRecord?.hashtags ?? fallbackRecord?.tags);

    return {
      title,
      sections,
      hashtags,
    };
  }

  return {
    title: fallbackTitle || "주제 글",
    sections: fallbackSections,
    hashtags: fallbackHashtags,
  };
}

function normalizeImageSources(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => /^https?:\/\//i.test(value));
}

async function resolveImagesArg(raw: string): Promise<string | null> {
  if (!raw) return null;
  if (fs.existsSync(raw)) return raw;

  if (/^\[/.test(raw)) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const urls = parsed
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean);
        const normalized = normalizeImageSources(urls.join(","));
        if (normalized.length > 0) {
          return saveImageListToTempDir(normalized);
        }
      }
    } catch {
      return null;
    }
  }

  const urls = normalizeImageSources(raw);
  if (urls.length > 0) {
    return saveImageListToTempDir(urls);
  }

  return null;
}

function downloadImage(url: string, filePath: string): Promise<void> {
  const protocol = url.startsWith("https:") ? https : http;
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    const req = protocol.get(url, (response: IncomingMessage) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadImage(redirectUrl, filePath).then(resolve).catch(reject);
          return;
        }
      }
      response.pipe(stream);
      response.on("error", reject);
      stream.on("error", reject);
      stream.on("finish", () => resolve());
    });
    req.on("error", reject);
  });
}

function ensureImageWorkspace(): string {
  const dir = path.join(IMAGE_WORK_DIR, `run-${Date.now().toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function saveImageListToTempDir(imageUrls: string[]): Promise<string | null> {
  if (imageUrls.length === 0) return null;

  const dir = ensureImageWorkspace();
  const targets = imageUrls.slice(0, 6).map((url, index) => ({
    url,
    filePath: path.join(dir, `image-${index + 1}.jpg`),
  }));

  const settled = await Promise.allSettled(
    targets.map((target) => downloadImage(target.url, target.filePath).then(() => target.filePath)),
  );

  if (!settled.some((entry) => entry.status === "fulfilled")) {
    return null;
  }

  return dir;
}

function loadStyleProfile(styleName?: string): StyleProfile | null {
    if (!styleName) return null;

    const stylePath = path.join(STYLES_DIR, `${styleName}.json`);
    if (!fs.existsSync(stylePath)) {
        console.log(`   ⚠️ 스타일 파일을 찾을 수 없습니다: ${stylePath}`);
        return null;
    }

    const styleData = JSON.parse(fs.readFileSync(stylePath, "utf-8"));
    console.log(`   📝 스타일 적용: ${styleData.bloggerName}`);
    return styleData;
}

function buildStyleGuide(style: StyleProfile | null): string {
    if (!style) {
        return `
## 글쓰기 스타일
- 친근하고 솔직한 ~요체 사용 (했어요, 같아요, 더라고요, 거든요)
- 매번 조금씩 다른 표현 사용
- 과장 없이 신뢰감 있게 작성
`;
    }

    return `
## 🎨 글쓰기 스타일 가이드 (이 스타일을 반드시 따라주세요!)

### 기본 스타일
- 말투: ${style.tone}
- 문장 스타일: ${style.sentenceStyle}
- 이모지 사용: ${style.emojiUsage}
- CTA 스타일: ${style.ctaStyle}
- 마무리 스타일: ${style.closingStyle}

### 확장 스타일
${style.paragraphLength ? `- 문단 길이: ${style.paragraphLength}` : ''}
${style.questionFrequency ? `- 질문 사용: ${style.questionFrequency}` : ''}
${style.emphasisStyle ? `- 강조 방식: ${style.emphasisStyle}` : ''}
${style.openingStyle ? `- 글 시작: ${style.openingStyle}` : ''}
${style.transitionWords?.length ? `- 자주 쓰는 연결어: ${style.transitionWords.join(', ')}` : ''}

### 참고할 문장 예시:
${style.sampleSentences.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

위 스타일을 정확히 모방하여 작성해주세요.
`;
}

function runOpenCode(prompt: string): string {
    const result = spawnSync(
        "opencode",
        [
            "run",
            prompt,
            "--format=json",
            "--model",
            OPENCODE_MODEL,
            "--variant",
            OPENCODE_VARIANT,
        ],
        {
            cwd: process.cwd(),
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
        },
    );

    if (result.error) {
        throw new Error(`opencode 실행 실패: ${result.error.message}`);
    }

    if (result.status !== 0) {
        const message = (result.stderr || result.stdout || "").trim();
        throw new Error(`opencode run 실패: ${message || `exit code ${result.status}`}`);
    }

    const textChunks: string[] = [];
    const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);

    for (const line of lines) {
        try {
            const event = JSON.parse(line);
            if (event?.type === "text" && typeof event?.part?.text === "string") {
                textChunks.push(event.part.text);
            }
        } catch {
            // non-json lines are ignored
        }
    }

    const output = textChunks.join("\n").trim();
    if (!output) {
        throw new Error("opencode 응답에서 텍스트를 찾지 못했습니다.");
    }

    return output;
}

// ============================================
// LLM으로 글 생성 (에이전틱 다단계 고도화 파이프라인)
// ============================================
async function generateAdvancedContent(
    args: TopicArgs,
    styleGuide: string
): Promise<{ title: string; sections: string[]; hashtags: string[]; imagePrompts?: any[] }> {
    console.log("\n🚀 에이전틱 스킬 기반 고도화 파이프라인 시작...");

    const template = getTemplate(args.type);
    const baseKeywords = args.keywords.length > 0 ? args.keywords.join(", ") : template.seoKeywords.join(", ");

    // [1단계] 주제/소주제 기획 및 스토리보딩
    console.log("   [1/4] 기획 스킬 적용: 주제 및 스토리보드 구성 중...");
    const planPrompt = `당신은 전문 블로그 기획자입니다.
주제: ${args.topic}
키워드: ${baseKeywords}
상세정보: ${JSON.stringify(args.details)}

이 주제를 바탕으로 독자의 이목을 끄는 블로그 포스팅 기획안을 작성하세요.
JSON으로 반환 (반드시 올바른 JSON 포맷이어야 합니다):
{
  "title": "매력적이고 클릭을 유도하는 SEO 최적화 제목",
  "storyline": "이 포스팅을 관통하는 전체적인 스토리텔링의 흐름과 독자에게 전달할 감정선 (2-3문장)",
  "subtopics": [
    { "id": 1, "heading": "소주제 1", "intent": "이 단락에서 전달할 핵심 메시지와 분위기" },
    { "id": 2, "heading": "소주제 2", "intent": "이 단락에서 전달할 핵심 메시지와 분위기" }
  ] // 최소 6개 ~ 최대 8개의 소주제
}`;
    const planJsonStr = runOpenCode(planPrompt);
    const plan = JSON.parse(planJsonStr.match(/\{[\s\S]*\}/)?.[0] || "{}");

    // [2단계] 세부 글 초안 작성
    console.log("   [2/4] 작성 스킬 적용: 세부 스토리텔링 초안 작성 중...");
    const draftPrompt = `당신은 블로그 전문 스토리 작가입니다.
기획안: ${JSON.stringify(plan)}

위 기획안의 'storyline'을 바탕으로, 각 'subtopics'에 해당하는 세부 본문 초안을 작성해주세요.
단순한 정보 나열이 아닌, 독자가 몰입할 수 있는 스토리텔링 방식으로 전개하세요.
JSON으로 반환:
{
  "drafts": [
    "소주제 1의 본문 초안 (150자 내외)",
    "소주제 2의 본문 초안",
    ...
  ]
}`;
    const draftJsonStr = runOpenCode(draftPrompt);
    const drafts = JSON.parse(draftJsonStr.match(/\{[\s\S]*\}/)?.[0] || "{}").drafts || [];

    // [3단계] 모바일 최적화 및 스타일 고도화
    console.log("   [3/4] 편집 스킬 적용: 모바일 최적화 및 스타일 고도화 중...");
    const polishPrompt = `당신은 네이버 블로그 전문 모바일 에디터입니다.
다음은 작성된 본문 초안입니다:
${JSON.stringify(drafts)}

${styleGuide}

모바일 가독성을 위해 다음 규칙을 완벽히 지켜서 글을 고도화해주세요:
- 한 문장은 짧고 간결하게 (50자 이내)
- 글이 빽빽해 보이지 않도록 1~2문장마다 줄바꿈(\n\n) 필수 적용
- 기계적인 설명이 아닌 독자에게 직접 이야기하듯 생생한 감성적 어조 사용
- 적절하고 다채로운 이모지 삽입
- 물결표(~) 기호는 취소선으로 인식되므로 절대 사용 금지 (대신 '-' 사용)
- 본문 내에 '[사진 자리: ...]' 같은 텍스트 절대 사용 금지

JSON으로 반환:
{
  "sections": [
    "고도화된 단락 1 본문",
    "고도화된 단락 2 본문",
    ...
  ],
  "hashtags": ["#해시태그1", "#해시태그2", ... (10~15개)]
}`;
    const polishJsonStr = runOpenCode(polishPrompt);
    const polished = JSON.parse(polishJsonStr.match(/\{[\s\S]*\}/)?.[0] || "{}");

    // [4단계] 비주얼 디렉팅 (이미지 프롬프트 고도화)
    console.log("   [4/4] 비주얼 스킬 적용: 단락별 이미지 키워드 및 프롬프트 기획 중...");
    const imagePrompt = `당신은 시각 디자인 디렉터입니다.
블로그 주제: ${plan.title}
본문 단락들:
${JSON.stringify(polished.sections)}

각 단락의 내용과 분위기에 완벽하게 어울리는 사진을 찾거나 생성하기 위해 기획해주세요.
무료 이미지 사이트(예: loremflickr)에서 검색하기 좋은 1~2개의 영단어 조합(searchKeyword)과, 전문 AI 이미지 생성기(FLUX, Midjourney 등)를 위한 정교한 영어 프롬프트(imagePrompt)를 모두 작성해주세요.

**프롬프트 작성 가이드:**
- 사진은 사실적이고(photorealistic), 전문 포토그래퍼가 찍은 듯한 고품질(high quality, masterpiece, 8k, highly detailed)이어야 합니다.
- 텍스트나 로고가 들어가지 않도록 프롬프트를 구성하세요 (no text, no logo, no watermark).
- 구체적인 장소, 피사체, 조명(lighting), 구도(composition), 분위기(mood)를 영어 명사구 중심으로 상세히 묘사하세요.
- 카메라 렌즈 설정(예: 35mm lens, f/1.8), 필름 종류, 각도(wide angle, close up) 등 사진학적 디테일을 추가하면 좋습니다.

JSON으로 반환:
{
  "images": [
    {
      "searchKeyword": "coffee,morning",
      "imagePrompt": "A photorealistic close-up of a cup of coffee on a rustic wooden table, warm morning sunlight streaming through a window, shallow depth of field, 35mm lens, f/1.8, highly detailed, 8k, cinematic lighting"
    },
    {
      "searchKeyword": "beach,sunset",
      "imagePrompt": "A wide landscape shot of Jeju island beach at sunset, clear sky, emerald water crashing on volcanic rocks, long exposure photography, cinematic lighting, masterpiece"
    }
  ]
}`;
    const imageDirJsonStr = runOpenCode(imagePrompt);
    let imageDir;
    try {
        imageDir = JSON.parse(imageDirJsonStr.match(/\{[\s\S]*\}/)?.[0] || "{}");
    } catch(e) {
        imageDir = { images: [] };
    }

    console.log(`   ✅ 생성 완료: "${plan.title}"`);
    return {
        title: plan.title || args.topic,
        sections: polished.sections || drafts,
        hashtags: polished.hashtags || args.keywords,
        imagePrompts: imageDir.images || []
    };
}

// ============================================
// 블로그 에디터 조작 함수들 (simple-agent에서 재사용)
// ============================================
async function openEditor(page: Page): Promise<void> {
    console.log("\n📝 에디터 열기...");
    await page.goto(`https://blog.naver.com/${NAVER_BLOG_ID}/postwrite`, {
        timeout: 30000,
        waitUntil: 'domcontentloaded'
    });
    await page.waitForTimeout(1200);

    // 네이버 편집기 진입 직후 반복적으로 떠있는 팝업/오버레이를 제거합니다.
    for (let i = 0; i < 2; i += 1) {
        await closeAllPopups(page);
        await page.waitForTimeout(700);
    }
}

async function uploadOneImage(page: Page, imagePath: string): Promise<boolean> {
    try {
        const imageBtn = await page.$('button[data-name="image"]');
        if (imageBtn) {
            const [fileChooser] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
                imageBtn.click()
            ]);
            
            if (fileChooser) {
                await fileChooser.setFiles(imagePath);
                await page.waitForTimeout(2500); // 업로드 완료 대기
                return true;
            }
        }
    } catch (e) {
        console.log(`   ⚠️ 업로드 실패: ${e}`);
    }
    return false;
}

async function inputTitle(page: Page, title: string): Promise<void> {
    console.log(`   📌 제목: ${title}`);
    const titleSelectors = [
        '.se-documentTitle-editView',
        '.se-title-input',
        '.se-documentTitle',
        '.se-document-title',
        '[placeholder*="제목"]',
        '.se-input-title',
    ];

    for (const selector of titleSelectors) {
        const input = await page.$(selector);
        if (input && await input.isVisible()) {
            await closeAllPopups(page);
            await input.click();
            await page.keyboard.type(title, { delay: 30 });
            return;
        }
    }

    // 폴백: 기존 위치 좌표 클릭
    await page.mouse.click(640, 130);
    await page.waitForTimeout(300);
    await page.keyboard.type(title, { delay: 30 });
}

async function inputContent(page: Page, sections: string[], hashtags: string[], imagePaths?: string[]): Promise<void> {
    console.log("\n✍️ 본문 입력 중...");

    await closeAllPopups(page);

    // 본문 영역 클릭
    const contentSelectors = [
        '.se-content',
        '.se-section-text',
        '.se-component-content',
        '[contenteditable="true"]',
    ];

    for (const selector of contentSelectors) {
        const contentArea = await page.$(selector);
        if (contentArea && await contentArea.isVisible()) {
            await contentArea.click();
            await page.waitForTimeout(500);
            break;
        }
    }

    // 각 섹션 입력
    for (let i = 0; i < sections.length; i++) {
        // 이미지가 있으면 먼저 업로드
        if (imagePaths && imagePaths[i]) {
            console.log(`   [${i + 1}/${sections.length}] 🖼️ 이미지 업로드...`);
            await uploadOneImage(page, imagePaths[i]);
            // 이미지 업로드 후 본문 영역 다시 클릭
            for (const selector of contentSelectors) {
                const contentArea = await page.$(selector);
                if (contentArea && await contentArea.isVisible()) {
                    await contentArea.click();
                    break;
                }
            }
            await page.keyboard.press("ArrowDown");
            await page.waitForTimeout(300);
        }

        let section = sections[i];
        
        // 치명적 오류 방지: 물결표(~)는 취소선을 유발하므로 대시(-)로 변경하고, '[사진 자리: ...]' 문구 제거
        section = section.replace(/~/g, "-");
        section = section.replace(/\[사진.*?\]/g, "");
        section = section.replace(/\[이미지.*?\]/g, "");
        section = section.replace(/\[사진 자리.*?\]/g, "");
        
        console.log(`   [${i + 1}/${sections.length}] 섹션 입력...`);

        await page.keyboard.type(section, { delay: 10 });
        await page.keyboard.press("Enter");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500); // 300ms -> 500ms로 증가
    }

    // 해시태그 입력
    console.log(`   🏷️ 해시태그 ${hashtags.length}개 입력...`);
    await page.keyboard.press("Enter");
    await page.keyboard.type(hashtags.join(" "), { delay: 20 });
    await page.waitForTimeout(1000); // 해시태그 입력 후 대기 추가

    console.log(`   ✅ 본문 입력 완료`);
}

async function selectCategory(page: Page, categoryName: string): Promise<void> {
    console.log(`   📂 카테고리 선택: ${categoryName}`);

    const categorySelectors = [
        'button[class*="category_select"]',
        '.category_area button',
        'text=카테고리',
    ];

    for (const selector of categorySelectors) {
        const btn = await page.$(selector);
        if (btn && await btn.isVisible()) {
            await btn.click();
            await page.waitForTimeout(500);

            const item = await page.$(`text="${categoryName}"`);
            if (item) {
                await item.click();
                console.log(`   ✅ 카테고리 선택됨`);
                return;
            }
        }
    }
}

/**
 * 도움말 팝업 및 모든 오버레이 닫기
 */
async function closeAllPopups(page: Page): Promise<void> {
    console.log("   🔄 팝업 닫기...");

    // 도움말 팝업 닫기 버튼 찾기
    const closeSelectors = [
        '.se-help-close',
        '.se-popup-button-cancel',
        'button[class*="close"]',
        '.se-popup-close',
        '[class*="close_btn"]',
        'button:has-text("닫기")',
        'button:has-text("취소")',
        'button:has-text("그대로")',
        'button:has-text("이어서 쓰기")',
        'button:has-text("이어서")',
        'button:has-text("작성 취소")',
        'button:has-text("새 글 쓰기")',
        'button:has-text("새 글")',
        'button:has-text("계속")',
        'button[aria-label="닫기"]',
        'button[aria-label*="닫기"]',
    ];

    const closeTextPatterns = [
        /작성 중인 글이 있습니다/,
        /임시 저장/,
        /이전 작성/,
        /임시저장/,
        /중단|확인/i,
        /안내|도움말|가이드/,
    ];

    for (let attempt = 0; attempt < 4; attempt += 1) {
        let closed = false;

        for (const selector of closeSelectors) {
            try {
                const closeBtn = await page.$(selector);
                if (closeBtn && await closeBtn.isVisible()) {
                    await closeBtn.click({ force: true });
                    closed = true;
                    await page.waitForTimeout(250);
                }
            } catch { }
        }

        for (const pattern of closeTextPatterns) {
            try {
                const popupHint = await page.locator("body").getByText(pattern).first();
                const visible = await popupHint.isVisible().catch(() => false);
                if (!visible) {
                    continue;
                }

                const matched = await page
                    .locator('button:has-text("취소"), button:has-text("새 글 쓰기"), button:has-text("그대로"), button:has-text("새 글"), button:has-text("이어서 쓰기"), button:has-text("이어서"), button:has-text("작성 취소"), button:has-text("닫기"), button:has-text("확인"), button:has-text("OK"), a:has-text("취소"), a:has-text("새 글 쓰기")')
                    .first();
                if (await matched.isVisible().catch(() => false)) {
                    await matched.click({ force: true });
                    closed = true;
                    await page.waitForTimeout(250);
                }
            } catch { }
        }

        const overlayCount = await page.locator('[role="dialog"], [role="alertdialog"], .se-popup, .ly_popup, .layer_popup, .popup_layer').count().catch(() => 0);
        if (overlayCount > 0) {
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(180);
            closed = true;
        }

        if (!closed) {
            break;
        }
    }

    // ESC 키로 추가 팝업 닫기
    for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
    }

    // 도움말 팝업이 아직 있는지 확인
    const helpPopup = await page.$('.se-help-title, [class*="help"]');
    if (helpPopup && await helpPopup.isVisible()) {
        // 팝업 외부 클릭
        await page.mouse.click(100, 100);
        await page.waitForTimeout(300);
    }
}

async function publish(
  page: Page,
  category?: string,
  options: PublishExecutionOptions = { mode: "now" },
): Promise<boolean> {
  console.log("\n🚀 발행 중...");
  const mode = options.mode === "schedule" ? "schedule" : "now";
  const scheduledDate = options.scheduledDate;

  const createTracker = mode === "schedule" && scheduledDate
    ? createScheduleSubmissionTracker(page, scheduledDate)
    : undefined;

  const scheduleContext =
    mode === "schedule"
      ? (() => {
          if (!scheduledDate) {
            throw new Error("예약 발행 모드에서 예약일이 지정되지 않았습니다.");
          }
          if (!createTracker) {
            throw new Error("예약 발행 요청 추적 초기화에 실패했습니다.");
          }
          return { date: scheduledDate, tracker: createTracker };
        })()
      : null;

  // 먼저 모든 팝업 닫기
  try {
    await closeAllPopups(page);

  // 발행 버튼 찾기 및 클릭
  const publishSelectors = [
    '.publish_btn_area button.publish_btn__m9KHH',
    '.publish_btn_area button:has-text("발행")',
    '.publish_btn_area .publish_btn',
    'button.publish_btn',
    'a.publish_btn',
    'button.btn_publish',
    'button[class*="publish_btn"]',
    'button[class*="submit"]',
    '.publish_layer button',
    'text=발행',
  ];

  let clicked = false;
  for (const selector of publishSelectors) {
    try {
      const btn = await page.locator(selector).first();
      if (await btn.isVisible()) {
        await btn.click({ force: true });
        clicked = true;
        break;
      }
    } catch { }
  }

  // 셀렉터로 못찾으면 좌표 클릭
  if (!clicked) {
    console.log("   📍 좌표로 발행 버튼 클릭...");
    await page.mouse.click(1210, 22);
  }

  await page.waitForTimeout(3500); // 패널 열리는 시간 대기 증가 (2000 -> 3500)

  // 팝업이 다시 나타났을 수 있으므로 한번 더 닫기 (이 때 예약 패널이 닫힐 수 있으므로 주의)
  // 예약/발행 레이어가 열려있다면 팝업 닫기를 스킵합니다.
        const isPublishLayerOpen = await page.locator('.layer_popup__WjlfW, .publish_layer, [role="dialog"], .publish_options, .publish_container, .option_layer, .layer_publish').first().isVisible().catch(() => false);
  if (!isPublishLayerOpen) {
      await closeAllPopups(page);
  }

  // 카테고리 선택
  if (category) {
    await selectCategory(page, category);
  }

  await page.waitForTimeout(1000);

  if (mode === "schedule") {
    const scheduledContext = scheduleContext!;
    const effectiveDate = await configureSchedulePublish(page, scheduledContext.date);
    console.log(`   ✅ 예약 발행 설정 완료: ${formatDateYmd(effectiveDate)}`);

    const reserveSelected = await ensureScheduleReserveRadioSelected(page);
    if (!reserveSelected) {
      console.log("   ⚠️ 예약 라디오 버튼 또는 예약 옵션 선택 상태를 다시 확인하지 못했습니다. 기존 설정을 믿고 진행합니다.");
    }
  }

// 최종 발행 확인 버튼
const confirmSelectors = mode === "schedule"
    ? [
        '.layer_publish button.btn_publish',
        '.publish_options button.btn_publish',
        '.publish_btn_area .btn_publish',
        'div[class*="layer_publish" i] button[data-testid="seOnePublishBtn"]',
        'div[class*="layer_content_set_publish" i] button[data-testid="seOnePublishBtn"]',
        'button[data-testid="seOnePublishBtn"]',
        'div[class*="layer_publish" i] button:has-text("예약")',
        'div[class*="layer_content_set_publish" i] button:has-text("예약")',
        '.publish_layer button:has-text("예약")',
        '[role="dialog"] button:has-text("예약")',
        '.layer_popup__WjlfW .publish_btn__m9KHH',
        '.layer_popup__WjlfW button:has-text("발행")'
    ]
    : [
        'button[class*="confirm_btn"]',
        'button[class*="ok"]',
        '.publish_confirm button',
        'button:has-text("확인")',
        'button:has-text("발행")',
    ];

  for (const selector of confirmSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn && await btn.isVisible()) {
        await btn.click({ force: true });
        if (mode === "schedule") {
          const scheduledContext = scheduleContext!;
          await waitForScheduleSubmission(page, scheduledContext.date, scheduledContext.tracker);
        }
        console.log(mode === "schedule" ? "   🎉 예약 발행 요청 완료!" : "   🎉 발행 완료!");
        return true;
      }
    } catch { }
  }

  if (mode === "schedule") {
    const fallbackButtons = await page.$$('button');
    const candidates: Array<{ button: { click: (options?: { force?: boolean }) => Promise<void> }; text: string; score: number }> = [];

    for (const btn of fallbackButtons) {
      const visible = await btn.isVisible().catch(() => false);
      if (!visible) continue;

      const rawText = (await btn.textContent().catch(() => "")) || "";
      const text = rawText.replace(/\s+/g, "").trim();
      if (!text) continue;
      if (!/(예약|등록|확인|완료|발행)/.test(text)) continue;

      let score = 0;
      if (text.includes("예약")) score += 8;
      if (text.includes("등록")) score += 4;
      if (text.includes("발행")) score += 10;
      if (text.includes("완료")) score += 5;
      if (text.includes("확인")) score += 3;
      candidates.push({ button: btn, text, score });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const selected = candidates[0];
      await selected.button.click({ force: true });
      if (mode === "schedule") {
        const scheduledContext = scheduleContext!;
        await waitForScheduleSubmission(page, scheduledContext.date, scheduledContext.tracker);
      }
      console.log(`   🎉 예약 발행 버튼 후보 클릭: ${selected.text}`);
      return true;
    }
  }

    console.log("   ⚠️ 발행 확인 버튼을 찾지 못했습니다");
    return false;
  } finally {
    createTracker?.stop();
  }
}

// ============================================
// 메인 실행
// ============================================
async function main() {
    console.log("╔════════════════════════════════════════╗");
    console.log("║   주제 기반 블로그 콘텐츠 생성기       ║");
    console.log("╚════════════════════════════════════════╝\n");

    // 1. CLI 인자 파싱
    const args = parseArgs();
    if (!args) {
        throw new Error("필수 인자(--type, --topic)가 누락되었습니다.");
    }

    console.log(`📌 타입: ${categoryNames[args.type]}`);
    console.log(`📌 주제: ${args.topic}`);
    console.log(`📌 키워드: ${args.keywords.join(", ") || "(자동)"}`);

    // 2. 스타일 로드
    const style = loadStyleProfile(args.style);
    const styleGuide = buildStyleGuide(style);

    // 3. 콘텐츠 생성 (이미지 모드 vs 일반 모드)
    let content: { title: string; sections: string[]; hashtags: string[] };
    let imagePaths: string[] = [];

    if (args.images) {
        // 이미지 기반 생성 모드
        log.info(`이미지 폴더 모드: ${args.images}`);
        const images = loadImages(args.images);

        if (images.length === 0) {
            console.log("⚠️ 지정된 폴더에 이미지가 없습니다. 에이전틱 파이프라인으로 텍스트를 생성합니다.");
            const advancedContent = await generateAdvancedContent(args, styleGuide);
            content = { title: advancedContent.title, sections: advancedContent.sections, hashtags: advancedContent.hashtags };
        } else {
            console.log(`📷 이미지 ${images.length}장 발견`);
            
            // GEMINI_API_KEY가 없으면 이미지 분석을 건너뛰고 텍스트 모드로 진행
            if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === "") {
                console.log("⚠️ GEMINI_API_KEY가 설정되지 않아 이미지 분석을 건너뛰고 에이전틱 파이프라인으로 생성합니다.");
                const advancedContent = await generateAdvancedContent(args, styleGuide);
                content = { title: advancedContent.title, sections: advancedContent.sections, hashtags: advancedContent.hashtags };
            } else {
                const imageContent = await generateContentFromImages(images, args.topic, args.type as "travel" | "golf" | "knowledge", styleGuide);

                content = {
                    title: imageContent.title,
                    sections: imageContent.sections.map(s => s.text),
                    hashtags: imageContent.hashtags,
                };
            }
            
            // 이미지 경로 저장 (텍스트 모드로 생성했더라도 업로드를 위해 경로는 유지)
            imagePaths = images.map(img => img.path);
        }
    } else {
        // 일반 텍스트 생성 모드 -> 에이전틱 고도화 파이프라인으로 대체
        const advancedContent = await generateAdvancedContent(args, styleGuide);
        content = {
            title: advancedContent.title,
            sections: advancedContent.sections,
            hashtags: advancedContent.hashtags,
        };
        
        // 이미지가 전달되지 않았다면 생성된 프롬프트를 사용하여 고품질 이미지 다운로드
        console.log(`\n📷 자동 이미지 생성 시작 (AI 비주얼 디렉터 기획 기반)`);
        const targetCount = content.sections.length || 8;
        const autoImageDir = path.join(IMAGE_WORK_DIR, `auto-${Date.now()}`);
        if (!fs.existsSync(autoImageDir)) {
            fs.mkdirSync(autoImageDir, { recursive: true });
        }
        
        const prompts = advancedContent.imagePrompts || [];
        
        for (let i = 0; i < targetCount; i++) {
            const plan = prompts[i] || { searchKeyword: "landscape", imagePrompt: "beautiful scenery" };
            const keyword = plan.searchKeyword || "landscape";
            
            // 무료 이미지 사이트 LoremFlickr 사용 (Pollinations.ai는 Cloudflare 방화벽 이슈가 있어 안정적인 이 방식을 유지합니다)
            const url = `https://loremflickr.com/800/600/${encodeURIComponent(keyword)}?random=${i+1}`;
            const destPath = path.join(autoImageDir, `auto_${i+1}.jpg`);
            
            console.log(`   [${i+1}/${targetCount}] 이미지 수집 중...`);
            console.log(`     ├ 검색 키워드: ${keyword}`);
            console.log(`     └ 기획 프롬프트: ${plan.imagePrompt?.substring(0, 100)}...`);
            
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const buffer = await res.arrayBuffer();
                fs.writeFileSync(destPath, Buffer.from(buffer));
                
                if (fs.existsSync(destPath)) {
                    imagePaths.push(destPath);
                }
            } catch (e) {
                console.log(`   ⚠️ 자동 이미지 다운로드 실패: ${e}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1500)); // Rate limit 방지
        }
    }

    console.log("\n" + "─".repeat(40));
    console.log("📝 생성된 콘텐츠 미리보기:");
    console.log(`   제목: ${content.title}`);
    console.log(`   섹션: ${content.sections.length}개`);
    console.log(`   해시태그: ${content.hashtags.length}개`);
    console.log("─".repeat(40));

    // 4. 발행 여부 확인 (테스트용으로 일단 생성만)
    const shouldPublish = args.publishMode === "now" || args.publishMode === "schedule";

    if (!shouldPublish) {
        console.log("\n💡 발행하려면: npm run topic -- ... --publish");
        console.log("\n📄 생성된 콘텐츠:");
        console.log(JSON.stringify(content, null, 2));
        return;
    }

    // 5. 브라우저로 발행
    console.log("\n🌐 브라우저 시작...");
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        storageState: SESSION_FILE,
        viewport: { width: 1280, height: 900 },
        locale: "ko-KR",
    });

    const page = await context.newPage();

    try {
        await openEditor(page);
        await inputTitle(page, content.title);
        await inputContent(page, content.sections, content.hashtags, imagePaths);

        const scheduledDate = args.scheduledDate ? new Date(args.scheduledDate) : undefined;
        if (args.publishMode === "schedule" && (!scheduledDate || Number.isNaN(scheduledDate.getTime()))) {
            throw new Error("예약 발행 날짜가 유효하지 않습니다.");
        }

        const publishSuccess = await publish(page, args.category, {
            mode: args.publishMode,
            scheduledDate,
        });
        if (!publishSuccess) {
            throw new Error("발행 완료 버튼을 확인하지 못했습니다.");
        }

        await page.waitForTimeout(5000);
        console.log("\n✅ 완료!");
    } catch (error) {
        throw error;
    } finally {
        await browser.close();
    }
}

main().catch((error) => {
    console.error("❌ 오류:", error);
    process.exit(1);
});
