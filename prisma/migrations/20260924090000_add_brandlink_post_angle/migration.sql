-- One product can have a full review plus topic posts (post angles).
ALTER TABLE "BrandLink" ADD COLUMN "parentBrandLinkId" TEXT;
ALTER TABLE "BrandLink" ADD COLUMN "postAngle" TEXT;
CREATE INDEX "BrandLink_parentBrandLinkId_idx" ON "BrandLink"("parentBrandLinkId");
