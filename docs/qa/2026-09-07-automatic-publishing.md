# Automatic publishing — 1.3.24 implementation verification

## Implemented

- Product rows: immediate publish and date-selected scheduled publish.
- Shared workflow: reuse saved draft; otherwise generate; wait for/repair images; recheck; automatically approve; one evidence-bound quality revision if blocked; publish only after approval; wait for the correct terminal state.
- Prepared manuscripts receive stable priority before the batch limit. APIs freeze target IDs for their workers.
- Travel has additional up-to-10 immediate/scheduled buttons showing the actual eligible count. Immediate publishing no longer requires a saved reservation date.
- Bulk immediate and scheduled work return tracked jobs and result counts. Draft-only results are not counted as published.
- MCP post_publish/post_schedule use automatic preparation. New post_bulk_publish requires explicit mode, limit and confirmation. Terminal result polling replaces start-only success responses. These changes require desktop 1.3.24.
- Interstage automatic-publication locking, update activity leases, cancellation checkpoints and preservation of uncertain PUBLISHING states prevent conflicting or duplicated publication.

## Verification

- npm run build: production compilation, typecheck and route generation passed.
- Root, scripts and Sites TypeScript checks passed.
- npm run test:mcp-delivery: 22 tests passed, including explicit bulk arguments, ownership/confirmation, completion delivery and no replay.
- npx tsx scripts/verify-scheduled-draft-workflow.ts: immediate/scheduled terminal states, 120 pending polls, one publish call, prepared priority outside the first ten, fewer-than-ten selection, image ordering, revision limit and cancellation/activity guards passed.
- node scripts/verify-auto-publish-route.cjs: mocked route auth/date validation, duplicate rejection, asynchronous completion, cancellation and missing-job handling passed.
- Browser fixture through scripts/qa-auto-publish-server.mjs: all API traffic mocked, no production database or credentials copied. Shopping now and schedule requests sent the correct mode/date. Three eligible travel products rendered 3-item controls and sent limit=3 to both bulk routes. After replacing the legacy SSE progress component, a fresh immediate flow completed with zero browser console errors.
- Screenshot: output/playwright/auto-publish-v1324.png.

## Boundaries

No real blog article was published or reserved in these tests. No installation, GitHub release, Sites production deployment or central update-feed publication was performed.

Process restarts invalidate in-memory local job tracking. Missing-job responses require checking actual publication state; they never authorize automatic replay. Quality gates are preserved; missing evidence or failed image generation can still prevent a product from publishing, with the batch proceeding only when the prior publication is not uncertain.
