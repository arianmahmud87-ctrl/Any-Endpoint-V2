import { FastifyRequest } from "fastify";
import { prisma } from "../db/client.js";
import { validateAndHashApiKey } from "../utils/api-key.js";
import { decryptToken } from "../utils/encryption.js";

export interface ProxyAuthResult { valid: true; userId: string; userEmail: string; accessToken: string; accessTokens: string[]; expiresAt: Date | null; intelligentSwitcher: boolean; keyPrefix: string; profileLabel: string | null; }
export interface ProxyAuthError { valid: false; error: string; statusCode: number; }

export async function authenticateProxyRequest(request: FastifyRequest, apiKeyHashSecret: string, tokenEncryptionKey: string): Promise<ProxyAuthResult | ProxyAuthError> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return { valid: false, error: "Missing or invalid Authorization header", statusCode: 401 };
  const plaintextKey = authHeader.slice(7);
  const keyHash = validateAndHashApiKey(plaintextKey, apiKeyHashSecret);
  if (!keyHash) return { valid: false, error: "Invalid API key format", statusCode: 401 };
  const apiKeyRecord = await prisma.apiKey.findUnique({ where: { keyHash }, include: { user: { select: { id: true, email: true, intelligentSwitcher: true } } } });
  if (!apiKeyRecord || apiKeyRecord.revokedAt) return { valid: false, error: "Invalid API key", statusCode: 401 };
  const keyPrefix = plaintextKey.slice(0, 16);

  const now = new Date();
  const credentials = await prisma.codexCredential.findMany({ where: { userId: apiKeyRecord.userId, revokedAt: null, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: [{ lastUsedAt: "asc" }, { createdAt: "asc" }] });
  const accessTokens: string[] = [];
  let selectedCredential: { id: string; label: string; lastUsedAt: Date | null } | null = null;
  for (const credential of credentials) {
    try {
      accessTokens.push(decryptToken(credential.accessToken, tokenEncryptionKey));
      selectedCredential ??= { id: credential.id, label: credential.label, lastUsedAt: credential.lastUsedAt };
    } catch (error) {
      request.log.error({ error: error instanceof Error ? error.message : "unknown" }, "Failed to decrypt Codex credential");
    }
  }

  let profileLabel: string | null = selectedCredential?.label ?? null;
  if (!accessTokens.length) {
    const legacy = await prisma.codexToken.findUnique({ where: { userId: apiKeyRecord.userId } });
    if (!legacy || legacy.expiresAt <= now) return { valid: false, error: "No active Codex connection found", statusCode: 403 };
    try { accessTokens.push(decryptToken(legacy.accessToken, tokenEncryptionKey)); } catch { return { valid: false, error: "Failed to decrypt Codex access token", statusCode: 500 }; }
    profileLabel = "Device-code connection";
  }

  // Throttled last-used writes: at most one UPDATE per minute per record, so a
  // burst of requests doesn't double write QPS on the hot tables. Ordering and
  // display tolerate 60s of staleness, mirroring the session heartbeat.
  const usedAt = new Date();
  const stale = (d: Date | null) => !d || usedAt.getTime() - d.getTime() > 60_000;
  const writes: Promise<unknown>[] = [];
  if (stale(apiKeyRecord.lastUsedAt)) writes.push(prisma.apiKey.update({ where: { id: apiKeyRecord.id }, data: { lastUsedAt: usedAt } }));
  if (selectedCredential && stale(selectedCredential.lastUsedAt)) writes.push(prisma.codexCredential.update({ where: { id: selectedCredential.id }, data: { lastUsedAt: usedAt } }));
  if (writes.length) await Promise.all(writes);
  return { valid: true, userId: apiKeyRecord.user.id, userEmail: apiKeyRecord.user.email, accessToken: accessTokens[0], accessTokens, expiresAt: credentials[0]?.expiresAt ?? null, intelligentSwitcher: apiKeyRecord.user.intelligentSwitcher, keyPrefix, profileLabel };
}
