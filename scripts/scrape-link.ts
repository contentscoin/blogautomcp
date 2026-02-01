/**
 * 브랜드링크 스크래핑 스크립트
 * 스마트스토어 및 네이버 쇼핑 상품 정보를 스크래핑합니다.
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { PrismaClient } from "@prisma/client";
import * as path from "path";
import * as fs from "fs";

// Stealth 플러그인 적용
chromium.use(StealthPlugin());

const prisma = new PrismaClient();
const SESSION_FILE = path.join(process.cwd(), "playwright", "storage", "naver-session.json");

async function scrapeProductInfo(url: string) {
    console.log(`\n🔍 스크래핑 시작: ${url}`);

    const browser = await chromium.launch({
        headless: true,  // 백그라운드 실행
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
        ],
    });

    const contextOptions: any = {
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

        // 이미지 URL 추출
        const imageUrls: string[] = [];
        const images = await page.$$('img');

        for (const img of images) {
            let src = await img.getAttribute('src');
            const dataSrc = await img.getAttribute('data-src');
            src = dataSrc || src;

            if (src &&
                (src.includes('shop-phinf.pstatic.net') ||
                    src.includes('shopping-phinf.pstatic.net') ||
                    src.includes('sitem.ssgcdn.com') ||
                    src.includes('cdn.011st.com')) &&
                !src.includes('icon') &&
                !src.includes('logo') &&
                !src.includes('1x1')) {
                const highRes = src.replace(/\?type=.*/, '?type=w860');
                if (!imageUrls.includes(highRes)) {
                    imageUrls.push(highRes);
                }
            }
            if (imageUrls.length >= 10) break;
        }
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
        const result = await scrapeProductInfo(link.url);

        // DB 업데이트
        await prisma.brandLink.update({
            where: { id: linkId },
            data: {
                productName: result.productName || undefined,
                storeName: result.storeName || undefined,
                productPrice: result.productPrice || undefined,
                finalUrl: result.finalUrl || undefined,
                imageUrls: result.imageUrls.length > 0 ? JSON.stringify(result.imageUrls) : undefined,
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
