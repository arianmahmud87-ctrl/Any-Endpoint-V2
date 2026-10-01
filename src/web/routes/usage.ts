import { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { authMiddleware, requireAuth } from "../auth-middleware.js";

export async function usageRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>("/api/usage", { preHandler: authMiddleware }, async (request) => {
    const user = await requireAuth(request);
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
    const rows = await prisma.usageLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      route: r.route,
      model: r.model,
      status_code: r.statusCode,
      latency_ms: r.latencyMs,
      created_at: r.createdAt.toISOString(),
      profile_label: r.profileLabel ?? "—",
      key_prefix: r.keyPrefix,
    }));
  });

  app.get("/api/operations/summary", { preHandler: authMiddleware }, async (request) => {
    const user = await requireAuth(request);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [profiles, activeKeys, requests24h, failures24h] = await Promise.all([
      prisma.codexCredential.count({ where: { userId: user.id, revokedAt: null } }),
      prisma.apiKey.count({ where: { userId: user.id, revokedAt: null } }),
      prisma.usageLog.count({ where: { userId: user.id, createdAt: { gte: since } } }),
      prisma.usageLog.count({ where: { userId: user.id, createdAt: { gte: since }, statusCode: { gte: 400 } } }),
    ]);
    return {
      profiles,
      active_keys: activeKeys,
      workers_online: 0,
      workers_stale: 0,
      requests_24h: requests24h,
      failures_24h: failures24h,
    };
  });
}
