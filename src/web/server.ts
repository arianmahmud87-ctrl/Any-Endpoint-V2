import Fastify from "fastify";
import { loadConfig } from "../config.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { codexRoutes } from "./routes/codex.js";
import { credentialRoutes } from "./routes/credentials.js";
import { settingsRoutes } from "./routes/settings.js";
import { usageRoutes } from "./routes/usage.js";
import { modelRoutes } from "./routes/models.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";

const config = loadConfig();
const app = Fastify({
  logger: true,
  requestTimeout: 30000,
});

// Register routes
await app.register(apiKeyRoutes);
await app.register(codexRoutes);
await app.register(credentialRoutes);
await app.register(settingsRoutes);
await app.register(usageRoutes);
await app.register(modelRoutes);
await app.register(authRoutes);
await app.register(adminRoutes);

// Health check
app.get("/health", async () => ({ status: "ok", service: "myproxy-web" }));

// Start server
const port = Number(process.env.WEB_PORT ?? 3000);
const host = "0.0.0.0";

await app.listen({ host, port });

console.log("MyProxy web API is ready", {
  port,
  endpoints: [
    "GET /api/user/profile",
    "GET /api/user/upstream-keys",
    "POST /api/user/upstream-keys",
    "DELETE /api/user/upstream-keys/:keyId",
    "GET /api/keys",
    "POST /api/keys",
    "POST /api/keys/:keyId/revoke",
  ],
});
