# 1.3.21 — Product photo provenance and travel thumbnail text

## Changes

- MCP shopping thumbnail application checks that the reference actually shows the product, trying up to 12 supplied references instead of blindly accepting the first image.
- Section image composition uses ORIGINAL assets only; generated/composed assets cannot become product references. Detail photos are no longer rejected by filename alone.
- Failed product extraction no longer reports a background-only scene as successful. Existing images remain intact; the affected request reports its failure.
- Travel copy retains destination brackets such as [다낭/호이안], excludes price/perk tokens and accommodation/promotion brackets, and separates duration from the destination headline.
- Travel backgrounds explicitly forbid generated typography. The renderer uses measured label fitting, a supporting line and a vertical readability gradient. MCP uses the normalized copy label instead of the full advertising title.

## Validation

- Thumbnail bridge test: original RGB preserved, 1080 × 1080 output.
- Image batch regression: 23 checks, including rejection of background-only shopping results.
- Travel editorial and problematic-title regression tests passed.
- No paid generation or public blog posting was performed.

## Remaining limitation

Complex product backgrounds can still fail safe extraction. This release reports that failure rather than fabricating a product or claiming an empty background satisfies the request. Existing saved thumbnail pixels are not retroactively rewritten.
