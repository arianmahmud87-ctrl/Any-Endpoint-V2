import Fastify from "fastify";
import { loadConfig } from "../config.js";
import { prisma } from "../db/client.js";
import { authenticateProxyRequest } from "./auth.js";
import { forwardToUpstream } from "./upstream.js";
import { isHidden, isLocked } from "../web/feature-flags.js";

const config = loadConfig();
const app = Fastify({
  logger: true,
  requestTimeout: 600000, // 10 minutes for long reasoning turns over the Codex WebSocket backend
});

// Health check endpoint (no auth required)
app.get("/health", async () => ({ status: "ok", service: "myproxy" }));

// List supported endpoints
app.get("/v1", async () => ({
  service: "MyProxy API Gateway",
  version: "1.0.0",
  supported_endpoints: [
    "POST /v1/chat/completions",
    "GET /v1/models",
  ],
  auth: "Bearer sk-myproxy-...",
}));

// Proxy endpoint for all /v1/* paths
app.all("/v1/*", async (request, reply) => {
  const startedAt = Date.now();
  // Authenticate the request
  const authResult = await authenticateProxyRequest(
    request,
    config.apiKeyHashSecret,
    config.tokenEncryptionKey
  );

  if (!authResult.valid) {
    return reply.status(authResult.statusCode).send({
      error: { message: authResult.error, type: "unauthenticated" },
    });
  }

  if (await isHidden("proxy_access")) {
    return reply.status(403).send({ error: "feature_hidden", feature: "proxy_access" });
  }

  if (await isLocked("proxy_access")) {
    return reply.status(403).send({ error: "feature_locked", feature: "proxy_access" });
  }

  // Forward to upstream
  const usage = await forwardToUpstream(request, reply, {
    accessToken: authResult.accessToken,
    accessTokens: authResult.accessTokens,
    intelligentSwitcher: authResult.intelligentSwitcher && !(await isLocked("intelligent_switcher")),
    upstreamBaseUrl: config.upstreamBaseUrl,
  });

  // Record request metadata only. Prompts and responses are never stored.
  const model = (request.body as { model?: unknown } | undefined)?.model;
  prisma.usageLog.create({
    data: {
      userId: authResult.userId,
      route: request.url.split("?")[0],
      model: typeof model === "string" ? model : "",
      statusCode: reply.statusCode,
      latencyMs: Date.now() - startedAt,
      keyPrefix: authResult.keyPrefix,
      profileLabel: authResult.profileLabel,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
    },
  }).catch((err) => request.log.error({ err }, "Failed to record usage"));
});

// Catch-all for unsupported paths
app.all("/*", async (request, reply) => {
  return reply.status(404).send({
    error: "Not found. Use /v1/* endpoints.",
    supported_paths: ["/v1/chat/completions", "/v1/models"],
  });
});

// Start server
const port = Number(process.env.PROXY_PORT ?? 8080);
const host = "0.0.0.0";

await app.listen({ host, port });

console.log("MyProxy gateway is ready", {
  port,
  upstream: config.upstreamBaseUrl || "wss://chatgpt.com/backend-api/codex/responses (Codex ChatGPT backend)",
});
