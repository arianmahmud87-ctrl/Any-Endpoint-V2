/**
 * Codex ChatGPT-backend transport.
 *
 * ChatGPT-login Codex tokens (OAuth, from device-code flow or auth.json) are NOT
 * OpenAI API keys. They only work against the Codex subscription backend, the
 * same endpoint the Codex CLI uses:
 *
 *   wss://chatgpt.com/backend-api/codex/responses
 *
 * Since Codex CLI v0.133.0 the backend speaks the Responses API over WebSocket
 * only (HTTP POST + SSE was removed). The handshake requires:
 *   - OpenAI-Beta: responses_websockets=2026-02-06
 *   - originator: codex_cli_rs
 *   - User-Agent: codex_cli_rs/<version> and version: <version> (403 if omitted)
 *   - chatgpt-account-id: <account id from the access-token JWT>
 * The first frame must be {"type":"response.create", ...responses-api-body}.
 *
 * This module accepts OpenAI chat/completions payloads, translates them to
 * Responses API frames, and translates the streamed events back into
 * chat.completion chunks.
 */

import WebSocket from "ws";
import { randomUUID } from "crypto";

const CODEX_WS_URL = process.env.CODEX_BACKEND_WS_URL || "wss://chatgpt.com/backend-api/codex/responses";
const CODEX_CLI_VERSION = process.env.CODEX_CLI_VERSION || "0.153.4";
const IDLE_TIMEOUT_MS = Number(process.env.CODEX_WS_IDLE_TIMEOUT_MS ?? 300_000);

export interface CodexCallResult {
  status: number;
  /** Present when status is not 2xx. */
  errorBody?: unknown;
  /** Assembled final answer, present on success. */
  completion?: {
    content: string;
    toolCalls: { id: string; name: string; arguments: string }[];
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
    model: string;
  };
}

/** Extract the ChatGPT account id embedded in the OAuth access token JWT. */
export function extractAccountId(accessToken: string): string | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    const id = auth?.chatgpt_account_id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** UI effort ids -> Codex reasoning effort values. */
const EFFORT_MAP: Record<string, string> = {
  minimal: "minimal",
  light: "low",
  low: "low",
  medium: "medium",
  high: "high",
  "extra-high": "xhigh",
  xhigh: "xhigh",
  ultra: "xhigh",
};

interface ChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
  tool_call_id?: string;
}

function textParts(content: unknown, partType: "input_text" | "output_text"): { type: string; text: string }[] {
  if (typeof content === "string") return [{ type: partType, text: content }];
  if (Array.isArray(content)) {
    const parts: { type: string; text: string }[] = [];
    for (const part of content) {
      if (part && typeof part === "object") {
        const p = part as { type?: string; text?: string };
        if (p.type === "text" && typeof p.text === "string") parts.push({ type: partType, text: p.text });
        else if ((p.type === "input_text" || p.type === "output_text") && typeof p.text === "string") parts.push({ type: p.type, text: p.text });
      }
    }
    return parts;
  }
  return [];
}

/** Translate an OpenAI chat/completions body into a Responses API response.create frame. */
export function chatToResponseCreate(chatBody: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(chatBody.messages) ? (chatBody.messages as ChatMessage[]) : [];

  const instructions: string[] = [];
  const input: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      const text = textParts(msg.content, "input_text").map((p) => p.text).join("\n");
      if (text) instructions.push(text);
      continue;
    }
    if (msg.role === "tool" && msg.tool_call_id) {
      const output = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
      input.push({ type: "function_call_output", call_id: msg.tool_call_id, output });
      continue;
    }
    if (msg.role === "assistant") {
      const content = textParts(msg.content, "output_text");
      if (content.length) input.push({ type: "message", role: "assistant", content });
      for (const call of msg.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id ?? `call_${randomUUID()}`,
          name: call.function?.name ?? "",
          arguments: call.function?.arguments ?? "",
        });
      }
      continue;
    }
    // user (and anything else) as input message
    input.push({ type: "message", role: msg.role === "user" ? "user" : "user", content: textParts(msg.content, "input_text") });
  }

  const body: Record<string, unknown> = {
    type: "response.create",
    model: chatBody.model,
    instructions: instructions.join("\n\n") || "You are a helpful assistant.",
    input,
    store: false,
    stream: true,
  };

  const effortRaw = (chatBody.reasoning_effort ?? (chatBody.reasoning as { effort?: unknown } | undefined)?.effort) as string | undefined;
  if (typeof effortRaw === "string" && EFFORT_MAP[effortRaw]) {
    body.reasoning = { effort: EFFORT_MAP[effortRaw], summary: "auto" };
  }

  if (Array.isArray(chatBody.tools) && chatBody.tools.length) {
    body.tools = (chatBody.tools as Record<string, unknown>[]).map((tool) => {
      if (tool.type === "function" && tool.function && typeof tool.function === "object") {
        const fn = tool.function as Record<string, unknown>;
        return { type: "function", name: fn.name, description: fn.description, parameters: fn.parameters ?? { type: "object" } };
      }
      return tool;
    });
    body.tool_choice = chatBody.tool_choice ?? "auto";
    body.parallel_tool_calls = chatBody.parallel_tool_calls ?? false;
  }

  return body;
}

function buildHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "OpenAI-Beta": "responses_websockets=2026-02-06",
    originator: "codex_cli_rs",
    "User-Agent": `codex_cli_rs/${CODEX_CLI_VERSION} (proxy; node ${process.version})`,
    version: CODEX_CLI_VERSION,
    session_id: randomUUID(),
  };
  const accountId = extractAccountId(accessToken);
  if (accountId) headers["chatgpt-account-id"] = accountId;
  return headers;
}

interface WsErrorEvent {
  type: string;
  status?: number;
  status_code?: number;
  error?: { code?: string; message?: string; type?: string };
}

function toOpenAiError(status: number, message: string, code?: string): unknown {
  return { error: { message, type: code ?? "upstream_error", code: code ?? null } };
}

/**
 * Run one chat/completions request against the Codex backend.
 * `onTextDelta` is invoked with each streamed text delta (for SSE pass-through).
 */
export async function callCodexBackend(
  accessToken: string,
  chatBody: Record<string, unknown>,
  onTextDelta?: (delta: string) => void
): Promise<CodexCallResult> {
  const model = typeof chatBody.model === "string" ? chatBody.model : "";
  const createFrame = chatToResponseCreate(chatBody);

  return new Promise<CodexCallResult>((resolve) => {
    let settled = false;
    const contentParts: string[] = [];
    let sawDelta = false;
    const toolCalls = new Map<string, { id: string; name: string; arguments: string }>();
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;

    let idle: NodeJS.Timeout;
    const bumpIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish({ status: 504, errorBody: toOpenAiError(504, "Codex backend idle timeout") }), IDLE_TIMEOUT_MS);
    };
    const clearTimer = () => clearTimeout(idle);

    const finish = (result: CodexCallResult) => {
      if (settled) return;
      settled = true;
      clearTimer();
      try { ws.close(); } catch { /* already closed */ }
      resolve(result);
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(CODEX_WS_URL, { headers: buildHeaders(accessToken), handshakeTimeout: 30_000 });
    } catch (err) {
      resolve({ status: 502, errorBody: toOpenAiError(502, `Failed to connect to Codex backend: ${err instanceof Error ? err.message : String(err)}`) });
      return;
    }
    bumpIdle();

    ws.on("open", () => {
      bumpIdle();
      ws.send(JSON.stringify(createFrame));
    });

    ws.on("message", (data: WebSocket.RawData) => {
      bumpIdle();
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = typeof event.type === "string" ? event.type : "";

      if (type === "error") {
        const errEvent = event as unknown as WsErrorEvent;
        const status = errEvent.status ?? errEvent.status_code ?? 500;
        const message = errEvent.error?.message ?? "Codex backend error";
        const code = errEvent.error?.code ?? errEvent.error?.type;
        clearTimer();
        finish({ status: status >= 400 ? status : 500, errorBody: toOpenAiError(status >= 400 ? status : 500, message, code) });
        return;
      }

      if (type === "response.output_text.delta" && typeof event.delta === "string") {
        sawDelta = true;
        contentParts.push(event.delta);
        onTextDelta?.(event.delta);
        return;
      }

      if (type === "response.output_item.done") {
        const item = event.item as { type?: string; id?: string; call_id?: string; name?: string; arguments?: string } | undefined;
        if (item?.type === "function_call") {
          const id = item.call_id ?? item.id ?? `call_${randomUUID()}`;
          const existing = toolCalls.get(id);
          toolCalls.set(id, { id, name: item.name ?? existing?.name ?? "", arguments: item.arguments ?? existing?.arguments ?? "" });
        }
        return;
      }

      if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
        const response = event.response as Record<string, unknown> | undefined;
        if (type === "response.failed") {
          const err = response?.error as { code?: string; message?: string } | undefined;
          clearTimer();
          finish({ status: 502, errorBody: toOpenAiError(502, err?.message ?? "Codex response failed", err?.code) });
          return;
        }
        const u = response?.usage as { input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined;
        usage = u
          ? { prompt_tokens: u.input_tokens ?? 0, completion_tokens: u.output_tokens ?? 0, total_tokens: u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) }
          : null;
        // If deltas were suppressed, recover the text from the final output items.
        if (!sawDelta && Array.isArray(response?.output)) {
          for (const item of response.output as Record<string, unknown>[]) {
            if (item.type === "message" && Array.isArray(item.content)) {
              for (const part of item.content as { type?: string; text?: string }[]) {
                if (part.type === "output_text" && typeof part.text === "string") contentParts.push(part.text);
              }
            }
            if (item.type === "function_call") {
              const it = item as { call_id?: string; id?: string; name?: string; arguments?: string };
              const id = it.call_id ?? it.id ?? `call_${randomUUID()}`;
              toolCalls.set(id, { id, name: it.name ?? "", arguments: it.arguments ?? "" });
            }
          }
        }
        clearTimer();
        finish({ status: 200, completion: { content: contentParts.join(""), toolCalls: [...toolCalls.values()], usage, model } });
        return;
      }
      // All other events (response.created, reasoning deltas, metadata, rate limits) are ignored.
    });

    ws.on("error", (err) => {
      clearTimer();
      const message = err.message || "WebSocket error";
      // Handshake failures surface here with the HTTP status embedded by ws.
      const statusMatch = /Unexpected server response: (\d{3})/.exec(message);
      const status = statusMatch ? Number(statusMatch[1]) : 502;
      finish({ status, errorBody: toOpenAiError(status, statusMatch ? `Codex backend handshake failed: HTTP ${status}` : `Codex backend connection error: ${message}`) });
    });

    ws.on("close", () => {
      clearTimer();
      finish({ status: 502, errorBody: toOpenAiError(502, "Codex backend closed the connection before completing the response") });
    });
  });
}
