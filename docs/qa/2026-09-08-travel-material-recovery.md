# Travel material workflow repair

Observed installed version: 1.3.40. Read-only material inspection confirmed saved travel drafts with one image and failed editorial signals; drafted was not approved/ready. This conversation exposes an older connector catalog without materials_prepare/materials_publish, although Sites source advertises those tools.

Root defects corrected:
- MCP handoff and remaining-image counting used generationMissing alone. Travel slots can have missing=1 and generationMissing=0, so these were incorrectly reported as requiring no further images. All handoffs now use either deficit; counting uses their maximum per slot.
- Preparation generated images before discovering weak editorial content. It now rechecks saved content, performs at most one source-grounded revision for text failures, and rechecks before image work. Persistent text failures stop with a reason. Image-only failures do not trigger rewriting.
- Preparation remains separate from publication. No implicit regeneration or publishing was added to legacy schedule commands.

Validation: material workflow fixture, new MCP deficit fixture, 9 material API tests, 15 MCP transport tests, desktop production build and Sites build passed. Fixtures cover travel missing=1/generationMissing=0, no double count, no image-only rewrite, one bounded revision, and no publication from preparation.

Sites version 34 deployed successfully to the existing public site. Desktop 1.3.41 packaging/publication is tracked in the task tool results. No live content generation or actual blog publication was performed. Existing low-quality drafts still require running preparation and passing the unchanged quality gates; this release does not mark them approved automatically. A stale conversation tool catalog may require a connector refresh.

Windows 1.3.41 publication confirmed at 2026-09-08T04:10:16.964Z. Installer size: 326487493 bytes; SHA-256: f69c4817e293895edf02f4b720bb7674c0f067fb2210902c322f14d8ccb20c52. Packaged workflow, MCP route, and handoff source hashes matched the tested workspace files. Installation on connected PCs has not been verified.
