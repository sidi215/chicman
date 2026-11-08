-- Shop logos are normalized by the server (spec 06), so the staged original may
-- be up to 15 MB. The published logo stays limited to 2 MB and 1024 × 1024 by
-- the normalizer. Existing rows satisfy the relaxed check.
ALTER TABLE "ShopLogoUpload" DROP CONSTRAINT "ShopLogoUpload_declared_size";
ALTER TABLE "ShopLogoUpload"
  ADD CONSTRAINT "ShopLogoUpload_declared_size" CHECK ("declaredSize" > 0 AND "declaredSize" <= 15728640);
