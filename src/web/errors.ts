import { FastifyReply } from "fastify";

/** Uniform error body the frontend client expects: { error: { message, type, fields? } }. */
export function sendError(
  reply: FastifyReply,
  status: number,
  message: string,
  type = "error",
  fields?: Record<string, string>
) {
  return reply.status(status).send({ error: { message, type, ...(fields ? { fields } : {}) } });
}

/** Best-effort client IP: nginx forwards X-Forwarded-For / X-Real-IP. */
export function clientIp(headers: Record<string, unknown>): string {
  const fwd = headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  const real = headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  return "—";
}

/** Short human label for a User-Agent string. */
export function deviceLabel(ua: string | undefined): string {
  if (!ua) return "Unknown device";
  const os = /windows/i.test(ua) ? "Windows"
    : /iphone|ipad/i.test(ua) ? "iPhone/iPad"
    : /android/i.test(ua) ? "Android"
    : /mac os x|macintosh/i.test(ua) ? "Mac"
    : /linux/i.test(ua) ? "Linux"
    : "Unknown OS";
  const browser = /edg\//i.test(ua) ? "Edge"
    : /firefox\//i.test(ua) ? "Firefox"
    : /chrome\//i.test(ua) ? "Chrome"
    : /safari\//i.test(ua) ? "Safari"
    : "Browser";
  return `${browser} on ${os}`;
}
