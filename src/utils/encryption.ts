import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Encryption envelope format for storing sensitive tokens.
 * Uses AES-256-GCM for authenticated encryption.
 * 
 * Envelope structure (JSON):
 * {
 *   v: 1,                    // version
 *   alg: "aes-256-gcm",      // algorithm
 *   nonce: string,           // base64url-encoded 12-byte IV/nonce
 *   ciphertext: string,      // base64url-encoded ciphertext
 *   tag: string              // base64url-encoded 16-byte auth tag
 * }
 */

export interface EncryptionEnvelope {
  v: number;
  alg: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12; // 96 bits, recommended for GCM
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits
const CURRENT_VERSION = 1;

/**
 * Validates that the encryption key is a 32-byte hex string (64 characters).
 */
function validateKey(key: string): void {
  if (!key || key.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)"
    );
  }
}

/**
 * Encrypts plaintext using AES-256-GCM and returns a JSON envelope.
 * 
 * @param plaintext - The sensitive data to encrypt (e.g., access token)
 * @param keyHex - 64-character hex string (32 bytes) encryption key
 * @returns JSON string of the encryption envelope
 */
export function encryptToken(plaintext: string, keyHex: string): string {
  validateKey(keyHex);

  const key = Buffer.from(keyHex, "hex");
  const nonce = randomBytes(NONCE_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, nonce, {
    authTagLength: TAG_LENGTH,
  });

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  const envelope: EncryptionEnvelope = {
    v: CURRENT_VERSION,
    alg: ALGORITHM,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: tag.toString("base64url"),
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypts an encryption envelope and returns the original plaintext.
 * 
 * @param envelopeJson - JSON string of the encryption envelope
 * @param keyHex - 64-character hex string (32 bytes) encryption key
 * @returns The original plaintext
 * @throws Error if decryption fails or envelope is invalid
 */
export function decryptToken(envelopeJson: string, keyHex: string): string {
  validateKey(keyHex);

  let envelope: EncryptionEnvelope;
  try {
    envelope = JSON.parse(envelopeJson);
  } catch {
    throw new Error("Invalid encryption envelope: not valid JSON");
  }

  if (envelope.v !== CURRENT_VERSION) {
    throw new Error(`Unsupported envelope version: ${envelope.v}`);
  }

  if (envelope.alg !== ALGORITHM) {
    throw new Error(`Unsupported algorithm: ${envelope.alg}`);
  }

  const key = Buffer.from(keyHex, "hex");
  const nonce = Buffer.from(envelope.nonce, "base64url");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
  const tag = Buffer.from(envelope.tag, "base64url");

  if (nonce.length !== NONCE_LENGTH) {
    throw new Error("Invalid nonce length");
  }

  if (tag.length !== TAG_LENGTH) {
    throw new Error("Invalid auth tag length");
  }

  const decipher = createDecipheriv(ALGORITHM, key, nonce, {
    authTagLength: TAG_LENGTH,
  });

  decipher.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (error) {
    throw new Error("Decryption failed: authentication tag mismatch or corrupt data");
  }
}

/**
 * Generates a new random 32-byte encryption key in hex format.
 * Use this to generate TOKEN_ENCRYPTION_KEY for .env
 */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString("hex");
}
