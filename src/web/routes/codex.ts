import { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { authMiddleware, requireAuth } from "../auth-middleware.js";
import { assertUnlocked, assertVisible } from "../feature-flags.js";
import { requestDeviceCode } from "../../codex/device-code.js";
import { addJob } from "../../worker/queue.js";
import { loadConfig } from "../../config.js";

const config = loadConfig();

/**
 * Codex connection management routes.
 * Handles device code flow for ChatGPT subscription authentication.
 */
export async function codexRoutes(app: FastifyInstance) {
  /**
   * Start a new device code authentication flow.
   * Returns the verification URL and user code for the user to enter in browser.
   */
  app.post<{ Body: { workspaceId?: string } }>(
    "/api/codex/connect",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const user = await requireAuth(request);

      if (!(await assertUnlocked("profiles", reply))) return;
      if (!(await assertVisible("profiles", reply))) return;

      // Check if user already has a valid connection
      const existingToken = await prisma.codexToken.findUnique({
        where: { userId: user.id },
      });

      if (existingToken && existingToken.expiresAt > new Date()) {
        return reply.status(400).send({
          error: "Already connected",
          message: "You already have an active Codex connection. Disconnect first to reconnect.",
        });
      }

      // Check for pending connection job
      const pendingJob = await prisma.connectionJob.findFirst({
        where: {
          userId: user.id,
          status: "pending",
          expiresAt: { gt: new Date() },
        },
      });

      if (pendingJob) {
        // Return existing pending job
        return {
          jobId: pendingJob.id,
          verificationUrl: pendingJob.verificationUrl,
          userCode: pendingJob.userCode,
          expiresAt: pendingJob.expiresAt,
          status: "pending",
        };
      }

      try {
        // Request device code from OpenAI
        const deviceCode = await requestDeviceCode();

        // Store the connection job
        const job = await prisma.connectionJob.create({
          data: {
            userId: user.id,
            deviceAuthId: deviceCode.deviceAuthId,
            userCode: deviceCode.userCode,
            verificationUrl: deviceCode.verificationUrl,
            status: "pending",
            expiresAt: deviceCode.expiresAt,
          },
        });

        // Queue the polling job
        await addJob(
          "device-auth-poll",
          config.redisUrl,
          {
            jobId: job.id,
            userId: user.id,
            deviceAuthId: deviceCode.deviceAuthId,
            userCode: deviceCode.userCode,
            interval: deviceCode.interval,
          },
          {
            jobId: job.id,
            attempts: 1, // Don't retry on failure
          }
        );

        return {
          jobId: job.id,
          verificationUrl: deviceCode.verificationUrl,
          userCode: deviceCode.userCode,
          expiresAt: deviceCode.expiresAt,
          status: "pending",
          instructions: [
            `1. Open this URL in your browser: ${deviceCode.verificationUrl}`,
            `2. Enter this code: ${deviceCode.userCode}`,
            "3. Sign in with your ChatGPT account",
            "4. Wait for confirmation (auto-polling enabled)",
          ],
        };
      } catch (error: any) {
        request.log.error({ error }, "Failed to initiate device code flow");
        return reply.status(500).send({
          error: "Failed to start authentication",
          message: error.message,
        });
      }
    }
  );

  /**
   * Get connection status for the current user.
   */
  app.get(
    "/api/codex/status",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const user = await requireAuth(request);

      // Check for active token
      const token = await prisma.codexToken.findUnique({
        where: { userId: user.id },
        select: {
          id: true,
          expiresAt: true,
          lastRefreshedAt: true,
          createdAt: true,
        },
      });

      if (token && token.expiresAt > new Date()) {
        return {
          status: "connected",
          expiresAt: token.expiresAt,
          lastRefreshedAt: token.lastRefreshedAt,
        };
      }

      // Check for pending job
      const pendingJob = await prisma.connectionJob.findFirst({
        where: {
          userId: user.id,
          status: "pending",
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          userCode: true,
          verificationUrl: true,
          expiresAt: true,
        },
      });

      if (pendingJob) {
        return {
          status: "pending",
          jobId: pendingJob.id,
          userCode: pendingJob.userCode,
          verificationUrl: pendingJob.verificationUrl,
          expiresAt: pendingJob.expiresAt,
        };
      }

      // Check for failed job
      const failedJob = await prisma.connectionJob.findFirst({
        where: {
          userId: user.id,
          status: "failed",
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          updatedAt: true,
        },
      });

      if (failedJob) {
        return {
          status: "failed",
          failedAt: failedJob.updatedAt,
          message: "Authentication failed. Please try again.",
        };
      }

      return {
        status: "disconnected",
        message: "No Codex connection found. Use /api/codex/connect to start.",
      };
    }
  );

  /**
   * Disconnect Codex (revoke tokens).
   */
  app.post(
    "/api/codex/disconnect",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const user = await requireAuth(request);

      // Delete tokens
      await prisma.codexToken.deleteMany({
        where: { userId: user.id },
      });

      // Cancel any pending jobs
      await prisma.connectionJob.updateMany({
        where: {
          userId: user.id,
          status: "pending",
        },
        data: { status: "cancelled" },
      });

      return {
        success: true,
        message: "Codex connection disconnected.",
      };
    }
  );
}
