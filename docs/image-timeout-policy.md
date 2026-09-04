# Section image timeout policy

The section-image browser batch waits up to five minutes without progress. Active generation or newly observed artifacts can extend that deadline, with a one-minute grace period and a ten-minute hard limit. Stable completed artifacts return early; uploaded references still do not count as generated images. Existing callers that explicitly pass a timeout to the shared wait function retain that hard limit unless they opt into extension.

The parent and worker share `scripts/lib/image-timeout-policy.ts`. Each sequential slot has 300 seconds for preparation, up to 600 seconds for generation, two 60-second download allowances, a two-second download retry delay, and 30 seconds for finishing/cleanup: 1,052 seconds total. Startup adds the profile-lock timeout (600 seconds by default) and 180 seconds of launch slack. There is no 30-minute cap that truncates larger batches. Timers remain finite. An explicit `BRAND_POST_IMAGE_BATCH_TIMEOUT_MS` is an operator cancellation limit and may intentionally shorten the calculated budget; a per-job override cannot shorten the required allowance.

Generation is never automatically replayed after a timeout or ambiguous send. Only retrieval of existing artifacts that has settled with an empty result receives one retry. A timed-out retrieval is not retried: racing a deadline cannot cancel the pending operation, so another download on that page could overlap. Each slot uses its own page and closes it before continuing, isolating timed-out local actions. Remote generation may continue after page closure: check the existing conversation before manually retrying. The fail-fast flag only stops remaining slots for the explicit `CHATGPT_BROWSER_AUTH_REQUIRED` authentication/security code. Text-only responses, timeouts and download failures remain individual failures.

Completed image checkpoints, delivery callbacks, product locking and quality gates are retained. Failure metadata is written locally to the job's `_chatgpt_*/failure.json` and contains only phase, timing, category and wait limits. No screenshots, page text, prompt, URLs, credentials or raw exceptions are added to these diagnostics.

Offline verification (no browser launch, generation or deployment):

```powershell
node node_modules/ts-node/dist/bin.js --project tsconfig.scripts.json scripts/verify-image-timeout-policy.ts
node node_modules/ts-node/dist/bin.js --project tsconfig.scripts.json scripts/verify-image-batch-progress.ts
```

The fake-clock/Page suite executes the real wait and submit implementations, including 93-second completion, 423-second extended completion, 600-second hard expiry, hung observation expiry, auth/security classification and ambiguous-send protection. The batch suite verifies continuation of ten remaining slots, checkpoint recovery, no duplicate paid submissions, safe retrieval retry and product-lock preservation. The separate generated-image selector fixture uses isolated Chromium and is not run by these commands.
