import { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { authMiddleware, requireAuth } from "../auth-middleware.js";
import { sendError } from "../errors.js";

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/api/user/settings", { preHandler: authMiddleware }, async (request) => {
    const user = await requireAuth(request);
    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { intelligentSwitcher: true, preferredModel: true, preferredEffort: true } });
    return { intelligent_switcher: row?.intelligentSwitcher ?? true, preferred_model: row?.preferredModel ?? null, preferred_effort: row?.preferredEffort ?? null };
  });

  app.patch<{ Body: { enabled?: unknown } }>("/api/user/settings/intelligent-switcher", { preHandler: authMiddleware }, async (request, reply) => {
    const user = await requireAuth(request);
    if (typeof request.body?.enabled !== "boolean") return sendError(reply, 400, "Choose on or off.", "validation", { enabled: "Required." });
    const row = await prisma.user.update({ where: { id: user.id }, data: { intelligentSwitcher: request.body.enabled }, select: { intelligentSwitcher: true } });
    return { intelligent_switcher: row.intelligentSwitcher };
  });

  app.patch<{ Body: { model?: unknown; effort?: unknown } }>("/api/user/settings/model", { preHandler: authMiddleware }, async (request, reply) => {
    const user = await requireAuth(request);
    const { model, effort } = request.body ?? {};
    const fields: Record<string, string> = {};
    if (model !== undefined && model !== null && (typeof model !== "string" || model.length > 100)) fields.model = "Unknown model.";
    if (effort !== undefined && effort !== null && (typeof effort !== "string" || effort.length > 50)) fields.effort = "Unknown reasoning level.";
    if (Object.keys(fields).length) return sendError(reply, 400, "Check the highlighted fields.", "validation", fields);
    const row = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(model !== undefined ? { preferredModel: model as string | null } : {}),
        ...(effort !== undefined ? { preferredEffort: effort as string | null } : {}),
      },
      select: { preferredModel: true, preferredEffort: true },
    });
    return { preferred_model: row.preferredModel, preferred_effort: row.preferredEffort };
  });
}
