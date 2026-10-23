import { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { validateAuthJson } from "../../codex/auth.js";
import { encryptToken } from "../../utils/encryption.js";
import { authMiddleware, requireAuth } from "../auth-middleware.js";
import { sendError } from "../errors.js";
import { assertUnlocked, assertVisible } from "../feature-flags.js";
import { loadConfig } from "../../config.js";

const config = loadConfig();
type ImportBody = { content?: unknown; label?: unknown };

function safeCredential(c: { id: string; label: string; status: string; expiresAt: Date | null; lastUsedAt: Date | null; lastRefreshedAt: Date | null; createdAt: Date }) {
  const status = c.status === "active" && c.expiresAt && c.expiresAt <= new Date() ? "expired" : c.status;
  return { id: c.id, label: c.label, status, expires_at: c.expiresAt?.toISOString() ?? null, last_used_at: c.lastUsedAt?.toISOString() ?? null, last_refreshed_at: c.lastRefreshedAt?.toISOString() ?? null, created_at: c.createdAt.toISOString() };
}

export async function credentialRoutes(app: FastifyInstance) {
  app.post<{ Body: ImportBody }>("/api/codex/credentials/import", { preHandler: authMiddleware, bodyLimit: 300 * 1024 }, async (request, reply) => {
    if (!(await assertUnlocked("profiles", reply))) return;
    if (!(await assertVisible("profiles", reply))) return;
    const user = await requireAuth(request);
    const body = request.body ?? {};
    const fields: Record<string, string> = {};
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) fields.label = "Profile name is required.";
    else if (label.length > 64) fields.label = "Use 64 characters or fewer.";
    if (typeof body.content !== "string" || !body.content.trim()) fields.content = "Upload auth.json or paste its contents.";
    if (Object.keys(fields).length) return sendError(reply, 400, "Check the highlighted fields.", "validation", fields);

    let auth;
    try {
      auth = validateAuthJson(body.content as string);
    } catch (error) {
      return sendError(reply, 400, "Check the highlighted fields.", "validation", { content: error instanceof Error ? error.message : "Invalid auth.json" });
    }
    const duplicate = await prisma.codexCredential.findFirst({ where: { userId: user.id, label: { equals: label, mode: "insensitive" }, revokedAt: null } });
    if (duplicate) return sendError(reply, 409, "A profile with this name already exists.", "conflict", { label: "A profile with this name already exists." });
    const credential = await prisma.codexCredential.create({
      data: { userId: user.id, label, status: "active", accessToken: encryptToken(auth.access_token, config.tokenEncryptionKey), refreshToken: encryptToken(auth.refresh_token, config.tokenEncryptionKey), idToken: auth.id_token ? encryptToken(auth.id_token, config.tokenEncryptionKey) : null, expiresAt: auth.expires_at ? new Date(auth.expires_at * 1000) : null },
    });
    return reply.status(201).send(safeCredential(credential));
  });

  app.get("/api/codex/credentials", { preHandler: authMiddleware }, async (request) => {
    const user = await requireAuth(request);
    const rows = await prisma.codexCredential.findMany({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: "asc" } });
    return rows.map(safeCredential);
  });

  app.post<{ Params: { credentialId: string; action: "enable" | "disable" } }>("/api/codex/credentials/:credentialId/:action", { preHandler: authMiddleware }, async (request, reply) => {
    const user = await requireAuth(request);
    if (request.params.action !== "enable" && request.params.action !== "disable") return sendError(reply, 404, "Resource unavailable.", "not_found");
    const row = await prisma.codexCredential.findFirst({ where: { id: request.params.credentialId, userId: user.id, revokedAt: null } });
    if (!row) return sendError(reply, 404, "Credential not found", "not_found");
    if (request.params.action === "enable" && row.expiresAt && row.expiresAt <= new Date()) return sendError(reply, 409, "Expired credentials cannot be enabled", "conflict");
    const updated = await prisma.codexCredential.update({ where: { id: row.id }, data: { status: request.params.action === "disable" ? "disabled" : "active" } });
    return safeCredential(updated);
  });

  app.delete<{ Params: { credentialId: string } }>("/api/codex/credentials/:credentialId", { preHandler: authMiddleware }, async (request, reply) => {
    if (!(await assertUnlocked("profiles", reply))) return;
    if (!(await assertVisible("profiles", reply))) return;
    const user = await requireAuth(request);
    const result = await prisma.codexCredential.updateMany({ where: { id: request.params.credentialId, userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), status: "revoked" } });
    if (result.count === 0) return sendError(reply, 404, "Credential not found", "not_found");
    return { success: true };
  });
}
