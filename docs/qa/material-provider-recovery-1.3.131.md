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
