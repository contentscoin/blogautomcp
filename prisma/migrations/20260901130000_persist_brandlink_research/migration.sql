-- Preserve scraped product evidence across failed draft retries.
ALTER TABLE "BrandLink" ADD COLUMN "productDescription" TEXT;
ALTER TABLE "BrandLink" ADD COLUMN "productFeatures" TEXT;
ALTER TABLE "BrandLink" ADD COLUMN "travelResearchJson" TEXT;
