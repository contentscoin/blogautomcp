/** Explicit local recovery only: no browser, generation, approval or publication. */
import fs from "node:fs";
import path from "node:path";
import { shoppingImageFormatIssue } from "./lib/shopping-image-format";
import { applyExternalGeneratedBrandPostImage } from "../src/lib/brand-post-image-generation";
import { getBrandPostPackageDir, readBrandPostPackage, packagePreview } from "../src/lib/brand-post-package";

async function main() {
  const [id, sectionId, rawPath, mode] = process.argv.slice(2);
  if (!id || !sectionId || !rawPath || !["preview", "apply"].includes(mode)) throw new Error("Expected id sectionId rawPath preview|apply");
  const root = path.resolve(getBrandPostPackageDir(id));
  const relative = path.relative(root, path.resolve(rawPath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Image must be inside this package");
  const manifest = readBrandPostPackage(id);
  if (!manifest || manifest.version !== "brand-post-package/v2") throw new Error("Expected v2 package");
  const section = manifest.composition.sections.find(s => s.id === sectionId);
  if (!section || section.imagePaths.length) throw new Error("Expected an empty existing section; refusing overwrite");
  if (mode === "preview") {
    if (!fs.statSync(rawPath).isFile()) throw new Error("Expected an image file");
    const issue = manifest.connectKind === "SHOPPING" ? shoppingImageFormatIssue({ path: rawPath }, false) : null;
    if (issue) throw new Error(`IMAGE_FORMAT_OBSOLETE: ${issue}`);
    console.log(JSON.stringify({ path: rawPath, sectionId, requiresReferenceReview: manifest.connectKind === "SHOPPING",
      message: "원본 결과 파일을 미리 봅니다. 설명 카드나 프레임으로 합성하지 않습니다." }));
    return;
  }
  const readiness = await fetch("http://127.0.0.1:43127/api/system/update-readiness").then(r => r.json()) as { data?: { ready?: boolean } };
  if (!readiness.data?.ready) throw new Error("Desktop is busy; refusing concurrent package modification");
  const backup = path.join(root, `manifest.before-image-apply-${Date.now()}.json`);
  fs.copyFileSync(path.join(root, "manifest.json"), backup, fs.constants.COPYFILE_EXCL);
  const applied = await applyExternalGeneratedBrandPostImage({
    brandLinkId: id, manifest, productName: manifest.title, sectionId, rawPath,
  });
  const verified = readBrandPostPackage(id);
  if (!verified || verified.version !== "brand-post-package/v2") throw new Error("Missing saved result");
  const preview = packagePreview(verified);
  console.log(JSON.stringify({ sectionId: applied.sectionId, provenance: applied.provenance,
    assetKey: applied.assetKey, backup, slot: preview.imageSlots.find(s => s.sectionId === sectionId),
    quality: verified.composition.qualityReport }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
