-- Spec 18: search indexing queue. Meilisearch is derived from PostgreSQL; this
-- table records which products' search documents must be refreshed.
--
-- Rows are written by triggers, in the transaction of the change, so every
-- write path (seller routes, checkout and order stock, shop decisions,
-- scripts) is covered without code having to remember it. The worker's search
-- indexing job reads the rows, re-reads the products through the public
-- visibility rule, updates or removes their documents, and deletes a row only
-- if its `version` is unchanged (a newer change keeps it queued).

-- CreateTable
CREATE TABLE "SearchIndexTask" (
    "productId" UUID NOT NULL,
    "version" BIGSERIAL NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" VARCHAR(64),

    CONSTRAINT "SearchIndexTask_pkey" PRIMARY KEY ("productId")
);

-- CreateIndex
CREATE INDEX "SearchIndexTask_nextAttemptAt_requestedAt_idx" ON "SearchIndexTask"("nextAttemptAt", "requestedAt");

-- Queues products (in ID order, so concurrent writers lock rows in one order).
-- A product already queued gets a new version; its retry state is kept.
CREATE FUNCTION "search_index_request"(product_ids uuid[]) RETURNS void LANGUAGE sql AS $$
  INSERT INTO "SearchIndexTask" ("productId")
  SELECT DISTINCT id FROM unnest(product_ids) AS id WHERE id IS NOT NULL ORDER BY id
  ON CONFLICT ("productId") DO UPDATE
    SET "version" = nextval(pg_get_serial_sequence('"SearchIndexTask"', 'version')),
        "requestedAt" = CURRENT_TIMESTAMP;
$$;

-- A product's own searchable, filterable, or visibility columns.
CREATE FUNCTION "Product_search_index"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "search_index_request"(ARRAY[OLD."id"]);
  ELSE
    PERFORM "search_index_request"(ARRAY[NEW."id"]);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "Product_search_index"
  AFTER INSERT OR DELETE OR UPDATE OF "shopId", "name", "description", "category", "brand", "price", "stock", "status", "publishedAt"
  ON "Product" FOR EACH ROW EXECUTE FUNCTION "Product_search_index"();

-- Variants (sizes, colors, stock: availability) and images (a public product
-- needs an active image) belong to one product, possibly moved.
CREATE FUNCTION "Product_child_search_index"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "search_index_request"(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD."productId" END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW."productId" END
  ]);
  RETURN NULL;
END;
$$;
CREATE TRIGGER "ProductVariant_search_index"
  AFTER INSERT OR DELETE OR UPDATE OF "productId", "size", "color", "stock"
  ON "ProductVariant" FOR EACH ROW EXECUTE FUNCTION "Product_child_search_index"();
CREATE TRIGGER "ProductImage_search_index"
  AFTER INSERT OR DELETE OR UPDATE OF "productId", "status"
  ON "ProductImage" FOR EACH ROW EXECUTE FUNCTION "Product_child_search_index"();

-- A shop's approval (suspension hides every product) and its name (searchable).
CREATE FUNCTION "Shop_search_index"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" OR NEW."shopName" IS DISTINCT FROM OLD."shopName" THEN
    PERFORM "search_index_request"(ARRAY(SELECT "id" FROM "Product" WHERE "shopId" = NEW."id" ORDER BY "id"));
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "Shop_search_index"
  AFTER UPDATE OF "status", "shopName"
  ON "Shop" FOR EACH ROW EXECUTE FUNCTION "Shop_search_index"();

-- Existing products are indexed by the first worker run.
SELECT "search_index_request"(ARRAY(SELECT "id" FROM "Product"));
