-- Product image uploads are normalized by the server (spec 07, section 5), so
-- the staged original may be up to 15 MB. The published image stays limited to
-- 2 MB by "ProductImage_size".
ALTER TABLE "ProductImageUpload" DROP CONSTRAINT "ProductImageUpload_declared_size";
ALTER TABLE "ProductImageUpload"
  ADD CONSTRAINT "ProductImageUpload_declared_size" CHECK ("declaredSize" > 0 AND "declaredSize" <= 15728640);
