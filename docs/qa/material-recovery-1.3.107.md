# Material recovery 1.3.107

## Live regression found after 1.3.106

The original report spans 19 materials (5 ready and 14 blocked). The first explicit 14-item repair request did not dispatch: eight saved drafts had planned dates and were excluded by a guard that treated any `scheduledPublishAt` as an actual reservation. Six eligible drafts were then repaired under job `301e29b9-ef33-48ae-8b3c-9dbebbb26a9a`; the job terminated with six failures, without publication or scheduling.

Five of those failures were malformed comparison pairs rather than a completed negative pixel verdict. Exact Codex review responses were scoped to the job time, `blogautomcp-draft` source, drafting working directory and product context. All five returned `consistent` with a dimension-whitelisted non-`none` variation; the JSON schema allowed those combinations, but the strict parser rejected them. The boolean decisions did not independently establish final readiness.

| Product | Review thread | Invalid pair |
| --- | --- | --- |
| Cuckoo | 01a1252e-cf7c-78f0-bce8-aaffd2516ff7 | intrinsicPrinting: consistent / nonessential-print-legibility |
| Aveeno | 01a12530-096b-7b00-aa7f-9ae429e78a5d | productShape: consistent / viewpoint-or-pose; visibleOption: consistent / main-item-only |
| Smartcara | 01a12530-d24a-7472-b5da-2433d4b0669d | intrinsicPrinting: consistent / nonessential-print-legibility; visibleOption: consistent / main-item-only |
| AAWireless | 01a12531-cc72-7953-b9ae-a69f03f2c348 | productShape: consistent / viewpoint-or-pose |
| Roborock | 01a12532-5658-7181-af80-5cd74fe6f2ba | intrinsicPrinting: consistent / nonessential-print-legibility |

## Corrections

- Correlate comparison result and variation in the provider's nested `anyOf` schema and explicit prompt examples. The parser, product-fidelity acceptance criteria and rejection of contradictions/unverifiable evidence remain unchanged. No boolean normalization or automatic paid retry was added. Existing candidate files can be freshly reviewed; the fix does not require regenerating them.
- Allow saved READY/FAILED drafts with a planned date into repair while preserving their dates. Reject actual published/scheduled statuses, URLs, publication timestamps, any historical successful/uncertain publication, active/outcome-unknown execution and submission/confirmation evidence. A later definitive failure cannot erase older publication proof. Contradictory `FAILED_BEFORE_SUBMIT` receipts remain blocked.
- The Dalba draft contained an unverified assertion that its photo label read 100ml. A targeted normal draft revision removed that assertion and the inferred mismatch with the selected 180ml toner, retaining other sections and existing images. Source binding remains subject to fresh visual review.

## Verification

- Repair selector: 161 preservation/eligibility/uncertainty checks passed.
- Actual material API fixtures: 33/33 passed, including six unplanned plus eight planned drafts, unchanged dates/source inputs, reversed historical publication order and contradictory receipts with zero dispatch.
- Material controls and failed rewrite/repair controls passed.
- Independent read-only VM review: planned-only draft included; older confirmed publication followed by a failure excluded; contradictory pre-submit receipt excluded.
- Provider-emitted comparison schema: 216 offline Ajv cases passed. The exact observed invalid pairs are rejected by both schema and parser; dimension-specific allowed pairs, real contradictions, required observations, unknown fields and existing passed-v2 compatibility remain covered. Scoped ESLint passed.
- [CI 38042967968](https://github.com/contentscoin/blogautomcp/actions/runs/38042967968), code head `9f3f7b7`: root and Sites typecheck, lint, complete regression/unit checks and production builds passed. Local full TypeScript also passed.
- Before the next release, all 72 existing asset files retained identical bytes and all 5 previously ready materials retained title, manuscript hash, approval and asset metadata.

## Release

- Windows production build and NSIS packaging completed. Packaged metadata is 1.3.107; twelve changed runtime files match source SHA. Temporary diagnostics and root secret configuration are excluded.
- Installer `BrandConnect-Automation-Setup-1.3.107.exe`: 345502540 bytes, SHA256 `95a85168c2e588cc844ed815804ed241c370d3d879034ff59406914b70e1977c`. Blockmap: 352548 bytes. Local manifest/SHA512 validation passed.
- Existing Sites Windows update feed activated 1.3.107 at `2026-10-10T10:01:49.252Z`; publication re-queried central metadata and matched the expected release. The PC detected and downloaded 1.3.107 through its normal update path.
- Normal installation/restart completed. The local API reports 1.3.107 and all twelve installed runtime files match source SHA. No direct installed-file patches were used.

Actual recovery outcomes are recorded after final verification. Historical job failures are retained; no blog publication or reservation is authorized by these repairs.
