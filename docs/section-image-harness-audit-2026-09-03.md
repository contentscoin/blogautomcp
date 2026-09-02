# Section-image and writing harness audit (1.3.8)

## Observed failure

The SAGA travel package had a passing editorial score, ten content sections, and only a hero plus two body images. Generated PNGs existed in its work directory after the last manifest write. The browser batch exposed results only at the end, limited requests to four, and used a fixed eight-minute total deadline. A later error discarded already completed images from the caller's perspective. Repair stopped after an error and treated one generated image as sufficient even for a section whose minimum was two.

## Implemented contract

- All illustrated sections have at least one required image; explicit text-only sections (`maxImages: 0`) remain text-only. Spec-first and final composition share this rule.
- Automatic repair runs for travel and shopping. Automatic and manual repair use the same complete plan, without the four-request truncation. Originals do not satisfy generated-image coverage.
- Each completed result is checkpointed by the producer and applied to the package immediately. A failed result does not starve later sections. Only remaining deficits are planned on the next user retry; there is no automatic paid retry loop.
- A run pins the immutable draft text/section identity. Late results cannot overwrite a replaced draft; draft mutations are rejected while its image repair is active.
- Batch deadlines scale with the number of sequential jobs. Timeouts/nonzero exits recover completed checkpoint records.
- Long-running MCP-to-local JSON calls use a bounded loopback-only HTTP transport with a three-hour total deadline rather than fetch's shorter implicit response-header deadline. Redirects, non-loopback targets and oversized bodies are rejected.
- The stop action aborts active image runs and their exact child process trees. Results arriving after cancellation are not applied; already saved successes remain.
- Preview and approval use existing files, per-section minima, and generated provenance. Identical image files are rejected as new generation.
- Image prompts use the actual section heading and body, rather than the positional template's unrelated image intent.
- Assistant-owned, loaded images alone count as ChatGPT output. User attachments, composer previews, avatars, hidden/broken previews, echoed reference URLs, and non-image downloads are excluded.
- Editorial score is preserved during image repair. UI and local/MCP next-action messages distinguish text failure from image/composition failure.
- API/Codex/exported context/browser recovery share mandatory writing bounds and output schema. Model-authored evidence candidates cannot expand the trusted product fact set.

## Verification

Passed commands on 2026-09-03:

- `npm run test:section-images` (travel + shopping, more than four slots, two-image minima, partial persistence, retry deficits, missing files, duplicate rejection, no-op approval preservation)
- `npm run test:image-batch-progress` (16 offline transport/producer checks)
- `npm run test:generated-image-selectors` (9 offline Chromium DOM fixtures, external requests blocked)
- `npm run test:writing-harness` (4 browser variants, 7 unsupported evidence candidates, shared schema and image-only handoff)
- `npm run test:local-json-fetch` (15 isolated loopback transport cases, delayed headers, total deadlines, cancellation, redirects, bounds)
- `npm run test:brand-post-quality`, `test:brand-post-package`, `test:post-composition`, `test:post-spec`, `test:draft-snapshot`, `test:travel-draft-resilience`, `test:chatgpt-browser-automation`, `test:api-auth`
- Root and Sites TypeScript checks; scoped ESLint; root production build; Sites production build.
- `npm run test:mcp-activation` and `npm run test:auto-update`; live MCP `agent_get_status` confirmed the paired PC online and no queued/running remote job (old app 1.3.7 before rollout).

## Limits and operating notes

No paid generation or real ChatGPT image-generation cycle was run by this audit. Real browser markup and login changes remain runtime dependencies. An existing user's generation job was not interrupted or its package modified. New release packaging uses a separate output directory.

Cancellation tests cover signal propagation and rejection of late results; actual Windows process-tree termination was reviewed but not exercised against a live paid generation session.

The editorial QC is still heuristic, not claim-level source verification: supplied source data is trusted and unsupported prose claims can evade its lexical checks. Destination coverage remains partly global. A score of 100 is not a factual guarantee or a substitute for the image/composition/approval gates.

Existing incomplete drafts can use the missing-image action after updating; they do not need text regeneration solely to repair images. Disabling `BRAND_POST_AUTO_SECTION_IMAGES` (or the legacy fallback setting) disables automatic generation, but does not make missing section images valid.
