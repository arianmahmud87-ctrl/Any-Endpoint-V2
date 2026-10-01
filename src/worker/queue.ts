import { Queue, Worker, Job } from "bullmq";
import { Redis } from "ioredis";

/**
 * BullMQ queue configuration for background jobs.
 */

export type JobType = "device-auth-poll" | "token-refresh" | "cleanup";

export interface DeviceAuthPollJobData {
  jobId: string;
  userId: string;
  deviceAuthId: string;
  userCode: string;
  interval: number;
}

export interface TokenRefreshJobData {
  userId: string;
}

export interface CleanupJobData {
  type: "expired-jobs" | "old-tokens";
  olderThanDays: number;
}

export type JobData = DeviceAuthPollJobData | TokenRefreshJobData | CleanupJobData;

let connection: Redis | null = null;
let queues: Map<string, Queue> = new Map();

/**
 * Get or create a Redis connection for BullMQ.
 */
export function getRedisConnection(url: string): Redis {
  if (!connection) {
    connection = new Redis(url, {
      maxRetriesPerRequest: null, // BullMQ requires this
      enableReadyCheck: false,
    });

    connection.on("error", (err: Error) => {
      console.error("Redis connection error:", err);
    });

    connection.on("connect", () => {
      console.log("Redis connected for BullMQ");
    });
  }
  return connection;
}

/**
 * Get or create a queue by name.
 */
export function getQueue(name: string, redisUrl: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getRedisConnection(redisUrl),
    });
    queues.set(name, queue);
  }
  return queue;
}

/**
 * Create a worker to process jobs from a queue.
 */
export function createWorker<T extends JobData>(
  queueName: string,
  redisUrl: string,
  processor: (job: Job<T>) => Promise<void>,
  options?: {
    concurrency?: number;
    limiter?: {
      max: number;
      duration: number;
    };
  }
): Worker<T> {
  const worker = new Worker<T>(queueName, processor, {
    connection: getRedisConnection(redisUrl),
    concurrency: options?.concurrency ?? 5,
    limiter: options?.limiter,
  });

  worker.on("completed", (job) => {
    console.log(`Job ${job.id} in ${queueName} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} in ${queueName} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error(`Worker error in ${queueName}:`, err);
  });

  return worker;
}

/**
 * Add a job to a queue.
 */
export async function addJob<T extends JobData>(
  queueName: string,
  redisUrl: string,
  data: T,
  options?: {
    jobId?: string;
    delay?: number;
    attempts?: number;
    backoff?: {
      type: "exponential" | "fixed";
      delay: number;
    };
  }
): Promise<Job<T>> {
  const queue = getQueue(queueName, redisUrl);
  return queue.add(`${queueName}-job`, data, {
    jobId: options?.jobId,
    delay: options?.delay,
    attempts: options?.attempts ?? 3,
    backoff: options?.backoff ?? {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      age: 7 * 24 * 3600, // Keep completed jobs for 7 days
      count: 1000, // Or max 1000 jobs
    },
    removeOnFail: {
      age: 30 * 24 * 3600, // Keep failed jobs for 30 days
    },
  });
}
