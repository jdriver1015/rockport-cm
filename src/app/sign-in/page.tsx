import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInForm } from "@/components/auth/sign-in-form";

export default function SignInPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center">
      <Card>
        <CardHeader>
          <CardTitle className="text-navy">Sign in</CardTitle>
          <p className="text-sm text-muted-foreground">Westcreek Construction Manager</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Suspense>
            <SignInForm />
          </Suspense>
          {/* Accounts are created by invitation from Settings → Users. */}
          <p className="text-center text-sm text-muted-foreground">
            New to Rockport? Ask an admin to send you an invite.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
