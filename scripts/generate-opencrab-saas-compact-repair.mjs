import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "docs", "naver-brandconnect-seo-research-2026-07-01.json");
const OUT_DIR = path.join(ROOT, "docs", "opencrab-saas-compact-repair-2026-07-01");

const data = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const research = data.research ?? [];
const summary = data.summary ?? {};

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").replace(/[|]/g, "/").trim();
}

function cut(value, max) {
  const text = clean(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;
}

function list(values, max = 5, itemMax = 18) {
  return (Array.isArray(values) ? values : [])
    .slice(0, max)
    .map((value) => cut(value, itemMax))
    .join(";");
}

function kw(value, max = 7) {
  if (!value || typeof value !== "object") return "none";
  return Object.entries(value)
    .slice(0, max)
    .map(([key, count]) => `${clean(key)}:${count}`)
    .join(",");
}

function catStats(label) {
  return summary.categories?.[label] ?? {};
}

function imageTarget(label, posts) {
  const stats = catStats(label);
  const p75 = Number(stats.p75Images ?? summary.p75ImageCount ?? 11);
  const maxPost = Math.max(0, ...posts.map((post) => Number(post.post?.imageCount ?? post.imageCount ?? 0)));
  return Math.max(7, p75, maxPost + 1);
}

function block(item) {
  const p = item.product;
  const posts = item.topPosts ?? [];
  const categoryKeyword = p.categoryMatches?.[1] || p.categoryMatches?.[0] || p.categoryLabel;
  const lines = [
    `P|id=${p.id}|cat=${clean(p.categoryLabel)}|name=${cut(p.productName, 74)}|brand=${cut(p.storeName || p.inferredBrand, 28)}|q=${cut(p.searchQuery, 74)}`,
  ];

  for (const post of posts.slice(0, 3)) {
    const d = post.post ?? {};
    const a = post.titleAnalysis ?? {};
    lines.push(
      [
        `R|pid=${p.id}`,
        `r=${post.rank}`,
        `url=${clean(post.url)}`,
        `title=${cut(post.title || d.title, 82)}`,
        `img=${Number(post.imageCount ?? 0)}/${Number(d.imageCount ?? post.imageCount ?? 0)}`,
        `body=${Number(d.bodyCharCount ?? 0)}`,
        `h=${list(d.headings, 4, 18) || "none"}`,
        `kw=${kw(d.keywordDensityHint)}`,
        `st=${list(d.structureType, 5, 12) || "none"}`,
        `tone=${list(d.tone, 4, 10) || "none"}`,
        `tok=${list(a.matchedTokens, 6, 14) || "none"}`,
        `review=${a.hasReviewWord ? "Y" : "N"}`,
        `brandStart=${a.startsWithBrand ? "Y" : "N"}`,
      ].join("|"),
    );
  }

  lines.push(
    [
      `D|pid=${p.id}`,
      `title=${cut(p.productName, 40)} + ${cut(categoryKeyword, 14)} + 후기/추천/사용 + 구체혜택`,
      `imgTarget=${imageTarget(p.categoryLabel, posts)}`,
      `headings=사용 후기;장점;아쉬운 점;추천 대상;구매 전 체크`,
      `keywords=${cut(p.productName, 36)};${cut(categoryKeyword, 14)};후기;추천;사용;구매 전 체크`,
    ].join("|"),
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
  product_count: research.length,
  category_count: byCategory.size,
  files: [],
};

for (const [key, items] of byCategory) {
  const label = items[0]?.product?.categoryLabel ?? key;
  const stats = catStats(label);
  const text = [
    `# CRAB_COMPACT_TOP3 ${key}`,
    `date=2026-07-01|category=${clean(label)}|products=${items.length}|medianImg=${stats.medianImages ?? summary.medianImageCount}|p75Img=${stats.p75Images ?? summary.p75ImageCount}`,
    `legend=P product, R rank evidence, D writing delta. img=search_card/fetched. Do not infer missing fields.`,
    ``,
    ...items.map(block),
    ``,
  ].join("\n");
  const filename = `compact-top3-${key}.md`;
  const filePath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filePath, text, "utf8");
  manifest.files.push({
    category_key: key,
    category_label: label,
    product_count: items.length,
    path: path.relative(ROOT, filePath).replaceAll(path.sep, "/"),
    char_count: text.length,
  });
}

fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest, null, 2));
