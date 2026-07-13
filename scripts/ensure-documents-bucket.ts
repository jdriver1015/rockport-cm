/**
 * Create the private "attachments" Storage bucket if it doesn't exist.
 * Idempotent. Also validates that the service-role key works.
 * Run: npx tsx scripts/ensure-documents-bucket.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const BUCKET = "attachments";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: existing, error: listErr } = await admin.storage.listBuckets();
  if (listErr) throw listErr;
  if (existing.some((b) => b.name === BUCKET)) {
    console.log(`Bucket "${BUCKET}" already exists.`);
    return;
  }

  const { error } = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: "25MB",
  });
  if (error) throw error;
  console.log(`Created private bucket "${BUCKET}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
