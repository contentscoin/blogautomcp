# Windows 1.3.132: retain the layout during a text revision

The live 1.3.131 recovery exposed a separate saved-manuscript revision defect: reconstructing the composition from an incomplete section plan removed the intermediate Connect card, moved the original photograph and dropped its caption, even though the requested change was one inaccurate photo-description sentence. Text in untargeted sections and photo bytes survived, but the render plan did not.

The focused follow-up preserves the prior section metadata and render nodes, updates only the mapped section text/title, and refreshes quality through the existing contract. An ambiguous mapping must fail without replacing the saved package. Existing image approval policies and final approval/publication gates remain unchanged.

Full TypeScript and the complete blocked-material repair suite pass, including the actual writer resolver executed against a legacy layout. Composition and draft-reliability regressions also pass. Lint reports no errors; three unchanged preexisting unused-function warnings remain in the large writing agent. Independent counterexamples pass 52/52, including the actual before/current Bluefeel compositions, split text blocks, ambiguous mappings and attempted image/card metadata changes. All 15 canonical approval policy files match the frozen 1.3.131 source.

The independently calculated Bluefeel restoration restores its saved layout around the already corrected text. It changes no photo bytes, other section text, approval or publication state and still requires official final validation.

Windows 1.3.132 was published at 2026-10-18T02:08:07Z and installed through the normal updater. CI 39088001532 passed both jobs. The served installer (347710803 bytes) matched the local SHA256 `50ea23f6759f19ffde849f00c3fbbf642284e062dc7c9511a39c244b0d449b85` and SHA512 in a complete stream comparison. Installed runtime 97/97, compiled build 391/391 and UI 70/70 files matched the verified package; the native MCP connection reported version 1.3.132 and idle product work.

Actual MCP text revisions then exposed two limits that the resolver-only regression did not cover. The single-render-block path refused legitimate paragraph splits/merges used by quality repair. More importantly, the downstream image-continuity reconciler rebuilt unchanged photo nodes after the preserved render plan, moving the original photo and dropping its caption. The Bluefeel live diff retained all eight photo files, other section text and both Connect cards, but failed this layout-preservation check. This result is not accepted as complete; the 1.3.133 follow-up must cover the package writer and continuity step together.

The private release evidence directory is `tmp/release-1.3.132/`; the original 1.3.131 preservation baseline remains authoritative for existing manuscript/photo bytes and publication history. No blog publication or scheduling is authorized.
