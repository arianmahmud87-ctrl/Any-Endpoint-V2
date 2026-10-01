import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE = "myproxy_session";
const STATE_COOKIE = "myproxy_oauth_state";
const MAX_AGE = 7 * 24 * 60 * 60;

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function makeSession(sessionId: string, userId: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ sid: sessionId, userId, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readSession(value: string | undefined, secret: string): { sessionId: string; userId: string } | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sid?: string; userId?: string; exp?: number };
    return parsed.sid && parsed.userId && parsed.exp && parsed.exp > Math.floor(Date.now() / 1000) ? { sessionId: parsed.sid, userId: parsed.userId } : null;
  } catch {
    return null;
  }
}

export function newSessionId(): string {
  return randomBytes(24).toString("base64url");
}

export function makeOAuthState(secret: string): string {
  const nonce = randomBytes(24).toString("base64url");
  return `${nonce}.${sign(nonce, secret)}`;
}

export function verifyOAuthState(state: string | undefined, secret: string): boolean {
  if (!state) return false;
  const [nonce, signature] = state.split(".");
  if (!nonce || !signature) return false;
  const expected = sign(nonce, secret);
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function cookieHeader(name: string, value: string, maxAge: number, domain?: string): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax; Secure${domain ? `; Domain=${domain}` : ""}`;
}

export function clearCookieHeader(name: string): string {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`;
}

export { COOKIE, STATE_COOKIE, MAX_AGE };
