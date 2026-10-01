import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { callCodexBackend } from "../proxy/codex-backend.js";

const auth = JSON.parse(readFileSync(join(homedir(), ".codex", "auth.json"), "utf8"));
const token = auth.tokens.access_token;

const body = {
  model: process.argv[2] || "gpt-5.5",
  messages: [{ role: "user", content: "Reply with exactly: PONG" }],
  reasoning_effort: "light",
};

console.log("Calling Codex backend (non-stream)...");
const start = Date.now();
const result = await callCodexBackend(token, body, (delta) => process.stdout.write(`[delta] ${JSON.stringify(delta)}\n`));
console.log(`\nstatus=${result.status} in ${Date.now() - start}ms`);
if (result.completion) {
  console.log("content:", JSON.stringify(result.completion.content));
  console.log("usage:", result.completion.usage);
  console.log("model:", result.completion.model);
} else {
  console.log("error:", JSON.stringify(result.errorBody));
}
