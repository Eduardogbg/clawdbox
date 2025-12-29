# Clawdbox Project TODO

## Completed
- [x] Fix alchemy-effect dependency to use local fork (tgz tarball)
- [x] Build alchemy-effect fork with proper exports
- [x] Run typecheck on packages/iac
- [x] Create integration tests for Cloudflare resources
- [x] Test Secrets Store deployment via IaC (PASSED!)
- [x] Test Worker deployment via IaC (PASSED!)

## In Progress
- [ ] Set up Container resource for Claude Agent SDK

## Pending
- [ ] Test R2 bucket deployment via IaC (requires R2 enabled in CF dashboard)
- [ ] Create Worker with basic handler for Telegram webhook
- [ ] Automate IaC tests with CI/CD
- [ ] Telegram Bot integration (API key needed)

## Notes

### Alchemy-Effect Fork Changes
1. Added `export * from "./api.ts"` to cloudflare/index.ts to expose CloudflareApi
2. Added package exports for: `./test`, `./cloudflare/secrets-store`, `./cloudflare/container`
3. Created scripts/fix-imports.ts to add .js extensions to relative imports in lib/

### Environment Variables Required
- `CLOUDFLARE_API_TOKEN` - API token with account permissions
- `CLOUDFLARE_ACCOUNT_ID` - 3a16620c57b98731f762586aeed4f25c

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
1. Create a simple Worker with embedded Durable Object for state management
2. Document Container setup requirements for Claude Agent SDK
3. Enable R2 via Cloudflare dashboard and rerun test
4. Create Telegram webhook handler structure (deferred, no API key)
