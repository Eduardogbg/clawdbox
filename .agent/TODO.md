# Clawdbox Project TODO

## Completed
- [x] Fix alchemy-effect dependency to use local fork (tgz tarball)
- [x] Build alchemy-effect fork with proper exports
- [x] Run typecheck on packages/iac
- [x] Create integration tests for Cloudflare resources
- [x] Test Secrets Store deployment via IaC (PASSED!)
- [x] Test Worker deployment via IaC (PASSED!)
- [x] Create packages/agent-container structure (Dockerfile, entrypoint, permission hooks)
- [x] Create packages/telegram-webhook (Telegram Bot API, handler, wrangler config)

## In Progress
- [ ] Set up CI/CD for IaC tests

## Pending
- [ ] Test R2 bucket deployment via IaC (requires R2 enabled in CF dashboard)
- [ ] Create Operator Durable Object for task coordination
- [ ] Telegram Bot integration (API key needed)
- [ ] Container deployment testing (requires Docker + beta access)

## Package Structure

```
packages/
├── iac/                    # Infrastructure as Code
│   ├── src/alchemy.run.ts  # Main IaC entrypoint
│   └── test/               # Integration tests
│       ├── secrets-store.test.ts (PASS)
│       ├── worker.test.ts (PASS)
│       └── r2-bucket.test.ts (NEEDS R2 ENABLED)
├── agent-container/        # Claude Agent SDK Container
│   ├── Dockerfile          # Bun + Node.js + claude-code
│   └── src/
│       ├── entrypoint.ts   # Main entry point
│       ├── config.ts       # Schema for agent config
│       ├── permission.ts   # Permission hook for Telegram approval
│       └── repo.ts         # Repository cloning/pushing
└── telegram-webhook/       # Telegram Bot Worker
    ├── wrangler.toml       # Cloudflare Worker config
    └── src/
        ├── index.ts        # Worker handler
        ├── handler.ts      # Update processing
        ├── telegram.ts     # Telegram API client
        └── types.ts        # Telegram Bot API types
```

## Notes

### Alchemy-Effect Fork Changes
1. Added `export * from "./api.ts"` to cloudflare/index.ts to expose CloudflareApi
2. Added package exports for: `./test`, `./cloudflare/secrets-store`, `./cloudflare/container`
3. Created scripts/fix-imports.ts to add .js extensions to relative imports in lib/

### Environment Variables Required
- `CLOUDFLARE_API_TOKEN` - API token with account permissions
- `CLOUDFLARE_ACCOUNT_ID` - 3a16620c57b98731f762586aeed4f25c
- `TELEGRAM_BOT_TOKEN` - (not yet available)

### Cloudflare Account Status
- Account ID: 3a16620c57b98731f762586aeed4f25c
- R2: NOT ENABLED (needs dashboard activation)
- Secrets Store: ENABLED (test passes)
- Workers: ENABLED (test passes)
- Containers: Beta feature (needs special configuration)

### Test Results (2025-12-29)
- SecretsStore: PASS - Creates store with secrets, verifies, and deletes
- R2: FAIL - R2 not enabled on account (error 10042)
- Worker: PASS - Creates worker, verifies via API, deletes

### Cloudflare Container Architecture Notes
Containers are Durable Object-based compute that run Docker images:
- Require Docker running locally for wrangler deploy
- Need `[[containers]]` section in wrangler.toml
- Container class must extend `@cloudflare/containers`
- In alchemy-effect, Container is a "virtual resource" (binding only)
- Container lifecycle is managed via Worker deployment

### Durable Object Architecture Notes
Durable Objects in alchemy-effect are also "virtual resources":
- `DurableObject.Namespace` creates a binding configuration
- `DurableObject.Bind(namespace)` adds binding to Worker policy
- The actual DO class must be defined in Worker source code
- DO namespace is created when Worker is deployed

## Next Steps
1. Enable R2 via Cloudflare dashboard and rerun test
2. Create Operator Durable Object for task/session management
3. Get Telegram Bot token and test webhook integration
4. Set up GitHub Actions for CI/CD
