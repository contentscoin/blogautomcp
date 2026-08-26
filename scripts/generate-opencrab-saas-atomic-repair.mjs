import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "docs", "naver-brandconnect-seo-research-2026-07-01.json");
const OUT_DIR = path.join(ROOT, "docs", "opencrab-saas-atomic-repair-2026-07-01");

const data = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const research = data.research ?? [];
const summary = data.summary ?? {};

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[|]/g, "/")
    .trim();
}

function short(value, max = 120) {
  const text = clean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function list(values, maxItem = 40) {
  const arr = Array.isArray(values) ? values : values ? [values] : [];
  return arr.map((v) => short(v, maxItem)).filter(Boolean).join(";");
}

function kw(value) {
  if (!value || typeof value !== "object") return "none";
  return Object.entries(value)
    .map(([key, count]) => `${clean(key)}:${count}`)
    .join(",");
}

function yn(value) {
  return value ? "Y" : "N";
}

function categoryStats(label) {
  return summary.categories?.[label] ?? {};
}

function titleFormulaFor(product, post) {
  const categoryWord =
    product.categoryMatches?.[1] ||
    product.categoryMatches?.[0] ||
    product.categoryLabel;
  const benefit =
    post?.titleAnalysis?.matchedTokens?.slice(-2).join(" ") ||
    product.categoryMatches?.slice(-1)[0] ||
    "사용 포인트";
  return `${short(product.productName, 48)} + ${short(categoryWord, 18)} + 후기/추천/사용 + ${short(benefit, 18)}`;
}

function imageTargetFor(categoryLabel, posts) {
  const stats = categoryStats(categoryLabel);
  const p75 = Number(stats.p75Images ?? stats.p75ImageCount ?? summary.p75ImageCount ?? 11);
  const maxCompetitor = Math.max(
    0,
    ...posts.map((post) => Number(post.post?.imageCount ?? post.imageCount ?? 0)),
  );
  return Math.max(7, p75, maxCompetitor + 1);
}

function productBlock(item) {
  const product = item.product;
  const posts = item.topPosts ?? [];
  const best = posts[0];
  const imageTarget = imageTargetFor(product.categoryLabel, posts);
  const requiredKeywords = [
    product.productName,
    product.categoryMatches?.[1] || product.categoryMatches?.[0],
    "후기",
    "추천",
    "사용",
    "구매 전 체크",
  ]
    .filter(Boolean)
    .map((value) => short(value, 32))
    .join(";");

  const lines = [
    `P product_id=${product.id} | category=${clean(product.categoryLabel)} | name=${short(product.productName, 90)} | brand=${short(product.storeName || product.inferredBrand, 40)} | query=${short(product.searchQuery, 90)}`,
  ];

  for (const post of posts.slice(0, 3)) {
    const detail = post.post ?? {};
    const analysis = post.titleAnalysis ?? {};
    lines.push(
      [
        `R product_id=${product.id}`,
        `rank=${post.rank}`,
        `url=${clean(post.url)}`,
        `title=${short(post.title || detail.title, 116)}`,
        `img_card=${Number(post.imageCount ?? 0)}`,
        `img_fetch=${Number(detail.imageCount ?? post.imageCount ?? 0)}`,
        `body=${Number(detail.bodyCharCount ?? 0)}`,
        `headings=${list(detail.headings, 28) || "none"}`,
        `kw=${kw(detail.keywordDensityHint)}`,
        `structure=${list(detail.structureType, 18) || "none"}`,
        `tone=${list(detail.tone, 14) || "none"}`,
        `tokens=${list(analysis.matchedTokens, 18) || "none"}`,
        `review=${yn(analysis.hasReviewWord)}`,
        `starts_brand=${yn(analysis.startsWithBrand)}`,
      ].join(" | "),
    );
  }

  lines.push(
    [
      `DELTA product_id=${product.id}`,
      `title_formula=${titleFormulaFor(product, best)}`,
      `image_target=${imageTarget}`,
      `winning_mix=top1 structure + strongest feature keywords + category p75 image target`,
      `required_headings=사용 후기;장점;아쉬운 점;추천 대상;구매 전 체크`,
      `required_keywords=${requiredKeywords}`,
    ].join(" | "),
  );

  return lines.join("\n");
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const byCategory = new Map();
for (const item of research) {
  const key = item.product.categoryKey;
  if (!byCategory.has(key)) byCategory.set(key, []);
  byCategory.get(key).push(item);
}

const manifest = {
  generated_at: new Date().toISOString(),
  source: path.relative(ROOT, SOURCE).replaceAll(path.sep, "/"),
  output_dir: path.relative(ROOT, OUT_DIR).replaceAll(path.sep, "/"),
  product_count: research.length,
  category_count: byCategory.size,
  files: [],
};

for (const [categoryKey, items] of byCategory) {
  const label = items[0]?.product?.categoryLabel ?? categoryKey;
  const stats = categoryStats(label);
  const body = [
    `# CRAB_ATOMIC_CATEGORY_TOP3_EVIDENCE ${categoryKey}`,
    `source_date=2026-07-01`,
    `category_key=${categoryKey}`,
    `category_label=${clean(label)}`,
    `product_count=${items.length}`,
    `category_median_images=${stats.medianImages ?? summary.medianImageCount ?? "unknown"}`,
    `category_p75_images=${stats.p75Images ?? summary.p75ImageCount ?? "unknown"}`,
    `category_common_structures=${(stats.commonStructures ?? []).map((x) => `${clean(x.name)}:${x.count}`).join(",")}`,
    `category_common_tones=${(stats.commonTones ?? []).map((x) => `${clean(x.name)}:${x.count}`).join(",")}`,
    ``,
    ...items.map(productBlock),
    ``,
  ].join("\n");
  const filename = `atomic-top3-${categoryKey}.md`;
  const filePath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filePath, body, "utf8");
  manifest.files.push({
    category_key: categoryKey,
    category_label: label,
    product_count: items.length,
    path: path.relative(ROOT, filePath).replaceAll(path.sep, "/"),
    char_count: body.length,
    estimated_900_char_chunks: Math.ceil(body.length / 900),
  });
}

fs.writeFileSync(
  path.join(OUT_DIR, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify(manifest, null, 2));
