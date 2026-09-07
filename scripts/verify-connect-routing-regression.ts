import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertConnectUrlKind, getConfiguredConnectUrl } from '../src/lib/brandconnect-kind';
import { hasConditionalProductVerdict } from './lib/product-editorial-plan';
import { buildBrandPostImagePrompt } from '../src/lib/brand-post-image-generation';

assert.throws(() => assertConnectUrlKind('shopping', 'https://brandconnect.naver.com/123/travel-connect/products'), /CONNECT_KIND_URL_MISMATCH/);
assert.throws(() => assertConnectUrlKind('travel', 'https://brandconnect.naver.com/123/affiliate/products/category/1'), /CONNECT_KIND_URL_MISMATCH/);
assert.throws(() => assertConnectUrlKind('shopping', 'https://brandconnect.naver.com.evil.test/123/affiliate'), /CONNECT_URL_INVALID/);
assert.doesNotThrow(() => assertConnectUrlKind('shopping', 'https://brandconnect.naver.com/123/affiliate/products/category/1?foo=bar'));
assert.doesNotThrow(() => assertConnectUrlKind('travel', 'https://brandconnect.naver.com/123/travel-connect/products'));
const previous = process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL;
try {
  process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL = 'https://brandconnect.naver.com/123/affiliate/products/category/777';
  assert.ok(getConfiguredConnectUrl('shopping')?.endsWith('/777'));
} finally {
  if (previous === undefined) delete process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL;
  else process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL = previous;
}
assert.equal(hasConditionalProductVerdict(['땀 많은 러닝이나 야외 자전거처럼 귀를 열어 두고 싶은 사람에게 더 잘 맞아요. 반대로 실내 음악 감상, 통화 품질, 저음 중심 감상이 우선이면 다른 형태도 비교할 만해요.']), true);
assert.equal(hasConditionalProductVerdict(['모든 제품은 좋습니다. 확인하세요.']), false);
assert.equal(hasConditionalProductVerdict(['사람에게 배송됩니다. 선택은 자유입니다.']), false);
for (const kind of ['SHOPPING', 'TRAVEL'] as const) {
  const prompt = buildBrandPostImagePrompt({ connectKind: kind, productName: '대상', sectionTitle: '핵심', imageIntent: 'watercolor illustration', role: 'body' });
  assert.ok(prompt.includes('Photographic style is mandatory'));
  assert.ok(prompt.includes('never a style override'));
}
const ui = fs.readFileSync('src/app/page.tsx', 'utf8');
const selection = ui.slice(ui.indexOf('const selectBrandConnectKind'), ui.indexOf('const fetchLinks'));
assert.ok(selection.indexOf('brandConnectRequestGenerationRef.current += 1') < selection.indexOf('setBrandConnectKind(nextKind)'));
assert.ok(selection.includes('setBrandConnectOptionsLoading(false)'));
const route = fs.readFileSync('src/app/api/brandlinks/bulk-seasonal/route.ts', 'utf8');
assert.ok(route.includes('const categoryUrl = contract.configuredUrl'));
const imageSource = fs.readFileSync('src/lib/brand-post-image-generation.ts', 'utf8');
assert.ok(imageSource.includes('createOriginalProductPhotoOnBackground'));
assert.ok(imageSource.includes('provenance: "EDITORIAL_CARD"'), 'whole-photo fallback must not claim segmented product provenance');
console.log('PASS: connect routing, switch race, natural verdict and photographic prompts/fallback');
