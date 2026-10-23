export type Provider = "codex" | "claude";
export type Role = "owner" | "admin" | "member";
export type WorkerState = "online" | "stale" | "offline";

export interface Me {
  user: { id: string; email: string; name: string; avatar_url?: string };
  organization: { id: string; name: string };
  role: Role;
  csrf_token: string;
  environment: string;
}

export interface Profile {
  id: string;
  label: string;
  provider: Provider;
  allowed_models: string[];
  status: "active" | "pending" | "disabled";
  worker_status: WorkerState;
  last_heartbeat: string | null;
  secret_ref_status: "bound" | "missing";
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  type: "codex";
  grant_count: number;
  expires_at: string | null;
  last_used_at: string | null;
  status: "active" | "revoked";
}

export interface AccountKey {
  id: string;
  raw_key: string;
  created_at: string;
}

export interface UsageRow {
  id: string;
  route: string;
  model: string;
  status_code: number;
  latency_ms: number;
  created_at: string;
  profile_label: string;
  key_prefix: string | null;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface TokenTotals {
  total: { input: number; output: number };
  perDay: { date: string; input: number; output: number }[];
  perModel: { model: string; input: number; output: number }[];
}

export type FeatureKey = "playground" | "api_keys" | "profiles" | "proxy_access" | "intelligent_switcher" | "tokens";

export interface FeatureFlags {
  locked: FeatureKey[];
  hidden: FeatureKey[];
}

export interface FeatureFlag {
  key: FeatureKey;
  locked: boolean;
  hidden: boolean;
  updated_at: string | null;
}

export interface AdminSession {
  id: string;
  device: string;
  ip: string;
  last_seen_at: string;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: Role;
  created_at: string;
  sessions: AdminSession[];
  counts: { api_keys: number; credentials: number; usage_logs: number };
}

export interface AuditEvent {
  id: string;
  type: string;
  category: "auth" | "profile" | "key" | "worker" | "playground" | "denied";
  actor: string;
  target: string;
  created_at: string;
}

export interface Worker {
  agent_id: string;
  profile_id: string;
  profile_label: string;
  provider: Provider;
  state: WorkerState;
  last_heartbeat: string | null;
  mtls: "verified" | "unverified";
  child_ready: boolean;
}

export interface Summary {
  profiles: number;
  active_keys: number;
  workers_online: number;
  workers_stale: number;
  requests_24h: number;
  failures_24h: number;
}

/** Safe Codex credential metadata. Token values are never included. */
export interface CodexCredential {
  id: string;
  label: string;
  status: "active" | "disabled" | "expired" | "revoked";
  expires_at: string | null;
  last_used_at: string | null;
  last_refreshed_at: string | null;
  created_at: string;
}

export interface UserSettings {
  intelligent_switcher: boolean;
  preferred_model: string | null;
  preferred_model_label: string | null;
  preferred_effort: string | null;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface ModelsResponse {
  models: ModelOption[];
  reasoning_efforts: ModelOption[];
  source: "upstream" | "fallback";
  fetched_at: string;
}

export interface Session {
  id: string;
  device: string;
  ip: string;
  last_seen: string;
  current: boolean;
}

export interface PlaygroundRun {
  id: string;
  output: string;
  model: string;
  latency_ms: number;
}

export class ApiError extends Error {
  status: number;
  type: string;
  retryAfter?: number;
  fields?: Record<string, string>;
  constructor(status: number, message: string, type = "error", retryAfter?: number, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.type = type;
    this.retryAfter = retryAfter;
    this.fields = fields;
  }
}
