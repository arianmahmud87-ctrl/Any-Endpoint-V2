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

/** Token usage extracted from an upstream response, when available. */
export interface UpstreamUsage { prompt_tokens: number; completion_tokens: number }

export async function forwardToUpstream(request: FastifyRequest, reply: FastifyReply, options: { accessToken: string; accessTokens?: string[]; intelligentSwitcher?: boolean; upstreamBaseUrl?: string }): Promise<UpstreamUsage | undefined> {
  const requestPath = request.url.split("?")[0];
  const normalizedPath = requestPath.startsWith("/v1") ? requestPath.slice(3) : requestPath;
  if (!isSupportedPath(normalizedPath)) {
    reply.status(403).send({ error: { message: `Endpoint not supported. Supported: ${SUPPORTED_PATHS.join(", ")}`, type: "unsupported_endpoint" } });
    return undefined;
  }

  // API-key mode: plain passthrough to a custom upstream (e.g. api.openai.com).
  if (options.upstreamBaseUrl) {
    return passthrough(request, reply, normalizedPath, options);
  }

  if (normalizedPath === "/models" || normalizedPath.startsWith("/models/")) {
    sendModelList(reply);
    return undefined;
  }

  if (normalizedPath !== "/chat/completions" || request.method !== "POST") {
    reply.status(403).send({ error: { message: "Only POST /v1/chat/completions and GET /v1/models are supported with Codex subscription credentials", type: "unsupported_endpoint" } });
    return undefined;
  }

  const body = request.body as Record<string, unknown> | undefined;
  if (!body || typeof body.model !== "string" || !Array.isArray(body.messages)) {
    reply.status(400).send({ error: { message: "Request body must include model and messages", type: "invalid_request_error" } });
    return undefined;
  }

  const tokens = options.intelligentSwitcher ? (options.accessTokens?.length ? options.accessTokens : [options.accessToken]) : [options.accessToken];
  const isStreaming = body.stream === true;

  if (isStreaming) {
    return streamChatCompletion(request, reply, body, tokens[0]);
  }

  for (let i = 0; i < tokens.length; i++) {
    const result = await callCodexBackend(tokens[i], body);
    if (result.status === 200 && result.completion) {
      reply.status(200).send(buildChatCompletion(result.completion, body.model));
      return result.completion.usage ?? undefined;
    }
    if (!retryable(result.status) || i === tokens.length - 1) {
      reply.status(result.status).send(result.errorBody ?? { error: { message: "Upstream request failed", type: "upstream_error" } });
      return undefined;
    }
    request.log.warn({ status: result.status, attempt: i + 1 }, "Retrying request with next Codex profile");
  }
  return undefined;
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

async function streamChatCompletion(request: FastifyRequest, reply: FastifyReply, body: Record<string, unknown>, token: string): Promise<UpstreamUsage | undefined> {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = String(body.model);
  let sseStarted = false;
  let sentDelta = false;
  // Chunks are written strictly in order through a promise queue; when the
  // client is slow, the queue awaits the socket drain before the next write so
  // the buffer can't grow without bound.
  let writeQueue: Promise<void> = Promise.resolve();
  const writeChunk = (reply: FastifyReply, payload: unknown): void => {
    writeQueue = writeQueue.then(async () => {
      if (!reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)) await new Promise<void>((resolve) => reply.raw.once("drain", resolve));
    });
  };

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
      writeQueue = writeQueue.then(() => { reply.raw.write("data: [DONE]\n\n"); reply.raw.end(); });
      return undefined;
    }
    reply.status(result.status).send(result.errorBody ?? { error: { message: "Upstream request failed", type: "upstream_error" } });
    return undefined;
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
  await writeQueue;
  reply.raw.write("data: [DONE]\n\n");
  reply.raw.end();
  request.log.debug({ model }, "Streamed chat completion from Codex backend");
  return completion.usage ?? undefined;
}

/** Legacy passthrough mode for custom upstreams configured with UPSTREAM_BASE_URL. */
async function passthrough(request: FastifyRequest, reply: FastifyReply, normalizedPath: string, options: { accessToken: string; accessTokens?: string[]; intelligentSwitcher?: boolean; upstreamBaseUrl?: string }): Promise<UpstreamUsage | undefined> {
  const baseUrl = options.upstreamBaseUrl;
  const tokens = options.intelligentSwitcher ? (options.accessTokens?.length ? options.accessTokens : [options.accessToken]) : [options.accessToken];
  const upstreamUrl = `${baseUrl}${normalizedPath}`;
  const body = request.body as { stream?: boolean } | undefined;

  if (body?.stream === true) {
    const response = await fetch(upstreamUrl, { method: request.method, headers: { Authorization: `Bearer ${tokens[0]}`, "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
    if (!response.ok) {
      reply.status(response.status).send(await response.json().catch(() => ({ error: "Upstream request failed" })));
      return undefined;
    }
    if (!response.body) {
      reply.status(502).send({ error: "No response body from upstream" });
      return undefined;
    }
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
    // Streaming passthrough forwards raw SSE chunks verbatim, so usage is not parsed here and stays 0.
    return undefined;
  }

  for (let i = 0; i < tokens.length; i++) {
    const response = await fetch(upstreamUrl, { method: request.method, headers: { Authorization: `Bearer ${tokens[i]}`, "Content-Type": "application/json", ...(request.headers["openai-organization"] ? { "OpenAI-Organization": String(request.headers["openai-organization"]) } : {}) }, body: request.method !== "GET" ? JSON.stringify(request.body) : undefined });
    const data = await response.json().catch(() => ({ error: "Invalid upstream response" }));
    if (response.ok || !retryable(response.status) || i === tokens.length - 1) {
      reply.status(response.status).send(data);
      const usage = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
      if (response.ok && typeof usage?.prompt_tokens === "number" && typeof usage?.completion_tokens === "number") {
        return { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens };
      }
      return undefined;
    }
    request.log.warn({ status: response.status, attempt: i + 1 }, "Retrying request with next upstream profile");
  }
  return undefined;
}
