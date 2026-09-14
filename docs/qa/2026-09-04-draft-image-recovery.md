# Draft memo and image completion recovery

## Observed causes

- A completed ChatGPT image remained visible alongside a global stop button. The old wait required the button to disappear, so it returned a timeout despite the artifact being present.
- The Codex writing path omitted `BRANDLINK_DRAFT_MEMO`. Default travel instructions also discouraged the requested lodging discussion.

## Changes

- Accept an assistant-owned, fully loaded artifact when source and dimensions remain stable for 15 seconds, even if the global stop button remains. Keep reference-image exclusions, deadlines, and authentication/security checks.
- A transient artifact-query failure resets stability and continues observation within the deadline; it does not trigger generation again.
- Carry user memo requirements through generation, repair and human-tone polishing. Preserve explicitly requested titles through the existing sanitizer, and do not treat memo text as factual evidence.
- Exclude the local read-only conversation inspection utility from desktop packages.

## Verification

- Production build passed, including Next.js compilation and TypeScript.
- Script TypeScript and changed-file ESLint passed (existing unused-function warning in `simple-agent.ts`).
- Image timeout, generated-image DOM (11 fixtures), thumbnail wait, batch progress, section-image repair, package-QC reconciliation, writing harness and title-rule tests passed.
- Live recovery downloaded the already-generated first image without regeneration and applied it through the desktop API.
- Live regenerated article preserved the exact requested title and included a source-grounded hot-spring hotel section. Content QC: 100, duplicate sentences: 0.
- Current PC runtime scripts have the fix. Installer/feed version remains 1.3.14; this record does not claim a new central release.

## Publication

- Published one article: https://blog.naver.com/connectableai/224401370192
- Exact title: 오사카 3일 여행, 교토·고베 일정과 온천호텔 선택 기준
- Final content QC 100; composition/image gate 100; no blockers or warnings.
- Ten section images plus thumbnail (11 total); all files present, all ten section slots fulfilled.
- Desktop publisher executed 11 image nodes and two travel-connect cards. Its older summary line says 10 because it counts the pre-render filtered list; the actual renderer and public DOM both confirmed 11.
- Verified in a logged-out in-app browser: article accessible, exact title and lodging section present, AI-reference-image/undetermined-hotel notice present, and all 11 post image elements loaded at natural width 966 (thumbnail 966x966, body 966x725).
- No additional public article was created by this run.
