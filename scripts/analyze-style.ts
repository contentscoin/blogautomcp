/**
 * 블로그 스타일 분석 스크립트
 * 샘플 블로그 URL을 분석하여 스타일 프로필을 생성합니다.
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";

// Stealth 플러그인 적용
chromium.use(StealthPlugin());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface StyleProfile {
    // 기본 스타일 요소
    bloggerName: string;
    tone: string;
    sentenceStyle: string;
    emojiUsage: string;
    sectionStructure: string;
    keywordDensity: string;
    ctaStyle: string;
    closingStyle: string;
    sampleSentences: string[];
    hashtags: string[];

    // 확장 스타일 요소 (v2)
    paragraphLength?: "short" | "medium" | "long";
    questionFrequency?: "rarely" | "sometimes" | "often";
    emphasisStyle?: string;
    transitionWords?: string[];
    openingStyle?: string;
    imageCaption?: string;

    // 메타 정보
    analyzedAt: string;
    sourceUrl: string;
}

async function scrapeBlogContent(url: string): Promise<string> {
    console.log(`\n📖 블로그 스크래핑 시작: ${url}`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: "ko-KR",
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // 봇 감지 우회
    await page.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  `);

    try {
        await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // iframe 내부 접근
        const iframe = page.frameLocator('#mainFrame');

        // 제목 추출
        const title = await iframe.locator('.se-title-text, .pcol1').first().textContent() || "";
        console.log(`   📌 제목: ${title.trim()}`);

        // 본문 추출
        const contentElements = await iframe.locator('.se-text-paragraph, .se_paragraph').all();
        const paragraphs: string[] = [];

        for (const el of contentElements) {
            const text = await el.textContent();
            if (text && text.trim().length > 10) {
                paragraphs.push(text.trim());
            }
        }

        // 해시태그 추출
        const hashtagElements = await iframe.locator('.tag_area a, .wrap_tag a').all();
        const hashtags: string[] = [];
        for (const el of hashtagElements) {
            const tag = await el.textContent();
            if (tag) hashtags.push(tag.trim());
        }

        console.log(`   📝 본문: ${paragraphs.length}개 문단`);
        console.log(`   🏷️ 해시태그: ${hashtags.join(', ').substring(0, 50)}...`);

        await browser.close();

        return JSON.stringify({
            title: title.trim(),
            paragraphs,
            hashtags,
            fullText: paragraphs.join('\n\n'),
        });
    } catch (error) {
        console.error("   ❌ 스크래핑 실패:", error);
        await browser.close();
        throw error;
    }
}

async function analyzeStyle(content: string, sourceUrl: string): Promise<StyleProfile> {
    console.log("\n🔍 스타일 분석 중...");

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `다음 블로그 글의 글쓰기 스타일을 상세히 분석해주세요.

## 블로그 글 내용
${content}

## 분석 항목(JSON으로 반환)
{
  "bloggerName": "블로거 닉네임 또는 특징",
  "tone": "말투 상세 분석 (예: 친근한 ~요체, ~습니다체, 반말 등)",
  "sentenceStyle": "문장 특징 (예: 짧고 간결, 상세한 설명, 감탄사 많음 등)",
  "emojiUsage": "이모지/이모티콘 사용 패턴 (예: 문장 끝에 :) 사용, 거의 사용 안함 등)",
  "sectionStructure": "글 구조 (예: 소제목 사용, 이미지+텍스트 교차 등)",
  "keywordDensity": "키워드 반복 패턴 분석",
  "ctaStyle": "구매 유도 스타일 (예: 자연스러운 추천, 적극적인 권유 등)",
  "closingStyle": "마무리 패턴 (예: 요약, 질문 유도, 인사말 등)",
  "sampleSentences": ["이 글의 대표적인 문장 스타일 5-7개"],
  "hashtags": ["이 블로거가 자주 쓰는 해시태그 패턴 5-10개"],
  
  "paragraphLength": "short | medium | long (문단 길이 선호)",
  "questionFrequency": "rarely | sometimes | often (독자에게 질문하는 빈도)",
  "emphasisStyle": "강조 방식 (예: ★ 기호 사용, 볼드체, 따옴표 강조 등)",
  "transitionWords": ["자주 사용하는 연결어 5-10개 (예: 그래서, 근데, 사실, 진짜 등)"],
  "openingStyle": "글 시작 패턴 (예: 질문으로 시작, 계절/날씨 언급, 개인 경험 언급 등)",
  "imageCaption": "이미지 설명 스타일 (예: 간결한 한 줄, 상세한 설명, 캡션 없음 등)"
}

JSON만 반환하세요.`;

    const response = await model.generateContent(prompt);
    const text = response.response.text();

    try {
        const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");

        return {
            ...json,
            analyzedAt: new Date().toISOString(),
            sourceUrl,
        };
    } catch (e) {
        console.error("분석 결과 파싱 실패:", text.substring(0, 200));
        throw new Error("스타일 분석 실패");
    }
}

async function main() {
    const blogUrl = process.argv[2];

    if (!blogUrl) {
        console.log("사용법: npx ts-node scripts/analyze-style.ts <블로그URL>");
        console.log("예시: npx ts-node scripts/analyze-style.ts https://blog.naver.com/xxx/12345");
        process.exit(1);
    }

    try {
        // 1. 블로그 스크래핑
        const content = await scrapeBlogContent(blogUrl);

        // 2. 스타일 분석
        const styleProfile = await analyzeStyle(content, blogUrl);

        // 3. 스타일 프로필 저장
        const stylesDir = path.join(process.cwd(), "styles");
        if (!fs.existsSync(stylesDir)) {
            fs.mkdirSync(stylesDir, { recursive: true });
        }

        const styleName = `style-${Date.now()}`;
        const stylePath = path.join(stylesDir, `${styleName}.json`);
        fs.writeFileSync(stylePath, JSON.stringify(styleProfile, null, 2), "utf-8");

        console.log("\n✅ 스타일 분석 완료!");
        console.log(`   📁 저장 위치: ${stylePath}`);
        console.log("\n📊 분석 결과:");
        console.log(`   🗣️ 말투: ${styleProfile.tone}`);
        console.log(`   ✍️ 문장 스타일: ${styleProfile.sentenceStyle}`);
        console.log(`   😊 이모지: ${styleProfile.emojiUsage}`);
        console.log(`   📐 구조: ${styleProfile.sectionStructure}`);
        console.log(`   🎯 CTA: ${styleProfile.ctaStyle}`);
        console.log("\n💡 사용법:");
        console.log(`   npm run publish -- --style=${styleName}`);

    } catch (error) {
        console.error("❌ 실패:", error);
        process.exit(1);
    }
}

main();
