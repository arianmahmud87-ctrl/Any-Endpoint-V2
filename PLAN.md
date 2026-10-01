# MyProxy SaaS — Architecture Plan

**Status:** Device Code Flow Implemented ✅  
**Current scope:** ChatGPT subscription integration via device code authentication  
**Deferred:** Frontend implementation/user journey and Phase 5 production security/abuse prevention  
**Last reviewed:** 2026-09-29  
**Backend implementation status:** Device code flow fully implemented. Users can authenticate via ChatGPT, tokens are encrypted and auto-refreshed, and proxy gateway forwards API calls.

## 1. Goal

Build a service that lets an authenticated user connect an approved Codex/OpenAI account, generate scoped MyProxy API keys, and call the supported upstream API through an OpenAI-compatible streaming proxy.

The initial implementation should focus on the backend contracts, persistence model, token lifecycle, background polling, and proxy request path. No frontend screens or production hardening are included in the current phase.

## 2. Phase status

| Phase | Area | Status | Current decision |
|---|---|---:|---|
| 1 | Technology stack and architecture | **In scope, backend portions** | Use Next.js/Node ecosystem, PostgreSQL, Prisma, Redis, BullMQ, and Fastify unless implementation constraints require a change. The dashboard/frontend portion is deferred. |
| 2 | Prisma database schema | **In scope** | Implement and review relational models, constraints, indexes, and token/key lifecycle fields. |
| 3 | Frontend and user journey | **Skipped for now** | Do not build landing pages, dashboard UI, connection modal, browser polling UI, or frontend API integration yet. |
| 4 | Proxy gateway | **In scope, backend design first** | Define and implement authenticated request forwarding and streaming behavior after the upstream Codex authentication contract is verified. |
| 5 | Security and abuse prevention | **Skipped for now** | Do not implement the planned rate limiting, egress IP rotation, or launch hardening in this phase. Treat the system as non-production until this phase is completed. |

## 3. Proposed stack

### Backend and application

- **Application framework:** Next.js with TypeScript for server-side application endpoints and future dashboard integration.
- **Authentication:** Auth.js/NextAuth.js with Google as the only configured provider.
- **Database:** PostgreSQL accessed through Prisma ORM.
- **Background jobs:** Node.js workers using BullMQ and Redis for asynchronous upstream authorization polling and token lifecycle work.
- **Proxy gateway:** Fastify on Node.js, either as a separate service or as a separately deployed process from the dashboard/application service.
- **Runtime boundary:** Keep the proxy path independent from browser/UI concerns so high-volume streaming requests do not share lifecycle assumptions with the dashboard.

### Initial deployment shape

1. **Web application:** Auth.js integration, account-management endpoints, connection initiation/status endpoints, and future dashboard.
2. **Worker:** BullMQ consumer that owns authorization polling and persists the resulting token state.
3. **Proxy:** Fastify service that authenticates MyProxy keys, resolves the owning user, loads the encrypted upstream token, and forwards compatible requests.
4. **Managed services or local equivalents:** PostgreSQL and Redis.

The first implementation should keep these as logical boundaries even if they run in one repository or one development process.

## 4. Data model proposal

The following schema is the starting point, not yet a finalized migration:

```prisma
model User {
  id          String      @id @default(cuid())
  email       String      @unique
  name        String?
  googleId    String      @unique
  codexToken  CodexToken?
  apiKeys     ApiKey[]
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
}

model CodexToken {
  id           String   @id @default(cuid())
  userId       String   @unique
  accessToken  String   // AES-256-GCM ciphertext envelope; never plaintext
  refreshToken String   // AES-256-GCM ciphertext envelope; never plaintext
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model ApiKey {
  id         String   @id @default(cuid())
  keyHash    String   @unique
  userId     String
  name       String
  createdAt  DateTime @default(now())
  revokedAt  DateTime?
  lastUsedAt DateTime?
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
}
```

### Schema decisions to confirm during implementation

- Store a versioned encryption envelope containing algorithm/version, nonce/IV, ciphertext, and authentication tag; do not store a raw token or an ambiguous encoded value.
- Use a keyed, deterministic hash for API-key lookup (for example, an HMAC with a server-side secret) rather than a slow password hash if direct indexed lookup is required. The exact construction must be documented before implementation.
- Store only the API-key hash. Display the plaintext key once at creation time and never recover it from the database.
- Model revoked keys explicitly so revocation is an atomic database check, not deletion-only behavior.
- **Public SaaS credentials:** use the official Platform API-key model rather than ChatGPT subscription tokens. The database model should be revised before implementing public proxy credential storage.
- **Private Codex runner credentials:** `CodexToken` may represent a private, trusted-runner credential only after the deployment model and OpenAI permissions are approved; it must not be exposed as a general public-user relay.

## 5. Authentication and Codex connection flow

This is the backend flow to design first; the browser experience is deferred.

1. A user authenticates through Google using Auth.js.
2. The application creates or updates the local `User` record using the provider's stable subject identifier as `googleId`.
3. A protected backend endpoint starts a Codex authorization attempt and receives the upstream device/user-code information.
4. The application stores a short-lived connection-attempt record or job identifier. The exact persistence shape is still to be decided; it should not place temporary authorization codes in logs.
5. A BullMQ job polls the upstream authorization endpoint at the provider-required interval, with timeout and terminal failure states.
6. On approval, the worker encrypts the returned access and refresh tokens before writing them to `CodexToken`.
7. The status endpoint exposes only a safe state such as `pending`, `connected`, `expired`, or `failed`; it must not return tokens.
8. On expiration or denial, the worker records a terminal state and allows a new connection attempt.

### Device Code Authentication Flow (Implemented)

Based on OpenAI Codex CLI source code analysis, the device code authentication uses these endpoints:

**Base URL:** `https://auth.openai.com`

**Endpoints:**
1. `POST /api/accounts/deviceauth/usercode` - Request device code
   - Request: `{ "client_id": "codex-cli-client" }`
   - Response: `{ "device_auth_id": "...", "user_code": "ABCD-1234", "interval": 5 }`

2. `POST /api/accounts/deviceauth/token` - Poll for authorization
   - Request: `{ "device_auth_id": "...", "user_code": "ABCD-1234" }`
   - Response (pending): HTTP 403/404
   - Response (success): `{ "authorization_code": "...", "code_challenge": "...", "code_verifier": "..." }`

3. `POST /api/accounts/deviceauth/callback` - Exchange code for tokens
   - Exchange authorization_code for access_token, refresh_token, id_token

**Verification URL:** `https://auth.openai.com/codex/device`

**Token Storage:** `~/.codex/auth.json` (or encrypted in database for this service)

**Token Refresh:** Automatic refresh before expiry using refresh_token

**Implementation Status:** ✅ Approved and implemented

## 6. Proxy gateway flow

Target endpoint shape:

```text
POST https://api.yourdomain.com/v1/chat/completions
Authorization: Bearer sk-myproxy-...
```

### Upstream transport (implemented 2026-09-30)

The stored Codex credentials are ChatGPT-subscription OAuth tokens, which are
not platform API keys and are rejected by `api.openai.com` (that was the
`billing_not_active` error). Like the Codex CLI itself, the proxy therefore
talks to the Codex subscription backend over WebSocket at
`wss://chatgpt.com/backend-api/codex/responses` (Responses API; HTTP/SSE was
removed upstream in Codex CLI v0.133.0). `src/proxy/codex-backend.ts`
translates OpenAI chat/completions payloads to `response.create` frames and
streams the events back as chat.completion chunks. Setting `UPSTREAM_BASE_URL`
switches the proxy back to plain API-key passthrough mode.

Request path:

1. Fastify receives the request and extracts the bearer credential.
2. It computes the configured API-key lookup digest and queries an indexed `ApiKey` record.
3. It rejects missing, unknown, or revoked keys without revealing whether a key existed.
4. For the recommended public SaaS path, it resolves the user's approved Platform API credential through a protected server-side credential store; it must not use ChatGPT subscription session tokens.
5. It loads the minimum credential required for the request and keeps it in memory only for the upstream call.
6. It validates the route/method/content type and translates the request only if the verified Platform API contract requires it.
7. It forwards the request to the approved Platform API endpoint with the upstream authorization header, not the MyProxy key.
8. For streaming responses, it preserves the upstream SSE content type and forwards chunks with backpressure and connection-abort handling.
9. It maps upstream errors to stable proxy responses without leaking upstream credentials or internal database details.
10. It updates usage metadata asynchronously where practical, without delaying the stream unnecessarily.

### Proxy design constraints

- Do not buffer an entire streaming response in memory.
- Use request, upstream-connect, and idle-stream timeouts.
- Propagate client cancellation to the upstream request.
- Keep upstream tokens out of structured logs, traces, exceptions, and metrics labels.
- Define an explicit supported route/model/payload matrix instead of forwarding arbitrary traffic by default.
- Separate key authentication, token retrieval, payload translation, upstream transport, and SSE handling into testable modules.

## 7. Background job design

Initial BullMQ job categories:

- `codex-authorization-poll`: polls one short-lived connection attempt and terminates on approval, denial, expiry, or timeout.
- `codex-token-refresh`: reserved for the verified refresh-token lifecycle; do not assume refresh semantics until confirmed.

Each job should have bounded retries, exponential backoff where appropriate, idempotent persistence, and a correlation ID that is safe to log. Jobs must not log authorization codes or token values.

## 8. Deferred work

### Phase 3 — Frontend and user journey

Explicitly skipped in this iteration:

- Landing page and Google login button UI.
- Dashboard layout and connection-status badge.
- API-key generation/list/revocation screens.
- Connect Codex modal and display of the user code.
- Browser polling of `/api/auth/status` and success/error states.
- TailwindCSS styling and frontend polish.

The backend should still expose stable, documented contracts so this UI can be added later without redesigning the core data flow.

### Phase 5 — Security and abuse prevention

Explicitly skipped in this iteration:

- Production AES-256-GCM key management and rotation procedure beyond the data-model requirement.
- Redis-backed per-user/API-key rate limiting.
- Request quotas, concurrency limits, and abuse detection.
- Egress IP rotation or proxy routing.
- Comprehensive audit logging, alerting, secret rotation, and incident response.
- Production deployment hardening, WAF/network policy, and compliance review.

Until Phase 5 is completed, this plan is suitable for local development or a controlled test environment only. It is not a launch checklist.

## 9. Recommended implementation order for the current scope

1. ✅ Create the repository skeleton and shared TypeScript configuration.
2. ✅ Add Prisma schema and a local PostgreSQL migration.
3. ✅ Implement encryption-envelope utilities with unit-level examples and strict secret handling.
4. ✅ Implement Auth.js Google configuration and local `User` synchronization.
5. ✅ Define the connection-attempt state machine and protected backend endpoints.
6. ✅ Add BullMQ/Redis worker scaffolding and a provider adapter around the verified upstream auth contract.
7. ✅ Implement API-key creation, one-time plaintext presentation, lookup, and revocation.
8. ✅ Implement the Fastify proxy with non-streaming forwarding first.
9. ✅ Add SSE streaming, cancellation, timeout, and error mapping behavior.
10. 🔲 Document local setup, environment variables, endpoint contracts, and the deferred Phase 3/5 work.

## 10. Environment variables to reserve

Names are provisional and must be documented without committing values:

```text
DATABASE_URL=
REDIS_URL=
AUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
TOKEN_ENCRYPTION_KEY=
API_KEY_HASH_SECRET=
OPENAI_API_KEY=
UPSTREAM_BASE_URL=
```

Secrets must be supplied through the deployment environment or a secret manager and excluded from source control. The exact key encoding and rotation strategy remains a Phase 5 decision.

## 11. Review checklist before implementation

- [ ] Confirm the upstream Codex authorization and API contracts are officially supported and permitted.
- [ ] Decide whether the web app and proxy are deployed as separate services or processes.
- [ ] Finalize connection-attempt persistence and status transitions.
- [ ] Finalize encryption-envelope and API-key digest formats.
- [ ] Confirm token refresh behavior and expiry semantics.
- [ ] Define the first supported proxy endpoints, models, and payload translation rules.
- [ ] Confirm PostgreSQL and Redis version/deployment targets.
- [ ] Record the explicit Phase 3 and Phase 5 deferrals in implementation tasks.
- [ ] Do not expose the service publicly until Phase 5 is implemented and reviewed.
