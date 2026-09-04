# Draft reliability and workflow improvements — 2026-09-05

## Scope and conclusion

The inspected failures have local causes: an experience-claim regex, stale saved QC, missing source provenance, image retry identity, and result-delivery handling. Using Sites as the control plane does not explain the local text-QC failures. This investigation does not establish that every production hosting or authentication issue is resolved.

No score-only approval bypass was added. A 96-point draft can still fail a mandatory category. Structural blockers are returned before quality-category failures, so a structure-only `blockers` array must not be interpreted as a text pass.

## Implemented

1. Shared contextual experience detection for content and Spec-first gates. Negations/instructions are not personal claims; adjacent unrelated disclaimers do not excuse actual claims.
2. Explicit saved-text recheck, protected against concurrent writing and updates. It uses verified saved product snapshots, actual rendered text and actual disclosure, records a fingerprint, clears stale generation QC, and revokes old approval. It does not generate text/images or auto-approve.
3. New/revised prepared packages retain source snapshots. Stable external product identity is distinguished from mutable display names and dated URLs. Missing or mismatched provenance fails with an actionable error.
4. Product assessment accepts natural descriptions of benefits and suitable users, including directly adjacent fact/explanation sentences in the same paragraph. Evidence cannot leak across headings or chain through unsupported explanations.
5. Shopping/travel structure guidance derived from the repository's reference-post analysis reaches Codex, MCP context and Spec-first prompts. Vary the argument and paragraph rhythm; preserve schema, section-image identity, user instructions and source boundaries. Do not invent experience or product facts to improve style.
6. Automatic QC repair has two attempts at most and stops on no accepted improvement. A higher score cannot replace a draft with a new blocker. Failed travel preparation can retain a reviewable draft; direct publication remains gated.
7. Stable per-draft/section/prompt image checkpoints reuse completed artifacts across partial retries. Changed inputs invalidate reuse. Submission uncertainty is not retried as new generation; stale locks require a provably dead owner. Remove unconditional download waiting while keeping artifact stability and authentication checks.
8. MCP completion outbox preserves successful execution results until delivery is acknowledged. Retry delivery, not publication. Heartbeats continue during delivery; identical owner-device completion is idempotent. Bounded, permission-checked result pagination preserves large multilingual drafts.
9. UI lists outstanding text/image conditions, separates attempted repair from applied changes, offers latest-QC recheck and missing-image recovery, prevents conflicting actions, and labels existing drafts as review/edit rather than new generation.

## Verification

- Final root production build (`npm run build`): passed, including TypeScript.
- Final Sites production build (`npm run site:build`): passed. Build is not deployment.
- Windows unpacked test package: `out/qa-20260905/win-unpacked`; packaging passed. Diagnostic copy/revalidation utilities excluded.
- `pwsh -NoProfile -File scripts/verify-packaged-auto-update.ps1 -AppPath 'out/qa-20260905/win-unpacked/BrandConnect Automation.exe'`: passed. Verified HTTP 200 UI, Electron control bridge, process relaunch, packaged Prisma engine, fixed generation settings, authenticated metadata/artifact download and token-redacted logs. The reported 1.3.15 was a fake update fixture for the 1.3.14 test package, not a released version. Fixture installation disabled; production installation and protocol registration untouched.
- `test:mcp-delivery`: 13 tests passed, including SQLite route integration, publication execution-once, late heartbeat, duplicate completion, result paging, ownership, credential isolation and outbox-size/privacy checks.
- `test:draft-ui`: 8 tests passed; additional content/display regressions retain mandatory-category failures at 96 points.
- `test:experience-context`: 32 cases across both gates, 12 clause-boundary cases and 3 title/mode cases passed.
- `test:quality-repair`: 7 acceptance/regression cases passed.
- `test:image-batch-progress`: 23 offline checks passed, including actual caller/worker checkpoint identity, partial resume and timeout behavior.
- `test:generated-image-selectors`: 11 offline Chromium DOM checks passed. References, avatars, broken artifacts and echoed uploads do not count as generation.
- `test:section-images`, `test:image-timeouts`, `test:image-resume`, `test:writing-timeouts`, `test:writing-harness`, `test:writing-structure`, `test:product-substance`, `test:saved-text-revalidation`, `test:post-spec`, `test:post-composition`, `test:brand-post-quality`, `test:brand-post-package`, `test:package-qc-reconcile`, `test:travel-draft-resilience`, `test:mcp-activation`: passed during this work.

## Real saved-draft UI reproduction (isolated copies only)

The browser used localhost:43128 with a copied database and copied packages. No Naver login or real remote activation was copied. Background control traffic went to a local mock. Original manifests were not mutated.

- Roborock F25 RT: explicit UI recheck replaced stale 61-point experience failure with current 96-point QC. The experience signal passes. Recommendation/fit substance still fails, and shopping-scale/shopping-verdict lack required images. Approval correctly stays disabled. A score increase is not publication readiness.
- Taiwan four-day package: 15 existing images, but the saved package lacks a verified snapshot, non-null PostSpec and saved MCP context. Recheck returns `QC_SOURCE_REQUIRED` without replacing the package. Source recovery is necessary; the draft itself must never be used as evidence.

## Remaining production acceptance

- Real model generation time and naturalness have not been measured in this work. Offline resume tests prove no redundant submissions, not a five-minute posting guarantee.
- Run one representative shopping and one travel generation with the intended logged-in session, then inspect source fidelity, paragraph variety, every section image and approval state. Record collection/text/repair/image/application durations separately before setting a latency target. Credit-consuming runs need their cost/approval handled before starting.
- Restore missing source context for legacy drafts and fill genuine section-image deficits; do not approve them merely because code changed.
- Sites publication and Windows update-feed publication are separate release actions. This record does not claim a new release, installed update, live MCP account validation or public blog publication.

## Further improvement priorities

1. Stage-level latency percentiles and provider wait versus local overhead, so a five-minute target is measured instead of achieved by unsafe timeouts.
2. A small source-locked shopping/travel benchmark set with human review of repetitive openings, paragraph endings and usefulness; prompt delivery tests alone cannot prove writing quality.
3. Guided source-context recovery and a single actionable failing-section list for legacy packages, retaining identity checks.
4. Production MCP acceptance covering read, prepare, submit, image application, approval and an explicitly confirmed publication; keep execution-once checks on every mutation.
