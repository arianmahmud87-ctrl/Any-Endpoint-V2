import { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { authMiddleware, requireAuth } from "../auth-middleware.js";
import { sendError } from "../errors.js";
import { loadConfig } from "../../config.js";
import { encryptToken, decryptToken } from "../../utils/encryption.js";
import {
  generateApiKey,
  validateAndHashApiKey,
} from "../../utils/api-key.js";

const config = loadConfig();

function accountKeyResponse(key: { id: string; keyEncrypted: string | null; createdAt: Date }) {
  return {
    id: key.id,
    raw_key: key.keyEncrypted ? decryptToken(key.keyEncrypted, config.tokenEncryptionKey) : null,
    created_at: key.createdAt.toISOString(),
  };
}

async function issueAccountKey(userId: string) {
  const { plaintextKey, keyHash } = generateApiKey(config.apiKeyHashSecret);
  const key = await prisma.apiKey.create({
    data: {
      userId,
      name: "Default key",
      keyHash,
      keyEncrypted: encryptToken(plaintextKey, config.tokenEncryptionKey),
    },
  });
  return { key, plaintextKey };
}

/**
 * MyProxy API key management routes.
 * Users can create, list, and revoke their proxy API keys.
 */
export async function apiKeyRoutes(app: FastifyInstance) {
  // The single account key shown on the Keys page. Created on first use.
  app.get("/api/account/key", { preHandler: authMiddleware }, async (request) => {
    const user = await requireAuth(request);
    const existing = await prisma.apiKey.findFirst({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.keyEncrypted) return accountKeyResponse(existing);
    // Legacy keys stored hash-only can never be revealed; replace them.
    if (existing) {
      await prisma.apiKey.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    }
    const { key } = await issueAccountKey(user.id);
    return accountKeyResponse(key);
  });

  // Regenerate: the previous key is revoked atomically, then a new one is issued.
  app.post("/api/account/key/regenerate", { preHandler: authMiddleware }, async (request) => {
    const user = await requireAuth(request);
    const [, key] = await prisma.$transaction([
      prisma.apiKey.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.apiKey.create({
        data: (() => {
          const { plaintextKey, keyHash } = generateApiKey(config.apiKeyHashSecret);
          return { userId: user.id, name: "Default key", keyHash, keyEncrypted: encryptToken(plaintextKey, config.tokenEncryptionKey) };
        })(),
      }),
    ]);
    return accountKeyResponse(key);
  });

  // List user's API keys (never expose the plaintext key)
  app.get("/api/keys", { preHandler: authMiddleware }, async (request, reply) => {
    const user = await requireAuth(request);

    const keys = await prisma.apiKey.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return { keys };
  });

  // Create a new API key
  app.post<{
    Body: { name: string };
  }>("/api/keys", { preHandler: authMiddleware }, async (request, reply) => {
    const user = await requireAuth(request);

    const { name } = request.body;

    if (!name || name.trim().length === 0) {
      return sendError(reply, 400, "Name is required", "validation");
    }

    const { plaintextKey, keyHash } = generateApiKey(config.apiKeyHashSecret);

    const key = await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: name.trim(),
        keyHash,
        keyEncrypted: encryptToken(plaintextKey, config.tokenEncryptionKey),
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
    });

    // Return the plaintext key ONLY on creation - this is the only time
    // the user will see it. Store it securely.
    return reply.status(201).send({
      ...key,
      key: plaintextKey,
      warning:
        "Store this key securely. It will not be shown again.",
    });
  });

  // Revoke an API key
  app.post<{
    Params: { keyId: string };
  }>("/api/keys/:keyId/revoke", { preHandler: authMiddleware }, async (request, reply) => {
    const user = await requireAuth(request);

    const { keyId } = request.params;

    const key = await prisma.apiKey.findFirst({
      where: {
        id: keyId,
        userId: user.id,
        revokedAt: null,
      },
    });

    if (!key) {
      return sendError(reply, 404, "API key not found or already revoked", "not_found");
    }

    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  });

  // Validate an API key (internal use by proxy)
  app.post<{
    Body: { key: string };
  }>("/internal/keys/validate", async (request, reply) => {
    const { key } = request.body;

    if (!key) {
      return sendError(reply, 400, "Key is required", "validation");
    }

    const keyHash = validateAndHashApiKey(key, config.apiKeyHashSecret);

    if (!keyHash) {
      return sendError(reply, 400, "Invalid key format", "validation");
    }

    const apiKeyRecord = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    if (!apiKeyRecord) {
      return sendError(reply, 401, "Invalid API key", "unauthenticated");
    }

    if (apiKeyRecord.revokedAt) {
      return sendError(reply, 401, "API key has been revoked", "unauthenticated");
    }

    // Update lastUsedAt asynchronously (don't await)
    prisma.apiKey
      .update({
        where: { id: apiKeyRecord.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((err) => console.error("Failed to update lastUsedAt:", err));

    return {
      valid: true,
      userId: apiKeyRecord.userId,
      user: apiKeyRecord.user,
    };
  });
}
