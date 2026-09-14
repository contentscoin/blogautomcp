/** Explicit read-only diagnostic: args = database path, manifest paths. No store APIs. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { revalidateSavedBrandPostText, savedBrandPostTextSections, SavedTextRevalidationError } from "../src/lib/brand-post-revalidation";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
const { DatabaseSync } = require("node:sqlite");
const [database, ...manifests] = process.argv.slice(2);
if (!database || !manifests.length) throw new Error("Provide database and manifest paths");
const db = new DatabaseSync(database, { readOnly: true });
try {
  for (const file of manifests) {
    const before = fs.readFileSync(file);
    const manifest = JSON.parse(before.toString("utf8")) as BrandPostPackageManifestV2;
    const link = db.prepare("SELECT id, connectKind, externalItemId, sourceUrl, url, productName FROM BrandLink WHERE id = ?").get(manifest.brandLinkId);
    assert.ok(link);
    const sections = savedBrandPostTextSections(manifest);
    const contextPath = path.join(path.dirname(file), "mcp-draft-context.json");
    const context = fs.existsSync(contextPath) ? JSON.parse(fs.readFileSync(contextPath, "utf8")) : undefined;
    try {
      const result = revalidateSavedBrandPostText(manifest, { productId: link.id, connectKind: link.connectKind, externalProductId: link.externalItemId || null, sourceUrl: link.sourceUrl || link.url || null, productName: link.productName || "", brandLink: link.url }, context);
      console.log(JSON.stringify({ id: link.id, sections: sections.length, source: result.textQualityRevalidation?.sourceOrigin, oldReason: manifest.contentQuality?.reason, newReason: result.contentQuality?.reason, canPublish: result.contentQuality?.canPublish }));
    } catch (error) {
      if (!(error instanceof SavedTextRevalidationError)) throw error;
      console.log(JSON.stringify({ id: link.id, sections: sections.length, blocked: error.code, reason: error.message }));
    }
    assert.deepEqual(fs.readFileSync(file), before, "Real manifest must remain byte-identical");
  }
} finally { db.close(); }
