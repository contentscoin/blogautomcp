/**
 * 브랜드링크 스크래핑 스크립트
 * 스마트스토어 및 네이버 쇼핑 상품 정보를 스크래핑합니다.
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { PrismaClient } from "@prisma/client";
import type { BrowserContextOptions, Page } from "playwright";
import * as path from "path";
import * as fs from "fs";
import {
    isCandidateProductImageUrl,
    isPreferredThumbnailImageUrl,
    isReviewImageUrl,
    isSalesPageProductImageUrl,
    prioritizeImageCandidates,
    type ProductImageCandidate,
} from "./lib/product-image-selection";

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

async function collectProductImageUrlsFromPage(page: Page): Promise<string[]> {
    const candidates: ProductImageCandidate[] = [];

    const ogImage = await page.getAttribute('meta[property="og:image"]', "content").catch(() => null);
    if (ogImage && isCandidateProductImageUrl(ogImage)) {
        candidates.push({ url: ogImage, source: "og", index: 0 });
    }

    const domCandidates = await page
        .evaluate(() => {
            const toText = (value: unknown): string =>
                typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
            const urlsFromSrcset = (srcset: string | null): string[] => {
                if (!srcset) return [];
                return srcset
                    .split(",")
                    .map((part) => part.trim().split(/\s+/)[0])
                    .filter(Boolean);
            };

            return Array.from(document.images).flatMap((img, index) => {
                const rect = img.getBoundingClientRect();
                const parent = img.closest(
                    '[class*="image" i], [class*="thumb" i], [class*="gallery" i], [class*="viewer" i], [class*="product" i], [class*="detail" i], [class*="review" i]'
                ) as HTMLElement | null;
                const rawUrls = [
                    img.currentSrc,
                    img.getAttribute("data-src"),
                    img.getAttribute("data-original"),
                    img.getAttribute("data-lazy-src"),
                    img.getAttribute("src"),
                    ...urlsFromSrcset(img.getAttribute("srcset")),
                ].filter((candidate): candidate is string => Boolean(candidate));

                return Array.from(new Set(rawUrls)).map((candidateUrl) => ({
                    url: candidateUrl,
                    index,
                    width: Math.max(img.naturalWidth || 0, Math.round(rect.width || 0)),
                    height: Math.max(img.naturalHeight || 0, Math.round(rect.height || 0)),
                    top: Math.round(rect.top + window.scrollY),
                    alt: toText(img.getAttribute("alt")),
                    className: toText(img.className),
                    parentClassName: toText(parent?.className),
                }));
            });
        })
        .catch(() => [] as ProductImageCandidate[]);

    for (const candidate of domCandidates) {
        if (!isCandidateProductImageUrl(candidate.url)) continue;
        const isGalleryLike =
            isSalesPageProductImageUrl(candidate.url) &&
            !isReviewImageUrl(candidate.url) &&
            /image|thumb|gallery|viewer|product|상품|prd/i.test(
                `${candidate.className || ""} ${candidate.parentClassName || ""} ${candidate.alt || ""}`
            );
        candidates.push({
            ...candidate,
            source: isGalleryLike ? "gallery" : "dom",
        });
    }

    return prioritizeImageCandidates(candidates);
}

async function scrapeProductInfo(url: string, headless: boolean) {
    console.log(`\n🔍 스크래핑 시작: ${url} (headless=${headless})`);

    const browser = await chromium.launch({
        headless,
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

        // 이미지 URL 추출: 판매페이지 대표 상품 이미지 우선, 후기/상세 이미지는 뒤로 보낸다.
        const imageUrls = (await collectProductImageUrlsFromPage(page)).slice(0, 10);
        const salesPageImageCount = imageUrls.filter((imageUrl) => isSalesPageProductImageUrl(imageUrl)).length;
        const reviewImageCount = imageUrls.filter((imageUrl) => isReviewImageUrl(imageUrl)).length;
        console.log(
            `   🖼️ 이미지: ${imageUrls.length}개 (판매페이지 ${salesPageImageCount}개 / 후기 ${reviewImageCount}개)`
        );
        if (imageUrls[0]) {
            console.log(`   🖼️ 대표 이미지 후보: ${imageUrls[0]}`);
            console.log(
                `   🖼️ 썸네일 원본 적합: ${isPreferredThumbnailImageUrl(imageUrls[0]) ? "예" : "아니오"}`
            );
        }

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
