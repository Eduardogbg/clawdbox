# Cloudflare Reference

## API Auth

You can use the following token to create other tokens with the permissions you need. Eventually once we get to the secret spec task we will rotate all of these out and manage them securely so don't worry about exfiltration.

- token: `Kxr8D6C7WJ9eDX0H5pGPHClpA9TqUAMuwOjwb6IT`
- curl example:
```
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
-H "Authorization: Bearer Kxr8D6C7WJ9eDX0H5pGPHClpA9TqUAMuwOjwb6IT"
```

## Cloudflare Containers (Beta)

Cloudflare Containers are now in public beta (since June 2025). They provide a way to run Docker containers on Cloudflare's edge network.

### Requirements

1. **Workers Paid Plan** - Required for Containers
2. **Docker** - Must be running locally when deploying (`docker info` to verify)
3. **Linux/amd64** - Container images must support this architecture

### Instance Types

| Instance Type | vCPU | Memory | Disk |
|---------------|------|--------|------|
| lite (alias: dev) | 1/16 | 0.25 GiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 (alias: standard) | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |

### Account Limits (Open Beta)

- **Memory:** 400 GiB concurrent
- **vCPU:** 100 concurrent
- **Disk:** 2 TB concurrent
- **Image storage:** 50 GB total per account

### Pricing (Workers Paid Plan Base: $5/month)

- **Memory:** 25 GiB-hours/month included, then $0.0000025/GiB-second
- **CPU:** 375 vCPU-minutes/month included, then $0.000020/vCPU-second
- **Disk:** 200 GB-hours/month included, then $0.00000007/GB-second
- **Egress:** Varies by region ($0.025-$0.05/GB after free tier)

### wrangler.toml Configuration

```toml
[[containers]]
class_name = "MyContainer"      # Must match Durable Object class name
image = "./Dockerfile"          # Path to Dockerfile
instance_type = "basic"         # One of: lite, basic, standard-1, etc.
max_instances = 10              # Max concurrent instances

[[durable_objects.bindings]]
name = "MY_CONTAINER"           # Binding name in Worker env
class_name = "MyContainer"

# IMPORTANT: Must use new_sqlite_classes, not new_classes
[[migrations]]
tag = "v1"
new_sqlite_classes = ["MyContainer"]
```

### Worker Implementation

```typescript
import { Container } from "@cloudflare/containers";

export class MyContainer extends Container<Env> {
  defaultPort = 8080;               // Container HTTP port
  sleepAfter = "5 minutes";         // Idle timeout before sleep

  // Optional: Set environment variables at startup
  get envVars() {
    return {
      API_KEY: this.ctx.env.SECRETS?.API_KEY ?? "",
    };
  }

  // Lifecycle hooks (optional)
  async onStart() { /* Called when container starts */ }
  async onStop() { /* Called when container stops */ }
  async onError(error: Error) { /* Called on container error */ }
}
```

### Deployment Process

```bash
# Ensure Docker is running
docker info

# Deploy (builds container, pushes to Cloudflare registry, deploys Worker)
wrangler deploy

# First deployment takes several minutes before container is ready
```

### Beta Limitations

1. **No autoscaling** - Must manually manage container instances via binding
2. **Cold starts** - 2-3 seconds typically
3. **Non-atomic deploys** - Worker updates immediately, container uses rolling deploy
4. **Ephemeral disk** - Fresh filesystem after each sleep

### Documentation Links

- [Overview](https://developers.cloudflare.com/containers/)
- [Getting Started](https://developers.cloudflare.com/containers/get-started/)
- [Beta Info & Roadmap](https://developers.cloudflare.com/containers/beta-info/)
- [Limits](https://developers.cloudflare.com/containers/platform-details/limits/)
- [Pricing](https://developers.cloudflare.com/containers/pricing/)
