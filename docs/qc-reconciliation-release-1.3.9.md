# 1.3.9 — freeform section images and existing draft QC

## Evidence and corrections

The SAGA draft contained 10 body sections, one generated image in each, and one hero (11 total). Its stored editorial report scored 100, while the outer score was stale at 82 and the displayed reason still counted three images. The third section was a library scene but inherited positional `travel-highlights` minimum 2 and collage layout. These are separate defects from missing image generation addressed in 1.3.8.

- Freeform sections now use minimum 1 and neutral section-derived intent/layout; all sections receive an image before extras are distributed. Stable section IDs/link anchors remain compatible.
- Explicit section plans retain their bounds, including minimum 2 and text-only 0/0. Legacy freeform sections are migrated only when both bounds are absent; packages with `postSpec` do not receive this migration.
- Reading an existing package refreshes composition from present files, reconciles its composition signal/blocker/reason/verdict and restores the independently stored editorial score. Real editorial and safety failures remain, including legacy code-only failures across repeated image results.
- Original manifest bytes are backed up once as `manifest.json.pre-qc-v139.bak` before any v2 read-time migration. Text, existing image files and IDs are not rewritten. Migration never grants approval; invalid existing approval is cleared.
- Appending a generated image no longer reintroduces positional collage styling.
- Both dashboard score displays prefer the independent editorial score.
- Windows package excludes `.next/cache` and `.next/dev`; dependency versions are unchanged.

## Verification

Passed: `test:package-qc-reconcile`, `test:section-images`, `test:post-composition`, `test:brand-post-package`, `test:brand-post-quality`, `test:post-spec`, `test:writing-harness`, `test:image-batch-progress`, `test:draft-snapshot`, `test:auto-update`, `test:api-auth`, and `test:mcp-contract`. Root/scripts type checks and scoped ESLint passed. Production build passed.

The optional real-fixture reconciliation test read the user's SAGA manifest without writing it. Result: editorial 100, composition 100, 10 sections, 11 images, no blockers, still unapproved. Assertions checked unchanged text/section IDs/image mapping/input bytes. Approval was exercised only on an isolated synthetic fixture. Genuine missing files, explicit two-image deficits, low editorial scores and safety failures remain blocked. Backup ordering and idempotency were tested.

Old package tests artificially forced a short under-illustrated composition to `canAutoPublish: true`. Their assertions now require text recovery while retaining the independently recalculated composition block, rather than trusting a stale passing report.

## Local installation issue

The prior 1.3.8 updater repeatedly relaunched repository `out/win-unpacked` version 1.3.7. The Start Menu shortcut pointed there; NSIS `keepShortcuts` preserved it and `--force-run` launched that shortcut. The shortcut was backed up and redirected to the actual installed app under `%LOCALAPPDATA%/Programs/brandconnect-automation`. No user draft was approved or published.

## Limitations

No paid generation was run. Editorial QC remains heuristic, not claim-level fact verification. The tests prove state reconciliation and image placement/coverage, not the aesthetic or factual quality of generated images. Runtime installation/deployment evidence follows.

## Packaging and central deployment

- Root implementation pushed to `origin/main`: `a0c28c3`.
- A normal `electron-builder --win --dir` regenerated the staging app from 1.3.9 source. Staged executable/package both report 1.3.9; cache/dev directories are absent. Staged app size: 1,306,984,071 bytes. Critical runtime source hashes match the repository.
- Isolated packaged update smoke passed: UI HTTP 200, manual authenticated check, fixture 1.3.10 discovery without installation, relaunch, its own Prisma engine, and token redaction.
- NTFS compression preserved staging contents. The first archive attempt overlapped compression and failed on file locks; it was not published. Its incomplete archive was removed, and packaging was retried only after compression ended. The final installer passed `7za t` (embedded archive OK; expected trailing installer data warning) and SHA-512/size/blockmap validation.
- Final installer: `BrandConnect-Automation-Setup-1.3.9.exe`, 325,436,124 bytes; SHA-256 `4bb791c160c20ab6d6b702634adde498b7445310ed8bacf29618efa1ce5f32e2`. It is not certificate-signed.
- Existing central update channel published 1.3.9 at `2026-09-03T00:40:48.069Z`. Paired-device requests to `latest.yml` and installer HEAD returned HTTP 200, version 1.3.9 and matching size. Sites application source remains unchanged at `d94daa3`; this release updates its Windows artifact feed.
- Live 1.3.8 readiness was true with zero active jobs before requesting the actual update. The app detected 1.3.9 and began downloading it.

## Final installed-runtime evidence

The actual PC automatically installed and relaunched 1.3.9 at `2026-09-03T00:46:24.662Z`. The update-readiness API reports currentVersion 1.3.9, idle, no installation pending or active jobs. MCP `agent_get_status` independently reports online, appVersion 1.3.9, zero queued/running jobs and retained Naver session/configuration. The three changed critical source files in the installed application hash-match the repository.

The real SAGA draft preview now reports:

- Editorial score 100; canPublish true; verdict pass; code ok; reason null; no blockers.
- Composition score 100; 3,054 body characters; 10 sections; 11 images; all 11 required slots filled; no blockers/warnings.
- All 10 body sections have one generated image and zero missing/generationMissing. All 11 image preview HEAD requests return HTTP 200.
- Combined readiness READY. approvedAt remains null: no real approval or public posting was performed.

Post-install hashes of the markdown and all 11 original image files are identical to the pre-update snapshot. The one-time backup hash exactly matches the original pre-update manifest. The live manifest changed only through the intended reconciliation. Available C-drive space recovered to approximately 2.19 GB after installation; no user data, normal old installer, or source directory was deleted.
