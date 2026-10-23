export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  upstreamBaseUrl?: string;
  authSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  tokenEncryptionKey: string;
  apiKeyHashSecret: string;
  domain: string;
  cookieDomain?: string;
  availableModels?: string[];
  adminEmail?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  const redisUrl = env.REDIS_URL;
  const authSecret = env.AUTH_SECRET;
  const googleClientId = env.GOOGLE_CLIENT_ID;
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET;
  const tokenEncryptionKey = env.TOKEN_ENCRYPTION_KEY;
  const apiKeyHashSecret = env.API_KEY_HASH_SECRET;
  const domain = env.DOMAIN;

  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase() || undefined;
  if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new Error("ADMIN_EMAIL must be a valid email address");
  }

  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!redisUrl) throw new Error("REDIS_URL is required");
  if (!authSecret) throw new Error("AUTH_SECRET is required");
  if (!googleClientId) throw new Error("GOOGLE_CLIENT_ID is required");
  if (!googleClientSecret) throw new Error("GOOGLE_CLIENT_SECRET is required");
  if (!tokenEncryptionKey) throw new Error("TOKEN_ENCRYPTION_KEY is required");
  if (!apiKeyHashSecret) throw new Error("API_KEY_HASH_SECRET is required");
  if (!domain) throw new Error("DOMAIN is required");

  if (!/^https:\/\//.test(domain)) throw new Error("DOMAIN must use https://");
  if (!/^[0-9a-fA-F]{64}$/.test(tokenEncryptionKey)) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }

  // Validate hash secret length
  if (apiKeyHashSecret.length < 32) {
    throw new Error("API_KEY_HASH_SECRET must be at least 32 characters");
  }

  return {
    databaseUrl,
    redisUrl,
    upstreamBaseUrl: env.UPSTREAM_BASE_URL || undefined,
    authSecret,
    googleClientId,
    googleClientSecret,
    tokenEncryptionKey,
    apiKeyHashSecret,
    domain,
    cookieDomain: new URL(domain).hostname,
    availableModels: env.AVAILABLE_MODELS?.split(",").map((s) => s.trim()).filter(Boolean),
    adminEmail,
  };
}
