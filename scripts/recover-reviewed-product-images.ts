/** Recover a completed draft using existing backgrounds; no image generation or publication. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { selectVerifiedProductPhoto } from "./lib/product-photo-review";
import { createOriginalProductPhotoOnBackground, createOriginalProductPhotoThumbnail } from "./lib/product-image-lock";
import { readBrandPostPackage, getBrandPostPackageDir, applyGeneratedBrandPostImage } from "../src/lib/brand-post-package";
import { writeDraftProgress } from "../src/lib/draft-progress";

async function main() {
  const [id, source, jobsFile, baseUrl] = process.argv.slice(2);
  if (!id || !source || !jobsFile || !baseUrl) throw new Error("Expected id source jobsFile localBaseUrl");
  const ready = await fetch(`${baseUrl}/api/system/update-readiness`).then(r => r.json()) as {data?:{ready?:boolean}};
  if (!ready.data?.ready) throw new Error("Desktop is busy");
  const m = readBrandPostPackage(id);
  if (!m || m.version !== "brand-post-package/v2" || m.approvedAt || m.imageGeneration?.status === "running") throw new Error("Expected inactive unapproved draft");
  if (!await selectVerifiedProductPhoto([source], m.title)) throw new Error("Not a verified product photo");
  const root = getBrandPostPackageDir(id);
  fs.copyFileSync(path.join(root, "manifest.json"), path.join(root, `manifest.before-photo-repair-${Date.now()}.json`), fs.constants.COPYFILE_EXCL);
  const work = path.join(root, "reviewed-photo-recovery");
  const jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8")) as {outStem:string;prompt:string}[];
  for (const asset of m.imageAssets || []) {
    let output: string;
    if (asset.role === "hero") {
      output = (await createOriginalProductPhotoThumbnail({sourcePath: source, outputDir: work, productName: m.title, headline:"휴대와 보관", subline:"상품 원본 사진", style:"shopping-clean"})).outputPath;
    } else {
      const section = m.composition.sections.find(s => s.id === asset.sectionId);
      const job = jobs.find(j => j.prompt.includes(`Article part: ${section?.title}\n`));
      if (!job || !fs.existsSync(`${job.outStem}.png`)) throw new Error(`Missing background for ${asset.sectionId}`);
      output = (await createOriginalProductPhotoOnBackground({sourcePath:source, backgroundPath:`${job.outStem}.png`, outputDir:work})).outputPath;
    }
    const hash = crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex");
    if (hash === asset.sha256) { console.log(`Already correct ${asset.sectionId || "hero"}`); continue; }
    applyGeneratedBrandPostImage({brandLinkId:id, generatedPath:output, replaceAssetKey:asset.sha256, provenance:"EDITORIAL_CARD", imageIntent:asset.imageIntent});
    console.log(`Replaced ${asset.sectionId || "hero"}`);
  }
  const result = readBrandPostPackage(id)!;
  if (result.contentQuality?.canPublish) {
    const resultFile = path.join(root, "result.json");
    if (fs.existsSync(resultFile)) fs.copyFileSync(resultFile, `${resultFile}.before-photo-recovery-${Date.now()}`, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(resultFile, JSON.stringify({ok:true,code:"RECOVERED",message:"상품 사진 검토 및 기존 배경 기반 이미지 복구 완료",at:new Date().toISOString()}));
    writeDraftProgress(id, {stage:"done",message:"상품 사진 복구 완료 · 승인 전 내용 확인 필요"});
  }
  console.log(JSON.stringify({images:result.imageAssets?.length,quality:result.contentQuality?.score,canPublish:result.contentQuality?.canPublish}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
