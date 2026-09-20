/**
 * 주제 기반 콘텐츠 생성 에이전트
 * URL 없이 주제만으로 블로그 글을 생성합니다.
 *
 * 사용법:
 *   npm run topic -- --type=travel --topic="클락 골프여행" --keywords="클락,골프투어,필리핀"
 *   npm run topic -- --type=golf --topic="파인밸리CC" --style=style-xxx
 */

import "dotenv/config";
import { createScheduleSubmissionTracker, waitForConfirmedScheduleSubmission, type ScheduleSubmissionTracker } from "./lib/naver-schedule-tracker";
import { register } from "tsconfig-paths";
register({ baseUrl: process.cwd(), paths: { "@/*": ["src/*"] } });
import { getTopicTaskPublishReadiness, parseTopicSourceUrls, isTopicPublishedUrl } from "../src/lib/topic-task-publish-readiness";
import { getTopicTaskContentReadiness } from "../src/lib/topic-task-content-readiness";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Locator, Page, Response } from "playwright";
import { spawnSync } from "child_process";
import { PrismaClient } from "../src/generated/prisma";
import * as path from "path";
import * as fs from "fs";
import {
    PostCategory,
    getTemplate,
    categoryNames
} from "./lib/templates";
import { buildHumanMobileStyleGuide } from "./lib/blog-writing-style";
import { loadImages } from "./lib/image-content";
import { createTaskLogger } from "./lib/logger";
import { getNaverSessionFile } from "./lib/app-paths";
import {
    parsePreparedTopicContent,
    preparedSectionsToPublishBlocks,
    parseTopicVisualPlan,
    parseStoredTopicPayload,
    type PreparedTopicSection,
    type TopicVisualPlan,
} from "../src/lib/topic-task-contract";

const log = createTaskLogger("TopicAgent");

// Stealth 플러그인 적용
chromium.use(StealthPlugin());

const SESSION_FILE = getNaverSessionFile();
const STYLES_DIR = path.join(process.cwd(), "styles");
const NAVER_BLOG_ID = process.env.NAVER_BLOG_ID || "";
const IMAGE_WORK_DIR = path.join(process.cwd(), "temp_images", "topic-agent");
const ALLOW_CHATGPT_BROWSER_MODE =
    (process.env.ALLOW_CHATGPT_BROWSER_MODE || "false").toLowerCase() === "true";
const TOPIC_DAEDAL_IMAGE_ENABLED =
    process.env.TOPIC_PIPELINE_DAEDAL_ENABLED?.toLowerCase() === "true";
const HAS_OPENAI_API_KEY = /^sk-[A-Za-z0-9_-]+/.test(process.env.OPENAI_API_KEY?.trim() || "");
const TOPIC_DAEDAL_BIN =
    process.env.TOPIC_PIPELINE_DAEDAL_BIN?.trim() ||
    process.env.DAEDAL_BIN?.trim() ||
    (process.env.HOME && fs.existsSync(path.join(process.env.HOME, ".cargo", "bin", "daedal"))
        ? path.join(process.env.HOME, ".cargo", "bin", "daedal")
        : "daedal");
const TOPIC_DAEDAL_PRESET = process.env.TOPIC_PIPELINE_DAEDAL_PRESET?.trim() || "slide";
const TOPIC_DAEDAL_SIZE = process.env.TOPIC_PIPELINE_DAEDAL_SIZE?.trim() || "";
const TOPIC_DAEDAL_QUALITY = process.env.TOPIC_PIPELINE_DAEDAL_QUALITY?.trim() || "";
const TOPIC_DAEDAL_MODEL = process.env.TOPIC_PIPELINE_DAEDAL_MODEL?.trim() || "";
const TOPIC_DAEDAL_IMAGE_TIMEOUT_MS = Number(process.env.TOPIC_PIPELINE_DAEDAL_IMAGE_TIMEOUT_MS || 180000);

type PublishMode = "draft" | "now" | "schedule";

interface PublishExecutionOptions {
  mode: PublishMode;
  beforeSubmit?: () => Promise<void>;
  scheduledDate?: Date | null;
}


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
    sections: Array<string | PreparedTopicSection>;
    hashtags: string[];
}

interface TopicOutputBlock {
    sectionTitle?: unknown;
    heading?: unknown;
    body?: unknown;
    draft?: unknown;
    content?: unknown;
}

interface StoredPublishPayload {
  title: string;
  lead?: string;
  highlights?: string[];
  sections: Array<string | PreparedTopicSection>;
  hashtags: string[];
}

interface DraftImageRecord {
  role?: string | null;
  localPath?: string | null;
  createdAt?: Date | string | null;
}

interface LoadedPublishContext {
  taskId: string | null;
  postId: string | null;
  args: TopicArgs;
  preparedContent: StoredPublishPayload | null;
  imagePaths: string[];
  imagePlan: TopicVisualPlan | null;
}

interface RuntimePublishOptions {
    mode: PublishMode;
    scheduledDateInput: string | null;
    scheduledDate: Date | null;
}

interface SectionBlock {
  heading: string;
  summary?: string;
  body: string;
  bullets?: string[];
  kind?: PreparedTopicSection["kind"];
}

function sanitizeTopicSectionText(section: string): string {
    let cleaned = section;

    cleaned = cleaned.replace(/~/g, "-");
    cleaned = cleaned.replace(/\[사진.*?\]/g, "");
    cleaned = cleaned.replace(/\[이미지.*?\]/g, "");
    cleaned = cleaned.replace(/\[사진 자리.*?\]/g, "");
    cleaned = cleaned.replace(/\*\*.*?\*\*/g, (match) => match.replace(/\*\*/g, ""));
    cleaned = cleaned.replace(/<\/?[a-zA-Z][^>]*>/g, "");
    cleaned = cleaned.replace(/```(?:json)?/gi, "");
    cleaned = cleaned.replace(/\[\s*(?:도입|본론|결론)\s*\]\s*\{?/g, "");
    cleaned = cleaned.replace(/\{?\s*"title"\s*:\s*"[^"]*"\s*,?/g, "");
    cleaned = cleaned.replace(/"storyline"\s*:\s*"[^"]*"\s*,?/g, "");
    cleaned = cleaned.replace(/"subtopics"\s*:\s*\[[\s\S]*?\]\s*\}?/g, "");
    cleaned = cleaned.replace(/AI 활용 설정\s*사진 설명을 입력하세요\./g, "");
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

    return cleaned.trim();
}

function parseTopicSectionBlock(section: string | PreparedTopicSection): SectionBlock {
    if (typeof section !== "string") {
        return {
            heading: normalizeText(section.heading || ""),
            summary: normalizeText(section.summary || ""),
            body: sanitizeTopicSectionText(section.body || ""),
            bullets: Array.isArray(section.bullets)
                ? section.bullets.map((item) => normalizeText(item)).filter(Boolean)
                : [],
            kind: section.kind,
        };
    }

    const cleaned = sanitizeTopicSectionText(section);
    if (!cleaned) {
        return { heading: "", body: "" };
    }

    const rawLines = cleaned.split("\n");
    const nonEmptyLines = rawLines
        .map((line) => line.trim())
        .filter(Boolean);

    if (nonEmptyLines.length < 2) {
        return { heading: "", body: cleaned };
    }

    const firstNonEmptyIndex = rawLines.findIndex((line) => line.trim().length > 0);
    if (firstNonEmptyIndex < 0) {
        return { heading: "", body: "" };
    }

    const firstLine = rawLines[firstNonEmptyIndex].trim();
    const remaining = rawLines
        .slice(firstNonEmptyIndex + 1)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    const looksLikeHeading =
        firstLine.length > 0 &&
        firstLine.length <= 60 &&
        !/[.!?]$/.test(firstLine);

    if (!looksLikeHeading) {
        return { heading: "", body: cleaned };
    }

    return {
        heading: firstLine,
        body: remaining.trim(),
    };
}

async function inputTopicSectionBlock(page: Page, section: string | PreparedTopicSection): Promise<void> {
    const block = parseTopicSectionBlock(section);
    if (!block.heading && !block.body) {
        await page.keyboard.press("Enter");
        return;
    }

    if (block.heading) {
        const headingApplied = await setNaverTextFormat(page, "sectionTitle");
        if (!headingApplied) {
            console.log("   ⚠️ 소제목 스타일 적용 실패, 본문 스타일로 대체");
        }

        await page.keyboard.type(block.heading, { delay: 10 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(120);

        const dividerInserted = await insertNaverHorizontalDivider(page);
        if (!dividerInserted) {
            console.log("   ⚠️ 구분선 삽입 실패, 본문 입력은 계속 진행합니다.");
        } else {
            await page.keyboard.press("Enter").catch(() => {});
            await page.waitForTimeout(120);
        }

        await setNaverTextFormat(page, "text");
    } else {
        await setNaverTextFormat(page, "text");
    }

    if (block.summary) {
        await page.keyboard.type(block.summary, { delay: 10 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(60);
    }

    const bodyLines = (block.body || "")
        .split("\n")
        .map((line) => line.trim());

    for (const line of bodyLines) {
        if (!line) {
            await page.keyboard.press("Enter");
        } else {
            await page.keyboard.type(line, { delay: 10 });
            await page.keyboard.press("Enter");
        }
        await page.waitForTimeout(45);
    }

    for (const bullet of block.bullets || []) {
        await page.keyboard.type(`- ${bullet}`, { delay: 10 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(45);
    }

    await page.keyboard.press("Enter");
}

interface LayerNodeRef {
  className?: string | { toString?: () => string };
  getAttribute?: (name: string) => string | null;
  parentElement?: LayerNodeRef | null;
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function addDaedalOption(args: string[], flag: string, value: string) {
    const normalized = normalizeText(value || "");
    if (!normalized || normalized.toLowerCase() === "none") return;
    args.push(flag, normalized);
}

function stringifyTopicSectionForImage(section: string | PreparedTopicSection): string {
    if (typeof section === "string") return section;
    return [
        section.heading,
        section.summary || "",
        section.body,
        ...(section.bullets || []),
    ]
        .map((value) => normalizeText(value))
        .filter(Boolean)
        .join("\n");
}

function generateDaedalTopicImages(sections: Array<string | PreparedTopicSection>, outDir: string): string[] {
    if (!TOPIC_DAEDAL_IMAGE_ENABLED || !HAS_OPENAI_API_KEY) return [];

    const prompt = [
        "다음 블로그 글 내용을 바탕으로 관련 있고 세련된 고품질 블로그 이미지를 3장 생성해줘.",
        "글자, 캡션, 로고, 워터마크, 브랜드 UI, 콜라주 느낌은 금지.",
        "모바일에서 한눈에 들어오는 자연스러운 에디토리얼 이미지로 만들어줘.",
        "",
        sections.map((section) => stringifyTopicSectionForImage(section)).join("\n\n").slice(0, 1500),
    ].join("\n");
    const outPath = path.join(outDir, "daedal.png");
    const args = [prompt, "--quiet", "-o", outPath, "-n", "3"];
    addDaedalOption(args, "--preset", TOPIC_DAEDAL_PRESET);
    addDaedalOption(args, "--size", TOPIC_DAEDAL_SIZE);
    addDaedalOption(args, "--quality", TOPIC_DAEDAL_QUALITY);
    addDaedalOption(args, "--model", TOPIC_DAEDAL_MODEL);

    const result = spawnSync(TOPIC_DAEDAL_BIN, args, {
        encoding: "utf8",
        env: process.env,
        maxBuffer: 64 * 1024 * 1024,
        timeout: TOPIC_DAEDAL_IMAGE_TIMEOUT_MS,
    });
    if (result.status !== 0) {
        const message = normalizeText(result.stderr || result.error?.message || "unknown error");
        console.warn(`   ⚠️ Daedal 이미지 생성 실패: ${message}`);
        return [];
    }

    return (result.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && fs.existsSync(line));
}

function sectionTextForQuality(section: string | PreparedTopicSection): string {
    if (typeof section === "string") return normalizeText(section);
    return normalizeText(
        [
            section.heading,
            section.summary || "",
            section.body,
            ...(section.bullets || []),
        ].join(" ")
    );
}

function assertPublishableContent(content: StoredPublishPayload) {
    const title = normalizeText(content.title || "");
    const sectionTexts = content.sections.map((section) => sectionTextForQuality(section)).filter(Boolean);
    const bodyLength = sectionTexts.join(" ").length;
    const hashtags = content.hashtags.map((tag) => normalizeText(tag)).filter(Boolean);
    const joined = sectionTexts.join("\n");
    const failures: string[] = [];

    if (!title || /추천 정보$/i.test(title)) {
        failures.push("제목이 비어 있거나 더미 제목입니다");
    }
    if (sectionTexts.length < 3) {
        failures.push(`섹션 수가 부족합니다(${sectionTexts.length}/3)`);
    }
    if (bodyLength < 800) {
        failures.push(`본문 분량이 부족합니다(${bodyLength}/800자)`);
    }
    if (hashtags.length < 3) {
        failures.push(`해시태그가 부족합니다(${hashtags.length}/3)`);
    }
    if (/이미지\s*\d+\s*에 대한 설명입니다|관련 내용입니다|스타일이 적용되었습니다/i.test(joined)) {
        failures.push("더미/플레이스홀더 문장이 포함되어 있습니다");
    }

    if (failures.length > 0) {
        throw new Error(`발행 품질 기준 미달: ${failures.join(", ")}`);
    }
}

function compactUiText(value: string): string {
    return value.replace(/\s+/g, "").trim();
}

function isReservedPostsListText(value: string): boolean {
    const compact = compactUiText(value);
    return /예약발행\d+건/.test(compact) || /예약발행글/.test(compact) || /(목록|내역|리스트|관리)/.test(compact);
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
    let mode: PublishMode = args.includes("--publish") ? "now" : "draft";
    let scheduledDateInput: string | null = null;

    for (const arg of args) {
        if (arg.startsWith("--publish-mode=") || arg.startsWith("--publishMode=")) {
            const next = arg.split("=")[1]?.trim().toLowerCase();
            mode = next === "schedule" ? "schedule" : next === "now" ? "now" : "draft";
            continue;
        }

        if (arg.startsWith("--scheduled-date=") || arg.startsWith("--scheduledDate=")) {
            scheduledDateInput = arg.split("=")[1]?.trim() ?? null;
        }
    }

    if (mode !== "schedule") {
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

async function setNaverTextFormat(
    page: Page,
    format: "text" | "sectionTitle"
): Promise<boolean> {
    const openMenu = async () =>
        clickFirstVisible(page, [
            'button[data-name="text-format"]',
            'button:has-text("문단 서식 변경")',
            'button:has-text("본문")',
            'button:has-text("소제목")',
        ]);

    const optionSelectors =
        format === "sectionTitle"
            ? [
                'button[data-name="text-format"][data-value="sectionTitle"]',
                "button.se-toolbar-option-text-format-sectionTitle-button",
                '.se-toolbar-option-text-format button[data-value="sectionTitle"]',
                'button:has-text("소제목")',
            ]
            : [
                'button[data-name="text-format"][data-value="text"]',
                "button.se-toolbar-option-text-format-text-button",
                '.se-toolbar-option-text-format button[data-value="text"]',
                'button:has-text("본문")',
            ];

    for (let attempt = 0; attempt < 3; attempt += 1) {
        await openMenu();
        const picked = await clickFirstVisible(page, optionSelectors);
        if (!picked) {
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(120);
            continue;
        }

        await page.waitForTimeout(160);

        const toolbarLabel = (
            (await page
                .locator('button[data-name="text-format"]')
                .first()
                .innerText()
                .catch(() => "")) || ""
        )
            .replace(/\s+/g, " ")
            .trim();

        if (format === "sectionTitle" && toolbarLabel.includes("소제목")) {
            return true;
        }
        if (format === "text" && toolbarLabel.includes("본문")) {
            return true;
        }
    }

    return false;
}

async function insertNaverHorizontalDivider(page: Page): Promise<boolean> {
    const clicked = await clickFirstVisible(page, [
        'button[data-name="horizontal-line"][data-value="default"]',
        'button[data-name="horizontal-line"]',
        'button[aria-label*="구분선"]',
        'button:has-text("구분선")',
    ]);

    if (!clicked) return false;
    await page.waitForTimeout(180);
    return true;
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

function isPublishedUrl(url: string): boolean {
  return isTopicPublishedUrl(url, NAVER_BLOG_ID);
}

async function waitForScheduleSubmission(
  _page: Page,
  scheduledDate: Date,
  tracker: ScheduleSubmissionTracker,
): Promise<void> {
  if (await waitForConfirmedScheduleSubmission(tracker)) return;
  throw new Error(`[NAVER_SCHEDULE_UNCONFIRMED] 예약 승인 및 식별자를 확인하지 못했습니다. (목표일: ${formatDateYmd(scheduledDate)})`);
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

function parseDatepickerYearMonth(titleText: string): { year: number; month: number } | null {
    const normalized = titleText.replace(/\s+/g, " ").trim();
    const match = normalized.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
    if (!match) return null;
    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    return { year, month };
}

function compareYearMonth(
    left: { year: number; month: number },
    right: { year: number; month: number }
): number {
    if (left.year !== right.year) return left.year - right.year;
    return left.month - right.month;
}

async function trySetScheduleDateViaDatepicker(page: Page, scheduledDate: Date): Promise<boolean> {
    const ymd = formatDateYmd(scheduledDate);
    const targetYearMonth = {
        year: scheduledDate.getFullYear(),
        month: scheduledDate.getMonth() + 1,
    };
    const targetDay = String(scheduledDate.getDate());
    const panel = await getSchedulePanelLocator(page);
    const dateInput = panel
        .locator('div[class*="time_setting" i] input.input_date__QmA0s, div[class*="date" i] input.input_date__QmA0s, input.input_date__QmA0s')
        .first();

    if (!(await dateInput.isVisible().catch(() => false))) {
        return false;
    }

    await dateInput.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(250);
    const datepicker = page.locator(".ui-datepicker:visible").first();
    if (!(await datepicker.isVisible().catch(() => false))) {
        return false;
    }

    console.log("      - 예약 날짜 입력 시도: datepicker");

    let reachedTargetMonth = false;
    for (let step = 0; step < 24; step += 1) {
        const titleText = ((await datepicker.locator(".ui-datepicker-title").first().textContent().catch(() => "")) || "")
            .replace(/\s+/g, " ")
            .trim();
        const currentYearMonth = parseDatepickerYearMonth(titleText);
        if (!currentYearMonth) {
            break;
        }

        const delta = compareYearMonth(currentYearMonth, targetYearMonth);
        if (delta === 0) {
            reachedTargetMonth = true;
            break;
        }

        if (delta > 0) {
            const prevButton = datepicker
                .locator(".ui-datepicker-prev:not(.ui-state-disabled), .ui-datepicker-month-nav.ui-datepicker-prev:not(.ui-state-disabled)")
                .first();
            if (!(await prevButton.isVisible().catch(() => false))) break;
            await prevButton.click({ timeout: 1200 }).catch(() => {});
        } else {
            const nextButton = datepicker
                .locator(".ui-datepicker-next:not(.ui-state-disabled), .ui-datepicker-month-nav.ui-datepicker-next:not(.ui-state-disabled)")
                .first();
            if (!(await nextButton.isVisible().catch(() => false))) break;
            await nextButton.click({ timeout: 1200 }).catch(() => {});
        }
        await page.waitForTimeout(160);
    }

    if (!reachedTargetMonth) {
        return false;
    }

    const dayCandidates = [
        `table td:not(.ui-state-disabled) button.ui-state-default:text-is("${targetDay}")`,
        `table td:not(.ui-state-disabled) a.ui-state-default:text-is("${targetDay}")`,
        `button.ui-state-default:text-is("${targetDay}")`,
        `a.ui-state-default:text-is("${targetDay}")`,
    ];

    for (const selector of dayCandidates) {
        const dayButton = datepicker.locator(selector).first();
        if (!(await dayButton.isVisible().catch(() => false))) continue;
        await dayButton.click({ timeout: 1200 }).catch(() => {});
        await page.waitForTimeout(220);
        const applied = await dateInput.inputValue().catch(() => "");
        if (isScheduleDateMatch(applied, ymd)) {
            return true;
        }
    }

    return false;
}

async function hasVisibleScheduleDateInput(page: Page): Promise<boolean> {
    const selectors = [
        'div[class*="layer_publish" i] input.input_date__QmA0s',
        'div[class*="layer_content_set_publish" i] input.input_date__QmA0s',
        'div[class*="layer_publish" i] input[class*="date" i]',
        'div[class*="layer_content_set_publish" i] input[class*="date" i]',
        '.publish_layer input[type="date"]',
        '[role="dialog"] input[type="date"]',
        '.publish_layer input[class*="date" i]',
        '[role="dialog"] input[class*="date" i]',
        '.publish_layer input[placeholder*="날짜"]',
        '[role="dialog"] input[placeholder*="날짜"]',
        '.publish_layer input[name*="date" i]',
        '[role="dialog"] input[name*="date" i]',
        'div[class*="layer_publish" i] select',
        'div[class*="layer_content_set_publish" i] select',
        '.publish_layer select',
        '[role="dialog"] select',
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
    const panel = await getSchedulePanelLocator(page);
    const candidateValues = [dottedSpaced, dottedSpacedNoPad, dotted, dottedNoPad, ymd, slash];
    const panelInputSelectors = [
        'div[class*="time_setting" i] input.input_date__QmA0s',
        'div[class*="date" i] input.input_date__QmA0s',
        "input.input_date__QmA0s",
        'input[title*="예약"]',
        'input[placeholder*="날짜"]',
        'input[type="date"]',
        'input[class*="date" i]',
    ];
    const fallbackInputSelectors = [
        'div[class*="layer_publish" i] input.input_date__QmA0s',
        'div[class*="layer_content_set_publish" i] input.input_date__QmA0s',
        '.publish_layer input.input_date__QmA0s',
        '[role="dialog"] input.input_date__QmA0s',
        'div[class*="layer_publish" i] input[class*="date" i]',
        'div[class*="layer_content_set_publish" i] input[class*="date" i]',
    ];

    const contexts: Array<{ name: string; root: Pick<Page, "locator"> | Pick<Locator, "locator">; selectors: string[] }> = [
        { name: "panel", root: panel, selectors: panelInputSelectors },
        { name: "global", root: page, selectors: fallbackInputSelectors },
    ];

    const datepickerAppliedFirst = await trySetScheduleDateViaDatepicker(page, scheduledDate);
    if (datepickerAppliedFirst) {
        return true;
    }

    for (const { name, root, selectors } of contexts) {
        for (const selector of selectors) {
            const locators = root.locator(selector);
            const count = Math.min(await locators.count().catch(() => 0), 6);
            for (let i = 0; i < count; i += 1) {
                const locator = locators.nth(i);
                const visible = await locator.isVisible().catch(() => false);
                if (!visible) continue;

                const type = ((await locator.getAttribute("type").catch(() => "")) || "").toLowerCase();
                const values = type === "date" ? [ymd] : candidateValues;
                console.log(`      - 예약 날짜 입력 시도: ${name}:${selector}${count > 1 ? `#${i + 1}` : ""}`);

                for (const value of values) {
                    const finalValue = await setInputValueWithNativeEvents(locator, value);
                    await page.waitForTimeout(180);
                    if (isScheduleDateMatch(finalValue, ymd)) {
                        return true;
                    }
                }
            }
        }
    }

    const datepickerAppliedLast = await trySetScheduleDateViaDatepicker(page, scheduledDate);
    if (datepickerAppliedLast) {
        return true;
    }

    const year = String(scheduledDate.getFullYear());
    const month = String(scheduledDate.getMonth() + 1);
    const day = String(scheduledDate.getDate());

    const yearSelect = page.locator('select[name*="year" i], select[id*="year" i], select[class*="year" i]').first();
    const monthSelect = page.locator('select[name*="month" i], select[id*="month" i], select[class*="month" i]').first();
    const daySelect = page.locator('select[name*="day" i], select[id*="day" i], select[class*="day" i]').first();

    const hasYearSelect = await yearSelect.isVisible().catch(() => false);
    const hasMonthSelect = await monthSelect.isVisible().catch(() => false);
    const hasDaySelect = await daySelect.isVisible().catch(() => false);

    if (hasYearSelect && hasMonthSelect && hasDaySelect) {
        console.log("      - 예약 날짜 입력 시도: year/month/day select");
        await yearSelect.selectOption([{ value: year }, { label: year }], { timeout: 1200 }).catch(() => {});
        await monthSelect
            .selectOption([{ value: month }, { value: month.padStart(2, "0") }, { label: month }], {
                timeout: 1200,
            })
            .catch(() => {});
        await daySelect
            .selectOption([{ value: day }, { value: day.padStart(2, "0") }, { label: day }], {
                timeout: 1200,
            })
            .catch(() => {});
        await page.waitForTimeout(250);
        const selectedYear = await yearSelect.inputValue().catch(() => "");
        const selectedMonth = await monthSelect.inputValue().catch(() => "");
        const selectedDay = await daySelect.inputValue().catch(() => "");
        const selectedNormalized = normalizeDateCandidate(
            `${selectedYear}-${selectedMonth}-${selectedDay}`
        );
        if (selectedNormalized === ymd) {
            return true;
        }
    }

    return false;
}

async function trySetScheduleDateInputsFallback(page: Page, scheduledDate: Date): Promise<boolean> {
    const ymd = formatDateYmd(scheduledDate);
    const dotted = ymd.replace(/-/g, ".");
    const [yyyy, mm, dd] = ymd.split("-");
    const dottedSpaced = `${yyyy}. ${mm}. ${dd}`;
    const dottedSpacedNoPad = `${scheduledDate.getFullYear()}. ${scheduledDate.getMonth() + 1}. ${scheduledDate.getDate()}`;
    const dottedNoPad = `${scheduledDate.getFullYear()}.${scheduledDate.getMonth() + 1}.${scheduledDate.getDate()}`;
    const slash = `${yyyy}/${mm}/${dd}`;
    const panel = await getSchedulePanelLocator(page);
    const dialogInputs = panel.locator(
        'div[class*="time_setting" i] input, div[class*="date" i] input, input.input_date__QmA0s, input[type="date"], input[class*="date" i], input[placeholder*="날짜"], input[name*="date" i], input[id*="date" i]'
    );
    const inputCount = Math.min(await dialogInputs.count().catch(() => 0), 30);

    for (let i = 0; i < inputCount; i += 1) {
        const input = dialogInputs.nth(i);
        const visible = await input.isVisible().catch(() => false);
        if (!visible) continue;

        const type = ((await input.getAttribute("type").catch(() => "")) || "").toLowerCase();
        if (["hidden", "checkbox", "radio", "time", "file"].includes(type)) continue;
        const className = ((await input.getAttribute("class").catch(() => "")) || "").toLowerCase();
        const placeholder = ((await input.getAttribute("placeholder").catch(() => "")) || "").toLowerCase();
        const name = ((await input.getAttribute("name").catch(() => "")) || "").toLowerCase();
        const id = ((await input.getAttribute("id").catch(() => "")) || "").toLowerCase();
        const dateSignal = `${className} ${placeholder} ${name} ${id}`;
        if (!/date|day|year|month|날짜|예약/.test(dateSignal)) {
            continue;
        }

        const candidateValues =
            type === "date" ? [ymd] : [dottedSpaced, dottedSpacedNoPad, dotted, dottedNoPad, ymd, slash];
        for (const value of candidateValues) {
            const finalValue = await setInputValueWithNativeEvents(input, value);
            await page.waitForTimeout(180);
            if (isScheduleDateMatch(finalValue, ymd)) {
                console.log(`      - 예약 날짜 fallback 입력 성공(input #${i + 1})`);
                return true;
            }
        }
    }

    return false;
}

async function verifyScheduleDateApplied(page: Page, scheduledDate: Date): Promise<boolean> {
    const ymd = formatDateYmd(scheduledDate);
    const panel = await getSchedulePanelLocator(page);
    const inputs = panel.locator('div[class*="time_setting" i] input.input_date__QmA0s, input.input_date__QmA0s, input[type="date"]');
    const count = Math.min(await inputs.count().catch(() => 0), 20);
    let hasVisibleDateInput = false;

    for (let i = 0; i < count; i += 1) {
        const input = inputs.nth(i);
        const visible = await input.isVisible().catch(() => false);
        if (!visible) continue;
        hasVisibleDateInput = true;
        const value = await input.inputValue().catch(() => "");
        if (isScheduleDateMatch(value, ymd)) {
            return true;
        }
    }

    if (hasVisibleDateInput) {
        return false;
    }

    const visibleNodes = panel.locator("*");
    const nodeCount = Math.min(await visibleNodes.count().catch(() => 0), 200);
    for (let i = 0; i < nodeCount; i += 1) {
        const node = visibleNodes.nth(i);
        const visible = await node.isVisible().catch(() => false);
        if (!visible) continue;
        const text = (((await node.textContent().catch(() => "")) || "").replace(/\s+/g, " ")).trim();
        if (isScheduleDateMatch(text, ymd)) {
            return true;
        }
    }

    return false;
}

async function trySetScheduleTimeInputs(page: Page, scheduledDate: Date): Promise<string | null> {
    console.log(`   [디버그] trySetScheduleTimeInputs 시작`);

    try {
        const hStr = String(scheduledDate.getHours()).padStart(2, "0");
        const mStr = String(scheduledDate.getMinutes()).padStart(2, "0");

        await page.evaluate(({ h, m }: { h: string; m: string }) => {
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
        }, { h: hStr, m: mStr });

        await page.waitForTimeout(500);
        return `${hStr}:${mStr}`;
    } catch {
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
            .locator('label[for="radio_time2"], label:has-text("예약"), .radio_label__mB6ia:has-text("예약")')
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

async function selectScheduleMode(page: Page): Promise<boolean> {
    const panel = await getSchedulePanelLocator(page);
    const reserveRadio = panel
        .locator(
            'input[data-testid="preTimeRadioBtn"], input[name="radio_time"][value="pre"], input#radio_time2, input[type="radio"][value*="reserve" i], input[type="radio"][id*="reserve" i], input[type="radio"][name*="reserve" i]'
        )
        .first();

    if (await reserveRadio.isVisible().catch(() => false)) {
        await reserveRadio.check({ force: true }).catch(async () => {
            await reserveRadio.click({ force: true }).catch(() => {});
        });
        await page.waitForTimeout(180);
        if (await ensureScheduleReserveRadioSelected(page)) {
            return true;
        }
    }

    const exactSelectors = [
        'div[class*="layer_publish" i] label:text-is("예약")',
        'div[class*="layer_content_set_publish" i] label:text-is("예약")',
        '.publish_layer label:text-is("예약")',
        '[role="dialog"] label:text-is("예약")',
        'div[class*="layer_publish" i] [role="radio"]:text-is("예약")',
        'div[class*="layer_content_set_publish" i] [role="radio"]:text-is("예약")',
        '.publish_layer [role="radio"]:text-is("예약")',
        '[role="dialog"] [role="radio"]:text-is("예약")',
        'div[class*="layer_publish" i] [role="tab"]:text-is("예약")',
        'div[class*="layer_content_set_publish" i] [role="tab"]:text-is("예약")',
        '.publish_layer [role="tab"]:text-is("예약")',
        '[role="dialog"] [role="tab"]:text-is("예약")',
    ];

    if (await clickFirstVisible(page, exactSelectors)) {
        await page.waitForTimeout(240);
        if ((await ensureScheduleReserveRadioSelected(page)) || (await hasVisibleScheduleDateInput(page))) {
            return true;
        }
    }

    const clickables = panel.locator('label, button, [role="radio"], [role="tab"], [role="button"]');
    const rankedCandidates: Array<{
        locator: Locator;
        score: number;
        text: string;
        className: string;
    }> = [];
    const count = Math.min(await clickables.count().catch(() => 0), 80);

    for (let i = 0; i < count; i += 1) {
        const candidate = clickables.nth(i);
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) continue;

        const rawText = (await candidate.textContent().catch(() => "")) || "";
        const text = compactUiText(rawText);
        if (!text.includes("예약")) continue;
        if (isReservedPostsListText(text)) continue;

        const className = (await candidate.getAttribute("class").catch(() => "")) || "";
        const role = ((await candidate.getAttribute("role").catch(() => "")) || "").toLowerCase();
        const forAttr = ((await candidate.getAttribute("for").catch(() => "")) || "").toLowerCase();
        const dataTestId = ((await candidate.getAttribute("data-testid").catch(() => "")) || "").toLowerCase();

        if (/(reserve_btn__|save_btn__|save_count_btn__|publish_btn__m9KHH|publish_fold_btn__)/i.test(className)) {
            continue;
        }

        let score = 0;
        if (text === "예약") score += 160;
        if (/radio|tab/.test(role)) score += 70;
        if (forAttr.includes("radio_time2")) score += 90;
        if (dataTestId.includes("pretime")) score += 90;
        if (text.includes("예약") && !text.includes("발행")) score += 40;
        if (/label|radio|tab/.test(className)) score += 25;
        if (text.length <= 4) score += 15;

        rankedCandidates.push({ locator: candidate, score, text, className });
    }

    rankedCandidates.sort((left, right) => right.score - left.score);
    for (const candidate of rankedCandidates.slice(0, 8)) {
        await candidate.locator.click({ force: true }).catch(() => {});
        await page.waitForTimeout(220);
        if ((await ensureScheduleReserveRadioSelected(page)) || (await hasVisibleScheduleDateInput(page))) {
            console.log(`   ✅ 예약 옵션 선택 성공: text="${candidate.text}" class="${candidate.className}"`);
            return true;
        }
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

async function configureSchedulePublish(page: Page, scheduledDate: Date): Promise<Date> {
    console.log(`   🗓️ 예약 발행 옵션 설정 시작: ${formatDateYmd(scheduledDate)}`);
    const scheduleModeSelected = await selectScheduleMode(page);
    if (!scheduleModeSelected) {
        // 스크린샷으로 디버깅 정보 남기기
        try {
            const debugPath = path.join(process.cwd(), 'temp_images', 'debug-schedule-fail.png');
            await page.screenshot({ path: debugPath, fullPage: false });
            console.log(`   📸 디버그 스크린샷 저장: ${debugPath}`);
        } catch {}
        throw new Error("예약 발행 옵션을 찾지 못했습니다. 네이버 편집기 UI가 변경되었을 수 있습니다.");
    }

    console.log(`   ✅ 예약 모드 진입 확인`);

    const reserveSelected = await ensureScheduleReserveRadioSelected(page);
    if (!reserveSelected) {
        await page.waitForTimeout(300);
        if (!(await hasVisibleScheduleDateInput(page))) {
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
        console.log(`   🗓️ 예약 날짜 적용 시도 ${attempt}/3`);
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
        console.log(`   ${dateVerified ? "✅" : "⚠️"} 예약 날짜 검증 ${dateVerified ? "성공" : "재시도 필요"}`);
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

function parseIdentifierArg(args: string[], prefix: "--task-id=" | "--post-id="): string | null {
    const matched = args.find((arg) => arg.startsWith(prefix));
    const value = matched?.slice(prefix.length).trim();
    return value || null;
}

function mapRawTaskType(value: string | null | undefined): PostCategory {
    if (value === "knowledge" || value === "travel" || value === "golf" || value === "product") {
        return value;
    }
    if (value === "여행") return "travel";
    if (value === "골프") return "golf";
    if (value === "리뷰") return "product";
    return "knowledge";
}

function toStoredPublishPayload(raw: string | null): StoredPublishPayload | null {
    const prepared = parsePreparedTopicContent(raw);
    if (prepared) {
        return {
            title: prepared.title,
            lead: prepared.lead,
            highlights: prepared.highlights,
            sections: prepared.sections,
            hashtags: prepared.hashtags,
        };
    }

    const stored = parseStoredTopicPayload(raw);
    if (!stored) return null;

    return {
        title: stored.title,
        lead: stored.lead,
        highlights: stored.highlights,
        sections: stored.sections,
        hashtags: stored.hashtags,
    };
}

function imageRoleRank(role: string | null | undefined): number {
    if ((role || "").toLowerCase() === "hero") return 0;
    if ((role || "").toLowerCase() === "inline") return 1;
    return 2;
}

function imagePathOrderHint(imagePath: string | null | undefined): number {
    if (!imagePath) return Number.MAX_SAFE_INTEGER;
    const base = path.basename(imagePath);
    const matched = base.match(/(?:hero|inline)-(\d+)\.[a-z0-9]+$/i);
    return matched ? Number.parseInt(matched[1], 10) : Number.MAX_SAFE_INTEGER;
}

function timestampOrderHint(value: Date | string | null | undefined): number {
    if (!value) return Number.MAX_SAFE_INTEGER;
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function sortDraftImages<T extends DraftImageRecord>(images: T[]): T[] {
    return images.slice().sort((left, right) => {
        const roleDiff = imageRoleRank(left.role) - imageRoleRank(right.role);
        if (roleDiff !== 0) return roleDiff;

        const orderDiff = imagePathOrderHint(left.localPath) - imagePathOrderHint(right.localPath);
        if (orderDiff !== 0) return orderDiff;

        return timestampOrderHint(left.createdAt) - timestampOrderHint(right.createdAt);
    });
}

async function loadPublishContextFromDb(runtimeOptions: RuntimePublishOptions): Promise<LoadedPublishContext | null> {
    const cliArgs = process.argv.slice(2);
    const explicitTaskId = parseIdentifierArg(cliArgs, "--task-id=");
    const explicitPostId = parseIdentifierArg(cliArgs, "--post-id=");
    const firstArg = process.argv[2];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let taskId = explicitTaskId;
    const postId = explicitPostId;

    if (!taskId && !postId && firstArg && uuidRegex.test(firstArg)) {
        taskId = firstArg;
    }

    if (!taskId && !postId) {
        return null;
    }

    const prisma = new PrismaClient();
    try {
        if (taskId) {
            const task = await prisma.topicPostTask.findUnique({
                where: { id: taskId },
            });
            if (!task) {
                throw new Error(`태스크를 찾을 수 없습니다: ${taskId}`);
            }
            if (task.pipelineStage === "OUTCOME_UNKNOWN" || ["SCHEDULED", "PUBLISHED"].includes(task.status)) {
                throw new Error("이미 제출된 작업입니다. 실제 발행/예약 결과 확인 및 수동 복구가 필요합니다. 재준비로 해제할 수 없습니다.");
            }

            const preparedContent = toStoredPublishPayload(task.preparedContentJson);
            if (!preparedContent) {
                throw new Error("준비된 주제글 콘텐츠가 없습니다. prepare 단계가 필요합니다.");
            }
            const imagePlan = parseTopicVisualPlan(task.imagePlanJson);

            const selectedDraft = task.selectedDraftId
                ? await prisma.topicDraft.findUnique({
                    where: { id: task.selectedDraftId },
                    include: { images: true, campaign: { select: { sourceUrls: true } } },
                })
                : null;
            const usableImages = sortDraftImages(selectedDraft?.images || []).filter((image) => {
                try { const stat = fs.statSync(image.localPath || ""); return stat.isFile() && stat.size > 0; } catch { return false; }
            });
            const readiness = getTopicTaskPublishReadiness({
                selectedDraftId: task.selectedDraftId,
                preparedContentJson: task.preparedContentJson,
                preparedImages: usableImages,
            });
            if (!readiness.canPublish) throw new Error(readiness.reason || "이미지 발행 준비 실패");
            const contentReadiness = getTopicTaskContentReadiness({
                ...task,
                sourceUrls: parseTopicSourceUrls(selectedDraft?.campaign.sourceUrls),
            });
            if (!contentReadiness.canPublish) throw new Error(contentReadiness.reason || "본문 발행 준비 실패");
            const imagePaths = usableImages
                .map((image) => image.localPath)
                .filter((imagePath): imagePath is string => Boolean(imagePath && fs.existsSync(imagePath)));

            return {
                taskId,
                postId: null,
                args: {
                    type: mapRawTaskType(task.type),
                    topic: task.preparedTitle || task.topic,
                    keywords: task.keywords ? task.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean) : [],
                    style: task.memo || undefined,
                    category: task.categoryNo || undefined,
                    publishMode: runtimeOptions.mode,
                    scheduledDate: runtimeOptions.scheduledDateInput ? runtimeOptions.scheduledDate?.toISOString() : undefined,
                    rawScheduledDate: runtimeOptions.scheduledDateInput ?? undefined,
                    details: {},
                },
                preparedContent,
                imagePaths,
                imagePlan,
            };
        }

        const post = await prisma.post.findUnique({
            where: { id: postId! },
        });
        if (!post) {
            throw new Error(`예약 Post를 찾을 수 없습니다: ${postId}`);
        }
        if (["OUTCOME_UNKNOWN", "SUCCESS"].includes(post.status)) {
            throw new Error("이미 제출된 Post입니다. 먼저 제출 결과를 확인하세요.");
        }

        const seed = post.topicSeed
            ? JSON.parse(post.topicSeed) as {
                draftId?: string;
                type?: string;
                style?: string;
                category?: string | null;
                contentJson?: string;
            }
            : {};
        const draft = seed.draftId
            ? await prisma.topicDraft.findUnique({
                where: { id: seed.draftId },
                include: { images: true, campaign: { select: { sourceUrls: true } } },
            })
            : null;

        const preparedContent =
            toStoredPublishPayload(draft?.contentJson || null) ||
            toStoredPublishPayload(typeof seed.contentJson === "string" ? seed.contentJson : null) ||
            toStoredPublishPayload(post.contentHtml);
        if (!preparedContent) {
            throw new Error("발행에 사용할 저장된 콘텐츠를 찾을 수 없습니다.");
        }

        const usableImages = sortDraftImages(draft?.images || []).filter((image) => {
            try { const stat = fs.statSync(image.localPath || ""); return stat.isFile() && stat.size > 0; } catch { return false; }
        });
        const readiness = getTopicTaskPublishReadiness({
            selectedDraftId: draft?.id || null,
            preparedContentJson: draft?.contentJson || (typeof seed.contentJson === "string" ? seed.contentJson : post.contentHtml),
            preparedImages: usableImages,
        });
        if (!readiness.canPublish) throw new Error(readiness.reason || "이미지 발행 준비 실패");
        const contentReadiness = getTopicTaskContentReadiness({
            topic: post.title,
            type: seed.type,
            preparedContentJson: draft?.contentJson || (typeof seed.contentJson === "string" ? seed.contentJson : post.contentHtml),
            sourceUrls: parseTopicSourceUrls(draft?.campaign.sourceUrls),
        });
        if (!contentReadiness.canPublish) throw new Error(contentReadiness.reason || "본문 발행 준비 실패");
        const imagePaths = usableImages
            .map((image) => image.localPath)
            .filter((imagePath): imagePath is string => Boolean(imagePath && fs.existsSync(imagePath)));

        return {
            taskId: null,
            postId: post.id,
            args: {
                type: mapRawTaskType(seed.type || "knowledge"),
                topic: post.title || preparedContent.title,
                keywords: (() => {
                    try {
                        const parsed = post.keywords ? JSON.parse(post.keywords) : [];
                        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
                    } catch {
                        return [];
                    }
                })(),
                style: post.tone || (typeof seed.style === "string" ? seed.style : undefined),
                category: post.category || (typeof seed.category === "string" ? seed.category : undefined),
                publishMode: runtimeOptions.mode,
                scheduledDate: runtimeOptions.scheduledDateInput ? runtimeOptions.scheduledDate?.toISOString() : undefined,
                rawScheduledDate: runtimeOptions.scheduledDateInput ?? undefined,
                details: {},
            },
            preparedContent,
            imagePaths,
            imagePlan: null,
        };
    } finally {
        await prisma.$disconnect();
    }
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
        // The prompt asked for "drafts" which might just be an array of strings,
        // or an array of objects. We handle both.
        const body = normalizeOutputText(block.body ?? block.draft ?? block.content);
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

  for (const block of [...blocks].reverse()) {
    try {
      const candidate = JSON.parse(block);
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        normalizeOutputText((candidate as Record<string, unknown>).title ?? (candidate as Record<string, unknown>).headline).length > 0 &&
        parseSectionsFromLLM((candidate as Record<string, unknown>).sections ?? (candidate as Record<string, unknown>).drafts).length > 0
      ) {
        parsed = candidate;
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
    const fallbackSections = parseSectionsFromLLM(record?.sections ?? record?.drafts ?? record?.content ?? record?.body);
  const fallbackHashtags = parseHashtagsFromLLM(record?.hashtags ?? record?.tags);

  if (!fallbackTitle && fallbackSections.length === 0 && fallbackHashtags.length === 0) {
        const matched = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!matched) {
            console.error("=== Parsing failed ===");
            console.error(raw);
      throw new Error("콘텐츠 파싱 실패");
    }

        try {
    parsed = JSON.parse(matched[0]);
        } catch (e) {
            console.error("=== JSON parse failed ===");
            console.error(matched[0]);
            throw e;
        }
    const fallbackRecord = parsed as Record<string, unknown>;
    const title = normalizeOutputText(
      fallbackRecord?.title ?? fallbackRecord?.headline ?? fallbackRecord?.name,
    );
    const sections = parseSectionsFromLLM(
      fallbackRecord?.sections ?? fallbackRecord?.drafts ?? fallbackRecord?.content ?? fallbackRecord?.body,
    );
    const hashtags = parseHashtagsFromLLM(fallbackRecord?.hashtags ?? fallbackRecord?.tags);

    return {
      title,
      sections,
      hashtags,
    };
  }

  // sections가 빈 배열이면 원본 텍스트를 문단 단위로 분할하여 폴백
  const finalSections = fallbackSections.length > 0
    ? fallbackSections
    : raw.split(/\n\n+/).map(chunk => chunk.trim()).filter(s => s.length > 0);

  return {
    title: fallbackTitle || "주제 글",
    sections: finalSections,
    hashtags: fallbackHashtags,
  };
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
    const baseStyleGuide = buildHumanMobileStyleGuide();

    if (!style) {
        return baseStyleGuide;
    }

    return `
${baseStyleGuide}

## 글쓰기 스타일 가이드 (이 스타일을 반드시 따라주세요!)

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

위 스타일을 참고하되, 모바일에서 읽기 좋은 자연스러운 블로그 문체를 우선하세요.
`;
}

// ============================================
// LLM으로 글 생성 (에이전틱 다단계 고도화 파이프라인 - V2)
// ============================================
import { createChatGPTContext, openFreshChatGPTTarget, openChatGPTTarget, sendPromptToChatGPT, ChatGPTContextHandle, downloadChatGPTImages, isChatGPTGenerating } from "./lib/chatgpt-browser";
import { runCodexDraft } from "./lib/codex-draft-provider";


async function generateAdvancedContent(
    args: TopicArgs,
    styleGuide: string
): Promise<{ title: string; sections: string[]; hashtags: string[]; imagePrompts?: unknown[] }> {
    if (!ALLOW_CHATGPT_BROWSER_MODE) {
        throw new Error("ChatGPT 브라우저 생성은 비활성화되어 있습니다. 준비된 주제글만 발행하거나 API 파이프라인을 사용하세요.");
    }

    console.log("\n🚀 [Topic Agent V2] GPT 단일 패스 콘텐츠 생성 시작...");

    const template = getTemplate(args.type);
    const baseKeywords = args.keywords.length > 0 ? args.keywords.join(", ") : template.seoKeywords.join(", ");
    try {
        const contentPrompt = [
            "너는 네이버 블로그 상식/정보 글을 쓰는 한국어 전문 에디터다.",
            "아래 조건을 보고 질문하지 말고 최종 발행 가능한 글 JSON만 작성해라.",
            "마크다운 코드펜스, 설명문, 사과문, 진행 여부 확인은 금지한다.",
            "",
            `주제: ${args.topic}`,
            `카테고리: ${categoryNames[args.type]}`,
            `핵심 키워드: ${baseKeywords}`,
            styleGuide ? `스타일 가이드:\n${styleGuide}` : "",
            "",
            "품질 기준:",
            "- title은 검색 의도에 맞는 자연스러운 한국어 제목 1개",
            "- sections는 정확히 4개",
            "- 각 section은 heading과 body를 가진 객체",
            "- 각 body는 250-450자, 2-4개의 짧은 문단으로 구성",
            "- 문장은 25-45자 안팎으로 짧게 끊고 1-2문장마다 줄바꿈",
            "- 모바일 블로그 앱에서 직접 쓴 글처럼 부드럽고 자연스럽게 작성",
            "- 같은 어미와 같은 문장 구조를 반복하지 않기",
            "- '이미지 1에 대한 설명입니다', '추천 정보', '관련 내용입니다' 같은 더미 문장 금지",
            "- 해시태그는 5~8개, # 포함 가능",
            "- 과장 광고, 근거 없는 보장 표현, AI가 썼다는 표현 금지",
            "- '결론적으로', '종합적으로', '본 포스팅에서는' 같은 기계적인 표현 금지",
            "",
            "반드시 아래 JSON 스키마만 반환:",
            JSON.stringify(
                {
                    title: "제목",
                    sections: [
                        { heading: "소제목 1", body: "본문" },
                        { heading: "소제목 2", body: "본문" },
                        { heading: "소제목 3", body: "본문" },
                        { heading: "소제목 4", body: "본문" },
                    ],
                    hashtags: ["#태그1", "#태그2", "#태그3", "#태그4", "#태그5"],
                },
                null,
                2,
            ),
        ]
            .filter(Boolean)
            .join("\n");

        console.log("   [1/1] GPT에 최종 JSON 초안 요청...");
        const raw = await runCodexDraft({
            systemPrompt: "한국어 블로그 원고를 요청된 JSON 형식으로만 작성하세요.",
            userPrompt: contentPrompt,
        });
        const parsed = parseLLMOutput(raw);
        const content = {
            title: parsed.title,
            sections: parsed.sections.map((section) => stringifyTopicSectionForImage(section)),
            hashtags: parsed.hashtags,
        };
        assertPublishableContent(content);

        console.log("   ✅ GPT 글 생성 및 품질 검사 완료");
        return {
            ...content,
            imagePrompts: [],
        };

    } catch (error) {
        console.error("❌ ChatGPT 파이프라인 에러:", error);
        throw error;
    }
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
            const imageSelectors = [
                '.se-image-resource',
                '.se-component-image img',
                '.se-section-image img',
                '[data-module="image"] img',
            ];
            const countImages = async () => {
                let total = 0;
                for (const selector of imageSelectors) {
                    total += await page.locator(selector).count().catch(() => 0);
                }
                return total;
            };
            const beforeCount = await countImages();
            const [fileChooser] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
                imageBtn.click()
            ]);

            if (fileChooser) {
                await fileChooser.setFiles(imagePath);
                const uploadConfirmed = await page.waitForFunction(
                    ({ selectors, before }) =>
                        selectors.some((selector) => document.querySelectorAll(selector).length > before),
                    { selectors: imageSelectors, before: beforeCount },
                    { timeout: 15000 }
                ).then(() => true).catch(() => false);

                if (!uploadConfirmed) {
                    await page.waitForTimeout(2500);
                    const afterCount = await countImages();
                    return afterCount > beforeCount;
                }

                await page.waitForTimeout(800);
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
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await inputTitleOnce(page, title);
            return;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (attempt >= 3 || !/context was destroyed|navigation|Target closed/i.test(message)) {
                throw error;
            }
            console.log(`   🔄 제목 입력 중 에디터 리로드 감지, 재시도 ${attempt + 1}/3`);
            await page.waitForLoadState("domcontentloaded").catch(() => {});
            await page.waitForTimeout(1200);
            await closeAllPopups(page);
        }
    }
}

async function inputTitleOnce(page: Page, title: string): Promise<void> {
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

    // 만약 여전히 제목 입력이 안됐다면 evaluate로 강제입력 시도
    await page.evaluate((t: string) => {
        const titleEl = document.querySelector('.se-documentTitle-editView, .se-title-input, .se-documentTitle, .se-document-title, .se-input-title');
        if (titleEl) {
            titleEl.textContent = t;
        }
    }, title);

    await page.keyboard.type(title, { delay: 30 });
}

function buildHeuristicSectionImageMap(
    sections: Array<string | PreparedTopicSection>,
    inlineImagePaths: string[],
    blockedSectionIndexes: Set<number> = new Set(),
): Map<number, string> {
    const sectionImageMap = new Map<number, string>();
    if (inlineImagePaths.length === 0 || sections.length === 0) {
        return sectionImageMap;
    }

    const preferredKinds: Array<PreparedTopicSection["kind"]> = ["comparison", "proof", "scene", "mistake"];
    const usedSectionIndexes = new Set<number>(blockedSectionIndexes);
    let imageCursor = 0;

    for (const preferredKind of preferredKinds) {
        if (imageCursor >= inlineImagePaths.length) break;
        const sectionIndex = sections.findIndex((section, index) =>
            index > 0 &&
            index < sections.length - 1 &&
            !usedSectionIndexes.has(index) &&
            typeof section !== "string" &&
            section.kind === preferredKind,
        );
        if (sectionIndex >= 0) {
            sectionImageMap.set(sectionIndex, inlineImagePaths[imageCursor]);
            usedSectionIndexes.add(sectionIndex);
            imageCursor += 1;
        }
    }

    for (let index = 1; index < sections.length - 1 && imageCursor < inlineImagePaths.length; index += 1) {
        if (usedSectionIndexes.has(index)) continue;
        sectionImageMap.set(index, inlineImagePaths[imageCursor]);
        usedSectionIndexes.add(index);
        imageCursor += 1;
    }

    return sectionImageMap;
}

function buildPlannedSectionImageMap(
    sections: Array<string | PreparedTopicSection>,
    inlineImagePaths: string[],
    imagePlan: TopicVisualPlan | null,
): Map<number, string> {
    const sectionImageMap = new Map<number, string>();
    if (!imagePlan || inlineImagePaths.length === 0) {
        return sectionImageMap;
    }

    const sectionSlotMap = new Map<string, number>();
    sections.forEach((section, index) => {
        if (typeof section === "string") return;
        const slotId = normalizeText(section.imageSlotId || "");
        if (slotId) {
            sectionSlotMap.set(slotId, index);
        }
    });

    imagePlan.inline.forEach((item, index) => {
        const imagePath = inlineImagePaths[index];
        if (!imagePath) return;

        const sectionIndexFromPlan =
            typeof item.sectionIndex === "number" && Number.isInteger(item.sectionIndex)
                ? item.sectionIndex
                : null;
        const sectionIndexFromSlot = normalizeText(item.slotId || "")
            ? sectionSlotMap.get(normalizeText(item.slotId || "")) ?? null
            : null;
        const targetIndex = sectionIndexFromPlan ?? sectionIndexFromSlot;

        if (targetIndex === null) return;
        if (targetIndex < 0 || targetIndex >= sections.length) return;
        sectionImageMap.set(targetIndex, imagePath);
    });

    return sectionImageMap;
}

function buildSectionImageMap(
    sections: Array<string | PreparedTopicSection>,
    inlineImagePaths: string[],
    imagePlan: TopicVisualPlan | null,
): Map<number, string> {
    const plannedMap = buildPlannedSectionImageMap(sections, inlineImagePaths, imagePlan);
    const plannedImageSet = new Set(plannedMap.values());
    const remainingImagePaths = inlineImagePaths.filter((imagePath) => !plannedImageSet.has(imagePath));
    const heuristicMap = buildHeuristicSectionImageMap(
        sections,
        remainingImagePaths,
        new Set(plannedMap.keys()),
    );

    return new Map([...plannedMap.entries(), ...heuristicMap.entries()]);
}

async function inputContent(
    page: Page,
    sections: Array<string | PreparedTopicSection>,
    hashtags: string[],
    imagePaths?: string[],
    imagePlan?: TopicVisualPlan | null,
    lead?: string,
    highlights?: string[],
): Promise<void> {
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

    const safeImagePaths = imagePaths ?? [];
    const heroImagePath =
        safeImagePaths.find((imagePath) => /(^|\/)hero-\d+\.[a-z0-9]+$/i.test(imagePath)) || null;
    const inlineImagePaths = safeImagePaths.filter((imagePath) => imagePath !== heroImagePath);

    if (heroImagePath) {
        console.log(`   [hero] 🖼️ 대표 이미지 업로드...`);
        await uploadOneImage(page, heroImagePath);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        await page.keyboard.press("End");
        await page.waitForTimeout(100);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);
    }

    const sectionImageMap = buildSectionImageMap(sections, inlineImagePaths, imagePlan || null);
    const prefixBlocks = preparedSectionsToPublishBlocks({
        title: "",
        lead,
        highlights,
        sections: [],
        hashtags: [],
    });

    for (let i = 0; i < prefixBlocks.length; i += 1) {
        console.log(`   [intro ${i + 1}/${prefixBlocks.length}] 도입 입력...`);
        await inputTopicSectionBlock(page, prefixBlocks[i]);
        await page.waitForTimeout(300);
    }

    for (let i = 0; i < sections.length; i++) {
        // 이미지가 있으면 먼저 업로드 (균등 분배)
        const assignedImage = sectionImageMap.get(i);
        if (assignedImage) {
            console.log(`   [${i + 1}/${sections.length}] 🖼️ 이미지 업로드...`);
            await uploadOneImage(page, assignedImage);
            // 이미지 업로드 후 캡션 영역을 안정적으로 벗어남
            // 1) Escape 2번으로 캡션 편집 모드 + 이미지 선택 모두 해제
            await page.keyboard.press("Escape");
            await page.waitForTimeout(200);
            await page.keyboard.press("Escape");
            await page.waitForTimeout(200);
            // 2) 이미지 컴포넌트 아래 본문 영역 끝으로 이동하여 새 줄 시작
            await page.keyboard.press("End");
            await page.waitForTimeout(100);
            await page.keyboard.press("Enter");
            await page.waitForTimeout(300);
        }

        console.log(`   [${i + 1}/${sections.length}] 섹션 입력...`);
        await inputTopicSectionBlock(page, sections[i]);
        await page.waitForTimeout(500);
    }

    // 해시태그 입력
    console.log(`   🏷️ 해시태그 ${hashtags.length}개 입력...`);
    await page.keyboard.press("Enter");
    const normalizedHashtags = hashtags
        .map((tag) => tag.trim().replace(/^#+/, ""))
        .filter(Boolean)
        .map((tag) => `#${tag}`);
    await page.keyboard.type(normalizedHashtags.join(" "), { delay: 20 });
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

async function logScheduleDialogSnapshot(page: Page): Promise<void> {
  try {
    const buttons = page.locator(
      'div[class*="layer_publish" i] button, div[class*="layer_content_set_publish" i] button, [role="dialog"] button, .publish_layer button'
    );
    const inputs = page.locator(
      'div[class*="layer_publish" i] input, div[class*="layer_content_set_publish" i] input, [role="dialog"] input, .publish_layer input'
    );
    const selects = page.locator(
      'div[class*="layer_publish" i] select, div[class*="layer_content_set_publish" i] select, [role="dialog"] select, .publish_layer select'
    );

    const buttonCount = Math.min(await buttons.count().catch(() => 0), 20);
    const inputCount = Math.min(await inputs.count().catch(() => 0), 20);
    const selectCount = Math.min(await selects.count().catch(() => 0), 20);

    console.log("      - 예약 팝업 스냅샷(button)");
    for (let i = 0; i < buttonCount; i += 1) {
      const button = buttons.nth(i);
      const visible = await button.isVisible().catch(() => false);
      if (!visible) continue;
      const text = (((await button.textContent().catch(() => "")) || "").replace(/\s+/g, " ")).trim();
      const className = (await button.getAttribute("class").catch(() => "")) || "";
      console.log(`        [btn ${i + 1}] text="${text}" class="${className}"`);
    }

    console.log("      - 예약 팝업 스냅샷(input)");
    for (let i = 0; i < inputCount; i += 1) {
      const input = inputs.nth(i);
      const visible = await input.isVisible().catch(() => false);
      if (!visible) continue;
      const type = (await input.getAttribute("type").catch(() => "")) || "";
      const placeholder = (await input.getAttribute("placeholder").catch(() => "")) || "";
      const name = (await input.getAttribute("name").catch(() => "")) || "";
      const className = (await input.getAttribute("class").catch(() => "")) || "";
      console.log(
        `        [input ${i + 1}] type="${type}" placeholder="${placeholder}" name="${name}" class="${className}"`
      );
    }

    console.log(`      - 예약 팝업 스냅샷(select): ${selectCount}개`);
  } catch {
    console.log("      - 예약 팝업 스냅샷 수집 실패");
  }
}

async function capturePublishArtifacts(page: Page, reason: string): Promise<void> {
  try {
    const dirPath = path.join(process.cwd(), "logs", "manual", "topic-publish");
    fs.mkdirSync(dirPath, { recursive: true });
    const safeReason = reason.replace(/[^a-zA-Z0-9_-]+/g, "-");
    const baseName = `${Date.now()}-${safeReason}`;
    const screenshotPath = path.join(dirPath, `${baseName}.png`);
    const htmlPath = path.join(dirPath, `${baseName}.html`);

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => "");
    if (html) {
      fs.writeFileSync(htmlPath, html, "utf8");
    }

    console.log(`      - 발행 디버그 스크린샷 저장: ${path.relative(process.cwd(), screenshotPath)}`);
    if (fs.existsSync(htmlPath)) {
      console.log(`      - 발행 디버그 HTML 저장: ${path.relative(process.cwd(), htmlPath)}`);
    }
  } catch {
    console.log("      - 발행 디버그 아티팩트 저장 실패");
  }
}

async function clickFinalPublishButton(page: Page, mode: PublishMode, beforeSubmit?: () => Promise<void>): Promise<boolean> {
  const finalPublishSelectors = [
    'div[class*="layer_publish" i] button[data-testid="seOnePublishBtn"]',
    'div[class*="layer_content_set_publish" i] button[data-testid="seOnePublishBtn"]',
    'button[data-testid="seOnePublishBtn"]',
    'div[class*="layer_publish" i] button.confirm_btn__WEaBq',
    'div[class*="layer_content_set_publish" i] button.confirm_btn__WEaBq',
    'button.confirm_btn__WEaBq',
    'button[class*="confirm_btn"]',
    'button.btn_publish__FvD4K',
    'button[class*="btn_publish"]',
    'div[class*="layer_publish" i] button:has-text("발행")',
    'div[class*="layer_content_set_publish" i] button:has-text("발행")',
    '.publish_layer button[class*="confirm"]',
    '.btn_area button:has-text("발행")',
    '[role="dialog"] button:has-text("발행")',
  ];

  for (const selector of finalPublishSelectors) {
    const button = page.locator(selector).first();
    const visible = await button.isVisible().catch(() => false);
    if (!visible) continue;

    const text = compactUiText((await button.textContent().catch(() => "")) || "");
    const className = (await button.getAttribute("class").catch(() => "")) || "";
    if (mode === "schedule" && (isReservedPostsListText(text) || /reserve_btn__/i.test(className))) {
      continue;
    }

    await beforeSubmit?.();
    await button.click({ force: true });
    return true;
  }

  const publishButtons = await page.$$("button");
  const rankedCandidates: Array<{
    button: {
      click: (options?: { force?: boolean }) => Promise<void>;
    };
    score: number;
    text: string;
    className: string;
  }> = [];

  for (const button of publishButtons) {
    const isVisible = await button.isVisible().catch(() => false);
    if (!isVisible) continue;

    const rawText = (await button.textContent().catch(() => "")) || "";
    const text = compactUiText(rawText);
    const className = (await button.getAttribute("class").catch(() => "")) || "";
    if (!text) continue;

    const inPublishLayer = await button
      .evaluate((element) => {
        let node = element as unknown as LayerNodeRef | null;
        while (node) {
          const className =
            typeof node.className === "string"
              ? node.className
              : node.className?.toString?.() || "";
          const role = node.getAttribute?.("role") || "";
          if (
            /layer_publish|layer_content_set_publish|publish_layer/i.test(className) ||
            role.toLowerCase() === "dialog"
          ) {
            return true;
          }
          node = node.parentElement ?? null;
        }
        return false;
      })
      .catch(() => false);

    if (className.includes("publish_btn__")) continue;

    if (mode === "schedule") {
      if (!inPublishLayer) continue;
      if (isReservedPostsListText(text)) continue;

      const negativePattern = /(취소|닫기|도움말|가이드|이전|뒤로|임시|저장|목록|관리|내역|설정|건|cancel|close)/i;
      const hardExcludeClass =
        /(reserve_btn__|save_btn__|save_count_btn__|publish_btn__m9KHH|publish_fold_btn__)/i.test(
          className
        );
      if (hardExcludeClass || negativePattern.test(text) || negativePattern.test(className)) {
        continue;
      }

      const hasReserveText = text.includes("예약");
      const hasPublishText =
        text.includes("발행") || text.includes("등록") || text.includes("확인") || text.includes("완료");
      const hasStrongSubmitClass = /(confirm_btn|btn_publish|confirm|publish|submit)/i.test(className);
      const hasWeakScheduleClass = /(reserve|schedule)/i.test(className);

      if (!hasPublishText) continue;
      if (!(hasReserveText || hasStrongSubmitClass)) continue;
      if (hasWeakScheduleClass && !hasStrongSubmitClass && !hasReserveText) continue;

      let score = 0;
      if (text.includes("예약발행")) score += 120;
      if (text.includes("예약등록")) score += 110;
      if (text.includes("예약완료")) score += 90;
      if (text.includes("발행")) score += 50;
      if (text.includes("등록")) score += 40;
      if (text.includes("확인")) score += 30;
      if (hasStrongSubmitClass) score += 45;
      if (/confirm_btn|btn_publish|submit/i.test(className)) score += 35;
      if (hasWeakScheduleClass) score += 10;
      if (inPublishLayer) score += 60;
      if (text === "예약" || text === "발행") score -= 20;

      rankedCandidates.push({
        button,
        score,
        text,
        className,
      });
      continue;
    }

    if (!text.includes("발행") || text.includes("예약")) continue;

    await beforeSubmit?.();
    await button.click({ force: true });
    return true;
  }

  if (mode === "schedule" && rankedCandidates.length > 0) {
    rankedCandidates.sort((left, right) => right.score - left.score);
    console.log("      - 예약 최종 버튼 후보");
    for (const candidate of rankedCandidates.slice(0, 6)) {
      console.log(
        `        text="${candidate.text}" class="${candidate.className}" score=${candidate.score}`
      );
    }
    const picked = rankedCandidates[0];
    console.log(`   🎯 예약 최종 버튼 선택: text="${picked.text}" class="${picked.className}" score=${picked.score}`);
    await beforeSubmit?.();
    await picked.button.click({ force: true });
    return true;
  }

  return false;
}

async function publish(
  page: Page,
  category?: string,
  options: PublishExecutionOptions = { mode: "now" },
): Promise<boolean> {
  console.log("\n🚀 발행 중...");
  const mode = options.mode === "schedule" ? "schedule" : "now";
  const scheduledDate = options.scheduledDate;

  let createTracker: ScheduleSubmissionTracker | undefined;

  const scheduleContext =
    mode === "schedule"
      ? (() => {
          if (!scheduledDate) {
            throw new Error("예약 발행 모드에서 예약일이 지정되지 않았습니다.");
          }
          return { date: scheduledDate };
        })()
      : null;

  // 먼저 모든 팝업 닫기
  try {
    await closeAllPopups(page);

  // 카테고리는 발행 패널을 열기 전에 선택해야 패널이 닫히지 않습니다.
  if (category) {
    await selectCategory(page, category);
    await page.waitForTimeout(500);
  }

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
    try {
        await page.locator('span.text', { hasText: '발행' }).click();
        clicked = true;
    } catch {
    await page.mouse.click(1210, 22);
    }
  }

  await page.waitForTimeout(3500); // 패널 열리는 시간 대기 증가 (2000 -> 3500)

  await page.waitForTimeout(1000);

  if (mode === "schedule") {
    const scheduledContext = scheduleContext!;
    const effectiveDate = await configureSchedulePublish(page, scheduledContext.date);
    scheduledContext.date = effectiveDate;
    console.log(`   ✅ 예약 발행 설정 완료: ${formatDateYmd(effectiveDate)}`);

    const reserveSelected = await ensureScheduleReserveRadioSelected(page);
    if (!reserveSelected) {
      console.log("   ⚠️ 예약 라디오 버튼 또는 예약 옵션 선택 상태를 다시 확인하지 못했습니다. 기존 설정을 믿고 진행합니다.");
    }
  } else {
    // 즉시 발행의 경우에도 "현재"가 잘 선택되어 있는지 확인/강제 선택
    try {
        const nowRadio = await page.locator('input[data-testid="nowTimeRadioBtn"], input[name="radio_time"][value="now"], input#radio_time1').first();
        if (await nowRadio.isVisible()) {
            await nowRadio.check({ force: true });
        }
    } catch {}
  }

  if (await clickFinalPublishButton(page, mode, async () => {
    await options.beforeSubmit?.();
    if (scheduleContext) createTracker = createScheduleSubmissionTracker(page, formatDateYmd(scheduleContext.date));
  })) {
    if (mode === "schedule") {
      const scheduledContext = scheduleContext!;
      await waitForScheduleSubmission(page, scheduledContext.date, createTracker!);
    }
    console.log(mode === "schedule" ? "   🎉 예약 발행 요청 완료!" : "   🎉 발행 완료!");
    return true;
  }

    if (mode === "schedule") {
      await logScheduleDialogSnapshot(page);
    }
    await capturePublishArtifacts(page, "final-button-missing");
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

    let args: TopicArgs | null = null;
    let taskId: string | null = null;
    let postId: string | null = null;
    const runtimeOptions = parseRuntimePublishOptions(process.argv.slice(2));
    const loadedContext = await loadPublishContextFromDb(runtimeOptions);

    if (loadedContext) {
        taskId = loadedContext.taskId;
        postId = loadedContext.postId;
        args = loadedContext.args;
    } else {
        const allowLegacyGeneration =
            (process.env.TOPIC_AGENT_ALLOW_LEGACY_GENERATION || "false").toLowerCase() === "true";
        if (!allowLegacyGeneration) {
            throw new Error(
                "topic-agent는 publish-only 스크립트입니다. --task-id 또는 --post-id를 사용하세요. 수동 생성이 꼭 필요하면 TOPIC_AGENT_ALLOW_LEGACY_GENERATION=true 로 실행하세요."
            );
        }
        // 1. CLI 인자 파싱
        args = parseArgs();
        if (!args) {
            throw new Error("필수 인자(--type, --topic)가 누락되었습니다.");
        }
    }

    console.log(`📌 타입: ${categoryNames[args.type]}`);
    console.log(`📌 주제: ${args.topic}`);
    console.log(`📌 키워드: ${args.keywords.join(", ") || "(자동)"}`);

    // 2. 스타일 로드
    const style = loadStyleProfile(args.style);
    const styleGuide = buildStyleGuide(style);

    // 3. 콘텐츠 생성 (이미지 모드 vs 일반 모드)
    let content: StoredPublishPayload;
    let imagePaths: string[] = loadedContext?.imagePaths || [];
    let imagePlan: TopicVisualPlan | null = loadedContext?.imagePlan || null;

    if (loadedContext?.preparedContent) {
        content = loadedContext.preparedContent;
    } else if (args.images) {
        // 이미지 기반 생성 모드
        log.info(`이미지 폴더 모드: ${args.images}`);
        const images = loadImages(args.images);

        if (images.length === 0) {
            console.log("⚠️ 지정된 폴더에 이미지가 없습니다. 에이전틱 파이프라인으로 텍스트를 생성합니다.");
            const advancedContent = await generateAdvancedContent(args, styleGuide);
            content = { title: advancedContent.title, sections: advancedContent.sections, hashtags: advancedContent.hashtags };
        } else {
        console.log(`📷 이미지 ${images.length}장 발견`);
            console.log("   🧠 외부 이미지 분석 없이 GPT 글 생성 파이프라인으로 진행합니다.");
            const advancedContent = await generateAdvancedContent(args, styleGuide);
            content = {
                title: advancedContent.title,
                sections: advancedContent.sections,
                hashtags: advancedContent.hashtags,
            };

            // 이미지 경로 저장 (텍스트 모드로 생성했더라도 업로드를 위해 경로는 유지)
            imagePaths = images.map(img => img.path);
            imagePlan = null;
        }
    } else {


        // 일반 텍스트 생성 모드 -> 에이전틱 고도화 파이프라인으로 대체
        const advancedContent = await generateAdvancedContent(args, styleGuide);
        content = {
            title: advancedContent.title,
            sections: advancedContent.sections,
            hashtags: advancedContent.hashtags,
        };

        console.log(`\n📷 Daedal(gpt-image-2)를 활용한 이미지 생성 시작`);

        const autoImageDir = path.join(IMAGE_WORK_DIR, `auto-${Date.now()}`);
        if (!fs.existsSync(autoImageDir)) {
            fs.mkdirSync(autoImageDir, { recursive: true });
        }

        const daedalPaths = generateDaedalTopicImages(content.sections, autoImageDir);
        if (daedalPaths.length > 0) {
            imagePaths = daedalPaths;
            console.log(`   ✅ Daedal 이미지 ${daedalPaths.length}장 생성 완료`);
        }

        const CHATGPT_BASE_URL = "https://chatgpt.com/";

        let imageGptHandle = null;
        if (imagePaths.length === 0 && ALLOW_CHATGPT_BROWSER_MODE) {
            try {
                console.log(`   🌐 Daedal 실패/비활성화로 ChatGPT 이미지 생성 폴백 실행`);
                console.log("   🌐 이미지 생성 GPT 브라우저 세션 초기화...");
                imageGptHandle = await createChatGPTContext(true);
                const imagePage = await imageGptHandle.context.newPage();

                await openChatGPTTarget(imagePage, CHATGPT_BASE_URL, "이미지 생성 ChatGPT");

                console.log("   [1/2] 이미지 생성 GPT에 내용 전달 중...");
                const imagePrompt = `다음 블로그 글 내용을 바탕으로 관련있고 예쁜 고품질 DALL-E 이미지를 무조건 3장 생성해줘. 다른 말 필요 없이 바로 생성해줘:\n\n${content.sections.join("\n\n").substring(0, 1500)}`;
                await sendPromptToChatGPT(imagePage, imagePrompt, "이미지 생성 요청");

                // Wait extra time for DALL-E to generate
                console.log("   [2/2] 이미지 생성 대기 중 (최대 2분)...");

                // 더 긴 대기 및 생성 상태 체크 (DALL-E 생성은 오래 걸림)
                let imageWaitTime = 0;
                while (imageWaitTime < 120000) {
                  const isGen = await isChatGPTGenerating(imagePage);
                  if (!isGen && imageWaitTime > 30000) break; // 적어도 30초는 대기 후 생성 끝났으면 종료
                  await imagePage.waitForTimeout(5000);
                  imageWaitTime += 5000;
                  console.log(`      ... 대기 중 (${imageWaitTime/1000}초)`);
                }

                const downloadedPaths = await downloadChatGPTImages(imagePage, autoImageDir);

                if (downloadedPaths.length > 0) {
                    imagePaths = downloadedPaths;
                } else {
                    console.log("   ⚠️ 이미지 생성 실패, 기본 텍스트만 발행합니다.");
                }
            } catch (error) {
                console.error("❌ 이미지 생성 파이프라인 에러:", error);
            } finally {
                if (imageGptHandle) {
                    await imageGptHandle.close();
                }
            }
        } else if (imagePaths.length === 0) {
            console.log("   ⚠️ ChatGPT 이미지 생성 폴백 비활성화, 기본 텍스트만 발행합니다.");
        }
        imagePlan = null;

    }

    console.log("\n" + "─".repeat(40));
    console.log("📝 생성된 콘텐츠 미리보기:");
    console.log(`   제목: ${content.title}`);
    console.log(`   섹션: ${content.sections.length}개`);
    console.log(`   해시태그: ${content.hashtags.length}개`);
    console.log("─".repeat(40));

    // 4. 발행 여부 확인 (테스트용으로 일단 생성만)
    const shouldPublish = args.publishMode === "now" || args.publishMode === "schedule";

    if (shouldPublish) {
        assertPublishableContent(content);
    }

    if (!shouldPublish) {
        console.log("\n💡 발행하려면: npm run topic -- ... --publish");
        console.log("\n📄 생성된 콘텐츠:");
        console.log(JSON.stringify(content, null, 2));
        return;
    }

    // 5. 브라우저로 발행
    console.log("\n🌐 브라우저 시작...");
    const browser = await chromium.launch({
        channel: process.env.BROWSER_CHANNEL?.trim() || undefined,
        headless: (process.env.HEADLESS || "false").toLowerCase() === "true",
    });
    const context = await browser.newContext({
        storageState: SESSION_FILE,
        viewport: { width: 1280, height: 900 },
        locale: "ko-KR",
    });

    const page = await context.newPage();
    let submissionStarted = false;

    try {
        await openEditor(page);
        await inputTitle(page, content.title);
        await inputContent(
            page,
            content.sections,
            content.hashtags,
            imagePaths,
            imagePlan,
            content.lead,
            content.highlights,
        );

        const scheduledDate = args.scheduledDate ? new Date(args.scheduledDate) : undefined;
        if (args.publishMode === "schedule" && (!scheduledDate || Number.isNaN(scheduledDate.getTime()))) {
            throw new Error("예약 발행 날짜가 유효하지 않습니다.");
        }

        const publishSuccess = await publish(page, args.category, {
            mode: args.publishMode,
            scheduledDate,
            beforeSubmit: async () => {
                if (submissionStarted) throw new Error("중복 제출을 차단했습니다.");
                const prisma = new PrismaClient();
                try {
                    if (taskId) {
                        const marked = await prisma.topicPostTask.updateMany({
                            where: { id: taskId, status: { in: ["PREPARED", "FAILED", "PUBLISHING"] }, pipelineStage: { not: "OUTCOME_UNKNOWN" } },
                            data: { status: "PUBLISHING", pipelineStage: "OUTCOME_UNKNOWN", errorMessage: "제출 결과 확인 중" },
                        });
                        if (marked.count !== 1) throw new Error("이전 제출 또는 작업 변경으로 제출을 차단했습니다.");
                    }
                    if (postId) {
                        const marked = await prisma.post.updateMany({
                            where: { id: postId, status: { notIn: ["OUTCOME_UNKNOWN", "SUCCESS"] } },
                            data: { status: "OUTCOME_UNKNOWN", errorMessage: "제출 결과 확인 중" },
                        });
                        if (marked.count !== 1) throw new Error("이미 제출된 Post입니다.");
                    }
                    submissionStarted = true;
                } finally {
                    await prisma.$disconnect();
                }
            },
        });
        if (!publishSuccess) {
            throw new Error("발행 완료 버튼을 확인하지 못했습니다.");
        }

        // 발행 후 PostView URL 대기 (최대 15초)
        let capturedUrl = args.publishMode === "now" ? page.url() : "";
        const publishWaitDeadline = Date.now() + 15_000;
        while (args.publishMode === "now" && Date.now() < publishWaitDeadline) {
            await page.waitForTimeout(1000);
            capturedUrl = page.url();
            if (isPublishedUrl(capturedUrl)) {
                break;
            }
        }

        const persistedUrl = isPublishedUrl(capturedUrl) ? capturedUrl : null;
        if (args.publishMode === "now" && !persistedUrl) {
            throw new Error("최종 PostView URL을 확보하지 못했습니다.");
        }
        console.log(`\n✅ 완료! (URL: ${persistedUrl || "예약 완료 확인"})`);

        // DB 상태 업데이트
        if (taskId) {
            const prisma = new PrismaClient();
            await prisma.topicPostTask.update({
                where: { id: taskId },
                data: {
                    status: args.publishMode === "schedule" ? "SCHEDULED" : "PUBLISHED",
                    pipelineStage: args.publishMode === "schedule" ? "SCHEDULED" : "PUBLISHED",
                    postUrl: args.publishMode === "schedule" ? null : persistedUrl,
                    publishedAt: args.publishMode === "schedule" ? null : new Date(),
                    errorMessage: null,
                }
            });
            await prisma.$disconnect();
        }
        if (postId) {
            const prisma = new PrismaClient();
            await prisma.post.update({
                where: { id: postId },
                data: {
                    status: "SUCCESS",
                    finalUrl: args.publishMode === "schedule" ? null : persistedUrl,
                    publishedAt: args.publishMode === "schedule" ? null : new Date(),
                    errorMessage: null,
                }
            });
            await prisma.$disconnect();
        }
    } catch (error) {
        if (taskId) {
            try {
                const prisma = new PrismaClient();
                await prisma.topicPostTask.updateMany({
                    where: { id: taskId, status: { notIn: ["PUBLISHED", "SCHEDULED"] }, ...(submissionStarted ? {} : { pipelineStage: { not: "OUTCOME_UNKNOWN" } }) },
                    data: {
                        status: "FAILED",
                        pipelineStage: submissionStarted ? "OUTCOME_UNKNOWN" : "FAILED",
                        errorMessage: error instanceof Error ? error.message : String(error)
                    }
                });
                await prisma.$disconnect();
            } catch {}
        }
        if (postId) {
            try {
                const prisma = new PrismaClient();
                await prisma.post.updateMany({
                    where: { id: postId, status: { notIn: submissionStarted ? ["SUCCESS"] : ["SUCCESS", "OUTCOME_UNKNOWN"] } },
                    data: {
                        status: submissionStarted ? "OUTCOME_UNKNOWN" : "FAIL",
                        errorMessage: error instanceof Error ? error.message : String(error),
                    }
                });
                await prisma.$disconnect();
            } catch {}
        }
        throw error;
    } finally {
        await browser.close();
    }
}

main().catch((error) => {
    console.error("❌ 오류:", error);
    process.exit(1);
});
