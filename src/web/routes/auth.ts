import { FastifyInstance } from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { prisma } from "../../db/client.js";
import { loadConfig } from "../../config.js";
import { COOKIE, STATE_COOKIE, clearCookieHeader, cookieHeader, makeOAuthState, makeSession, newSessionId, readSession, verifyOAuthState } from "../auth-session.js";
import { clientIp, deviceLabel, sendError } from "../errors.js";

const config = loadConfig();
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const googleUserUrl = "https://openidconnect.googleapis.com/v1/userinfo";
const SESSION_TTL = 7 * 24 * 60 * 60;

export function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function currentSession(cookieHeaderValue: string | undefined) {
  const session = readSession(cookieValue(cookieHeaderValue, COOKIE), config.authSecret);
  if (!session) return null;
  return prisma.session.findUnique({ where: { id: session.sessionId } });
}

/** Cookie-authed mutations must carry the per-session CSRF token from /api/me. */
function csrfOk(request: { headers: Record<string, unknown> }, csrfToken: string): boolean {
  const header = request.headers["x-csrf-token"];
  return typeof header === "string" && header.length === csrfToken.length && timingSafeEqual(Buffer.from(header), Buffer.from(csrfToken));
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/api/auth/google/start", async (_request, reply) => {
    const state = makeOAuthState(config.authSecret);
    const params = new URLSearchParams({ client_id: config.googleClientId, redirect_uri: `${config.domain}/api/auth/google/callback`, response_type: "code", scope: "openid email profile", access_type: "offline", prompt: "select_account", state });
    return reply.header("Set-Cookie", cookieHeader(STATE_COOKIE, state, 600)).redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/auth/google/callback", async (request, reply) => {
    const stateCookie = cookieValue(request.headers.cookie, STATE_COOKIE);
    if (!verifyOAuthState(request.query.state, config.authSecret) || stateCookie !== request.query.state) return reply.redirect("/login?error=oauth_state");
    if (!request.query.code) return reply.redirect("/login?error=oauth_denied");

    try {
      const tokenResponse = await fetch(googleTokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: request.query.code, client_id: config.googleClientId, client_secret: config.googleClientSecret, redirect_uri: `${config.domain}/api/auth/google/callback`, grant_type: "authorization_code" }) });
      if (!tokenResponse.ok) throw new Error("Google token exchange failed");
      const token = await tokenResponse.json() as { access_token?: string };
      if (!token.access_token) throw new Error("Google access token missing");
      const profileResponse = await fetch(googleUserUrl, { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!profileResponse.ok) throw new Error("Google profile lookup failed");
      const profile = await profileResponse.json() as { sub?: string; email?: string; name?: string; picture?: string };
      if (!profile.sub || !profile.email) throw new Error("Google profile is incomplete");
      const user = await prisma.user.upsert({ where: { googleId: profile.sub }, create: { googleId: profile.sub, email: profile.email, name: profile.name, image: profile.picture }, update: { email: profile.email, name: profile.name, image: profile.picture } });
      const session = await prisma.session.create({
        data: {
          id: newSessionId(),
          userId: user.id,
          csrfToken: randomBytes(24).toString("base64url"),
          device: deviceLabel(request.headers["user-agent"]),
          ip: clientIp(request.headers),
        },
      });
      return reply.header("Set-Cookie", [cookieHeader(COOKIE, makeSession(session.id, user.id, config.authSecret), SESSION_TTL, config.cookieDomain), clearCookieHeader(STATE_COOKIE)]).redirect("/app/playground");
    } catch (error) {
      request.log.error({ error: error instanceof Error ? error.message : "oauth error" }, "Google OAuth callback failed");
      return reply.redirect("/login?error=oauth_failed");
    }
  });

  app.get("/api/me", async (request, reply) => {
    const session = await currentSession(request.headers.cookie);
    if (!session) return sendError(reply, 401, "Not authenticated", "unauthenticated");
    const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, email: true, name: true, image: true } });
    if (!user) return sendError(reply, 401, "Not authenticated", "unauthenticated");
    return { user: { id: user.id, email: user.email, name: user.name ?? user.email, avatar_url: user.image ?? undefined }, organization: { id: "default", name: "Any Endpoint" }, role: "owner", csrf_token: session.csrfToken, environment: process.env.NODE_ENV ?? "production" };
  });

  app.get("/api/auth/sessions", async (request, reply) => {
    const current = await currentSession(request.headers.cookie);
    if (!current) return sendError(reply, 401, "Not authenticated", "unauthenticated");
    const sessions = await prisma.session.findMany({ where: { userId: current.userId }, orderBy: { lastSeenAt: "desc" } });
    return sessions.map((s) => ({ id: s.id, device: s.device, ip: s.ip, last_seen: s.lastSeenAt.toISOString(), current: s.id === current.id }));
  });

  app.post<{ Params: { sessionId: string } }>("/api/auth/sessions/:sessionId/revoke", async (request, reply) => {
    const current = await currentSession(request.headers.cookie);
    if (!current) return sendError(reply, 401, "Not authenticated", "unauthenticated");
    if (!csrfOk(request, current.csrfToken)) return sendError(reply, 403, "Missing or invalid CSRF token", "forbidden");
    if (request.params.sessionId === current.id) return sendError(reply, 400, "Use log out to end this session", "validation");
    const result = await prisma.session.deleteMany({ where: { id: request.params.sessionId, userId: current.userId } });
    if (result.count === 0) return sendError(reply, 404, "Session not found", "not_found");
    return { ok: true };
  });

  app.post("/api/auth/sessions/revoke_all", async (request, reply) => {
    const current = await currentSession(request.headers.cookie);
    if (!current) return sendError(reply, 401, "Not authenticated", "unauthenticated");
    if (!csrfOk(request, current.csrfToken)) return sendError(reply, 403, "Missing or invalid CSRF token", "forbidden");
    await prisma.session.deleteMany({ where: { userId: current.userId } });
    return reply.header("Set-Cookie", clearCookieHeader(COOKIE)).send({ ok: true });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const current = await currentSession(request.headers.cookie);
    if (current) await prisma.session.deleteMany({ where: { id: current.id } });
    return reply.header("Set-Cookie", clearCookieHeader(COOKIE)).send({ ok: true });
  });
}
