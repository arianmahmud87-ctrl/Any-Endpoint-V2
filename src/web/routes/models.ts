import { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { prisma } from "../../db/client.js";
import { authMiddleware, requireAuth } from "../auth-middleware.js";
import { decryptToken } from "../../utils/encryption.js";
import { loadConfig } from "../../config.js";

const config = loadConfig();
const CACHE_TTL_SECONDS = 300;

export interface ModelOption { id: string; label: string; }

/** Curated defaults, overridable with the AVAILABLE_MODELS env var (comma-separated ids). */
const FALLBACK_MODELS: ModelOption[] = (config.availableModels?.length
  ? config.availableModels
  : ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]
).map((id) => ({ id, label: prettify(id) }));

const REASONING_EFFORTS: ModelOption[] = [
  { id: "light", label: "Light" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "extra-high", label: "Extra High" },
  { id: "ultra", label: "Ultra" },
];

/** "gpt-5.6-terra" -> "GPT-5.6 Terra" */
function prettify(id: string): string {
  let out = "";
  id.split("-").forEach((part, i) => {
    const token = i === 0 && /^[a-z]+$/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
    if (i === 0) out = token;
    else out += /^\d/.test(part) ? `-${token}` : ` ${token}`;
  });
  return out;
}

let redis: Redis | null = null;
try {
  redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on("error", () => { /* cache is best-effort */ });
} catch {
  redis = null;
}

/** Auto-grab the model list from the upstream API using the user's active credential. */
async function fetchUpstreamModels(userId: string, log: { warn: (msg: string) => void }): Promise<ModelOption[] | null> {
  const now = new Date();
  const credential = await prisma.codexCredential.findFirst({
    where: { userId, revokedAt: null, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: [{ lastUsedAt: "asc" }, { createdAt: "asc" }],
  });
  if (!credential) return null;
  let token: string;
  try {
    token = decryptToken(credential.accessToken, config.tokenEncryptionKey);
  } catch {
    return null;
  }
  const baseUrl = (config.upstreamBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  try {
    const res = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      log.warn(`Upstream /models returned ${res.status}`);
      return null;
    }
    const data = await res.json() as { data?: { id?: unknown }[] };
    const ids = (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string" && id.length > 0);
    if (!ids.length) return null;
    return [...new Set(ids)].sort().map((id) => ({ id, label: prettify(id) }));
  } catch {
    return null;
  }
}

export async function modelRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { refresh?: string } }>("/api/models", { preHandler: authMiddleware }, async (request) => {
    const user = await requireAuth(request);
    const refresh = request.query.refresh === "1";
    const cacheKey = `models:${user.id}`;

    if (!refresh && redis) {
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) return JSON.parse(cached);
    }

    const upstream = await fetchUpstreamModels(user.id, request.log);
    const payload = {
      models: upstream ?? FALLBACK_MODELS,
      reasoning_efforts: REASONING_EFFORTS,
      source: upstream ? "upstream" : "fallback",
      fetched_at: new Date().toISOString(),
    };
    if (redis) redis.set(cacheKey, JSON.stringify(payload), "EX", CACHE_TTL_SECONDS).catch(() => { /* best-effort */ });
    return payload;
  });
}
