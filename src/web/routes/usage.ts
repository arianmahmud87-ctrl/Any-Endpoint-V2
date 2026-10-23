import { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { authMiddleware, requireAuth } from "../auth-middleware.js";
import { assertUnlocked, assertVisible } from "../feature-flags.js";

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
      prompt_tokens: r.promptTokens,
      completion_tokens: r.completionTokens,
    }));
  });

  app.get("/api/usage/tokens", { preHandler: authMiddleware }, async (request, reply) => {
    const user = await requireAuth(request);
    if (!(await assertUnlocked("tokens", reply))) return;
    if (!(await assertVisible("tokens", reply))) return;
    const [total, perDay, perModel] = await Promise.all([
      prisma.usageLog.aggregate({
        where: { userId: user.id },
        _sum: { promptTokens: true, completionTokens: true },
      }),
      prisma.$queryRaw<{ date: string; input: bigint; output: bigint }[]>`
        SELECT to_char("createdAt"::date, 'YYYY-MM-DD') AS date,
               COALESCE(SUM("promptTokens"), 0)::bigint AS input,
               COALESCE(SUM("completionTokens"), 0)::bigint AS output
        FROM "UsageLog"
        WHERE "userId" = ${user.id}
        GROUP BY "createdAt"::date
        ORDER BY "createdAt"::date ASC
      `,
      prisma.usageLog.groupBy({
        by: ["model"],
        where: { userId: user.id },
        _sum: { promptTokens: true, completionTokens: true },
      }),
    ]);
    return {
      total: { input: total._sum.promptTokens ?? 0, output: total._sum.completionTokens ?? 0 },
      perDay: perDay.map((row) => ({ date: row.date, input: Number(row.input), output: Number(row.output) })),
      perModel: perModel.map((row) => ({ model: row.model, input: row._sum.promptTokens ?? 0, output: row._sum.completionTokens ?? 0 })),
    };
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
