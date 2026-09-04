# 1.3.13 — preparation, writing and image time budgets

## Changes

- Section images: five-minute base wait, progress extension with a ten-minute hard limit; stable completed images return immediately.
- Only explicit session authentication/security errors stop all remaining slots. An individual timeout no longer skips the other ten images.
- Each slot has an isolated page. Ambiguous generation submissions are not replayed. Only a completed empty retrieval gets one download retry; timeout retrieval is not duplicated.
- Parent batch allowance includes profile locking, launch, per-slot preparation, generation, download and cleanup. Completed assets and QC/approval gates remain intact.
- Thumbnail image waiting follows the same five/ten-minute policy while excluding pre-existing reference images.
- Codex and browser writing calls receive ten minutes, with five minutes of unchanged actual text before browser stall recovery. Existing bounded retry/QC paths are preserved; outer budgets cover their sum.
- Automatic image generation remains fixed on. Updating does not automatically approve, publish, or regenerate existing drafts.

See `image-timeout-policy.md` and `writing-timeouts.md` for exact defaults and override semantics. Section image repair is detached from the draft response and has its own batch deadline.

## Verification

- Offline real-wait/fake-clock tests: completion beyond 60 seconds, progress extension, hard/idle expiry, hung observations, explicit auth failures and nonduplicated ambiguous sends.
- 22 image-batch cases: continuation after one failure, checkpoint recovery, safe empty retrieval retry, no retry on pending download timeout, existing product locking.
- Nine isolated Chromium DOM cases: uploaded reference exclusion and stable generated artifact selection.
- Writing/thumbnail timing, section repair, QC reconciliation, fixed settings, draft package, browser recovery, Codex provider, MCP contract and updater fixtures passed.
- `test:brand-post-package` contained a stale pre-1.3.12 expectation that automation was off and all image errors failed fast. Assertions now check the current fixed policy and explicit session-wide failure condition; approval/security assertions remain.
- Existing unrelated `test:thumbnail-studio` fails at line 62: expected `/노쇼핑|장점/`, actual `9일 · 명소 · 분위기 · 현지 팁`. Its source, fixture and `travel-content.ts` are unchanged from HEAD. This is not claimed passing.
- Live MCP preflight: online desktop 1.3.12, no running/queued jobs. No paid generation or public post publication is run by verification.

## Release evidence

- Final `npm run build`, scripts TypeScript and scoped ESLint passed. Source commit: `d92c01f05d5c6bf8a9685389e465f7a522e7086b`.
- Packaged desktop smoke passed: version 1.3.13, isolated authenticated fixture download for 1.3.14 (not installed), HTTP 200, fixed settings, own Prisma engine, manual update check and real process relaunch. All seven changed runtime files checked against packaged files have matching SHA-256 hashes.
- GitHub CI run 33843288229 did not start its jobs: account payment/spending-limit restriction. Remote CI is not claimed passing.
- Installer: 325,491,390 bytes, SHA-256 `d1f07d8ac64cccb66bab8442c7d4f9e591408d2a37a63448c4f93af1c9b0b25a`. Blockmap: 332,100 bytes, SHA-256 `8c0ce63c4c0b85d2784e8f7e103f49eda896a82e72c0c36d605e2ecad7bbb064`. GitHub release v1.3.13 asset digests match local verification.
- Central admin confirmed `1.3.13 버전 배포가 완료되었습니다. 연결된 PC가 자동으로 내려받습니다.` on 2026-09-04. Installed PC had zero active work; normal update check returned `available`, version 1.3.13, no error.
- Sites application code is unchanged; deployment target is the existing central Windows update feed, not Vercel. Central publication and installed-PC completion are distinct checks.
- Installed PC verification completed at 2026-09-04 15:22 KST: currentVersion/version 1.3.13, status current, error null, installPending false, zero active work. MCP independently reports online 1.3.13. Fixed Codex/image settings are retained; installed worker and all three timeout-policy files match the validated source hashes.
