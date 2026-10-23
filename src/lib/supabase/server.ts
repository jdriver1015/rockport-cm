import { SANDBOX_USER } from "@/lib/sandbox-user";

/**
 * Sandbox stand-in for the cookie-bound Supabase client.
 *
 * Authentication has been removed: every caller is the fixed sandbox admin, so
 * the `auth.getUser()` checks scattered through actions and route handlers keep
 * working unchanged and always succeed. Storage goes through `createAdminClient`
 * (admin.ts), which never depended on a session.
 */
export async function createClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: SANDBOX_USER.id, email: SANDBOX_USER.email } },
        error: null,
      }),
    },
  };
}
