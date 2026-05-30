/**
 * 브랜드링크 스크래핑 스크립트
 * 스마트스토어 및 네이버 쇼핑 상품 정보를 스크래핑합니다.
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { PrismaClient } from "@prisma/client";
import type { BrowserContextOptions } from "playwright";
import * as path from "path";
import * as fs from "fs";

// Stealth 플러그인 적용
chromium.use(StealthPlugin());

const prisma = new PrismaClient();
const SESSION_FILE = path.join(process.cwd(), "playwright", "storage", "naver-session.json");

function normalizeText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function isSecurityVerificationPage(text: string): boolean {
    const normalized = normalizeText(text).toLowerCase();
    return (
        normalized.includes("security verification") ||
        normalized.includes("please complete the security verification") ||
        normalized.includes("보안 인증") ||
        normalized.includes("실제 사용자인지 확인") ||
        normalized.includes("자동입력 방지")
    );
}

function isInvalidProductName(name: string): boolean {
    const normalized = normalizeText(name).toLowerCase();
    return (
        !normalized ||
        normalized === "naver" ||
        normalized === "네이버" ||
        normalized.includes("네이버 브랜드 커넥트") ||
        normalized.includes("security verification") ||
        normalized.includes("보안 인증")
    );
}

function containsBadImageKeyword(url: string): boolean {
    return /icon|logo|banner|sprite|thumb|thumbnail|coupon|benefit|guide|notice|delivery|event|ads?/i.test(url);
}

function normalizeCandidateImageUrl(rawUrl: string): string {
    return rawUrl.trim().replace(/\?type=.*/i, "?type=w860");
}

function isCandidateProductImageUrl(rawUrl: string): boolean {
    const url = rawUrl.toLowerCase();
    if (!url) return false;

    const isImageDomain =
        url.includes("shop-phinf.pstatic.net") ||
        url.includes("shopping-phinf.pstatic.net") ||
        url.includes("phinf.pstatic.net") ||
        url.includes("sitem.ssgcdn.com") ||
        url.includes("cdn.011st.com");

    if (!isImageDomain) return false;
    if (containsBadImageKeyword(url)) return false;
    if (url.includes("1x1")) return false;
    return true;
}

function prioritizeImageUrls(urls: string[]): string[] {
    const scored = urls.map((url, index) => {
        const lower = url.toLowerCase();
        let score = 0;

        if (index === 0) score += 800; // og:image를 첫 후보로 넣기 때문에 우선
        if (/\.(jpe?g)(\?|$)/i.test(lower)) score += 200;
        if (/\.png(\?|$)/i.test(lower)) score -= 120;
        if (containsBadImageKeyword(lower)) score -= 300;
        score += Math.max(0, 80 - index);

        return { url, score, index };
    });

    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.map((item) => item.url);
}

async function scrapeProductInfo(url: string, headless: boolean) {
    console.log(`\n🔍 스크래핑 시작: ${url} (headless=${headless})`);

    const browser = await chromium.launch({
        headless,
        channel: process.env.BROWSER_CHANNEL || undefined, // 패키징 시 시스템 Chrome 사용
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
        ],
    });

    const contextOptions: BrowserContextOptions = {
        viewport: { width: 1280, height: 900 },
        locale: "ko-KR",
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    // 세션 파일이 있으면 사용
    if (fs.existsSync(SESSION_FILE)) {
        contextOptions.storageState = SESSION_FILE;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // 봇 감지 우회
    await page.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  `);

    try {
        await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // 최종 URL (리다이렉트 후)
        const finalUrl = page.url();
        console.log(`   📎 최종 URL: ${finalUrl}`);

        const bodyText = await page.textContent("body");
        if (bodyText && isSecurityVerificationPage(bodyText)) {
            throw new Error("네이버 보안 인증 페이지가 표시되어 상품 정보를 가져올 수 없습니다. 브라우저에서 인증 후 다시 시도하세요.");
        }

        // 상품명 추출
        let productName = "";
        const nameSelectors = [
            '._3oDjSvLwEZ',           // 스마트스토어 상품명
            '.product_title',
            'h2._22kNQuEXmb',
            '[class*="ProductName"]',
            'h1',
            'meta[property="og:title"]',
        ];

        for (const selector of nameSelectors) {
            if (selector.startsWith('meta')) {
                const meta = await page.$(selector);
                if (meta) {
                    const content = await meta.getAttribute('content');
                    if (content && content.length > 3) {
                        productName = content.split(':')[0].split('-')[0].trim();
                        break;
                    }
                }
            } else {
                const el = await page.$(selector);
                if (el) {
                    const text = await el.textContent();
                    if (text && text.length > 3 && text.length < 200) {
                        productName = text.trim();
                        break;
                    }
                }
            }
        }

        if (!productName) {
            productName = (await page.title()).split(':')[0].split('-')[0].split('|')[0].trim();
        }

        if (isInvalidProductName(productName)) {
            throw new Error(`상품명 추출 실패: "${productName || "빈 값"}". 보안 인증 또는 페이지 로딩 문제일 수 있습니다.`);
        }
        console.log(`   📦 상품명: ${productName}`);

        // 스토어명 추출
        let storeName = "";
        const storeSelectors = [
            'a._1JTvJPqtNP',          // 스마트스토어 스토어명
            '[class*="store_name"]',
            '[class*="brand_name"]',
            '.seller_name',
        ];

        for (const selector of storeSelectors) {
            const el = await page.$(selector);
            if (el) {
                const text = await el.textContent();
                if (text && text.length > 1) {
                    storeName = text.trim();
                    break;
                }
            }
        }
        console.log(`   🏪 스토어: ${storeName}`);

        // 가격 추출
        let productPrice = "";
        const priceSelectors = [
            '._1LY7DqCnwR',           // 스마트스토어 가격
            '.total_price',
            '[class*="price"]',
            'strong[class*="price"]',
        ];

        for (const selector of priceSelectors) {
            const el = await page.$(selector);
            if (el) {
                const text = await el.textContent();
                if (text && (text.includes('원') || /[\d,]+/.test(text))) {
                    productPrice = text.trim().replace(/\s+/g, '');
                    break;
                }
            }
        }
        console.log(`   💰 가격: ${productPrice}`);

        // 이미지 URL 추출 (대표 이미지 품질 개선)
        const candidateUrls: string[] = [];

        const ogImage = await page.getAttribute('meta[property="og:image"]', "content").catch(() => null);
        if (ogImage && isCandidateProductImageUrl(ogImage)) {
            candidateUrls.push(normalizeCandidateImageUrl(ogImage));
        }

        const images = await page.$$("img");
        for (const img of images) {
            const src = (await img.getAttribute("data-src")) || (await img.getAttribute("src")) || "";
            if (!isCandidateProductImageUrl(src)) continue;
            candidateUrls.push(normalizeCandidateImageUrl(src));
            if (candidateUrls.length >= 40) break;
        }

        const dedupedUrls = Array.from(new Set(candidateUrls));
        const imageUrls = prioritizeImageUrls(dedupedUrls).slice(0, 10);
        console.log(`   🖼️ 이미지: ${imageUrls.length}개`);

        await browser.close();

        return {
            productName,
            storeName,
            productPrice,
            finalUrl,
            imageUrls,
        };
    } catch (error) {
        console.error("   ❌ 스크래핑 실패:", error);
        await browser.close();
        throw error;
    }
}

async function main() {
    const linkId = process.argv[2];

    if (!linkId) {
        console.error("사용법: npx ts-node scripts/scrape-link.ts <linkId>");
        process.exit(1);
    }

    // DB에서 링크 조회
    const link = await prisma.brandLink.findUnique({ where: { id: linkId } });
    if (!link) {
        console.error("❌ 링크를 찾을 수 없습니다.");
        process.exit(1);
    }

    try {
        let result;
        try {
            result = await scrapeProductInfo(link.url, true);
        } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (!message.includes("보안 인증")) {
                throw error;
            }

            console.log("⚠️ headless 스크래핑이 보안 인증으로 차단되어 headful 모드로 재시도합니다.");
            result = await scrapeProductInfo(link.url, false);
        }

        // DB 업데이트
        await prisma.brandLink.update({
            where: { id: linkId },
            data: {
                productName: result.productName || undefined,
                storeName: result.storeName || undefined,
                productPrice: result.productPrice || undefined,
                finalUrl: result.finalUrl || undefined,
                imageUrls: result.imageUrls.length > 0 ? JSON.stringify(result.imageUrls) : undefined,
                errorMessage: null,
            },
        });

        console.log("\n✅ 스크래핑 완료 및 DB 업데이트 완료!");
    } catch (error) {
        console.error("스크래핑 실패:", error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
