# v1.3.22

- Preserve product identity when scraped headings contain only promotional text.
- Detach draft product snapshots from mutable product data.
- Preserve the previous draft and failed submission files when replacement fails.
- Distinguish legacy, missing, expired, and changed draft contexts; include traceable recovery instructions without bypassing quality or product checks.
- Improve MCP long-running job polling and continuation guidance.

Validation passed: MCP delivery (21 tests), snapshot contract, product-name identity, Sites and desktop production builds, and isolated packaged execution/update smoke test (UI 200, authenticated download, relaunch, bundled Prisma, secret redaction). The update smoke test uses a simulated next version and does not install it. Installer manifest integrity is checked before publication.

Old or expired contexts require a fresh preparation and fact revalidation. This release does not automatically approve or publish old drafts.
