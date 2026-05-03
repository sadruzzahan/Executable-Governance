import { useState } from "react";
import { useLocation } from "wouter";
import { ShieldCheck } from "lucide-react";
import { useLogin, useForgotPassword, ApiError } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function LoginPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [needMfa, setNeedMfa] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const login = useLogin();
  const forgot = useForgotPassword();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({
        email,
        password,
        totpCode: needMfa && !useRecovery ? totpCode : undefined,
        recoveryCode: needMfa && useRecovery ? recoveryCode : undefined,
      });
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError && err.data?.error === "mfa_required") {
        setNeedMfa(true);
        setError(needMfa ? err.message : "Two-factor code required.");
        return;
      }
      setError(err instanceof Error ? err.message : "Login failed.");
    }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await forgot.mutateAsync({ email });
      setForgotSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-base font-semibold">Executable Governance</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Compliance Workstation</div>
          </div>
        </div>

        {forgotMode ? (
          forgotSent ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  If an account exists for that email, a reset link has been sent. Check your inbox.
                </AlertDescription>
              </Alert>
              <Button variant="ghost" className="w-full" onClick={() => { setForgotMode(false); setForgotSent(false); }}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={submitForgot} className="space-y-4" data-testid="forgot-form">
              <h2 className="text-lg font-semibold">Reset your password</h2>
              <p className="text-sm text-muted-foreground">
                Enter your email and we'll send you a link to choose a new password.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">Email</Label>
                <Input id="forgot-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email" />
              </div>
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              <Button type="submit" className="w-full" disabled={forgot.isPending} data-testid="forgot-submit">
                {forgot.isPending ? "Sending…" : "Send reset link"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setForgotMode(false)}>Cancel</Button>
            </form>
          )
        ) : (
          <form onSubmit={submit} className="space-y-4" data-testid="login-form">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={needMfa} data-testid="login-email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={needMfa} data-testid="login-password" />
            </div>
            {needMfa && (
              <div className="space-y-1.5">
                {useRecovery ? (
                  <>
                    <Label htmlFor="recovery">Recovery code</Label>
                    <Input id="recovery" required autoComplete="one-time-code" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} placeholder="XXXXX-XXXXX" data-testid="login-recovery" />
                    <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setUseRecovery(false)}>
                      Use authenticator code instead
                    </button>
                  </>
                ) : (
                  <>
                    <Label htmlFor="totp">Authenticator code</Label>
                    <Input id="totp" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="123456" data-testid="login-totp" />
                    <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setUseRecovery(true)}>
                      Lost your device? Use a recovery code
                    </button>
                  </>
                )}
              </div>
            )}
            {error && <Alert variant="destructive"><AlertDescription data-testid="login-error">{error}</AlertDescription></Alert>}
            <Button type="submit" className="w-full" disabled={login.isPending} data-testid="login-submit">
              {login.isPending ? "Signing in…" : needMfa ? "Verify" : "Sign in"}
            </Button>
            <button type="button" className="block w-full text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => { setForgotMode(true); setError(null); }}>
              Forgot password?
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
