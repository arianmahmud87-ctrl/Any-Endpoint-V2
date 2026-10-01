import { addJob } from "./queue.js";
import { prisma } from "../db/client.js";

/**
 * Token refresh scheduler.
 * Schedules token refresh jobs for all users with active Codex tokens.
 */

/**
 * Schedule token refresh for all users whose tokens will expire soon.
 * Should be called periodically (e.g., every minute) by a cron job or scheduler.
 */
export async function scheduleTokenRefreshes(
  redisUrl: string,
  options?: {
    refreshBeforeMinutes?: number; // Refresh if token expires within this many minutes
    batchSize?: number;
  }
): Promise<{ scheduled: number; errors: number }> {
  const refreshBeforeMinutes = options?.refreshBeforeMinutes ?? 10;
  const batchSize = options?.batchSize ?? 100;

  const refreshThreshold = new Date(
    Date.now() + refreshBeforeMinutes * 60 * 1000
  );

  // Find tokens that need refresh
  const tokensNeedingRefresh = await prisma.codexToken.findMany({
    where: {
      expiresAt: {
        lte: refreshThreshold,
        gt: new Date(), // Not already expired
      },
    },
    select: {
      userId: true,
    },
    take: batchSize,
  });

  let scheduled = 0;
  let errors = 0;

  for (const token of tokensNeedingRefresh) {
    try {
      await addJob(
        "token-refresh",
        redisUrl,
        {
          userId: token.userId,
        },
        {
          jobId: `token-refresh-${token.userId}-${Date.now()}`,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );
      scheduled++;
    } catch (error) {
      console.error(`Failed to schedule token refresh for user ${token.userId}:`, error);
      errors++;
    }
  }

  return { scheduled, errors };
}

/**
 * Schedule cleanup jobs for old data.
 */
export async function scheduleCleanupJobs(
  redisUrl: string
): Promise<void> {
  // Schedule expired connection jobs cleanup
  await addJob(
    "cleanup",
    redisUrl,
    {
      type: "expired-jobs",
      olderThanDays: 7,
    },
    {
      jobId: `cleanup-jobs-${Date.now()}`,
    }
  );

  // Schedule expired tokens cleanup
  await addJob(
    "cleanup",
    redisUrl,
    {
      type: "old-tokens",
      olderThanDays: 0, // Delete all expired tokens
    },
    {
      jobId: `cleanup-tokens-${Date.now()}`,
    }
  );
}
