// Deactivates an administrator's administrative access (AT-1, Q7). The
// account stays an Administrator account; it is never converted. Every
// administrative route refuses it from its next request. Audited
// (`AdminAccessEvent`). No reactivation is provided.
//
//   pnpm --filter @chicman/api admin:deactivate -- --supabase-user-id <uuid> --reason "<10–500 characters>" [--note "<text>"]
//
// Uses DATABASE_URL (apps/api/.env, or the environment).
import dotenv from "dotenv";

import { createPrismaClient } from "../src/lib/prisma.js";
import { deactivateAdministrator } from "../src/modules/accounts/index.js";

dotenv.config({ quiet: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const supabaseUserId = option("--supabase-user-id");
const reason = option("--reason");
if (supabaseUserId === undefined || !UUID.test(supabaseUserId) || reason === undefined) {
  console.error('Pass --supabase-user-id <uuid> --reason "<10–500 characters>" [--note "<text>"].');
  process.exit(1);
}
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const prisma = createPrismaClient(databaseUrl);

const MESSAGES = {
  deactivated: "Administrative access deactivated.",
  "already-deactivated": "Administrative access was already deactivated; nothing changed.",
  "not-found": "No account has this Supabase user ID. Nothing was written.",
  "not-admin": "This account is not an Administrator account. Nothing was written.",
  "invalid-reason": "The reason must be 10–500 characters of plain text. Nothing was written.",
  "invalid-note": "The note must be 1–1000 characters of plain text. Nothing was written.",
} as const;

try {
  const note = option("--note");
  const outcome = await deactivateAdministrator(prisma, supabaseUserId, note === undefined ? { reason } : { reason, note });
  const message = MESSAGES[outcome.state];
  if (outcome.state === "deactivated" || outcome.state === "already-deactivated") console.log(message);
  else {
    console.error(message);
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
