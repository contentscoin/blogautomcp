import fs from "fs";
import path from "path";
import { chromium } from "playwright-extra";
import { Page } from "playwright";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createTaskLogger } from "./logger";

chromium.use(StealthPlugin());

const log = createTaskLogger("ImageStock");

/**
 * 이미지 다운로드 유틸리티 함수
 */
async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      log.error(`이미지 다운로드 실패: ${response.status} ${response.statusText}`, { url });
      return false;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 디렉토리가 없으면 생성
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (error) {
    log.error("이미지 다운로드 중 오류 발생", { url, error });
    return false;
  }
}

/**
 * Unsplash API를 이용한 랜덤 이미지 검색
 */
async function fetchFromUnsplashAPI(keyword: string): Promise<string | null> {
  const apiKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(keyword)}&orientation=landscape&client_id=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      log.warn(`Unsplash API 오류: ${res.status}`);
      return null;
    }
    const data = await res.json() as any;
    if (data && data.urls && data.urls.regular) {
      log.info(`Unsplash API로 이미지 찾음`, { keyword, url: data.urls.regular });
      usedImageUrls.add(data.urls.regular);
      return data.urls.regular;
    }
  } catch (e: any) {
    log.error("Unsplash API 호출 중 예외", e);
  }
  return null;
}

// 중복 이미지 방지를 위한 세션 단위 캐시
const usedImageUrls = new Set<string>();

/**
 * API 키가 없을 때 Playwright로 Unsplash를 스크래핑하는 폴백
 */
async function scrapeUnsplash(keyword: string): Promise<string | null> {
  log.info(`Unsplash 스크래핑 검색 시도: ${keyword}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    const searchUrl = `https://unsplash.com/s/photos/${encodeURIComponent(keyword)}?orientation=landscape`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // 이미지 로딩 대기
    await page.waitForTimeout(3000);

    // Unsplash의 고화질 이미지 URL 추출 (정규식이나 srcset 등 활용)
    // img 태그 중 srcset 속성이 있는 것들 중 가장 큰 이미지를 선택
    const validUrls = await page.evaluate(() => {
      // @ts-ignore
      const doc = document;
      const imgElements = Array.from(doc.querySelectorAll('figure img[srcset]')) as any[];
      // 찾은 이미지 중 무료 이미지를 모두 수집
      const urls: string[] = [];
      for (const img of imgElements) {
        if (img.src && !img.src.includes('profile-') && !img.src.includes('premium')) {
          const srcUrl = new URL(img.src);
          srcUrl.searchParams.set('w', '1080');
          srcUrl.searchParams.set('q', '80');
          srcUrl.searchParams.set('fm', 'jpg');
          srcUrl.searchParams.set('fit', 'crop');
          urls.push(srcUrl.toString());
        }
      }
      return urls;
    });

    if (validUrls && validUrls.length > 0) {
      // 중복되지 않은 이미지 찾기
      const unusedUrls = validUrls.filter(url => !usedImageUrls.has(url));

      let finalUrl = null;
      if (unusedUrls.length > 0) {
        // 안 쓴 이미지 중 무작위 선택
        const randomIndex = Math.floor(Math.random() * Math.min(unusedUrls.length, 10));
        finalUrl = unusedUrls[randomIndex];
      } else {
        // 전부 다 썼다면 어쩔 수 없이 기존 것 중 하나 무작위 선택
        const randomIndex = Math.floor(Math.random() * validUrls.length);
        finalUrl = validUrls[randomIndex];
      }

      usedImageUrls.add(finalUrl);
      log.info(`스크래핑으로 이미지 URL 확보`, { keyword });
      return finalUrl;
    }

    log.warn(`Unsplash 스크래핑 실패: 이미지 요소를 찾을 수 없음`, { keyword });
    return null;
  } catch (error) {
    log.error("Unsplash 스크래핑 중 오류", { error });
    return null;
  } finally {
    await browser.close();
  }
}

/**
 * 고품질 스탁 이미지(Unsplash 등) 다운로드 메인 함수
 * @param keyword 검색어 (영어 권장)
 * @param destPath 저장할 로컬 파일 경로
 * @returns 성공 여부
 */
export async function downloadHighQualityStockImage(keyword: string, destPath: string): Promise<boolean> {
  // 1. API가 있으면 시도
  let imageUrl = await fetchFromUnsplashAPI(keyword);

  // 2. API가 없거나 실패하면 스크래핑 시도
  if (!imageUrl) {
    imageUrl = await scrapeUnsplash(keyword);
  }

  // 3. 둘 다 실패하면 기본 폴백 (LoremFlickr)
  if (!imageUrl) {
    log.warn(`고품질 이미지 수급 실패. LoremFlickr 폴백 사용`, { keyword });
    imageUrl = `https://loremflickr.com/1080/720/${encodeURIComponent(keyword)}`;
  }

  // 4. URL로 이미지 다운로드
  log.info(`이미지 다운로드 시작`, { url: imageUrl, destPath });
  const success = await downloadImage(imageUrl, destPath);

  if (success) {
    log.info(`✅ 이미지 다운로드 완료`, { destPath });
  } else {
    // 5. 실패 시 빈 투명 이미지라도 생성해서 프로세스가 멈추지 않게 함
    try {
        const emptyImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        fs.writeFileSync(destPath, Buffer.from(emptyImageBase64, 'base64'));
        log.warn("다운로드 완전 실패. 투명 빈 이미지로 대체됨.", { destPath });
        return true;
    } catch (fallbackError) {
        log.error("빈 이미지 생성 실패", { fallbackError });
    }
  }

  return success;
}