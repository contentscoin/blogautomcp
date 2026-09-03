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

No paid generation was run. Editorial QC remains heuristic, not claim-level fact verification. The tests prove state reconciliation and image placement/coverage, not the aesthetic or factual quality of generated images. Runtime installation/deployment evidence is recorded after final artifact verification.
