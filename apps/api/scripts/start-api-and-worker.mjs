#!/usr/bin/env node
// Runs the API and the background worker in one container (QA-01, free
// Render plan: background workers are not free, so both share the one web
// service). Used as the container command on Render (render.yaml); the
// development and self-hosted setups keep them as separate services.
//
// 1. Applies pending database migrations (`prisma migrate deploy`), unless
//    RUN_MIGRATIONS_ON_START=false. Render's pre-deploy command is a paid
//    feature, so this replaces it. A failed migration stops the start, so
//    Render keeps the previous deploy running.
// 2. Starts `dist/server.js` and `dist/workers/index.js` as two processes.
//    The worker's jobs each hold their own PostgreSQL advisory lock, so two
//    containers during a deploy never run the same job twice.
// 3. If either process exits, the other is stopped and the container exits
//    with that status, so the platform restarts both. SIGTERM and SIGINT are
//    forwarded (the worker finishes its current run first).
import { spawn } from "node:child_process";

const children = new Map();
let stopping = false;

function run(name, command, args) {
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  children.set(name, child);
  child.on("exit", (code, signal) => {
    children.delete(name);
    const status = code ?? 1;
    if (!stopping) {
      console.error(`[start] ${name} exited (${signal ?? `code ${code}`}); stopping the container so it restarts`);
      shutdown("child exit", status === 0 ? 1 : status);
    } else if (children.size === 0) {
      process.exit(exitCode);
    }
  });
  return child;
}

let exitCode = 0;
function shutdown(reason, code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  console.log(`[start] ${reason}: stopping ${[...children.keys()].join(" and ") || "nothing"}`);
  for (const child of children.values()) child.kill("SIGTERM");
  if (children.size === 0) process.exit(exitCode);
  // The worker's own grace period is shorter; never hang a deploy.
  setTimeout(() => process.exit(exitCode), 25_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

if (process.env.RUN_MIGRATIONS_ON_START !== "false") {
  console.log("[start] applying database migrations");
  const code = await new Promise((resolve) => {
    const migrate = spawn("pnpm", ["db:deploy"], { stdio: "inherit", env: process.env });
    migrate.on("exit", (exit) => resolve(exit ?? 1));
    migrate.on("error", () => resolve(1));
  });
  if (code !== 0) {
    console.error(`[start] migrations failed (code ${code}); not starting`);
    process.exit(1);
  }
}

if (!stopping) {
  run("api", process.execPath, ["dist/server.js"]);
  run("worker", process.execPath, ["dist/workers/index.js"]);
}
