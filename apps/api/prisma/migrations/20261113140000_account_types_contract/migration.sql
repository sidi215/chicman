-- AT-1 account types, contract step (context/account-types-audit.md, sections 4, 9, 14).
-- Requires every account to be classified first (`accounts:classify`):
-- the migration stops, changing nothing, if any User has no account type.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "accountType" IS NULL) THEN
    RAISE EXCEPTION 'AT-1: classify every account (pnpm --filter @chicman/api accounts:classify) before this migration';
  END IF;
END;
$$;

ALTER TABLE "User" ALTER COLUMN "accountType" SET NOT NULL;

-- Triggers replace the composite keys of the plan (Prisma cannot model them
-- without overlapping relations, and would read NOT VALID keys as drift).
-- Like a NOT VALID key, each check runs only when its column is written, so
-- rows from before AT-1 stay as they are (Q9).
DROP INDEX "User_id_accountType_key";

CREATE FUNCTION "AT1_require_account_type"(user_id uuid, expected "AccountType", rule text) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = user_id AND "accountType" = expected) THEN
    RAISE EXCEPTION 'AT-1: % requires a % account', rule, expected
      USING ERRCODE = 'check_violation', CONSTRAINT = rule;
  END IF;
END;
$$;

-- Only a Seller account owns a shop (also on an ownership transfer).
CREATE FUNCTION "Shop_owner_is_seller"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "AT1_require_account_type"(NEW."ownerUserId", 'SELLER', 'Shop_owner_is_seller');
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Shop_owner_is_seller" BEFORE INSERT OR UPDATE OF "ownerUserId" ON "Shop"
  FOR EACH ROW EXECUTE FUNCTION "Shop_owner_is_seller"();

-- Only a Buyer account has a cart, favorites, delivery addresses, or orders.
CREATE FUNCTION "Buyer_owned_row"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "AT1_require_account_type"(NEW."userId", 'BUYER', TG_TABLE_NAME || '_owner_is_buyer');
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Cart_owner_is_buyer" BEFORE INSERT OR UPDATE OF "userId" ON "Cart"
  FOR EACH ROW EXECUTE FUNCTION "Buyer_owned_row"();
CREATE TRIGGER "Favorite_owner_is_buyer" BEFORE INSERT OR UPDATE OF "userId" ON "Favorite"
  FOR EACH ROW EXECUTE FUNCTION "Buyer_owned_row"();
CREATE TRIGGER "CustomerAddress_owner_is_buyer" BEFORE INSERT OR UPDATE OF "userId" ON "CustomerAddress"
  FOR EACH ROW EXECUTE FUNCTION "Buyer_owned_row"();
CREATE TRIGGER "Order_owner_is_buyer" BEFORE INSERT OR UPDATE OF "userId" ON "Order"
  FOR EACH ROW EXECUTE FUNCTION "Buyer_owned_row"();

-- The personal phone: required for Buyers and Sellers, optional for Administrators (Q3).
ALTER TABLE "CustomerProfile" ALTER COLUMN "phone" DROP NOT NULL;

CREATE FUNCTION "CustomerProfile_phone_by_account_type"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."phone" IS NULL THEN
    PERFORM "AT1_require_account_type"(NEW."userId", 'ADMIN', 'CustomerProfile_phone_by_account_type');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CustomerProfile_phone_by_account_type" BEFORE INSERT OR UPDATE OF "phone", "userId" ON "CustomerProfile"
  FOR EACH ROW EXECUTE FUNCTION "CustomerProfile_phone_by_account_type"();
