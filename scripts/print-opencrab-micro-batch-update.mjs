import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "docs", "opencrab-saas-micro-repair-2026-07-01");
const PACKAGE_ID = "cfe1fd01-a052-4ec0-a97b-b7f45cd92b9d";
const PROJECT_ID = "ce86789f-c294-449f-9add-61de752e810b";

const [category, version] = process.argv.slice(2);
if (!category || !version) {
  console.error("Usage: node scripts/print-opencrab-micro-batch-update.mjs <category> <version>");
  process.exit(1);
}

const file = path.join(DIR, `micro-top3-${category}.md`);
const content = fs.readFileSync(file, "utf8");
const pids = [...content.matchAll(/# CRAB_MICRO_TOP3 pid=([^\n]+)/g)].map((m) => m[1]);

if (pids.length !== 10) {
  throw new Error(`Expected 10 products in ${file}, got ${pids.length}`);
}
if ([...content].length !== 9000) {
  throw new Error(`Expected 9000-char slot-aligned content in ${file}`);
}

const payload = {
  package_id: PACKAGE_ID,
  project_id: PROJECT_ID,
  title: `2026-07-01 full micro-index batch: ${category}`,
  version,
  event_type: "evidence_repair",
  occurred_at: "2026-07-01T14:20:00Z",
  metadata: {
    repair_type: "full_micro_index_category_slots",
    marker: "CRAB_MICRO_TOP3",
    category,
    product_count: pids.length,
    slot_size: 900,
    source_file: `docs/opencrab-saas-micro-repair-2026-07-01/micro-top3-${category}.md`,
    product_ids: pids,
  },
  metrics: {
    micro_products_added: pids.length,
    expected_rows_per_product: 5,
    slot_aligned_chars: [...content].length,
  },
  notes: `Full 10-product CRAB_MICRO_TOP3 slot-aligned micro-index batch for ${category}. Each product has P/R1/R2/R3/D rows in a 900-character slot.`,
  content,
};

process.stdout.write(JSON.stringify(payload, null, 2));
