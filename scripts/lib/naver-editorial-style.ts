import type { Page } from "playwright";
import type { EditorialSelection } from "./editorial-templates";

/** Selectors/values observed in authenticated Naver editor on 2026-09-05.
 * A selected option alone is not evidence that the toolbar retained the value.
 */
export async function applyEditorialEditorStyle(page: Page, selection: EditorialSelection, role: "heading" | "body") {
  selection.failures ??= {};
  selection.observedControls ??= [];
  const size = role === "heading" ? (selection.policy.headingSizePx || 19) : (selection.policy.bodySizePx || 16);
  const color = role === "heading" ? selection.policy.headingColor : (selection.policy.bodyColor || "#333333");
  const settings = [
    { name: "font-family", value: "nanumgothic", expected: /나눔고딕/u },
    { name: "font-size", value: `fs${size}`, expected: new RegExp(`^${size}(?:\\D|$)`) },
    { name: "align-drop-down-with-justify", value: "left", expected: /왼쪽|left/iu },
    { name: "line-height", value: "180", expected: /180/u },
  ];
  for (const setting of settings) {
    const key = `${role}:${setting.name}`;
    try {
      const toolbar = page.locator(`button[data-name="${setting.name}"]`).first();
      if (!(await toolbar.isVisible())) throw new Error("control unavailable");
      if (!selection.observedControls.includes(setting.name)) selection.observedControls.push(setting.name);
      await toolbar.click();
      const option = page.locator(`button[data-name="${setting.name}"][data-value="${setting.value}"]`);
      const alreadySelected = await option.getAttribute("aria-current") === "true";
      if (!alreadySelected) {
        await option.click({ timeout: 1500 });
        await toolbar.click();
      }
      const selected = await option.getAttribute("aria-current") === "true";
      await page.keyboard.press("Escape");
      const label = [await toolbar.innerText(), await toolbar.getAttribute("aria-label"), await toolbar.getAttribute("title")].join(" ").trim();
      if (!selected && !setting.expected.test(label)) throw new Error("selected value not observable");
      if (!selection.applied.includes(key)) selection.applied.push(key);
      selection.unsupported = selection.unsupported.filter(item => item !== key);
      delete selection.failures[key];
    } catch (error) {
      selection.failures[key] = error instanceof Error ? error.message : String(error);
      selection.applied = selection.applied.filter(item => item !== key);
      if (!selection.unsupported.includes(key)) selection.unsupported.push(key);
      await page.keyboard.press("Escape").catch(() => {});
    }
  }
  const key = `${role}:color`;
  try {
    const toolbar = page.locator('button[data-name="font-color"]').first();
    const rgb = color.match(/[a-f\d]{2}/gi)!.map(value => parseInt(value, 16));
    const readColor = () => toolbar.locator('[data-role="color"]').evaluate(el => (el as HTMLElement).style.backgroundColor);
    if ((await readColor()).replace(/\s/g, "") !== `rgb(${rgb.join(",")})`) {
      await toolbar.click();
      await page.locator(`button[data-color="${color}"]:visible`).first().click({ timeout: 1500 });
    }
    await page.waitForFunction((expected) => {
      const indicator = document.querySelector('button[data-name="font-color"] [data-role="color"]');
      return !!indicator && getComputedStyle(indicator).backgroundColor.replace(/\s/g, "") === expected;
    }, `rgb(${rgb.join(",")})`, { timeout: 1500 });
    const actual = await readColor();
    if (actual.replace(/\s/g, "") !== `rgb(${rgb.join(",")})`) throw new Error("color not retained");
    if (!selection.applied.includes(key)) selection.applied.push(key);
    selection.unsupported = selection.unsupported.filter(item => item !== key);
    delete selection.failures[key];
  } catch (error) {
    selection.failures[key] = error instanceof Error ? error.message : String(error);
    selection.applied = selection.applied.filter(item => item !== key);
    if (!selection.unsupported.includes(key)) selection.unsupported.push(key);
    await page.keyboard.press("Escape").catch(() => {});
  }
  selection.application = "partial";
  return selection;
}
