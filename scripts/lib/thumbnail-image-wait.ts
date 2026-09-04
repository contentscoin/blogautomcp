import { imageWaitPolicy, type ImageTimeoutEnvironment } from "./image-timeout-policy";

export function thumbnailImageWaitPolicy(env: ImageTimeoutEnvironment = process.env) {
  return imageWaitPolicy({
    ...env,
    CHATGPT_IMAGE_WAIT_MS: env.PRODUCT_THUMBNAIL_IMAGE_WAIT_MS?.trim() || env.CHATGPT_IMAGE_WAIT_MS,
  });
}

/** The caller owns browser cancellation; observations must count new artifacts only. */
export async function waitForThumbnailArtifacts(options: {
  policy: ReturnType<typeof thumbnailImageWaitPolicy>;
  observe: () => Promise<{ imageCount: number; generating: boolean }>;
  wait: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<number> {
  const now = options.now ?? Date.now;
  const started = now();
  const hardDeadline = started + options.policy.hardMs;
  let deadline = started + options.policy.baseMs;
  let previousCount = 0;
  let stableCycles = 0;
  while (now() < deadline) {
    const { imageCount, generating } = await options.observe();
    if (now() >= deadline) return 0;
    if (generating || imageCount > previousCount) {
      deadline = Math.min(hardDeadline, Math.max(deadline, now() + options.policy.progressGraceMs));
    }
    stableCycles = !generating && imageCount > 0
      ? (imageCount === previousCount ? stableCycles + 1 : 1) : 0;
    previousCount = imageCount;
    if (now() - started >= 12_000 && stableCycles >= 2) return imageCount;
    await options.wait(Math.min(3000, Math.max(0, deadline - now())));
  }
  return 0;
}
