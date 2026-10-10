# Material recovery 1.3.111

## Observed failure and focused correction

Installed 1.3.110 review passed every current body photograph in the remaining Dalba and Zylek packages. It rejected only the thumbnails: a component-only Dalba photograph was judged against the whole kit despite the precise component title, and a full-photo Zylek thumbnail with a large title and soft dark gradient was classified as a graphic panel.

The final auditor used a fixed selected-product-overview intent for every hero instead of the matched asset's actual intent. Its component-appearance rule excluded thumbnail purpose. Its format instructions permitted title overlays but did not explicitly distinguish their permitted gradient/outline from forbidden frames and panels.

The correction forwards the exact hero asset intent as untrusted context, applies component-appearance rules to thumbnails without authorizing whole-set claims, and explicitly defines thumbnail-only permitted contrast treatment. Body title overlays, real panels/insets, wrong visible brands/models/options, unsupported complete-set/quantity claims and negative model verdicts remain blocked. No cache, rejection, approval or generated-candidate result is manually changed.

Actual offline checks, package/feed/install integrity, final approvals and preservation are recorded below only after verification.

## Offline verification

- Full TypeScript passed. Final-image audit passed 106 cases (12 new role/thumbnail cases); receipt, 27 reference-input cases, full-resolution batching and draft-reliability regressions passed.
- New coverage checks component-only thumbnail context, thumbnail-only soft gradient/title contrast, precise hero intent delivery, body section intent precedence, wrong identity/unsupported whole-set claims/panels remaining rejected, and invalid body-slot thumbnail roles.
- The actual request hash invalidates a receipt when the hero intent changes. In-flight intent changes reject; the final whole-candidate binding check also catches a later batch changing an earlier hero. Original reference/output bytes, snapshot, source proof and format checks remain mandatory.
- Independent source review exposed the later-batch mutation counterexample before packaging. It was corrected and verified; no remaining source-level deployment blocker was found. Runtime was frozen before the production build.
