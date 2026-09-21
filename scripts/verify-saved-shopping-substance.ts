import fs from 'node:fs';
import path from 'node:path';
import { assessProductReviewSubstance } from './lib/product-editorial-plan';

const base = process.argv[2];
if (!base) throw new Error('Usage: tsx scripts/verify-saved-shopping-substance.ts <prepared-brand-posts>');
for (const id of fs.readdirSync(base)) {
  const file = path.join(base, id, 'manifest.json');
  if (!fs.existsSync(file)) continue;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const product = manifest.sourceSnapshot?.product;
  if (manifest.connectKind !== 'SHOPPING' || !product || !fs.existsSync(manifest.markdownPath)) continue;
  const sections = fs.readFileSync(manifest.markdownPath, 'utf8').split(/^## /m).slice(1)
    .map(section => section.split(/^#\S/m)[0].trim());
  const result = assessProductReviewSubstance({ productName: product.name, sourceDescription: product.description,
    sourceFeatures: product.features, sections });
  console.log(JSON.stringify({ id, name: product.name, missing: result.missingElements,
    judgements: result.evidenceJudgementCount, signals: result.coveredSignals }));
}
