import { FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { prisma } from "../db/client.js";
import { loadConfig } from "../config.js";
import { COOKIE, readSession } from "./auth-session.js";
import { sendError } from "./errors.js";

const config = loadConfig();

declare module "fastify" {
  interface FastifyRequest { userId?: string; userEmail?: string; sessionId?: string; }
}

export interface SessionUser { id: string; email: string; name: string | null; }

function getCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function csrfMatches(request: FastifyRequest, csrfToken: string): boolean {
  const header = request.headers["x-csrf-token"];
  return typeof header === "string" && header.length === csrfToken.length && timingSafeEqual(Buffer.from(header), Buffer.from(csrfToken));
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookie = readSession(getCookie(request.headers.cookie, COOKIE), config.authSecret);
  if (!cookie) {
    sendError(reply, 401, "Not authenticated", "unauthenticated");
    return;
  }
  const session = await prisma.session.findUnique({ where: { id: cookie.sessionId } });
  if (!session) {
    sendError(reply, 401, "Session expired or revoked", "unauthenticated");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD" && !csrfMatches(request, session.csrfToken)) {
    sendError(reply, 403, "Missing or invalid CSRF token", "forbidden");
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, email: true, name: true } });
  if (!user) {
    sendError(reply, 401, "Not authenticated", "unauthenticated");
    return;
  }
  // Throttled heartbeat: refresh lastSeenAt at most once a minute.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch((err) => request.log.error({ err }, "Failed to touch session"));
  }
  request.userId = user.id;
  request.userEmail = user.email;
  request.sessionId = session.id;
}

export async function requireAuth(request: FastifyRequest): Promise<SessionUser> {
  if (!request.userId || !request.userEmail) throw new Error("Not authenticated");
  return { id: request.userId, email: request.userEmail, name: null };
}
