import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client authenticated with the service-role key. Bypasses
 * RLS, so it must ONLY be used in route handlers / server actions AFTER the
 * caller's session has been verified (via the cookie-bound server client).
 * Never import this into a Client Component.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL are not set — required for document storage.",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Shared bucket for project attachments (documents, and later photos/invoices). */
export const ATTACHMENTS_BUCKET = "attachments";

/** Prefix within ATTACHMENTS_BUCKET for original GL import files. */
export const GL_IMPORTS_PREFIX = "gl-imports";

/** Prefix within ATTACHMENTS_BUCKET for site-audit photos. */
export const AUDIT_PHOTOS_PREFIX = "audit-photos";

/** Prefix within ATTACHMENTS_BUCKET for original rent-roll import files. */
export const RENT_ROLLS_PREFIX = "rent-rolls";
