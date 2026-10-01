/**
 * Codex Authentication Module
 * 
 * Handles Codex token management for multiple users.
 * Users authenticate via `codex login` locally and paste auth.json content.
 */

import { homedir } from "os";
import { join } from "path";

const CODEX_BACKEND_URL = "https://chatgpt.com/backend-api/codex";

export interface CodexAuthTokens {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_at?: number;
  mode: "chatgpt" | "api";
}

/** Decode the exp claim of a JWT without verifying it (server-side expiry hint only). */
function jwtExpiry(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validate auth.json content.
 * Accepts the real Codex CLI format (tokens nested under "tokens", optional
 * OPENAI_API_KEY / last_refresh siblings) as well as the legacy flat shape.
 */
export function validateAuthJson(content: string): CodexAuthTokens {
  if (typeof content !== "string" || content.length === 0 || content.length > 256 * 1024) {
    throw new Error("auth.json must be a non-empty file smaller than 256 KB");
  }

  let auth: unknown;
  try {
    auth = JSON.parse(content);
  } catch {
    throw new Error("Invalid JSON format");
  }

  if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
    throw new Error("auth.json must contain a JSON object");
  }

  const value = auth as Record<string, unknown>;
  const nested = value.tokens && typeof value.tokens === "object" && !Array.isArray(value.tokens)
    ? (value.tokens as Record<string, unknown>)
    : null;

  // Real Codex CLI files keep tokens under "tokens"; fall back to top level.
  const source = nested ?? value;
  const accessToken = source.access_token;
  const refreshToken = source.refresh_token;
  const idToken = source.id_token;

  if (typeof accessToken !== "string" || accessToken.length < 20) {
    throw new Error("Missing or invalid tokens.access_token in auth.json");
  }
  if (typeof refreshToken !== "string" || refreshToken.length < 10) {
    throw new Error("Missing or invalid tokens.refresh_token in auth.json");
  }
  if (idToken !== undefined && typeof idToken !== "string") {
    throw new Error("tokens.id_token must be a string when provided");
  }
  if (value.expires_at !== undefined && (typeof value.expires_at !== "number" || !Number.isFinite(value.expires_at))) {
    throw new Error("expires_at must be a Unix timestamp when provided");
  }

  const expiresAt = (value.expires_at as number | undefined) ?? jwtExpiry(accessToken);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: idToken as string | undefined,
    expires_at: expiresAt,
    mode: "chatgpt",
  };
}

/**
 * Get the Codex backend URL for API calls
 */
export function getCodexBackendUrl(): string {
  return process.env.CODEX_BACKEND_URL || CODEX_BACKEND_URL;
}

/**
 * Get local auth.json path
 */
export function getAuthFilePath(): string {
  return join(homedir(), ".codex", "auth.json");
}

/**
 * Parse auth.json content for display
 */
export function parseAuthForDisplay(content: string): {
  valid: boolean;
  mode?: string;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiresAt?: string;
  error?: string;
} {
  try {
    const parsed = validateAuthJson(content);

    return {
      valid: true,
      mode: parsed.mode,
      hasAccessToken: true,
      hasRefreshToken: true,
      expiresAt: parsed.expires_at ? new Date(parsed.expires_at * 1000).toISOString() : undefined,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message,
      hasAccessToken: false,
      hasRefreshToken: false,
    };
  }
}
