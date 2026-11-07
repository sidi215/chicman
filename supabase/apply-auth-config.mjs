#!/usr/bin/env node
// Applies Chicman's Supabase Auth settings (spec 03, Supabase Project
// Configuration) to a hosted project through the Management API.
//
//   SUPABASE_ACCESS_TOKEN=<personal access token> \
//   SUPABASE_PROJECT_REF=<project ref> \
//   SITE_URL=<web site URL of this environment> \
//   [SMTP_PASS=<Resend API key> SMTP_SENDER_EMAIL=<sender address>] \
//   [TURNSTILE_SECRET_KEY=<secret>] \
//   node supabase/apply-auth-config.mjs [--apply | --show]
//
// Without --apply it only prints what would change (dry run). Secrets are
// read from the environment of this command and never printed. Pass
// TURNSTILE_SECRET_KEY (and SMTP_PASS) only when running the script; never
// store them in a repository env file.
//
// Step 1: site URL, redirect allowlist, sign-in switches, and (when the
//         variables are set) custom SMTP and Turnstile CAPTCHA.
// Step 2: the email subjects and templates. Supabase accepts custom templates
//         only once custom SMTP is configured (free projects), so this step is
//         skipped, with a notice, until then.
//
// SMTP variables (Resend defaults): SMTP_HOST (smtp.resend.com), SMTP_PORT
// (465), SMTP_USER (resend), SMTP_PASS (required), SMTP_SENDER_EMAIL
// (required), SMTP_SENDER_NAME (Chicman).

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");
// --show: print the current URL, CAPTCHA, SMTP, and rate-limit settings (read-only).
const showOnly = process.argv.includes("--show");
const env = process.env;
const token = env.SUPABASE_ACCESS_TOKEN;
const ref = env.SUPABASE_PROJECT_REF;
const siteUrl = (env.SITE_URL ?? "").replace(/\/+$/, "");

const missing = [
  ["SUPABASE_ACCESS_TOKEN", token],
  ["SUPABASE_PROJECT_REF", ref],
  ...(showOnly ? [] : [["SITE_URL", siteUrl]]),
].filter(([, value]) => !value);
if (missing.length > 0) {
  console.error(`Missing: ${missing.map(([name]) => name).join(", ")}`);
  process.exit(1);
}
if (!showOnly && !/^https?:\/\/[^/\s]+$/.test(siteUrl)) {
  console.error("SITE_URL must be an origin such as https://example.com (no path)");
  process.exit(1);
}

// Custom SMTP: only when both the password and the sender are given.
const smtpRequested = Boolean(env.SMTP_PASS || env.SMTP_SENDER_EMAIL);
if (smtpRequested && !(env.SMTP_PASS && env.SMTP_SENDER_EMAIL)) {
  console.error("Custom SMTP needs both SMTP_PASS and SMTP_SENDER_EMAIL.");
  process.exit(1);
}
const smtp = smtpRequested
  ? {
      smtp_host: env.SMTP_HOST ?? "smtp.resend.com",
      smtp_port: env.SMTP_PORT ?? "465",
      smtp_user: env.SMTP_USER ?? "resend",
      smtp_pass: env.SMTP_PASS,
      smtp_admin_email: env.SMTP_SENDER_EMAIL,
      smtp_sender_name: env.SMTP_SENDER_NAME ?? "Chicman",
    }
  : {};

const captcha = env.TURNSTILE_SECRET_KEY
  ? { security_captcha_enabled: true, security_captcha_provider: "turnstile", security_captcha_secret: env.TURNSTILE_SECRET_KEY }
  : {};

const template = (name) => readFile(join(here, "templates", name), "utf8");

const step1 = {
  site_url: siteUrl,
  // Exactly one callback, no wildcards.
  uri_allow_list: `${siteUrl}/auth/callback`,
  external_email_enabled: true,
  disable_signup: false,
  mailer_autoconfirm: false,
  external_phone_enabled: false,
  mailer_secure_email_change_enabled: true,
  ...smtp,
  ...captcha,
};
const step2 = {
  mailer_subjects_confirmation: "Confirmez votre adresse e-mail · تأكيد بريدك الإلكتروني",
  mailer_templates_confirmation_content: await template("confirmation.html"),
  mailer_subjects_recovery: "Réinitialiser votre mot de passe · إعادة تعيين كلمة المرور",
  mailer_templates_recovery_content: await template("recovery.html"),
};
// Never printed; always sent when set (they cannot be compared).
const SECRET_FIELDS = new Set(["security_captcha_secret", "smtp_pass"]);

// SUPABASE_API_BASE: only for testing against a stand-in API.
const endpoint = `${env.SUPABASE_API_BASE ?? "https://api.supabase.com"}/v1/projects/${ref}/config/auth`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" };

async function request(method, body) {
  const response = await fetch(endpoint, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    // The Management API's error message (it never echoes the access token).
    let detail = "";
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        detail = json.message ?? json.error ?? text;
      } catch {
        detail = text;
      }
    } catch {
      // No body.
    }
    console.error(`${method} ${endpoint} → ${response.status}${detail ? `\n${String(detail).slice(0, 2000)}` : ""}`);
    if (method === "PATCH") console.error("This step was rejected. Run without --apply to see what is still pending.");
    process.exit(1);
  }
  return response.json();
}

const show = (key, value) => {
  if (SECRET_FIELDS.has(key)) return value ? "<set>" : "<unset>";
  if (typeof value === "string" && value.length > 80) return `<${value.length} chars>`;
  return JSON.stringify(value);
};
const same = (a, b) => String(a ?? "") === String(b ?? "");
const pending = (desired, current) =>
  Object.entries(desired).filter(([key, value]) => SECRET_FIELDS.has(key) || !same(current[key], value));
const print = (title, changes, current) => {
  console.log(title);
  if (changes.length === 0) console.log("  (already up to date)");
  for (const [key, value] of changes) console.log(`  ${key}: ${show(key, current[key])} → ${show(key, value)}`);
};
const verify = (desired, after) => {
  const wrong = Object.entries(desired).filter(([key, value]) => !SECRET_FIELDS.has(key) && !same(after[key], value));
  if (wrong.length > 0) {
    console.error(`Applied, but these did not read back as expected: ${wrong.map(([key]) => key).join(", ")}`);
    process.exit(1);
  }
};

let current = await request("GET");
if (showOnly) {
  const pick = (prefix) => Object.fromEntries(Object.entries(current).filter(([key]) => key.startsWith(prefix)));
  console.log("site_url:", JSON.stringify(current.site_url));
  console.log("uri_allow_list:", JSON.stringify(current.uri_allow_list));
  console.log("mailer_autoconfirm:", current.mailer_autoconfirm, "| external_phone_enabled:", current.external_phone_enabled);
  console.log("captcha:", { enabled: current.security_captcha_enabled, provider: current.security_captcha_provider, secret: current.security_captcha_secret ? "<set>" : "<unset>" });
  console.log("custom SMTP:", current.smtp_host ? `configured (${current.smtp_host})` : "not configured");
  console.log("rate limits:", pick("rate_limit_"));
  process.exit(0);
}
const hasCustomSmtp = (config) => Boolean(config.smtp_host && config.smtp_admin_email);

// Step 1
const changes1 = pending(step1, current);
print("Step 1 — URLs, sign-in settings" + (smtpRequested ? ", custom SMTP" : "") + (env.TURNSTILE_SECRET_KEY ? ", CAPTCHA" : ""), changes1, current);
if (!smtpRequested) console.log(`  (SMTP unchanged: SMTP_PASS/SMTP_SENDER_EMAIL not set; custom SMTP is ${hasCustomSmtp(current) ? "configured" : "not configured"})`);
if (!env.TURNSTILE_SECRET_KEY) console.log(`  (CAPTCHA unchanged: TURNSTILE_SECRET_KEY not set; currently ${show("x", current.security_captcha_enabled)})`);

// Step 2 runs only with custom SMTP (already configured or set in step 1).
const smtpReady = hasCustomSmtp(current) || smtpRequested;
const changes2 = pending(step2, current);
if (smtpReady) {
  print("Step 2 — email subjects and templates", changes2, current);
} else {
  console.log("Step 2 — email subjects and templates: skipped (needs custom SMTP first).");
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to change the project.");
  process.exit(0);
}

if (changes1.length > 0) {
  await request("PATCH", Object.fromEntries(changes1));
  current = await request("GET");
  verify(step1, current);
  console.log("\nStep 1 applied and verified.");
}
if (smtpReady && changes2.length > 0) {
  await request("PATCH", Object.fromEntries(changes2));
  current = await request("GET");
  verify(step2, current);
  console.log("Step 2 applied and verified.");
}
if (!smtpReady) {
  console.log("\nTemplates not applied yet: configure custom SMTP (SMTP_PASS, SMTP_SENDER_EMAIL) and run again.");
} else if (changes1.length === 0 && changes2.length === 0) {
  console.log("\nAuth settings already match.");
}
