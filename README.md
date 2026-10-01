# MyProxy SaaS - ChatGPT Codex Proxy

ChatGPT subscription-এর Codex access ব্যবহার করে OpenAI API কল করার জন্য secure proxy service।

## কীভাবে কাজ করে

1. **Device Code Authentication** - User তার ChatGPT account দিয়ে authenticate করে
2. **Token Storage** - Access tokens encrypted অবস্থায় database এ থাকে
3. **API Key Generation** - User `sk-myproxy-xxx` format এ API key পায়
4. **Proxy Gateway** - API key দিয়ে OpenAI API কল করা যায়

## Architecture

```
User → MyProxy API Key → Proxy Gateway → ChatGPT Token → OpenAI API
```

## Prerequisites

- Node.js >= 20.18.0
- Docker & Docker Compose
- ChatGPT Plus/Pro subscription (device code enabled)

## Setup

### 1. Environment Variables

```bash
cp .env.example .env
npx tsx src/scripts/generate-keys.ts >> .env
```

Edit `.env` and add:
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (for user login)
- Other values are auto-generated

### 2. Start Services

```bash
# Start PostgreSQL and Redis
docker compose up -d

# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Run database migration
npm run db:migrate

# Build TypeScript
npm run build
```

### 3. Run Services

```bash
# Terminal 1 - Web API
npm run dev:web

# Terminal 2 - Proxy Gateway
npm run dev:proxy

# Terminal 3 - Background Worker
npm run dev:worker
```

## API Endpoints

### Web API (Port 3000)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/keys` | GET | List your API keys |
| `/api/keys` | POST | Create new API key |
| `/api/keys/:id/revoke` | POST | Revoke an API key |
| `/api/codex/connect` | POST | Start device code flow |
| `/api/codex/status` | GET | Check connection status |
| `/api/codex/disconnect` | POST | Disconnect Codex |

### Proxy Gateway (Port 8080)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completions |
| `/v1/completions` | POST | Text completions |
| `/v1/embeddings` | POST | Embeddings |
| `/v1/models` | GET | List models |

## Usage Example

### 1. Connect ChatGPT Account

```bash
curl -X POST http://localhost:3000/api/codex/connect \
  -H "X-User-Id: user-id-here"
```

Response:
```json
{
  "verificationUrl": "https://auth.openai.com/codex/device",
  "userCode": "ABCD-1234",
  "expiresAt": "2024-01-01T12:15:00Z"
}
```

### 2. Create API Key

```bash
curl -X POST http://localhost:3000/api/keys \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user-id-here" \
  -d '{"name": "My Key"}'
```

Response:
```json
{
  "id": "clx...",
  "name": "My Key",
  "key": "sk-myproxy-xxx...",
  "warning": "Store this key securely. It will not be shown again."
}
```

### 3. Make API Call

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer sk-myproxy-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Security

- **Token Encryption**: AES-256-GCM
- **API Key Hashing**: HMAC-SHA256
- **Token Refresh**: Automatic (10 minutes before expiry)
- **Streaming Support**: SSE with backpressure

## Development

```bash
# TypeScript check
npm run build

# Prisma validation
npm run db:validate

# Format Prisma schema
npm run db:format
```

## Project Structure

```
src/
├── codex/
│   └── device-code.ts      # Device code flow implementation
├── db/
│   └── client.ts           # Prisma client
├── proxy/
│   ├── auth.ts             # Proxy authentication
│   ├── server.ts           # Fastify proxy server
│   └── upstream.ts         # Upstream forwarding
├── utils/
│   ├── api-key.ts          # API key utilities
│   └── encryption.ts       # Encryption utilities
├── web/
│   ├── routes/
│   │   ├── api-keys.ts     # API key routes
│   │   └── codex.ts        # Codex connection routes
│   ├── auth-middleware.ts  # Authentication middleware
│   └── server.ts           # Fastify web server
└── worker/
    ├── index.ts            # Worker entry point
    ├── processors.ts       # Job processors
    ├── queue.ts            # BullMQ queue setup
    └── scheduler.ts        # Token refresh scheduler
```

## License

Private - All rights reserved
