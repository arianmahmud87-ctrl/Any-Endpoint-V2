import { FastifyReply } from "fastify";
import { prisma } from "../db/client.js";

/** Feature keys an admin can lock. Missing rows count as unlocked. */
export const FEATURE_KEYS = ["playground", "api_keys", "profiles", "proxy_access", "intelligent_switcher", "tokens"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

const CACHE_TTL_MS = 30_000;
let cache: { locked: Map<string, boolean>; hidden: Map<string, boolean>; expiresAt: number } | null = null;

async function loadFlags(): Promise<{ locked: Map<string, boolean>; hidden: Map<string, boolean> }> {
  if (cache && cache.expiresAt > Date.now()) return cache;
  const rows = await prisma.featureFlag.findMany();
  const locked = new Map(rows.map((row) => [row.key, row.locked]));
  const hidden = new Map(rows.map((row) => [row.key, row.hidden]));
  cache = { locked, hidden, expiresAt: Date.now() + CACHE_TTL_MS };
  return cache;
}

/** Drop the in-memory cache (called after an admin updates a flag). */
export function invalidateFeatureFlagCache(): void {
  cache = null;
}

export async function isLocked(key: FeatureKey): Promise<boolean> {
  try {
    return (await loadFlags()).locked.get(key) === true;
  } catch {
    // Fail open: a flag-store outage must not take the service down.
    return false;
  }
}

export async function isHidden(key: FeatureKey): Promise<boolean> {
  try {
    return (await loadFlags()).hidden.get(key) === true;
  } catch {
    return false;
  }
}

export async function lockedKeys(): Promise<string[]> {
  try {
    const flags = await loadFlags();
    return FEATURE_KEYS.filter((key) => flags.locked.get(key) === true);
  } catch {
    return [];
  }
}

export async function hiddenKeys(): Promise<string[]> {
  try {
    const flags = await loadFlags();
    return FEATURE_KEYS.filter((key) => flags.hidden.get(key) === true);
  } catch {
    return [];
  }
}

/** Sends 403 { error: "feature_locked" } and returns false when the feature is locked. */
export async function assertUnlocked(key: FeatureKey, reply: FastifyReply): Promise<boolean> {
  if (await isLocked(key)) {
    await reply.status(403).send({ error: "feature_locked", feature: key });
    return false;
  }
  return true;
}

/** Sends 403 { error: "feature_hidden" } and returns false when the feature is hidden. */
export async function assertVisible(key: FeatureKey, reply: FastifyReply): Promise<boolean> {
  if (await isHidden(key)) {
    await reply.status(403).send({ error: "feature_hidden", feature: key });
    return false;
  }
  return true;
}
