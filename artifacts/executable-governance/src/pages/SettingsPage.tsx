import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  User,
  KeyRound,
  ShieldCheck,
  Monitor,
  AlertTriangle,
  Mail,
  Loader2,
  Trash2,
} from "lucide-react";
import {
  useMe,
  useUpdateProfile,
  useRequestEmailChange,
  useChangePassword,
  useMfaStatus,
  useMfaEnrollStart,
  useMfaEnrollVerify,
  useMfaDisable,
  useRegenerateRecoveryCodes,
  useSessions,
  useRevokeSession,
  useRevokeOtherSessions,
  useDeleteAccount,
  useOrgSecurity,
  useUpdateOrgSecurity,
  useResendVerification,
  useLogout,
  ApiError,
  type SessionRow,
} from "@/lib/auth";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import { useToast } from "@/hooks/use-toast";

const TABS = [
  { key: "account", label: "Account", icon: User, href: "/settings/account" },
  { key: "password", label: "Password", icon: KeyRound, href: "/settings/password" },
  { key: "security", label: "Security", icon: ShieldCheck, href: "/settings/security" },
  { key: "sessions", label: "Sessions", icon: Monitor, href: "/settings/sessions" },
  { key: "danger", label: "Danger zone", icon: AlertTriangle, href: "/settings/danger" },
];

export function SettingsPage({ section }: { section?: string }) {
  const me = useMe();
  const tab = section ?? "account";

  if (me.isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      </AppLayout>
    );
  }
  if (!me.data) return null;

  return (
    <AppLayout>
      <PageHeader
        title="Account settings"
        description="Manage your profile, credentials, second factor, and active sessions."
      />
      <div className="px-8 py-6 grid grid-cols-[200px_1fr] gap-8 max-w-5xl">
        <nav className="space-y-1" data-testid="settings-nav">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <Link
                key={t.key}
                href={t.href}
                data-testid={`settings-tab-${t.key}`}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${active ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"}`}
              >
                <Icon className="w-4 h-4" />
                <span>{t.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0">
          {tab === "account" && <AccountTab />}
          {tab === "password" && <PasswordTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "sessions" && <SessionsTab />}
          {tab === "danger" && <DangerTab />}
        </div>
      </div>
    </AppLayout>
  );
}

function AccountTab() {
  const me = useMe();
  const u = me.data!.user;
  const update = useUpdateProfile();
  const emailChange = useRequestEmailChange();
  const { toast } = useToast();
  const [name, setName] = useState(u.name);
  const [timezone, setTimezone] = useState(u.timezone);
  const [locale, setLocale] = useState(u.locale);
  const [avatarUrl, setAvatarUrl] = useState(u.avatarUrl ?? "");
  const [newEmail, setNewEmail] = useState("");

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({
        name: name.trim(),
        timezone: timezone.trim(),
        locale: locale.trim(),
        avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null,
      });
      toast({ title: "Profile updated" });
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  };

  const requestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await emailChange.mutateAsync({ newEmail });
      toast({ title: "Verification email sent", description: `Check ${newEmail} to confirm the change.` });
      setNewEmail("");
    } catch (err) {
      toast({ title: "Could not send email", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-base font-semibold mb-1">Profile</h2>
        <p className="text-xs text-muted-foreground mb-5">Visible to other members of your organization.</p>
        <form onSubmit={saveProfile} className="space-y-4 max-w-md" data-testid="profile-form">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Full name</Label>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} required data-testid="profile-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-tz">Timezone</Label>
            <Input id="profile-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" data-testid="profile-timezone" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-locale">Locale</Label>
            <Input id="profile-locale" value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="en-US" data-testid="profile-locale" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-avatar">Avatar URL (optional)</Label>
            <Input id="profile-avatar" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" data-testid="profile-avatar" />
            <p className="text-[11px] text-muted-foreground">
              Direct image URL. File upload is coming in a future release.
            </p>
          </div>
          <Button type="submit" disabled={update.isPending} data-testid="profile-save">
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold mb-1">Email address</h2>
        <p className="text-xs text-muted-foreground mb-5">
          Current address: <span className="font-mono">{u.email}</span>{" "}
          {u.emailVerifiedAt ? (
            <Badge variant="secondary">verified</Badge>
          ) : (
            <Badge variant="outline">unverified</Badge>
          )}
        </p>
        <form onSubmit={requestEmailChange} className="space-y-4 max-w-md" data-testid="email-change-form">
          <div className="space-y-1.5">
            <Label htmlFor="new-email">New email</Label>
            <Input id="new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required data-testid="email-change-input" />
            <p className="text-[11px] text-muted-foreground">
              We'll send a verification link to the new address. Your current email stays active until you click the link.
            </p>
          </div>
          <Button type="submit" disabled={emailChange.isPending} data-testid="email-change-submit">
            {emailChange.isPending ? "Sending…" : "Send verification email"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function PasswordTab() {
  const change = useChangePassword();
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) { setError("New passwords don't match."); return; }
    try {
      const r = await change.mutateAsync({ currentPassword: current, newPassword: next });
      toast({
        title: "Password changed",
        description: r.otherSessionsRevoked > 0
          ? `${r.otherSessionsRevoked} other session(s) signed out.`
          : "Other sessions were already inactive.",
      });
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err) {
      if (err instanceof ApiError) {
        const w = err.data?.warnings as string[] | undefined;
        setError(`${err.message}${w?.length ? ` (${w.join(", ")})` : ""}`);
      } else setError(err instanceof Error ? err.message : "Update failed.");
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold mb-1">Change password</h2>
      <p className="text-xs text-muted-foreground mb-5">
        We check every new password against the Have I Been Pwned breach corpus. All other sessions are signed out on success.
      </p>
      <form onSubmit={submit} className="space-y-4 max-w-md" data-testid="password-form">
        <div className="space-y-1.5">
          <Label htmlFor="current-pw">Current password</Label>
          <Input id="current-pw" type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" data-testid="pw-current" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-pw">New password</Label>
          <Input id="new-pw" type="password" required minLength={12} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" data-testid="pw-new" />
          <PasswordStrengthMeter password={next} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-pw">Confirm new password</Label>
          <Input id="confirm-pw" type="password" required minLength={12} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" data-testid="pw-confirm" />
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={change.isPending} data-testid="pw-submit">
          {change.isPending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </Card>
  );
}

function SecurityTab() {
  const me = useMe();
  const status = useMfaStatus();
  const start = useMfaEnrollStart();
  const verify = useMfaEnrollVerify();
  const disable = useMfaDisable();
  const regen = useRegenerateRecoveryCodes();
  const updateOrgSecurity = useUpdateOrgSecurity();
  const orgSecurity = useOrgSecurity(me.data?.user.organizationId);
  const { toast } = useToast();

  const [qr, setQr] = useState<{ url: string; data: string } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePw, setDisablePw] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  const isAdmin = me.data?.user.role === "admin";
  const requireMfa = orgSecurity.data?.requireMfa ?? false;

  const beginEnroll = async () => {
    setRecoveryCodes(null);
    const r = await start.mutateAsync();
    setQr({ url: r.otpauthUrl, data: r.qrDataUrl });
  };
  const finishEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await verify.mutateAsync({ code });
      setRecoveryCodes(r.recoveryCodes);
      setQr(null);
      setCode("");
      toast({ title: "Two-factor enabled" });
    } catch (err) {
      toast({ title: "Code rejected", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  };
  const submitDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await disable.mutateAsync({ password: disablePw });
      setShowDisable(false); setDisablePw("");
      toast({ title: "Two-factor disabled" });
    } catch (err) {
      toast({ title: "Could not disable", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  };
  const regenerate = async () => {
    const r = await regen.mutateAsync();
    setRecoveryCodes(r.recoveryCodes);
    toast({ title: "New recovery codes generated" });
  };
  const toggleOrgMfa = async (val: boolean) => {
    try {
      await updateOrgSecurity.mutateAsync({ id: me.data!.user.organizationId, requireMfa: val });
      toast({ title: val ? "MFA now required for org" : "MFA requirement lifted" });
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-base font-semibold">Two-factor authentication</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Add an authenticator app (Google Authenticator, 1Password, Authy) for a second factor on every login.
            </p>
          </div>
          <Badge variant={status.data?.enabled ? "secondary" : "outline"} data-testid="mfa-status">
            {status.data?.enabled ? "Enabled" : "Not enabled"}
          </Badge>
        </div>

        {!status.data?.enabled && !qr && (
          <Button onClick={beginEnroll} disabled={start.isPending} data-testid="mfa-start">
            {start.isPending ? "Loading…" : "Set up two-factor"}
          </Button>
        )}

        {qr && (
          <div className="space-y-4 max-w-sm">
            <div className="rounded-md border bg-muted/30 p-4 flex flex-col items-center gap-3">
              <img src={qr.data} alt="TOTP QR code" className="w-48 h-48" data-testid="mfa-qr" />
              <code className="text-[10px] font-mono break-all text-center text-muted-foreground">
                {qr.url}
              </code>
            </div>
            <form onSubmit={finishEnroll} className="space-y-3" data-testid="mfa-verify-form">
              <div className="space-y-1.5">
                <Label htmlFor="totp-code">Enter the 6-digit code your app shows</Label>
                <Input id="totp-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" data-testid="mfa-code" />
              </div>
              <Button type="submit" disabled={verify.isPending} data-testid="mfa-verify">
                {verify.isPending ? "Verifying…" : "Verify and enable"}
              </Button>
            </form>
          </div>
        )}

        {status.data?.enabled && (
          <div className="space-y-3">
            <div className="text-sm">
              {status.data.recoveryCodesRemaining} recovery code(s) remaining.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={regenerate} disabled={regen.isPending} data-testid="mfa-regen">
                Generate new recovery codes
              </Button>
              <Button variant="destructive" onClick={() => setShowDisable(true)} data-testid="mfa-disable-open">
                Disable two-factor
              </Button>
            </div>
          </div>
        )}

        {recoveryCodes && (
          <div className="mt-5 rounded-md border bg-muted/30 p-4">
            <div className="text-sm font-medium mb-2">Save these recovery codes somewhere safe</div>
            <p className="text-xs text-muted-foreground mb-3">
              Each code can only be used once. They're shown here exactly one time — you won't see them again.
            </p>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm" data-testid="mfa-recovery-codes">
              {recoveryCodes.map((c) => (<div key={c} className="px-2 py-1 bg-background rounded">{c}</div>))}
            </div>
          </div>
        )}

        {showDisable && (
          <form onSubmit={submitDisable} className="mt-5 space-y-3 max-w-sm" data-testid="mfa-disable-form">
            <div className="space-y-1.5">
              <Label htmlFor="disable-pw">Confirm with your password</Label>
              <Input id="disable-pw" type="password" required value={disablePw} onChange={(e) => setDisablePw(e.target.value)} data-testid="mfa-disable-pw" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={disable.isPending}>Disable two-factor</Button>
              <Button type="button" variant="ghost" onClick={() => setShowDisable(false)}>Cancel</Button>
            </div>
          </form>
        )}
      </Card>

      {isAdmin && (
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Require MFA for everyone in your organization</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Members without an authenticator app will be required to enroll on their next login.
              </p>
            </div>
            <Switch checked={requireMfa} onCheckedChange={toggleOrgMfa} data-testid="org-require-mfa" />
          </div>
        </Card>
      )}
    </div>
  );
}

function SessionsTab() {
  const list = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const { toast } = useToast();

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-base font-semibold">Active sessions</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Devices currently signed in to your account.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={async () => {
            const r = await revokeOthers.mutateAsync();
            toast({ title: r.revoked > 0 ? `${r.revoked} other session(s) revoked` : "No other sessions to revoke" });
          }}
          disabled={revokeOthers.isPending}
          data-testid="revoke-others"
        >
          Sign out everywhere else
        </Button>
      </div>
      <div className="space-y-3" data-testid="sessions-list">
        {(list.data ?? []).map((s: SessionRow) => (
          <div key={s.id} className="flex items-start justify-between gap-4 p-3 border rounded-md" data-testid={`session-${s.id}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Monitor className="w-4 h-4 text-muted-foreground" />
                <span>{s.deviceLabel ?? "Unknown device"}</span>
                {s.current && <Badge variant="secondary">Current</Badge>}
                {s.mfaPassed && <Badge variant="outline">MFA</Badge>}
              </div>
              <div className="text-xs text-muted-foreground mt-1 space-x-3">
                <span>IP: <span className="font-mono">{s.ip ?? "—"}</span></span>
                <span>Last seen: {new Date(s.lastSeenAt).toLocaleString()}</span>
              </div>
              {s.userAgent && (
                <div className="text-[11px] text-muted-foreground/70 mt-1 truncate max-w-xl font-mono">{s.userAgent}</div>
              )}
            </div>
            {!s.current && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await revoke.mutateAsync(s.id);
                  toast({ title: "Session revoked" });
                }}
                data-testid={`revoke-${s.id}`}
              >
                Revoke
              </Button>
            )}
          </div>
        ))}
        {list.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        )}
      </div>
    </Card>
  );
}

function DangerTab() {
  const [, navigate] = useLocation();
  const del = useDeleteAccount();
  const logout = useLogout();
  const { toast } = useToast();
  const [confirmText, setConfirmText] = useState("");

  const submit = async () => {
    if (confirmText !== "DELETE") return;
    try {
      await del.mutateAsync();
      await logout.mutateAsync().catch(() => {});
      toast({ title: "Account marked for deletion" });
      navigate("/login");
    } catch (err) {
      toast({ title: "Could not delete account", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  };

  return (
    <Card className="p-6 border-destructive/40">
      <Separator className="hidden" />
      <div className="flex items-start gap-3 mb-4">
        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base font-semibold">Delete your account</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Marks your account for deletion and signs you out everywhere immediately. Your historical decisions and rule
            changes are kept for audit, but your profile is anonymised. Final removal happens on the org's data-retention
            schedule.
          </p>
        </div>
      </div>
      <div className="space-y-3 max-w-md" data-testid="delete-form">
        <Label>Type <span className="font-mono font-semibold">DELETE</span> to confirm</Label>
        <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} data-testid="delete-confirm" />
        <Button
          variant="destructive"
          disabled={confirmText !== "DELETE" || del.isPending}
          onClick={submit}
          data-testid="delete-submit"
        >
          <Trash2 className="w-4 h-4 mr-1.5" />
          {del.isPending ? "Deleting…" : "Delete my account"}
        </Button>
      </div>
    </Card>
  );
}

export function VerifyEmailBanner() {
  const me = useMe();
  const u = me.data?.user;
  const resend = useResendVerification();
  const { toast } = useToast();
  if (!u || u.emailVerifiedAt) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-8 py-2.5 text-sm flex items-center gap-3 text-amber-900 dark:text-amber-200">
      <Mail className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        Verify your email <span className="font-mono">{u.email}</span> to unlock password changes,
        email updates, MFA admin, and account deletion.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={async () => {
          try {
            await resend.mutateAsync();
            toast({ title: "Verification email sent" });
          } catch (err) {
            toast({
              title: "Could not resend",
              description: err instanceof Error ? err.message : "",
              variant: "destructive",
            });
          }
        }}
        data-testid="resend-verify"
      >
        Resend
      </Button>
    </div>
  );
}
