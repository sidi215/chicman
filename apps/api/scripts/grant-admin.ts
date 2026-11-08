// Grants or revokes the ADMIN role (spec 03 roles; spec 06 rule 7) for an
// existing, bootstrapped Chicman user. Roles are never granted by the API or
// from client input; this operator script is the only way to create an
// administrator. It changes roles only: the account itself (email and
// password) is created through normal sign-up and email confirmation.
//
//   pnpm --filter @chicman/api admin:grant -- --list
//   pnpm --filter @chicman/api admin:grant -- --supabase-user-id <uuid>
//   pnpm --filter @chicman/api admin:grant -- --supabase-user-id <uuid> --revoke
//
// Uses DATABASE_URL (apps/api/.env, or the environment).
import dotenv from "dotenv";

import { createPrismaClient } from "../src/lib/prisma.js";

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
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, supabaseUserId: true, createdAt: true, roles: { select: { role: true } }, shop: { select: { status: true } } },
    });
    for (const user of users) {
      const roles = user.roles.map((r) => r.role).sort().join(",");
      console.log(`${user.supabaseUserId}  roles=${roles}  shop=${user.shop?.status ?? "-"}  created=${user.createdAt.toISOString()}`);
    }
  } else {
    const supabaseUserId = option("--supabase-user-id");
    if (supabaseUserId === undefined || !UUID.test(supabaseUserId)) {
      console.error("Pass --list, or --supabase-user-id <uuid> [--revoke].");
      process.exit(1);
    }
    const user = await prisma.user.findUnique({ where: { supabaseUserId }, select: { id: true } });
    if (user === null) {
      console.error("No bootstrapped Chicman user has this Supabase user ID (sign up, confirm the email, and complete account setup first).");
      process.exit(1);
    }
    if (args.includes("--revoke")) {
      const { count } = await prisma.userRole.deleteMany({ where: { userId: user.id, role: "ADMIN" } });
      console.log(count === 1 ? "ADMIN revoked." : "The user did not hold ADMIN; nothing changed.");
    } else {
      // INSERT … ON CONFLICT DO NOTHING: running it twice changes nothing.
      const { count } = await prisma.userRole.createMany({ data: [{ userId: user.id, role: "ADMIN" }], skipDuplicates: true });
      console.log(count === 1 ? "ADMIN granted." : "The user already holds ADMIN; nothing changed.");
    }
    const roles = await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } });
    console.log(`Roles now: ${roles.map((r) => r.role).sort().join(", ")}`);
  }
} finally {
  await prisma.$disconnect();
}
