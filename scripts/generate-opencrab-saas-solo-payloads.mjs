import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "docs", "opencrab-saas-micro-repair-2026-07-01");
const OUT_DIR = path.join(ROOT, "docs", "opencrab-saas-solo-payloads-2026-07-01");
const PACKAGE_ID = "cfe1fd01-a052-4ec0-a97b-b7f45cd92b9d";
const PROJECT_ID = "ce86789f-c294-449f-9add-61de752e810b";
const OCCURRED_AT = "2026-07-01T14:35:00Z";
const START_MINOR_VERSION = 16;

function countChars(value) {
  return [...value].length;
}

function extractProductBlocks(content) {
  const marker = /# CRAB_MICRO_TOP3 pid=([0-9a-f-]{36})/g;
  const matches = [...content.matchAll(marker)];
  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : content.length;
    return {
      pid: match[1],
      raw: content.slice(start, end),
    };
  });
}

function cleanSoloBlock(raw, sourceFile, pid) {
  const withoutEnd = raw.split("\nEND|")[0].trimEnd();
  const lines = withoutEnd.split("\n");
  if (!lines[0]?.startsWith("# CRAB_MICRO_TOP3 pid=")) {
    throw new Error(`Invalid micro block header in ${sourceFile}`);
  }
  lines.splice(1, 0, `ANCHOR|CRAB_MICRO_TOP3|pid=${pid}|priority=1`);
  return `${lines.join("\n")}\n`;
}

function fieldValue(line, field) {
  const part = line
    .split("|")
    .find((segment) => segment.startsWith(`${field}=`));
  return part ? part.slice(field.length + 1) : "";
}

function summarizeBlock(block) {
  const lines = block.trim().split("\n");
  const p = lines.find((line) => line.startsWith("P|"));
  const d = lines.find((line) => line.startsWith("D|"));
  return {
    product_name: fieldValue(p ?? "", "name"),
    query: fieldValue(p ?? "", "q"),
    category_label: fieldValue(p ?? "", "cat"),
    recommended_images: fieldValue(d ?? "", "img"),
  };
}

function assertComplete(block, pid, sourceFile) {
  const required = [
    `# CRAB_MICRO_TOP3 pid=${pid}`,
    "ANCHOR|CRAB_MICRO_TOP3|",
    "P|",
    "R1|",
    "R2|",
    "R3|",
    "D|",
  ];
  const missing = required.filter((token) => !block.includes(token));
  if (missing.length) {
    throw new Error(`${sourceFile} ${pid} missing ${missing.join(", ")}`);
  }
  if (block.includes("\uFFFD")) {
    throw new Error(`${sourceFile} ${pid} includes replacement characters`);
  }
  const chars = countChars(block);
  if (chars > 900) {
    throw new Error(`${sourceFile} ${pid} is ${chars} chars, over 900`);
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs
  .readdirSync(SOURCE_DIR)
  .filter((name) => /^micro-top3-.+\.md$/.test(name))
  .sort();

const records = [];

for (const fileName of files) {
  const category = fileName.replace(/^micro-top3-/, "").replace(/\.md$/, "");
  const sourceFile = `docs/opencrab-saas-micro-repair-2026-07-01/${fileName}`;
  const filePath = path.join(SOURCE_DIR, fileName);
  const content = fs.readFileSync(filePath, "utf8");
  const blocks = extractProductBlocks(content);
  if (blocks.length !== 10) {
    throw new Error(`${sourceFile} expected 10 products, got ${blocks.length}`);
  }

  const categoryDir = path.join(OUT_DIR, category);
  fs.mkdirSync(categoryDir, { recursive: true });

  for (const { pid, raw } of blocks) {
    const block = cleanSoloBlock(raw, sourceFile, pid);
    assertComplete(block, pid, sourceFile);
    const summary = summarizeBlock(block);
    const index = records.length;
    const version = `1.0.${START_MINOR_VERSION + index}`;
    const title = `2026-07-01 micro-index repair: solo ${category} pid ${pid}`;
    const payload = {
      package_id: PACKAGE_ID,
      project_id: PROJECT_ID,
      title,
      version,
      event_type: "evidence_repair",
      occurred_at: OCCURRED_AT,
      metadata: {
        repair_type: "solo_micro_index_anchor",
        marker: "CRAB_MICRO_TOP3",
        category,
        product_id: pid,
        source_file: sourceFile,
        reason: "Keep P/R1/R2/R3/D rows in one product-level evidence unit.",
      },
      metrics: {
        micro_products_added: 1,
        expected_rows_per_product: 5,
        solo_doc_chars: countChars(block),
      },
      notes: `Solo CRAB_MICRO_TOP3 product-level anchor for ${category} product ${pid}. Contains P/R1/R2/R3/D rows in one sub-900-character document.`,
      content: block,
    };

    fs.writeFileSync(path.join(categoryDir, `${pid}.md`), block, "utf8");
    records.push({
      index: index + 1,
      category,
      pid,
      version,
      title,
      chars: countChars(block),
      ...summary,
      payload,
    });
  }
}

const manifest = {
  generated_at: new Date().toISOString(),
  source_dir: "docs/opencrab-saas-micro-repair-2026-07-01",
  output_dir: "docs/opencrab-saas-solo-payloads-2026-07-01",
  package_id: PACKAGE_ID,
  project_id: PROJECT_ID,
  start_minor_version: START_MINOR_VERSION,
  product_count: records.length,
  category_count: new Set(records.map((record) => record.category)).size,
  max_solo_doc_chars: Math.max(...records.map((record) => record.chars)),
  all_solo_docs_fit_900_chars: records.every((record) => record.chars <= 900),
  categories: Object.values(
    records.reduce((acc, record) => {
      acc[record.category] ??= {
        category: record.category,
        product_count: 0,
        products: [],
      };
      acc[record.category].product_count += 1;
      acc[record.category].products.push({
        pid: record.pid,
        version: record.version,
        chars: record.chars,
        product_name: record.product_name,
      });
      return acc;
    }, {}),
  ),
};

const jsonl = records.map((record) => JSON.stringify(record.payload)).join("\n") + "\n";
fs.writeFileSync(path.join(OUT_DIR, "solo-payloads.jsonl"), jsonl, "utf8");
fs.writeFileSync(path.join(OUT_DIR, "solo-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

console.log(
  JSON.stringify(
    {
      output_dir: "docs/opencrab-saas-solo-payloads-2026-07-01",
      product_count: manifest.product_count,
      category_count: manifest.category_count,
      max_solo_doc_chars: manifest.max_solo_doc_chars,
      all_solo_docs_fit_900_chars: manifest.all_solo_docs_fit_900_chars,
      jsonl: "docs/opencrab-saas-solo-payloads-2026-07-01/solo-payloads.jsonl",
    },
    null,
    2,
  ),
);
