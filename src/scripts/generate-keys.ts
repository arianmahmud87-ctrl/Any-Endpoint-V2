/**
 * Utility script to generate encryption keys for .env
 * Run with: npx tsx src/scripts/generate-keys.ts
 */

import { randomBytes } from "crypto";

function generateHexKey(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

console.log("# Generated secrets for MyProxy SaaS");
console.log("# Add these to your .env file:\n");
console.log(`AUTH_SECRET="${generateRandomString(64)}"`);
console.log(`TOKEN_ENCRYPTION_KEY="${generateHexKey(32)}"`);
console.log(`API_KEY_HASH_SECRET="${generateRandomString(64)}"`);
console.log("\n# Remember to also configure:");
console.log("# GOOGLE_CLIENT_ID=your-google-client-id");
console.log("# GOOGLE_CLIENT_SECRET=your-google-client-secret");
