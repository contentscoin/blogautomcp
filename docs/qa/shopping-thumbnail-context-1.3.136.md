# Shopping thumbnail context regression

## Problem and change

A generic speaker name containing `캠핑` selected the cooler fallback and rendered
`보냉력 체크`. Camping and picnic are usage contexts, not evidence that the product
is a cooler. An article title could also select an unrelated product theme.

The fallback now uses the product name and requires a cooler-container noun for
cooler copy, category and scene selection. Unknown products receive neutral copy.
Existing product-understanding themes retain priority. Saved cooler copy is not
compatible with a generic product lacking the corresponding container identity.

## Recovery and preservation

The existing completed-image recovery path is unchanged. With valid completion,
reference and output bindings, it renders the current copy locally. Changed copy
can produce different composed bytes from the same completed natural photograph;
the same rejected composed bytes remain blocked. Incomplete or changed bindings
do not authorize another provider submission or automatic adoption.

Recovered images still require the existing reference-fidelity and final
publication-image checks. This change grants no approval and does not publish or
schedule a post. Text-only recovery and hero-only application must preserve body
photographs, paragraphs, layout, captions and link cards. Historical files and
generation receipts remain intact.

## Verification

- `verify-shopping-thumbnail-copy.ts`: camping speaker/fan/light/cable and device
  cooler negatives; real cooler-container positives; known product themes; large
  text and photograph geometry checks.
- `verify-image-batch-progress.ts`: public recovery entry point with real local
  composition and isolated completed-request fixtures. Changed copy passes the
  existing fidelity callback; unchanged rejected output, changed reference and
  incomplete submission are refused. No image provider is invoked by these tests.
- Existing material regression, type checking and lint remain required.

These are software and isolated-fixture checks. They do not certify a live
product image or replace the final approval checks for an actual saved material.
