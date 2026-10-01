import { FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import { callCodexBackend } from "./codex-backend.js";

/**
 * Upstream routing.
 *
 * The stored Codex credentials are ChatGPT-subscription OAuth tokens, not
 * platform API keys, so requests must go to the Codex subscription backend
 * (wss://chatgpt.com/backend-api/codex/responses, Responses API over
 * WebSocket) rather than api.openai.com. Setting UPSTREAM_BASE_URL switches
 * back to plain passthrough mode for API-key credentials.
 */

const SUPPORTED_PATHS = ["/chat/completions", "/models"];

export function isSupportedPath(path: string): boolean {
  const normalizedPath = path.startsWith("/v1") ? path.slice(3) : path;
  return SUPPORTED_PATHS.some((supported) => normalizedPath === supported || normalizedPath.startsWith(supported + "/"));
}

function retryable(status: number): boolean { return status === 401 || status === 408 || status === 409 || status === 429 || status >= 500; }

const FALLBACK_MODELS = ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"];

function sendModelList(reply: FastifyReply): void {
  const created = Math.floor(Date.now() / 1000);
  reply.send({
    object: "list",
    data: FALLBACK_MODELS.map((id) => ({ id, object: "model", created, owned_by: "openai" })),
  });
}

export async function forwardToUpstream(request: FastifyRequest, reply: FastifyReply, options: { accessToken: string; accessTokens?: string[]; intelligentSwitcher?: boolean; upstreamBaseUrl?: string }): Promise<void> {
  const requestPath = request.url.split("?")[0];
  const normalizedPath = requestPath.startsWith("/v1") ? requestPath.slice(3) : requestPath;
  if (!isSupportedPath(normalizedPath)) {
    return reply.status(403).send({ error: { message: `Endpoint not supported. Supported: ${SUPPORTED_PATHS.join(", ")}`, type: "unsupported_endpoint" } });
  }

  // API-key mode: plain passthrough to a custom upstream (e.g. api.openai.com).
  if (options.upstreamBaseUrl) {
    return passthrough(request, reply, normalizedPath, options);
  }

  if (normalizedPath === "/models" || normalizedPath.startsWith("/models/")) {
    return sendModelList(reply);
  }

  if (normalizedPath !== "/chat/completions" || request.method !== "POST") {
    return reply.status(403).send({ error: { message: "Only POST /v1/chat/completions and GET /v1/models are supported with Codex subscription credentials", type: "unsupported_endpoint" } });
  }

  const body = request.body as Record<string, unknown> | undefined;
  if (!body || typeof body.model !== "string" || !Array.isArray(body.messages)) {
    return reply.status(400).send({ error: { message: "Request body must include model and messages", type: "invalid_request_error" } });
  }

  const tokens = options.intelligentSwitcher ? (options.accessTokens?.length ? options.accessTokens : [options.accessToken]) : [options.accessToken];
  const isStreaming = body.stream === true;

  if (isStreaming) {
    return streamChatCompletion(request, reply, body, tokens[0]);
  }

  for (let i = 0; i < tokens.length; i++) {
    const result = await callCodexBackend(tokens[i], body);
    if (result.status === 200 && result.completion) {
      return reply.status(200).send(buildChatCompletion(result.completion, body.model));
    }
    if (!retryable(result.status) || i === tokens.length - 1) {
      return reply.status(result.status).send(result.errorBody ?? { error: { message: "Upstream request failed", type: "upstream_error" } });
    }
    request.log.warn({ status: result.status, attempt: i + 1 }, "Retrying request with next Codex profile");
  }
}

function buildChatCompletion(completion: { content: string; toolCalls: { id: string; name: string; arguments: string }[]; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null; model: string }, requestedModel: string) {
  const message: Record<string, unknown> = { role: "assistant", content: completion.content || null };
  if (completion.toolCalls.length) {
    message.tool_calls = completion.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }));
  }
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: completion.model || requestedModel,
    choices: [{ index: 0, message, finish_reason: completion.toolCalls.length ? "tool_calls" : "stop" }],
    usage: completion.usage ?? undefined,
  };
}

async function streamChatCompletion(request: FastifyRequest, reply: FastifyReply, body: Record<string, unknown>, token: string): Promise<void> {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = String(body.model);
  let sseStarted = false;
  let sentDelta = false;

  const startSse = () => {
    if (sseStarted) return;
    sseStarted = true;
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.statusCode = 200;
    writeChunk(reply, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
  };

  const result = await callCodexBackend(token, body, (delta) => {
    startSse();
    sentDelta = true;
    writeChunk(reply, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] });
  });

  if (result.status !== 200 || !result.completion) {
    if (sseStarted) {
      writeChunk(reply, { error: result.errorBody ?? "Upstream request failed" });
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
      return;
    }
    return reply.status(result.status).send(result.errorBody ?? { error: { message: "Upstream request failed", type: "upstream_error" } });
  }

  const { completion } = result;
  startSse();
  // Deltas were suppressed upstream: flush the recovered full content once.
  if (!sentDelta && completion.content) {
    writeChunk(reply, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: completion.content }, finish_reason: null }] });
  }
  if (completion.toolCalls.length) {
    writeChunk(reply, {
      id, object: "chat.completion.chunk", created, model,
      choices: [{
        index: 0,
        delta: { tool_calls: completion.toolCalls.map((call, i) => ({ index: i, id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) },
        finish_reason: null,
      }],
    });
  }
  writeChunk(reply, {
    id, object: "chat.completion.chunk", created, model,
    choices: [{ index: 0, delta: {}, finish_reason: completion.toolCalls.length ? "tool_calls" : "stop" }],
    usage: completion.usage ?? undefined,
  });
  reply.raw.write("data: [DONE]\n\n");
  reply.raw.end();
  request.log.debug({ model }, "Streamed chat completion from Codex backend");
}

function writeChunk(reply: FastifyReply, payload: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Legacy passthrough mode for custom upstreams configured with UPSTREAM_BASE_URL. */
async function passthrough(request: FastifyRequest, reply: FastifyReply, normalizedPath: string, options: { accessToken: string; accessTokens?: string[]; intelligentSwitcher?: boolean; upstreamBaseUrl?: string }): Promise<void> {
  const baseUrl = options.upstreamBaseUrl;
  const tokens = options.intelligentSwitcher ? (options.accessTokens?.length ? options.accessTokens : [options.accessToken]) : [options.accessToken];
  const upstreamUrl = `${baseUrl}${normalizedPath}`;
  const body = request.body as { stream?: boolean } | undefined;

  if (body?.stream === true) {
    const response = await fetch(upstreamUrl, { method: request.method, headers: { Authorization: `Bearer ${tokens[0]}`, "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
    if (!response.ok) return reply.status(response.status).send(await response.json().catch(() => ({ error: "Upstream request failed" })));
    if (!response.body) return reply.status(502).send({ error: "No response body from upstream" });
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!reply.raw.write(decoder.decode(value, { stream: true }))) await new Promise<void>((resolve) => reply.raw.once("drain", resolve));
      }
    } finally { reader.releaseLock(); reply.raw.end(); }
    return;
  }

  for (let i = 0; i < tokens.length; i++) {
    const response = await fetch(upstreamUrl, { method: request.method, headers: { Authorization: `Bearer ${tokens[i]}`, "Content-Type": "application/json", ...(request.headers["openai-organization"] ? { "OpenAI-Organization": String(request.headers["openai-organization"]) } : {}) }, body: request.method !== "GET" ? JSON.stringify(request.body) : undefined });
    const data = await response.json().catch(() => ({ error: "Invalid upstream response" }));
    if (response.ok || !retryable(response.status) || i === tokens.length - 1) return reply.status(response.status).send(data);
    request.log.warn({ status: response.status, attempt: i + 1 }, "Retrying request with next upstream profile");
  }
}
