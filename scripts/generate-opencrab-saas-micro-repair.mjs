import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "docs", "naver-brandconnect-seo-research-2026-07-01.json");
const OUT_DIR = path.join(ROOT, "docs", "opencrab-saas-micro-repair-2026-07-01");
const SLOT_SIZE = 900;

const HEADINGS = "\uC0AC\uC6A9\uD6C4\uAE30;\uC7A5\uC810;\uC544\uC26C\uC6B4\uC810;\uCD94\uCC9C\uB300\uC0C1;\uAD6C\uB9E4\uC804\uCCB4\uD06C";
const INTENT_KEYWORDS = "\uD6C4\uAE30;\uCD94\uCC9C;\uC0AC\uC6A9;\uAD6C\uB9E4\uC804\uCCB4\uD06C";

const data = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const research = data.research ?? [];
const summary = data.summary ?? {};

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[|^\n\r]/g, "/")
    .trim();
}

function cut(value, max) {
  const text = clean(value);
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

function list(values, max = 4, itemMax = 6) {
  return (Array.isArray(values) ? values : [])
    .slice(0, max)
    .map((value) => cut(value, itemMax))
    .filter(Boolean)
    .join(";") || "none";
}

function kw(value, max = 3) {
  if (!value || typeof value !== "object") return "none";
  return Object.entries(value)
    .slice(0, max)
    .map(([key, count]) => `${cut(key, 6)}:${count}`)
    .join(",");
}

function imageTarget(categoryLabel, posts) {
  const stats = summary.categories?.[categoryLabel] ?? {};
  const p75 = Number(stats.p75Images ?? summary.p75ImageCount ?? 11);
  const maxPost = Math.max(
    0,
    ...posts.map((post) => Number(post.post?.imageCount ?? post.imageCount ?? 0) + 1),
  );
  return Math.max(7, p75, maxPost);
}

function microDoc(item) {
  const product = item.product;
  const posts = item.topPosts ?? [];
  const categoryKeyword =
    product.categoryMatches?.[1] ||
    product.categoryMatches?.[0] ||
    product.categoryLabel;

  const lines = [
    `# CRAB_MICRO_TOP3 pid=${product.id}`,
    `P|pid=${product.id}|cat=${cut(product.categoryLabel, 14)}|q=${cut(product.searchQuery, 32)}|name=${cut(product.productName, 34)}`,
  ];

  for (const post of posts.slice(0, 3)) {
    const detail = post.post ?? {};
    lines.push(
      [
        `R${post.rank}`,
        `u=${clean(post.url)}`,
        `t=${cut(post.title || detail.title, 50)}`,
        `i=${Number(post.imageCount ?? 0)}/${Number(detail.imageCount ?? post.imageCount ?? 0)}`,
        `b=${Number(detail.bodyCharCount ?? 0)}`,
        `kw=${kw(detail.keywordDensityHint)}`,
        `st=${list(detail.structureType)}`,
        `tn=${list(detail.tone)}`,
      ].join("|"),
    );
  }

  lines.push(
    [
      "D",
      `img=${imageTarget(product.categoryLabel, posts)}`,
      `h=${HEADINGS}`,
      `kw=${cut(product.productName, 22)};${cut(categoryKeyword, 9)};${INTENT_KEYWORDS}`,
    ].join("|"),
  );

  return lines.join("\n");
}

function padSlot(text, productId) {
  if (text.length > SLOT_SIZE) {
    throw new Error(`micro doc exceeds ${SLOT_SIZE} chars for ${productId}: ${text.length}`);
  }
  const prefix = `${text}\nEND|pid=${productId}|slot=${SLOT_SIZE}|pad=`;
  if (prefix.length > SLOT_SIZE) {
    throw new Error(`micro doc end marker exceeds ${SLOT_SIZE} chars for ${productId}: ${prefix.length}`);
  }
  return `${prefix}${"x".repeat(SLOT_SIZE - prefix.length)}`;
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
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
  slot_size: SLOT_SIZE,
  product_count: research.length,
  category_count: byCategory.size,
  files: [],
};

let maxMicroDocChars = 0;

for (const [categoryKey, items] of byCategory) {
  const slots = [];
  const products = [];

  for (const item of items) {
    const doc = microDoc(item);
    maxMicroDocChars = Math.max(maxMicroDocChars, doc.length);
    slots.push(padSlot(doc, item.product.id));
    products.push({
      pid: item.product.id,
      product_name: item.product.productName,
      micro_doc_chars: doc.length,
      slot_chars: SLOT_SIZE,
    });
  }

  const filename = `micro-top3-${categoryKey}.md`;
  const filePath = path.join(OUT_DIR, filename);
  const content = slots.join("");
  fs.writeFileSync(filePath, content, "utf8");

  manifest.files.push({
    category_key: categoryKey,
    category_label: items[0]?.product?.categoryLabel ?? categoryKey,
    product_count: items.length,
    path: path.relative(ROOT, filePath).replaceAll(path.sep, "/"),
    char_count: content.length,
    expected_chunk_count: items.length,
    products,
  });
}

manifest.max_micro_doc_chars = maxMicroDocChars;
manifest.all_micro_docs_fit_slot = maxMicroDocChars <= SLOT_SIZE;

fs.writeFileSync(
  path.join(OUT_DIR, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  output_dir: manifest.output_dir,
  product_count: manifest.product_count,
  category_count: manifest.category_count,
  slot_size: manifest.slot_size,
  max_micro_doc_chars: manifest.max_micro_doc_chars,
  all_micro_docs_fit_slot: manifest.all_micro_docs_fit_slot,
}, null, 2));
