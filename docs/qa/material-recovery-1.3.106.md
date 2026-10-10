# Material recovery 1.3.106

The October 10 report contains four historical prepare/repair jobs and 19 distinct products. Before this change, 5 were currently approved/ready and 14 were blocked. Historical failures are retained even after a later recovery; their failure count is not the current readiness count.

## Changes

- Display the immutable job result and current saved-material readiness separately. Collapse historical error text, retain its code and full details, and expose current blockers. Poll current material revision/status as well as job status. Both full material queries and compact history queries use actual readiness rather than a product workflow flag.
- Retire a pre-receipt image strategy only when the original thread/workspace, single completed turn, timestamps and native/workspace/raw output SHA all agree. Uncertain, modified, pending, ambiguous or reused-workspace outputs remain blocked. Retirement does not adopt old images as natural photos and does not rewrite receipts, locks or original outputs.
- Use one visual-purpose contract in seller-source and final pixel reviews: product appearance, direct feature evidence, lifestyle illustration and thumbnail. A correct appearance image need not demonstrate every accompanying technical fact. Explicit claims that a photo proves performance or reads a precise label still require visible evidence; wrong identity/option remains blocked.
- Require structured geometry, intrinsic print, visible option and scene comparisons in new lifestyle review responses. Contradictions/unverifiable checks fail; legitimate camera/background variation is distinguished from actual product distortion. Previously passed v2 assets remain compatible.
- Separate malformed reference-review responses from valid rejections. Missing/wrong-type decisions or observations fail as `REFERENCE_SCENE_REVIEW_INVALID` and cannot become a cached negative. Valid rejections retain stage, candidate SHA, failed checks and reason. Candidate ordering, twelve-candidate budget and acceptance criteria are unchanged.

## Verification before release

- Material display: 4 real SSR/logic tests; material API: 28 cases, including immutable historical failure plus current recovery and old success plus current blocked/outcome-unknown.
- Failed rewrite controls: 65 checks; blocked repair controls: 96 preservation checks; actual dependency rendering in UI control fixtures.
- Material regression: 16 suites passed. Image batch: 64 checks. Legacy completion: positive migration plus 27 uncertainty boundaries. Final image audit: 64 scenarios.
- Scoped ESLint and complete TypeScript check passed. Independent transport review found no blocking counterexample.
- Strict reference responses: 17 malformed first-stage and 47 malformed second-stage cases, uncached invalid retries, valid negative cache and bounded candidate selection passed. Source recovery, natural reference selection/gates and Codex structured-output provider checks passed without paid calls.
- Read-only checks of 6 actual legacy jobs verified exact completed thread/native/raw output identity without changing files. Three affected products can enter resume-v2.

## Release verification

- [CI 38041306996](https://github.com/contentscoin/blogautomcp/actions/runs/38041306996), code head `69547cd`: root and Sites typecheck, lint, complete unit checks and production builds passed. The initial CI detected two outdated prompt-string fixtures; their assertions now cover intrinsic product printing, seller-artwork exclusion and the no-invented-print rule, and the rerun passed.
- Final Windows production build and NSIS packaging completed. Eleven modified runtime files in the unpacked package match source SHA exactly. Electron's packaged metadata has the expected version/main after normal dependency/script pruning. Root `.env` and temporary diagnostic scripts are excluded.
- Isolated packaged-app update test passed: authenticated metadata and installer download, isolated cache, Prisma engine, local UI, manual check and relaunch. Fixture installation was disabled.
- Installer: `BrandConnect-Automation-Setup-1.3.106.exe`, 345496939 bytes; SHA256 `e85af8305a8af795f8d5866e70e03d14ae89b87393016f9085994c64f55e30db`. Blockmap: 352592 bytes. Local SHA512/manifest and central metadata match.
- Existing Sites Windows update channel activated 1.3.106 at `2026-10-10T09:30:26.069Z`; authenticated re-query confirmed the release. This change does not require redeploying the Sites server runtime.

Normal automatic installation completed: the running PC reported 1.3.106 and all eleven changed runtime files matched the released package. The explicit six-item repair job terminated with six failures. Five were comparison schema/parser mismatches diagnosed in [the 1.3.107 follow-up](material-recovery-1.3.107.md); Dalba additionally required correcting an unverified photo-label assertion and resolving its source coverage. No blog publication or reservation is part of this repair.
