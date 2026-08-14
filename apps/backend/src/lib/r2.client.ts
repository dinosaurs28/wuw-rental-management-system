import { S3Client } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.warn("[R2] Credentials missing! Client will not work correctly.");
} else {
  console.log(`[R2] Client initialized with endpoint: https://${accountId}.r2.cloudflarestorage.com`);
}

// Single S3-compatible client for the Cloudflare R2 account.
// Both the public and private buckets live in the same account/endpoint —
// the bucket name is passed per-command, not per-client.
export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: accessKeyId || "",
    secretAccessKey: secretAccessKey || "",
  },
});

// Public bucket  — vehicle images, booking photos (pickup / return / damage)
export const PUBLIC_BUCKET = process.env.R2_BUCKET_NAME!;

// Private bucket — invoices, receipts, KYC documents (no public access)
export const PRIVATE_BUCKET = process.env.R2_PRIVATE_BUCKET_NAME!;
