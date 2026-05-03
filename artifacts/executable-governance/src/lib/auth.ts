/**
 * Frontend auth + account API.
 *
 * The backend's auth/account/mfa/sessions endpoints aren't part of the
 * orval-generated client — they were added after Task #9 to avoid an
 * intrusive openapi-spec churn while the surface stabilises. This thin
 * wrapper preserves the same conventions the rest of the SPA relies on
 * (relative `/api` URLs, JSON bodies, automatic CSRF echo via
 * customFetch, react-query for cache + invalidation).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "reader" | "editor" | "approver" | "admin";
  organizationId: number;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  emailVerifiedAt: string | null;
}

export interface MeResponse {
  user: AuthUser;
  mfaEnabled: boolean;
  sessionId: number;
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, data: any) {
    super(typeof data?.message === "string" ? data.message : `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }
}

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const method = (init.method ?? "GET").toUpperCase();
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCsrfCookie();
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  let data: any = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) data = await res.json().catch(() => null);
  else data = (await res.text().catch(() => "")) || null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export function useMe() {
  return useQuery<MeResponse | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        return await api<MeResponse>("/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { email: string; password: string; totpCode?: string; recoveryCode?: string }) =>
      api<{ user: AuthUser; mfaRequired: boolean }>("/auth/login", { method: "POST", body: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<AuthUser, "name" | "timezone" | "locale" | "avatarUrl">>) =>
      api<{ user: AuthUser }>("/account/profile", { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export function useRequestEmailChange() {
  return useMutation({
    mutationFn: (vars: { newEmail: string }) =>
      api<{ ok: true }>("/account/email-change-request", { method: "POST", body: vars }),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { currentPassword: string; newPassword: string }) =>
      api<{ ok: true; otherSessionsRevoked: number }>("/account/password", {
        method: "POST",
        body: vars,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account", "sessions"] }),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (vars: { email: string }) =>
      api<{ ok: true }>("/auth/forgot-password", { method: "POST", body: vars }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (vars: { token: string; newPassword: string }) =>
      api<{ ok: true }>("/auth/reset-password", { method: "POST", body: vars }),
  });
}

export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { token: string }) =>
      api<{ ok: true }>("/auth/verify-email", { method: "POST", body: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export interface MfaStatus {
  enrolled: boolean;
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}
export function useMfaStatus() {
  return useQuery<MfaStatus>({
    queryKey: ["account", "mfa"],
    queryFn: () => api<MfaStatus>("/account/mfa/status"),
  });
}
export function useMfaEnrollStart() {
  return useMutation({
    mutationFn: () =>
      api<{ otpauthUrl: string; qrDataUrl: string }>("/account/mfa/enroll-start", { method: "POST" }),
  });
}
export function useMfaEnrollVerify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { code: string }) =>
      api<{ recoveryCodes: string[] }>("/account/mfa/enroll-verify", { method: "POST", body: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account", "mfa"] });
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}
export function useMfaDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { password: string }) =>
      api<{ ok: true }>("/account/mfa/disable", { method: "POST", body: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account", "mfa"] });
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}
export function useRegenerateRecoveryCodes() {
  return useMutation({
    mutationFn: () =>
      api<{ recoveryCodes: string[] }>("/account/mfa/recovery-codes/regenerate", { method: "POST" }),
  });
}

export interface SessionRow {
  id: number;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  mfaPassed: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}
export function useSessions() {
  return useQuery<SessionRow[]>({
    queryKey: ["account", "sessions"],
    queryFn: () => api<SessionRow[]>("/account/sessions"),
  });
}
export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ ok: true }>(`/account/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account", "sessions"] }),
  });
}
export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ revoked: number }>("/account/sessions/revoke-others", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account", "sessions"] }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/account", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export function useUpdateOrgSecurity() {
  return useMutation({
    mutationFn: (vars: { id: number; requireMfa: boolean }) =>
      api<{ requireMfa: boolean }>(`/organizations/${vars.id}/security`, {
        method: "PATCH",
        body: { requireMfa: vars.requireMfa },
      }),
  });
}
