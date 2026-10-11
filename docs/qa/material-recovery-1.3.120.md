# Material recovery and idle desktop polling 1.3.120

The 1.3.119 generation-recipe and candidate-review fixes are retained. The installed 1.3.118 PC definitively finished its Minix-only repair without applying a new photograph or approval. Its normal 1.3.119 differential download then remained slow. A fresh material retry is withheld until the corrected runtime is actually installed.

## Verified source diagnosis

The desktop material library fetched a full material view every four seconds, and the global job banner fetched the last 50 jobs every five seconds, even without active jobs. Neither serialized requests nor paused hidden windows. Each view computes package readiness, image geometry/provenance and whole-file revision hashes; the full view also reread products for failed and repair candidate selection. Current revision-only footprints were 507 MiB for the historical job subset and 590 MiB for the full library. OS process counters reached approximately 2 TB logical reads, with a continuously occupied CPU; these counters do not establish physical disk throughput or isolate every read cause.

Electron runs the embedded Next handler and differential update work on the main process. `backgroundThrottling:false` deliberately keeps background MCP polling responsive. Its documented Page Visibility behavior means `document.hidden` alone cannot detect a hidden/minimized native window, including an initial `show:false` window. This was caught as a counterexample before declaring the hidden-window fix complete. Reference: [Electron BrowserWindow Page visibility](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility).

## Scope and preservation

The correction is restricted to display polling and request-scoped repeated material reads. Publication approval, fresh mutation validation, image-byte hashes, generation receipts, cancellation/unknown-output stop guards and background RemoteAgentPoller/watchdog behavior remain in place. No persistent readiness cache is introduced. Existing manuscripts and normal images remain protected. Failure details remain collapsed by default, with current counts and progress visible.

## Implementation and offline verification

The UI schedules its next request after settlement, with active intervals of four/five seconds and an idle interval of 30 seconds. A 30-second deadline aborts hung fetches and settles cleanup even when a fetch ignores abort. Hidden/minimized windows pause only material polling. A narrowly scoped native visibility hint handles initial hidden windows, reloads and out-of-order show/hide events without changing background automation or adding privileged IPC. Pending refreshes coalesce before a new request starts; an action accepted during an already started request still waits for a subsequent fresh read. Cleanup aborts old signals and prevents unmanaged refreshes after unmount or connection-kind changes.

The API uses a request-local material reader shared by the list and both candidate selectors, including errors and missing materials. A later GET reconstructs the map and reads fresh bytes. Mutation and publication paths retain independent verification.

Local verification passed: 12 deterministic polling/native-bridge cases, 34 material API cases, the existing six display cases, 65 failed-rewrite checks, both UI button harnesses, TypeScript and targeted ESLint with no errors or warnings. These tests include slow/hung fetches, rapid hide/show toggles, late aborted completion, post-action freshness, failed-request recovery, native hidden state with `document.hidden:false`, stale native hints, unchanged failure-detail behavior and GET-only memo freshness. The new cases run in the normal CI failed-material-rewrite command. The auto-update manager regression also passed its authorization, idle guard and silent-install checks.

Exact CI, package and server integrity, installation confirmation, live single-material result and post-repair preservation are recorded below as they complete. None are inferred from source inspection alone.
