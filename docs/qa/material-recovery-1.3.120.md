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

Independent read-only review reran all 46 API/polling cases and the actual UI controls. Additional component-level VM probes completed old aborted GETs after a fresh response and confirmed neither component's state was overwritten. No release-blocking defect was found. Real installed-window behavior and observed idle performance remain separate live checks.

## Release verification

CI `38141211203` passed both root and Sites checks, full unit commands and production builds for source `e5f2d8b9f75f3710294f1a5eaf76273230cf61b8`. The local production build, TypeScript and NSIS packaging passed. All 47 packaged runtime-file SHA256 values match the source, temporary/secret files are excluded, and the three compiled UI chunks containing the native-visibility consumer exactly match the build output. The extended verification helper initially used Unix separators for a newly packed Electron main entry; using the archive's Windows lookup path corrected the helper, and the independent packaging source assertion also passed.

Windows update publication completed at `2026-10-11T13:06:59.014Z`. The installer is 345,635,900 bytes, SHA256 `82fd445a94497718d3477b6a98c52677a84b3433a063a5bd7089d3627291b35e`; the 352,945-byte blockmap has SHA256 `6d651e39f28dfb687113f98ba7e61d31a610a4e049a04d3ed9691c6fa1e0ff4b`. Exact release metadata, authenticated paired-device manifest, blockmap SHA, installer HEAD and HTTP 206 byte-range validation all passed. An authenticated full-file response delivered all 345,635,900 bytes in 18,380 ms and matched both SHA256 and SHA512. This distinguishes the serving path from the installed app's slow differential-copy path.

At `2026-10-11T13:08:23Z`, the same four 1.3.118 application processes started at 11:41Z were still running. The updater recognized 1.3.120, but retained the slow prior download in progress. A guarded installer check refused to run NSIS against the live app. Normal user exit was requested; no forced termination, cache overwrite or live runtime patch was performed. No 1.3.119/120 material request has been sent. The selected Minix failure is definite, eligible for exactly one fresh protected repair after actual installation; uncertain/authentication/cancelled work and source-blocked other materials remain excluded.

Installation confirmation, installed idle-performance observations, live single-material result and post-repair preservation remain pending. None are inferred from successful CI or publication.
