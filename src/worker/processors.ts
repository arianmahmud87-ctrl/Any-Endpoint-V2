import { Job } from "bullmq";
import { prisma } from "../db/client.js";
import { encryptToken } from "../utils/encryption.js";
import {
  pollForAuthorization,
  exchangeCodeForTokens,
} from "../codex/device-code.js";
import type {
  DeviceAuthPollJobData,
  TokenRefreshJobData,
  CleanupJobData,
} from "./queue.js";

/**
 * Process device code polling job.
 * Polls OpenAI until user authorizes in browser.
 */
export async function processDeviceAuthPoll(
  job: Job<DeviceAuthPollJobData>,
  config: { tokenEncryptionKey: string }
): Promise<void> {
  const { jobId, userId, deviceAuthId, userCode, interval } = job.data;

  console.log(`Device auth poll started for user ${userId}, job ${jobId}`);

  // Check if job is still pending
  const connectionJob = await prisma.connectionJob.findUnique({
    where: { id: jobId },
  });

  if (!connectionJob || connectionJob.status !== "pending") {
    console.log(`Job ${jobId} is no longer pending, skipping`);
    return;
  }

  try {
    // Poll for authorization
    const pollResponse = await pollForAuthorization(
      deviceAuthId,
      userCode,
      interval,
      (status) => {
        job.log(`Poll status: ${status}`);
      }
    );

    job.log("Authorization received, exchanging code for tokens");

    // Exchange authorization code for tokens
    const tokens = await exchangeCodeForTokens(
      pollResponse.authorization_code,
      pollResponse.code_verifier,
      pollResponse.code_challenge
    );

    job.log("Tokens received, encrypting and storing");

    // Encrypt tokens before storage
    const encryptedAccessToken = encryptToken(
      tokens.access_token,
      config.tokenEncryptionKey
    );
    const encryptedRefreshToken = encryptToken(
      tokens.refresh_token,
      config.tokenEncryptionKey
    );
    const encryptedIdToken = tokens.id_token
      ? encryptToken(tokens.id_token, config.tokenEncryptionKey)
      : null;

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Store tokens in database
    await prisma.$transaction([
      // Create/update CodexToken
      prisma.codexToken.upsert({
        where: { userId },
        create: {
          userId,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          idToken: encryptedIdToken,
          expiresAt,
        },
        update: {
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          idToken: encryptedIdToken,
          expiresAt,
          lastRefreshedAt: new Date(),
        },
      }),
      // Update connection job status
      prisma.connectionJob.update({
        where: { id: jobId },
        data: { status: "completed" },
      }),
    ]);

    job.log(`Device auth completed successfully for user ${userId}`);
    console.log(`Device auth completed for user ${userId}`);
  } catch (error: any) {
    console.error(`Device auth failed for user ${userId}:`, error.message);

    // Update job status to failed
    await prisma.connectionJob.update({
      where: { id: jobId },
      data: { status: "failed" },
    });

    throw error;
  }
}

/**
 * Process token refresh job.
 * Refreshes Codex access token using refresh token.
 */
export async function processTokenRefresh(
  job: Job<TokenRefreshJobData>,
  config: { tokenEncryptionKey: string }
): Promise<void> {
  const { userId } = job.data;

  console.log(`Token refresh job for user ${userId}`);

  // Get current token
  const codexToken = await prisma.codexToken.findUnique({
    where: { userId },
  });

  if (!codexToken) {
    throw new Error(`No Codex token found for user ${userId}`);
  }

  // Check if token needs refresh (refresh 5 minutes before expiry)
  const refreshThreshold = new Date(Date.now() + 5 * 60 * 1000);
  if (codexToken.expiresAt > refreshThreshold) {
    job.log("Token not yet due for refresh");
    return;
  }

  try {
    // Decrypt refresh token
    const { decryptToken } = await import("../utils/encryption.js");
    const refreshToken = decryptToken(
      codexToken.refreshToken,
      config.tokenEncryptionKey
    );

    // Refresh the token
    const { refreshAccessToken } = await import("../codex/device-code.js");
    const newTokens = await refreshAccessToken(refreshToken);

    // Encrypt new tokens
    const encryptedAccessToken = encryptToken(
      newTokens.access_token,
      config.tokenEncryptionKey
    );
    const encryptedRefreshToken = encryptToken(
      newTokens.refresh_token,
      config.tokenEncryptionKey
    );

    const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

    // Update tokens in database
    await prisma.codexToken.update({
      where: { userId },
      data: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt,
        lastRefreshedAt: new Date(),
      },
    });

    job.log(`Token refreshed successfully for user ${userId}`);
    console.log(`Token refreshed for user ${userId}`);
  } catch (error: any) {
    console.error(`Token refresh failed for user ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Cleanup job for removing old data.
 */
export async function processCleanup(job: Job<CleanupJobData>): Promise<void> {
  const { type, olderThanDays } = job.data;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  console.log(`Cleanup job: ${type}, older than ${olderThanDays} days`);

  switch (type) {
    case "expired-jobs": {
      // Remove expired/completed/failed connection jobs
      const result = await prisma.connectionJob.deleteMany({
        where: {
          status: { in: ["completed", "failed", "expired", "cancelled"] },
          updatedAt: { lt: cutoffDate },
        },
      });
      console.log(`Deleted ${result.count} old connection jobs`);
      break;
    }

    case "old-tokens": {
      // Remove expired tokens
      const result = await prisma.codexToken.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });
      console.log(`Deleted ${result.count} expired tokens`);
      break;
    }

    default:
      console.log(`Unknown cleanup type: ${type}`);
  }
}
