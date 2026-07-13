import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { createClient } from "@/lib/supabase/server";

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center">
      <Card>
        <CardHeader>
          <CardTitle className="text-navy">Set a new password</CardTitle>
          <p className="text-sm text-muted-foreground">Westcreek Construction Manager</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.user ? (
            <ResetPasswordForm />
          ) : (
            <p className="text-sm text-muted-foreground">
              This link is invalid or has expired.{" "}
              <Link href="/forgot-password" className="text-gold-link hover:underline">
                Request a new one
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
