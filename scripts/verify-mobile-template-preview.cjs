const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '../docs/mobile-template-preview.html'));
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const titles = new Set();
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      for (let i = 0; i < 6; i++) {
        await page.locator('button').nth(i).click();
        const state = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          title: document.querySelector('main h2').textContent,
          body: getComputedStyle(document.querySelector('main p')).fontSize,
          heading: getComputedStyle(document.querySelector('main h3')).fontSize,
          selected: document.querySelectorAll('button[aria-pressed="true"]').length,
        }));
        assert.equal(state.overflow, false, `${width}px template ${i} overflows`);
        assert.equal(state.body, '16px');
        assert.equal(state.heading, '19px');
        assert.equal(state.selected, 1);
        titles.add(state.title);
      }
    }
    assert.equal(titles.size, 6);
    console.log('PASS: 18 mobile viewport/template combinations, selection, typography, no horizontal overflow');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
