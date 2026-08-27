---
name: product-photo-thumbnail-copywriting
description: Create evidence-safe Korean Naver Blog thumbnails from actual product photos, including copy hierarchy, image selection, layout direction, and render QA. Use for ShoppingConnect product thumbnails or when a user asks to turn a real product image into a copywritten thumbnail.
---

# Product Photo Thumbnail Copywriting

Use the supplied or scraped product photo as the recognizable product source. The result must remain a truthful product thumbnail, not a newly invented product rendering.

## Required outcome

- Keep the actual product visually recognizable: shape, color, logo, material, controls, and package details must not be fabricated.
- Build one clear mobile-first message hierarchy: product label, headline, supporting line, optional badge, optional CTA.
- Derive copy only from the product name, verified features, confirmed price or benefit data, and the article's reader intent.
- Render Korean text deterministically in SVG/Sharp or another text-safe compositor. Do not rely on an image model to spell final Korean copy.
- Use the generated thumbnail as the first blog image only after the product source and rendered copy pass QA.

## Workflow

1. Select a source image where the main product is large, unobstructed, and not a review photo, coupon banner, delivery notice, or long detail-page strip.
2. Classify the reader intent as one of: compare, feature-check, value-check, problem-solution, or usage-fit.
3. Draft copy using [references/copy-and-layout-rules.md](references/copy-and-layout-rules.md). Reject claims that cannot be traced to supplied product data.
4. Choose a layout that preserves the product's strongest visual area and puts text on a quiet or darkened region. Never cover the product nameplate or a decision-critical detail.
5. Render at 1600x900 for the blog's first image, with safe margins and contrast that remains legible in a small feed preview.
6. Verify the output by inspecting the actual image. Check product identity, Korean spelling, crop, contrast, hierarchy, and absence of unsupported discounts or experience claims.

## Fail closed

- If no usable real product photo exists, do not invent one. Return a clear missing-source result.
- If a price, discount, ranking, review count, or performance claim is unverified, omit it or change it to a neutral check prompt.
- Do not write `직접 써봄`, `인생템`, `최저가`, `1위`, `품절 임박`, or equivalent claims without explicit evidence.
- Do not use tiny multi-line copy, more than one dominant headline, or decorative badges that compete with the product.

## Application contract

For BlogAutoMCP, save the selected source image and copy settings before publishing. The publishing agent must regenerate or reuse the saved thumbnail deterministically and insert it first. A preview alone does not count as applied.
