/** Recover completed backgrounds only; never generate, approve or publish. */
import fs from "node:fs";
import path from "node:path";
import { readBrandPostPackage, getBrandPostPackageDir, packagePreview, writeBrandPostPackageManifest } from "../src/lib/brand-post-package";
import { applyExternalGeneratedBrandPostImage } from "../src/lib/brand-post-image-generation";

async function main() {
  const [id, filename] = process.argv.slice(2);
  if (!id || !filename || path.basename(filename) !== filename) throw new Error("Expected product ID and checkpoint job filename");
  const root = getBrandPostPackageDir(id);
  const work = path.join(root, "image-generation-work", "resume-v1");
  const jobs: { id: string; prompt: string; outStem: string }[] = JSON.parse(fs.readFileSync(path.join(work, filename), "utf8"));
  const records = fs.readFileSync(path.join(work, `${filename}.results.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const readiness = await fetch("http://127.0.0.1:43127/api/system/update-readiness").then(r => r.json());
  if (!readiness.data?.ready) throw new Error("Desktop busy; no package changes made");
  fs.copyFileSync(path.join(root, "manifest.json"), path.join(root, `manifest.before-recovery-${Date.now()}.json`), fs.constants.COPYFILE_EXCL);
  for (const job of jobs) {
    const record = records.filter(r => r.id === job.id && r.localPath).at(-1);
    if (!record || path.resolve(record.localPath) !== path.resolve(`${job.outStem}.png`)) throw new Error(`Missing/mismatched checkpoint ${job.id}`);
    const rel = path.relative(work, record.localPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Checkpoint outside package");
    const manifest = readBrandPostPackage(id);
    if (!manifest || manifest.version !== "brand-post-package/v2") throw new Error("Missing v2 manifest");
    const title = job.prompt.match(/^Article part: (.+)$/m)?.[1];
    const matching = manifest.composition.sections.filter(s => s.title === title);
    if (matching.length !== 1) throw new Error(`Ambiguous section ${job.id}`);
    const slot = packagePreview(manifest).imageSlots.find(s => s.sectionId === matching[0].id)!;
    if (!slot.generationMissing && !slot.missing) continue;
    const replace = slot.count >= slot.maximum ? slot.assets.find(a => a?.provenance === "ORIGINAL")?.assetKey : undefined;
    const result = await applyExternalGeneratedBrandPostImage({ brandLinkId: id, manifest, productName: manifest.title,
      sectionId: slot.sectionId, replaceAssetKey: replace, rawPath: record.localPath });
    console.log(JSON.stringify({ sectionId: slot.sectionId, provenance: result.provenance }));
  }
  const result = readBrandPostPackage(id)!;
  const preview = packagePreview(result);
  const remaining = preview.imageSlots.reduce((n, s) => n + Math.max(s.missing, s.generationMissing), 0);
  if (remaining === 0 && result.imageGeneration?.status !== "running") {
    result.imageGeneration = { status: "complete", requested: jobs.length, applied: jobs.length, remaining: 0,
      errors: [], updatedAt: new Date().toISOString() };
    writeBrandPostPackageManifest(result);
  }
  console.log(JSON.stringify({ remaining }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
