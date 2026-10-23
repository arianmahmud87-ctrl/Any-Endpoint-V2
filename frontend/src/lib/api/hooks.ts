import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "./client";
import type { AccountKey, AdminUser, CodexCredential, FeatureFlag, FeatureFlags, Me, ModelsResponse, Profile, Session, Summary, TokenTotals, UsageRow, UserSettings } from "./types";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), retry: false, staleTime: 60000 });
export const useSummary = () => useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/api/operations/summary") });
export const useProfiles = () => useQuery({ queryKey: ["profiles"], queryFn: () => api<Profile[]>("/api/profiles") });
export const useProfile = (id: string) => useQuery({ queryKey: ["profiles", id], queryFn: () => api<Profile>(`/api/profiles/${id}`) });
export const useAccountKey = () => useQuery({ queryKey: ["account-key"], queryFn: () => api<AccountKey>("/api/account/key") });
export const useUsage = (limit = 100) => useQuery({ queryKey: ["usage", limit], queryFn: () => api<UsageRow[]>(`/api/usage?limit=${limit}`) });
export const useSessions = () => useQuery({ queryKey: ["sessions"], queryFn: () => api<Session[]>("/api/auth/sessions") });
export const useCodexCredentials = () => useQuery({ queryKey: ["codex"], queryFn: () => api<CodexCredential[]>("/api/codex/credentials") });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api<UserSettings>("/api/user/settings") });
export const useModels = () => useQuery({ queryKey: ["models"], queryFn: () => api<ModelsResponse>("/api/models"), staleTime: 60000 });
export const useTokenTotals = () => useQuery({ queryKey: ["tokens"], queryFn: () => api<TokenTotals>("/api/usage/tokens") });
export const useFlags = () => useQuery({ queryKey: ["flags"], queryFn: () => api<FeatureFlags>("/api/flags"), staleTime: 30000 });

// Admin
export const useAdminUsers = () => useQuery({ queryKey: ["admin", "users"], queryFn: () => api<AdminUser[]>("/api/admin/users") });
export const useAdminFlags = () => useQuery({ queryKey: ["admin", "flags"], queryFn: () => api<FeatureFlag[]>("/api/admin/flags") });
export const useSetFlag = () => useAction<{ key: string; locked?: boolean; hidden?: boolean }>((v) => `/api/admin/flags/${v.key}`, [["admin", "flags"], ["flags"]], { method: "PUT", body: (v) => ({ ...(v.locked !== undefined ? { locked: v.locked } : {}), ...(v.hidden !== undefined ? { hidden: v.hidden } : {}) }) });
export const useRevokeAdminSession = () => useAction<string>((id) => `/api/admin/sessions/${id}`, [["admin", "users"]], { method: "DELETE", success: "Session revoked" });

/** Mutation wrapper: POST, invalidate related keys, toast on success/error. */
export function useAction<TVars, TRes = unknown>(
  toPath: (v: TVars) => string,
  invalidate: QueryKey[],
  opts: { method?: string; body?: (v: TVars) => unknown; success?: string } = {},
) {
  const qc = useQueryClient();
  const method = opts.method ?? "POST";
  return useMutation({
    mutationFn: (v: TVars) => api<TRes>(toPath(v), { method, body: method === "DELETE" ? undefined : (opts.body?.(v) ?? {}) }),
    onSuccess: () => {
      invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (opts.success) toast(opts.success);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
  });
}
