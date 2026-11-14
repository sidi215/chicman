// AT-1 classification of existing accounts (context/account-types-audit.md,
// section 11). Dry run by default: prints each account's proposed type, the
// data its new type will no longer reach (kept, never changed), and the plan
// digest. Writing needs the owner's approval of that exact plan:
//
//   pnpm --filter @chicman/api accounts:classify
//   pnpm --filter @chicman/api accounts:classify -- --apply --approve <digest>
//
// Writes only `User.accountType`, only where it is unset, in one transaction.
// Requires the `account_types_expand` migration. Uses DATABASE_URL.
import dotenv from "dotenv";

import { createPrismaClient } from "../src/lib/prisma.js";
import type { ClassificationPlan } from "../src/modules/accounts/account-classification.js";
import { buildClassificationPlan } from "../src/modules/accounts/account-classification.js";
import { applyClassificationPlan, loadAccountSnapshots } from "../src/modules/accounts/account-classification.repository.js";

dotenv.config({ quiet: true });
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

function print(plan: ClassificationPlan): void {
  for (const { account, result } of plan.entries) {
    const roles = [...account.roles].sort().join("+") || "(none)";
    const shop = account.shop === null ? "-" : `${account.shop.status} (${account.shop.products} products, ${account.shop.shopOrders} shop orders)`;
    const outcome =
      result.kind === "blocked"
        ? `BLOCKED ${result.reason}${result.proposed === null ? "" : ` (rule: ${result.proposed})`}`
        : `${result.kind === "classify" ? "→" : "="} ${result.accountType}${result.incompatible.length > 0 ? `  kept, unreachable: ${result.incompatible.join(", ")}` : ""}`;
    console.log(`${account.supabaseUserId}  roles=${roles}  shop=${shop}  ${outcome}`);
  }
  console.log(`\n${plan.entries.length} accounts, ${plan.writes.length} to write, ${plan.blocked} blocked.`);
  console.log(`Plan digest: ${plan.digest}`);
}

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const prisma = createPrismaClient(databaseUrl);

try {
  const [column] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'accountType') AS present`;
  const present = column?.present === true;
  if (!args.includes("--apply")) {
    print(buildClassificationPlan(await loadAccountSnapshots(prisma, { accountTypeColumn: present })));
    if (!present) console.log("\nThe account_types_expand migration is not applied to this database yet: --apply will refuse until it is.");
    console.log("\nDry run: nothing was written. Review the plan, then rerun with --apply --approve <digest>.");
  } else if (!present) {
    console.error("The account_types_expand migration is not applied to this database. Nothing was written.");
    process.exitCode = 1;
  } else {
    const approved = option("--approve");
    if (approved === undefined || !/^[0-9a-f]{64}$/.test(approved)) {
      console.error("--apply needs --approve <digest> from a reviewed dry run.");
      process.exit(1);
    }
    const outcome = await applyClassificationPlan(prisma, approved);
    print(outcome.plan);
    if (outcome.state === "blocked") {
      console.error("\nNot applied: some accounts are blocked. Nothing was written.");
      process.exitCode = 1;
    } else if (outcome.state === "digest-mismatch") {
      console.error("\nNot applied: the accounts changed since the reviewed dry run (digest differs). Nothing was written.");
      process.exitCode = 1;
    } else {
      console.log(`\nApplied: ${outcome.written} account type(s) written.`);
    }
  }
} finally {
  await prisma.$disconnect();
}
