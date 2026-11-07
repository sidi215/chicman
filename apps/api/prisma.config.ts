import "dotenv/config";

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Optional here so `prisma generate` works without a database.
    // Migration commands fail clearly if it is missing.
    url: process.env["DATABASE_URL"] ?? "",
  },
});
