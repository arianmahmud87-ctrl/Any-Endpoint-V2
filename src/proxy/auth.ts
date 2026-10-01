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
  let selectedCredential: { id: string; label: string } | null = null;
  for (const credential of credentials) {
    try {
      accessTokens.push(decryptToken(credential.accessToken, tokenEncryptionKey));
      selectedCredential ??= { id: credential.id, label: credential.label };
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

  const usedAt = new Date();
  await Promise.all([
    prisma.apiKey.update({ where: { id: apiKeyRecord.id }, data: { lastUsedAt: usedAt } }),
    selectedCredential ? prisma.codexCredential.update({ where: { id: selectedCredential.id }, data: { lastUsedAt: usedAt } }) : Promise.resolve(),
  ]);
  return { valid: true, userId: apiKeyRecord.user.id, userEmail: apiKeyRecord.user.email, accessToken: accessTokens[0], accessTokens, expiresAt: credentials[0]?.expiresAt ?? null, intelligentSwitcher: apiKeyRecord.user.intelligentSwitcher, keyPrefix, profileLabel };
}
