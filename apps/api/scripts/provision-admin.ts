// Creates an Administrator account (AT-1, context/account-types-audit.md
// section 6). The only way to create one: there is no public registration.
//
// 1. In the Supabase dashboard, create or invite the identity; the person
//    confirms the email and sets a password. They must NOT complete buyer or
//    seller setup.
// 2. pnpm --filter @chicman/api admin:provision -- --supabase-user-id <uuid> [--phone <number>]
//
// Refuses an identity that already has any account: a Buyer or Seller is
// never converted. The personal phone is optional for administrators.
//   pnpm --filter @chicman/api admin:provision -- --list
//
// Uses DATABASE_URL (apps/api/.env, or the environment).
import dotenv from "dotenv";

import { createPrismaClient } from "../src/lib/prisma.js";
import { provisionAdministrator } from "../src/modules/accounts/index.js";

dotenv.config({ quiet: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const prisma = createPrismaClient(databaseUrl);

try {
  if (args.includes("--list")) {
    const admins = await prisma.user.findMany({
      where: { accountType: "ADMIN" },
      orderBy: { createdAt: "asc" },
      select: { supabaseUserId: true, createdAt: true, adminAccessDeactivatedAt: true },
    });
    for (const admin of admins) {
      const state = admin.adminAccessDeactivatedAt === null ? "active" : `deactivated ${admin.adminAccessDeactivatedAt.toISOString()}`;
      console.log(`${admin.supabaseUserId}  ${state}  created=${admin.createdAt.toISOString()}`);
    }
    console.log(`${admins.length} administrator account(s).`);
  } else {
    const supabaseUserId = option("--supabase-user-id");
    if (supabaseUserId === undefined || !UUID.test(supabaseUserId)) {
      console.error("Pass --list, or --supabase-user-id <uuid> [--phone <number>].");
      process.exit(1);
    }
    const phone = option("--phone");
    const outcome = await provisionAdministrator(prisma, supabaseUserId, phone === undefined ? {} : { phone });
    if (outcome.state === "provisioned") console.log("Administrator account created.");
    else if (outcome.state === "invalid-phone") {
      console.error("The phone number is not valid. Nothing was written.");
      process.exitCode = 1;
    } else {
      console.error(`This identity already has a ${outcome.accountType} account; account types never change. Nothing was written.`);
      process.exitCode = 1;
    }
  }
} finally {
  await prisma.$disconnect();
}
