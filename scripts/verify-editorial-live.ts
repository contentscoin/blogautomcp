/** Explicit opt-in local-session toolbar test; no text, save, or publish actions. */
import { chromium } from "playwright";
import { applyEditorialEditorStyle } from "./lib/naver-editorial-style";
import { createEditorialSelection, EDITORIAL_TEMPLATES, editorialEditorPolicy, EditorialTemplateId } from "./lib/editorial-templates";
import assert from "node:assert/strict";

async function main() {
  const session = process.env.EDITORIAL_TEST_SESSION;
  const blogId = process.env.EDITORIAL_TEST_BLOG_ID;
  if (!session || !blogId || !/^[a-zA-Z0-9_-]+$/.test(blogId)) throw new Error("Set EDITORIAL_TEST_SESSION and EDITORIAL_TEST_BLOG_ID explicitly");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: session });
    const page = await context.newPage();
    await page.goto(`https://blog.naver.com/${blogId}/postwrite`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.locator('button[data-name="font-size"]').first().waitFor({ timeout: 15000 });
    for (const id of Object.keys(EDITORIAL_TEMPLATES) as EditorialTemplateId[]) {
      const selection = createEditorialSelection(EDITORIAL_TEMPLATES[id].kind);
      selection.id = id;
      selection.policy = editorialEditorPolicy(id);
      for (const role of ["heading", "body"] as const) {
        await applyEditorialEditorStyle(page, selection, role);
        const failures = selection.unsupported.filter(value => value.startsWith(`${role}:`));
        assert.deepEqual(failures, [], `${id} ${role}: ${failures.join(", ")}`);
        assert.equal(selection.applied.filter(value => value.startsWith(`${role}:`)).length, 5);
        console.log(JSON.stringify({ id, role, applied: selection.applied.filter(value => value.startsWith(`${role}:`)) }));
      }
    }
    console.log("PASS: six templates heading/body toolbar values; no content/save/publish actions");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
