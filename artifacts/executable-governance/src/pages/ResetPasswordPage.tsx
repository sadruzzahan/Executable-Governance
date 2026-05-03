import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ShieldCheck } from "lucide-react";
import { useResetPassword, ApiError } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";

export function ResetPasswordPage() {
  const [, navigate] = useLocation();
  const [token, setToken] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const reset = useResetPassword();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token") ?? "");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw !== confirm) { setError("Passwords don't match."); return; }
    try {
      await reset.mutateAsync({ token, newPassword: pw });
      setDone(true);
      setTimeout(() => navigate("/login"), 1500);
    } catch (err) {
      if (err instanceof ApiError) {
        const w = err.data?.warnings as string[] | undefined;
        setError(`${err.message}${w?.length ? ` (${w.join(", ")})` : ""}`);
      } else {
        setError(err instanceof Error ? err.message : "Reset failed.");
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="text-base font-semibold">Reset password</div>
        </div>
        {done ? (
          <Alert><AlertDescription>Password updated. Redirecting to sign in…</AlertDescription></Alert>
        ) : (
          <form onSubmit={submit} className="space-y-4" data-testid="reset-form">
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">New password</Label>
              <Input id="new-pw" type="password" required minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" data-testid="reset-password" />
              <PasswordStrengthMeter password={pw} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw">Confirm password</Label>
              <Input id="confirm-pw" type="password" required minLength={12} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" data-testid="reset-confirm" />
            </div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" className="w-full" disabled={reset.isPending || !token} data-testid="reset-submit">
              {reset.isPending ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
