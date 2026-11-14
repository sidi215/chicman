// Creates a Seller account WITHOUT a shop (AT-1, context/account-types-audit.md
// section 11.3, Q8): the target of an approved shop transfer. Normal sellers
// register publicly; their setup creates the shop together with the account.
//
// 1. The person signs up (seller registration, or an identity the operator
//    creates or invites in Supabase) and confirms the email, but does NOT
//    complete account setup.
// 2. pnpm --filter @chicman/api seller:provision -- --supabase-user-id <uuid> --phone <number>
//
// Refuses an identity that already has an account (types never change) or
// that registered as a buyer. The personal phone is required for sellers.
// Uses DATABASE_URL (apps/api/.env, or the environment).
import dotenv from "dotenv";

import { createPrismaClient } from "../src/lib/prisma.js";
import { provisionSellerWithoutShop } from "../src/modules/accounts/index.js";

dotenv.config({ quiet: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const supabaseUserId = option("--supabase-user-id");
const phone = option("--phone");
if (supabaseUserId === undefined || !UUID.test(supabaseUserId) || phone === undefined) {
  console.error("Pass --supabase-user-id <uuid> --phone <number>.");
  process.exit(1);
}
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const prisma = createPrismaClient(databaseUrl);

try {
  const outcome = await provisionSellerWithoutShop(prisma, supabaseUserId, phone);
  switch (outcome.state) {
    case "provisioned":
      console.log("Seller account created, without a shop.");
      break;
    case "account-exists":
      console.error(`This identity already has a ${outcome.accountType} account; account types never change. Nothing was written.`);
      process.exitCode = 1;
      break;
    case "buyer-intent":
      console.error("This identity registered as a buyer. Nothing was written.");
      process.exitCode = 1;
      break;
    case "invalid-phone":
      console.error("The phone number is not valid. Nothing was written.");
      process.exitCode = 1;
      break;
  }
} finally {
  await prisma.$disconnect();
}
