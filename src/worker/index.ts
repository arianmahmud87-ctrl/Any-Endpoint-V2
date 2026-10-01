import { loadConfig } from "../config.js";
import {
  createWorker,
  getRedisConnection,
  DeviceAuthPollJobData,
  TokenRefreshJobData,
  CleanupJobData,
} from "./queue.js";
import {
  processDeviceAuthPoll,
  processTokenRefresh,
  processCleanup,
} from "./processors.js";
import {
  scheduleTokenRefreshes,
  scheduleCleanupJobs,
} from "./scheduler.js";

const config = loadConfig();

// Initialize Redis connection
const redisConnection = getRedisConnection(config.redisUrl);

// Create workers for different job types
const deviceAuthWorker = createWorker<DeviceAuthPollJobData>(
  "device-auth-poll",
  config.redisUrl,
  (job) => processDeviceAuthPoll(job, { tokenEncryptionKey: config.tokenEncryptionKey }),
  { concurrency: 10 } // Can handle multiple auth flows concurrently
);

const tokenRefreshWorker = createWorker<TokenRefreshJobData>(
  "token-refresh",
  config.redisUrl,
  (job) => processTokenRefresh(job, { tokenEncryptionKey: config.tokenEncryptionKey }),
  { concurrency: 5 }
);

const cleanupWorker = createWorker<CleanupJobData>(
  "cleanup",
  config.redisUrl,
  (job) => processCleanup(job),
  { concurrency: 1, limiter: { max: 10, duration: 60000 } }
);

console.log("Worker started", {
  redisConfigured: Boolean(config.redisUrl),
  workers: ["device-auth-poll", "token-refresh", "cleanup"],
});

// Schedule periodic tasks
const SCHEDULER_INTERVAL_MS = 60 * 1000; // Every minute

const schedulerInterval = setInterval(async () => {
  try {
    // Schedule token refreshes for tokens expiring soon
    const result = await scheduleTokenRefreshes(config.redisUrl, {
      refreshBeforeMinutes: 10,
    });
    
    if (result.scheduled > 0) {
      console.log(`Scheduled ${result.scheduled} token refresh jobs`);
    }
    
    if (result.errors > 0) {
      console.error(`Failed to schedule ${result.errors} token refresh jobs`);
    }
  } catch (error) {
    console.error("Scheduler error:", error);
  }
}, SCHEDULER_INTERVAL_MS);

// Run cleanup jobs every hour
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Every hour

const cleanupInterval = setInterval(async () => {
  try {
    await scheduleCleanupJobs(config.redisUrl);
    console.log("Scheduled cleanup jobs");
  } catch (error) {
    console.error("Cleanup scheduler error:", error);
  }
}, CLEANUP_INTERVAL_MS);

// Initial cleanup on startup
scheduleCleanupJobs(config.redisUrl).catch(console.error);

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down workers...`);

  clearInterval(schedulerInterval);
  clearInterval(cleanupInterval);

  await Promise.all([
    deviceAuthWorker.close(),
    tokenRefreshWorker.close(),
    cleanupWorker.close(),
    redisConnection.quit(),
  ]);

  console.log("Workers shut down successfully");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
