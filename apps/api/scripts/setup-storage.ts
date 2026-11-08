// Prepares the two logo buckets (spec 06, Storage locations) through the
// S3-compatible API. Idempotent; run once per environment:
//
//   pnpm --filter @chicman/api storage:setup                 # buckets + staging CORS
//   pnpm --filter @chicman/api storage:setup -- --public-acl # also media public-read ACL (SeaweedFS)
//
// - Staging bucket (S3_UPLOADS_BUCKET): private, CORS allows PUT from the
//   web origins (CORS_ORIGINS).
// - Media bucket (S3_MEDIA_BUCKET): publicly readable. SeaweedFS uses the
//   `public-read` ACL (`--public-acl`). Cloudflare R2 has no ACLs: enable
//   public access (custom domain or r2.dev) in the R2 dashboard and set
//   MEDIA_PUBLIC_BASE_URL to that origin. Never make the staging bucket public.
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketAclCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";

import { loadWorkerStorageConfig } from "../src/config/env.js";

dotenv.config({ quiet: true });
const { storage } = loadWorkerStorageConfig(process.env);
if (storage === undefined) {
  console.error("Object storage is not configured (S3_* variables).");
  process.exit(1);
}
const origins = (process.env["CORS_ORIGINS"] ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
const publicAcl = process.argv.includes("--public-acl");

const client = new S3Client({
  endpoint: storage.endpoint,
  region: storage.region,
  forcePathStyle: true,
  credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
});

async function ensureBucket(bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`bucket ${bucket}: exists`);
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`bucket ${bucket}: created`);
  }
}

await ensureBucket(storage.uploadsBucket);
await ensureBucket(storage.mediaBucket);

if (origins.length > 0) {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: storage.uploadsBucket,
      CORSConfiguration: {
        CORSRules: [
          { AllowedMethods: ["PUT"], AllowedOrigins: origins, AllowedHeaders: ["content-type"], MaxAgeSeconds: 300 },
        ],
      },
    }),
  );
  console.log(`bucket ${storage.uploadsBucket}: CORS allows PUT from ${origins.join(", ")}`);
} else {
  console.warn("CORS_ORIGINS is empty: the staging bucket CORS rule was not set");
}

if (publicAcl) {
  await client.send(new PutBucketAclCommand({ Bucket: storage.mediaBucket, ACL: "public-read" }));
  console.log(`bucket ${storage.mediaBucket}: public-read`);
} else {
  console.log(`bucket ${storage.mediaBucket}: public access not changed (R2: configure it in the dashboard)`);
}
