# v1.3.23

- Bulk scheduling now uses the desktop draft pipeline instead of skipping section image repair.
- Existing saved manuscripts are reused. Missing section images are repaired before approval. A content-blocked draft gets one evidence-bound revision; failed approval prevents scheduling.
- Scheduling waits for the terminal product status. Draft-only completion, missing records, or immediate publication are not counted as successful scheduling.
- A running bulk job holds a desktop activity lease so update installation cannot restart the app between pipeline stages.
- Includes packaging protection against overwriting a running desktop runtime.

Validation passed: mocked orchestration tests (also run using packaged Electron/ts-node) cover image-before-approval order, manuscript reuse, pending-to-terminal polling, failed/READY/missing outcomes, and bounded quality repair; TypeScript and production build checks; isolated packaged UI/update smoke (UI 200, authenticated download, relaunch, Prisma). The simulated update is not a real release. Actual Naver reservation/publication has not been verified by these tests. Existing expired reservations are not automatically republished.
