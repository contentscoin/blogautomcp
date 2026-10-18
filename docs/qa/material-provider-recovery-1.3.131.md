# Windows 1.3.131: provider failure and incremental material recovery

## Confirmed failure

The October 16 preparation job reported ten failures. Five explicit Codex usage-limit responses became `INVALID_INPUT`; two further source-evidence failures followed image-reading responses with the same usage-limit message. The remaining three source-review failures lack their underlying provider error in the saved top-level record and are not attributed to quota without evidence.

Quota was missing from the provider classifier and the shared preparation-stop list. A failed image read could become an empty fact report and then appear as missing product evidence. Repeating a batch therefore attempted later products against the same unavailable provider.

## Change and preservation contract

- Propagate `CODEX_USAGE_LIMIT_REACHED` across provider, source-image review, local API and preparation workflow boundaries. Ordinary short-term HTTP 429 remains distinct from exhausted usage allowance.
- Stop the batch on a shared quota failure; do not reclassify untouched products as defective manuscripts. Preserve available provider reset hints without guessing a time zone.
- Do not spend the same-input image-recovery budget on a provider outage. Preserve historical entries and recognize explicit historical quota failures without resetting unrelated failed attempts.
- Keep unknown image-submission outcomes blocked until their exact completion/failure and output are established. Do not resend uncertain requests, reuse rejected results, weaken product-photo checks or bypass approval.
- Existing manuscripts and normal image bytes are preserved. Only the ten selected failed materials are recovery targets. Existing saved manuscripts use incremental repair; products without a saved manuscript resume preparation from source verification.
- No publication or scheduling is authorized or performed by this release task.

## Verification status

The provider/source-review regressions pass, including a real preparation runner fixture in which the first revision hits quota, later products receive no calls, and all nine untouched products are interrupted. HTTP-success responses containing a partial image quota failure also stop the batch. Plain quota, nested causes, structured quota, short-term 429, authentication and timeout remain distinct.

All 24 material regression suites pass. Full root TypeScript and lint over every changed TypeScript file pass with no diagnostics. The root TypeScript project now excludes local `tmp` snapshots and `scripts/tmp-*` helpers, which are also absent from the shipped application; production type checking remains enabled.

Independent counterexample review passed for quota classification and completion-backed image recovery. A `submitting` image receipt can only supply a review candidate when the exact original session proves its completed turn, workspace, reference binding, native output bytes and time window. Existing publication image gates still review any recovered candidate. Whole-material planning can reconcile an empty, error-free stale progress record only when current missing coverage and planned requests are both zero.

Packaging, update-channel publication, installed-runtime verification and live recovery results are recorded below after they actually complete. These source results alone do not prove deployment or ten successful recoveries.

## Verified Windows deployment

Runtime source: `a3deb5d5b28c237e85b23167bce41a13d3628a60`. Production build ID: `Kt66k0ySL5LrLy7lU0THP`. Both jobs in [CI 39084636857](https://github.com/contentscoin/blogautomcp/actions/runs/39084636857) passed.

The Windows feed published 1.3.131 at 2026-10-18 01:10:29 UTC. The installer is 347,702,328 bytes, SHA256 `ba9925e5048ccda74958e1fa7b5353cba4fe428a106bbe2a8b2d1a0d708acbf0`. Local artifact digests, approved-device manifest and blockmap, HEAD, a byte range and the complete served installer SHA256/SHA512 agree. Normal chunked GET responses are validated by exact received size and digests even when they omit Content-Length.

The isolated packaged-runtime test passed authenticated metadata/download, isolated cache, package Prisma engine, desktop control and relaunch without running its fixture installer. The real updater subsequently started installation itself. The manual check helper stopped before making a control request because the old process had already exited; no additional installer or forced termination was used.

The actual installed 1.3.131 became ready at 01:16:42 UTC. Runtime source 96/96, compiled files 391/391 and client files 70/70 match the verified package; all 15 canonical image-approval policy files remain unchanged. The native MCP reports 1.3.131 online. Root build and complete package scans found no occurrences of the two known private secret values; the template database has nine empty tables.

After installation, all 4,231 preexisting protected Markdown/image files retain their original bytes. Existing publication fields, Post rows and the 125 publication-attempt records are unchanged. Private evidence is under `tmp/release-1.3.131/` and is not shipped.

## Live recovery and follow-up

One of the five saved manuscripts is excluded from automatic repair by an older interrupted reservation record. The full five-item request was rejected before creating a local workflow. A source-job lookup confirmed no local work existed, and the remaining four eligible saved manuscripts were then selected explicitly with a new request identity. Historical records and the reservation safeguard were preserved.

The actual ChatGPT MCP completed workflow `6289cbbc-4fd6-4624-8958-229f62bcbee9` at 2026-10-18 01:44:28 UTC: one ready, three blocked, no uncertain or pending workflow. The three remaining codes were `SOURCE_REVIEW_INCOMPLETE`, `PHOTO_DESCRIPTION_REPAIR_REQUIRED` and `COMPOSITION_REPAIR_REQUIRED`. These are distinct from the fixed account-quota propagation bug. Products without saved manuscripts have not yet been prepared at this checkpoint. No publication or reservation request has been made.

An independent scan during recovery confirmed all 4,231 original Markdown/image files and all 593 preexisting generation receipts remained byte-identical; the 125 publication receipts and database publication fields were unchanged. New authorized recovery outputs were counted separately.

The Bluefeel manuscript predates the existing rule against inventing photographic observations. A native MCP section-0 revision removed its inaccurate photograph sentence and retained the original revision and all eight photo files. Independent comparison confirmed the other four sections and every image asset remained unchanged, but found unintended rendering changes: removal of an intermediate Connect card and movement/uncaptioning of the original photograph. This is a separate revision-layout bug, not an intended template migration. A focused 1.3.132 follow-up must preserve the saved rendering plan around corrected section text. No readiness claim is made for the three blocked manuscripts or the held historical reservation.
