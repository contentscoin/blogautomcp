import type { Page } from "playwright";

/** Counts only: never persist prompts, account data, DOM or conversation URLs. */
export async function imagePageSignals(page: Page) {
  return {
    userMessages: await page.locator('[data-message-author-role="user"]').count(),
    assistantMessages: await page.locator('[data-message-author-role="assistant"]').count(),
  };
}

export function keepFailedDiagnosticOpen(env: Readonly<Record<string, string | undefined>>, jobs: number): boolean {
  return jobs === 1 && env.CHATGPT_IMAGE_DIAGNOSTIC_KEEP_OPEN === "true"
    && env.CHATGPT_BROWSER_VISIBILITY === "visible";
}

export function imageBatchSucceeded(failure: unknown, results: { error?: string; localPath: string | null }[]): boolean {
  return !failure && results.length > 0 && results.every(result => !result.error && !!result.localPath);
}
