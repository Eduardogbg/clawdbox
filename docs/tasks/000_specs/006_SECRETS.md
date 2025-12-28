# Secret Management

> Multi-tier secret management for clawdbox

## Overview

Clawdbox handles three categories of secrets:

1. **Infrastructure**: Credentials for provisioning resources
2. **Service**: Credentials for runtime services (Telegram, GitHub)
3. **Customer**: User-provided API keys (Claude API key)

## Secret Categories

```
┌─────────────────────────────────────────────────────────────┐
│                    SECRET CATEGORIES                         │
├─────────────────┬─────────────────┬─────────────────────────┤
│  Infrastructure │     Service     │       Customer          │
├─────────────────┼─────────────────┼─────────────────────────┤
│ CF API Token    │ Telegram Token  │ Claude API Key          │
│ CF Account ID   │ GitHub PAT      │ (future: per-user keys) │
│                 │ Webhook Secret  │                         │
├─────────────────┼─────────────────┼─────────────────────────┤
│ Used at:        │ Used at:        │ Used at:                │
│ Deploy time     │ Runtime         │ Runtime                 │
├─────────────────┼─────────────────┼─────────────────────────┤
│ Stored in:      │ Stored in:      │ Stored in:              │
│ Local env       │ Secrets Store   │ Secrets Store           │
│ GitHub Actions  │                 │                         │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## secretspec.toml

Declarative secret specification for the project:

```toml
# secretspec.toml - Secret declarations for clawdbox

[infrastructure]
# Used only at deploy time, not deployed to runtime
CLOUDFLARE_API_TOKEN = { required = true, description = "Cloudflare API token for alchemy-effect" }
CLOUDFLARE_ACCOUNT_ID = { required = true, description = "Cloudflare account ID" }

[service]
# Deployed to Cloudflare Secrets Store
TELEGRAM_BOT_TOKEN = { required = true, description = "Telegram bot token from @BotFather" }
TELEGRAM_CHAT_ID = { required = true, description = "Telegram forum group ID" }
TELEGRAM_WEBHOOK_SECRET = { required = true, description = "Secret for validating webhook requests" }
GITHUB_PAT = { required = true, description = "GitHub personal access token for repo operations" }

[customer]
# User-provided secrets
ANTHROPIC_API_KEY = { required = true, description = "Claude API key for agent execution" }

[github_actions]
# Secrets needed in CI/CD
secrets = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
```

## Cloudflare Secrets Store

### Setup with alchemy-effect

```typescript
// alchemy.run.ts
import * as Cloudflare from "alchemy-effect/cloudflare";
import { secret } from "alchemy-effect";

class ClawdboxSecrets extends Cloudflare.SecretsStore("Secrets", {
  secrets: {
    // Service secrets
    TELEGRAM_BOT_TOKEN: secret(process.env.TELEGRAM_BOT_TOKEN),
    TELEGRAM_CHAT_ID: secret(process.env.TELEGRAM_CHAT_ID),
    TELEGRAM_WEBHOOK_SECRET: secret(process.env.TELEGRAM_WEBHOOK_SECRET),
    GITHUB_PAT: secret(process.env.GITHUB_PAT),

    // Customer secrets
    ANTHROPIC_API_KEY: secret(process.env.ANTHROPIC_API_KEY),
  },
}) {}
```

### Access in Worker

```typescript
// Worker with Secrets Store binding
export default {
  async fetch(request: Request, env: Env) {
    // Access secrets via binding
    const telegramToken = await env.SECRETS.get("TELEGRAM_BOT_TOKEN");
    const apiKey = await env.SECRETS.get("ANTHROPIC_API_KEY");

    // Use secrets...
  },
};
```

### Inject into Container

```typescript
// When spawning container
const containerConfig = {
  image: agentImage,
  configuration: {
    secrets: [
      { name: "ANTHROPIC_API_KEY", type: "env", secret: "ANTHROPIC_API_KEY" },
      { name: "GITHUB_PAT", type: "env", secret: "GITHUB_PAT" },
    ],
  },
};
```

## Local Development

### .env File

```bash
# .env (not committed!)

# Infrastructure (deploy-time)
CLOUDFLARE_API_TOKEN=your-token-here
CLOUDFLARE_ACCOUNT_ID=your-account-id

# Service
TELEGRAM_BOT_TOKEN=123456:ABC-DEF
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_WEBHOOK_SECRET=random-secret-string
GITHUB_PAT=ghp_xxxxxxxxxxxx

# Customer
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

### .env.example

```bash
# .env.example (committed, template)

# Infrastructure
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=

# Service
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=
GITHUB_PAT=

# Customer
ANTHROPIC_API_KEY=
```

### Load Environment

```typescript
// Load .env in development
import { config } from "dotenv";

if (process.env.NODE_ENV === "development") {
  config();
}
```

## GitHub Actions

### Repository Secrets

Configure in GitHub: Settings → Secrets and variables → Actions

Required secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### Workflow Usage

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Deploy
        run: bun run alchemy.run.ts --apply
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          # Service secrets are already in Secrets Store
```

## Secret Rotation

### Rotation Strategy

| Secret | Rotation Frequency | Method |
|--------|-------------------|--------|
| CF API Token | 90 days | Manual |
| Telegram Bot Token | Never (unless compromised) | BotFather |
| GitHub PAT | 90 days | GitHub settings |
| Anthropic API Key | 90 days | Console |
| Webhook Secret | 90 days | Manual |

### Rotation Process

```typescript
// Helper script for rotation
// scripts/rotate-secrets.ts

import { Effect } from "effect";

const rotateSecret = (name: string, newValue: string) =>
  Effect.gen(function* () {
    // Update in Secrets Store
    yield* updateSecretsStore(name, newValue);

    // Force container restart to pick up new secrets
    yield* restartContainers();

    console.log(`✅ Rotated: ${name}`);
  });

// Usage: bun run scripts/rotate-secrets.ts GITHUB_PAT ghp_newtoken
```

## Security Best Practices

### 1. Never Log Secrets

```typescript
// Bad
console.log(`Using API key: ${apiKey}`);

// Good
console.log(`Using API key: ${apiKey.substring(0, 8)}...`);
```

### 2. Validate Secret Format

```typescript
const validateSecrets = Effect.gen(function* () {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey?.startsWith("sk-ant-")) {
    yield* Effect.fail(new Error("Invalid Anthropic API key format"));
  }

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramToken?.match(/^\d+:[A-Za-z0-9_-]+$/)) {
    yield* Effect.fail(new Error("Invalid Telegram bot token format"));
  }
});
```

### 3. Minimal Scope

```typescript
// Only inject secrets that are actually needed
const workerSecrets = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"];
const containerSecrets = ["ANTHROPIC_API_KEY", "GITHUB_PAT"];
```

### 4. Audit Access

```typescript
// Log secret access (not the value!)
const getSecret = (name: string) =>
  Effect.gen(function* () {
    yield* Effect.log(`Accessing secret: ${name}`);
    const value = yield* Effect.tryPromise(() => env.SECRETS.get(name));
    return value;
  });
```

## Future: Multi-Tenant Secrets

For supporting multiple users with their own API keys:

```typescript
// Per-user secrets namespace
class UserSecrets extends Cloudflare.SecretsStore("UserSecrets", {
  // Structure: user:{userId}:{secretName}
}) {}

const getUserApiKey = (userId: string) =>
  Effect.gen(function* () {
    const key = `user:${userId}:ANTHROPIC_API_KEY`;
    return yield* Effect.tryPromise(() => env.USER_SECRETS.get(key));
  });
```

## Comparison with claude-army

| Aspect | claude-army | clawdbox |
|--------|-------------|----------|
| Config storage | ~/telegram.json | Cloudflare Secrets Store |
| Format | JSON file | Encrypted cloud storage |
| Access | File read | API/binding |
| Rotation | Manual file edit | API update + restart |
| Multi-tenant | Not supported | Possible via namespacing |
