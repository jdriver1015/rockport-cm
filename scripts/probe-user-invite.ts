/**
 * End-to-end probe of inviting a user, against the real Supabase project.
 *
 * The invite is a chain no unit test reaches: a roster row, a Supabase auth
 * user created with the same id, a one-time recovery token, the token redeemed
 * for a session, a password set on that session, and a sign-in with it. Then
 * the other direction — removing the person must stop them signing in, and
 * restoring them must let them back.
 *
 * Uses its own throwaway address on example.com, never a real inbox, and
 * DELETES the auth user and roster row it made in a finally block. It never
 * sends email. Safe to re-run.
 *
 *   npx tsx scripts/probe-user-invite.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { db, schema } from "../src/db";
import { createAdminClient } from "../src/lib/supabase/admin";
import { ensureProfile } from "../src/lib/ensure-profile";
import { issueSignInLink, readAuthStatuses, setSignInBlocked } from "../src/lib/user-access";

const EMAIL = `zz-probe-invite-${Date.now()}@example.com`;
const PASSWORD = `Probe-${Math.random().toString(36).slice(2)}-Aa1!`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

/** A browser that has never seen this app: anon key, no stored session. */
function freshBrowser() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  const admin = createAdminClient();
  const id = crypto.randomUUID();

  try {
    await db()
      .insert(schema.profiles)
      .values({ id, email: EMAIL, fullName: "ZZ Probe Invitee", role: "viewer" });

    // ------------------------------------------------------------- invite
    console.log("inviting");
    const issued = await issueSignInLink({ id, email: EMAIL, fullName: "ZZ Probe Invitee" });
    check("a link is issued", issued.ok, issued.ok ? issued.kind : issued.error);
    if (!issued.ok) return;
    check("it is the welcome, for someone who has never signed in", issued.kind === "invite");

    const link = new URL(issued.link);
    check("it lands on /auth/confirm", link.pathname === "/auth/confirm", link.pathname);
    check(
      "and continues to the welcome password screen",
      link.searchParams.get("next") === "/auth/reset-password?welcome=1",
      link.searchParams.get("next") ?? "",
    );
    check("no password travels in it", !link.toString().toLowerCase().includes("password="));

    const { data: authUser } = await admin.auth.admin.getUserById(id);
    check("the sign-in account shares the roster id", authUser.user?.id === id, authUser.user?.id);

    // ---------------------------------------------- redeem and set password
    console.log("\nredeeming the link");
    const browser = freshBrowser();
    const verified = await browser.auth.verifyOtp({
      type: "recovery",
      token_hash: link.searchParams.get("token_hash")!,
    });
    check("the token signs them in", !!verified.data.session, verified.error?.message);

    const reused = await freshBrowser().auth.verifyOtp({
      type: "recovery",
      token_hash: link.searchParams.get("token_hash")!,
    });
    check("the same link does not work twice", !reused.data.session, reused.error?.message);

    const set = await browser.auth.updateUser({ password: PASSWORD });
    check("they can set their own password", !set.error, set.error?.message);

    const signedIn = await freshBrowser().auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    check("and sign in with it", !!signedIn.data.session, signedIn.error?.message);
    check(
      "the app links the session to their roster row",
      (await ensureProfile(id, EMAIL))?.id === id,
    );

    const statuses = await readAuthStatuses();
    check("the roster now reads them as signed in", !!statuses.get(id)?.lastSignInAt);

    const again = await issueSignInLink({ id, email: EMAIL, fullName: "ZZ Probe Invitee" });
    check(
      "a second link for them is a password reset, not a welcome",
      again.ok && again.kind === "reset",
      again.ok ? again.kind : again.error,
    );

    // -------------------------------------------------------- removing them
    console.log("\nremoving them");
    const blockErr = await setSignInBlocked(id, true);
    check("sign-in can be blocked", blockErr === null, blockErr ?? "");
    await db().update(schema.profiles).set({ archivedAt: new Date() }).where(eq(schema.profiles.id, id));

    const blocked = await freshBrowser().auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    check("a removed person cannot sign in", !blocked.data.session, blocked.error?.message);
    check("and the app refuses their roster row", (await ensureProfile(id, EMAIL)) === null);
    check("the roster reads them as blocked", (await readAuthStatuses()).get(id)?.blocked === true);

    console.log("\nrestoring them");
    const unblockErr = await setSignInBlocked(id, false);
    await db().update(schema.profiles).set({ archivedAt: null }).where(eq(schema.profiles.id, id));
    check("sign-in can be unblocked", unblockErr === null, unblockErr ?? "");
    const back = await freshBrowser().auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    check("a restored person signs in again", !!back.data.session, back.error?.message);

    // ------------------------------------------------- nobody else gets in
    console.log("\nan account nobody invited");
    const strangerId = crypto.randomUUID();
    const strangerEmail = `zz-probe-stranger-${Date.now()}@example.com`;
    await admin.auth.admin.createUser({ id: strangerId, email: strangerEmail, email_confirm: true });
    try {
      check(
        "gets no roster row of its own",
        (await ensureProfile(strangerId, strangerEmail)) === null,
      );
      const made = await db().query.profiles.findFirst({ where: eq(schema.profiles.id, strangerId) });
      check("and none is created for it", !made);
    } finally {
      await admin.auth.admin.deleteUser(strangerId);
    }
  } finally {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
    await db().delete(schema.profiles).where(eq(schema.profiles.id, id));
    console.log("\n  teardown: removed the probe account and roster row");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
