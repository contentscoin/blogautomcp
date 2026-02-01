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
import { Page } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
    PostCategory,
    getTemplate,
    generatePrompt,
    getTypeFromArgs,
    categoryNames
} from "./lib/templates";
import { loadImages, generateContentFromImages } from "./lib/image-content";
import { createTaskLogger } from "./lib/logger";

const log = createTaskLogger("TopicAgent");

// Stealth 플러그인 적용
chromium.use(StealthPlugin());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const SESSION_FILE = path.join(process.cwd(), "playwright", "storage", "naver-session.json");
const STYLES_DIR = path.join(process.cwd(), "styles");
const NAVER_BLOG_ID = process.env.NAVER_BLOG_ID || "";

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
}

function parseArgs(): TopicArgs | null {
    const args = process.argv.slice(2);

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

// ============================================
// LLM으로 글 생성
// ============================================
async function generateContent(
    args: TopicArgs,
    styleGuide: string
): Promise<{ title: string; sections: string[]; hashtags: string[] }> {
    console.log("\n📝 콘텐츠 생성 중...");

    const template = getTemplate(args.type);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = generatePrompt(args.type, {
        styleGuide,
        topic: args.topic,
        keywords: args.keywords.length > 0 ? args.keywords : template.seoKeywords,
        details: args.details,
    });

    console.log(`   📋 템플릿: ${template.name}`);
    console.log(`   🔑 키워드: ${args.keywords.join(", ") || template.seoKeywords.join(", ")}`);

    const response = await model.generateContent(prompt);
    const text = response.response.text();

    try {
        const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");
        console.log(`   ✅ 생성 완료: "${json.title}"`);
        return json;
    } catch (e) {
        console.error("   ❌ JSON 파싱 실패");
        throw new Error("콘텐츠 생성 실패");
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
    await page.waitForTimeout(3000);
}

async function inputTitle(page: Page, title: string): Promise<void> {
    console.log(`   📌 제목: ${title}`);
    const titleInput = await page.$('.se-title-input, [placeholder*="제목"]');
    if (titleInput) {
        await titleInput.click();
        await page.keyboard.type(title, { delay: 30 });
    }
}

async function inputContent(page: Page, sections: string[], hashtags: string[]): Promise<void> {
    console.log("\n✍️ 본문 입력 중...");

    // 본문 영역 클릭
    const contentArea = await page.$('.se-content, .se-section-text');
    if (contentArea) {
        await contentArea.click();
        await page.waitForTimeout(500);
    }

    // 각 섹션 입력
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        console.log(`   [${i + 1}/${sections.length}] 섹션 입력...`);

        await page.keyboard.type(section, { delay: 10 });
        await page.keyboard.press("Enter");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);
    }

    // 해시태그 입력
    console.log(`   🏷️ 해시태그 ${hashtags.length}개 입력...`);
    await page.keyboard.press("Enter");
    await page.keyboard.type(hashtags.join(" "), { delay: 20 });

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
        'button[class*="close"]',
        '.se-popup-close',
        '[class*="close_btn"]',
        'button:has-text("닫기")',
    ];

    for (const selector of closeSelectors) {
        try {
            const closeBtn = await page.$(selector);
            if (closeBtn && await closeBtn.isVisible()) {
                await closeBtn.click({ force: true });
                await page.waitForTimeout(300);
            }
        } catch { }
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

async function publish(page: Page, category?: string): Promise<boolean> {
    console.log("\n🚀 발행 중...");

    // 먼저 모든 팝업 닫기
    await closeAllPopups(page);

    // 발행 버튼 찾기 및 클릭
    const publishSelectors = [
        'button[class*="publish_btn"]',
        'button[class*="submit"]',
        '.publish_layer button',
        'text=발행',
    ];

    let clicked = false;
    for (const selector of publishSelectors) {
        try {
            const btn = await page.$(selector);
            if (btn && await btn.isVisible()) {
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

    await page.waitForTimeout(2000);

    // 팝업이 다시 나타났을 수 있으므로 한번 더 닫기
    await closeAllPopups(page);

    // 카테고리 선택
    if (category) {
        await selectCategory(page, category);
    }

    await page.waitForTimeout(1000);

    // 최종 발행 확인 버튼
    const confirmSelectors = [
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
                console.log("   🎉 발행 완료!");
                return true;
            }
        } catch { }
    }

    console.log("   ⚠️ 발행 확인 버튼을 찾지 못했습니다");
    return false;
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
    if (!args) return;

    console.log(`📌 타입: ${categoryNames[args.type]}`);
    console.log(`📌 주제: ${args.topic}`);
    console.log(`📌 키워드: ${args.keywords.join(", ") || "(자동)"}`);

    // 2. 스타일 로드
    const style = loadStyleProfile(args.style);
    const styleGuide = buildStyleGuide(style);

    // 3. 콘텐츠 생성 (이미지 모드 vs 일반 모드)
    let content: { title: string; sections: string[]; hashtags: string[] };

    if (args.images) {
        // 이미지 기반 생성 모드
        log.info(`이미지 폴더 모드: ${args.images}`);
        const images = loadImages(args.images);

        if (images.length === 0) {
            console.log("❌ 이미지를 찾을 수 없습니다.");
            return;
        }

        console.log(`📷 이미지 ${images.length}장 발견`);
        const imageContent = await generateContentFromImages(images, args.topic, args.type as "travel" | "golf" | "knowledge", styleGuide);

        content = {
            title: imageContent.title,
            sections: imageContent.sections.map(s => s.text),
            hashtags: imageContent.hashtags,
        };
    } else {
        // 일반 텍스트 생성 모드
        content = await generateContent(args, styleGuide);
    }

    console.log("\n" + "─".repeat(40));
    console.log("📝 생성된 콘텐츠 미리보기:");
    console.log(`   제목: ${content.title}`);
    console.log(`   섹션: ${content.sections.length}개`);
    console.log(`   해시태그: ${content.hashtags.length}개`);
    console.log("─".repeat(40));

    // 4. 발행 여부 확인 (테스트용으로 일단 생성만)
    const publishMode = process.argv.includes("--publish");

    if (!publishMode) {
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
        await inputContent(page, content.sections, content.hashtags);
        await publish(page, args.category);

        await page.waitForTimeout(5000);
        console.log("\n✅ 완료!");
    } catch (error) {
        console.error("❌ 오류:", error);
    } finally {
        await browser.close();
    }
}

main().catch(console.error);
