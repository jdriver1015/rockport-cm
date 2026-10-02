import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { createClient } from "@/lib/supabase/server";

/**
 * Choose a password — after "Forgot password?", after an admin sends a reset,
 * and, with ?welcome=1, the first screen a newly invited person sees. The link
 * that brought them here already signed them in; this sets the password they
 * use from now on.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const welcome = (await searchParams).welcome === "1";
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center">
      <Card>
        <CardHeader>
          <CardTitle className="text-navy">
            {welcome ? "Welcome to Rockport" : "Set a new password"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {welcome
              ? "Choose the password you'll use to sign in."
              : "Westcreek Construction Manager"}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.user ? (
            <>
              {welcome && data.user.email && (
                <p className="text-sm text-muted-foreground">
                  You&apos;ll sign in as{" "}
                  <span className="font-medium text-navy">{data.user.email}</span>.
                </p>
              )}
              <ResetPasswordForm submitLabel={welcome ? "Set password" : "Update password"} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {welcome ? (
                "This invite link has expired or was already used. Ask the admin who invited you to send a new one."
              ) : (
                <>
                  This link is invalid or has expired.{" "}
                  <Link href="/forgot-password" className="text-link hover:underline">
                    Request a new one
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
