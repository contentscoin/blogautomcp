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
