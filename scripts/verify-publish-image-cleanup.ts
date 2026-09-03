import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createPublishImageCleanup } from "./lib/publish-image-cleanup";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "verify-publish-image-cleanup-"));
const write = (file: string, content = "fixture-image") => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};

try {
  const shared = path.join(fixture, "temp_images");
  const previousRun = write(path.join(shared, "previous-run.jpg"));
  const run = createPublishImageCleanup(shared);
  const otherImage = write(path.join(shared, "other-run", "other.jpg"));
  const packageImages = Array.from({ length: 9 }, (_, index) =>
    write(path.join(fixture, "prepared-package", `image-${index}.jpg`), `approved-${index}`));
  const external = write(path.join(fixture, "persistent-thumbnail.jpg"), "persistent");
  const prefixSibling = write(path.join(`${run.tempPath}-other`, "image.jpg"));
  const nested = write(path.join(run.tempPath, "nested", "owned.jpg"));
  const owned = write(path.join(run.tempPath, "owned.jpg"));
  const traversal = path.join(run.tempPath, "..", "prepared-package", "image-0.jpg");
  run.track([owned, nested, external, prefixSibling, ...packageImages, traversal]);

  // Context cleanup: mixed source paths must preserve all non-owned files.
  assert.deepEqual(run.cleanup([
    owned, nested, owned, previousRun, otherImage, external, prefixSibling,
    traversal, ...packageImages, run.tempPath, path.dirname(nested), "", path.join(run.tempPath, "missing.jpg"),
  ]), [owned, nested]);
  assert.equal(fs.existsSync(owned), false);
  assert.equal(fs.existsSync(nested), false);
  assert.ok(fs.statSync(path.dirname(nested)).isDirectory(), "cleanup never recursively removes directories");

  // Final cleanup: product.imagePaths can have been replaced by approved hero/body assets.
  assert.deepEqual(run.cleanup(packageImages), []);
  packageImages.forEach((file, index) => assert.equal(fs.readFileSync(file, "utf8"), `approved-${index}`));
  for (const file of [previousRun, otherImage, prefixSibling]) assert.equal(fs.readFileSync(file, "utf8"), "fixture-image");
  assert.equal(fs.readFileSync(external, "utf8"), "persistent");
  assert.deepEqual(run.cleanup([owned, nested]), [], "cleanup is idempotent");

  // Windows directory junctions do not require symlink privileges.
  const link = path.join(run.tempPath, "linked-package");
  fs.symlinkSync(path.dirname(packageImages[0]), link, process.platform === "win32" ? "junction" : "dir");
  run.track([link, path.join(link, "image-0.jpg")]);
  assert.deepEqual(run.cleanup([link, path.join(link, "image-0.jpg")]), []);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readFileSync(packageImages[0], "utf8"), "approved-0");

  const replacedRun = createPublishImageCleanup(path.join(fixture, "replaced-root"));
  replacedRun.track([path.join(replacedRun.tempPath, "image-0.jpg")]);
  fs.rmdirSync(replacedRun.tempPath); // Empty directory created by this fixture only.
  fs.symlinkSync(path.dirname(packageImages[0]), replacedRun.tempPath, process.platform === "win32" ? "junction" : "dir");
  assert.deepEqual(replacedRun.cleanup([path.join(replacedRun.tempPath, "image-0.jpg")]), []);
  assert.equal(fs.readFileSync(packageImages[0], "utf8"), "approved-0");

  // Verify wiring without importing/running the live publishing agent.
  const agent = fs.readFileSync(path.join(__dirname, "simple-agent.ts"), "utf8");
  assert.match(agent, /const TEMP_PATH = publishImageCleanup\.tempPath;/u);
  assert.equal((agent.match(/publishImageCleanup\.cleanup\(downloadedProductImagePaths\)/gu) || []).length, 2);
  assert.ok(agent.indexOf("const downloadedProductImagePaths = [...product.imagePaths]") < agent.indexOf("product.imagePaths = uploadImagePaths"));
  assert.doesNotMatch(agent, /fs\.unlink(?:Sync)?\(/u, "all image deletion sites must use the ownership guard");
  console.log("PASS: owned files (including nested) removed; 9 approved package images, persistent assets, other runs, traversal/prefix paths and junction targets preserved; context/final/download cleanup guarded.");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
