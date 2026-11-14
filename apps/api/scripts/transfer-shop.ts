// Transfers a shop to another Seller account (AT-1, Q8): audited and
// explicitly approved. Dry run by default: prints the shop, the current and
// new owner, and a digest. Writing needs that exact transfer approved:
//
//   pnpm --filter @chicman/api shop:transfer-owner -- --shop <shopId> --to <supabaseUserId> --reason "<10–500 characters>" [--note "<text>"]
//   pnpm --filter @chicman/api shop:transfer-owner -- <same options> --apply --approve <digest>
//
// Changes only Shop.ownerUserId and appends a ShopOwnershipEvent, in one
// transaction. The target must be a Seller account without a shop (see
// `seller:provision`). Refused while the shop has pending or confirmed orders.
// Uses DATABASE_URL (apps/api/.env, or the environment).
import dotenv from "dotenv";

import { createPrismaClient } from "../src/lib/prisma.js";
import { applyShopTransfer, planShopTransfer, type ShopTransferInput, type ShopTransferPlan, type ShopTransferRefusal } from "../src/modules/shops/index.js";

dotenv.config({ quiet: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const REFUSALS: Record<ShopTransferRefusal, string> = {
  "invalid-reason": "The reason must be 10–500 characters of plain text.",
  "invalid-note": "The note must be 1–1000 characters of plain text.",
  "shop-not-found": "No shop has this ID.",
  "target-not-found": "No account has this Supabase user ID (create it with seller:provision).",
  "target-not-seller": "The target account is not a Seller account.",
  "target-has-shop": "The target Seller account already owns a shop (one shop per seller).",
  "same-owner": "The target already owns this shop.",
  "open-orders": "The shop has pending or confirmed orders; finish or cancel them first.",
};

function print(plan: ShopTransferPlan): void {
  console.log(`Shop       ${plan.shop.id}  "${plan.shop.shopName}"  ${plan.shop.status}  (${plan.shop.products} products, ${plan.shop.shopOrders} shop orders, none open)`);
  console.log(`From       ${plan.from.supabaseUserId}  (${plan.from.accountType} account)`);
  console.log(`To         ${plan.to.supabaseUserId}  (SELLER account without a shop)`);
  console.log(`Reason     ${plan.reason}`);
  if (plan.note !== null) console.log(`Note       ${plan.note}`);
  console.log(`Digest     ${plan.digest}`);
}

const shopId = option("--shop");
const to = option("--to");
const reason = option("--reason");
if (shopId === undefined || !UUID.test(shopId) || to === undefined || !UUID.test(to) || reason === undefined) {
  console.error('Pass --shop <shopId> --to <supabaseUserId> --reason "<10–500 characters>" [--note "<text>"] [--apply --approve <digest>].');
  process.exit(1);
}
const note = option("--note");
const input: ShopTransferInput = { shopId, toSupabaseUserId: to, reason, ...(note === undefined ? {} : { note }) };

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const prisma = createPrismaClient(databaseUrl);

try {
  if (!args.includes("--apply")) {
    const outcome = await planShopTransfer(prisma, input);
    if (outcome.state === "refused") {
      console.error(`Refused: ${REFUSALS[outcome.reason]}${outcome.openOrders === undefined ? "" : ` (${outcome.openOrders} open)`}`);
      process.exitCode = 1;
    } else {
      print(outcome.plan);
      console.log("\nDry run: nothing was written. After approval, rerun with the same options and --apply --approve <digest>.");
    }
  } else {
    const approved = option("--approve");
    if (approved === undefined || !/^[0-9a-f]{64}$/.test(approved)) {
      console.error("--apply needs --approve <digest> from a reviewed dry run.");
      process.exit(1);
    }
    const outcome = await applyShopTransfer(prisma, input, approved);
    if (outcome.state === "transferred") {
      print(outcome.plan);
      console.log("\nTransferred. A ShopOwnershipEvent records it.");
    } else if (outcome.state === "digest-mismatch") {
      print(outcome.plan);
      console.error("\nNot applied: this is not the reviewed transfer (digest differs). Nothing was written.");
      process.exitCode = 1;
    } else {
      console.error(`Refused: ${REFUSALS[outcome.reason]} Nothing was written.`);
      process.exitCode = 1;
    }
  }
} finally {
  await prisma.$disconnect();
}
