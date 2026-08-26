-- Existing BrandLink rows remain shopping links through the default value.
ALTER TABLE "BrandLink" ADD COLUMN "connectKind" TEXT NOT NULL DEFAULT 'SHOPPING';
ALTER TABLE "BrandLink" ADD COLUMN "externalItemId" TEXT;
ALTER TABLE "BrandLink" ADD COLUMN "sourceUrl" TEXT;

CREATE INDEX "BrandLink_connectKind_idx" ON "BrandLink"("connectKind");
CREATE INDEX "BrandLink_connectKind_externalItemId_idx"
ON "BrandLink"("connectKind", "externalItemId");
