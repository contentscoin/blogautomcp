#!/usr/bin/env npx ts-node --project tsconfig.scripts.json
/**
 * 리뷰 에이전트 (V5 Phase 11)
 * GPTs 패턴 기반 장소/제품 리뷰 블로그 생성
 * 
 * 사용법:
 * npm run review -- --name="뽀로로테마파크" --address="경기 남양주시..." --notes="메모 내용"
 */

import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
    ReviewInput,
    ReviewOutput,
    buildReviewPrompt,
    generateReviewHashtags,
} from "./lib/review-prompt";
import { createTaskLogger } from "./lib/logger";

const log = createTaskLogger("ReviewAgent");

chromium.use(StealthPlugin());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const SESSION_FILE = path.join(process.cwd(), "session/naver-session.json");
const BLOG_ID = process.env.NAVER_BLOG_ID || "";

// 스타일 프로필 로드
function loadStyleProfile(styleName?: string): any {
    if (!styleName) return null;

    const stylesDir = path.join(process.cwd(), "styles");
    const stylePath = path.join(stylesDir, `${styleName}.json`);

    if (fs.existsSync(stylePath)) {
        log.info(`스타일 로드: ${styleName}`);
        return JSON.parse(fs.readFileSync(stylePath, "utf-8"));
    }

    // 최신 스타일 파일 찾기
    if (fs.existsSync(stylesDir)) {
        const files = fs.readdirSync(stylesDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
            const latestStyle = files.sort().pop()!;
            log.info(`최신 스타일 사용: ${latestStyle}`);
            return JSON.parse(fs.readFileSync(path.join(stylesDir, latestStyle), "utf-8"));
        }
    }

    return null;
}

// 스타일 가이드 생성
function buildStyleGuide(style: any): string {
    if (!style) return "";

    return `
## 🎨 글쓰기 스타일 가이드

### 기본 스타일
- 말투: ${style.tone}
- 문장 스타일: ${style.sentenceStyle}
- 이모지 사용: ${style.emojiUsage}
- CTA 스타일: ${style.ctaStyle}
- 마무리 스타일: ${style.closingStyle}

### 참고 문장 예시:
${style.sampleSentences?.map((s: string, i: number) => `${i + 1}. "${s}"`).join('\n') || '(예시 없음)'}
`;
}

// CLI 인자 파싱
function parseArgs(): ReviewInput | null {
    const args = process.argv.slice(2);

    const getArg = (name: string): string | undefined => {
        const arg = args.find(a => a.startsWith(`--${name}=`));
        return arg?.split("=").slice(1).join("=");
    };

    const placeName = getArg("name");
    const address = getArg("address");
    const rawNotes = getArg("notes");

    if (!placeName || !rawNotes) {
        console.log("❌ 필수 인자: --name, --notes");
        console.log("예: npm run review -- --name=\"뽀로로테마파크\" --address=\"경기 남양주...\" --notes=\"메모 내용\"");
        return null;
    }

    const keywords = getArg("keywords")?.split(",").map(k => k.trim()) || [];
    const tips = getArg("tips")?.split(",").map(t => t.trim());
    const category = (getArg("category") || "place") as ReviewInput["category"];
    const styleProfile = getArg("style");

    return {
        placeName,
        address: address || "",
        rawNotes,
        keywords,
        tips,
        category,
        phone: getArg("phone"),
        parking: getArg("parking"),
        targetAudience: getArg("target"),
        styleProfile,
    };
}

// 콘텐츠 생성
async function generateReviewContent(
    input: ReviewInput,
    styleGuide: string
): Promise<ReviewOutput> {
    log.info("리뷰 콘텐츠 생성 시작");

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = buildReviewPrompt(input, styleGuide);

    log.debug("프롬프트 생성 완료", { length: prompt.length });

    const response = await model.generateContent(prompt);
    const text = response.response.text();

    try {
        const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");

        // 해시태그 보강
        if (!json.hashtags || json.hashtags.length < 15) {
            json.hashtags = generateReviewHashtags(input);
        }

        log.info(`콘텐츠 생성 완료: "${json.title}"`);
        return json as ReviewOutput;

    } catch (e) {
        log.error("JSON 파싱 실패", { error: e });
        throw new Error("콘텐츠 생성 실패");
    }
}

// HTML 변환
function toHtml(content: ReviewOutput): string {
    let html = "";

    // 정보 박스
    html += `<div style="background:#f8f9fa;padding:20px;border-radius:10px;margin-bottom:20px;">
<p>📌 <strong>장소 기본 정보</strong></p>
<p>🏷️ 장소명: ${content.infoBox.placeName}</p>
<p>📍 위치: ${content.infoBox.address}</p>
${content.infoBox.phone ? `<p>📞 연락처: ${content.infoBox.phone}</p>` : ''}
${content.infoBox.parking ? `<p>🚗 주차: ${content.infoBox.parking}</p>` : ''}
<p>⭐ 특징: ${content.infoBox.features.join(' · ')}</p>
</div>\n\n`;

    // 도입부
    html += `<p>${content.introduction}</p>\n\n`;

    // 섹션들
    for (const section of content.sections) {
        html += `<h3>${section.emoji} ${section.title}</h3>\n`;
        html += `<p>${section.content.replace(/\n/g, '</p>\n<p>')}</p>\n\n`;
    }

    // TIP
    html += `<h3>📝 TIP 정리</h3>\n`;
    for (const tip of content.tips) {
        html += `<p>${tip}</p>\n`;
    }
    html += "\n";

    // 추천 대상
    html += `<h3>👨‍👩‍👧 이런 분들에게 추천해요</h3>\n`;
    for (const rec of content.recommendation) {
        html += `<p>${rec}</p>\n`;
    }
    html += "\n";

    // 해시태그
    html += `<p>${content.hashtags.join(" ")}</p>\n`;

    return html;
}

// 에디터 열기
async function openEditor(page: any) {
    log.info("에디터 열기");
    await page.goto(`https://blog.naver.com/${BLOG_ID}?Redirect=Write`);
    await page.waitForTimeout(3000);
}

// 제목 입력
async function inputTitle(page: any, title: string) {
    log.info(`제목 입력: ${title}`);
    await page.click('.se-documentTitle-editView');
    await page.waitForTimeout(500);
    await page.keyboard.type(title, { delay: 30 });
}

// 본문 입력
async function inputContent(page: any, html: string) {
    log.info("본문 입력");

    await page.click('.se-component-content');
    await page.waitForTimeout(500);

    // HTML 모드로 전환하여 입력
    await page.keyboard.insertText(html.replace(/<[^>]*>/g, '\n').replace(/\n+/g, '\n'));

    await page.waitForTimeout(1000);
}

// 발행
async function publish(page: any, category?: string) {
    log.info("발행 시작");

    // ESC로 팝업 닫기
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // 발행 버튼 클릭
    const publishBtn = await page.$('button:has-text("발행")');
    if (publishBtn) {
        await publishBtn.click({ force: true });
        await page.waitForTimeout(2000);
    }

    // 카테고리 선택
    if (category) {
        try {
            await page.click(`text=${category}`);
            await page.waitForTimeout(500);
        } catch (e) {
            log.warn("카테고리 선택 실패");
        }
    }

    // 최종 발행
    const confirmBtn = await page.$('button:has-text("발행")');
    if (confirmBtn) {
        await confirmBtn.click({ force: true });
    }

    await page.waitForTimeout(3000);
    log.info("발행 완료");
}

// 메인
async function main() {
    console.log("╔════════════════════════════════════════╗");
    console.log("║   V5 리뷰 에이전트 (GPTs 패턴)         ║");
    console.log("╚════════════════════════════════════════╝\n");

    // 1. CLI 인자 파싱
    const input = parseArgs();
    if (!input) return;

    log.info(`장소: ${input.placeName}`);
    log.info(`카테고리: ${input.category}`);
    log.info(`키워드: ${input.keywords.join(", ") || "(자동)"}`);

    // 2. 스타일 로드
    const style = loadStyleProfile(input.styleProfile);
    const styleGuide = buildStyleGuide(style);

    // 3. 콘텐츠 생성
    const content = await generateReviewContent(input, styleGuide);

    console.log("\n" + "─".repeat(40));
    console.log("📝 생성된 리뷰 미리보기:");
    console.log(`   제목: ${content.title}`);
    console.log(`   섹션: ${content.sections.length}개`);
    console.log(`   TIP: ${content.tips.length}개`);
    console.log(`   해시태그: ${content.hashtags.length}개`);
    console.log("─".repeat(40));

    // 4. 발행 여부
    const publishMode = process.argv.includes("--publish");

    if (!publishMode) {
        console.log("\n💡 발행하려면: npm run review -- ... --publish");
        console.log("\n📄 생성된 콘텐츠:");
        console.log(JSON.stringify(content, null, 2));
        return;
    }

    // 5. 브라우저로 발행
    log.info("브라우저 시작");
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
        await inputContent(page, toHtml(content));
        await publish(page);

        await page.waitForTimeout(5000);
        console.log("\n✅ 발행 완료!");

    } catch (error) {
        log.error("발행 실패", { error });
        console.error("❌ 오류:", error);
    } finally {
        await browser.close();
    }
}

main().catch(console.error);
