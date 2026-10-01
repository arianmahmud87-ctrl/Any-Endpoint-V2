import { createHmac, randomBytes } from "crypto";

/**
 * API Key utilities for secure key generation and lookup.
 * 
 * Key format: sk-myproxy-<random-32-bytes-base62>
 * Storage: HMAC-SHA256 hash (keyed) for indexed lookup
 * 
 * We use HMAC with a server-side secret for deterministic hashing,
 * which allows indexed database lookups unlike bcrypt/scrypt.
 */

const KEY_PREFIX = "sk-myproxy-";
const KEY_RANDOM_LENGTH = 32; // 32 random bytes
const LOOKUP_HASH_ALGORITHM = "sha256";

/**
 * Generates a new API key in the format: sk-myproxy-<random>
 * Returns both the plaintext key (show once) and its hash for storage.
 * 
 * @param hashSecret - Server-side secret for HMAC hashing
 * @returns Object containing plaintext key and hash for storage
 */
export function generateApiKey(hashSecret: string): {
  plaintextKey: string;
  keyHash: string;
} {
  if (!hashSecret || hashSecret.length < 32) {
    throw new Error("API_KEY_HASH_SECRET must be at least 32 characters");
  }

  // Generate random bytes and encode as base62 (alphanumeric)
  const randomBytes_ = randomBytes(KEY_RANDOM_LENGTH);
  const randomPart = base62Encode(randomBytes_);

  const plaintextKey = `${KEY_PREFIX}${randomPart}`;
  const keyHash = hashApiKey(plaintextKey, hashSecret);

  return { plaintextKey, keyHash };
}

/**
 * Computes the deterministic hash of an API key for lookup.
 * Uses HMAC-SHA256 with a server-side secret.
 * 
 * @param plaintextKey - The API key (sk-myproxy-...)
 * @param hashSecret - Server-side secret for HMAC
 * @returns Hex-encoded HMAC-SHA256 hash
 */
export function hashApiKey(plaintextKey: string, hashSecret: string): string {
  if (!plaintextKey || !plaintextKey.startsWith(KEY_PREFIX)) {
    throw new Error(`Invalid API key format: must start with ${KEY_PREFIX}`);
  }

  if (!hashSecret || hashSecret.length < 32) {
    throw new Error("API_KEY_HASH_SECRET must be at least 32 characters");
  }

  return createHmac(LOOKUP_HASH_ALGORITHM, hashSecret)
    .update(plaintextKey)
    .digest("hex");
}

/**
 * Validates an API key format and computes its hash for lookup.
 * 
 * @param plaintextKey - The API key to validate and hash
 * @param hashSecret - Server-side secret for HMAC
 * @returns Hash for database lookup, or null if invalid format
 */
export function validateAndHashApiKey(
  plaintextKey: string,
  hashSecret: string
): string | null {
  if (!plaintextKey || !plaintextKey.startsWith(KEY_PREFIX)) {
    return null;
  }

  try {
    return hashApiKey(plaintextKey, hashSecret);
  } catch {
    return null;
  }
}

/**
 * Base62 encoding (alphanumeric: 0-9, a-z, A-Z)
 * Produces compact, URL-safe strings.
 */
function base62Encode(buffer: Buffer): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const base = BigInt(62);
  let num = BigInt("0x" + buffer.toString("hex"));

  let result = "";
  while (num > 0n) {
    result = chars[Number(num % base)] + result;
    num = num / base;
  }

  return result;
}
