# 1.3.14 — generated image detection and safe photo cards

- Detect generated images in current ChatGPT section-based conversation turns, preserving uploaded-reference exclusions and deduplication.
- When shopping body product extraction fails, retain the complete original photo as an editorial card over the generated background. Record EDITORIAL_CARD, not LOCKED_PRODUCT.
- Card output uses Node buffer I/O for long Windows paths and saves original/background hashes.
- Failed image slots now make the worker result unsuccessful. Privacy-preserving diagnostic counts and an explicit single-job visible-browser hold are available.
- Personal one-off diagnostic/recovery scripts are excluded from desktop packaging.

## Evidence and limits

- Existing desktop profile produced and downloaded one real background in about 105 seconds. An earlier diagnostic incorrectly used the repository profile; that diagnostic is not evidence of desktop authentication failure.
- The recovered comparison section was saved as EDITORIAL_CARD; the installed app served its PNG with HTTP 200. One other section remains missing in that draft; release does not approve, publish or automatically regenerate drafts.
- Source verification: 22 batch fixtures, 10 generated-image Chromium fixtures, card pixel preservation/long-path checks and scripts TypeScript passed before release preparation. Final build and publication are separate release checks.

## Final release verification

- Full Next.js production build, scoped ESLint, section-image and QC reconciliation checks passed. The build caught an overly narrow ProcessEnv test type; it was corrected before packaging.
- Packaged Windows smoke passed: 1.3.14, HTTP 200, fixed settings, packaged Prisma engine, authenticated fixture update download and actual process relaunch. The synthetic 1.3.15 fixture was not installed.
- Five changed runtime files match package SHA-256 hashes; personal diagnostic/recovery scripts are absent from the installer payload.
- GitHub CI run 33860698706 did not start any steps because account payments/spending limits blocked both jobs. Remote CI is not claimed passing.
