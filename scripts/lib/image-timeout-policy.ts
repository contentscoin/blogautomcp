/** Shared by the browser worker and its parent. No provider calls or retries here. */
export const IMAGE_WAIT_DEFAULT_MS = 5 * 60_000;
export const IMAGE_WAIT_HARD_DEFAULT_MS = 10 * 60_000;
export const IMAGE_PREPARATION_MS = 5 * 60_000;
export const IMAGE_DOWNLOAD_ATTEMPT_MS = 60_000;
export const IMAGE_DOWNLOAD_ATTEMPTS = 2;
export const IMAGE_RETRY_DELAY_MS = 2_000;
export const IMAGE_STARTUP_MS = 3 * 60_000;
export const IMAGE_TIMER_MAX_MS = 2_147_483_647;

function duration(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(IMAGE_TIMER_MAX_MS, Math.ceil(parsed)) : fallback;
}

export type ImageTimeoutEnvironment = Readonly<Record<string, string | undefined>>;

export function imageWaitPolicy(env: ImageTimeoutEnvironment = process.env, waitMs?: number) {
  const baseMs = duration(waitMs ?? env.CHATGPT_IMAGE_WAIT_MS, IMAGE_WAIT_DEFAULT_MS);
  const hardMs = Math.max(baseMs, duration(env.CHATGPT_IMAGE_WAIT_HARD_MS, Math.max(baseMs, IMAGE_WAIT_HARD_DEFAULT_MS)));
  return { baseMs, hardMs, progressGraceMs: 60_000 };
}

export function imageJobBudgetMs(env: ImageTimeoutEnvironment = process.env): number {
  const required = IMAGE_PREPARATION_MS + imageWaitPolicy(env).hardMs +
    IMAGE_DOWNLOAD_ATTEMPTS * IMAGE_DOWNLOAD_ATTEMPT_MS + IMAGE_RETRY_DELAY_MS + 30_000;
  return Math.max(required, duration(env.BRAND_POST_IMAGE_JOB_TIMEOUT_MS, required));
}

export function imageBatchBudgetMs(jobCount: number, env: ImageTimeoutEnvironment = process.env): number {
  const count = Number.isFinite(jobCount) ? Math.max(1, Math.ceil(jobCount)) : 1;
  // Explicit batch override is an operator cancellation limit, even if shorter than a job.
  return duration(env.BRAND_POST_IMAGE_BATCH_TIMEOUT_MS,
    Math.min(IMAGE_TIMER_MAX_MS, duration(env.CHATGPT_PROFILE_LOCK_TIMEOUT_MS, 600_000) + IMAGE_STARTUP_MS + count * imageJobBudgetMs(env)));
}

export function isSessionWideImageFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Only our explicit auth/security code, never guesses such as "check your login".
  return /^(?:Error:\s*)?(?:[^\n]*:\s*)?CHATGPT_BROWSER_AUTH_REQUIRED:/.test(message);
}

export class ImagePhaseTimeout extends Error {
  constructor(public readonly phase: string) {
    super(`IMAGE_TIMEOUT: ${phase}; 요청을 재전송하지 않았습니다.`);
  }
}

export async function withinImageDeadline<T>(operation: () => Promise<T>, timeoutMs: number, phase: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ImagePhaseTimeout(phase)), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
