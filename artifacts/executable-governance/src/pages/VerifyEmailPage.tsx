import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";
import { useVerifyEmail, ApiError } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function VerifyEmailPage() {
  const [state, setState] = useState<"verifying" | "ok" | "fail">("verifying");
  const [message, setMessage] = useState("");
  const verify = useVerifyEmail();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) { setState("fail"); setMessage("Missing token."); return; }
    verify
      .mutateAsync({ token })
      .then(() => setState("ok"))
      .catch((err) => {
        setState("fail");
        setMessage(err instanceof ApiError ? err.message : "Verification failed.");
      });
    // We deliberately want this to run exactly once, not on every dep change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-8 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="text-base font-semibold">Verify email</div>
        </div>
        {state === "verifying" && <p className="text-sm text-muted-foreground">Verifying your email address…</p>}
        {state === "ok" && (
          <>
            <Alert><AlertDescription>Your email is verified.</AlertDescription></Alert>
            <Link href="/"><Button className="w-full">Continue to dashboard</Button></Link>
          </>
        )}
        {state === "fail" && (
          <>
            <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>
            <Link href="/"><Button variant="outline" className="w-full">Back to dashboard</Button></Link>
          </>
        )}
      </Card>
    </div>
  );
}
