import { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { authMiddleware, requireAdmin } from "../auth-middleware.js";
import { sendError } from "../errors.js";
import { FEATURE_KEYS, FeatureKey, hiddenKeys, invalidateFeatureFlagCache, lockedKeys } from "../feature-flags.js";

/** Admin-only user/session/flag management, plus the public locked/hidden-flag list. */
export async function adminRoutes(app: FastifyInstance) {
  // Public to any authenticated user: which features are currently locked or hidden.
  app.get("/api/flags", { preHandler: authMiddleware }, async () => {
    return { locked: await lockedKeys(), hidden: await hiddenKeys() };
  });

  app.get("/api/admin/users", { preHandler: [authMiddleware, requireAdmin] }, async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        createdAt: true,
        sessions: {
          orderBy: { lastSeenAt: "desc" },
          select: { id: true, device: true, ip: true, lastSeenAt: true, createdAt: true },
        },
        _count: { select: { apiKeys: true, codexCredentials: true, usageLogs: true } },
      },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      created_at: user.createdAt.toISOString(),
      sessions: user.sessions.map((session) => ({
        id: session.id,
        device: session.device,
        ip: session.ip,
        last_seen_at: session.lastSeenAt.toISOString(),
        created_at: session.createdAt.toISOString(),
      })),
      counts: {
        api_keys: user._count.apiKeys,
        credentials: user._count.codexCredentials,
        usage_logs: user._count.usageLogs,
      },
    }));
  });

  app.get("/api/admin/flags", { preHandler: [authMiddleware, requireAdmin] }, async () => {
    const rows = await prisma.featureFlag.findMany();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return FEATURE_KEYS.map((key) => ({
      key,
      locked: byKey.get(key)?.locked ?? false,
      hidden: byKey.get(key)?.hidden ?? false,
      updated_at: byKey.get(key)?.updatedAt.toISOString() ?? null,
    }));
  });

  app.put<{ Params: { key: string }; Body: { locked?: unknown; hidden?: unknown } }>("/api/admin/flags/:key", { preHandler: [authMiddleware, requireAdmin] }, async (request, reply) => {
    const key = request.params.key as FeatureKey;
    if (!(FEATURE_KEYS as readonly string[]).includes(key)) {
      return sendError(reply, 400, `Unknown feature flag. Allowed: ${FEATURE_KEYS.join(", ")}`, "validation");
    }
    const { locked, hidden } = request.body ?? {};
    if (typeof locked !== "boolean" && typeof hidden !== "boolean") {
      return sendError(reply, 400, "Body must include locked: boolean and/or hidden: boolean", "validation");
    }
    const flag = await prisma.featureFlag.upsert({
      where: { key },
      create: { key, ...(typeof locked === "boolean" ? { locked } : {}), ...(typeof hidden === "boolean" ? { hidden } : {}) },
      update: { ...(typeof locked === "boolean" ? { locked } : {}), ...(typeof hidden === "boolean" ? { hidden } : {}) },
    });
    invalidateFeatureFlagCache();
    return { key: flag.key, locked: flag.locked, hidden: flag.hidden, updated_at: flag.updatedAt.toISOString() };
  });

  app.delete<{ Params: { id: string } }>("/api/admin/sessions/:id", { preHandler: [authMiddleware, requireAdmin] }, async (request, reply) => {
    const result = await prisma.session.deleteMany({ where: { id: request.params.id } });
    if (result.count === 0) return sendError(reply, 404, "Session not found", "not_found");
    return { ok: true };
  });
}
